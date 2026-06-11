/**
 * Vendor price-book ingestion API (CPQ Phase 1).
 *
 * Upload a manufacturer price list -> ingest via the `ingest-price-book` Edge
 * Function (Gemini vision/OCR) -> review the extracted grid -> approve, which
 * writes a real pricing_tables grid through the versioned cell writer.
 *
 * The agent NEVER writes pricing_tables directly; approval is a human action.
 */

import { supabase } from './supabase';
import {
  createPricingTable,
  attachPricingTableVendor,
  addPricingColumn,
  addPricingRow,
  upsertPricingCell,
  upsertAdderCell,
} from './pricing-api';
import { updateProposalStatus } from './pricing-proposals-api';
import { normalizeGauge, extractGaugeTokens, extractDepthTokens, normalizeSpecValue } from './pricing-normalize';
import type {
  PriceBook,
  PriceBookCategory,
  PriceBookExtraction,
  PriceBookFileType,
  ExtractedGrid,
  ColumnCriteria,
  DimensionCriteria,
  SelectionCriteria,
} from '@/types';

const BUCKET = 'price-book-files';
/** Hard cap matching the storage bucket's file_size_limit (50 MB). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * When set, ingestion/extraction run on the Render worker (no wall-clock
 * timeout) instead of Supabase Edge Functions. Falls back to Edge Functions
 * when unset.
 */
const WORKER_URL = (import.meta.env.VITE_PRICE_BOOK_WORKER_URL as string | undefined)?.replace(/\/$/, '');

/**
 * True when a Render worker is configured. The background "extract all" job
 * only exists on the worker; without it the UI falls back to a client-driven
 * per-table loop.
 */
export const hasPriceBookWorker = !!WORKER_URL;

/** POSTs to the Render worker with the current user's Supabase access token. */
async function callWorker<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json as { error?: string }).error || `Worker error ${resp.status}`);
  return json as T;
}

/**
 * Fills a normalized `gauge` criterion for door columns whose criteria the user
 * left empty, derived from the column label ("18 Gauge CRS" -> {gauge:'18'}).
 * Frames keep their (often multi-depth) labels as-is; the runtime engine reads
 * gauge/depth tokens directly from frame column labels. No-op if criteria are
 * already set or no gauge token is present.
 */
function deriveColumnCriteria(
  category: PriceBookCategory,
  label: string,
  existing: ColumnCriteria,
): ColumnCriteria {
  if (existing && Object.keys(existing).length > 0) return existing;
  if (category === 'doors') {
    const gauge = normalizeGauge(label);
    if (gauge != null) return { gauge: String(gauge) };
  }
  return existing;
}

/**
 * Ensures the given option values exist as `field_value_options` for a field so
 * the opening builder offers them. This is how ingested price-book values are
 * "normalized into our item fields": approving a table seeds the series/gauge/
 * depth/option choices a user must pick for that build to resolve against the
 * pricing tables. Idempotent and best-effort (never blocks approval).
 */
async function ensureFieldOptions(fieldDefinitionId: string, values: string[]): Promise<void> {
  const wanted = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (wanted.length === 0) return;
  const { data: existing } = await supabase
    .from('field_value_options')
    .select('value')
    .eq('field_definition_id', fieldDefinitionId);
  const have = new Set((existing ?? []).map((r) => String(r.value).trim().toLowerCase()));
  const toInsert = wanted.filter((v) => !have.has(v.toLowerCase()));
  if (toInsert.length === 0) return;
  await supabase.from('field_value_options').insert(
    toInsert.map((value) => ({ field_definition_id: fieldDefinitionId, value })),
  );
}

