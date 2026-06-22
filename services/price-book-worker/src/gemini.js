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
      if (
        typeof o.row === 'number' &&
        typeof o.col === 'number' &&
        (typeof o.price === 'number' || typeof o.raw_value === 'string')
      ) {
        cells.push(o);
      }
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

/**
 * Build the catalog prompt for a PDF/image file (unchanged path — Gemini reads numbers).
 * For spreadsheets use buildSpreadsheetCatalogPrompt instead.
 */
export function buildCatalogPrompt(categoryHint, aliasHints, csvText, excludeTitles = [], profileChecklist = '') {
  const aliasSection = aliasHints ? `\nKNOWN FIELD ALIASES (context):\n${aliasHints}\n` : '';
  const catSection = categoryHint ? `\nThe user expects this book to be primarily "${categoryHint}", but it WILL contain other categories too (frames, hardware, adders). Include them all.` : '';
  const source = csvText ? `\nPRICE BOOK CONTENT (CSV/text):\n\n${csvText.slice(0, 80000)}\n` : '';
  const profileSection = profileChecklist ? `\nSOURCE PROFILE COVERAGE CHECKLIST:\n${profileChecklist}\n` : '';
  const excludeSection = excludeTitles.length
    ? `\nALREADY-LISTED TABLE LOCATIONS (do NOT repeat the same title AT THE SAME LOCATION; the same printed heading on another physical page is a distinct entry and must still be listed):\n${excludeTitles.map((t) => `- ${t}`).join('\n')}\n`
    : '';
  return `You are cataloging a manufacturer price book for commercial doors, frames, hardware, glass/lites, and panels.${catSection}${aliasSection}${profileSection}${source}${excludeSection}
Build a COMPLETE index of EVERY distinct pricing table or priced section in this document, from the FIRST page to the LAST.

How to be exhaustive:
1. First read the document's table of contents / index (if present) to learn how many sections there are (e.g. "Door Pricing", "Frame Pricing", "Hardware", "Adders/Options").
2. Then page through the ENTIRE document in order. A real book has MANY tables: every door series has its own size grid (and often header/transom/louver/glass add tables), every frame series has its own grid, plus standalone hardware lists and MANY option/adder/surcharge tables (e.g. "add for fire label", "add for header", finish upcharges, oversize upcharges, prep charges).
3. Treat each size grid, each flat price list, and each adder/surcharge table as a SEPARATE entry — never merge two printed tables into one.
   IMPORTANT: A single PDF page titled "Additional Preparations (Adders)" often contains MULTIPLE sub-sections (e.g. one section for astragals, a separate section for lock types, another for hinges, another for undercuts). These are DISTINCT adder groups — list each sub-section as its own entry. Use the section heading as the title (e.g. "H Series - Astragal Adders", "H Series - Lock Prep Adders", "H Series - Hinge Adders").
   Small independently priced blocks beside a larger matrix count too. Examples include "Door Construction", "Material Type", "Door Thickness", "Seamless", handing/opening configuration, cutout-only charges, and N/C option lists. If a block has only a short local heading, synthesize a precise title from the parent series plus that heading (for example "H Series - Material Type").
   A block containing N/C plus one or more priced alternatives is a pricing table and MUST be cataloged even if it has only two rows.
   Repeated headings on consecutive pages (for example "Door and Frame Preparation Charges") are NOT duplicates when the physical page differs. List every priced page/sub-table separately with its physical PDF page.
4. Do NOT stop after the first few. Err on the side of MORE entries.

For EACH table/section return:
- title: the heading exactly as printed (make it specific enough to find again, e.g. "FS Series Door Pricing", not just "Pricing").
- category: one of doors|frames|hardware|lites_louvers_glass|panels|other.
- series: the product line/series name, or null.
- kind: size_grid (rows=sizes, cols=options) | flat_list (item -> price) | adder (surcharge/upcharge).
- page_hint: the PHYSICAL PDF page index shown by the PDF viewer, where the cover is page 1 (e.g. "PDF p. 15" or "PDF pp. 15-16"). Do not use a printed section label such as "R-2", "D-4", or "S-10" by itself. REQUIRED.
- description: <= 12 words. Keep it short to leave room for more tables.

Do NOT extract any prices yet. Include vendor_name if shown. Return ONLY valid JSON matching the schema.`;
}

/**
 * Build the catalog prompt for a spreadsheet (XLSX/CSV).
 *
 * For spreadsheets the AI does NOT read prices — SheetJS already has them.
 * The AI's only job is to identify which sheet + row/column ranges form each
 * pricing table and classify them, so we can map sheet indices to the
 * extraction grid deterministically.
 *
 * @param {string} categoryHint
 * @param {string} aliasHints
 * @param {{ name: string, preview: string }[]} sheets
 * @param {string[]} excludeTitles
 */
