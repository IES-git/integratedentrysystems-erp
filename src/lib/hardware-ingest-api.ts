/**
 * Phase 2b — hardware catalog ingestion review API.
 *
 * The worker's source-specific parser writes hardware_product / hardware_variant
 * / hardware_attribute / hardware_price into a hardware_price_book revision, all
 * UNREVIEWED behind pricing_change_proposals (a 'hardware_product' summary + one
 * 'hardware_price' per net mismatch). This module reads the parsed catalog for
 * review and approves/rejects the revision.
 */

import { supabase } from './supabase';
import { updateProposalStatus } from './pricing-proposals-api';

export interface HardwarePriceRow {
  priceId: string;
  variantId: string;
  productId: string;
  category: string;
  manufacturerName: string | null;
  description: string | null;
  sku: string | null;
  finish: string | null;
  func: string | null;
  size: string | null;
  listPrice: number | null;
  discountMultiplier: number | null;
  discountChain: string | null;
  netCost: number | null;
  uom: string;
  reviewStatus: string;
  sourceRowRef: string | null;
}

export interface HardwareIngestSummary {
  hardwarePriceBookId: string;
  title: string | null;
  reviewStatus: string;
  productCount: number;
  variantCount: number;
  priceCount: number;
}

export interface HardwareReviewContext {
  proposalId: string | null;
  proposalStatus: string | null;
  hardwarePriceBookId: string;
  payload: Record<string, unknown>;
}

/** Resolves the hardware revision created by one staging price-book upload. */
export async function getHardwareReviewContext(priceBookId: string): Promise<HardwareReviewContext> {
  const { data, error } = await supabase
    .from('pricing_change_proposals')
    .select('id, status, target_ids, payload')
    .eq('price_book_id', priceBookId)
    .eq('proposal_type', 'hardware_product')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const target = (data?.target_ids ?? {}) as { hardwarePriceBookId?: string };
  if (!target.hardwarePriceBookId) {
    throw new Error('No ingested hardware revision is linked to this upload.');
  }
  return {
    proposalId: (data?.id as string | null) ?? null,
    proposalStatus: (data?.status as string | null) ?? null,
    hardwarePriceBookId: target.hardwarePriceBookId,
    payload: (data?.payload ?? {}) as Record<string, unknown>,
  };
}

/** Counts + header for one ingested hardware price-book revision. */
export async function getHardwareIngestSummary(hardwarePriceBookId: string): Promise<HardwareIngestSummary> {
  const [{ data: hpb }, { count: prices }] = await Promise.all([
    supabase.from('hardware_price_book').select('id, title, review_status').eq('id', hardwarePriceBookId).maybeSingle(),
    supabase.from('hardware_price').select('id', { count: 'exact', head: true }).eq('hardware_price_book_id', hardwarePriceBookId),
  ]);
  // Variant + product counts are derived from the price rows' variants.
  const { data: priceRows } = await supabase
    .from('hardware_price')
    .select('hardware_variant_id, hardware_variant!inner(hardware_product_id)')
    .eq('hardware_price_book_id', hardwarePriceBookId);
  const variantIds = new Set((priceRows ?? []).map((r) => r.hardware_variant_id as string));
  const productIds = new Set((priceRows ?? []).map((r) => (r.hardware_variant as unknown as { hardware_product_id: string } | null)?.hardware_product_id).filter(Boolean));
  return {
    hardwarePriceBookId,
    title: (hpb?.title as string | null) ?? null,
    reviewStatus: (hpb?.review_status as string) ?? 'UNREVIEWED',
    productCount: productIds.size,
    variantCount: variantIds.size,
    priceCount: prices ?? 0,
  };
}

/** Joined price rows (product + variant + price) for the review table. */
export async function listHardwarePrices(hardwarePriceBookId: string, limit = 500): Promise<HardwarePriceRow[]> {
  const { data, error } = await supabase
    .from('hardware_price')
    .select('id, list_price, discount_multiplier, discount_chain, net_cost, uom, review_status, source_row_ref, hardware_variant_id, hardware_variant!inner(id, sku, finish, function, size, hardware_product_id, hardware_product!inner(id, category, manufacturer_name, description))')
    .eq('hardware_price_book_id', hardwarePriceBookId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const v = r.hardware_variant as unknown as Record<string, unknown>;
    const p = (v?.hardware_product as unknown as Record<string, unknown>) ?? {};
    return {
      priceId: r.id as string,
      variantId: v?.id as string,
      productId: p.id as string,
      category: (p.category as string) ?? '',
      manufacturerName: (p.manufacturer_name as string | null) ?? null,
      description: (p.description as string | null) ?? null,
      sku: (v?.sku as string | null) ?? null,
      finish: (v?.finish as string | null) ?? null,
      func: (v?.function as string | null) ?? null,
      size: (v?.size as string | null) ?? null,
      listPrice: (r.list_price as number | null) ?? null,
      discountMultiplier: (r.discount_multiplier as number | null) ?? null,
      discountChain: (r.discount_chain as string | null) ?? null,
      netCost: (r.net_cost as number | null) ?? null,
      uom: (r.uom as string) ?? 'EA',
      reviewStatus: (r.review_status as string) ?? 'UNREVIEWED',
      sourceRowRef: (r.source_row_ref as string | null) ?? null,
    };
  });
}

