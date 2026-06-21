/**
 * CPQ orchestration service (Phase 4 / Phase 6 update).
 *
 * A single entry point that chains the three engines into a structured,
 * quote-ready result:
 *   1. compatibility / configuration rules  (is it buildable?)
 *   2. versioned pricing lookup             (what does it cost?)
 *   3. pricing-exception enqueue            (handle failures)
 *
 * Refresh flow (persist=true):
 *   - Openings that have a spec_snapshot (custom builder) → re-run the rule
 *     engine via repriceSpecOpening so their estimate_line rows stay in sync.
 *   - Openings without a snapshot (legacy OCR path) → legacy grid lookup via
 *     refreshEstimatePricing.
 *
 * Quote creation and the wizard Refresh flow go through here instead of
 * calling the individual engines directly.
 */

import { getEstimateOpenings } from '@/lib/estimates-api';
import { refreshEstimatePricing, resolveOpeningPricing, normalizeCategoryKey } from '@/lib/pricing-lookup';
import { evaluateOpeningsCompatibility } from '@/lib/compatibility-rules-api';
import { loadSpecFieldDictionary } from '@/lib/cpq-catalog-api';
import { repriceSpecOpening } from '@/lib/cpq/opening-persist';
import { supabase } from '@/lib/supabase';
import type {
  CompatibilityViolation,
  EstimateItem,
  EstimateOpeningWithItems,
  VendorOverride,
} from '@/types';

export interface CpqPricedOpening {
  opening: EstimateOpeningWithItems;
  /** Sum of unit_price × qty across the opening's items (before opening multiplier). */
  subtotal: number;
  /** subtotal × opening.quantity. */
  total: number;
  /** Items with no resolved price. */
  unpricedCount: number;
  violations: CompatibilityViolation[];
}

export interface CpqPricedEstimate {
  openings: CpqPricedOpening[];
  grandTotal: number;
  violations: CompatibilityViolation[];
  errorCount: number;
  warningCount: number;
  /** True when there is at least one error-severity violation. */
  hasBlockingViolations: boolean;
  /** Summary from the pricing refresh, when persist was requested. */
  refreshSummary?: { updated: number; skipped: number; warnings: { itemLabel: string; status: string; message: string }[] };
}

export interface PriceEstimateOptions {
  /**
   * When true, re-resolves and persists prices via refreshEstimatePricing
   * (also enqueues pricing exceptions for failures). When false, reads the
   * currently-stored prices without mutating anything.
   */
  persist?: boolean;
}

function openingSubtotal(opening: EstimateOpeningWithItems): number {
  const itemsTotal = opening.items.reduce((s, i: EstimateItem) => s + (i.unitPrice ?? 0) * i.quantity, 0);
  const hardwareTotal = (opening.hardware ?? []).reduce((s, h: EstimateItem) => s + (h.unitPrice ?? 0) * h.quantity, 0);
  return itemsTotal + hardwareTotal;
}

function unpriced(opening: EstimateOpeningWithItems): number {
  const topLevel = opening.items.filter((i) => i.unitPrice === null || i.unitPrice === undefined).length;
  const hardware = (opening.hardware ?? []).filter((h) => h.unitPrice === null || h.unitPrice === undefined).length;
  return topLevel + hardware;
}

/**
 * Prices a full estimate and evaluates compatibility, returning a structured
 * quote-ready result. Optionally persists prices + enqueues exceptions first.
 */
