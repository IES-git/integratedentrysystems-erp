/**
 * Runtime pricing lookup engine.
 *
 * Resolves a unit price for an estimate item by matching its stored field values
 * (series, gauge, material, dimensions, etc.) against the pricing_tables /
 * pricing_rows / pricing_columns / pricing_cells grid in Supabase.
 *
 * Supported categories:
 *   - doors            (criteria-based column matching + adders)
 *   - frames           (hierarchical gauge→depth label matching + adders)
 *   - lites_louvers_glass (label-based width×height matching)
 *   - hardware         (returns category_unsupported — no tables yet)
 *
 * The caller is responsible for persisting the result onto estimate_items.
 */

import { supabase } from './supabase';
import { enqueueException, clearPendingException } from './pricing-exceptions-api';
import { dimensionMatches, parseDimension } from '@/components/pricing/dimension-utils';
import type {
  EstimateItem,
  EstimateOpeningWithItems,
  ItemField,
  PriceResult,
  PriceLookupMetadata,
  PriceLookupStatus,
  PricingColumn,
  PricingRow,
  VendorOverride,
} from '@/types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildResult(
  status: PriceLookupStatus,
  basePrice: number | null,
  adders: PriceResult['adders'],
  vendorId: string | null,
  metadata: Omit<PriceLookupMetadata, 'computedAt' | 'status' | 'warnings'>,
  warnings: string[] = [],
): PriceResult {
  const total =
    basePrice !== null
      ? basePrice + adders.reduce((s, a) => s + a.price, 0)
      : null;

  const fullMetadata: PriceLookupMetadata = {
    ...metadata,
    computedAt: new Date().toISOString(),
    status,
    warnings,
  };

  return {
    basePrice,
    adders,
    totalUnitPrice: total,
    vendorId,
    status,
    warnings,
    metadata: fullMetadata,
  };
}

function noResult(
  status: PriceLookupStatus,
  warning: string,
  tableId: string | null = null,
): PriceResult {
  return buildResult(
    status,
    null,
    [],
    null,
    { tableId, rowId: null, columnId: null, parentColumnId: null, adderCellIds: [], vendorId: null },
    [warning],
  );
}

/** Extract a field value by key from an array of ItemFields. */
function fieldValue(fields: ItemField[], key: string): string | null {
  return fields.find((f) => f.fieldKey === key)?.fieldValue ?? null;
}

/**
 * Parse a door-industry dimension string into total inches.
 *
 * Handles all formats found in the field wizard and pricing tables:
 *
 * 1. Compact nominal  (stored in item_fields by the wizard)
 *    "36"  → 3 ft 6 in  = 42"    "68"  → 6 ft 8 in  = 80"
 *    "30"  → 3 ft 0 in  = 36"    "210" → 2 ft 10 in = 34"
 *    Rule: first 1 char = feet, remaining 1–2 chars = inches (must be 0–11)
 *
 * 2. Feet-hyphen-inches  (pricing table labels / user manual entry)
 *    "2-0" → 24"   "3-6" → 42"   "2-10" → 34"
 *
 * 3. Feet-apostrophe-quote  (user manual entry)
 *    "6'8\""→ 80"  "7'0\"" → 84"
 *
 * 4. Plain integer inches  (fallback / OCR extracted)
 *    "80" → 80"  (NOTE: if the string also matches compact nominal it is
 *               parsed as nominal first — "80" = 8'0" = 96".  In practice
 *               users enter "68" not "80" for 6'8" doors, so this is safe.)
 *
 * Returns null when the string cannot be parsed.
 */
