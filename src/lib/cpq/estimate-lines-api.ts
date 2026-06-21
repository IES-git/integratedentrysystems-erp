/**
 * Persisted auditable line reader (Phase 5).
 *
 * Loads the rule engine's `estimate_line` rows for an estimate (written by the
 * unified builder on save) so the wizard ReviewStep can render the same
 * auditable end-to-end quote the live builder shows, grouped per opening.
 */

import { supabase } from '@/lib/supabase';
import type { EstimateLine, EstimateLineType, EstimateLinePriceStatus, RuleEntityType } from '@/types';

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}

function mapLine(row: Record<string, unknown>): EstimateLine {
  return {
    id: row.id as string,
    estimateId: (row.estimate_id as string | null) ?? null,
    openingId: (row.opening_id as string | null) ?? null,
    componentId: (row.component_id as string | null) ?? null,
    entityType: (row.entity_type as RuleEntityType | null) ?? null,
    lineType: row.line_type as EstimateLineType,
    priceRuleId: (row.price_rule_id as string | null) ?? null,
    chargeCategory: (row.charge_category as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    selectedOptionCode: (row.selected_option_code as string | null) ?? null,
    quantity: num(row.quantity),
    unitOfMeasure: (row.unit_of_measure as string | null) ?? null,
    unitListPrice: num(row.unit_list_price),
    extendedListPrice: num(row.extended_list_price),
    discountMultiplier: num(row.discount_multiplier),
    extendedNetPrice: num(row.extended_net_price),
    sellPrice: num(row.sell_price),
    grossMargin: num(row.gross_margin),
    grossMarginPct: num(row.gross_margin_pct),
    priceStatus: (row.price_status as EstimateLinePriceStatus | null) ?? null,
    calculationExpression: (row.calculation_expression as string | null) ?? null,
    matchedConditions: (row.matched_conditions as Record<string, unknown> | null) ?? null,
    includedOrSuppressedBy: (row.included_or_suppressed_by as string | null) ?? null,
    sourcePage: (row.source_page as string | null) ?? null,
    sourceRegionId: (row.source_region_id as string | null) ?? null,
    priceBookId: (row.price_book_id as string | null) ?? null,
    confidence: num(row.confidence),
    reviewStatus: (row.review_status as string | null) ?? null,
    exceptionMessage: (row.exception_message as string | null) ?? null,
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as string,
    manualSellPrice: row.manual_sell_price != null ? Number(row.manual_sell_price) : null,
    isManualOverride: (row.is_manual_override as boolean | null) ?? null,
  };
}

/** Loads all engine lines for an estimate, grouped by opening id (ordered). */
export async function loadEstimateLinesByOpening(
  estimateId: string,
): Promise<Map<string, EstimateLine[]>> {
  const { data, error } = await supabase
    .from('estimate_line')
    .select('*')
    .eq('estimate_id', estimateId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Failed to load estimate lines: ${error.message}`);

  const byOpening = new Map<string, EstimateLine[]>();
  for (const row of data ?? []) {
    const line = mapLine(row as Record<string, unknown>);
    const key = line.openingId ?? '__estimate__';
    if (!byOpening.has(key)) byOpening.set(key, []);
    byOpening.get(key)!.push(line);
  }
  return byOpening;
}

/** Sets or clears a manual sell price override on a single estimate_line row. */
export async function updateEstimateLineOverride(
  lineId: string,
  manualSellPrice: number | null,
): Promise<void> {
  const { error } = await supabase
    .from('estimate_line')
    .update({
      manual_sell_price: manualSellPrice,
      is_manual_override: manualSellPrice !== null,
    })
    .eq('id', lineId);
  if (error) throw new Error(`Failed to update line override: ${error.message}`);
}

/** Updates the sell adjustment percentage and/or notes on an estimate. */
export async function updateEstimateReviewFields(
  estimateId: string,
  updates: { sellAdjustmentPct?: number | null; estimateNotes?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if ('sellAdjustmentPct' in updates) row.sell_adjustment_pct = updates.sellAdjustmentPct ?? null;
  if ('estimateNotes' in updates) row.estimate_notes = updates.estimateNotes ?? null;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('estimates').update(row).eq('id', estimateId);
  if (error) throw new Error(`Failed to update estimate review fields: ${error.message}`);
}
