import { describe, it, expect } from 'vitest';
import {
  nextEvenSize, resolveInfill, resolveTape, validateRating, validateMutualExclusion,
  louverCores, glassPriceTable, resolvePriceTable,
} from '@/lib/cpq/ngp-infill';
import type { NgpCatalog } from '@/lib/ngp-catalog-api';
import { emptyNgpCatalog } from '@/lib/ngp-catalog-api';
import { priceOpeningCore } from '@/lib/pricing/engine';
import type { LoadedPriceRule } from '@/lib/pricing/engine-types';
import type { HardwareCatalog, LoadedRuleSet } from '@/lib/pricing/loader';
import type { NormalizedOpeningSpec } from '@/lib/pricing/spec';
import type { NgpProduct } from '@/types';

// ---- fixtures ----
function product(p: Partial<NgpProduct>): NgpProduct {
  return {
    id: p.id ?? p.productId ?? 'np', priceBookDocumentId: 'doc', productId: p.productId ?? 'NGP-X',
    manufacturer: 'NGP', category: p.category ?? 'LITE_KIT', subcategory: p.subcategory ?? null,
    model: p.model ?? null, modelAliases: null, productName: null, material: p.material ?? null,
    standardFinish: null, doorThicknessMinIn: p.doorThicknessMinIn ?? null, doorThicknessMaxIn: p.doorThicknessMaxIn ?? null,
    glassThicknessMinIn: p.glassThicknessMinIn ?? null, glassThicknessMaxIn: p.glassThicknessMaxIn ?? null,
    fireRatingMax: p.fireRatingMax ?? null, preferredPriceUom: 'EA', glassScope: p.glassScope ?? null,
    active: true, sourcePage: null, notes: null, createdAt: '',
  };
}

function catalog(): NgpCatalog {
  const c = emptyNgpCatalog();
  c.documentId = 'doc';
  c.products = [
    product({ productId: 'NGP-L-FRA100', model: 'L-FRA100', category: 'LITE_KIT', subcategory: 'VISION_LITE', doorThicknessMinIn: 1.75, doorThicknessMaxIn: 1.75, fireRatingMax: 180, glassScope: 'SEPARATE_REQUIRED' }),
    product({ productId: 'NGP-STORM-PRO-HR', model: 'STORM-PRO-HR', category: 'LITE_KIT', subcategory: 'VISION_LITE', doorThicknessMinIn: 1.75, doorThicknessMaxIn: 1.75, fireRatingMax: 0, glassScope: 'BUNDLED' }),
    product({ productId: 'NGP-PYRAN-PLATINUM-F', model: 'Pyran Platinum F', category: 'GLASS', fireRatingMax: 180, glassThicknessMinIn: 0.1875, glassThicknessMaxIn: 0.1875 }),
    product({ productId: 'NGP-TEMPERED', model: 'Tempered Glass', category: 'GLASS', fireRatingMax: 0, glassThicknessMinIn: 0.25, glassThicknessMaxIn: 0.25 }),
    product({ productId: 'NGP-L-700-A', model: 'L-700-A', category: 'LOUVER', subcategory: 'NO_VISION', material: '20 ga CRS', doorThicknessMinIn: 1.375, doorThicknessMaxIn: 2.25, fireRatingMax: 0 }),
  ];
  c.capacities = [
    { id: 'cap1', priceBookDocumentId: 'doc', capacityId: 'CAP-1', kitModel: 'L-FRA100', doorThicknessIn: 1.75, glassThicknessIn: 0.1875, requiredTapeModel: 'L-GT-118', profileGroup: null, allowed: true, sourcePage: null },
  ];
  c.ratings = [
    { id: 'r1', priceBookDocumentId: 'doc', ratingId: 'RATING-001', glassModel: 'Pyran Platinum F', fireMinutes: '20/45/60/90', application: 'Door, non-temperature-rise', maxVisibleAreaSqIn: 3708, maxVisibleWidthIn: 37.75, maxVisibleHeightIn: 98.25, sourcePage: null },
  ];
  c.sizeRules = [
    { id: 's1', priceBookDocumentId: 'doc', sizeRuleId: 'SZ-1', modelOrFamily: 'L-FRA100', outputField: 'exposed_glass', operator: 'SUBTRACT', value: 2, unit: 'in', inputBasis: 'order_size', sourcePage: null },
    { id: 's2', priceBookDocumentId: 'doc', sizeRuleId: 'SZ-2', modelOrFamily: 'ALL STEEL LOUVERS', outputField: 'two_core_width_threshold', operator: 'OVER', value: 46, unit: 'in', inputBasis: 'order_width', sourcePage: null },
    { id: 's3', priceBookDocumentId: 'doc', sizeRuleId: 'SZ-3', modelOrFamily: 'ALL LOUVERS', outputField: 'two_core_height_threshold', operator: 'AT_OR_OVER', value: 64, unit: 'in', inputBasis: 'order_height', sourcePage: null },
  ];
  c.tableMaps = [
    { id: 'm1', priceBookDocumentId: 'doc', mapId: 'MAP-1', ngpPriceTableId: 'PT-LK-STANDARD', priceTableId: 'pt-std', model: 'L-FRA100', relationship: 'BASE', multiplier: 1, condition: null, includedScope: 'KIT_ONLY', glassModel: null, tapeModel: null, entityType: 'lite_kit', sourcePage: null },
    { id: 'm2', priceBookDocumentId: 'doc', mapId: 'MAP-2', ngpPriceTableId: 'PT-LK-PYRAN-F', priceTableId: 'pt-asm', model: 'L-FRA100', relationship: 'BASE', multiplier: 1, condition: null, includedScope: 'KIT_GLASS_TAPE_BOTH_SIDES', glassModel: 'Pyran Platinum F', tapeModel: 'L-GT-118', entityType: 'lite_kit', sourcePage: null },
    { id: 'm3', priceBookDocumentId: 'doc', mapId: 'MAP-3', ngpPriceTableId: 'PT-GL-PYRAN-F', priceTableId: 'pt-glass', model: 'Pyran Platinum F', relationship: 'BASE', multiplier: 1, condition: null, includedScope: 'GLASS_ONLY', glassModel: 'Pyran Platinum F', tapeModel: null, entityType: 'glass', sourcePage: null },
    { id: 'm4', priceBookDocumentId: 'doc', mapId: 'MAP-4', ngpPriceTableId: 'PT-LK-STORM-PRO-HR', priceTableId: 'pt-storm', model: 'STORM-PRO-HR', relationship: 'BASE', multiplier: 1, condition: null, includedScope: 'KIT_GLASS_SETTING_BLOCKS_CAULK', glassModel: 'NGP-WS', tapeModel: null, entityType: 'lite_kit', sourcePage: null },
    { id: 'm5', priceBookDocumentId: 'doc', mapId: 'MAP-5', ngpPriceTableId: 'PT-LV-STEEL', priceTableId: 'pt-louver', model: 'L-700-A', relationship: 'BASE', multiplier: 1, condition: null, includedScope: 'LOUVER_ONLY', glassModel: null, tapeModel: null, entityType: 'louver', sourcePage: null },
  ];
  return c;
}