export function buildSpreadsheetCatalogPrompt(categoryHint, aliasHints, sheets, excludeTitles = []) {
  const aliasSection = aliasHints ? `\nKNOWN FIELD ALIASES (context):\n${aliasHints}\n` : '';
  const catSection = categoryHint ? `\nThe user expects this book to be primarily "${categoryHint}", but it WILL contain other categories too.` : '';
  const sheetSection = sheets.map((s, i) => `--- Sheet ${i} (name: "${s.name}") ---\n${s.preview.slice(0, 4000)}`).join('\n\n');
  const excludeSection = excludeTitles.length
    ? `\nALREADY-LISTED TABLES (do NOT repeat):\n${excludeTitles.map((t) => `- ${t}`).join('\n')}\n`
    : '';

  return `You are cataloging a manufacturer price book spreadsheet for commercial doors, frames, hardware, glass/lites, and panels.${catSection}${aliasSection}

SPREADSHEET SHEETS (TSV preview of each sheet's first 50 rows):
${sheetSection}
${excludeSection}
Identify EVERY distinct pricing table in the spreadsheet. A table is a contiguous block with header labels in one row and prices in subsequent rows.

For EACH table return:
- title: a descriptive name (e.g. "Lockseam Steel Door Pricing").
- category: one of doors|frames|hardware|lites_louvers_glass|panels|other.
- series: the product line/series name, or null.
- kind: size_grid | flat_list | adder.
- page_hint: the sheet name and approximate start row (e.g. "Sheet 'Doors', row 3").
- sheet_index: 0-based index into the sheets array above.
- header_row: 0-based row index of the column headers within the sheet's data rows.
- data_start_row: 0-based row index of the first data row (immediately after headers).
- data_end_row: 0-based row index of the last data row (inclusive), or null if unknown.
- price_col_indices: list of 0-based column indices that contain prices.
- label_col_index: 0-based column index of the row label (e.g. door size). Use -1 if none.
- description: <= 12 words.

Do NOT extract any prices. Return ONLY valid JSON matching the schema.`;
}

/**
 * JSON schema for the spreadsheet catalog response (extends the base schema).
 */
export function getSpreadsheetCatalogSchema() {
  return {
    type: 'object',
    properties: {
      vendor_name: { type: 'string' },
      tables: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            category: { type: 'string' },
            series: { type: 'string' },
            kind: { type: 'string' },
            page_hint: { type: 'string' },
            sheet_index: { type: 'integer' },
            header_row: { type: 'integer' },
            data_start_row: { type: 'integer' },
            data_end_row: { type: 'integer' },
            price_col_indices: { type: 'array', items: { type: 'integer' } },
            label_col_index: { type: 'integer' },
            description: { type: 'string' },
          },
          required: ['title', 'sheet_index'],
        },
      },
    },
    required: ['tables'],
  };
}

/**
 * Build the grid extraction prompt for a spreadsheet table.
 * The AI's job here is only to validate/confirm the column labels and row labels
 * identified during catalog — no price reading.
 */
export function buildSpreadsheetGridPrompt(title, sheetName, headerRow, dataStartRow, dataEndRow, priceCols, labelCol, sheetPreview) {
  return `You are confirming the column and row structure for one pricing table in a spreadsheet.

TABLE: "${title}" in sheet "${sheetName}"
Header row index: ${headerRow}
Data rows: ${dataStartRow}–${dataEndRow ?? 'end'}
Price column indices: ${JSON.stringify(priceCols)}
Label column index: ${labelCol}

SHEET PREVIEW (TSV, first 80 rows):
${sheetPreview.slice(0, 6000)}

Confirm:
1. column_labels: the text of each price column header (in the same order as price_col_indices).
2. row_labels: the text of the label column for each data row (in order).
3. warnings: any issues (merged cells, blank rows in middle, etc.).

Do NOT extract prices — they will be read from the raw data. Return ONLY valid JSON.`;
}

export function getSpreadsheetGridSchema() {
  return {
    type: 'object',
    properties: {
      column_labels: { type: 'array', items: { type: 'string' } },
      row_labels: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['column_labels', 'row_labels'],
  };
}

export function getCatalogSchema() {
  return { type: 'object', properties: { vendor_name: { type: 'string' }, tables: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, category: { type: 'string' }, series: { type: 'string' }, kind: { type: 'string' }, page_hint: { type: 'string' }, description: { type: 'string' } }, required: ['title'] } } }, required: ['tables'] };
}

/**
 * Build the grid extraction prompt for a PDF/image table.
 *
 * @param {string} title
 * @param {string|null} category
 * @param {string|null} series
 * @param {string|null} kind
 * @param {string|null} pageHint
 * @param {string} aliasHints
 * @param {string|null} csvText
 * @param {{ field_key: string, field_label: string, description: string|null }[]} [fieldDefs]
 *   When provided (for adder tables), Gemini will try to match each row to a field key.
 */