function parseDoorDimension(raw: string): number | null {
  if (!raw) return null;
  const s = raw.trim();

  // --- 2. feet-hyphen-inches: "2-0", "3-6", "2-10" ---
  const hyphen = s.match(/^(\d+)-(\d{1,2})$/);
  if (hyphen) {
    const ft = parseInt(hyphen[1], 10);
    const inch = parseInt(hyphen[2], 10);
    if (inch < 12) return ft * 12 + inch;
  }

  // --- 3. feet-apostrophe-quote: "6'8\"", "7'0\"" ---
  const apos = s.match(/^(\d+)'\s*(?:(\d+)")?$/);
  if (apos) {
    const ft = parseInt(apos[1], 10);
    const inch = apos[2] ? parseInt(apos[2], 10) : 0;
    return ft * 12 + inch;
  }

  // --- 1. compact nominal: "36" → 3 ft 6 in = 42", "68" → 6 ft 8 in = 80" ---
  // Only matches 2–3 digit all-numeric strings.
  if (/^\d{2,3}$/.test(s)) {
    const feet = parseInt(s.charAt(0), 10);
    const inches = parseInt(s.slice(1), 10);
    // Valid only when the inch component is 0–11 (genuine feet-inches notation)
    if (inches >= 0 && inches < 12) {
      return feet * 12 + inches;
    }
    // If inches >= 12 (e.g. "99"), fall through to plain integer
  }

  // --- 4. plain integer (1-digit or 4+ digit, or 2-3 digit with inch ≥ 12) ---
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  return null;
}

/**
 * Match a dimension criteria against a value in inches.
 *
 * Extends the base `dimensionMatches` to also handle `{ type: 'raw', label: '...' }`
 * criteria where the label is a comma-separated list of dimension strings
 * (e.g. "2-0, 2-4" → [24, 28], "3-4, 3-6, 3-8" → [40, 42, 44]).
 * This is how the pricing table editor stores grouped width ranges when the
 * user types a label like "2-0, 2-4" without clicking the structured criteria tool.
 */
function matchDimensionCriteria(
  criteria: Parameters<typeof dimensionMatches>[0] | Record<string, never>,
  inches: number,
): boolean {
  if (Object.keys(criteria).length === 0) return true; // empty = match all
  const c = criteria as Parameters<typeof dimensionMatches>[0];
  if (c.type === 'raw') {
    // Parse the raw label as a comma-separated list of dimension strings
    // Uses parseDoorDimension so "3-6" parses the same as stored nominal "36"
    const parts = (c as { type: 'raw'; label: string }).label
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.some((p) => parseDoorDimension(p) === inches);
  }
  return dimensionMatches(c, inches);
}

/**
 * Resolve which series value to use for a table lookup.
 *
 * Priority:
 *   1. `series` field value stored on the item (standard path)
 *   2. `item.itemLabel` — many items don't store a separate series field;
 *      the pricing table's series_value was derived from item_label via
 *      listDoorSeries(), so item_label is the correct fallback.
 */
function resolveSeriesValue(fields: ItemField[], itemLabel: string): string | null {
  return fieldValue(fields, 'series') ?? itemLabel ?? null;
}

/**
 * Match a pricing column against item field values.
 *
 * Strategy:
 *   1. If the column has JSON criteria (e.g. `{ "gauge": "18 Gauge" }`), match
 *      every key/value against the item's field map (case-insensitive).
 *   2. If the column has no criteria (empty `{}`), fall back to label matching:
 *      check whether the column label contains the gauge field value or vice
 *      versa.  This handles tables where gauge columns were added as plain
 *      labels ("18 Gauge") without filling in the criteria popover.
 */
function matchColumn(
  col: { id: string; label: string; criteria: Record<string, string | { type: 'in'; values: string[] }> },
  fieldMap: Record<string, string>,
): boolean {
  const criteria = col.criteria ?? {};

  // --- Criteria-based matching ---
  if (Object.keys(criteria).length > 0) {
    return Object.entries(criteria).every(([key, val]) => {
      const itemVal = fieldMap[key];
      if (!itemVal) return false;
      if (typeof val === 'string') {
        return itemVal.trim().toLowerCase() === val.trim().toLowerCase();
      }
      return val.values.some(
        (v) => itemVal.trim().toLowerCase() === v.trim().toLowerCase(),
      );
    });
  }

  // --- Label-based fallback for empty-criteria columns ---
  // Try the gauge field first (most common column discriminator for doors/frames)
  const gaugeVal = fieldMap['gauge'];
  if (gaugeVal) {
    const colLower = col.label.toLowerCase();
    const gaugeLower = gaugeVal.toLowerCase();
    if (colLower.includes(gaugeLower) || gaugeLower.includes(colLower)) return true;
  }

  // Also try matching the column label against any field that looks like a gauge
  // (field value ends with " gauge" or starts with a number and contains "ga")
  for (const [, val] of Object.entries(fieldMap)) {
    const colLower = col.label.toLowerCase();
    const valLower = val.toLowerCase();
    if (
      (valLower.includes('gauge') || valLower.match(/^\d+\s*ga/)) &&
      (colLower.includes(valLower) || valLower.includes(colLower))
    ) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Adder resolution (shared for doors + frames)
// ---------------------------------------------------------------------------

async function resolveAdders(
  tableId: string,
  canonicalCode: string,
  vendorId: string,
  fields: ItemField[],
): Promise<PriceResult['adders']> {
  // Fetch all adder cells for this table + canonical_code + vendor
  const { data, error } = await supabase
    .from('pricing_adder_cells')
    .select('id, field_definition_id, option_value, price, field_definitions(field_key, field_label)')
    .eq('pricing_table_id', tableId)
    .eq('canonical_code', canonicalCode)
    .eq('company_id', vendorId)
    .not('price', 'is', null);

  if (error || !data) return [];

  const adders: PriceResult['adders'] = [];

  for (const row of data) {
    const fieldDef = row.field_definitions as { field_key: string; field_label: string } | null;
    if (!fieldDef) continue;

    const itemFieldValue = fieldValue(fields, fieldDef.field_key);
    if (!itemFieldValue) continue;

    // Match if the item's selected value equals this adder cell's option_value
    if (itemFieldValue.trim().toLowerCase() === (row.option_value as string).trim().toLowerCase()) {
      adders.push({
        fieldKey: fieldDef.field_key,
        fieldLabel: fieldDef.field_label,
        optionValue: row.option_value as string,
        price: row.price as number,
        cellId: row.id as string,
      });
    }
  }

  return adders;
}

// ---------------------------------------------------------------------------
// Door lookup
// ---------------------------------------------------------------------------

async function resolveDoorPrice(
  item: EstimateItem,
  fields: ItemField[],
): Promise<PriceResult> {
  // Bug fix: doors often don't store a 'series' field — fall back to item label
  const series = resolveSeriesValue(fields, item.itemLabel);
  if (!series) return noResult('no_table', 'Could not determine series for door item');

  if (!item.manufacturerId) return noResult('no_vendor', 'No manufacturer selected for door item');

  // 1. Find pricing table: series_value must match AND manufacturer must be linked.
  //    Try exact series match first, then fall back to case-insensitive contains.
  let tableId: string | null = null;

  const { data: exactRows, error: tableErr } = await supabase
    .from('pricing_tables')
    .select('id, pricing_table_vendors!inner(company_id)')
    .eq('category', 'doors')
    .eq('series_value', series)
    .eq('pricing_table_vendors.company_id', item.manufacturerId)
    .limit(1);

  if (tableErr) return noResult('no_table', `DB error looking up door table: ${tableErr.message}`);

  if (exactRows && exactRows.length > 0) {
    tableId = exactRows[0].id as string;
  } else {
    // Fallback: load all door tables for this manufacturer and do a contains match
    const { data: allTables } = await supabase
      .from('pricing_tables')
      .select('id, series_value, pricing_table_vendors!inner(company_id)')
      .eq('category', 'doors')
      .eq('pricing_table_vendors.company_id', item.manufacturerId);

    const seriesLower = series.toLowerCase();
    const fuzzy = (allTables ?? []).find((t) => {
      const sv = (t.series_value as string).toLowerCase();
      return sv === seriesLower || sv.includes(seriesLower) || seriesLower.includes(sv);
    });
    tableId = fuzzy ? (fuzzy.id as string) : null;
  }

  if (!tableId) {
    return noResult('no_table', `No pricing table for door series "${series}" with selected manufacturer`);
  }

  // 2. Parse dimensions using the door-industry nominal format
  //    "36" = 3 ft 6 in = 42",  "68" = 6 ft 8 in = 80",  "3-0" = 36",  "6'8\"" = 80"
  const rawWidth = fieldValue(fields, 'opening_width');
  const rawHeight = fieldValue(fields, 'opening_height');
  const widthIn = rawWidth ? parseDoorDimension(rawWidth) : null;
  const heightIn = rawHeight ? parseDoorDimension(rawHeight) : null;

  if (widthIn === null) {
    return noResult('no_row', `Cannot parse width "${rawWidth}" — enter as nominal (36 = 3'6\"), hyphen (3-6), or plain inches`, tableId);
  }
  if (heightIn === null) {
    return noResult('no_row', `Cannot parse height "${rawHeight}" — enter as nominal (68 = 6'8\"), hyphen (6-8), or plain inches`, tableId);
  }

  // 3. Fetch all rows and match by width AND height
  const { data: rowData, error: rowErr } = await supabase
    .from('pricing_rows')
    .select('id, width_criteria, height_criteria')
    .eq('pricing_table_id', tableId);

  if (rowErr) return noResult('no_row', `DB error fetching rows: ${rowErr.message}`, tableId);

  const matchedRow = (rowData ?? []).find((r) => {
    const wc = r.width_criteria as Parameters<typeof dimensionMatches>[0] | Record<string, never>;
    const hc = r.height_criteria as Parameters<typeof dimensionMatches>[0] | Record<string, never>;
    return matchDimensionCriteria(wc, widthIn) && matchDimensionCriteria(hc, heightIn);
  });

  if (!matchedRow) {
    const availableWidths = (rowData ?? [])
      .map((r) => {
        const wc = r.width_criteria as { type?: string; label?: string; values?: number[] };
        return wc?.type === 'raw' ? wc.label : wc?.values?.join(', ');
      })
      .filter(Boolean)
      .join(' | ');
    return noResult(
      'no_row',
      `No row matches width=${widthIn}" height=${heightIn}". Available widths: ${availableWidths || 'none'}`,
      tableId,
    );
  }

  // 4. Fetch columns and match using gauge (and any other field criteria)
  const { data: colData, error: colErr } = await supabase
    .from('pricing_columns')
    .select('id, label, criteria, parent_column_id')
    .eq('pricing_table_id', tableId)
    .is('parent_column_id', null);

  if (colErr) return noResult('no_column', `DB error fetching columns: ${colErr.message}`, tableId);

  // Build a map of ALL field values from the item for multi-criteria matching
  const fieldMap = Object.fromEntries(fields.map((f) => [f.fieldKey, f.fieldValue]));

  const matchedCol = (colData ?? []).find((col) =>
    matchColumn(
      col as { id: string; label: string; criteria: Record<string, string | { type: 'in'; values: string[] }> },
      fieldMap,
    )
  );

  if (!matchedCol) {
    const gauge = fieldMap['gauge'] ?? '(no gauge)';
    const available = (colData ?? []).map((c) => c.label).join(', ');
    return noResult(
      'no_column',
      `No column matches gauge "${gauge}". Available columns: ${available || 'none'}`,
      tableId,
    );
  }

  // 5. Fetch the cell at (row, column)
  const { data: cellData, error: cellErr } = await supabase
    .from('pricing_cells')
    .select('id, price')
    .eq('pricing_row_id', matchedRow.id)
    .eq('pricing_column_id', matchedCol.id)
    .maybeSingle();

  if (cellErr) return noResult('no_cell', `DB error fetching cell: ${cellErr.message}`, tableId);
  if (!cellData || cellData.price === null) {
    return noResult('no_cell', `No price entered for this width/height/gauge combination`, tableId);
  }

  // 6. Resolve adders (optional surcharges on top of base price)
  const adders = await resolveAdders(tableId, item.canonicalCode, item.manufacturerId, fields);

  return buildResult(
    'matched',
    cellData.price as number,
    adders,
    item.manufacturerId,
    {
      tableId,
      rowId: matchedRow.id as string,
      columnId: matchedCol.id as string,
      parentColumnId: null,
      adderCellIds: adders.map((a) => a.cellId),
      vendorId: item.manufacturerId,
    },
  );
}

// ---------------------------------------------------------------------------
// Frame lookup
// ---------------------------------------------------------------------------

async function resolveFramePrice(
  item: EstimateItem,
  fields: ItemField[],
): Promise<PriceResult> {
  // Bug fix: fall back to item label if no series field
  const series = resolveSeriesValue(fields, item.itemLabel);
  if (!series) return noResult('no_table', 'Could not determine series for frame item');

  if (!item.manufacturerId) return noResult('no_vendor', 'No manufacturer selected for frame item');

  // Find table with series match + vendor, with fuzzy fallback
  let tableId: string | null = null;

  const { data: exactRows, error: tableErr } = await supabase
    .from('pricing_tables')
    .select('id, pricing_table_vendors!inner(company_id)')
    .eq('category', 'frames')
    .eq('series_value', series)
    .eq('pricing_table_vendors.company_id', item.manufacturerId)
    .limit(1);

  if (tableErr) return noResult('no_table', `DB error looking up frame table: ${tableErr.message}`);

  if (exactRows && exactRows.length > 0) {
    tableId = exactRows[0].id as string;
  } else {
    const { data: allTables } = await supabase
      .from('pricing_tables')
      .select('id, series_value, pricing_table_vendors!inner(company_id)')
      .eq('category', 'frames')
      .eq('pricing_table_vendors.company_id', item.manufacturerId);
    const seriesLower = series.toLowerCase();
    const fuzzy = (allTables ?? []).find((t) => {
      const sv = (t.series_value as string).toLowerCase();
      return sv === seriesLower || sv.includes(seriesLower) || seriesLower.includes(sv);
    });
    tableId = fuzzy ? (fuzzy.id as string) : null;
  }

  if (!tableId) {
    return noResult('no_table', `No pricing table for frame series "${series}" with selected manufacturer`);
  }

  const rawWidth = fieldValue(fields, 'opening_width');
  const rawHeight = fieldValue(fields, 'opening_height');
  const widthIn = rawWidth ? parseDoorDimension(rawWidth) : null;
  const heightIn = rawHeight ? parseDoorDimension(rawHeight) : null;

  if (widthIn === null) {
    return noResult('no_row', `Cannot parse frame width "${rawWidth}"`, tableId);
  }
  if (heightIn === null) {
    return noResult('no_row', `Cannot parse frame height "${rawHeight}"`, tableId);
  }

  const { data: rowData, error: rowErr } = await supabase
    .from('pricing_rows')
    .select('id, width_criteria, height_criteria')
    .eq('pricing_table_id', tableId);

  if (rowErr) return noResult('no_row', `DB error fetching rows: ${rowErr.message}`, tableId);

  const matchedRow = (rowData ?? []).find((r) => {
    const wc = r.width_criteria as Parameters<typeof dimensionMatches>[0] | Record<string, never>;
    const hc = r.height_criteria as Parameters<typeof dimensionMatches>[0] | Record<string, never>;
    return matchDimensionCriteria(wc, widthIn) && matchDimensionCriteria(hc, heightIn);
  });

  if (!matchedRow) {
    return noResult('no_row', `No frame row matches width=${widthIn}" height=${heightIn}"`, tableId);
  }

  // Frame columns are hierarchical: parent = gauge group, children = depths.
  // We match by label (gauge label contains gauge value, depth label contains depth value).
  const gaugeValue = fieldValue(fields, 'gauge');
  const depthValue = fieldValue(fields, 'depth');

  const { data: allColData, error: colErr } = await supabase
    .from('pricing_columns')
    .select('id, label, criteria, parent_column_id')
    .eq('pricing_table_id', tableId)
    .order('sort_order', { ascending: true });

  if (colErr) return noResult('no_column', `DB error fetching frame columns: ${colErr.message}`, tableId);

  const allCols = (allColData ?? []) as Pick<PricingColumn, 'id' | 'label' | 'parentColumnId'>[];

  // Parent columns have no parent_column_id
  const parentCols = allCols.filter((c) => !c.parentColumnId);
  const childColsByParent = new Map<string, typeof allCols>();
  for (const c of allCols) {
    if (c.parentColumnId) {
      const list = childColsByParent.get(c.parentColumnId) ?? [];
      list.push(c);
      childColsByParent.set(c.parentColumnId, list);
    }
  }

  // Find the gauge parent column (label match, case-insensitive contains)
  let matchedParentCol: (typeof allCols)[0] | null = null;
  if (gaugeValue) {
    matchedParentCol = parentCols.find((c) =>
      c.label.toLowerCase().includes(gaugeValue.toLowerCase()) ||
      gaugeValue.toLowerCase().includes(c.label.toLowerCase())
    ) ?? null;
  }
  // Fall through to first parent if only one exists
  if (!matchedParentCol && parentCols.length === 1) matchedParentCol = parentCols[0];

  if (!matchedParentCol) {
    return noResult('no_column', `No frame gauge column matches "${gaugeValue}"`, tableId);
  }

  const children = childColsByParent.get(matchedParentCol.id) ?? [];

  // If no children, use the parent column directly (flat frame tables)
  let targetColId: string;
  let targetParentColId: string | null = null;

  if (children.length === 0) {
    targetColId = matchedParentCol.id;
  } else {
    // Match child by depth label
    let matchedChild: (typeof allCols)[0] | null = null;
    if (depthValue) {
      matchedChild = children.find((c) =>
        c.label.toLowerCase().includes(depthValue.toLowerCase()) ||
        depthValue.toLowerCase().includes(c.label.toLowerCase())
      ) ?? null;
    }
    if (!matchedChild && children.length === 1) matchedChild = children[0];
    if (!matchedChild) {
      return noResult('no_column', `No frame depth column matches "${depthValue}" under gauge "${gaugeValue}"`, tableId);
    }
    targetColId = matchedChild.id;
    targetParentColId = matchedParentCol.id;
  }

  const { data: cellData, error: cellErr } = await supabase
    .from('pricing_cells')
    .select('id, price')
    .eq('pricing_row_id', matchedRow.id)
    .eq('pricing_column_id', targetColId)
    .maybeSingle();

  if (cellErr) return noResult('no_cell', `DB error fetching frame cell: ${cellErr.message}`, tableId);
  if (!cellData || cellData.price === null) {
    return noResult('no_cell', `Frame cell has no price`, tableId);
  }

  const adders = await resolveAdders(tableId, item.canonicalCode, item.manufacturerId, fields);

  return buildResult(
    'matched',
    cellData.price as number,
    adders,
    item.manufacturerId,
    {
      tableId,
      rowId: matchedRow.id as string,
      columnId: targetColId,
      parentColumnId: targetParentColId,
      adderCellIds: adders.map((a) => a.cellId),
      vendorId: item.manufacturerId,
    },
  );
}

// ---------------------------------------------------------------------------
// Lites / Louvers / Glass lookup
// ---------------------------------------------------------------------------

async function resolveFlatGridPrice(
  item: EstimateItem,
  fields: ItemField[],
  category: 'lites_louvers_glass' | 'panels',
): Promise<PriceResult> {
  const noun = category === 'panels' ? 'panel' : 'lite';
  // Find table via pricing_table_items (preferred) or legacy series_value match
  const { data: taggedRows, error: tagErr } = await supabase
    .from('pricing_table_items')
    .select('pricing_table_id')
    .eq('canonical_code', item.canonicalCode)
    .limit(1);

  if (tagErr) return noResult('no_table', `DB error finding ${noun} table: ${tagErr.message}`);

  let tableId: string | null = null;

  if (taggedRows && taggedRows.length > 0) {
    tableId = taggedRows[0].pricing_table_id as string;
  } else {
    // Legacy fallback: series_value = canonical_code
    const { data: legacyTable } = await supabase
      .from('pricing_tables')
      .select('id')
      .eq('category', category)
      .eq('series_value', item.canonicalCode)
      .maybeSingle();
    tableId = legacyTable?.id ?? null;
  }

  if (!tableId) {
    return noResult('no_table', `No pricing table found for ${noun} "${item.canonicalCode}"`);
  }

  // Lites use height (row) × width (column) matched by label
  const heightValue = fieldValue(fields, 'height') ?? fieldValue(fields, 'opening_height');
  const widthValue = fieldValue(fields, 'width') ?? fieldValue(fields, 'opening_width');

  const { data: rowData, error: rowErr } = await supabase
    .from('pricing_rows')
    .select('id, label')
    .eq('pricing_table_id', tableId);

  if (rowErr) return noResult('no_row', `DB error fetching ${noun} rows: ${rowErr.message}`, tableId);

  const { data: colData, error: colErr } = await supabase
    .from('pricing_columns')
    .select('id, label')
    .eq('pricing_table_id', tableId);

  if (colErr) return noResult('no_column', `DB error fetching ${noun} columns: ${colErr.message}`, tableId);

  // Match by label — try exact string, then dimension-aware (parse both sides)
  // Uses parseDoorDimension so nominal "36" (3'6"=42") matches label "3-6" or "3'6\""
  function matchLabel(label: string, value: string | null): boolean {
    if (!value) return false;
    if (label.trim().toLowerCase() === value.trim().toLowerCase()) return true;
    const labelIn = parseDoorDimension(label);
    const valueIn = parseDoorDimension(value);
    if (labelIn !== null && valueIn !== null) return labelIn === valueIn;
    return false;
  }

  const matchedRow = (rowData ?? []).find((r) => matchLabel(r.label as string, heightValue));
  const matchedCol = (colData ?? []).find((c) => matchLabel(c.label as string, widthValue));

  if (!matchedRow) {
    return noResult('no_row', `No ${noun} row matches height "${heightValue}"`, tableId);
  }
  if (!matchedCol) {
    return noResult('no_column', `No ${noun} column matches width "${widthValue}"`, tableId);
  }

  const { data: cellData, error: cellErr } = await supabase
    .from('pricing_cells')
    .select('id, price')
    .eq('pricing_row_id', matchedRow.id)
    .eq('pricing_column_id', matchedCol.id)
    .maybeSingle();

  if (cellErr) return noResult('no_cell', `DB error fetching ${noun} cell: ${cellErr.message}`, tableId);
  if (!cellData || cellData.price === null) {
    return noResult('no_cell', `${noun} cell has no price`, tableId);
  }

  return buildResult(
    'matched',
    cellData.price as number,
    [],
    item.manufacturerId,
    {
      tableId,
      rowId: matchedRow.id as string,
      columnId: matchedCol.id as string,
      parentColumnId: null,
      adderCellIds: [],
      vendorId: item.manufacturerId,
    },
  );
}

// ---------------------------------------------------------------------------
// Hardware lookup (flat per-item price list)
// ---------------------------------------------------------------------------

/**
 * Resolves a price for a hardware item from a flat price list ingested as a
 * pricing table (category 'hardware'). The table is located by the item's
 * canonical_code via pricing_table_items (preferred) or series_value, optionally
 * scoped to the item's manufacturer. The price is the single priced cell, or the
 * cell on the row whose label best matches the item's canonical_code / label.
 */
async function resolveHardwarePrice(
  item: EstimateItem,
  fields: ItemField[],
): Promise<PriceResult> {
  // 1. Find candidate table(s) tagged to this canonical_code.
  const { data: taggedRows, error: tagErr } = await supabase
    .from('pricing_table_items')
    .select('pricing_table_id')
    .eq('canonical_code', item.canonicalCode);

  if (tagErr) return noResult('no_table', `DB error finding hardware table: ${tagErr.message}`);

  let candidateTableIds = (taggedRows ?? []).map((r) => r.pricing_table_id as string);

  if (candidateTableIds.length === 0) {
    // Legacy fallback: series_value = canonical_code on a hardware table.
    const { data: legacy } = await supabase
      .from('pricing_tables')
      .select('id')
      .eq('category', 'hardware')
      .eq('series_value', item.canonicalCode);
    candidateTableIds = (legacy ?? []).map((r) => r.id as string);
  }

  if (candidateTableIds.length === 0) {
    return noResult('no_table', `No hardware pricing table for "${item.canonicalCode}"`);
  }

  // 2. Prefer a table linked to the item's manufacturer when one is set.
  let tableId = candidateTableIds[0];
  if (item.manufacturerId && candidateTableIds.length > 0) {
    const { data: vendorRows } = await supabase
      .from('pricing_table_vendors')
      .select('pricing_table_id')
      .in('pricing_table_id', candidateTableIds)
      .eq('company_id', item.manufacturerId);
    const match = (vendorRows ?? [])[0]?.pricing_table_id as string | undefined;
    if (match) tableId = match;
  }

  // 3. Fetch rows, columns, and cells; pick the best row + first column.
  const [{ data: rowData }, { data: colData }] = await Promise.all([
    supabase.from('pricing_rows').select('id, label').eq('pricing_table_id', tableId).order('sort_order', { ascending: true }),
    supabase.from('pricing_columns').select('id, label').eq('pricing_table_id', tableId).order('sort_order', { ascending: true }),
  ]);

  const rows = rowData ?? [];
  const cols = colData ?? [];
  if (rows.length === 0 || cols.length === 0) {
    return noResult('no_cell', 'Hardware table has no rows/columns', tableId);
  }

  const codeLower = item.canonicalCode.toLowerCase();
  const labelLower = item.itemLabel.toLowerCase();
  const matchedRow =
    rows.find((r) => {
      const l = (r.label as string).toLowerCase();
      return l === codeLower || l === labelLower || l.includes(codeLower) || codeLower.includes(l);
    }) ?? (rows.length === 1 ? rows[0] : null);

  if (!matchedRow) {
    return noResult('no_row', `No hardware row matches "${item.canonicalCode}"`, tableId);
  }

  const targetCol = cols[0];

  const { data: cellData, error: cellErr } = await supabase
    .from('pricing_cells')
    .select('id, price')
    .eq('pricing_row_id', matchedRow.id)
    .eq('pricing_column_id', targetCol.id)
    .maybeSingle();

  if (cellErr) return noResult('no_cell', `DB error fetching hardware cell: ${cellErr.message}`, tableId);
  if (!cellData || cellData.price === null) {
    return noResult('no_cell', 'Hardware cell has no price', tableId);
  }

  // Adders (e.g. finish surcharges) apply if configured for this item + vendor.
  const adders = item.manufacturerId
    ? await resolveAdders(tableId, item.canonicalCode, item.manufacturerId, fields)
    : [];

  return buildResult(
    'matched',
    cellData.price as number,
    adders,
    item.manufacturerId,
    {
      tableId,
      rowId: matchedRow.id as string,
      columnId: targetCol.id as string,
      parentColumnId: null,
      adderCellIds: adders.map((a) => a.cellId),
      vendorId: item.manufacturerId,
    },
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Hardware item types are dynamic slugs like 'hardware-hinge'; match the family prefix. */
function isHardwareCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return category === 'hardware' || category.startsWith('hardware-');
}

/**
 * Resolves a unit price for a single estimate item using its stored field values.
 * Never throws — returns a PriceResult with status='no_table' on any error.
 */
export async function resolveItemPrice(
  item: EstimateItem,
  fields: ItemField[],
): Promise<PriceResult> {
  try {
    const category = item.itemType;

    if (category === 'doors') return resolveDoorPrice(item, fields);
    if (category === 'frames') return resolveFramePrice(item, fields);
    if (category === 'lites_louvers_glass') return resolveFlatGridPrice(item, fields, 'lites_louvers_glass');
    if (category === 'panels') return resolveFlatGridPrice(item, fields, 'panels');
    if (isHardwareCategory(category) || item.subcategory) return resolveHardwarePrice(item, fields);

    return noResult('category_unsupported', `Pricing lookup not yet supported for category "${category ?? 'unknown'}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return noResult('no_table', `Unexpected error during pricing lookup: ${msg}`);
  }
}

/**
 * Normalizes an item's type into a pricing-category bucket used by vendor
 * overrides and the compare-vendors UI.
 */
export function normalizeCategoryKey(
  itemType: string | null | undefined,
  subcategory?: string | null,
): string {
  if (isHardwareCategory(itemType) || subcategory) return 'hardware';
  return itemType ?? 'unknown';
}

export interface ResolveOpeningOptions {
  /** What-if vendor override applied before resolving (read-only; never persists). */
  vendorOverride?: VendorOverride;
}

/**
 * Fetches all items and their fields for one opening and resolves prices for
 * each. Read-only — never persists. Returns a map of itemId → PriceResult.
 * Pass `vendorOverride` to price the opening under an alternate manufacturer
 * scenario (what-if comparison) without touching the database.
 */
export async function resolveOpeningPricing(
  openingId: string,
  opts: ResolveOpeningOptions = {},
): Promise<Map<string, PriceResult>> {
  const results = new Map<string, PriceResult>();

  // Fetch all items for this opening
  const { data: items, error: itemsErr } = await supabase
    .from('estimate_items')
    .select('*')
    .eq('opening_id', openingId);

  if (itemsErr || !items) return results;

  if (items.length === 0) return results;

  // Fetch all fields for these items in a single query
  const itemIds = items.map((i) => i.id as string);
  const { data: allFields, error: fieldsErr } = await supabase
    .from('item_fields')
    .select('*')
    .in('estimate_item_id', itemIds);

  if (fieldsErr) return results;

  // Group fields by item id
  const fieldsByItem = new Map<string, ItemField[]>();
  for (const f of allFields ?? []) {
    const list = fieldsByItem.get(f.estimate_item_id as string) ?? [];
    list.push({
      id: f.id as string,
      estimateItemId: f.estimate_item_id as string,
      fieldDefinitionId: f.field_definition_id as string | null,
      fieldKey: f.field_key as string,
      fieldLabel: f.field_label as string,
      fieldValue: f.field_value as string,
      valueType: f.value_type as ItemField['valueType'],
      sourceConfidence: f.source_confidence as number | null,
      createdAt: f.created_at as string,
      updatedAt: f.updated_at as string,
    });
    fieldsByItem.set(f.estimate_item_id as string, list);
  }

  // Resolve price for each item
  await Promise.all(
    items.map(async (rawItem) => {
      const item: EstimateItem = {
        id: rawItem.id as string,
        estimateId: rawItem.estimate_id as string | null,
        itemLabel: rawItem.item_label as string,
        canonicalCode: rawItem.canonical_code as string,
        quantity: rawItem.quantity as number,
        unitPrice: rawItem.unit_price as number | null,
        sortOrder: rawItem.sort_order as number,
        manufacturerId: rawItem.manufacturer_id as string | null,
        openingId: rawItem.opening_id as string | null,
        parentItemId: rawItem.parent_item_id as string | null,
        subcategory: rawItem.subcategory as EstimateItem['subcategory'],
        itemType: rawItem.item_type as string | null,
        isManualPriceOverride: rawItem.is_manual_price_override as boolean ?? false,
        createdAt: rawItem.created_at as string,
      };

      // Apply what-if vendor override (byItem wins over byCategory).
      const override =
        opts.vendorOverride?.byItem?.[item.id] ??
        opts.vendorOverride?.byCategory?.[normalizeCategoryKey(item.itemType, item.subcategory)];
      if (override) item.manufacturerId = override;

      const fields = fieldsByItem.get(item.id) ?? [];
      const result = await resolveItemPrice(item, fields);
      results.set(item.id, result);
    })
  );

  return results;
}

/**
 * Refreshes prices for all non-manually-overridden items across an entire estimate.
 * Writes unit_price, price_source, and price_lookup_metadata back to each item.
 *
 * Returns a summary of how many items were updated and any warnings.
 */
export async function refreshEstimatePricing(estimateId: string): Promise<{
  updated: number;
  skipped: number;
  warnings: { itemLabel: string; status: PriceLookupStatus; message: string }[];
}> {
  // 1. Fetch all items for the estimate that are NOT manually overridden
  const { data: items, error: itemsErr } = await supabase
    .from('estimate_items')
    .select('*')
    .eq('estimate_id', estimateId)
    .eq('is_manual_price_override', false);

  if (itemsErr) throw new Error(`Failed to fetch items: ${itemsErr.message}`);
  if (!items || items.length === 0) return { updated: 0, skipped: 0, warnings: [] };

  const itemIds = items.map((i) => i.id as string);

  // 2. Fetch all fields for these items
  const { data: allFields, error: fieldsErr } = await supabase
    .from('item_fields')
    .select('*')
    .in('estimate_item_id', itemIds);

  if (fieldsErr) throw new Error(`Failed to fetch fields: ${fieldsErr.message}`);

  const fieldsByItem = new Map<string, ItemField[]>();
  for (const f of allFields ?? []) {
    const list = fieldsByItem.get(f.estimate_item_id as string) ?? [];
    list.push({
      id: f.id as string,
      estimateItemId: f.estimate_item_id as string,
      fieldDefinitionId: f.field_definition_id as string | null,
      fieldKey: f.field_key as string,
      fieldLabel: f.field_label as string,
      fieldValue: f.field_value as string,
      valueType: f.value_type as ItemField['valueType'],
      sourceConfidence: f.source_confidence as number | null,
      createdAt: f.created_at as string,
      updatedAt: f.updated_at as string,
    });
    fieldsByItem.set(f.estimate_item_id as string, list);
  }

  let updated = 0;
  let skipped = 0;
  const warnings: { itemLabel: string; status: PriceLookupStatus; message: string }[] = [];

  // 3. Resolve and persist prices in parallel batches
  await Promise.all(
    items.map(async (rawItem) => {
      const item: EstimateItem = {
        id: rawItem.id as string,
        estimateId: rawItem.estimate_id as string | null,
        itemLabel: rawItem.item_label as string,
        canonicalCode: rawItem.canonical_code as string,
        quantity: rawItem.quantity as number,
        unitPrice: rawItem.unit_price as number | null,
        sortOrder: rawItem.sort_order as number,
        manufacturerId: rawItem.manufacturer_id as string | null,
        openingId: rawItem.opening_id as string | null,
        parentItemId: rawItem.parent_item_id as string | null,
        subcategory: rawItem.subcategory as EstimateItem['subcategory'],
        itemType: rawItem.item_type as string | null,
        isManualPriceOverride: false,
        createdAt: rawItem.created_at as string,
      };

      const fields = fieldsByItem.get(item.id) ?? [];
      const result = await resolveItemPrice(item, fields);

      if (result.status === 'category_unsupported') {
        skipped++;
        return;
      }

      // Persist back to the database
      const { error: updateErr } = await supabase
        .from('estimate_items')
        .update({
          unit_price: result.totalUnitPrice,
          price_source: result.status === 'matched' ? 'lookup' : null,
          price_lookup_metadata: result.metadata,
          manufacturer_id: result.vendorId ?? rawItem.manufacturer_id,
        })
        .eq('id', item.id);

      if (updateErr) {
        warnings.push({ itemLabel: item.itemLabel, status: result.status, message: `Failed to persist: ${updateErr.message}` });
        return;
      }

      if (result.status === 'matched') {
        updated++;
        await clearPendingException(item.id).catch(() => { /* best-effort */ });
      } else {
        warnings.push({ itemLabel: item.itemLabel, status: result.status, message: result.warnings[0] ?? result.status });
        await enqueueExceptionForResult(item, fields, result).catch(() => { /* best-effort */ });
      }
    })
  );

  return { updated, skipped, warnings };
}

/**
 * Builds context (item fields + the resolved table's candidate rows/columns)
 * and enqueues a pending pricing exception for a failed lookup. Best-effort.
 */
async function enqueueExceptionForResult(
  item: EstimateItem,
  fields: ItemField[],
  result: PriceResult,
): Promise<void> {
  const tableId = result.metadata.tableId;
  let availableRows: { id: string; label: string }[] | undefined;
  let availableColumns: { id: string; label: string }[] | undefined;

  if (tableId) {
    const [{ data: r }, { data: c }] = await Promise.all([
      supabase.from('pricing_rows').select('id, label').eq('pricing_table_id', tableId).order('sort_order', { ascending: true }),
      supabase.from('pricing_columns').select('id, label').eq('pricing_table_id', tableId).order('sort_order', { ascending: true }),
    ]);
    availableRows = (r ?? []).map((x) => ({ id: x.id as string, label: x.label as string }));
    availableColumns = (c ?? []).map((x) => ({ id: x.id as string, label: x.label as string }));
  }

  await enqueueException({
    estimateItemId: item.id,
    estimateId: item.estimateId,
    itemLabel: item.itemLabel,
    lookupStatus: result.status,
    context: {
      itemType: item.itemType ?? null,
      manufacturerId: item.manufacturerId,
      fields: fields.map((f) => ({ key: f.fieldKey, value: f.fieldValue })),
      warning: result.warnings[0] ?? null,
      tableId,
      availableRows,
      availableColumns,
    },
  });
}

/**
 * Convenience: resolve and persist price for a single item right after it is saved.
 * Silently no-ops on any error so opening save is never blocked.
 */
export async function resolveAndPersistItemPrice(
  itemId: string,
  item: EstimateItem,
  fields: ItemField[],
): Promise<void> {
  try {
    const result = await resolveItemPrice(item, fields);
    if (result.status === 'category_unsupported') return;

    await supabase
      .from('estimate_items')
      .update({
        unit_price: result.totalUnitPrice,
        price_source: result.status === 'matched' ? 'lookup' : null,
        price_lookup_metadata: result.metadata,
      })
      .eq('id', itemId);
  } catch {
    // Pricing lookup errors must never block the opening save
  }
}

// Re-export for use in components
export type { PriceResult, PriceLookupStatus, PriceLookupMetadata };
