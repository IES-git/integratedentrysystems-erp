/**
 * Supabase-backed CRUD operations for the Pricing feature.
 * Covers pricing_tables, pricing_table_vendors, pricing_columns,
 * pricing_rows, and pricing_cells.
 */

import { supabase } from './supabase';
import type {
  PricingTable,
  PricingTableVendor,
  PricingTableSummary,
  PricingTableItem,
  LitesLouversGlassGroupedListResult,
  PricingColumn,
  PricingRow,
  PricingCell,
  PricingAdderCell,
  DimensionCriteria,
  ColumnCriteria,
  DoorSeriesSummary,
  LitesLouversGlassItemSummary,
  Company,
  PricingChangeSource,
} from '@/types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function throwOnError<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error('Unexpected null result from Supabase');
  return data;
}

function mapTable(row: Record<string, unknown>): PricingTable {
  return {
    id: row.id as string,
    category: row.category as PricingTable['category'],
    seriesValue: row.series_value as string,
    kind: (row.kind as PricingTable['kind']) ?? 'base',
    selectionCriteria: (row.selection_criteria as PricingTable['selectionCriteria']) ?? {},
    fieldValueOptionId: row.field_value_option_id as string | null,
    name: row.name as string,
    description: row.description as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapColumn(row: Record<string, unknown>): PricingColumn {
  return {
    id: row.id as string,
    pricingTableId: row.pricing_table_id as string,
    label: row.label as string,
    criteria: (row.criteria ?? {}) as ColumnCriteria,
    parentColumnId: (row.parent_column_id as string | null) ?? null,
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapRow(row: Record<string, unknown>): PricingRow {
  return {
    id: row.id as string,
    pricingTableId: row.pricing_table_id as string,
    label: row.label as string,
    widthCriteria: (row.width_criteria ?? {}) as DimensionCriteria | Record<string, never>,
    heightCriteria: (row.height_criteria ?? {}) as DimensionCriteria | Record<string, never>,
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapCell(row: Record<string, unknown>): PricingCell {
  return {
    id: row.id as string,
    pricingRowId: row.pricing_row_id as string,
    pricingColumnId: row.pricing_column_id as string,
    price: row.price as number | null,
    currency: row.currency as string,
    notes: row.notes as string | null,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// Series list
// ---------------------------------------------------------------------------

/**
 * Returns all door series, merging two sources:
 *   1. Global `field_value_options` for the `series` field_definition.
 *   2. Door items from `estimate_items` (item_type='doors'), using each item's
 *      series value from `item_fields` when present, or its `item_label` as a
 *      fallback — mirrors the same grouping logic used by the Items page.
 *
 * Each entry is enriched with pricing table summary data (row/column counts,
 * last updated, vendors). Item-only series that have no global option record
 * will have fieldValueOptionId = null.
 */
export async function listDoorSeries(): Promise<DoorSeriesSummary[]> {
  // 1. Fetch the series field definition id (may not exist)
  const { data: fieldDef, error: fieldDefError } = await supabase
    .from('field_definitions')
    .select('id')
    .eq('field_key', 'series')
    .maybeSingle();

  if (fieldDefError) throw new Error(fieldDefError.message);

  // 2. Fetch global series options (empty array if no field definition)
  const globalOptions: { id: string; value: string }[] = [];
  if (fieldDef) {
    const { data: options, error: optionsError } = await supabase
      .from('field_value_options')
      .select('id, value')
      .eq('field_definition_id', fieldDef.id)
      .order('sort_order', { ascending: true })
      .order('value', { ascending: true });

    if (optionsError) throw new Error(optionsError.message);
    globalOptions.push(...(options ?? []));
  }

  // 3. Fetch all door items and derive the same group names shown on the Items page.
  //
  // Multiple estimate_items rows can share the same canonical_code (one per estimate
  // line). The Items page (getItemTypes) groups by canonical_code and picks the
  // MOST COMMON series value across all rows for that code; if no series is set on
  // any row it falls back to item_label. We replicate that logic exactly so the
  // Pricing series list always matches what the Items page displays.
  const { data: doorItems, error: doorItemsError } = await supabase
    .from('estimate_items')
    .select('canonical_code, item_label, item_fields(field_key, field_value)')
    .eq('item_type', 'doors');

  if (doorItemsError) throw new Error(doorItemsError.message);

  // Accumulate series counts per canonical_code
  const codeData = new Map<string, { itemLabel: string; seriesCounts: Map<string, number> }>();
  for (const item of doorItems ?? []) {
    if (!codeData.has(item.canonical_code)) {
      codeData.set(item.canonical_code, { itemLabel: item.item_label, seriesCounts: new Map() });
    }
    const entry = codeData.get(item.canonical_code)!;
    const fields = item.item_fields as { field_key: string; field_value: string | null }[] | null;
    const seriesValue = fields?.find((f) => f.field_key === 'series')?.field_value;
    if (seriesValue) {
      entry.seriesCounts.set(seriesValue, (entry.seriesCounts.get(seriesValue) ?? 0) + 1);
    }
  }

  // Per unique canonical_code pick the most-common series (or item_label as fallback)
  const itemSeriesValues = new Set<string>();
  for (const { itemLabel, seriesCounts } of codeData.values()) {
    const name =
      seriesCounts.size > 0
        ? [...seriesCounts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]
        : itemLabel;
    if (name) itemSeriesValues.add(name);
  }

  // Merge: global options first (preserve sort order), then alphabetical extras
  const globalValueSet = new Set(globalOptions.map((o) => o.value));
  const extraOptions = [...itemSeriesValues]
    .filter((v) => !globalValueSet.has(v))
    .sort()
    .map((v) => ({ id: null as string | null, value: v }));

  const allOptions: { id: string | null; value: string }[] = [...globalOptions, ...extraOptions];

  if (allOptions.length === 0) return [];

  // 4. Fetch pricing tables for 'doors' with vendor names
  const { data: tables, error: tablesError } = await supabase
    .from('pricing_tables')
    .select(`
      id,
      series_value,
      name,
      updated_at,
      pricing_table_vendors (
        company_id,
        companies ( id, name )
      ),
      pricing_columns ( id ),
      pricing_rows ( id )
    `)
    .eq('category', 'doors');

  if (tablesError) throw new Error(tablesError.message);

  // Group by series_value — one series can have many tables
  const tableMap = new Map<string, PricingTableSummary[]>();
  for (const t of tables ?? []) {
    const vendors = (t.pricing_table_vendors ?? []).map((v: { company_id: string; companies: { id: string; name: string } | null }) => ({
      id: v.company_id,
      name: v.companies?.name ?? '',
    }));
    const summary: PricingTableSummary = {
      id: t.id,
      name: t.name,
      rowCount: (t.pricing_rows ?? []).length,
      columnCount: (t.pricing_columns ?? []).length,
      lastUpdatedAt: t.updated_at,
      vendors,
    };
    const existing = tableMap.get(t.series_value) ?? [];
    existing.push(summary);
    tableMap.set(t.series_value, existing);
  }

  return allOptions.map((opt) => ({
    seriesValue: opt.value,
    label: opt.value,
    fieldValueOptionId: opt.id,
    pricingTables: tableMap.get(opt.value) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Frame series list
// ---------------------------------------------------------------------------

/**
 * Returns all frame series, derived from estimate_items where item_type = 'frames'.
 * Uses the same series-grouping logic as listDoorSeries but for frames.
 */
export async function listFrameSeries(): Promise<DoorSeriesSummary[]> {
  // 1. Fetch the series field definition id (may not exist)
  const { data: fieldDef, error: fieldDefError } = await supabase
    .from('field_definitions')
    .select('id')
    .eq('field_key', 'series')
    .maybeSingle();

  if (fieldDefError) throw new Error(fieldDefError.message);

  // 2. Fetch global series options
  const globalOptions: { id: string; value: string }[] = [];
  if (fieldDef) {
    const { data: options, error: optionsError } = await supabase
      .from('field_value_options')
      .select('id, value')
      .eq('field_definition_id', fieldDef.id)
      .order('sort_order', { ascending: true })
      .order('value', { ascending: true });

    if (optionsError) throw new Error(optionsError.message);
    globalOptions.push(...(options ?? []));
  }

  // 3. Fetch all frame items and derive series names
  const { data: frameItems, error: frameItemsError } = await supabase
    .from('estimate_items')
    .select('canonical_code, item_label, item_fields(field_key, field_value)')
    .eq('item_type', 'frames');

  if (frameItemsError) throw new Error(frameItemsError.message);

  const codeData = new Map<string, { itemLabel: string; seriesCounts: Map<string, number> }>();
  for (const item of frameItems ?? []) {
    if (!codeData.has(item.canonical_code)) {
      codeData.set(item.canonical_code, { itemLabel: item.item_label, seriesCounts: new Map() });
    }
    const entry = codeData.get(item.canonical_code)!;
    const fields = item.item_fields as { field_key: string; field_value: string | null }[] | null;
    const seriesValue = fields?.find((f) => f.field_key === 'series')?.field_value;
    if (seriesValue) {
      entry.seriesCounts.set(seriesValue, (entry.seriesCounts.get(seriesValue) ?? 0) + 1);
    }
  }

  const itemSeriesValues = new Set<string>();
  for (const { itemLabel, seriesCounts } of codeData.values()) {
    const name =
      seriesCounts.size > 0
        ? [...seriesCounts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]
        : itemLabel;
    if (name) itemSeriesValues.add(name);
  }

  const globalValueSet = new Set(globalOptions.map((o) => o.value));
  const extraOptions = [...itemSeriesValues]
    .filter((v) => !globalValueSet.has(v))
    .sort()
    .map((v) => ({ id: null as string | null, value: v }));

  const allOptions: { id: string | null; value: string }[] = [...globalOptions, ...extraOptions];

  if (allOptions.length === 0) return [];

  // 4. Fetch pricing tables for 'frames'
  const { data: tables, error: tablesError } = await supabase
    .from('pricing_tables')
    .select(`
      id,
      series_value,
      name,
      updated_at,
      pricing_table_vendors (
        company_id,
        companies ( id, name )
      ),
      pricing_columns ( id ),
      pricing_rows ( id )
    `)
    .eq('category', 'frames');

  if (tablesError) throw new Error(tablesError.message);

  const tableMap = new Map<string, PricingTableSummary[]>();
  for (const t of tables ?? []) {
    const vendors = (t.pricing_table_vendors ?? []).map((v: { company_id: string; companies: { id: string; name: string } | null }) => ({
      id: v.company_id,
      name: v.companies?.name ?? '',
    }));
    const summary: PricingTableSummary = {
      id: t.id,
      name: t.name,
      rowCount: (t.pricing_rows ?? []).length,
      columnCount: (t.pricing_columns ?? []).length,
      lastUpdatedAt: t.updated_at,
      vendors,
    };
    const existing = tableMap.get(t.series_value) ?? [];
    existing.push(summary);
    tableMap.set(t.series_value, existing);
  }

  return allOptions.map((opt) => ({
    seriesValue: opt.value,
    label: opt.value,
    fieldValueOptionId: opt.id,
    pricingTables: tableMap.get(opt.value) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Category table list (non-door categories)
// ---------------------------------------------------------------------------

/**
 * Returns all pricing tables for a given category (e.g. lites_louvers_glass),
 * without any series grouping or item-derived series logic.
 * Used for simple grid editors (height × width format).
 */
export async function listPricingTablesForCategory(
  category: PricingTable['category'],
): Promise<PricingTableSummary[]> {
  const { data, error } = await supabase
    .from('pricing_tables')
    .select(`
      id,
      name,
      updated_at,
      pricing_table_vendors (
        company_id,
        companies ( id, name )
      ),
      pricing_columns ( id ),
      pricing_rows ( id )
    `)
    .eq('category', category)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((t) => {
    const vendors = (t.pricing_table_vendors ?? []).map(
      (v: { company_id: string; companies: { id: string; name: string } | null }) => ({
        id: v.company_id,
        name: v.companies?.name ?? '',
      }),
    );
    return {
      id: t.id,
      name: t.name,
      rowCount: (t.pricing_rows ?? []).length,
      columnCount: (t.pricing_columns ?? []).length,
      lastUpdatedAt: t.updated_at as string,
      vendors,
    };
  });
}

// ---------------------------------------------------------------------------
// Lites / Louvers / Glass item list
// ---------------------------------------------------------------------------

/**
 * Returns all distinct items from estimate_items where item_type = 'lites_louvers_glass',
 * grouped by canonical_code, each enriched with their pricing table data (if any).
 * The pricing table for each item uses series_value = canonical_code.
 */
export async function listLitesLouversGlassItems(): Promise<LitesLouversGlassItemSummary[]> {
  // 1. Fetch all lites/louvers/glass items
  const { data: items, error: itemsError } = await supabase
    .from('estimate_items')
    .select('canonical_code, item_label')
    .eq('item_type', 'lites_louvers_glass');

  if (itemsError) throw new Error(itemsError.message);

  // Deduplicate by canonical_code, keeping the first encountered label
  const codeMap = new Map<string, string>();
  for (const item of items ?? []) {
    if (!codeMap.has(item.canonical_code)) {
      codeMap.set(item.canonical_code, item.item_label);
    }
  }

  if (codeMap.size === 0) return [];

  // 2. Fetch pricing tables for lites_louvers_glass, keyed by series_value = canonical_code
  const { data: tables, error: tablesError } = await supabase
    .from('pricing_tables')
    .select(`
      id,
      series_value,
      updated_at,
      pricing_table_vendors (
        company_id,
        companies ( id, name )
      ),
      pricing_columns ( id ),
      pricing_rows ( id )
    `)
    .eq('category', 'lites_louvers_glass');

  if (tablesError) throw new Error(tablesError.message);

  // Build a map from canonical_code → pricing table info
  const tableMap = new Map<string, {
    id: string;
    rowCount: number;
    columnCount: number;
    lastUpdatedAt: string;
    vendors: { id: string; name: string }[];
  }>();

  for (const t of tables ?? []) {
    const vendors = (t.pricing_table_vendors ?? []).map(
      (v: { company_id: string; companies: { id: string; name: string } | null }) => ({
        id: v.company_id,
        name: v.companies?.name ?? '',
      }),
    );
    tableMap.set(t.series_value, {
      id: t.id,
      rowCount: (t.pricing_rows ?? []).length,
      columnCount: (t.pricing_columns ?? []).length,
      lastUpdatedAt: t.updated_at as string,
      vendors,
    });
  }

  // 3. Merge items with pricing table data
  return [...codeMap.entries()].map(([canonicalCode, label]) => {
    const tableInfo = tableMap.get(canonicalCode) ?? null;
    return {
      canonicalCode,
      label,
      pricingTableId: tableInfo?.id ?? null,
      rowCount: tableInfo?.rowCount ?? 0,
      columnCount: tableInfo?.columnCount ?? 0,
      lastUpdatedAt: tableInfo?.lastUpdatedAt ?? null,
      vendors: tableInfo?.vendors ?? [],
    };
  });
}

// ---------------------------------------------------------------------------
// Series table list
// ---------------------------------------------------------------------------

/**
 * Returns a lightweight summary of all pricing tables for a given category + series.
 * Much cheaper than listDoorSeries when you only need one series.
 */
export async function listPricingTablesForSeries(
  category: PricingTable['category'],
  seriesValue: string,
): Promise<PricingTableSummary[]> {
  const { data, error } = await supabase
    .from('pricing_tables')
    .select(`
      id,
      name,
      updated_at,
      pricing_table_vendors (
        company_id,
        companies ( id, name )
      ),
      pricing_columns ( id ),
      pricing_rows ( id )
    `)
    .eq('category', category)
    .eq('series_value', seriesValue)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((t) => {
    const vendors = (t.pricing_table_vendors ?? []).map(
      (v: { company_id: string; companies: { id: string; name: string } | null }) => ({
        id: v.company_id,
        name: v.companies?.name ?? '',
      }),
    );
    return {
      id: t.id,
      name: t.name,
      rowCount: (t.pricing_rows ?? []).length,
      columnCount: (t.pricing_columns ?? []).length,
      lastUpdatedAt: t.updated_at as string,
      vendors,
    };
  });
}

// ---------------------------------------------------------------------------
// Pricing Table
// ---------------------------------------------------------------------------

/**
 * Creates a brand-new pricing table for the given category + series.
 * Multiple tables per series are supported; this never deduplicates.
 */
export async function createPricingTable(
  category: PricingTable['category'],
  seriesValue: string,
  name: string,
  fieldValueOptionId?: string,
  kind: PricingTable['kind'] = 'base',
  selectionCriteria: PricingTable['selectionCriteria'] = {},
): Promise<PricingTable> {
  const { data, error } = await supabase
    .from('pricing_tables')
    .insert({
      category,
      series_value: seriesValue,
      name,
      kind,
      selection_criteria: selectionCriteria,
      ...(fieldValueOptionId ? { field_value_option_id: fieldValueOptionId } : {}),
    })
    .select('*')
    .single();

  return mapTable(throwOnError(data as Record<string, unknown> | null, error));
}

/** Deletes a pricing table and all its columns, rows, cells, and adder cells (via CASCADE). */
export async function deletePricingTable(id: string): Promise<void> {
  const { error } = await supabase.from('pricing_tables').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Per-table pricing coverage row used by the coverage report. */
export interface PricingCoverageRow {
  tableId: string;
  category: string;
  seriesValue: string;
  kind: string;
  name: string;
  vendorNames: string[];
  rows: number;
  cols: number;
  cells: number;
  /** rows*cols (the cells a fully-filled grid would have). */
  expectedCells: number;
  /** Adder/option surcharge rows attached to this table (for base tables). */
  adderCells: number;
}

/**
 * Read-only coverage report: for every pricing table, how filled its grid is
 * and how many adder cells are attached. Lets you confirm a series+vendor is
 * quote-ready (full grid, expected adders) before relying on it. Optionally
 * filtered to a category and/or vendor.
 */
export async function getPricingCoverage(opts: { category?: string } = {}): Promise<PricingCoverageRow[]> {
  let q = supabase
    .from('pricing_tables')
    .select(`
      id, category, series_value, kind, name,
      pricing_columns(id),
      pricing_rows(id, pricing_cells(id)),
      pricing_table_vendors(companies(name)),
      pricing_adder_cells(id)
    `);
  if (opts.category) q = q.eq('category', opts.category);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rowsOut = (data ?? []).map((t) => {
    const r = t as Record<string, unknown>;
    const cols = ((r.pricing_columns as unknown[]) ?? []).length;
    const prows = (r.pricing_rows as { pricing_cells?: unknown[] }[]) ?? [];
    const rowCount = prows.length;
    const cells = prows.reduce((s, row) => s + ((row.pricing_cells as unknown[])?.length ?? 0), 0);
    const vendorNames = ((r.pricing_table_vendors as { companies?: { name?: string } }[]) ?? [])
      .map((v) => v.companies?.name)
      .filter((n): n is string => !!n);
    return {
      tableId: r.id as string,
      category: r.category as string,
      seriesValue: r.series_value as string,
      kind: (r.kind as string) ?? 'base',
      name: r.name as string,
      vendorNames,
      rows: rowCount,
      cols,
      cells,
      expectedCells: rowCount * cols,
      adderCells: ((r.pricing_adder_cells as unknown[]) ?? []).length,
    };
  });

  return rowsOut;
}

/**
 * @deprecated Use createPricingTable directly. Kept for compatibility.
 * Fetches an existing pricing table for the given category + series (first match),
 * or creates a new one if none exists.
 */
export async function getOrCreatePricingTable(
  category: PricingTable['category'],
  seriesValue: string,
  fieldValueOptionId?: string
): Promise<PricingTable> {
  const { data: existing, error: selectError } = await supabase
    .from('pricing_tables')
    .select('*')
    .eq('category', category)
    .eq('series_value', seriesValue)
    .limit(1)
    .maybeSingle();

  if (selectError) throw new Error(selectError.message);
  if (existing) return mapTable(existing as Record<string, unknown>);

  return createPricingTable(category, seriesValue, seriesValue, fieldValueOptionId);
}

/**
 * Fetches a pricing table with all its vendors, columns, rows, and cells.
 */
export async function getPricingTableFull(tableId: string): Promise<{
  table: PricingTable;
  vendors: { id: string; name: string }[];
  columns: PricingColumn[];
  rows: PricingRow[];
  cells: PricingCell[];
}> {
  const [tableRes, vendorsRes, columnsRes, rowsRes] = await Promise.all([
    supabase.from('pricing_tables').select('*').eq('id', tableId).single(),
    supabase
      .from('pricing_table_vendors')
      .select('company_id, companies ( id, name )')
      .eq('pricing_table_id', tableId),
    supabase
      .from('pricing_columns')
      .select('*')
      .eq('pricing_table_id', tableId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('pricing_rows')
      .select('*')
      .eq('pricing_table_id', tableId)
      .order('sort_order', { ascending: true }),
  ]);

  if (tableRes.error) throw new Error(tableRes.error.message);
  if (vendorsRes.error) throw new Error(vendorsRes.error.message);
  if (columnsRes.error) throw new Error(columnsRes.error.message);
  if (rowsRes.error) throw new Error(rowsRes.error.message);

  const columns = (columnsRes.data ?? []).map((c) => mapColumn(c as Record<string, unknown>));
  const rows = (rowsRes.data ?? []).map((r) => mapRow(r as Record<string, unknown>));

  let cells: PricingCell[] = [];
  if (rows.length > 0 && columns.length > 0) {
    const rowIds = rows.map((r) => r.id);
    const { data: cellData, error: cellError } = await supabase
      .from('pricing_cells')
      .select('*')
      .in('pricing_row_id', rowIds);

    if (cellError) throw new Error(cellError.message);
    cells = (cellData ?? []).map((c) => mapCell(c as Record<string, unknown>));
  }

  const vendors = (vendorsRes.data ?? []).map((v: { company_id: string; companies: { id: string; name: string } | null }) => ({
    id: v.company_id,
    name: v.companies?.name ?? '',
  }));

  return {
    table: mapTable(tableRes.data as Record<string, unknown>),
    vendors,
    columns,
    rows,
    cells,
  };
}

/** Updates mutable fields on a pricing table (name, description). */
export async function updatePricingTable(
  id: string,
  updates: { name?: string; description?: string }
): Promise<PricingTable> {
  const { data, error } = await supabase
    .from('pricing_tables')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  return mapTable(throwOnError(data as Record<string, unknown> | null, error));
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

/**
 * Returns all manufacturer companies that have at least one pricing table
 * for the given category + series value.
 * Used to filter the manufacturer picker in the estimate wizard so users
 * only see vendors that actually have prices set up for the selected item.
 */
function mapCompany(c: Record<string, unknown>): Company {
  return {
    id: c.id as string,
    name: c.name as string,
    companyType: c.company_type as Company['companyType'],
    billingAddress: c.billing_address as string | null,
    billingCity: c.billing_city as string | null,
    billingState: c.billing_state as string | null,
    billingZip: c.billing_zip as string | null,
    shippingAddress: c.shipping_address as string | null,
    shippingCity: c.shipping_city as string | null,
    shippingState: c.shipping_state as string | null,
    shippingZip: c.shipping_zip as string | null,
    notes: c.notes as string | null,
    active: c.active as boolean,
    settings: c.settings as Company['settings'],
    createdAt: c.created_at as string,
    updatedAt: c.updated_at as string,
  };
}

/**
 * Lists every manufacturer that has a BASE pricing table in a category,
 * regardless of series. Used by the spec-driven builder: the user configures
 * specs and picks any of these manufacturers; the engine resolves which of that
 * manufacturer's series the specs map to. (Replaces series-keyed manufacturer
 * lookup, which fails when the item's catalog series isn't the vendor's series.)
 */
export async function listManufacturersForCategory(
  category: PricingTable['category'],
): Promise<Company[]> {
  const { data: tables, error: tablesErr } = await supabase
    .from('pricing_tables')
    .select('id')
    .eq('category', category)
    .eq('kind', 'base');
  if (tablesErr) throw new Error(tablesErr.message);
  if (!tables || tables.length === 0) return [];

  const tableIds = tables.map((t: Record<string, unknown>) => t.id as string);
  const { data: vendors, error: vendorsErr } = await supabase
    .from('pricing_table_vendors')
    .select('company_id')
    .in('pricing_table_id', tableIds);
  if (vendorsErr) throw new Error(vendorsErr.message);
  if (!vendors || vendors.length === 0) return [];

  const companyIds = [...new Set((vendors as { company_id: string }[]).map((v) => v.company_id))];
  const { data: companies, error: companiesErr } = await supabase
    .from('companies')
    .select('*')
    .in('id', companyIds)
    .order('name', { ascending: true });
  if (companiesErr) throw new Error(companiesErr.message);
  return (companies ?? []).map((c) => mapCompany(c as Record<string, unknown>));
}

export async function listManufacturersForSeries(
  category: PricingTable['category'],
  seriesValue: string,
): Promise<Company[]> {
  // Find all table IDs for this category + series
  const { data: tables, error: tablesErr } = await supabase
    .from('pricing_tables')
    .select('id')
    .eq('category', category)
    .eq('series_value', seriesValue);

  if (tablesErr) throw new Error(tablesErr.message);
  if (!tables || tables.length === 0) return [];

  const tableIds = tables.map((t: Record<string, unknown>) => t.id as string);

  // Find all vendors linked to those tables
  const { data: vendors, error: vendorsErr } = await supabase
    .from('pricing_table_vendors')
    .select('company_id')
    .in('pricing_table_id', tableIds);

  if (vendorsErr) throw new Error(vendorsErr.message);
  if (!vendors || vendors.length === 0) return [];

  const companyIds = [...new Set((vendors as { company_id: string }[]).map((v) => v.company_id))];

  // Fetch the full company rows
  const { data: companies, error: companiesErr } = await supabase
    .from('companies')
    .select('*')
    .in('id', companyIds)
    .order('name', { ascending: true });

  if (companiesErr) throw new Error(companiesErr.message);

  return (companies ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    name: c.name as string,
    companyType: c.company_type as Company['companyType'],
    billingAddress: c.billing_address as string | null,
    billingCity: c.billing_city as string | null,
    billingState: c.billing_state as string | null,
    billingZip: c.billing_zip as string | null,
    shippingAddress: c.shipping_address as string | null,
    shippingCity: c.shipping_city as string | null,
    shippingState: c.shipping_state as string | null,
    shippingZip: c.shipping_zip as string | null,
    notes: c.notes as string | null,
    active: c.active as boolean,
    settings: c.settings as Company['settings'],
    createdAt: c.created_at as string,
    updatedAt: c.updated_at as string,
  }));
}

/**
 * Returns the set of distinct values for a given spec field key that are
 * present in at least one pricing table's `selection_criteria`.
 * Used by the wizard to filter dropdowns to only values that actually resolve
 * to a priced table — so a brand-new user can never select an unavailable spec.
 *
 * @param fieldKey  e.g. 'edge_construction', 'core_construction', 'gauge'
 * @param category  optional — restrict to tables of this category
 */
export async function getPricedSpecValues(
  fieldKey: string,
  category?: PricingTable['category'],
): Promise<string[]> {
  let q = supabase.from('pricing_tables').select('selection_criteria').eq('kind', 'base');
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error || !data) return [];

  const values = new Set<string>();
  for (const row of data) {
    const sc = (row.selection_criteria as Record<string, unknown>) ?? {};
    const val = sc[fieldKey];
    if (!val) continue;
    if (typeof val === 'string') values.add(val.trim());
    else if (val && typeof val === 'object' && Array.isArray((val as { in?: unknown[] }).in)) {
      for (const v of (val as { in: unknown[] }).in) {
        values.add(String(v).trim());
      }
    }
  }
  return [...values].sort();
}

/**
 * Returns distinct gauge values (as strings like "18") that appear in column
 * criteria across pricing tables of the given category.
 */
export async function getPricedGaugeValues(
  category?: PricingTable['category'],
): Promise<string[]> {
  let q = supabase.from('pricing_columns').select('criteria, pricing_tables!inner(kind, category)');
  // Join via FK — filter on kind='base' and optional category
  const { data, error } = await q;
  if (error || !data) return [];

  const values = new Set<string>();
  for (const row of (data as Record<string, unknown>[]) ?? []) {
    const tableData = row['pricing_tables'] as Record<string, unknown> | null;
    if (!tableData) continue;
    if (tableData['kind'] !== 'base') continue;
    if (category && tableData['category'] !== category) continue;
    const criteria = (row['criteria'] as Record<string, unknown>) ?? {};
    for (const key of ['gauge', 'material']) {
      const val = criteria[key];
      if (typeof val === 'string') values.add(val.trim());
    }
  }
  return [...values].sort();
}

/** Returns all companies that are manufacturers (company_type IN 'manufacturer','both'), sorted by name. */
export async function listManufacturerCompanies(): Promise<Company[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .in('company_type', ['manufacturer', 'both'])
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    name: c.name as string,
    companyType: c.company_type as Company['companyType'],
    billingAddress: c.billing_address as string | null,
    billingCity: c.billing_city as string | null,
    billingState: c.billing_state as string | null,
    billingZip: c.billing_zip as string | null,
    shippingAddress: c.shipping_address as string | null,
    shippingCity: c.shipping_city as string | null,
    shippingState: c.shipping_state as string | null,
    shippingZip: c.shipping_zip as string | null,
    notes: c.notes as string | null,
    active: c.active as boolean,
    settings: c.settings as Company['settings'],
    createdAt: c.created_at as string,
    updatedAt: c.updated_at as string,
  }));
}

/** Attaches a manufacturer company to a pricing table. */
export async function attachPricingTableVendor(
  tableId: string,
  companyId: string
): Promise<PricingTableVendor> {
  const { data, error } = await supabase
    .from('pricing_table_vendors')
    .insert({ pricing_table_id: tableId, company_id: companyId })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    pricingTableId: row.pricing_table_id as string,
    companyId: row.company_id as string,
    createdAt: row.created_at as string,
  };
}

/** Removes a manufacturer company from a pricing table. */
export async function detachPricingTableVendor(tableId: string, companyId: string): Promise<void> {
  const { error } = await supabase
    .from('pricing_table_vendors')
    .delete()
    .eq('pricing_table_id', tableId)
    .eq('company_id', companyId);

  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Lites / Louvers / Glass — grouped list view
// ---------------------------------------------------------------------------

/**
 * Returns the lites/louvers/glass list data for the grouped list view:
 *  - pricingTables: each pricing table with all its tagged items
 *  - untaggedItems: items from estimate_items not tagged to any pricing table
 */
export async function getLitesLouversGlassGroupedList(): Promise<LitesLouversGlassGroupedListResult> {
  // 1. Fetch all pricing tables for lites_louvers_glass with vendor + size data
  const { data: tables, error: tablesError } = await supabase
    .from('pricing_tables')
    .select(`
      id,
      name,
      updated_at,
      pricing_table_vendors (
        company_id,
        companies ( id, name )
      ),
      pricing_columns ( id ),
      pricing_rows ( id )
    `)
    .eq('category', 'lites_louvers_glass')
    .order('created_at', { ascending: true });

  if (tablesError) throw new Error(tablesError.message);

  const tableIds = (tables ?? []).map((t: Record<string, unknown>) => t.id as string);

  // 2. Fetch all pricing_table_items for these tables
  const taggedItemRows: { pricing_table_id: string; canonical_code: string; sort_order: number }[] = [];
  if (tableIds.length > 0) {
    const { data: ptiData, error: ptiError } = await supabase
      .from('pricing_table_items')
      .select('pricing_table_id, canonical_code, sort_order')
      .in('pricing_table_id', tableIds)
      .order('sort_order', { ascending: true });

    if (ptiError) throw new Error(ptiError.message);
    taggedItemRows.push(...(ptiData ?? []));
  }

  // 3. Fetch all lites/louvers/glass items to resolve labels
  const { data: allItems, error: itemsError } = await supabase
    .from('estimate_items')
    .select('canonical_code, item_label')
    .eq('item_type', 'lites_louvers_glass');

  if (itemsError) throw new Error(itemsError.message);

  // Build label map (first encountered label per code)
  const labelMap = new Map<string, string>();
  for (const item of allItems ?? []) {
    if (!labelMap.has(item.canonical_code)) {
      labelMap.set(item.canonical_code, item.item_label);
    }
  }

  // Build set of all tagged canonical_codes
  const taggedCodes = new Set(taggedItemRows.map((r) => r.canonical_code));

  // 4. Build pricing table groups
  const pricingTables = (tables ?? []).map((t: Record<string, unknown>) => {
    const vendors = ((t.pricing_table_vendors as { company_id: string; companies: { id: string; name: string } | null }[]) ?? []).map((v) => ({
      id: v.company_id,
      name: v.companies?.name ?? '',
    }));

    const tableItems = taggedItemRows
      .filter((r) => r.pricing_table_id === (t.id as string))
      .map((r) => ({
        canonicalCode: r.canonical_code,
        label: labelMap.get(r.canonical_code) ?? r.canonical_code,
      }));

    return {
      tableId: t.id as string,
      tableName: t.name as string,
      items: tableItems,
      rowCount: ((t.pricing_rows as unknown[]) ?? []).length,
      columnCount: ((t.pricing_columns as unknown[]) ?? []).length,
      lastUpdatedAt: t.updated_at as string,
      vendors,
    };
  });

  // 5. Untagged items: in estimate_items but not in any pricing_table_items
  const untaggedItems = [...labelMap.entries()]
    .filter(([code]) => !taggedCodes.has(code))
    .map(([canonicalCode, label]) => ({ canonicalCode, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { pricingTables, untaggedItems };
}

// ---------------------------------------------------------------------------
// Pricing Table Items (many-to-many junction)
// ---------------------------------------------------------------------------

/**
 * Returns all items tagged to a pricing table, enriched with display labels
 * fetched from estimate_items.
 */
export async function listPricingTableItems(tableId: string): Promise<PricingTableItem[]> {
  const { data, error } = await supabase
    .from('pricing_table_items')
    .select('*')
    .eq('pricing_table_id', tableId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  // Fetch labels from estimate_items for all canonical codes
  const codes = [...new Set((data as Record<string, unknown>[]).map((r) => r.canonical_code as string))];
  const { data: itemRows, error: itemsError } = await supabase
    .from('estimate_items')
    .select('canonical_code, item_label')
    .in('canonical_code', codes);

  if (itemsError) throw new Error(itemsError.message);

  // Build a label map (first encountered label per code)
  const labelMap = new Map<string, string>();
  for (const item of itemRows ?? []) {
    if (!labelMap.has(item.canonical_code)) {
      labelMap.set(item.canonical_code, item.item_label);
    }
  }

  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    pricingTableId: r.pricing_table_id as string,
    canonicalCode: r.canonical_code as string,
    itemType: r.item_type as string,
    itemLabel: labelMap.get(r.canonical_code as string) ?? (r.canonical_code as string),
    sortOrder: r.sort_order as number,
    createdAt: r.created_at as string,
  }));
}

/**
 * Attaches an item (canonical_code) to a pricing table.
 * No-ops if already linked (UNIQUE constraint).
 */
export async function addPricingTableItem(
  tableId: string,
  canonicalCode: string,
  itemType: string,
): Promise<PricingTableItem> {
  // Determine next sort_order
  const { data: existing } = await supabase
    .from('pricing_table_items')
    .select('sort_order')
    .eq('pricing_table_id', tableId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder = existing ? (existing.sort_order as number) + 1 : 0;

  const { data, error } = await supabase
    .from('pricing_table_items')
    .insert({ pricing_table_id: tableId, canonical_code: canonicalCode, item_type: itemType, sort_order: sortOrder })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  const r = data as Record<string, unknown>;

  // Fetch the item label
  const { data: itemRow } = await supabase
    .from('estimate_items')
    .select('item_label')
    .eq('canonical_code', canonicalCode)
    .limit(1)
    .maybeSingle();

  return {
    id: r.id as string,
    pricingTableId: r.pricing_table_id as string,
    canonicalCode: r.canonical_code as string,
    itemType: r.item_type as string,
    itemLabel: itemRow?.item_label ?? canonicalCode,
    sortOrder: r.sort_order as number,
    createdAt: r.created_at as string,
  };
}

/** Removes an item from a pricing table. */
export async function removePricingTableItem(tableId: string, canonicalCode: string): Promise<void> {
  const { error } = await supabase
    .from('pricing_table_items')
    .delete()
    .eq('pricing_table_id', tableId)
    .eq('canonical_code', canonicalCode);

  if (error) throw new Error(error.message);
}

/**
 * Returns all distinct items for a given item_type slug from estimate_items,
 * deduplicated by canonical_code. Used to populate the "Add Item" dropdown.
 */
export async function listItemsForCategory(
  itemTypeSlug: string,
): Promise<{ canonicalCode: string; label: string }[]> {
  const { data, error } = await supabase
    .from('estimate_items')
    .select('canonical_code, item_label')
    .eq('item_type', itemTypeSlug)
    .order('item_label', { ascending: true });

  if (error) throw new Error(error.message);

  const seen = new Map<string, string>();
  for (const row of data ?? []) {
    if (!seen.has(row.canonical_code)) {
      seen.set(row.canonical_code, row.item_label);
    }
  }

  return [...seen.entries()].map(([canonicalCode, label]) => ({ canonicalCode, label }));
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/** Appends a new column to a pricing table. */
export async function addPricingColumn(
  tableId: string,
  label: string,
  criteria: ColumnCriteria = {},
  parentColumnId?: string | null
): Promise<PricingColumn> {
  // Determine the next sort_order
  const { data: existing } = await supabase
    .from('pricing_columns')
    .select('sort_order')
    .eq('pricing_table_id', tableId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder = existing ? (existing.sort_order as number) + 1 : 0;

  const insertPayload: Record<string, unknown> = {
    pricing_table_id: tableId,
    label,
    criteria,
    sort_order: sortOrder,
  };
  if (parentColumnId) insertPayload.parent_column_id = parentColumnId;

  const { data, error } = await supabase
    .from('pricing_columns')
    .insert(insertPayload)
    .select('*')
    .single();

  return mapColumn(throwOnError(data as Record<string, unknown> | null, error));
}

/** Updates a column's label and/or criteria. */
export async function updatePricingColumn(
  id: string,
  updates: { label?: string; criteria?: ColumnCriteria }
): Promise<PricingColumn> {
  const { data, error } = await supabase
    .from('pricing_columns')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  return mapColumn(throwOnError(data as Record<string, unknown> | null, error));
}

/** Deletes a column (and its cells via CASCADE). */
export async function deletePricingColumn(id: string): Promise<void> {
  const { error } = await supabase.from('pricing_columns').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Reorders columns by writing each column's new sort_order in parallel.
 * `orderedIds` is the full list of column IDs in the desired display order.
 */
export async function reorderPricingColumns(tableId: string, orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from('pricing_columns')
        .update({ sort_order: index })
        .eq('id', id)
        .eq('pricing_table_id', tableId)
    )
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Appends a new row to a pricing table. */
export async function addPricingRow(
  tableId: string,
  label: string,
  widthCriteria: DimensionCriteria | Record<string, never> = {},
  heightCriteria: DimensionCriteria | Record<string, never> = {}
): Promise<PricingRow> {
  const { data: existing } = await supabase
    .from('pricing_rows')
    .select('sort_order')
    .eq('pricing_table_id', tableId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder = existing ? (existing.sort_order as number) + 1 : 0;

  const { data, error } = await supabase
    .from('pricing_rows')
    .insert({
      pricing_table_id: tableId,
      label,
      width_criteria: widthCriteria,
      height_criteria: heightCriteria,
      sort_order: sortOrder,
    })
    .select('*')
    .single();

  return mapRow(throwOnError(data as Record<string, unknown> | null, error));
}

/** Updates a row's label and/or criteria. */
export async function updatePricingRow(
  id: string,
  updates: {
    label?: string;
    widthCriteria?: DimensionCriteria | Record<string, never>;
    heightCriteria?: DimensionCriteria | Record<string, never>;
  }
): Promise<PricingRow> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.label !== undefined) dbUpdates.label = updates.label;
  if (updates.widthCriteria !== undefined) dbUpdates.width_criteria = updates.widthCriteria;
  if (updates.heightCriteria !== undefined) dbUpdates.height_criteria = updates.heightCriteria;

  const { data, error } = await supabase
    .from('pricing_rows')
    .update(dbUpdates)
    .eq('id', id)
    .select('*')
    .single();

  return mapRow(throwOnError(data as Record<string, unknown> | null, error));
}

/** Deletes a row (and its cells via CASCADE). */
export async function deletePricingRow(id: string): Promise<void> {
  const { error } = await supabase.from('pricing_rows').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Reorders rows by writing each row's new sort_order in parallel.
 * `orderedIds` is the full list of row IDs in the desired display order.
 */
export async function reorderPricingRows(tableId: string, orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from('pricing_rows')
        .update({ sort_order: index })
        .eq('id', id)
        .eq('pricing_table_id', tableId)
    )
  );
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export interface CellWriteOptions {
  /** Where this price came from. Defaults to 'manual'. */
  source?: PricingChangeSource | 'import';
  /** The approved proposal that produced this write, if any. */
  proposalId?: string | null;
}

/**
 * Append-only audit writer. Closes the previously-current history row for the
 * cell (sets effective_to = now) and inserts a new current row. Best-effort:
 * never throws so a history failure cannot block the actual cell write.
 */
async function appendCellHistory(
  cellId: string,
  price: number | null,
  currency: string,
  opts?: CellWriteOptions,
): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const changedBy = userData?.user?.id ?? null;
    const now = new Date().toISOString();

    await supabase
      .from('pricing_cell_history')
      .update({ effective_to: now })
      .eq('pricing_cell_id', cellId)
      .is('effective_to', null);

    await supabase.from('pricing_cell_history').insert({
      pricing_cell_id: cellId,
      price,
      currency,
      effective_from: now,
      source: opts?.source ?? 'manual',
      proposal_id: opts?.proposalId ?? null,
      changed_by: changedBy,
    });
  } catch {
    // Audit history must never block a price write.
  }
}

/**
 * Upserts a price into a cell. Creates the cell if it doesn't exist.
 * Every write is mirrored to pricing_cell_history for audit + effective dating.
 */
export async function upsertPricingCell(
  rowId: string,
  columnId: string,
  price: number | null,
  opts?: CellWriteOptions,
): Promise<PricingCell> {
  const { data, error } = await supabase
    .from('pricing_cells')
    .upsert(
      { pricing_row_id: rowId, pricing_column_id: columnId, price },
      { onConflict: 'pricing_row_id,pricing_column_id' }
    )
    .select('*')
    .single();

  const cell = mapCell(throwOnError(data as Record<string, unknown> | null, error));
  await appendCellHistory(cell.id, cell.price, cell.currency, opts);
  return cell;
}

/** Sets a cell's price to null (blank). Creates the cell row if it doesn't exist. */
export async function clearPricingCell(
  rowId: string,
  columnId: string,
  opts?: CellWriteOptions,
): Promise<void> {
  const { data, error } = await supabase
    .from('pricing_cells')
    .upsert(
      { pricing_row_id: rowId, pricing_column_id: columnId, price: null },
      { onConflict: 'pricing_row_id,pricing_column_id' }
    )
    .select('*')
    .single();

  const cell = mapCell(throwOnError(data as Record<string, unknown> | null, error));
  await appendCellHistory(cell.id, null, cell.currency, opts);
}

// ---------------------------------------------------------------------------
// Adder Cells
// ---------------------------------------------------------------------------

function mapAdderCell(row: Record<string, unknown>): PricingAdderCell {
  return {
    id: row.id as string,
    pricingTableId: row.pricing_table_id as string,
    canonicalCode: row.canonical_code as string,
    fieldDefinitionId: row.field_definition_id as string,
    optionValue: row.option_value as string,
    companyId: row.company_id as string,
    price: row.price as number | null,
    currency: row.currency as string,
    notes: row.notes as string | null,
    updatedAt: row.updated_at as string,
  };
}

/** Fetches all adder cells for a pricing table. */
export async function getAdderCells(tableId: string): Promise<PricingAdderCell[]> {
  const { data, error } = await supabase
    .from('pricing_adder_cells')
    .select('*')
    .eq('pricing_table_id', tableId);

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapAdderCell(r as Record<string, unknown>));
}

/** Upserts an adder cell price for a specific option value. Creates the row if it doesn't exist. */
export async function upsertAdderCell(params: {
  tableId: string;
  canonicalCode: string;
  fieldDefinitionId: string;
  optionValue: string;
  companyId: string;
  price: number | null;
}): Promise<PricingAdderCell> {
  const { data, error } = await supabase
    .from('pricing_adder_cells')
    .upsert(
      {
        pricing_table_id: params.tableId,
        canonical_code: params.canonicalCode,
        field_definition_id: params.fieldDefinitionId,
        option_value: params.optionValue,
        company_id: params.companyId,
        price: params.price,
      },
      { onConflict: 'pricing_table_id,canonical_code,field_definition_id,option_value,company_id' }
    )
    .select('*')
    .single();

  return mapAdderCell(throwOnError(data as Record<string, unknown> | null, error));
}

/** Clears the price of an adder cell (sets to null). */
export async function clearAdderCell(params: {
  tableId: string;
  canonicalCode: string;
  fieldDefinitionId: string;
  optionValue: string;
  companyId: string;
}): Promise<void> {
  const { error } = await supabase
    .from('pricing_adder_cells')
    .upsert(
      {
        pricing_table_id: params.tableId,
        canonical_code: params.canonicalCode,
        field_definition_id: params.fieldDefinitionId,
        option_value: params.optionValue,
        company_id: params.companyId,
        price: null,
      },
      { onConflict: 'pricing_table_id,canonical_code,field_definition_id,option_value,company_id' }
    );

  if (error) throw new Error(error.message);
}
