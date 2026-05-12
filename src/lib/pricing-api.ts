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
  PricingColumn,
  PricingRow,
  PricingCell,
  PricingAdderCell,
  DimensionCriteria,
  ColumnCriteria,
  DoorSeriesSummary,
  Company,
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
  fieldValueOptionId?: string
): Promise<PricingTable> {
  const { data, error } = await supabase
    .from('pricing_tables')
    .insert({
      category,
      series_value: seriesValue,
      name,
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
// Columns
// ---------------------------------------------------------------------------

/** Appends a new column to a pricing table. */
export async function addPricingColumn(
  tableId: string,
  label: string,
  criteria: ColumnCriteria = {}
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

  const { data, error } = await supabase
    .from('pricing_columns')
    .insert({ pricing_table_id: tableId, label, criteria, sort_order: sortOrder })
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

/** Upserts a price into a cell. Creates the cell if it doesn't exist. */
export async function upsertPricingCell(
  rowId: string,
  columnId: string,
  price: number | null
): Promise<PricingCell> {
  const { data, error } = await supabase
    .from('pricing_cells')
    .upsert(
      { pricing_row_id: rowId, pricing_column_id: columnId, price },
      { onConflict: 'pricing_row_id,pricing_column_id' }
    )
    .select('*')
    .single();

  return mapCell(throwOnError(data as Record<string, unknown> | null, error));
}

/** Sets a cell's price to null (blank). Creates the cell row if it doesn't exist. */
export async function clearPricingCell(rowId: string, columnId: string): Promise<void> {
  const { error } = await supabase
    .from('pricing_cells')
    .upsert(
      { pricing_row_id: rowId, pricing_column_id: columnId, price: null },
      { onConflict: 'pricing_row_id,pricing_column_id' }
    );

  if (error) throw new Error(error.message);
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
