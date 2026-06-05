/**
 * Pricing exception queue (CPQ Phase 2).
 *
 * When the pricing engine cannot resolve a price (no_table / no_row / no_column
 * / no_cell / no_vendor), the failure is enqueued here instead of disappearing
 * as a silent warning. The exception agent proposes a closest-match fix; a human
 * approves it, which writes the price through the normal item update path.
 */

import { supabase } from './supabase';
import type {
  PriceLookupStatus,
  PricingException,
  PricingExceptionResolutionStatus,
  PricingExceptionSuggestion,
} from '@/types';

function mapException(row: Record<string, unknown>): PricingException {
  return {
    id: row.id as string,
    estimateItemId: (row.estimate_item_id as string | null) ?? null,
    estimateId: (row.estimate_id as string | null) ?? null,
    itemLabel: row.item_label as string,
    lookupStatus: row.lookup_status as PriceLookupStatus,
    context: (row.context ?? {}) as Record<string, unknown>,
    suggestion: (row.suggestion as PricingExceptionSuggestion | null) ?? null,
    explanation: (row.explanation as string | null) ?? null,
    resolutionStatus: row.resolution_status as PricingExceptionResolutionStatus,
    resolvedBy: (row.resolved_by as string | null) ?? null,
    resolvedAt: (row.resolved_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export interface EnqueueExceptionInput {
  estimateItemId: string;
  estimateId: string | null;
  itemLabel: string;
  lookupStatus: PriceLookupStatus;
  context: Record<string, unknown>;
  suggestion?: PricingExceptionSuggestion | null;
  explanation?: string | null;
}

/**
 * Creates or refreshes the single open (pending) exception for an item.
 * Updates the existing pending row if present, else inserts a new one.
 */
export async function enqueueException(input: EnqueueExceptionInput): Promise<void> {
  const { data: existing } = await supabase
    .from('pricing_exceptions')
    .select('id')
    .eq('estimate_item_id', input.estimateItemId)
    .eq('resolution_status', 'pending')
    .limit(1)
    .maybeSingle();

  const payload = {
    estimate_item_id: input.estimateItemId,
    estimate_id: input.estimateId,
    item_label: input.itemLabel,
    lookup_status: input.lookupStatus,
    context: input.context,
    suggestion: input.suggestion ?? null,
    explanation: input.explanation ?? null,
  };

  if (existing) {
    await supabase.from('pricing_exceptions').update(payload).eq('id', existing.id);
  } else {
    await supabase.from('pricing_exceptions').insert(payload);
  }
}

/** Clears any pending exception for an item (e.g. it now prices cleanly). */
export async function clearPendingException(estimateItemId: string): Promise<void> {
  await supabase
    .from('pricing_exceptions')
    .delete()
    .eq('estimate_item_id', estimateItemId)
    .eq('resolution_status', 'pending');
}

export async function listExceptions(filter?: {
  estimateId?: string;
  resolutionStatus?: PricingExceptionResolutionStatus;
}): Promise<PricingException[]> {
  let query = supabase
    .from('pricing_exceptions')
    .select('*')
    .order('created_at', { ascending: false });
  if (filter?.estimateId) query = query.eq('estimate_id', filter.estimateId);
  if (filter?.resolutionStatus) query = query.eq('resolution_status', filter.resolutionStatus);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapException(r as Record<string, unknown>));
}

export async function listPendingExceptionsForEstimate(estimateId: string): Promise<PricingException[]> {
  return listExceptions({ estimateId, resolutionStatus: 'pending' });
}

export async function countPendingExceptions(): Promise<number> {
  const { count, error } = await supabase
    .from('pricing_exceptions')
    .select('id', { count: 'exact', head: true })
    .eq('resolution_status', 'pending');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Stores the agent's suggestion + explanation on an exception. */
export async function attachSuggestion(
  exceptionId: string,
  suggestion: PricingExceptionSuggestion,
  explanation: string,
): Promise<void> {
  const { error } = await supabase
    .from('pricing_exceptions')
    .update({ suggestion, explanation })
    .eq('id', exceptionId);
  if (error) throw new Error(error.message);
}

/**
 * Approves an exception by writing the agreed price onto the estimate item
 * (price_source='manual' — a human confirmed an approximate/closest match) and
 * marking the exception resolved.
 */
export async function approveExceptionWithPrice(
  exceptionId: string,
  estimateItemId: string,
  price: number,
): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const { error: itemErr } = await supabase
    .from('estimate_items')
    .update({ unit_price: price, price_source: 'manual', is_manual_price_override: true })
    .eq('id', estimateItemId);
  if (itemErr) throw new Error(itemErr.message);

  const { error } = await supabase
    .from('pricing_exceptions')
    .update({
      resolution_status: 'resolved',
      resolved_by: userData?.user?.id ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', exceptionId);
  if (error) throw new Error(error.message);
}

/** Dismisses an exception without changing the price. */
export async function rejectException(exceptionId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('pricing_exceptions')
    .update({
      resolution_status: 'rejected',
      resolved_by: userData?.user?.id ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', exceptionId);
  if (error) throw new Error(error.message);
}
