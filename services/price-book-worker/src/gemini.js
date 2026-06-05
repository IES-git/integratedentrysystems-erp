// Gemini helpers shared by the catalog and per-table extraction jobs.
// Mirrors the prompts/schemas from the original Supabase Edge Functions, but
// runs in plain Node (no wall-clock limit on Render).

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_FILES_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

export const ALLOWED_CATEGORIES = ['doors', 'frames', 'hardware', 'lites_louvers_glass', 'panels'];

export function getMimeType(fileName, fileType) {
  if (fileType === 'pdf') return 'application/pdf';
  const ext = (fileName || '').split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Uploads bytes to the Gemini Files API (resumable) and returns { uri, name }. */
export async function uploadToGeminiFiles(apiKey, bytes, mimeType, displayName) {
  const numBytes = bytes.length;
  const startResp = await fetch(GEMINI_FILES_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(numBytes),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!startResp.ok) throw new Error(`Files API start ${startResp.status}: ${(await startResp.text()).slice(0, 300)}`);
  const uploadUrl = startResp.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('Files API: no upload URL returned');

  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Length': String(numBytes), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: bytes,
  });
  if (!uploadResp.ok) throw new Error(`Files API upload ${uploadResp.status}: ${(await uploadResp.text()).slice(0, 300)}`);
  const info = await uploadResp.json();
  let file = info.file;
  let tries = 0;
  while (file?.state === 'PROCESSING' && tries < 60) {
    await sleep(1500);
    const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { headers: { 'x-goog-api-key': apiKey } });
    file = await g.json();
    tries++;
  }
  if (!file?.uri || file.state === 'FAILED') throw new Error('Files API: file processing failed');
  return { uri: file.uri, name: file.name };
}

export function buildAliasHints(aliases) {
  const byKey = new Map();
  for (const a of aliases) {
    if (!byKey.has(a.field_key)) byKey.set(a.field_key, []);
    byKey.get(a.field_key).push(a.manufacturer_name ? `"${a.manufacturer_field_label}" (${a.manufacturer_name})` : `"${a.manufacturer_field_label}"`);
  }
  return [...byKey.entries()].map(([k, h]) => `- ${k}: also written as ${h.join(', ')}`).join('\n');
}

/** Calls Gemini expecting JSON; returns { parsed, truncated, raw }. */
export async function callGemini(apiKey, prompt, schema, maxTokens, filePart) {
  const parts = [];
  if (filePart) parts.push(filePart);
  parts.push({ text: prompt });
  const resp = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.3, maxOutputTokens: maxTokens } }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    const e = new Error(`Gemini API ${resp.status}: ${txt.slice(0, 400)}`);
    e.status = resp.status;
    throw e;
  }
  const result = await resp.json();
  const finishReason = result.candidates?.[0]?.finishReason;
  let jsonText;
  for (const p of result.candidates?.[0]?.content?.parts ?? []) if (typeof p.text === 'string') jsonText = p.text;
  if (!jsonText) throw new Error('No text output in Gemini response');
  let parsed = null;
  try { parsed = JSON.parse(jsonText); } catch { parsed = null; }
  return { parsed, truncated: !!(finishReason && finishReason !== 'STOP'), raw: jsonText };
}

/** Salvage completed {row,col,price} objects from a truncated grid response. */
export function recoverCells(jsonText) {
  const cells = [];
  const re = /\{[^{}]*?\}/g;
  let m;
  while ((m = re.exec(jsonText)) !== null) {
    try {
      const o = JSON.parse(m[0]);
      if (typeof o.row === 'number' && typeof o.col === 'number' && typeof o.price === 'number') cells.push(o);
    } catch { /* skip */ }
  }
  return cells;
}

/**
 * Salvage completed table objects from a truncated/invalid catalog response.
 * Catalog table objects are flat (string fields only), so a non-greedy
 * brace match recovers every fully-written entry even when the array was cut
 * off mid-stream. Keeps anything with a usable title.
 */
export function recoverCatalogTables(jsonText) {
  const tables = [];
  const re = /\{[^{}]*\}/g;
  let m;
  while ((m = re.exec(jsonText)) !== null) {
    try {
      const o = JSON.parse(m[0]);
      if (typeof o.title === 'string' && o.title.trim()) tables.push(o);
    } catch { /* skip */ }
  }
  return tables;
}