export async function priceEstimate(
  estimateId: string,
  opts: PriceEstimateOptions = {},
): Promise<CpqPricedEstimate> {
  let refreshSummary: CpqPricedEstimate['refreshSummary'] | undefined;

  if (opts.persist) {
    // Split openings into spec-built (have a spec_snapshot) vs legacy.
    const { data: openingRows } = await supabase
      .from('estimate_openings')
      .select('id, spec_snapshot')
      .eq('estimate_id', estimateId);

    const specOpeningIds = (openingRows ?? [])
      .filter((r) => r.spec_snapshot != null)
      .map((r) => r.id as string);

    const hasLegacyOpenings = (openingRows ?? []).some((r) => r.spec_snapshot == null);

    // Re-price spec openings through the rule engine.
    if (specOpeningIds.length > 0) {
      const dict = await loadSpecFieldDictionary();
      let engineUpdated = 0;
      for (const openingId of specOpeningIds) {
        try {
          const repriced = await repriceSpecOpening(
            estimateId,
            openingId,
            dict.mappings,
            { priceBookDocumentId: null },
          );
          if (repriced) engineUpdated++;
        } catch {
          // Non-fatal: individual re-price failures don't abort the whole refresh.
        }
      }
      if (!refreshSummary) refreshSummary = { updated: engineUpdated, skipped: 0, warnings: [] };
      else refreshSummary.updated += engineUpdated;
    }

    // Re-price legacy openings through the grid lookup.
    if (hasLegacyOpenings) {
      const legacySummary = await refreshEstimatePricing(estimateId);
      if (legacySummary) {
        if (!refreshSummary) {
          refreshSummary = legacySummary;
        } else {
          refreshSummary.updated += legacySummary.updated;
          refreshSummary.skipped += legacySummary.skipped;
          refreshSummary.warnings.push(...legacySummary.warnings);
        }
      }
    }
  }

  const openings = await getEstimateOpenings(estimateId);
  const byOpening = await evaluateOpeningsCompatibility(openings);

  const pricedOpenings: CpqPricedOpening[] = openings.map((opening) => {
    const subtotal = openingSubtotal(opening);
    const violations = byOpening.get(opening.id) ?? [];
    return {
      opening,
      subtotal,
      total: subtotal * opening.quantity,
      unpricedCount: unpriced(opening),
      violations,
    };
  });

  const violations = pricedOpenings.flatMap((o) => o.violations);
  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warningCount = violations.filter((v) => v.severity === 'warning').length;

  return {
    openings: pricedOpenings,
    grandTotal: pricedOpenings.reduce((s, o) => s + o.total, 0),
    violations,
    errorCount,
    warningCount,
    hasBlockingViolations: errorCount > 0,
    refreshSummary,
  };
}

/** Prices a single opening (by loading its estimate and filtering). */
export async function priceOpening(
  estimateId: string,
  openingId: string,
  opts: PriceEstimateOptions = {},
): Promise<CpqPricedOpening | null> {
  const priced = await priceEstimate(estimateId, opts);
  return priced.openings.find((o) => o.opening.id === openingId) ?? null;
}

// ---------------------------------------------------------------------------
// Multi-vendor what-if comparison (Phase 5)
// ---------------------------------------------------------------------------

export interface VendorScenario {
  id: string;
  label: string;
  override: VendorOverride;
}

export interface ScenarioItemResult {
  itemId: string;
  itemLabel: string;
  categoryKey: string;
  unitPrice: number | null;
  matched: boolean;
}

export interface ScenarioResult {
  scenarioId: string;
  label: string;
  /** Opening total (sum of unit × qty) × opening.quantity. */
  total: number;
  unpricedCount: number;
  items: ScenarioItemResult[];
}

/** Flattens an opening's items (top-level + nested + opening hardware). */
function allOpeningItems(opening: EstimateOpeningWithItems): EstimateItem[] {
  return [
    ...opening.items,
    ...opening.items.flatMap((i) => i.hardware ?? []),
    ...(opening.hardware ?? []),
  ];
}

/**
 * Prices one opening under several vendor scenarios (read-only) and returns
 * side-by-side totals. Powers the "Compare vendors" what-if (e.g. Pioneer vs
 * Ceco for doors/frames, mixed-vendor hardware).
 */
