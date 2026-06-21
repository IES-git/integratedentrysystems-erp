/**
 * "Example Opening" end-to-end test fixture (Phase 5).
 *
 * The integration workbook's worked example: a single 3-0 × 7-0 exterior
 * fire-rated door with a cylindrical lock, surface closer, butt hinges, a
 * threshold, perimeter gasketing, and a door-position switch (DPS). It is a
 * self-contained rule set + hardware catalog + variant price map that prices
 * through `priceOpeningCore` and reconstructs the full auditable quote (Pioneer
 * base + preps + actual hardware + linear accessories + services) with NO
 * unresolved exceptions — the round-trip reconstruction baseline.
 *
 * Used by the auditable-quote tests and available to seed a demo opening.
 */

import type { LoadedPriceRule, LoadedRuleSet } from '@/lib/pricing';
import type { HardwareCatalog, VariantWithPrice } from '@/lib/pricing';
import type { NormalizedOpeningSpec } from '@/lib/pricing';
import { priceOpeningCore } from '@/lib/pricing';
import type { EngineResult } from '@/lib/pricing';
import type { HardwareVariant, HardwarePrice } from '@/types';

const NOW = '2025-05-01T00:00:00.000Z';

/** Builds a fully-defaulted LoadedPriceRule from a partial. */
function rule(partial: Partial<LoadedPriceRule> & Pick<LoadedPriceRule, 'id' | 'entityType'>): LoadedPriceRule {
  return {
    ruleKey: partial.id,
    priceBookId: 'example-doc',
    priceTableId: null,
    chargeCategory: null,
    itemOrOptionCode: null,
    priceStatus: 'PRICED',
    actionType: 'BASE_AMOUNT',
    amount: null,
    currencyCode: 'USD',
    unitOfMeasure: null,
    quantityBasisField: null,
    baseQuantityIncluded: null,
    minimumCharge: null,
    maximumCharge: null,
    referenceRuleId: null,
    percentage: null,
    fixedAddAfterReference: null,
    roundingMethod: null,
    roundingIncrement: null,
    priority: 100,
    stackingBehavior: 'STACK',
    exclusiveGroup: null,
    effectiveFrom: null,
    effectiveTo: null,
    sourceRegionId: null,
    rawValueText: null,
    extractionConfidence: 1,
    reviewStatus: 'APPROVED',
    createdAt: NOW,
    updatedAt: NOW,
    conditions: [],
    actionParameters: [],
    includedScopes: [],
    quantityTiers: [],
    ...partial,
  };
}

/** A prep price rule keyed by its prep code (no conditions — matched by code). */
function prepRule(id: string, code: string, amount: number): LoadedPriceRule {
  return rule({
    id,
    entityType: 'prep',
    itemOrOptionCode: code,
    chargeCategory: 'prep',
    actionType: 'BASE_AMOUNT',
    amount,
    sourceRegionId: null,
  });
}

export const exampleRuleSet: LoadedRuleSet = {
  rules: [
    // Pioneer base matrices.
    rule({ id: 'door-base', entityType: 'door', chargeCategory: 'base', actionType: 'BASE_AMOUNT', amount: 850, priority: 1 }),
    rule({ id: 'frame-base', entityType: 'frame', chargeCategory: 'base', actionType: 'BASE_AMOUNT', amount: 320, priority: 1 }),
    // Fire-label adder (conditioned on the opening flag).
    rule({
      id: 'door-fire', entityType: 'door', chargeCategory: 'fire_label', actionType: 'FIXED_ADD', amount: 75, priority: 10,
      conditions: [{
        id: 'c-fire', priceRuleId: 'door-fire', conditionGroup: 0, fieldId: null,
        fieldPath: 'opening.fire_label_required', operator: 'EQ', valueType: 'BOOLEAN',
        value1: 'true', value2: null, unit: null, inclusiveMin: null, inclusiveMax: null,
        normalizedValue: null, sourcePhrase: null, derivedFlag: false, nullBehavior: 'IGNORE', createdAt: NOW,
      }],
    }),
    // Pioneer preparation charges (priced separately from the actual devices).
    prepRule('prep-hinge-door', 'HINGE', 9),
    prepRule('prep-hinge-frame', 'HINGEF', 11),
    prepRule('prep-cyl-door', 'CYL', 22),
    prepRule('prep-strike-frame', '478', 14),
    prepRule('prep-closer-door', 'CLP', 18),
    prepRule('prep-dps-frame', 'DPS', 16),
  ],
  dependencyRules: [],
};