describe('ngp-infill pure logic', () => {
  it('rounds up to the next even inch', () => {
    expect(nextEvenSize(6)).toBe(6);
    expect(nextEvenSize(7)).toBe(8);
    expect(nextEvenSize(6.5)).toBe(8);
    expect(nextEvenSize(23)).toBe(24);
  });

  it('auto-selects the tape from the kit/door/glass capacity table', () => {
    const t = resolveTape(catalog(), 'L-FRA100', 1.75, 0.1875);
    expect(t.tapeModel).toBe('L-GT-118');
    expect(t.matched).toBe(true);
  });

  it('component mode: resolves kit + glass + tape as three components', () => {
    const r = resolveInfill(catalog(), {
      infillType: 'LITE', cutoutWidthIn: 24, cutoutHeightIn: 32, doorThicknessIn: 1.75,
      fireRatingMinutes: 90, glassModel: 'Pyran Platinum F', preferAssembly: false,
    });
    expect(r.kit?.model).toBe('L-FRA100');
    expect(r.tapeModel).toBe('L-GT-118');
    const entities = r.components.map((c) => c.entityType).sort();
    expect(entities).toEqual(['glass', 'glazing_tape', 'lite_kit']);
  });

  it('assembly mode: a single lite_kit component, no separate glass/tape', () => {
    const r = resolveInfill(catalog(), {
      infillType: 'LITE', cutoutWidthIn: 24, cutoutHeightIn: 32, doorThicknessIn: 1.75,
      fireRatingMinutes: 90, glassModel: 'Pyran Platinum F', preferAssembly: true,
    });
    expect(r.assemblyMode).toBe(true);
    expect(r.components).toHaveLength(1);
    expect(r.components[0].entityType).toBe('lite_kit');
  });

  it('bundled kit suppresses separate glass + tape', () => {
    const r = resolveInfill(catalog(), {
      infillType: 'LITE', cutoutWidthIn: 24, cutoutHeightIn: 32, doorThicknessIn: 1.75,
      fireRatingMinutes: 0, kitModel: 'STORM-PRO-HR', preferAssembly: false,
    });
    expect(r.glassBundled).toBe(true);
    expect(r.components.every((c) => c.entityType !== 'glass' && c.entityType !== 'glazing_tape')).toBe(true);
  });

  it('blocks when exposed glass exceeds the fire visible-area limit', () => {
    const issues = validateRating(catalog(), 'Pyran Platinum F', 90, 40, 40);
    expect(issues.some((i) => i.severity === 'block')).toBe(true);
  });

  it('passes rating validation within limits', () => {
    const issues = validateRating(catalog(), 'Pyran Platinum F', 90, 30, 30);
    expect(issues.filter((i) => i.severity === 'block')).toHaveLength(0);
  });

  it('forces two louver cores above the width threshold', () => {
    expect(louverCores(catalog(), '20 ga CRS', 48, 30)).toBe(2);
    expect(louverCores(catalog(), '20 ga CRS', 24, 30)).toBe(1);
  });

  it('mutual exclusion blocks lite + louver on the same cutout', () => {
    expect(validateMutualExclusion('LITE', true, true)).toHaveLength(1);
    expect(validateMutualExclusion('LITE', true, false)).toHaveLength(0);
  });

  it('resolves the assembly table when preferred, else the kit-only base', () => {
    expect(resolvePriceTable(catalog(), 'L-FRA100', { glassModel: 'Pyran Platinum F', preferAssembly: true }).assembly).toBe(true);
    expect(resolvePriceTable(catalog(), 'L-FRA100', { preferAssembly: false }).priceTableId).toBe('pt-std');
    expect(glassPriceTable(catalog(), 'Pyran Platinum F')).toBe('pt-glass');
  });

  it('louver infill never generates glass or tape', () => {
    const r = resolveInfill(catalog(), {
      infillType: 'LOUVER', cutoutWidthIn: 24, cutoutHeightIn: 24, doorThicknessIn: 1.75, fireRatingMinutes: 0,
    });
    expect(r.louver?.model).toBe('L-700-A');
    expect(r.components.every((c) => c.entityType === 'louver')).toBe(true);
  });
});

