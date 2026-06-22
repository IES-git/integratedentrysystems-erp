/**
 * Shared authoritative pricing totals for openings.
 *
 * Engine sell (estimate_line) is the primary price source for custom spec
 * openings. Legacy estimate_items.unitPrice is the fallback for older openings
 * that have not yet been run through the rule engine.
 *
 * Centralised here so ReviewStep, OpeningsStep, and any future consumers all
 * agree on what "priced" and "missing price" mean.
 */

import type { EstimateOpeningWithItems, EstimateLine, EstimateLinePriceStatus } from '@/types';

const EXCEPTION_STATUSES = new Set<EstimateLinePriceStatus>([
  'INVALID',
  'CONTACT_FACTORY',
  'EXTERNAL_PENDING',
]);

// ---------------------------------------------------------------------------
// Per-line helpers
// ---------------------------------------------------------------------------

/** Returns the best sell price for a single engine line (manual override first). */
export function lineSellPrice(line: EstimateLine): number {
  return (line as EstimateLineWithOverride).manualSellPrice ?? line.sellPrice ?? 0;
}

// Augmented type for the manual override columns added in Phase 4.
// Kept loose (via intersection) so it compiles before the DB column lands.
export interface EstimateLineWithOverride extends EstimateLine {
  manualSellPrice?: number | null;
  isManualOverride?: boolean | null;
}

function hasManualLinePrice(line: EstimateLine): boolean {
  return (line as EstimateLineWithOverride).manualSellPrice !== null &&
    (line as EstimateLineWithOverride).manualSellPrice !== undefined;
}

// ---------------------------------------------------------------------------
// Per-opening engine subtotal
// ---------------------------------------------------------------------------

/**
 * Sum of sell prices for all non-suppressed, non-INCLUDED engine lines.
 * Returns null when the opening has no engine lines (legacy-only path).
 */
export function engineSellSubtotal(lines: EstimateLine[]): number | null {
  if (lines.length === 0) return null;
  let sum = 0;
  for (const line of lines) {
    if (line.lineType === 'INCLUDED') continue;
    if (line.includedOrSuppressedBy) continue;
    sum += lineSellPrice(line);
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Per-opening totals (engine preferred, legacy fallback)
// ---------------------------------------------------------------------------

function legacyItemsTotal(opening: EstimateOpeningWithItems): number {
  const itemsTotal = opening.items.reduce((s, i) => s + (i.unitPrice ?? 0) * i.quantity, 0);
  const hardwareTotal = (opening.hardware ?? []).reduce((s, h) => s + (h.unitPrice ?? 0) * h.quantity, 0);
  return itemsTotal + hardwareTotal;
}

/** Unit subtotal for one opening (pre-quantity-multiplier). */
export function openingUnitSubtotal(
  opening: EstimateOpeningWithItems,
  engineLines: EstimateLine[],
): number {
  return engineSellSubtotal(engineLines) ?? legacyItemsTotal(opening);
}

/** Total for one opening including the quantity multiplier. */
export function openingTotalWithLines(
  opening: EstimateOpeningWithItems,
  engineLines: EstimateLine[],
): number {
  return openingUnitSubtotal(opening, engineLines) * opening.quantity;
}

/** True when there is at least one positive price value for this opening. */
export function openingHasAnyPrice(
  opening: EstimateOpeningWithItems,
  engineLines: EstimateLine[],
): boolean {
  if (engineLines.length > 0) {
    return engineLines.some(
      (l) =>
        l.lineType !== 'INCLUDED' &&
        !l.includedOrSuppressedBy &&
        lineSellPrice(l) !== 0,
    );
  }
  return [...opening.items, ...(opening.hardware ?? [])].some(
    (i) => i.unitPrice !== null && i.unitPrice !== undefined,
  );
}

// ---------------------------------------------------------------------------
// Estimate-level aggregates
// ---------------------------------------------------------------------------

/** Grand total across all openings, using engine sell where available. */
export function estimateGrandTotal(
  openings: EstimateOpeningWithItems[],
  linesByOpening: Map<string, EstimateLine[]>,
  adjustmentPct?: number | null,
): number {
  const base = openings.reduce((sum, o) => {
    const lines = linesByOpening.get(o.id) ?? [];
    return sum + openingTotalWithLines(o, lines);
  }, 0);
  if (adjustmentPct != null && adjustmentPct !== 0) {
    return base * (1 + adjustmentPct / 100);
  }
  return base;
}

/** True when at least one opening in the estimate has a price. */
export function estimateHasAnyPrice(
  openings: EstimateOpeningWithItems[],
  linesByOpening: Map<string, EstimateLine[]>,
): boolean {
  return openings.some((o) => openingHasAnyPrice(o, linesByOpening.get(o.id) ?? []));
}

/**
 * Count of "missing price" signals across the estimate.
 *
 * For engine openings: lines with exception statuses (INVALID / CF / EXTERNAL_PENDING).
 * For legacy openings (no engine lines): items without a unit_price.
 */
export function countEstimateMissingPrices(
  openings: EstimateOpeningWithItems[],
  linesByOpening: Map<string, EstimateLine[]>,
): number {
  let count = 0;
  for (const opening of openings) {
    const lines = linesByOpening.get(opening.id) ?? [];
    if (lines.length > 0) {
      count += lines.filter(
        (l) => !hasManualLinePrice(l) && l.priceStatus != null && EXCEPTION_STATUSES.has(l.priceStatus as EstimateLinePriceStatus),
      ).length;
    } else {
      count += [...opening.items, ...(opening.hardware ?? [])].filter(
        (i) => i.unitPrice === null || i.unitPrice === undefined,
      ).length;
    }
  }
  return count;
}
