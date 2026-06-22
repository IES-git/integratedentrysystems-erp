// Catalog + per-table grid extraction jobs. Ported from the Supabase Edge
// Functions, but with no wall-clock limit (runs on Render).

import { createHash } from 'node:crypto';
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
  loadFieldDefs,
  buildSpreadsheetCatalogPrompt,
  getSpreadsheetCatalogSchema,
  buildSpreadsheetGridPrompt,
  getSpreadsheetGridSchema,
} from './gemini.js';
import { parseSpreadsheet, extractGridFromSheet } from './spreadsheet.js';
import { interpretGridCell, normalizeToken } from './normalize.js';
import { getPdfPageCount, slicePdfToPageHint } from './pdf.js';
import {
  buildProfileCatalogChecklist,
  evaluateCatalogProfileCoverage,
  identifyPriceBookProfile,
} from './profiles.js';

/** True when the file is a spreadsheet (handled by SheetJS instead of Gemini vision). */
function isSpreadsheet(fileType) {
  return fileType === 'xlsx' || fileType === 'csv';
}

const CATALOG_MAX_TOKENS = 16384;
const GRID_MAX_TOKENS = 24576;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_TABLES = 500;
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
async function catalogAllTables(geminiKey, book, aliasHints, csvText, filePart, profile = null) {
  const all = [];
  const seen = new Set();
  let vendorName = null;
  let lastTruncated = false;
  let roundsUsed = 0;
  let reachedNaturalStop = false;

  for (let round = 0; round < MAX_CATALOG_ROUNDS && all.length < MAX_TABLES; round++) {
    roundsUsed = round + 1;
    const excludeTitles = all.map((t) => `${t.title} @ ${t.page_hint ?? 'unknown page'}`);
    const prompt = buildCatalogPrompt(
      book.category,
      aliasHints,
      csvText,
      excludeTitles,
      buildProfileCatalogChecklist(profile),
    );
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
    if (added === 0 && !truncated) {
      reachedNaturalStop = true;
      break;
    }
    // Defensive: if a round adds nothing yet keeps claiming truncation, stop.
    if (added === 0) break;
  }

  const hitTableCap = all.length >= MAX_TABLES;
  const exhaustedRounds = !reachedNaturalStop && roundsUsed >= MAX_CATALOG_ROUNDS && all.length < MAX_TABLES;
  return {
    tables: all,
    vendorName,
    truncated: lastTruncated || hitTableCap || exhaustedRounds,
    hitTableCap,
    exhaustedRounds,
    roundsUsed,
  };
}

/**
 * Catalog all pricing tables in a spreadsheet using the SheetJS-first path.
 * Gemini classifies tables by sheet structure; prices are never passed to Gemini.
 */