// ---- engine integration (matrix band matching + multiplier + option pass) ----
function rule(partial: Partial<LoadedPriceRule>): LoadedPriceRule {
  return {
    id: partial.id ?? 'r', ruleKey: null, priceBookId: 'doc', priceTableId: null,
    entityType: partial.entityType ?? 'lite_kit', chargeCategory: partial.chargeCategory ?? null,
    itemOrOptionCode: partial.itemOrOptionCode ?? null, priceStatus: partial.priceStatus ?? 'PRICED',
    actionType: partial.actionType ?? 'BASE_AMOUNT', amount: partial.amount ?? null, currencyCode: 'USD',
    unitOfMeasure: null, quantityBasisField: partial.quantityBasisField ?? null, baseQuantityIncluded: null,
    minimumCharge: null, maximumCharge: null, referenceRuleId: partial.referenceRuleId ?? null,
    percentage: partial.percentage ?? null, fixedAddAfterReference: null, roundingMethod: null, roundingIncrement: null,
    priority: partial.priority ?? 100, stackingBehavior: partial.stackingBehavior ?? 'STACK', exclusiveGroup: partial.exclusiveGroup ?? null,
    effectiveFrom: null, effectiveTo: null, sourceRegionId: null, rawValueText: null, extractionConfidence: 1,
    reviewStatus: 'APPROVED', createdAt: '', updatedAt: '', conditions: partial.conditions ?? [],
    actionParameters: [], includedScopes: [], quantityTiers: [],
  };
}

function band(fieldPath: string, lo: number, hi: number) {
  return {
    id: `c-${fieldPath}-${hi}`, priceRuleId: 'x', conditionGroup: 0, fieldId: null, fieldPath,
    operator: 'BETWEEN' as const, valueType: 'NUMBER' as const, value1: String(lo), value2: String(hi),
    unit: null, inclusiveMin: false, inclusiveMax: true, normalizedValue: null, sourcePhrase: null,
    derivedFlag: false, nullBehavior: 'FAIL' as const, createdAt: '',
  };
}
function eq(fieldPath: string, value: string) {
  return {
    id: `eq-${fieldPath}`, priceRuleId: 'x', conditionGroup: 0, fieldId: null, fieldPath,
    operator: 'EQ' as const, valueType: 'TEXT' as const, value1: value, value2: null, unit: null,
    inclusiveMin: null, inclusiveMax: null, normalizedValue: null, sourcePhrase: null, derivedFlag: false,
    nullBehavior: 'FAIL' as const, createdAt: '',
  };
}