export const exampleCatalog: HardwareCatalog = {
  setTemplates: [
    {
      id: 'set-ext-fire-single',
      name: 'Exterior fire-rated single',
      useCase: 'exterior_fire_single',
      fireRated: true,
      accessControlled: false,
      ratedFlags: {},
      selectionConditions: { configuration_type: 'single', fire_label_required: true },
      createdAt: NOW,
      updatedAt: NOW,
      items: [
        { id: 'si-1', hardwareSetTemplateId: 'set-ext-fire-single', category: 'butt_hinges', quantityFormula: 'hinge_count(height, leaf_count)', required: true, position: 1, compatibleVariants: {}, createdAt: NOW },
        { id: 'si-2', hardwareSetTemplateId: 'set-ext-fire-single', category: 'cylindrical_lock', quantityFormula: '1', required: true, position: 2, compatibleVariants: {}, createdAt: NOW },
        { id: 'si-3', hardwareSetTemplateId: 'set-ext-fire-single', category: 'surface_closer', quantityFormula: '1', required: true, position: 3, compatibleVariants: {}, createdAt: NOW },
        { id: 'si-4', hardwareSetTemplateId: 'set-ext-fire-single', category: 'door_position_switch', quantityFormula: '1', required: false, position: 4, compatibleVariants: {}, createdAt: NOW },
        { id: 'si-5', hardwareSetTemplateId: 'set-ext-fire-single', category: 'gasketing', quantityFormula: '0', required: false, position: 5, compatibleVariants: {}, createdAt: NOW },
        { id: 'si-6', hardwareSetTemplateId: 'set-ext-fire-single', category: 'threshold', quantityFormula: '0', required: false, position: 6, compatibleVariants: {}, createdAt: NOW },
      ],
    },
  ],
  prepCrosswalk: [
    crosswalk('cw-1', 'butt_hinges', 'HINGE', 'HINGEF'),
    crosswalk('cw-2', 'cylindrical_lock', 'CYL', '478'),
    crosswalk('cw-3', 'surface_closer', 'CLP', null),
    crosswalk('cw-4', 'door_position_switch', null, 'DPS'),
  ],
  sellRules: [
    {
      id: 'sell-std', name: 'Standard 2× markup', costBasis: 'net', markupMultiplier: 2, gmTargetPct: null,
      rounding: null, customerClass: null, companyId: null, category: null, effectiveFrom: null, effectiveTo: null,
      priority: 1, createdAt: NOW, updatedAt: NOW,
    },
  ],
  serviceScopes: [
    { id: 'svc-install', scopeType: 'install', name: 'Field install', basis: 'per_opening', rate: 120, percent: null, referenceBasis: null, notes: null, createdAt: NOW, updatedAt: NOW },
    { id: 'svc-freight', scopeType: 'freight', name: 'Freight', basis: 'percent_of', rate: null, percent: 5, referenceBasis: 'sell', notes: null, createdAt: NOW, updatedAt: NOW },
    { id: 'svc-tax', scopeType: 'tax', name: 'Sales tax', basis: 'percent_of', rate: null, percent: 8, referenceBasis: 'sell', notes: null, createdAt: NOW, updatedAt: NOW },
  ],
  linearRules: [
    { id: 'lin-gask', hardwareCategory: 'gasketing', lengthBasis: 'perimeter', cutIncrement: null, wastePct: 10, minimumLength: null, perFootPrice: 3.5, hardwareVariantId: null, createdAt: NOW, updatedAt: NOW },
    { id: 'lin-thr', hardwareCategory: 'threshold', lengthBasis: 'width', cutIncrement: null, wastePct: 5, minimumLength: null, perFootPrice: 12, hardwareVariantId: null, createdAt: NOW, updatedAt: NOW },
  ],
};

