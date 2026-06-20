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
    .select('id, list_price, discount_multiplier, net_cost, uom, review_status, source_row_ref, hardware_variant_id, hardware_variant!inner(id, sku, finish, function, size, hardware_product_id, hardware_product!inner(id, category, manufacturer_name, description))')
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
      netCost: (r.net_cost as number | null) ?? null,
      uom: (r.uom as string) ?? 'EA',
      reviewStatus: (r.review_status as string) ?? 'UNREVIEWED',
      sourceRowRef: (r.source_row_ref as string | null) ?? null,
    };
  });
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