const emptyHw: HardwareCatalog = { setTemplates: [], prepCrosswalk: [], sellRules: [], serviceScopes: [], linearRules: [] };
const opts = { priceBookDocumentId: 'doc', minConfidence: 0.5 };

function ngpSpec(fields: Record<string, string | number>): NormalizedOpeningSpec {
  return {
    openingId: null, estimateId: null, configurationType: 'single', leafCount: 1, quantity: 1,
    openingWidthIn: 36, openingHeightIn: 84, fireLabelRequired: false, fields,
    components: [{ id: 'k1', entityType: 'lite_kit', label: 'NGP kit', quantity: 1, code: 'L-FRA100', fields }],
    hardware: [], keying: null, accessControl: null,
  };
}

describe('ngp engine integration', () => {
  it('matrix band matching implements next-largest-size rounding', () => {
    const rules = [
      rule({ id: '6', amount: 113, chargeCategory: 'lite_kit', exclusiveGroup: 'ngp:pt', conditions: [eq('infill.price_table_id', 'pt'), band('infill.order_width_in', 0, 6), band('infill.order_height_in', 0, 6)] }),
      rule({ id: '8', amount: 137, chargeCategory: 'lite_kit', exclusiveGroup: 'ngp:pt', conditions: [eq('infill.price_table_id', 'pt'), band('infill.order_width_in', 6, 8), band('infill.order_height_in', 0, 6)] }),
    ];
    const ruleSet: LoadedRuleSet = { rules, dependencyRules: [] };
    // order width 7 → next-largest even (8) band; height 4 → first band.
    const res = priceOpeningCore(ngpSpec({ 'infill.price_table_id': 'pt', 'infill.order_width_in': 7, 'infill.order_height_in': 4 }), ruleSet, emptyHw, new Map(), opts);
    const base = res.lines.find((l) => l.lineType === 'BASE');
    expect(base?.sellPrice).toBe(137);
  });

  it('applies an NGP percent-of-base option adder', () => {
    const rules = [
      rule({ id: 'base', amount: 200, chargeCategory: 'lite_kit', conditions: [eq('infill.price_table_id', 'pt')] }),
    ];
    const optionRule = rule({ id: 'opt1', actionType: 'PERCENT_OF', percentage: 25, chargeCategory: 'option:PC-COLOR' });
    const spec = ngpSpec({ 'infill.price_table_id': 'pt', 'infill.options': 'PC-COLOR' });
    const ngp = {
      options: [{ id: 'o1', priceBookDocumentId: 'doc', optionId: 'OPT-1', appliesTo: null, optionCode: 'PC-COLOR', optionName: 'Powder coat', optionType: 'FINISH', requirements: null, exclusions: null, pricingStatus: 'PRICED', priceRuleId: 'opt1', sourcePage: null }],
      optionRuleById: new Map([['opt1', optionRule]]),
      policies: [],
    };
    const res = priceOpeningCore(spec, { rules, dependencyRules: [] }, emptyHw, new Map(), opts, ngp);
    const adder = res.lines.find((l) => l.chargeCategory === 'option:PC-COLOR');
    expect(adder?.sellPrice).toBe(50); // 25% of 200
  });

  it('applies the NGP oversize commercial policy', () => {
    const rules = [rule({ id: 'base', amount: 500, chargeCategory: 'lite_kit', conditions: [eq('infill.price_table_id', 'pt')] })];
    const spec = ngpSpec({ 'infill.price_table_id': 'pt', 'infill.order_width_in': 72, 'infill.order_height_in': 24 });
    const ngp = {
      options: [], optionRuleById: new Map<string, LoadedPriceRule>(),
      policies: [{ id: 'p1', priceBookDocumentId: 'doc', policyId: 'POL-OVERSIZE-100', policyType: 'SURCHARGE', description: null, basis: 'ORDER', amountOrThreshold: 100, unit: 'USD', condition: null, sourcePage: null }],
    };
    const res = priceOpeningCore(spec, { rules, dependencyRules: [] }, emptyHw, new Map(), opts, ngp);
    expect(res.lines.some((l) => l.chargeCategory === 'ngp_policy' && l.sellPrice === 100)).toBe(true);
  });
});