function crosswalk(id: string, category: string, door: string | null, frame: string | null): HardwareCatalog['prepCrosswalk'][number] {
  return {
    id, hardwareCategory: category, hardwareProductId: null, hardwareVariantId: null,
    doorPrepCode: door, framePrepCode: frame, templateId: null, handRequired: false, locationRequired: false,
    additionalRequiredFields: null, quantityBasis: 'per_device', pricingBehavior: 'separate_line', notes: null,
    createdAt: NOW, updatedAt: NOW,
  };
}

function variant(id: string, productId: string, sku: string): HardwareVariant {
  return {
    id, hardwareProductId: productId, sku, function: null, finish: 'US32D', size: null, hand: null,
    voltage: null, rating: null, material: null, optionAttributes: {}, createdAt: NOW, updatedAt: NOW,
  };
}

function price(variantId: string, list: number, disc: number): HardwarePrice {
  return {
    id: `pr-${variantId}`, hardwareVariantId: variantId, hardwarePriceBookId: 'hw-book',
    listPrice: list, discountMultiplier: disc, netCost: Math.round(list * disc * 100) / 100, uom: 'each',
    effectiveFrom: null, effectiveTo: null, minimumQuantity: null, sourceRowRef: null,
    reviewStatus: 'APPROVED', createdAt: NOW, updatedAt: NOW,
  };
}

export const exampleVariantMap = new Map<string, VariantWithPrice>([
  ['v-hinge', { category: 'butt_hinges', subcategory: 'butt_hinge', variant: variant('v-hinge', 'p-hinge', 'BB1191-4.5'), price: price('v-hinge', 40, 0.5) }],
  ['v-lock', { category: 'cylindrical_lock', subcategory: 'cylindrical_lock', variant: variant('v-lock', 'p-lock', 'ND53PD-RHO'), price: price('v-lock', 300, 0.5) }],
  ['v-closer', { category: 'surface_closer', subcategory: 'surface_closer', variant: variant('v-closer', 'p-closer', '4040XP'), price: price('v-closer', 250, 0.6) }],
  ['v-dps', { category: 'door_position_switch', subcategory: 'door_position_switch', variant: variant('v-dps', 'p-dps', '679-05'), price: price('v-dps', 80, 0.5) }],
]);

export const exampleOpeningSpec: NormalizedOpeningSpec = {
  openingId: 'example-opening',
  estimateId: 'example-estimate',
  configurationType: 'single',
  leafCount: 1,
  quantity: 1,
  openingWidthIn: 36,
  openingHeightIn: 84,
  wall: 'CMU',
  fireLabelRequired: true,
  fields: {},
  components: [
    { id: 'door-1', entityType: 'door', label: 'Door 1', quantity: 1, code: 'H', fields: { 'door.nominal_door_width': '3-0', 'door.nominal_door_height': '7-0' } },
    { id: 'frame-1', entityType: 'frame', label: 'Frame 1', quantity: 1, code: 'F', fields: {} },
  ],
  hardware: [
    { category: 'butt_hinges', variantId: 'v-hinge', quantity: 3, required: true, source: 'set_template' },
    { category: 'cylindrical_lock', variantId: 'v-lock', quantity: 1, required: true, source: 'set_template' },
    { category: 'surface_closer', variantId: 'v-closer', quantity: 1, required: true, source: 'set_template' },
    { category: 'door_position_switch', variantId: 'v-dps', quantity: 1, required: false, source: 'set_template' },
    // Linear accessories: a variant is selected so one per-foot line is priced
    // from the category linear rule (the engine no longer prices every rule).
    { category: 'gasketing', variantId: 'v-gask', quantity: 1, required: false, source: 'set_template' },
    { category: 'threshold', variantId: 'v-thr', quantity: 1, required: false, source: 'set_template' },
  ],
  keying: null,
  accessControl: null,
};

export const exampleEngineOptions = { priceBookDocumentId: 'example-doc', minConfidence: 0.5 } as const;

/** Prices the Example Opening through the pure engine core (no DB). */
export function priceExampleOpening(): EngineResult {
  return priceOpeningCore(exampleOpeningSpec, exampleRuleSet, exampleCatalog, exampleVariantMap, exampleEngineOptions);
}