async function catalogAllSpreadsheetTables(geminiKey, book, aliasHints, parsedSheets) {
  const all = [];
  const seen = new Set();
  let vendorName = null;

  for (let round = 0; round < MAX_CATALOG_ROUNDS && all.length < MAX_TABLES; round++) {
    const excludeTitles = all.map((t) =>
      `${t.title} @ sheet ${t._spreadsheet_meta?.sheetIndex ?? t.sheet_index ?? 0}`);
    const prompt = buildSpreadsheetCatalogPrompt(book.category, aliasHints, parsedSheets, excludeTitles);
    const { parsed, truncated, raw } = await callGemini(geminiKey, prompt, getSpreadsheetCatalogSchema(), CATALOG_MAX_TOKENS, null);

    if (vendorName == null && parsed?.vendor_name) vendorName = parsed.vendor_name;

    let tables = parsed?.tables ?? [];
    if ((!tables || tables.length === 0) && raw) tables = recoverCatalogTables(raw);
    tables = (tables || []).filter((t) => t && typeof t.title === 'string' && t.title.trim());

    let added = 0;
    for (const t of tables) {
      const key = `${t.title.trim().toLowerCase()}|${(t.sheet_index ?? 0)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Attach sheet metadata so extraction can use it
      t._spreadsheet_meta = {
        sheetIndex: t.sheet_index ?? 0,
        headerRow: t.header_row ?? 0,
        dataStartRow: t.data_start_row ?? 1,
        dataEndRow: t.data_end_row ?? null,
        priceColIndices: t.price_col_indices ?? [],
        labelColIndex: t.label_col_index ?? -1,
      };
      all.push(t);
      added++;
      if (all.length >= MAX_TABLES) break;
    }

    console.log(`[catalog-spreadsheet] round ${round + 1}: +${added} (total ${all.length})`);
    if (added === 0) break;
  }

  return { tables: all, vendorName, truncated: false };
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
    const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    const profile = identifyPriceBookProfile({
      sha256: sourceSha256,
      fileName: book.original_file_name,
      title: book.name,
    });
    const sourcePageCount = book.file_type === 'pdf'
      ? await getPdfPageCount(bytes)
      : null;
    await sb.from('price_books').update({
      source_sha256: sourceSha256,
      source_page_count: sourcePageCount,
      ingestion_profile_key: profile?.key ?? null,
      ingestion_profile_version: profile?.version ?? null,
    }).eq('id', priceBookId);

    let filePart = null;
    let geminiFileUri = null;
    let geminiFileName = null;
    let parsedSheets = null; // Set when file is a spreadsheet

    if (isSpreadsheet(book.file_type)) {
      // SheetJS path: parse deterministically, use Gemini only for classification
      parsedSheets = parseSpreadsheet(bytes, book.file_type);
      if (!parsedSheets || parsedSheets.length === 0) {
        throw new Error('Could not parse any sheets from the spreadsheet. Ensure the file is a valid XLSX or CSV and re-upload.');
      }
    } else {
      const mimeType = getMimeType(book.original_file_name, book.file_type);
      const uploaded = await uploadToGeminiFiles(geminiKey, bytes, mimeType, book.original_file_name || 'price-book');
      geminiFileUri = uploaded.uri;
      geminiFileName = uploaded.name;
      filePart = { file_data: { mime_type: mimeType, file_uri: uploaded.uri } };
      await sb.from('price_books').update({ gemini_file_uri: geminiFileUri, gemini_file_name: geminiFileName }).eq('id', priceBookId);
    }

    const catalog = parsedSheets
      ? await catalogAllSpreadsheetTables(geminiKey, book, aliasHints, parsedSheets)
      : await catalogAllTables(geminiKey, book, aliasHints, null, filePart, profile);
    const {
      tables, vendorName, truncated,
      hitTableCap = false,
      exhaustedRounds = false,
      roundsUsed = 1,
    } = catalog;

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
      const spreadsheetMeta = t._spreadsheet_meta ?? null;
      const { data: extraction, error: extErr } = await sb.from('price_book_extractions').insert({
        price_book_id: priceBookId, status: 'pending', title: t.title, kind: t.kind ?? null, sort_order: i,
        detected_category: detectedCategory, detected_series: t.series ?? null, detected_vendor_name: vendorName,
        page_hint: pageHint, grid: emptyGrid, warnings: [], grid_extracted: false,
        // Store spreadsheet mapping metadata for deterministic grid extraction
        ...(spreadsheetMeta ? { spreadsheet_meta: spreadsheetMeta } : {}),
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
    const profileCoverage = evaluateCatalogProfileCoverage(profile, tables);
    const enumerationComplete = !hitTableCap && !exhaustedRounds && !truncated;
    const coverage = {
      ...profileCoverage,
      passed: profileCoverage.passed && enumerationComplete,
      enumeration: {
        complete: enumerationComplete,
        roundsUsed,
        hitTableCap,
        exhaustedRounds,
        responseTruncated: truncated && !hitTableCap && !exhaustedRounds,
      },
      issues: [
        ...profileCoverage.issues,
        hitTableCap ? `Catalog hit the hard cap of ${MAX_TABLES} entries.` : null,
        exhaustedRounds ? `Catalog still found new entries after ${MAX_CATALOG_ROUNDS} enumeration rounds.` : null,
      ].filter(Boolean),
    };
    const warnings = [
      !enumerationComplete ? `Cataloged ${tables.length} tables, but enumeration did not reach a proven stopping point.` : null,
      !coverage.passed ? coverage.issues.join(' ') : null,
    ].filter(Boolean);
    const ocrError = warnings.length > 0 ? warnings.join(' ') : null;
    await sb.from('price_books').update({
      ocr_status: 'done',
      ocr_error: ocrError,
      extracted_at: new Date().toISOString(),
      gemini_file_uri: geminiFileUri,
      gemini_file_name: geminiFileName,
      source_sha256: sourceSha256,
      source_page_count: sourcePageCount,
      ingestion_profile_key: profile?.key ?? null,
      ingestion_profile_version: profile?.version ?? null,
      ingestion_coverage: coverage,
    }).eq('id', priceBookId);
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

  // For adder/flat-list tables, load field definitions so Gemini can auto-classify rows
  const isAdderKind = ext.kind === 'adder' || ext.kind === 'flat_list';
  const fieldDefs = isAdderKind ? await loadFieldDefs(sb) : [];

  // ---------------------------------------------------------------------------
  // SheetJS path: spreadsheet files with stored sheet metadata
  // ---------------------------------------------------------------------------
  if (isSpreadsheet(book.file_type) && ext.spreadsheet_meta) {
    const meta = ext.spreadsheet_meta;
    const bytes = await downloadBytes(sb, book.source_file_url);
    const parsedSheets = parseSpreadsheet(bytes, book.file_type);
    const sheet = parsedSheets[meta.sheetIndex];
    if (!sheet) throw new Error(`Sheet index ${meta.sheetIndex} not found in spreadsheet`);

    const warnings = [];

    // Ask Gemini to confirm/correct column and row labels (no prices)
    let columnLabels = [];
    let rowLabels = [];
    try {
      const prompt = buildSpreadsheetGridPrompt(
        ext.title ?? book.name,
        sheet.name,
        meta.headerRow,
        meta.dataStartRow,
        meta.dataEndRow,
        meta.priceColIndices,
        meta.labelColIndex,
        sheet.preview,
      );
      const { parsed } = await callGemini(geminiKey, prompt, getSpreadsheetGridSchema(), GRID_MAX_TOKENS, null);
      columnLabels = parsed?.column_labels ?? [];
      rowLabels = parsed?.row_labels ?? [];
      if (parsed?.warnings?.length) warnings.push(...parsed.warnings);
    } catch (e) {
      warnings.push(`Label confirmation failed: ${e.message} — using raw header/row labels.`);
    }

    // Determine row range
    const dataStart = meta.dataStartRow;
    const dataEnd = meta.dataEndRow != null ? meta.dataEndRow + 1 : sheet.rows.length;
    const dataRows = sheet.rows.slice(dataStart, dataEnd);

    // Fall back to raw labels when AI confirmation failed
    if (columnLabels.length === 0) {
      columnLabels = meta.priceColIndices.map((i) => sheet.headers[i] ?? String(i));
    }
    if (rowLabels.length === 0) {
      rowLabels = dataRows.map((r, ri) => {
        const lc = meta.labelColIndex;
        const v = lc >= 0 ? r[lc] : null;
        return v != null ? String(v) : String(dataStart + ri);
      });
    }

    // Read prices from SheetJS data (deterministic — no Gemini for numbers)
    const cells = [];
    for (let ri = 0; ri < dataRows.length; ri++) {
      const row = dataRows[ri];
      for (let ci = 0; ci < meta.priceColIndices.length; ci++) {
        const raw = row[meta.priceColIndices[ci]];
        const interpreted = interpretGridCell(raw);
        if (interpreted) cells.push({ row: ri, col: ci, ...interpreted });
      }
    }

    // Trim labels to match data length
    const effectiveRowCount = dataRows.length;
    const trimmedRowLabels = rowLabels.slice(0, effectiveRowCount);
    const normalizedGrid = { columnLabels, rowLabels: trimmedRowLabels, cells, columnFieldHints: {} };
    const priceCellCount = cells.filter((c) => c.price != null).length;
    const statusCellCount = cells.filter((c) => normalizeToken(c.rawValue)?.kind === 'status').length;

    await sb.from('price_book_extractions').update({ grid: normalizedGrid, warnings, grid_extracted: true }).eq('id', extractionId);
    const { data: props } = await sb.from('pricing_change_proposals').select('id').eq('price_book_id', book.id).contains('target_ids', { extractionId }).limit(1);
    if (props && props[0]) {
      await sb.from('pricing_change_proposals').update({
        payload: {
          title: ext.title,
          kind: ext.kind,
          detectedCategory: ext.detected_category,
          detectedSeries: ext.detected_series,
          detectedVendorName: ext.detected_vendor_name,
          rowCount: trimmedRowLabels.length,
          colCount: columnLabels.length,
          cellCount: cells.length,
          priceCellCount,
          statusCellCount,
        },
        confidence: warnings.length === 0 ? 0.95 : 0.7,
        explanation: `"${ext.title}": ${trimmedRowLabels.length}×${columnLabels.length} grid (${priceCellCount} prices, ${statusCellCount} status cells, SheetJS). Map to approve.`,
      }).eq('id', props[0].id);
    }
    return {
      rowCount: trimmedRowLabels.length,
      colCount: columnLabels.length,
      cellCount: cells.length,
      priceCellCount,
      statusCellCount,
      warnings: warnings.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Gemini vision path: PDF/image
  // ---------------------------------------------------------------------------
  const mimeType = getMimeType(book.original_file_name, book.file_type);
  let filePart = null;
  let scopedUpload = null;
  if (mimeType === 'application/pdf' && ext.page_hint) {
    const sourceBytes = await downloadBytes(sb, book.source_file_url);
    const window = await slicePdfToPageHint(sourceBytes, ext.page_hint);
    if (window) {
      const baseName = String(book.original_file_name || 'price-book').replace(/\.pdf$/i, '');
      const displayName = `${baseName}-pages-${window.sourceStartPage}-${window.sourceEndPage}.pdf`;
      const up = await uploadToGeminiFiles(geminiKey, window.bytes, mimeType, displayName);
      filePart = { file_data: { mime_type: mimeType, file_uri: up.uri } };
      scopedUpload = {
        bytes: window.bytes,
        displayName,
        sourceStartPage: window.sourceStartPage,
        sourceEndPage: window.sourceEndPage,
      };
    }
  }
  if (!filePart && book.gemini_file_uri) {
    filePart = { file_data: { mime_type: mimeType, file_uri: book.gemini_file_uri } };
  } else if (!filePart) {
    const bytes = await downloadBytes(sb, book.source_file_url);
    const up = await uploadToGeminiFiles(geminiKey, bytes, mimeType, book.original_file_name || 'price-book');
    filePart = { file_data: { mime_type: mimeType, file_uri: up.uri } };
    await sb.from('price_books').update({ gemini_file_uri: up.uri, gemini_file_name: up.name }).eq('id', book.id);
  }

  const prompt = buildGridPrompt(
    ext.title ?? book.name,
    ext.detected_category,
    ext.detected_series,
    ext.kind,
    ext.page_hint ?? null,
    aliasHints,
    null,
    fieldDefs,
    scopedUpload ? { start: scopedUpload.sourceStartPage, end: scopedUpload.sourceEndPage } : null,
  );

  let res;
  try {
    res = await callGemini(geminiKey, prompt, getGridSchema(), GRID_MAX_TOKENS, filePart);
  } catch (e) {
    // Gemini Files reference may have expired (48h) — re-upload and retry once.
    if (filePart && [400, 403, 404].includes(e.status)) {
      const bytes = scopedUpload?.bytes ?? await downloadBytes(sb, book.source_file_url);
      const displayName = scopedUpload?.displayName ?? book.original_file_name ?? 'price-book';
      const up = await uploadToGeminiFiles(geminiKey, bytes, mimeType, displayName);
      if (!scopedUpload) {
        await sb.from('price_books').update({ gemini_file_uri: up.uri, gemini_file_name: up.name }).eq('id', book.id);
      }
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
  // row_field_hints: Gemini's best-guess field_key per row index (adder tables only)
  const rowHints = {};
  for (const h of grid?.row_field_hints ?? []) rowHints[h.row] = h.field_key;
  const normalizedGrid = {
    columnLabels: grid?.column_labels ?? [],
    rowLabels: grid?.row_labels ?? [],
    cells: (grid?.cells ?? []).flatMap((c) => {
      const interpreted = interpretGridCell(c.raw_value, c.price);
      return interpreted ? [{ row: c.row, col: c.col, ...interpreted }] : [];
    }),
    columnFieldHints: colHints,
    rowFieldHints: Object.keys(rowHints).length > 0 ? rowHints : undefined,
  };
  const allWarnings = [...warnings, ...(grid?.warnings ?? [])];
  const priceCellCount = normalizedGrid.cells.filter((c) => c.price != null).length;
  const statusCellCount = normalizedGrid.cells.filter((c) => normalizeToken(c.rawValue)?.kind === 'status').length;

  await sb.from('price_book_extractions').update({ grid: normalizedGrid, warnings: allWarnings, grid_extracted: true }).eq('id', extractionId);

  const { data: props } = await sb.from('pricing_change_proposals').select('id').eq('price_book_id', book.id).contains('target_ids', { extractionId }).limit(1);
  if (props && props[0]) {
    await sb.from('pricing_change_proposals').update({
      payload: {
        title: ext.title,
        kind: ext.kind,
        detectedCategory: ext.detected_category,
        detectedSeries: ext.detected_series,
        detectedVendorName: ext.detected_vendor_name,
        rowCount: normalizedGrid.rowLabels.length,
        colCount: normalizedGrid.columnLabels.length,
        cellCount: normalizedGrid.cells.length,
        priceCellCount,
        statusCellCount,
      },
      confidence: allWarnings.length === 0 ? 0.9 : 0.5,
      explanation: `"${ext.title}": ${normalizedGrid.rowLabels.length}×${normalizedGrid.columnLabels.length} grid (${priceCellCount} prices, ${statusCellCount} status cells). Map to approve.`,
    }).eq('id', props[0].id);
  }

  return {
    rowCount: normalizedGrid.rowLabels.length,
    colCount: normalizedGrid.columnLabels.length,
    cellCount: normalizedGrid.cells.length,
    priceCellCount,
    statusCellCount,
    warnings: allWarnings.length,
  };
}
