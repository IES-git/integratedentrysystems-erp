/**
 * Supabase-backed CRUD operations for Quotes and Quote Items.
 */

import { supabase } from './supabase';
import type { Quote, QuoteItem, QuoteLineSnapshot, QuoteWithItems, QuoteStatus, QuoteType, HardwareSubcategory } from '@/types';
import type { EstimateItem, ItemField } from '@/types';

let supportsQuoteDisplayConfig = true;
let supportsQuoteItemDisplayKey = true;
let supportsQuoteLineSnapshots = true;

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const maybeError = error as { code?: string; message?: string; details?: string };
  const text = `${maybeError?.message ?? ''} ${maybeError?.details ?? ''}`.toLowerCase();
  return maybeError?.code === 'PGRST204' && text.includes(columnName.toLowerCase());
}

function readSnapshotNumber(
  snapshotJson: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = snapshotJson?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getSnapshotProductGroup(snapshot: QuoteLineSnapshot): string | null {
  const source =
    snapshot.chargeCategory ??
    snapshot.entityType ??
    snapshot.sourceLineType ??
    null;
  return source ? titleCaseToken(source) : null;
}

function titleCaseToken(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// ---------------------------------------------------------------------------
// Email sending
// ---------------------------------------------------------------------------

export interface SendQuoteEmailInput {
  quoteId: string;
  recipientEmail: string;
  ccEmails?: string[];
  subject: string;
  message: string;
  /** Customer-facing quote PDF, base64-encoded. */
  pdfBase64: string;
  pdfFileName: string;
  /** Optional manufacturer RFQ PDF, base64-encoded. */
  manufacturerPdfBase64?: string;
  manufacturerPdfFileName?: string;
}

export interface SendQuoteEmailResult {
  quote: Quote;
}

/**
 * Invoke the send-quote-email Supabase Edge Function.
 * On success, the edge function flips the quote status to 'sent' and
 * stamps sent_at / sent_to_email; returns the updated quote.
 */
export async function sendQuoteEmail(
  input: SendQuoteEmailInput
): Promise<SendQuoteEmailResult> {
  const { data, error } = await supabase.functions.invoke('send-quote-email', {
    body: input,
  });

  if (error) {
    throw new Error(`Failed to send quote email: ${error.message}`);
  }

  if (!data?.quote) {
    throw new Error('Unexpected response from send-quote-email function');
  }

  return { quote: mapQuoteRow(data.quote) };
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateQuoteItemInput {
  estimateItemId: string | null;
  displayKey?: string | null;
  itemLabel: string;
  canonicalCode?: string | null;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder?: number;
}

export interface CreateQuoteLineSnapshotInput {
  quoteItemId?: string | null;
  estimateId?: string | null;
  estimateLineId?: string | null;
  estimateItemId?: string | null;
  openingId?: string | null;
  componentId?: string | null;
  sourceTable: 'estimate_line' | 'estimate_items' | string;
  sourceLineType?: string | null;
  entityType?: string | null;
  chargeCategory?: string | null;
  description?: string | null;
  selectedOptionCode?: string | null;
  quantity?: number | null;
  unitOfMeasure?: string | null;
  unitListPrice?: number | null;
  extendedListPrice?: number | null;
  discountMultiplier?: number | null;
  extendedNetPrice?: number | null;
  sellPrice?: number | null;
  manualSellPrice?: number | null;
  unitSellPrice?: number | null;
  lineTotal?: number | null;
  priceStatus?: string | null;
  reviewStatus?: string | null;
  sortOrder?: number;
  snapshotJson?: Record<string, unknown>;
}

export interface CreateQuoteInput {
  estimateId: string;
  companyId?: string | null;
  createdByUserId: string;
  quoteType: QuoteType;
  markupMultiplier: number;
  subtotal: number;
  total: number;
  currency?: string;
  notes?: string | null;
  displayConfigJson?: string | null;
  items: CreateQuoteItemInput[];
  snapshots?: CreateQuoteLineSnapshotInput[];
}

export interface UpdateQuoteInput {
  status?: QuoteStatus;
  notes?: string | null;
  markupMultiplier?: number;
  subtotal?: number;
  total?: number;
  displayConfigJson?: string | null;
  items?: CreateQuoteItemInput[];
  snapshots?: CreateQuoteLineSnapshotInput[];
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Insert a quote and all its line items in a single transaction-like sequence.
 * If item insertion fails the quote row is rolled back.
 */
export async function createQuote(input: CreateQuoteInput): Promise<Quote> {
  const quoteInsert: Record<string, unknown> = {
      estimate_id: input.estimateId,
      company_id: input.companyId ?? null,
      created_by_user_id: input.createdByUserId,
      quote_type: input.quoteType,
      markup_multiplier: input.markupMultiplier,
      subtotal: input.subtotal,
      total: input.total,
      currency: input.currency ?? 'USD',
      notes: input.notes ?? null,
      status: 'draft',
      priced_as_of: new Date().toISOString(),
  };

  if (supportsQuoteDisplayConfig) {
    quoteInsert.display_config_json = input.displayConfigJson ?? null;
  }

  let { data: quoteRow, error: quoteError } = await supabase
    .from('quotes')
    .insert(quoteInsert)
    .select()
    .single();

  if (quoteError && isMissingColumnError(quoteError, 'display_config_json')) {
    supportsQuoteDisplayConfig = false;
    delete quoteInsert.display_config_json;
    const retry = await supabase.from('quotes').insert(quoteInsert).select().single();
    quoteRow = retry.data;
    quoteError = retry.error;
  }

  if (quoteError || !quoteRow) {
    throw new Error(`Failed to create quote: ${quoteError?.message}`);
  }

  if (input.items.length > 0) {
    const buildQuoteItemRows = (includeDisplayKey: boolean) =>
      input.items.map((item, idx) => ({
        quote_id: quoteRow.id,
        estimate_item_id: item.estimateItemId ?? null,
        ...(includeDisplayKey ? { display_key: item.displayKey ?? null } : {}),
        item_label: item.itemLabel,
        canonical_code: item.canonicalCode ?? null,
        quantity: item.quantity,
        unit_cost: item.unitCost,
        unit_price: item.unitPrice,
        line_total: item.lineTotal,
        sort_order: item.sortOrder ?? idx,
      }));

    let { error: itemsError } = await supabase
      .from('quote_items')
      .insert(buildQuoteItemRows(supportsQuoteItemDisplayKey));

    if (itemsError && isMissingColumnError(itemsError, 'display_key')) {
      supportsQuoteItemDisplayKey = false;
      const retry = await supabase.from('quote_items').insert(buildQuoteItemRows(false));
      itemsError = retry.error;
    }

    if (itemsError) {
      // Attempt rollback
      await supabase.from('quotes').delete().eq('id', quoteRow.id);
      throw new Error(`Failed to create quote items: ${itemsError.message}`);
    }
  }

  if (input.snapshots && input.snapshots.length > 0) {
    try {
      await replaceQuoteLineSnapshots(quoteRow.id as string, input.snapshots);
    } catch (err) {
      await supabase.from('quotes').delete().eq('id', quoteRow.id);
      throw err;
    }
  }

  return mapQuoteRow(quoteRow);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Fetch a single quote by ID. Returns null if not found. */
export async function getQuote(id: string): Promise<Quote | null> {
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch quote: ${error.message}`);
  }

  return mapQuoteRow(data);
}

/**
 * Fetch a quote together with its items and each item's source `item_fields`
 * (from the original estimate). The `item_fields` are needed to render the
 * full technical spec grid in the Manufacturer Quote PDF.
 */
export async function getQuoteWithItems(id: string): Promise<{
  quote: Quote;
  items: (QuoteItem & { fields: ItemField[]; parentItemId: string | null; subcategory: HardwareSubcategory | null })[];
  snapshots: QuoteLineSnapshot[];
} | null> {
  const { data: quoteRow, error: quoteError } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', id)
    .single();

  if (quoteError) {
    if (quoteError.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch quote: ${quoteError.message}`);
  }

  const { data: itemRows, error: itemsError } = await supabase
    .from('quote_items')
    .select('*')
    .eq('quote_id', id)
    .order('sort_order', { ascending: true });

  if (itemsError) {
    throw new Error(`Failed to fetch quote items: ${itemsError.message}`);
  }

  let snapshotRows: unknown[] = [];
  if (supportsQuoteLineSnapshots) {
    const { data, error } = await supabase
      .from('quote_line_snapshots')
      .select('*')
      .eq('quote_id', id)
      .order('sort_order', { ascending: true });

    if (error) {
      supportsQuoteLineSnapshots = false;
    } else {
      snapshotRows = data ?? [];
    }
  }
  const snapshots = snapshotRows.map((row) => mapQuoteLineSnapshotRow(row));
  const snapshotByDisplayKey = new Map<string, QuoteLineSnapshot>();
  for (const snapshot of snapshots) {
    const displayKey = typeof snapshot.snapshotJson?.displayKey === 'string'
      ? snapshot.snapshotJson.displayKey
      : null;
    if (displayKey && !snapshotByDisplayKey.has(displayKey)) {
      snapshotByDisplayKey.set(displayKey, snapshot);
    }
    if (snapshot.estimateItemId) {
      const estimateItemKey = `estimate-item:${snapshot.estimateItemId}`;
      if (!snapshotByDisplayKey.has(estimateItemKey)) snapshotByDisplayKey.set(estimateItemKey, snapshot);
    }
    if (snapshot.estimateLineId) {
      const estimateLineKey = `engine-line:${snapshot.estimateLineId}`;
      if (!snapshotByDisplayKey.has(estimateLineKey)) snapshotByDisplayKey.set(estimateLineKey, snapshot);
    }
  }

  const openingIds = Array.from(new Set(snapshots.map((snapshot) => snapshot.openingId).filter(Boolean))) as string[];
  const openingNameById: Record<string, string> = {};
  if (openingIds.length > 0) {
    const { data: openingRows } = await supabase
      .from('estimate_openings')
      .select('id, name')
      .in('id', openingIds);
    for (const row of openingRows ?? []) {
      openingNameById[row.id as string] = row.name as string;
    }
  }

  // Fetch item_fields for each source estimate_item so the manufacturer PDF
  // can render the full technical spec grid.
  const estimateItemIds = (itemRows ?? [])
    .map((r) => r.estimate_item_id)
    .filter(Boolean) as string[];

  let fieldsByEstimateItemId: Record<string, ItemField[]> = {};
  let estimateItemMetaById: Record<string, { parentItemId: string | null; subcategory: HardwareSubcategory | null }> = {};

  if (estimateItemIds.length > 0) {
    const [fieldRes, metaRes] = await Promise.all([
      supabase.from('item_fields').select('*').in('estimate_item_id', estimateItemIds),
      supabase
        .from('estimate_items')
        .select('id, parent_item_id, subcategory')
        .in('id', estimateItemIds),
    ]);

    if (fieldRes.error) {
      throw new Error(`Failed to fetch item fields: ${fieldRes.error.message}`);
    }

    fieldsByEstimateItemId = (fieldRes.data ?? []).reduce<Record<string, ItemField[]>>(
      (acc, row) => {
        const key: string = row.estimate_item_id;
        if (!acc[key]) acc[key] = [];
        acc[key].push(mapItemFieldRow(row));
        return acc;
      },
      {}
    );

    for (const r of metaRes.data ?? []) {
      estimateItemMetaById[r.id] = {
        parentItemId: r.parent_item_id ?? null,
        subcategory: (r.subcategory as HardwareSubcategory | null) ?? null,
      };
    }
  }

  const items = (itemRows ?? []).map((row) => {
    const base = mapQuoteItemRow(row);
    const snapshot = base.displayKey ? snapshotByDisplayKey.get(base.displayKey) ?? null : null;
    const meta = row.estimate_item_id ? (estimateItemMetaById[row.estimate_item_id] ?? null) : null;
    return {
      ...base,
      fields: row.estimate_item_id ? (fieldsByEstimateItemId[row.estimate_item_id] ?? []) : [],
      parentItemId: meta?.parentItemId ?? null,
      subcategory: meta?.subcategory ?? null,
      openingId: snapshot?.openingId ?? null,
      openingName: snapshot?.openingId ? openingNameById[snapshot.openingId] ?? null : null,
      productGroup: snapshot ? getSnapshotProductGroup(snapshot) : null,
      unitOfMeasure: snapshot?.unitOfMeasure ?? null,
      grossMargin: readSnapshotNumber(snapshot?.snapshotJson, 'grossMargin'),
      grossMarginPct: readSnapshotNumber(snapshot?.snapshotJson, 'grossMarginPct'),
    };
  });

  return {
    quote: mapQuoteRow(quoteRow),
    items,
    snapshots,
  };
}

/** List all quotes, most recent first. */
export async function listQuotes(): Promise<Quote[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list quotes: ${error.message}`);
  return (data ?? []).map(mapQuoteRow);
}

/**
 * List all quotes with their line item codes (id, canonical_code, item_label only).
 * Used by the quotes list page for search-by-item-code.
 */
export async function listQuotesWithItems(): Promise<QuoteWithItems[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select(`
      *,
      quote_items (
        id,
        canonical_code,
        item_label
      )
    `)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list quotes with items: ${error.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    ...mapQuoteRow(row),
    items: (row.quote_items || []).map((item: any) => ({
      id: item.id,
      canonicalCode: item.canonical_code ?? '',
      itemLabel: item.item_label,
    })),
  }));
}

/** List all quotes for a specific estimate. */
export async function listQuotesByEstimate(estimateId: string): Promise<Quote[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('estimate_id', estimateId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list quotes for estimate: ${error.message}`);
  return (data ?? []).map(mapQuoteRow);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/** Update a quote's status. */
export async function updateQuoteStatus(
  id: string,
  status: QuoteStatus
): Promise<Quote> {
  const { data, error } = await supabase
    .from('quotes')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update quote status: ${error.message}`);
  return mapQuoteRow(data);
}

/** Update editable quote fields (notes, status, totals). */
export async function updateQuote(
  id: string,
  updates: UpdateQuoteInput
): Promise<Quote> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.notes !== undefined) row.notes = updates.notes;
  if (updates.markupMultiplier !== undefined) row.markup_multiplier = updates.markupMultiplier;
  if (updates.subtotal !== undefined) row.subtotal = updates.subtotal;
  if (updates.total !== undefined) row.total = updates.total;
  if (updates.displayConfigJson !== undefined && supportsQuoteDisplayConfig) {
    row.display_config_json = updates.displayConfigJson;
  }

  let { data, error } = await supabase
    .from('quotes')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error && isMissingColumnError(error, 'display_config_json')) {
    supportsQuoteDisplayConfig = false;
    delete row.display_config_json;
    const retry = await supabase.from('quotes').update(row).eq('id', id).select().single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw new Error(`Failed to update quote: ${error.message}`);
  return mapQuoteRow(data);
}

/** Update a quote and replace its line items with the current builder output. */
export async function updateQuoteWithItems(
  id: string,
  updates: UpdateQuoteInput & { items: CreateQuoteItemInput[] }
): Promise<Quote> {
  const { data: existingRows, error: existingError } = await supabase
    .from('quote_items')
    .select('id')
    .eq('quote_id', id);

  if (existingError) {
    throw new Error(`Failed to fetch existing quote items: ${existingError.message}`);
  }

  const updatedQuote = await updateQuote(id, updates);
  const existingItemIds = (existingRows ?? []).map((row) => row.id as string);
  let insertedItemIds: string[] = [];

  if (updates.items.length > 0) {
    const buildQuoteItemRows = (includeDisplayKey: boolean) =>
      updates.items.map((item, idx) => ({
        quote_id: id,
        estimate_item_id: item.estimateItemId ?? null,
        ...(includeDisplayKey ? { display_key: item.displayKey ?? null } : {}),
        item_label: item.itemLabel,
        canonical_code: item.canonicalCode ?? null,
        quantity: item.quantity,
        unit_cost: item.unitCost,
        unit_price: item.unitPrice,
        line_total: item.lineTotal,
        sort_order: item.sortOrder ?? idx,
      }));

    let { data: insertedRows, error: itemsError } = await supabase
      .from('quote_items')
      .insert(buildQuoteItemRows(supportsQuoteItemDisplayKey))
      .select('id');

    if (itemsError && isMissingColumnError(itemsError, 'display_key')) {
      supportsQuoteItemDisplayKey = false;
      const retry = await supabase
        .from('quote_items')
        .insert(buildQuoteItemRows(false))
        .select('id');
      insertedRows = retry.data;
      itemsError = retry.error;
    }

    if (itemsError) {
      throw new Error(`Failed to update quote items: ${itemsError.message}`);
    }

    insertedItemIds = (insertedRows ?? []).map((row) => row.id as string);
  }

  if (existingItemIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('quote_items')
      .delete()
      .in('id', existingItemIds);

    if (deleteError) {
      if (insertedItemIds.length > 0) {
        await supabase.from('quote_items').delete().in('id', insertedItemIds);
      }
      throw new Error(`Failed to remove old quote items: ${deleteError.message}`);
    }
  }

  if (updates.snapshots) {
    await replaceQuoteLineSnapshots(id, updates.snapshots);
  }

  return updatedQuote;
}

async function replaceQuoteLineSnapshots(
  quoteId: string,
  snapshots: CreateQuoteLineSnapshotInput[]
): Promise<void> {
  if (!supportsQuoteLineSnapshots) return;

  const { error: deleteError } = await supabase
    .from('quote_line_snapshots')
    .delete()
    .eq('quote_id', quoteId);

  if (deleteError) {
    supportsQuoteLineSnapshots = false;
    return;
  }

  if (snapshots.length === 0) return;

  const { error: insertError } = await supabase
    .from('quote_line_snapshots')
    .insert(snapshots.map((snapshot, idx) => quoteLineSnapshotInputToRow(quoteId, snapshot, idx)));

  if (insertError) {
    throw new Error(`Failed to save quote detail snapshots: ${insertError.message}`);
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Delete a quote (cascades to quote_items). */
export async function deleteQuote(id: string): Promise<void> {
  const { error } = await supabase.from('quotes').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete quote: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Row Mappers  (snake_case DB rows  →  camelCase TypeScript types)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapQuoteRow(row: any): Quote {
  return {
    id: row.id,
    estimateId: row.estimate_id,
    companyId: row.company_id,
    createdByUserId: row.created_by_user_id,
    status: row.status,
    quoteType: row.quote_type,
    markupMultiplier: row.markup_multiplier,
    subtotal: row.subtotal,
    total: row.total,
    currency: row.currency,
    notes: row.notes,
    pricedAsOf: row.priced_as_of ?? null,
    sentAt: row.sent_at ?? null,
    sentToEmail: row.sent_to_email ?? null,
    displayConfigJson: row.display_config_json ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapQuoteItemRow(row: any): QuoteItem {
  return {
    id: row.id,
    quoteId: row.quote_id,
    estimateItemId: row.estimate_item_id,
    displayKey: row.display_key ?? null,
    itemLabel: row.item_label,
    canonicalCode: row.canonical_code,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapQuoteLineSnapshotRow(row: any): QuoteLineSnapshot {
  return {
    id: row.id,
    quoteId: row.quote_id,
    quoteItemId: row.quote_item_id ?? null,
    estimateId: row.estimate_id ?? null,
    estimateLineId: row.estimate_line_id ?? null,
    estimateItemId: row.estimate_item_id ?? null,
    openingId: row.opening_id ?? null,
    componentId: row.component_id ?? null,
    sourceTable: row.source_table ?? 'estimate_line',
    sourceLineType: row.source_line_type ?? null,
    entityType: row.entity_type ?? null,
    chargeCategory: row.charge_category ?? null,
    description: row.description ?? null,
    selectedOptionCode: row.selected_option_code ?? null,
    quantity: row.quantity != null ? Number(row.quantity) : null,
    unitOfMeasure: row.unit_of_measure ?? null,
    unitListPrice: row.unit_list_price != null ? Number(row.unit_list_price) : null,
    extendedListPrice: row.extended_list_price != null ? Number(row.extended_list_price) : null,
    discountMultiplier: row.discount_multiplier != null ? Number(row.discount_multiplier) : null,
    extendedNetPrice: row.extended_net_price != null ? Number(row.extended_net_price) : null,
    sellPrice: row.sell_price != null ? Number(row.sell_price) : null,
    manualSellPrice: row.manual_sell_price != null ? Number(row.manual_sell_price) : null,
    unitSellPrice: row.unit_sell_price != null ? Number(row.unit_sell_price) : null,
    lineTotal: row.line_total != null ? Number(row.line_total) : null,
    priceStatus: row.price_status ?? null,
    reviewStatus: row.review_status ?? null,
    sortOrder: row.sort_order ?? 0,
    snapshotJson: row.snapshot_json ?? {},
    createdAt: row.created_at,
  };
}

function quoteLineSnapshotInputToRow(
  quoteId: string,
  snapshot: CreateQuoteLineSnapshotInput,
  idx: number
): Record<string, unknown> {
  return {
    quote_id: quoteId,
    quote_item_id: snapshot.quoteItemId ?? null,
    estimate_id: snapshot.estimateId ?? null,
    estimate_line_id: snapshot.estimateLineId ?? null,
    estimate_item_id: snapshot.estimateItemId ?? null,
    opening_id: snapshot.openingId ?? null,
    component_id: snapshot.componentId ?? null,
    source_table: snapshot.sourceTable,
    source_line_type: snapshot.sourceLineType ?? null,
    entity_type: snapshot.entityType ?? null,
    charge_category: snapshot.chargeCategory ?? null,
    description: snapshot.description ?? null,
    selected_option_code: snapshot.selectedOptionCode ?? null,
    quantity: snapshot.quantity ?? null,
    unit_of_measure: snapshot.unitOfMeasure ?? null,
    unit_list_price: snapshot.unitListPrice ?? null,
    extended_list_price: snapshot.extendedListPrice ?? null,
    discount_multiplier: snapshot.discountMultiplier ?? null,
    extended_net_price: snapshot.extendedNetPrice ?? null,
    sell_price: snapshot.sellPrice ?? null,
    manual_sell_price: snapshot.manualSellPrice ?? null,
    unit_sell_price: snapshot.unitSellPrice ?? null,
    line_total: snapshot.lineTotal ?? null,
    price_status: snapshot.priceStatus ?? null,
    review_status: snapshot.reviewStatus ?? null,
    sort_order: snapshot.sortOrder ?? idx,
    snapshot_json: snapshot.snapshotJson ?? {},
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapItemFieldRow(row: any): ItemField {
  return {
    id: row.id,
    estimateItemId: row.estimate_item_id,
    fieldDefinitionId: row.field_definition_id,
    fieldKey: row.field_key,
    fieldLabel: row.field_label,
    fieldValue: row.field_value,
    valueType: row.value_type,
    sourceConfidence: row.source_confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Re-export EstimateItem for convenience when building quote items from an estimate
export type { EstimateItem };