export function buildGridPrompt(title, category, series, kind, pageHint, aliasHints, csvText, fieldDefs = [], sourceWindow = null) {
  const aliasSection = aliasHints ? `\nFIELD ALIASES — map column headers to these standard field keys when recognized (use the standard key in column_field_hints):\n${aliasHints}\n` : '';
  const source = csvText ? `\nPRICE BOOK CONTENT (CSV/text):\n\n${csvText.slice(0, 80000)}\n` : '';
  const loc = pageHint ? ` located at source ${pageHint}` : '';
  const isAdder = kind === 'adder' || kind === 'flat_list';

  // For adder tables, append the known field list so Gemini can auto-classify rows
  const fieldHintSection = isAdder && fieldDefs.length > 0
    ? `\nKNOWN ITEM FIELDS — for each row, suggest the field_key that best describes what option it represents. Use the exact field_key from this list, or null if none fit:\n${fieldDefs.map((f) => `- ${f.field_key}: "${f.field_label}"${f.description ? ` (${f.description})` : ''}`).join('\n')}\n`
    : '';

  const rowHintInstruction = isAdder && fieldDefs.length > 0
    ? `6. row_field_hints: for each adder/option row, your best guess at the field_key it belongs to (from the KNOWN ITEM FIELDS list above). Use { row, field_key } pairs. Omit the row if you are unsure — do NOT guess randomly; only include confident matches.`
    : '';
  const locationInstruction = sourceWindow
    ? `The uploaded PDF is a cropped window containing SOURCE physical pages ${sourceWindow.start}-${sourceWindow.end}; its local viewer numbering restarts at 1. Find "${title}" by its printed heading inside this window rather than trying to navigate to local page ${pageHint}.`
    : pageHint
      ? `Go to source ${pageHint} and find the table titled "${title}".`
      : `Find the table titled "${title}".`;

  return `You are extracting ONE specific pricing table from a manufacturer price book.${source}
TARGET TABLE: "${title}"${loc} — category: ${category ?? 'unknown'}, series: ${series ?? 'n/a'}, kind: ${kind ?? 'size_grid'}.${aliasSection}${fieldHintSection}
${locationInstruction} Extract the COMPLETE grid for THIS table ONLY. Do NOT merge in rows or columns from any other table, and do NOT extract a different table even if it looks similar.

1. column_labels: every column header left-to-right, exactly as printed. For a flat_list or adder table that has a single price column, use one column labeled "Price".
2. row_labels: every row top-to-bottom (sizes like "3'0\" x 7'0\"" for grids, or item/option names for flat_list/adder tables). Preserve the printed order and the exact size formatting.
3. cells: every NON-BLANK value cell as { row, col, raw_value, price? } using 0-based indices into row_labels/column_labels.
   - raw_value is REQUIRED and must preserve the printed text exactly (examples: "$733", "N/C", "N/A", "CF", "Included", "Add 25%").
   - price is present only when the cell is a numeric money amount. Do not invent 0 for N/C, N/A, CF, Included, or blank cells.
   - If a printed Width, Height, Size, or other dimension cell is vertically merged across multiple rows, repeat that merged raw_value for EVERY row it spans. This is structural evidence, not an invented value.
   - Omit truly blank/empty cells. Capture EVERY value across ALL rows and ALL columns — do not stop early or sample.
4. column_field_hints: { col, field_key } for any column mappable to a standard field key.
5. warnings: note anything unreadable, ambiguous, or any prices that appear to continue onto another page.
${rowHintInstruction}

If the table spans multiple pages, include the continuation rows too. Return ONLY valid JSON. Numeric prices are plain numbers; raw_value keeps the source text.`;
}

export function getGridSchema() {
  return {
    type: 'object',
    properties: {
      column_labels: { type: 'array', items: { type: 'string' } },
      row_labels: { type: 'array', items: { type: 'string' } },
      cells: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            row: { type: 'integer' },
            col: { type: 'integer' },
            raw_value: { type: 'string' },
            price: { type: 'number' },
          },
          required: ['row', 'col', 'raw_value'],
        },
      },
      column_field_hints: { type: 'array', items: { type: 'object', properties: { col: { type: 'integer' }, field_key: { type: 'string' } }, required: ['col', 'field_key'] } },
      row_field_hints: { type: 'array', items: { type: 'object', properties: { row: { type: 'integer' }, field_key: { type: 'string' } }, required: ['row', 'field_key'] } },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['column_labels', 'row_labels', 'cells'],
  };
}

/**
 * Loads all approved field definitions from the DB for use as adder-row hints.
 * Returns a compact list with just what Gemini needs to classify rows.
 */
export async function loadFieldDefs(sb) {
  const { data } = await sb
    .from('field_definitions')
    .select('field_key, field_label, description')
    .eq('status', 'approved')
    .order('field_key', { ascending: true });
  return (data || []).map((r) => ({
    field_key: r.field_key,
    field_label: r.field_label,
    description: r.description ?? null,
  }));
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
