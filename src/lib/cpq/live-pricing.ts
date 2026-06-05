/**
 * Live (read-only) pricing for in-progress builder items (CPQ Phase 5).
 *
 * Builds a synthetic EstimateItem + ItemField[] from an unsaved opening-builder
 * selection and runs it through the same pricing engine used at Review time,
 * so the builder can show a per-piece price before anything is persisted.
 */

import { resolveItemPrice } from '@/lib/pricing-lookup';
import type { ItemField, PriceResult } from '@/types';

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
