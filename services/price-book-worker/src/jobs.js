// Catalog + per-table grid extraction jobs. Ported from the Supabase Edge
// Functions, but with no wall-clock limit (runs on Render).

import {
  ALLOWED_CATEGORIES,
  getMimeType,
  uploadToGeminiFiles,
  callGemini,
  recoverCells,
  recoverCatalogTables,
  buildCatalogPrompt,
  getCatalogSchema,
  buildGridPrompt,
  getGridSchema,
  loadAliasHints,
} from './gemini.js';

const CATALOG_MAX_TOKENS = 16384;
const GRID_MAX_TOKENS = 24576;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_TABLES = 200;
// Catalog enumeration is repeated until the model reports no new tables (or it
// stops being truncated). Bounded so a misbehaving model can't loop forever.
const MAX_CATALOG_ROUNDS = 10;
// Default fan-out for the background "extract all grids" job.
const EXTRACT_ALL_CONCURRENCY = 4;

const BUCKET = 'price-book-files';

async function downloadBytes(sb, path) {
  const { data: blob, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !blob) throw new Error('File download failed: ' + (error?.message || 'no data'));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Enumerate EVERY table in the book. A single Gemini pass over a large
 * multi-page PDF often truncates (unparseable JSON) or under-lists, so we:
 *   1. salvage tables from truncated responses, and
 *   2. keep asking for tables NOT already listed until the model returns
 *      nothing new (or the response is no longer truncated), bounded by
 *      MAX_CATALOG_ROUNDS / MAX_TABLES.
 * Returns { tables, vendorName, truncated } where `truncated` flags that we
 * stopped while the model was still being cut off (i.e. possibly incomplete).
 */
async function catalogAllTables(geminiKey, book, aliasHints, csvText, filePart) {
  const all = [];
  const seen = new Set();
  let vendorName = null;
  let lastTruncated = false;

  for (let round = 0; round < MAX_CATALOG_ROUNDS && all.length < MAX_TABLES; round++) {
    const excludeTitles = all.map((t) => t.title);
    const prompt = buildCatalogPrompt(book.category, aliasHints, csvText, excludeTitles);
    const { parsed, truncated, raw } = await callGemini(geminiKey, prompt, getCatalogSchema(), CATALOG_MAX_TOKENS, filePart);
    lastTruncated = truncated;

    if (vendorName == null && parsed?.vendor_name) vendorName = parsed.vendor_name;

    let tables = parsed?.tables ?? [];
    if ((!tables || tables.length === 0) && raw) tables = recoverCatalogTables(raw);
    tables = (tables || []).filter((t) => t && typeof t.title === 'string' && t.title.trim());

    let added = 0;
    for (const t of tables) {
      const key = `${t.title.trim().toLowerCase()}|${(t.page_hint ?? '').toString().trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(t);
      added++;
      if (all.length >= MAX_TABLES) break;
    }

    console.log(`[catalog] round ${round + 1}: +${added} (total ${all.length})${truncated ? ' [truncated]' : ''}`);

    // Done when the model produced nothing new AND was not cut off mid-list.
    if (added === 0 && !truncated) break;
    // Defensive: if a round adds nothing yet keeps claiming truncation, stop.
    if (added === 0) break;
  }

  return { tables: all, vendorName, truncated: lastTruncated };
}

/**
 * STEP 1 — Catalog every table/section in the book and insert one placeholder
 * extraction + pending proposal per table. Uploads the file to Gemini once and
 * stores the reference for per-table extraction.
 */
export async function runCatalog(sb, geminiKey, priceBookId) {
  try {
    const { data: book } = await sb.from('price_books').select('*').eq('id', priceBookId).single();
    if (!book) throw new Error('Price book not found');

    await sb.from('price_book_extractions').delete().eq('price_book_id', priceBookId);
    await sb.from('pricing_change_proposals').delete().eq('price_book_id', priceBookId).eq('status', 'pending');

    const aliasHints = await loadAliasHints(sb);
    const bytes = await downloadBytes(sb, book.source_file_url);
    if (bytes.length > MAX_FILE_SIZE) throw new Error('File too large: ' + (bytes.length / 1024 / 1024).toFixed(1) + ' MB (max 50 MB)');

    let filePart = null;
    let csvText = null;
    let geminiFileUri = null;
    let geminiFileName = null;
    if (book.file_type === 'csv') {
      csvText = new TextDecoder().decode(bytes);
    } else if (book.file_type === 'xlsx') {
      throw new Error('XLSX is not parsed inline yet — export the sheet to CSV or PDF and re-upload.');
    } else {
      const mimeType = getMimeType(book.original_file_name, book.file_type);
      const uploaded = await uploadToGeminiFiles(geminiKey, bytes, mimeType, book.original_file_name || 'price-book');
      geminiFileUri = uploaded.uri;
      geminiFileName = uploaded.name;
      filePart = { file_data: { mime_type: mimeType, file_uri: uploaded.uri } };
      await sb.from('price_books').update({ gemini_file_uri: geminiFileUri, gemini_file_name: geminiFileName }).eq('id', priceBookId);
    }

    const { tables, vendorName, truncated } = await catalogAllTables(geminiKey, book, aliasHints, csvText, filePart);

    // Fail loudly rather than silently degrading to a single bogus "whole book"
    // table (the old behavior that made it look like only one table existed).
    if (tables.length === 0) {
      throw new Error('Cataloging found no pricing tables. The document may be image-only/low quality or the model response was empty — retry, or re-upload a clearer PDF.');
    }

    const emptyGrid = { columnLabels: [], rowLabels: [], cells: [], columnFieldHints: {} };
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i];
      const detectedCategory = ALLOWED_CATEGORIES.includes(t.category ?? '') ? t.category : (book.category ?? null);
      const pageHint = t.page_hint ?? null;
      const { data: extraction, error: extErr } = await sb.from('price_book_extractions').insert({
        price_book_id: priceBookId, status: 'pending', title: t.title, kind: t.kind ?? null, sort_order: i,
        detected_category: detectedCategory, detected_series: t.series ?? null, detected_vendor_name: vendorName,
        page_hint: pageHint, grid: emptyGrid, warnings: [], grid_extracted: false,
      }).select('id').single();
      if (extErr || !extraction) { console.error('[catalog] extraction insert failed:', extErr); continue; }
      await sb.from('pricing_change_proposals').insert({
        proposal_type: 'table', source: 'ingestion', price_book_id: priceBookId, target_ids: { extractionId: extraction.id },
        payload: { title: t.title, kind: t.kind ?? null, detectedCategory, detectedSeries: t.series ?? null, detectedVendorName: vendorName, pageHint },
        confidence: 0.5, explanation: `"${t.title}" detected${pageHint ? ` (${pageHint})` : ''}. Extract its grid, then map to approve.`, status: 'pending',
      });
    }

    // Surface a soft warning when enumeration may have been cut off so the user
    // knows to re-run if a category looks incomplete.
    const ocrError = truncated ? `Cataloged ${tables.length} tables, but the index may be incomplete (hit the table cap or output limit). Re-run if a section is missing.` : null;
    await sb.from('price_books').update({ ocr_status: 'done', ocr_error: ocrError, extracted_at: new Date().toISOString(), gemini_file_uri: geminiFileUri, gemini_file_name: geminiFileName }).eq('id', priceBookId);
    console.log(`[catalog] Cataloged ${tables.length} table(s) for ${priceBookId}${truncated ? ' (possibly incomplete)' : ''}`);
    return { tableCount: tables.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[catalog] error for ' + priceBookId + ':', message);
    await sb.from('price_books').update({ ocr_status: 'error', ocr_error: message }).eq('id', priceBookId);
    throw err;
  }
}

/**
 * STEP 2 (bulk) — Extract EVERY not-yet-pulled grid for a book in the
 * background with bounded concurrency, recording progress on the price_books
 * row (`extract_status`/`extract_total`/`extract_done`/`extract_failed`) so the
 * frontend can poll instead of holding the browser open. Per-table failures are
 * tolerated (counted, left un-extracted) so the run always completes; re-running
 * only picks up whatever is still pending.
 */
export async function runExtractAll(sb, geminiKey, priceBookId, { concurrency = EXTRACT_ALL_CONCURRENCY } = {}) {
  try {
    const { data: pendingRows, error } = await sb
      .from('price_book_extractions')
      .select('id')
      .eq('price_book_id', priceBookId)
      .eq('status', 'pending')
      .eq('grid_extracted', false)
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (pendingRows || []).map((r) => r.id);
    await sb.from('price_books').update({
      extract_status: 'processing', extract_total: ids.length, extract_done: 0, extract_failed: 0, extract_error: null,
    }).eq('id', priceBookId);

    if (ids.length === 0) {
      await sb.from('price_books').update({ extract_status: 'done' }).eq('id', priceBookId);
      return { total: 0, done: 0, failed: 0 };
    }

    let done = 0;
    let failed = 0;
    let next = 0;

    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= ids.length) return;
        try {
          await runExtractTable(sb, geminiKey, ids[i]);
          done++;
        } catch (e) {
          failed++;
          console.error(`[extract-all] table ${ids[i]} failed:`, e instanceof Error ? e.message : e);
        }
        // Best-effort progress ping after each table (races are harmless here).
        await sb.from('price_books').update({ extract_done: done, extract_failed: failed }).eq('id', priceBookId);
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));

    await sb.from('price_books').update({ extract_status: 'done', extract_done: done, extract_failed: failed }).eq('id', priceBookId);
    console.log(`[extract-all] ${priceBookId}: ${done} ok, ${failed} failed of ${ids.length}`);
    return { total: ids.length, done, failed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[extract-all] fatal for ' + priceBookId + ':', message);
    await sb.from('price_books').update({ extract_status: 'error', extract_error: message }).eq('id', priceBookId);
    throw err;
  }
}

/** STEP 2 — Extract one table's full grid and fill its extraction row. */
export async function runExtractTable(sb, geminiKey, extractionId) {
  const { data: ext, error: extErr } = await sb.from('price_book_extractions').select('*').eq('id', extractionId).single();
  if (extErr || !ext) throw new Error('Extraction not found');
  const { data: book, error: bookErr } = await sb.from('price_books').select('*').eq('id', ext.price_book_id).single();
  if (bookErr || !book) throw new Error('Price book not found');

  const aliasHints = await loadAliasHints(sb);
  const mimeType = getMimeType(book.original_file_name, book.file_type);

  let csvText = null;
  let filePart = null;
  if (book.file_type === 'csv') {
    csvText = new TextDecoder().decode(await downloadBytes(sb, book.source_file_url));
  } else if (book.gemini_file_uri) {
    filePart = { file_data: { mime_type: mimeType, file_uri: book.gemini_file_uri } };
  } else {
    const bytes = await downloadBytes(sb, book.source_file_url);
    const up = await uploadToGeminiFiles(geminiKey, bytes, mimeType, book.original_file_name || 'price-book');
    filePart = { file_data: { mime_type: mimeType, file_uri: up.uri } };
    await sb.from('price_books').update({ gemini_file_uri: up.uri, gemini_file_name: up.name }).eq('id', book.id);
  }

  const prompt = buildGridPrompt(ext.title ?? book.name, ext.detected_category, ext.detected_series, ext.kind, ext.page_hint ?? null, aliasHints, csvText);

  let res;
  try {
    res = await callGemini(geminiKey, prompt, getGridSchema(), GRID_MAX_TOKENS, filePart);
  } catch (e) {
    // Gemini Files reference may have expired (48h) — re-upload and retry once.
    if (filePart && book.file_type !== 'csv' && [400, 403, 404].includes(e.status)) {
      const bytes = await downloadBytes(sb, book.source_file_url);
      const up = await uploadToGeminiFiles(geminiKey, bytes, mimeType, book.original_file_name || 'price-book');
      await sb.from('price_books').update({ gemini_file_uri: up.uri, gemini_file_name: up.name }).eq('id', book.id);
      filePart = { file_data: { mime_type: mimeType, file_uri: up.uri } };
      res = await callGemini(geminiKey, prompt, getGridSchema(), GRID_MAX_TOKENS, filePart);
    } else {
      throw e;
    }
  }

  const warnings = [];
  let grid = res.parsed;
  if (!grid && res.truncated) {
    const cells = recoverCells(res.raw);
    if (cells.length) { grid = { column_labels: ['Price'], row_labels: [], cells }; warnings.push('Response truncated; recovered cells partially — verify labels.'); }
  }
  if (!grid) warnings.push('Could not parse the grid for this table.');

  const colHints = {};
  for (const h of grid?.column_field_hints ?? []) colHints[h.col] = h.field_key;
  const normalizedGrid = { columnLabels: grid?.column_labels ?? [], rowLabels: grid?.row_labels ?? [], cells: (grid?.cells ?? []).filter((c) => c.price != null), columnFieldHints: colHints };
  const allWarnings = [...warnings, ...(grid?.warnings ?? [])];

  await sb.from('price_book_extractions').update({ grid: normalizedGrid, warnings: allWarnings, grid_extracted: true }).eq('id', extractionId);

  const { data: props } = await sb.from('pricing_change_proposals').select('id').eq('price_book_id', book.id).contains('target_ids', { extractionId }).limit(1);
  if (props && props[0]) {
    await sb.from('pricing_change_proposals').update({
      payload: { title: ext.title, kind: ext.kind, detectedCategory: ext.detected_category, detectedSeries: ext.detected_series, detectedVendorName: ext.detected_vendor_name, rowCount: normalizedGrid.rowLabels.length, colCount: normalizedGrid.columnLabels.length, cellCount: normalizedGrid.cells.length },
      confidence: allWarnings.length === 0 ? 0.9 : 0.5,
      explanation: `"${ext.title}": ${normalizedGrid.rowLabels.length}×${normalizedGrid.columnLabels.length} grid (${normalizedGrid.cells.length} prices). Map to approve.`,
    }).eq('id', props[0].id);
  }

  return { rowCount: normalizedGrid.rowLabels.length, colCount: normalizedGrid.columnLabels.length, cellCount: normalizedGrid.cells.length, warnings: allWarnings.length };
}
