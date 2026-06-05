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

export function buildCatalogPrompt(categoryHint, aliasHints, csvText) {
  const aliasSection = aliasHints ? `\nKNOWN FIELD ALIASES (context):\n${aliasHints}\n` : '';
  const catSection = categoryHint ? `\nThe user expects this book to be primarily "${categoryHint}", but it may contain other categories.` : '';
  const source = csvText ? `\nPRICE BOOK CONTENT (CSV/text):\n\n${csvText.slice(0, 80000)}\n` : '';
  return `You are cataloging a manufacturer price book for commercial doors, frames, hardware, glass/lites, and panels.${catSection}${aliasSection}${source}\nList EVERY distinct pricing table or priced section in this document, from the FIRST page to the LAST. Be exhaustive — do NOT stop after the first table. A single book typically has MANY: multiple door series, multiple frame series, header tables, transom/lite/glass tables, hardware lists, and option/adder/surcharge tables (e.g. "add for fire label", "add for header", finish upcharges, oversize upcharges).\n\nFor EACH table/section return: title (heading as printed), category (doors|frames|hardware|lites_louvers_glass|panels|other), series (product line or null), kind (size_grid|flat_list|adder), page_hint, and a one-sentence description. Do NOT extract any prices yet. Include vendor_name if shown.\n\nReturn ONLY valid JSON matching the schema.`;
}

export function getCatalogSchema() {
  return { type: 'object', properties: { vendor_name: { type: 'string' }, tables: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, category: { type: 'string' }, series: { type: 'string' }, kind: { type: 'string' }, page_hint: { type: 'string' }, description: { type: 'string' } }, required: ['title'] } } }, required: ['tables'] };
}

export function buildGridPrompt(title, category, series, kind, pageHint, aliasHints, csvText) {
  const aliasSection = aliasHints ? `\nFIELD ALIASES — map column headers to these standard field keys when recognized (use the standard key in column_field_hints):\n${aliasHints}\n` : '';
  const source = csvText ? `\nPRICE BOOK CONTENT (CSV/text):\n\n${csvText.slice(0, 80000)}\n` : '';
  const loc = pageHint ? ` (near ${pageHint})` : '';
  return `You are extracting ONE specific pricing table from a manufacturer price book.${source}\nTARGET TABLE: "${title}"${loc} — category: ${category ?? 'unknown'}, series: ${series ?? 'n/a'}, kind: ${kind ?? 'size_grid'}.${aliasSection}\nExtract the COMPLETE grid for THIS table only (ignore other tables):\n1. column_labels: every column header left-to-right. For a flat_list or adder table with one price column, use a single column "Price".\n2. row_labels: every row top-to-bottom (sizes, or item/option names for flat_list/adder tables).\n3. cells: every priced cell as { row, col, price } using 0-based indices into row_labels/column_labels. Omit blanks. Capture EVERY row — do not stop early.\n4. column_field_hints: { col, field_key } for any column mappable to a standard field key.\n5. warnings: anything unreadable/ambiguous.\n\nReturn ONLY valid JSON. Prices are plain numbers (no $ or commas).`;
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