export async function reviewHardwarePrice(input: {
  priceId: string;
  decision: 'APPROVED' | 'REJECTED';
  netCost?: number | null;
}): Promise<void> {
  const update: Record<string, unknown> = { review_status: input.decision };
  if (input.decision === 'APPROVED') {
    const net = input.netCost == null ? null : Number(input.netCost);
    if (net == null || !Number.isFinite(net) || net <= 0 || net > 100000) {
      throw new Error('Approved hardware prices require a net cost between $0 and $100,000.');
    }
    update.net_cost = Math.round(net * 100) / 100;
  }
  const { error } = await supabase.from('hardware_price').update(update).eq('id', input.priceId);
  if (error) throw new Error(error.message);
}

/** Bulk decision for rows the estimator explicitly selected in the review UI. */
export async function bulkReviewHardwarePrices(
  priceIds: string[],
  decision: 'APPROVED' | 'REJECTED',
): Promise<number> {
  const ids = [...new Set(priceIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  if (decision === 'APPROVED') {
    const { data: rows, error: readError } = await supabase
      .from('hardware_price')
      .select('id, net_cost')
      .in('id', ids);
    if (readError) throw new Error(readError.message);
    const invalid = (rows ?? []).filter((row) => {
      const net = row.net_cost == null ? null : Number(row.net_cost);
      return net == null || !Number.isFinite(net) || net <= 0 || net > 100000;
    });
    if (invalid.length > 0) {
      throw new Error(`${invalid.length} selected row(s) have no valid net cost. Edit those rows individually first.`);
    }
  }
  const { data, error } = await supabase
    .from('hardware_price')
    .update({ review_status: decision })
    .in('id', ids)
    .select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/**
 * Finalizes only after every imported observation has an explicit decision.
 * Unlike the legacy helper, this never promotes NEEDS_REVIEW rows implicitly.
 */
export async function finalizeHardwarePriceBook(
  hardwarePriceBookId: string,
  proposalId?: string | null,
): Promise<void> {
  const { count, error: countError } = await supabase
    .from('hardware_price')
    .select('id', { count: 'exact', head: true })
    .eq('hardware_price_book_id', hardwarePriceBookId)
    .in('review_status', ['UNREVIEWED', 'NEEDS_REVIEW']);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0) {
    throw new Error(`${count} hardware price row(s) still need an approve/reject decision.`);
  }
  const { error } = await supabase
    .from('hardware_price_book')
    .update({ review_status: 'APPROVED' })
    .eq('id', hardwarePriceBookId);
  if (error) throw new Error(error.message);
  if (proposalId) await updateProposalStatus(proposalId, 'applied');
}

/**
 * Approves an ingested hardware revision: flips the hardware_price_book and all
 * its hardware_price rows to APPROVED and applies the summary proposal. The
 * sell price is still computed later by hardware_sell_rule (cost-plus-margin).
 */
export async function approveHardwarePriceBook(hardwarePriceBookId: string, proposalId?: string | null): Promise<{ approvedPrices: number }> {
  const { error: hpbErr } = await supabase
    .from('hardware_price_book')
    .update({ review_status: 'APPROVED' })
    .eq('id', hardwarePriceBookId);
  if (hpbErr) throw new Error(hpbErr.message);
  const { data, error } = await supabase
    .from('hardware_price')
    .update({ review_status: 'APPROVED' })
    .eq('hardware_price_book_id', hardwarePriceBookId)
    .eq('review_status', 'UNREVIEWED')
    .select('id');
  if (error) throw new Error(error.message);
  if (proposalId) await updateProposalStatus(proposalId, 'applied');
  return { approvedPrices: data?.length ?? 0 };
}

/** Rejects an ingested hardware revision (kept for audit, not active). */
export async function rejectHardwarePriceBook(hardwarePriceBookId: string, proposalId?: string | null): Promise<void> {
  await supabase.from('hardware_price_book').update({ review_status: 'REJECTED' }).eq('id', hardwarePriceBookId);
  await supabase.from('hardware_price').update({ review_status: 'REJECTED' }).eq('hardware_price_book_id', hardwarePriceBookId);
  if (proposalId) await updateProposalStatus(proposalId, 'rejected');
}