export function buildCatalogPrompt(categoryHint, aliasHints, csvText, excludeTitles = []) {
  const aliasSection = aliasHints ? `\nKNOWN FIELD ALIASES (context):\n${aliasHints}\n` : '';
  const catSection = categoryHint ? `\nThe user expects this book to be primarily "${categoryHint}", but it WILL contain other categories too (frames, hardware, adders). Include them all.` : '';
  const source = csvText ? `\nPRICE BOOK CONTENT (CSV/text):\n\n${csvText.slice(0, 80000)}\n` : '';
  const excludeSection = excludeTitles.length
    ? `\nALREADY-LISTED TABLES (do NOT repeat any of these; list ONLY tables that are NOT in this list):\n${excludeTitles.map((t) => `- ${t}`).join('\n')}\n`
    : '';
  return `You are cataloging a manufacturer price book for commercial doors, frames, hardware, glass/lites, and panels.${catSection}${aliasSection}${source}${excludeSection}
Build a COMPLETE index of EVERY distinct pricing table or priced section in this document, from the FIRST page to the LAST.

How to be exhaustive:
1. First read the document's table of contents / index (if present) to learn how many sections there are (e.g. "Door Pricing", "Frame Pricing", "Hardware", "Adders/Options").
2. Then page through the ENTIRE document in order. A real book has MANY tables: every door series has its own size grid (and often header/transom/louver/glass add tables), every frame series has its own grid, plus standalone hardware lists and MANY option/adder/surcharge tables (e.g. "add for fire label", "add for header", finish upcharges, oversize upcharges, prep charges).
3. Treat each size grid, each flat price list, and each adder/surcharge table as a SEPARATE entry — never merge two printed tables into one.
4. Do NOT stop after the first few. Err on the side of MORE entries.

For EACH table/section return:
- title: the heading exactly as printed (make it specific enough to find again, e.g. "FS Series Door Pricing", not just "Pricing").
- category: one of doors|frames|hardware|lites_louvers_glass|panels|other.
- series: the product line/series name, or null.
- kind: size_grid (rows=sizes, cols=options) | flat_list (item -> price) | adder (surcharge/upcharge).
- page_hint: the page number or page range where this table appears (e.g. "p. 12" or "pp. 12-13"). REQUIRED — give your best estimate.
- description: <= 12 words. Keep it short to leave room for more tables.

Do NOT extract any prices yet. Include vendor_name if shown. Return ONLY valid JSON matching the schema.`;
}

export function getCatalogSchema() {
  return { type: 'object', properties: { vendor_name: { type: 'string' }, tables: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, category: { type: 'string' }, series: { type: 'string' }, kind: { type: 'string' }, page_hint: { type: 'string' }, description: { type: 'string' } }, required: ['title'] } } }, required: ['tables'] };
}

export function buildGridPrompt(title, category, series, kind, pageHint, aliasHints, csvText) {
  const aliasSection = aliasHints ? `\nFIELD ALIASES — map column headers to these standard field keys when recognized (use the standard key in column_field_hints):\n${aliasHints}\n` : '';
  const source = csvText ? `\nPRICE BOOK CONTENT (CSV/text):\n\n${csvText.slice(0, 80000)}\n` : '';
  const loc = pageHint ? ` located at ${pageHint}` : '';
  return `You are extracting ONE specific pricing table from a manufacturer price book.${source}
TARGET TABLE: "${title}"${loc} — category: ${category ?? 'unknown'}, series: ${series ?? 'n/a'}, kind: ${kind ?? 'size_grid'}.${aliasSection}
${pageHint ? `Go to ${pageHint} and find the table titled "${title}". ` : ''}Extract the COMPLETE grid for THIS table ONLY. Do NOT merge in rows or columns from any other table, and do NOT extract a different table even if it looks similar.

1. column_labels: every column header left-to-right, exactly as printed. For a flat_list or adder table that has a single price column, use one column labeled "Price".
2. row_labels: every row top-to-bottom (sizes like "3'0\" x 7'0\"" for grids, or item/option names for flat_list/adder tables). Preserve the printed order and the exact size formatting.
3. cells: every priced cell as { row, col, price } using 0-based indices into row_labels/column_labels. Omit blank/empty cells. Capture EVERY priced cell across ALL rows and ALL columns — do not stop early or sample.
4. column_field_hints: { col, field_key } for any column mappable to a standard field key.
5. warnings: note anything unreadable, ambiguous, or any prices that appear to continue onto another page.

If the table spans multiple pages, include the continuation rows too. Return ONLY valid JSON. Prices are plain numbers (no $, commas, or text).`;
}

export function getGridSchema() {
  return { type: 'object', properties: { column_labels: { type: 'array', items: { type: 'string' } }, row_labels: { type: 'array', items: { type: 'string' } }, cells: { type: 'array', items: { type: 'object', properties: { row: { type: 'integer' }, col: { type: 'integer' }, price: { type: 'number' } }, required: ['row', 'col', 'price'] } }, column_field_hints: { type: 'array', items: { type: 'object', properties: { col: { type: 'integer' }, field_key: { type: 'string' } }, required: ['col', 'field_key'] } }, warnings: { type: 'array', items: { type: 'string' } } }, required: ['column_labels', 'row_labels', 'cells'] };
}

export async function loadAliasHints(sb) {
  const { data: aliasRows } = await sb
    .from('manufacturer_field_labels')
    .select('field_key:field_definition_id(field_key), manufacturer_name:manufacturer_id(name), manufacturer_field_label');
  const aliases = (aliasRows || [])
    .map((r) => ({ field_key: r.field_key?.field_key ?? '', manufacturer_name: r.manufacturer_name?.name ?? null, manufacturer_field_label: r.manufacturer_field_label }))
    .filter((a) => a.field_key);
  return buildAliasHints(aliases);
}

export { GEMINI_MODEL };
