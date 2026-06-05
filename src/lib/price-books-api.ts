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
} from './pricing-api';
import { updateProposalStatus } from './pricing-proposals-api';
import type {
  PriceBook,
  PriceBookCategory,
  PriceBookExtraction,
  PriceBookFileType,
  ExtractedGrid,
  ColumnCriteria,
  DimensionCriteria,
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
  meta: { name: string; companyId: string | null; category: PriceBookCategory | null },
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
}

export interface ApproveExtractionResult {
  tableId: string;
  columnsCreated: number;
  rowsCreated: number;
  cellsWritten: number;
}

/**
 * Materializes a reviewed extraction into a real pricing table: creates the
 * table, attaches vendors, builds columns + rows from the mapping, and writes
 * every priced cell through the versioned writer (source='ingestion',
 * attributed to the source proposal). Marks the extraction approved and the
 * proposal applied.
 */
export async function approveExtraction(input: ApproveExtractionInput): Promise<ApproveExtractionResult> {
  const table = await createPricingTable(input.category, input.seriesValue, input.tableName);

  for (const vendorId of input.vendorIds) {
    await attachPricingTableVendor(table.id, vendorId);
  }

  // Build columns; remember the created columnId per grid column index.
  const colIdByGridCol = new Map<number, string>();
  for (const col of input.columns) {
    const created = await addPricingColumn(table.id, col.label, col.criteria);
    colIdByGridCol.set(col.gridCol, created.id);
  }

  // Build rows; remember the created rowId per grid row index.
  const rowIdByGridRow = new Map<number, string>();
  for (const row of input.rows) {
    const created = await addPricingRow(table.id, row.label, row.widthCriteria, row.heightCriteria);
    rowIdByGridRow.set(row.gridRow, created.id);
  }

  // Write cells through the versioned writer, attributed to the proposal.
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

  // Mark extraction approved + proposal applied.
  await supabase.from('price_book_extractions').update({ status: 'approved' }).eq('id', input.extractionId);
  if (input.proposalId) {
    await updateProposalStatus(input.proposalId, 'applied');
  }

  return {
    tableId: table.id,
    columnsCreated: input.columns.length,
    rowsCreated: input.rows.length,
    cellsWritten,
  };
}

/** Discards an extraction and rejects its proposal without writing any prices. */
export async function discardExtraction(extractionId: string, proposalId?: string | null): Promise<void> {
  await supabase.from('price_book_extractions').update({ status: 'discarded' }).eq('id', extractionId);
  if (proposalId) await updateProposalStatus(proposalId, 'rejected');
}