/** Resolves a field_definitions.id by field_key (null if not defined). */
async function fieldDefIdByKey(fieldKey: string): Promise<string | null> {
  const { data } = await supabase.from('field_definitions').select('id').eq('field_key', fieldKey).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Formats decimal inches back to a door-industry fraction label (4.75 -> 4 3/4"). */
function formatDepthInches(dec: number): string {
  const whole = Math.floor(dec);
  const frac = dec - whole;
  const map: Record<string, string> = { '0.25': '1/4', '0.5': '1/2', '0.75': '3/4', '0.125': '1/8', '0.375': '3/8', '0.625': '5/8', '0.875': '7/8' };
  const f = map[frac.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')] ?? (frac > 0 ? frac.toString() : '');
  return `${whole}${f ? ` ${f}` : ''}"`;
}

/**
 * Seeds the item-field options implied by an approved BASE table so the builder
 * can offer them: the series value, plus gauges (doors) or depths (frames)
 * parsed from the column labels. Best-effort.
 */
async function seedBaseTableFieldOptions(
  category: PriceBookCategory,
  seriesValue: string,
  columns: ColumnMapping[],
  selectionCriteria: SelectionCriteria = {},
): Promise<void> {
  try {
    const seriesId = await fieldDefIdByKey('series');
    if (seriesId) await ensureFieldOptions(seriesId, [seriesValue]);

    // Seed the discriminator spec values (edge_construction, core_construction,
    // frame_type, ...) so the builder offers exactly what selects this table.
    // Values are normalized via the alias table before seeding.
    for (const [key, val] of Object.entries(selectionCriteria)) {
      const rawValues = typeof val === 'string' ? [val] : Array.isArray((val as { in?: string[] }).in) ? (val as { in: string[] }).in : [];
      if (rawValues.length === 0) continue;
      const values = rawValues.map((v) => normalizeSpecValue(key, v) ?? v).filter(Boolean);
      const defId = await fieldDefIdByKey(key);
      if (defId) await ensureFieldOptions(defId, values);
    }

    if (category === 'doors') {
      const gauges = new Set<string>();
      for (const c of columns) for (const g of extractGaugeTokens(c.label)) gauges.add(`${g} Gauge`);
      const gaugeId = await fieldDefIdByKey('gauge');
      if (gaugeId && gauges.size) await ensureFieldOptions(gaugeId, [...gauges]);
    } else if (category === 'frames') {
      const depths = new Set<string>();
      for (const c of columns) for (const d of extractDepthTokens(c.label)) depths.add(formatDepthInches(d));
      const depthId = await fieldDefIdByKey('depth');
      if (depthId && depths.size) await ensureFieldOptions(depthId, [...depths]);
      const gauges = new Set<string>();
      for (const c of columns) for (const g of extractGaugeTokens(c.label)) gauges.add(`${g} Gauge`);
      const gaugeId = await fieldDefIdByKey('gauge');
      if (gaugeId && gauges.size) await ensureFieldOptions(gaugeId, [...gauges]);
    }
  } catch {
    // Seeding is best-effort; never block approval.
  }
}

function detectFileType(file: File): PriceBookFileType {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.csv') || file.type === 'text/csv') return 'csv';
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || file.type.includes('spreadsheet') || file.type.includes('excel')) return 'xlsx';
  return 'image';
}

function mapPriceBook(row: Record<string, unknown>): PriceBook {
  return {
    id: row.id as string,
    companyId: (row.company_id as string | null) ?? null,
    name: row.name as string,
    category: (row.category as PriceBookCategory | null) ?? null,
    sourceFileUrl: row.source_file_url as string,
    originalFileName: row.original_file_name as string,
    fileType: row.file_type as PriceBookFileType,
    ocrStatus: row.ocr_status as PriceBook['ocrStatus'],
    ocrError: (row.ocr_error as string | null) ?? null,
    uploadedByUserId: (row.uploaded_by_user_id as string | null) ?? null,
    extractedAt: (row.extracted_at as string | null) ?? null,
    extractStatus: (row.extract_status as PriceBook['extractStatus']) ?? null,
    extractTotal: (row.extract_total as number) ?? 0,
    extractDone: (row.extract_done as number) ?? 0,
    extractFailed: (row.extract_failed as number) ?? 0,
    extractError: (row.extract_error as string | null) ?? null,
    effectiveDate: (row.effective_date as string | null) ?? null,
    supersedesPriceBookId: (row.supersedes_price_book_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapExtraction(row: Record<string, unknown>): PriceBookExtraction {
  return {
    id: row.id as string,
    priceBookId: row.price_book_id as string,
    status: row.status as PriceBookExtraction['status'],
    title: (row.title as string | null) ?? null,
    kind: (row.kind as string | null) ?? null,
    sortOrder: (row.sort_order as number) ?? 0,
    pageHint: (row.page_hint as string | null) ?? null,
    gridExtracted: (row.grid_extracted as boolean) ?? false,
    detectedCategory: (row.detected_category as PriceBookCategory | null) ?? null,
    detectedSeries: (row.detected_series as string | null) ?? null,
    detectedVendorName: (row.detected_vendor_name as string | null) ?? null,
    grid: (row.grid ?? { columnLabels: [], rowLabels: [], cells: [] }) as ExtractedGrid,
    warnings: (row.warnings ?? []) as string[],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// Upload + ingest
// ---------------------------------------------------------------------------

export async function uploadPriceBook(
  file: File,
  userId: string,
  meta: {
    name: string;
    companyId: string | null;
    category: PriceBookCategory | null;
    effectiveDate?: string | null;
    supersedesPriceBookId?: string | null;
  },
): Promise<{ priceBookId: string; filePath: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. The maximum upload size is 50 MB.`);
  }
  const fileType = detectFileType(file);
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${userId}/${timestamp}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data, error } = await supabase
    .from('price_books')
    .insert({
      company_id: meta.companyId,
      name: meta.name,
      category: meta.category,
      source_file_url: filePath,
      original_file_name: file.name,
      file_type: fileType,
      ocr_status: 'pending',
      uploaded_by_user_id: userId,
      ...(meta.effectiveDate ? { effective_date: meta.effectiveDate } : {}),
      ...(meta.supersedesPriceBookId ? { supersedes_price_book_id: meta.supersedesPriceBookId } : {}),
    })
    .select('id')
    .single();

  if (error || !data) {
    await supabase.storage.from(BUCKET).remove([filePath]);
    throw new Error(`Failed to create price book: ${error?.message}`);
  }

  return { priceBookId: data.id as string, filePath };
}

/**
 * Step 1 — CATALOG (async). Invokes ingest-price-book, which returns
 * immediately and catalogs the book in the background (listing every table and
 * creating a placeholder extraction per table). Poll with `pollBookStatus`.
 */
export async function ingestPriceBook(priceBookId: string): Promise<{ success: boolean; started: boolean }> {
  if (WORKER_URL) {
    return callWorker('/catalog', { priceBookId });
  }
  const { data, error } = await supabase.functions.invoke('ingest-price-book', {
    body: { priceBookId },
  });
  if (error) throw new Error(error.message || 'Price-book cataloging failed');
  return data;
}

/**
 * Polls a price book until cataloging finishes (ocr_status leaves 'processing')
 * or the timeout elapses. Returns the final book. Throws if the book errored.
 */
export async function pollBookStatus(
  priceBookId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<PriceBook> {
  const intervalMs = opts.intervalMs ?? 4000;
  const timeoutMs = opts.timeoutMs ?? 6 * 60 * 1000;
  const start = Date.now();
  for (;;) {
    const book = await getPriceBook(priceBookId);
    if (!book) throw new Error('Price book not found.');
    if (book.ocrStatus === 'done') return book;
    if (book.ocrStatus === 'error') throw new Error(book.ocrError || 'Cataloging failed.');
    if (Date.now() - start > timeoutMs) throw new Error('Cataloging is taking longer than expected. Check back shortly.');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Step 2 — EXTRACT ONE TABLE'S GRID. Invokes extract-price-book-table for a
 * single cataloged table. Short and within edge limits; call per table or with
 * bounded concurrency.
 */
export async function extractPriceBookTable(extractionId: string): Promise<{
  success: boolean;
  extractionId: string;
  rowCount: number;
  colCount: number;
  cellCount: number;
  warnings: number;
}> {
  if (WORKER_URL) {
    return callWorker('/extract', { extractionId });
  }
  const { data, error } = await supabase.functions.invoke('extract-price-book-table', {
    body: { extractionId },
  });
  if (error) throw new Error(error.message || 'Grid extraction failed');
  return data;
}

/**
 * Step 2 (bulk, background) — EXTRACT ALL pending grids for a book on the
 * Render worker. Returns immediately (202); the worker extracts every
 * not-yet-pulled table with bounded concurrency and records progress on the
 * price book (`extractStatus`/`extractTotal`/`extractDone`/`extractFailed`).
 * Poll with `pollExtractAllStatus`. Worker-only (see `hasPriceBookWorker`).
 */
export async function extractAllPriceBookTables(priceBookId: string): Promise<{ success: boolean; started: boolean }> {
  if (!WORKER_URL) throw new Error('Background extract-all requires the price-book worker (VITE_PRICE_BOOK_WORKER_URL).');
  return callWorker('/extract-all', { priceBookId });
}

/**
 * Polls a price book while a background extract-all run is in progress. Calls
 * `onProgress` with the latest book on each tick. Resolves when the run leaves
 * 'processing' (returns the final book) or rejects on error/timeout.
 */
export async function pollExtractAllStatus(
  priceBookId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onProgress?: (book: PriceBook) => void } = {},
): Promise<PriceBook> {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 90 * 60 * 1000;
  const start = Date.now();
  for (;;) {
    const book = await getPriceBook(priceBookId);
    if (!book) throw new Error('Price book not found.');
    opts.onProgress?.(book);
    if (book.extractStatus === 'done') return book;
    if (book.extractStatus === 'error') throw new Error(book.extractError || 'Extraction failed.');
    if (Date.now() - start > timeoutMs) throw new Error('Extraction is taking longer than expected. Check back shortly.');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listPriceBooks(): Promise<PriceBook[]> {
  const { data, error } = await supabase
    .from('price_books')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapPriceBook(r as Record<string, unknown>));
}

export async function getPriceBook(id: string): Promise<PriceBook | null> {
  const { data, error } = await supabase.from('price_books').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapPriceBook(data as Record<string, unknown>) : null;
}

/** All extracted tables for a price book, in document order. */
export async function listExtractionsForBook(priceBookId: string): Promise<PriceBookExtraction[]> {
  const { data, error } = await supabase
    .from('price_book_extractions')
    .select('*')
    .eq('price_book_id', priceBookId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapExtraction(r as Record<string, unknown>));
}

/** The most recent extraction for a price book (the one to review). */
export async function getLatestExtraction(priceBookId: string): Promise<PriceBookExtraction | null> {
  const { data, error } = await supabase
    .from('price_book_extractions')
    .select('*')
    .eq('price_book_id', priceBookId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapExtraction(data as Record<string, unknown>) : null;
}

export async function deletePriceBook(id: string): Promise<void> {
  const book = await getPriceBook(id);
  if (book?.sourceFileUrl) {
    await supabase.storage.from(BUCKET).remove([book.sourceFileUrl]);
  }
  const { error } = await supabase.from('price_books').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Approve -> write canonical grid (versioned)
// ---------------------------------------------------------------------------

export interface ColumnMapping {
  /** Index into grid.columnLabels. */
  gridCol: number;
  label: string;
  criteria: ColumnCriteria;
}

export interface RowMapping {
  /** Index into grid.rowLabels. */
  gridRow: number;
  label: string;
  widthCriteria: DimensionCriteria | Record<string, never>;
  heightCriteria: DimensionCriteria | Record<string, never>;
}

export interface ApproveExtractionInput {
  extractionId: string;
  priceBookId: string;
  proposalId?: string | null;
  category: PriceBookCategory;
  seriesValue: string;
  tableName: string;
  vendorIds: string[];
  columns: ColumnMapping[];
  rows: RowMapping[];
  grid: ExtractedGrid;
  /**
   * Spec selectors that route a configured item to this base table (e.g. doors
   * `{ edge_construction: 'Lockseam', core_construction: 'Glued' }`). When set,
   * the engine resolves this table from the item's specs instead of series.
   */
  selectionCriteria?: SelectionCriteria;
}

export interface ApproveExtractionResult {
  tableId: string;
  columnsCreated: number;
  rowsCreated: number;
  cellsWritten: number;
  /** True when the extraction updated an existing table rather than creating a new one. */
  wasUpdate: boolean;
}

// ---------------------------------------------------------------------------
// Table fingerprint + diff helpers
// ---------------------------------------------------------------------------

/**
 * Produces a stable fingerprint string for a base table based on the fields
 * that uniquely identify it across manufacturers:
 * `{vendorId}:{category}:{sortedSelectionCriteriaJson}`
 *
 * Used to find an existing table on re-upload so we can update cells rather
 * than creating duplicates.
 */
function tableFingerprint(vendorId: string, category: PriceBookCategory, selectionCriteria: SelectionCriteria): string {
  const sorted = Object.fromEntries(Object.entries(selectionCriteria).sort(([a], [b]) => a.localeCompare(b)));
  return `${vendorId}:${category}:${JSON.stringify(sorted)}`;
}

export interface GridDiffCell {
  rowLabel: string;
  columnLabel: string;
  oldPrice: number | null;
  newPrice: number | null;
  type: 'changed' | 'added' | 'removed';
  pctDelta: number | null;
}

export interface GridDiff {
  addedRows: string[];
  removedRows: string[];
  addedColumns: string[];
  removedColumns: string[];
  changedCells: GridDiffCell[];
  totalChanges: number;
}

/**
 * Computes a diff between an existing pricing table grid and a proposed new grid
 * from an extraction approval. Fetches the existing table data from the DB.
 */
export async function computeGridDiff(tableId: string, input: ApproveExtractionInput): Promise<GridDiff> {
  const { data: rowData } = await supabase.from('pricing_rows').select('id, label').eq('pricing_table_id', tableId);
  const { data: colData } = await supabase.from('pricing_columns').select('id, label').eq('pricing_table_id', tableId).is('parent_column_id', null);
  const rows = rowData ?? [];
  const cols = colData ?? [];

  const rowIds = rows.map((r) => r.id as string);
  let existingCells: { rowId: string; columnId: string; price: number | null }[] = [];
  if (rowIds.length > 0) {
    const { data: cellData } = await supabase.from('pricing_cells').select('pricing_row_id, pricing_column_id, price').in('pricing_row_id', rowIds);
    existingCells = (cellData ?? []).map((c) => ({
      rowId: c.pricing_row_id as string,
      columnId: c.pricing_column_id as string,
      price: c.price as number | null,
    }));
  }

  const existingRowLabels = new Set(rows.map((r) => (r.label as string).trim().toLowerCase()));
  const existingColLabels = new Set(cols.map((c) => (c.label as string).trim().toLowerCase()));

  const newRowLabels = input.rows.map((r) => r.label.trim().toLowerCase());
  const newColLabels = input.columns.map((c) => c.label.trim().toLowerCase());

  const addedRows = newRowLabels.filter((l) => !existingRowLabels.has(l));
  const removedRows = [...existingRowLabels].filter((l) => !newRowLabels.includes(l));
  const addedColumns = newColLabels.filter((l) => !existingColLabels.has(l));
  const removedColumns = [...existingColLabels].filter((l) => !newColLabels.includes(l));

  // Build lookup maps for cell comparison
  const rowByLabel = new Map(rows.map((r) => [(r.label as string).trim().toLowerCase(), r.id as string]));
  const colByLabel = new Map(cols.map((c) => [(c.label as string).trim().toLowerCase(), c.id as string]));
  const existingPriceMap = new Map(existingCells.map((c) => [`${c.rowId}:${c.columnId}`, c.price]));

  const changedCells: GridDiffCell[] = [];
  for (const inputRow of input.rows) {
    const rowLabel = inputRow.label.trim().toLowerCase();
    const existingRowId = rowByLabel.get(rowLabel);
    if (!existingRowId) continue; // New row, not a change

    for (const inputCol of input.columns) {
      const colLabel = inputCol.label.trim().toLowerCase();
      const existingColId = colByLabel.get(colLabel);
      if (!existingColId) continue; // New column, not a change

      const cell = input.grid.cells.find((c) => c.row === inputRow.gridRow && c.col === inputCol.gridCol);
      const newPrice = cell?.price ?? null;
      const oldPrice = existingPriceMap.get(`${existingRowId}:${existingColId}`) ?? null;

      if (newPrice !== oldPrice) {
        const pctDelta = oldPrice != null && oldPrice !== 0 && newPrice != null
          ? Math.round(((newPrice - oldPrice) / oldPrice) * 100)
          : null;
        changedCells.push({
          rowLabel: inputRow.label,
          columnLabel: inputCol.label,
          oldPrice,
          newPrice,
          type: oldPrice === null ? 'added' : newPrice === null ? 'removed' : 'changed',
          pctDelta,
        });
      }
    }
  }

  return {
    addedRows,
    removedRows,
    addedColumns,
    removedColumns,
    changedCells,
    totalChanges: changedCells.length + addedRows.length + removedRows.length + addedColumns.length + removedColumns.length,
  };
}

/**
 * Finds an existing pricing table matching the fingerprint for a proposed
 * extraction approval (same vendor, category, and selection_criteria).
 * Returns null when no match is found (first-time upload → create new table).
 */
export async function findMatchingPricingTable(
  vendorId: string,
  category: PriceBookCategory,
  selectionCriteria: SelectionCriteria,
): Promise<string | null> {
  if (Object.keys(selectionCriteria).length === 0) return null; // No criteria → can't fingerprint safely

  const { data: tables } = await supabase
    .from('pricing_tables')
    .select('id, selection_criteria, pricing_table_vendors!inner(company_id)')
    .eq('category', category)
    .eq('kind', 'base')
    .eq('pricing_table_vendors.company_id', vendorId);

  if (!tables || tables.length === 0) return null;

  const needle = tableFingerprint(vendorId, category, selectionCriteria);
  for (const t of tables) {
    const existing = (t.selection_criteria as SelectionCriteria | null) ?? {};
    if (Object.keys(existing).length === 0) continue;
    const fp = tableFingerprint(vendorId, category, existing);
    if (fp === needle) return t.id as string;
  }
  return null;
}

/**
 * Materializes a reviewed extraction into a real pricing table: creates the
 * table, attaches vendors, builds columns + rows from the mapping, and writes
 * every priced cell through the versioned writer (source='ingestion',
 * attributed to the source proposal). Marks the extraction approved and the
 * proposal applied.
 */
export async function approveExtraction(input: ApproveExtractionInput): Promise<ApproveExtractionResult> {
  // Fingerprint-based update-vs-create:
  // If a matching table already exists (same vendor + category + selection_criteria),
  // update its cells rather than creating a duplicate pricing table.
  const selectionCriteria = input.selectionCriteria ?? {};
  let tableId: string;
  let wasUpdate = false;

  const existingTableId = input.vendorIds.length === 1
    ? await findMatchingPricingTable(input.vendorIds[0], input.category, selectionCriteria)
    : null;

  if (existingTableId) {
    tableId = existingTableId;
    wasUpdate = true;
    // Update the table name/series/effective_from in case it changed
    await supabase.from('pricing_tables').update({
      name: input.tableName,
      series_value: input.seriesValue,
      selection_criteria: selectionCriteria,
      effective_from: new Date().toISOString(),
    }).eq('id', tableId);
  } else {
    const table = await createPricingTable(
      input.category, input.seriesValue, input.tableName, undefined, 'base', selectionCriteria,
    );
    tableId = table.id;
    for (const vendorId of input.vendorIds) {
      await attachPricingTableVendor(tableId, vendorId);
    }
  }

  // Build/find columns.
  // On update: match existing columns by label to upsert cells into the right place.
  // New columns are appended.
  const { data: existingCols } = wasUpdate
    ? await supabase.from('pricing_columns').select('id, label').eq('pricing_table_id', tableId).is('parent_column_id', null)
    : { data: [] };
  const existingColByLabel = new Map((existingCols ?? []).map((c) => [(c.label as string).trim().toLowerCase(), c.id as string]));

  const colIdByGridCol = new Map<number, string>();
  let columnsCreated = 0;
  for (const col of input.columns) {
    const criteria = deriveColumnCriteria(input.category, col.label, col.criteria);
    const labelKey = col.label.trim().toLowerCase();
    const existingId = existingColByLabel.get(labelKey);
    if (existingId) {
      colIdByGridCol.set(col.gridCol, existingId);
    } else {
      const created = await addPricingColumn(tableId, col.label, criteria);
      colIdByGridCol.set(col.gridCol, created.id);
      columnsCreated++;
    }
  }

  // Build/find rows similarly.
  const { data: existingRows } = wasUpdate
    ? await supabase.from('pricing_rows').select('id, label').eq('pricing_table_id', tableId)
    : { data: [] };
  const existingRowByLabel = new Map((existingRows ?? []).map((r) => [(r.label as string).trim().toLowerCase(), r.id as string]));

  const rowIdByGridRow = new Map<number, string>();
  let rowsCreated = 0;
  for (const row of input.rows) {
    const labelKey = row.label.trim().toLowerCase();
    const existingId = existingRowByLabel.get(labelKey);
    if (existingId) {
      rowIdByGridRow.set(row.gridRow, existingId);
    } else {
      const created = await addPricingRow(tableId, row.label, row.widthCriteria, row.heightCriteria);
      rowIdByGridRow.set(row.gridRow, created.id);
      rowsCreated++;
    }
  }

  // Write cells (upsert — updates existing prices with history entry).
  let cellsWritten = 0;
  for (const cell of input.grid.cells) {
    if (cell.price == null) continue;
    const rowId = rowIdByGridRow.get(cell.row);
    const columnId = colIdByGridCol.get(cell.col);
    if (!rowId || !columnId) continue;
    await upsertPricingCell(rowId, columnId, cell.price, {
      source: 'ingestion',
      proposalId: input.proposalId ?? null,
    });
    cellsWritten++;
  }

  await seedBaseTableFieldOptions(input.category, input.seriesValue, input.columns, selectionCriteria);

  // Link the extraction to the pricing table it produced/updated.
  await supabase.from('price_book_extractions').update({ status: 'approved', pricing_table_id: tableId }).eq('id', input.extractionId);
  if (input.proposalId) {
    await updateProposalStatus(input.proposalId, 'applied');
  }

  return {
    tableId,
    columnsCreated,
    rowsCreated,
    cellsWritten,
    wasUpdate,
  };
}

// ---------------------------------------------------------------------------
// Approve an ADDER/OPTION table -> write pricing_adder_cells (surcharges)
// ---------------------------------------------------------------------------

/** A base door/frame table an adder can attach to. */
export interface BaseTableOption {
  id: string;
  name: string;
  category: PriceBookCategory;
  seriesValue: string;
}

/** Lists base (kind='base') door/frame tables for a manufacturer so an adder
 *  table can be attached to the series it surcharges. */
export async function listBaseTablesForVendor(companyId: string): Promise<BaseTableOption[]> {
  const { data, error } = await supabase
    .from('pricing_tables')
    .select('id, name, category, series_value, pricing_table_vendors!inner(company_id)')
    .eq('kind', 'base')
    .in('category', ['doors', 'frames'])
    .eq('pricing_table_vendors.company_id', companyId)
    .order('category', { ascending: true })
    .order('series_value', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    category: r.category as PriceBookCategory,
    seriesValue: r.series_value as string,
  }));
}

export interface AdderRowMapping {
  /** The option this row represents (matched against the item's field value). */
  optionValue: string;
  price: number;
  /**
   * Per-row field definition override. When set, this row's adder is written
   * against this field instead of the top-level `fieldDefinitionId`. This lets
   * a multi-section adder table (e.g. one section for astragals, another for
   * locks) be approved in a single pass, with each section mapped to the
   * correct field.
   */
  fieldDefinitionId?: string;
}

export interface ApproveAdderInput {
  extractionId: string;
  proposalId?: string | null;
  /** The base door/frame table this adder surcharges (pricing_adder_cells.pricing_table_id). */
  baseTableId: string;
  /** The item canonical_code these adders apply to (must match the priced item). */
  canonicalCode: string;
  /**
   * Default field definition for rows that don't have a per-row override.
   * May be empty string when every row has its own fieldDefinitionId.
   */
  fieldDefinitionId: string;
  vendorId: string;
  rows: AdderRowMapping[];
}

/**
 * Materializes an adder/option extraction into `pricing_adder_cells` attached to
 * a series' base table. Supports per-row field definitions so a single multi-section
 * adder table (e.g. astragals + lock types + hinges all on one PDF page) can be
 * mapped to multiple fields in one approval pass.
 *
 * At pricing time `resolveAdders(baseTableId, canonicalCode, vendorId, fields)` adds
 * a row's price when the item's field value equals that row's `optionValue`.
 * Marks the extraction approved + proposal applied.
 */
export async function approveAdderExtraction(input: ApproveAdderInput): Promise<{ cellsWritten: number }> {
  let cellsWritten = 0;

  // Group rows by the field definition they belong to (per-row override wins, then default)
  const byField = new Map<string, AdderRowMapping[]>();
  for (const r of input.rows) {
    if (r.price == null || !r.optionValue.trim()) continue;
    const fid = r.fieldDefinitionId ?? input.fieldDefinitionId;
    if (!fid) continue;
    const list = byField.get(fid) ?? [];
    list.push(r);
    byField.set(fid, list);
  }

  for (const [fieldDefinitionId, rows] of byField.entries()) {
    for (const r of rows) {
      await upsertAdderCell({
        tableId: input.baseTableId,
        canonicalCode: input.canonicalCode.trim(),
        fieldDefinitionId,
        optionValue: r.optionValue.trim(),
        companyId: input.vendorId,
        price: r.price,
      });
      cellsWritten++;
    }

    // Seed field options for this field so the builder dropdown offers the values.
    try {
      await ensureFieldOptions(fieldDefinitionId, rows.map((r) => r.optionValue));
    } catch {
      // best-effort
    }
  }

  await supabase.from('price_book_extractions').update({ status: 'approved' }).eq('id', input.extractionId);
  if (input.proposalId) await updateProposalStatus(input.proposalId, 'applied');

  return { cellsWritten };
}

/**
 * Resets an extraction's grid so it can be re-extracted.
 * Use when the initial extraction produced a truncated or empty grid.
 * Clears the grid data and sets grid_extracted=false so the worker will
 * re-run the Gemini extraction next time extractPriceBookTable is called.
 */
export async function resetExtractionGrid(extractionId: string): Promise<void> {
  const emptyGrid = { columnLabels: [], rowLabels: [], cells: [], columnFieldHints: {} };
  const { error } = await supabase
    .from('price_book_extractions')
    .update({ grid: emptyGrid, warnings: [], grid_extracted: false })
    .eq('id', extractionId);
  if (error) throw new Error(`Failed to reset extraction: ${error.message}`);
}

/** Discards an extraction and rejects its proposal without writing any prices. */
export async function discardExtraction(extractionId: string, proposalId?: string | null): Promise<void> {
  await supabase.from('price_book_extractions').update({ status: 'discarded' }).eq('id', extractionId);
  if (proposalId) await updateProposalStatus(proposalId, 'rejected');
}

// ---------------------------------------------------------------------------
// Approve a HARDWARE flat-list table → pricing_tables + pricing_table_items
// ---------------------------------------------------------------------------

export interface HardwareRowMapping {
  /** Grid row index. */
  gridRow: number;
  /** Row label as extracted. */
  label: string;
  /** The item canonical_code this row prices (maps to pricing_table_items). */
  canonicalCode: string;
  /** Price for this item. */
  price: number | null;
  /** Whether to include this row in the approved table. */
  include: boolean;
}

export interface ApproveHardwareInput {
  extractionId: string;
  priceBookId: string;
  proposalId?: string | null;
  tableName: string;
  vendorIds: string[];
  rows: HardwareRowMapping[];
}

export interface ApproveHardwareResult {
  tableId: string;
  rowsWritten: number;
  itemsTagged: number;
}

/**
 * Materializes a hardware flat-list extraction:
 * - Creates a `pricing_tables` row with category='hardware', kind='base'
 * - Creates one column ("Price") and one row per hardware item
 * - Writes pricing_cells for each row
 * - Writes pricing_table_items to link each row to its canonical_code
 *   so `resolveHardwarePrice` can find the table from `item.canonicalCode`
 */
export async function approveHardwareExtraction(input: ApproveHardwareInput): Promise<ApproveHardwareResult> {
  const includedRows = input.rows.filter((r) => r.include && r.price != null && r.canonicalCode.trim());
  if (includedRows.length === 0) {
    throw new Error('No rows selected — select at least one hardware item row to approve.');
  }

  const table = await createPricingTable('hardware', input.tableName, input.tableName, undefined, 'base', {});
  for (const vendorId of input.vendorIds) {
    await attachPricingTableVendor(table.id, vendorId);
  }

  // Single "Price" column
  const priceCol = await addPricingColumn(table.id, 'Price', {});

  let rowsWritten = 0;
  let itemsTagged = 0;
  const { addPricingTableItem } = await import('./pricing-api');

  for (const row of includedRows) {
    const pricingRow = await addPricingRow(table.id, row.label, {}, {});
    await upsertPricingCell(pricingRow.id, priceCol.id, row.price as number, {
      source: 'ingestion',
      proposalId: input.proposalId ?? null,
    });
    rowsWritten++;

    // Tag table → canonical_code so resolveHardwarePrice can find it
    try {
      await addPricingTableItem(table.id, row.canonicalCode.trim(), 'hardware');
      itemsTagged++;
    } catch {
      // Duplicate tags silently ignored (UNIQUE constraint)
    }
  }

  await supabase.from('price_book_extractions').update({ status: 'approved', pricing_table_id: table.id }).eq('id', input.extractionId);
  if (input.proposalId) {
    await updateProposalStatus(input.proposalId, 'applied');
  }

  return { tableId: table.id, rowsWritten, itemsTagged };
}
