/**
 * Supabase-backed CRUD operations for Quotes and Quote Items.
 */

import { supabase } from './supabase';
import type { Quote, QuoteItem, QuoteStatus, QuoteType } from '@/types';
import type { EstimateItem, ItemField } from '@/types';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateQuoteItemInput {
  estimateItemId: string | null;
  itemLabel: string;
  canonicalCode?: string | null;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder?: number;
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
  items: CreateQuoteItemInput[];
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Insert a quote and all its line items in a single transaction-like sequence.
 * If item insertion fails the quote row is rolled back.
 */
export async function createQuote(input: CreateQuoteInput): Promise<Quote> {
  const { data: quoteRow, error: quoteError } = await supabase
    .from('quotes')
    .insert({
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
    })
    .select()
    .single();

  if (quoteError || !quoteRow) {
    throw new Error(`Failed to create quote: ${quoteError?.message}`);
  }

  if (input.items.length > 0) {
    const { error: itemsError } = await supabase.from('quote_items').insert(
      input.items.map((item, idx) => ({
        quote_id: quoteRow.id,
        estimate_item_id: item.estimateItemId ?? null,
        item_label: item.itemLabel,
        canonical_code: item.canonicalCode ?? null,
        quantity: item.quantity,
        unit_cost: item.unitCost,
        unit_price: item.unitPrice,
        line_total: item.lineTotal,
        sort_order: item.sortOrder ?? idx,
      }))
    );

    if (itemsError) {
      // Attempt rollback
      await supabase.from('quotes').delete().eq('id', quoteRow.id);
      throw new Error(`Failed to create quote items: ${itemsError.message}`);
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
  items: (QuoteItem & { fields: ItemField[] })[];
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

  // Fetch item_fields for each source estimate_item so the manufacturer PDF
  // can render the full technical spec grid.
  const estimateItemIds = (itemRows ?? [])
    .map((r) => r.estimate_item_id)
    .filter(Boolean) as string[];

  let fieldsByEstimateItemId: Record<string, ItemField[]> = {};

  if (estimateItemIds.length > 0) {
    const { data: fieldRows, error: fieldsError } = await supabase
      .from('item_fields')
      .select('*')
      .in('estimate_item_id', estimateItemIds);

    if (fieldsError) {
      throw new Error(`Failed to fetch item fields: ${fieldsError.message}`);
    }

    fieldsByEstimateItemId = (fieldRows ?? []).reduce<
      Record<string, ItemField[]>
    >((acc, row) => {
      const key: string = row.estimate_item_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(mapItemFieldRow(row));
      return acc;
    }, {});
  }

  const items = (itemRows ?? []).map((row) => ({
    ...mapQuoteItemRow(row),
    fields: row.estimate_item_id
      ? (fieldsByEstimateItemId[row.estimate_item_id] ?? [])
      : [],
  }));

  return { quote: mapQuoteRow(quoteRow), items };
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
  updates: Partial<Pick<Quote, 'status' | 'notes' | 'subtotal' | 'total'>>
): Promise<Quote> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.notes !== undefined) row.notes = updates.notes;
  if (updates.subtotal !== undefined) row.subtotal = updates.subtotal;
  if (updates.total !== undefined) row.total = updates.total;

  const { data, error } = await supabase
    .from('quotes')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update quote: ${error.message}`);
  return mapQuoteRow(data);
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