export async function compareOpeningVendors(
  opening: EstimateOpeningWithItems,
  scenarios: VendorScenario[],
): Promise<ScenarioResult[]> {
  const items = allOpeningItems(opening);
  const qtyById = new Map(items.map((i) => [i.id, i.quantity] as const));
  const labelById = new Map(items.map((i) => [i.id, i.itemLabel] as const));
  const catById = new Map(items.map((i) => [i.id, normalizeCategoryKey(i.itemType, i.subcategory)] as const));

  return Promise.all(
    scenarios.map(async (scenario) => {
      const priceMap = await resolveOpeningPricing(opening.id, { vendorOverride: scenario.override });
      let subtotal = 0;
      let unpricedCount = 0;
      const itemResults: ScenarioItemResult[] = [];

      for (const [itemId, result] of priceMap.entries()) {
        const qty = qtyById.get(itemId) ?? 1;
        const matched = result.status === 'matched' && result.totalUnitPrice !== null;
        if (matched) subtotal += (result.totalUnitPrice ?? 0) * qty;
        else unpricedCount++;
        itemResults.push({
          itemId,
          itemLabel: labelById.get(itemId) ?? itemId,
          categoryKey: catById.get(itemId) ?? 'unknown',
          unitPrice: result.totalUnitPrice,
          matched,
        });
      }

      return {
        scenarioId: scenario.id,
        label: scenario.label,
        total: subtotal * opening.quantity,
        unpricedCount,
        items: itemResults,
      };
    }),
  );
}

/**
 * Commits a vendor scenario: writes the chosen manufacturer_id onto each
 * matching item in the opening (by item, then by normalized category). Returns
 * the number of items updated. The caller should re-run pricing afterward.
 */
export async function applyVendorScenario(
  opening: EstimateOpeningWithItems,
  override: VendorOverride,
): Promise<number> {
  const items = allOpeningItems(opening);
  let updated = 0;

  await Promise.all(
    items.map(async (item) => {
      const target =
        override.byItem?.[item.id] ??
        override.byCategory?.[normalizeCategoryKey(item.itemType, item.subcategory)];
      if (!target || target === item.manufacturerId) return;
      const { error } = await supabase
        .from('estimate_items')
        .update({ manufacturer_id: target })
        .eq('id', item.id);
      if (!error) updated++;
    }),
  );

  return updated;
}

/**
 * Throws if the estimate has blocking (error-severity) compatibility
 * violations OR unresolved engine-line exceptions (INVALID/CF/EXTERNAL_PENDING)
 * that would prevent an accurate quote. Call before generating a quote.
 */
export async function assertEstimateBuildable(estimateId: string): Promise<void> {
  const openings = await getEstimateOpenings(estimateId);
  const byOpening = await evaluateOpeningsCompatibility(openings);
  const errors = [...byOpening.values()].flat().filter((v) => v.severity === 'error');
  if (errors.length > 0) {
    const detail = errors.slice(0, 3).map((e) => `${e.itemLabel}: ${e.message}`).join('; ');
    throw new Error(
      `This estimate has ${errors.length} unresolved configuration error${errors.length !== 1 ? 's' : ''}: ${detail}${errors.length > 3 ? '…' : ''}`,
    );
  }

  // Also block on INVALID/CF/EXTERNAL_PENDING engine lines — these represent
  // items that have no resolved price and would produce a $0 quote line.
  const { data: blockingLines, error: lineErr } = await supabase
    .from('estimate_line')
    .select('description, price_status')
    .eq('estimate_id', estimateId)
    .in('price_status', ['INVALID', 'CONTACT_FACTORY', 'EXTERNAL_PENDING'])
    .is('included_or_suppressed_by', null)
    .neq('line_type', 'INCLUDED')
    .limit(5);

  if (!lineErr && (blockingLines?.length ?? 0) > 0) {
    const detail = (blockingLines ?? [])
      .slice(0, 3)
      .map((l) => `${l.description ?? 'item'} (${l.price_status})`)
      .join('; ');
    const total = blockingLines!.length;
    throw new Error(
      `This estimate has ${total} unresolved pricing exception${total !== 1 ? 's' : ''} that must be resolved before quoting: ${detail}${total > 3 ? '…' : ''}`,
    );
  }
}
