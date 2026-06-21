/**
 * Bridge between the CPQ rule-engine pricing model (estimate_line) and the
 * Quote Builder's line-item model (CreateQuoteItemInput / LineItem).
 *
 * For engine-priced openings the quote contains one line per opening:
 *   - unitCost  = sum(extended_net_price for visible lines) / opening.quantity
 *   - unitPrice = unitCost × company markup multiplier
 *
 * Hardware, NGP infill, preps, etc. are all rolled into the opening total.
 * The detailed layer breakdown lives in estimate_line and is visible in the
 * estimate's Review step AuditableQuote.
 */

import type { EstimateOpeningWithItems, EstimateLine } from '@/types';

export interface QuotableOpening {
  openingId: string;
  label: string;
  quantity: number;
  /** Net cost per single opening unit (sum of extended_net_price for visible lines / quantity). */
  unitNetCost: number;
  /** Whether any line has a user manual override applied on the Review step. */
  hasManualOverrides: boolean;
  /** Number of exception-status lines (INVALID / CF / EXTERNAL_PENDING). */
  exceptionCount: number;
}

const EXCEPTION_STATUSES = new Set(['INVALID', 'CONTACT_FACTORY', 'EXTERNAL_PENDING']);

/**
 * Converts engine lines per opening into a flat list of quotable opening
 * summaries. Only openings that have at least one engine line are included;
 * callers should fall back to the legacy estimate_items path for others.
 */
export function buildQuotableOpenings(
  openings: EstimateOpeningWithItems[],
  linesByOpening: Map<string, EstimateLine[]>,
): QuotableOpening[] {
  const result: QuotableOpening[] = [];

  for (const opening of openings) {
    const lines = linesByOpening.get(opening.id) ?? [];
    if (lines.length === 0) continue;

    const visibleLines = lines.filter((l) => !l.includedOrSuppressedBy && l.lineType !== 'INCLUDED');
    const netTotal = visibleLines.reduce((s, l) => s + (l.extendedNetPrice ?? 0), 0);
    const hasManualOverrides = visibleLines.some(
      (l) => (l as { isManualOverride?: boolean | null }).isManualOverride === true,
    );
    const exceptionCount = visibleLines.filter(
      (l) => l.priceStatus != null && EXCEPTION_STATUSES.has(l.priceStatus),
    ).length;

    result.push({
      openingId: opening.id,
      label: opening.name,
      quantity: opening.quantity,
      unitNetCost: opening.quantity > 0 ? netTotal / opening.quantity : netTotal,
      hasManualOverrides,
      exceptionCount,
    });
  }

  return result;
}
