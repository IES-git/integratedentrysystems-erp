/**
 * Live (read-only) pricing for the in-progress builder.
 *
 * Phase 3+: the unified spec builder prices a whole opening through the
 * rule-based engine (`priceOpeningLive`). The legacy per-item path
 * (`priceLocalItem`) still runs the grid lookup for the old builders until the
 * Phase 6 cutover; new code should use `priceOpeningLive`.
 */

import { resolveItemPrice } from '@/lib/pricing-lookup';
import { priceOpening } from '@/lib/pricing';
import type { EngineOptions, EngineResult, NormalizedOpeningSpec } from '@/lib/pricing';
import type { ItemField, PriceResult } from '@/types';

/**
 * Prices a whole opening spec through the rule engine without persisting — the
 * canonical live-pricing path for the unified builder.
 */
export async function priceOpeningLive(
  spec: NormalizedOpeningSpec,
  options: Omit<EngineOptions, 'persist'> = { priceBookDocumentId: null },
): Promise<EngineResult> {
  return priceOpening(spec, { ...options, persist: false });
}

export interface LivePriceInput {
  /** item_type slug, e.g. 'doors', 'frames', 'panels', 'lites_louvers_glass', 'hardware-hinge'. */
  category: string | null;
  canonicalCode: string;
  itemLabel: string;
  manufacturerId: string | null;
  subcategory?: string | null;
  fields: { fieldKey: string; fieldValue: string; fieldLabel?: string }[];
}

export async function priceLocalItem(input: LivePriceInput): Promise<PriceResult> {
  const fields: ItemField[] = input.fields.map((f) => ({
    id: '',
    estimateItemId: '',
    fieldDefinitionId: null,
    fieldKey: f.fieldKey,
    fieldLabel: f.fieldLabel ?? f.fieldKey,
    fieldValue: f.fieldValue,
    valueType: 'string',
    sourceConfidence: null,
    createdAt: '',
    updatedAt: '',
  }));

  return resolveItemPrice(
    {
      id: 'local',
      estimateId: null,
      itemLabel: input.itemLabel,
      canonicalCode: input.canonicalCode,
      quantity: 1,
      unitPrice: null,
      manufacturerId: input.manufacturerId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subcategory: (input.subcategory ?? null) as any,
      itemType: input.category,
      isManualPriceOverride: false,
      createdAt: '',
    },
    fields,
  );
}
