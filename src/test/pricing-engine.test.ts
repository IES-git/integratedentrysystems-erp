import { describe, it, expect } from 'vitest';
import { priceOpeningCore } from '@/lib/pricing/engine';
import { engineLineOverrideKey } from '@/lib/pricing/engine-types';
import type { LoadedPriceRule, LoadedRuleSet } from '@/lib/pricing/engine-types';
import type { HardwareCatalog, VariantWithPrice } from '@/lib/pricing/loader';
import type { NormalizedOpeningSpec } from '@/lib/pricing/spec';
import { evalQuantityFormula } from '@/lib/pricing/quantity';
import { computeSell } from '@/lib/pricing/hardware';

function rule(partial: Partial<LoadedPriceRule>): LoadedPriceRule {
  return {
    id: partial.id ?? 'r1',
    ruleKey: null,
    priceBookId: partial.priceBookId ?? 'doc1',
    priceTableId: null,
    entityType: partial.entityType ?? 'door',
    chargeCategory: partial.chargeCategory ?? null,
    itemOrOptionCode: partial.itemOrOptionCode ?? null,
    priceStatus: partial.priceStatus ?? 'PRICED',
    actionType: partial.actionType ?? 'BASE_AMOUNT',
    amount: partial.amount ?? null,
    currencyCode: 'USD',
    unitOfMeasure: partial.unitOfMeasure ?? null,
    quantityBasisField: partial.quantityBasisField ?? null,
    baseQuantityIncluded: partial.baseQuantityIncluded ?? null,
    minimumCharge: partial.minimumCharge ?? null,
    maximumCharge: partial.maximumCharge ?? null,
    referenceRuleId: partial.referenceRuleId ?? null,
    percentage: partial.percentage ?? null,
    fixedAddAfterReference: partial.fixedAddAfterReference ?? null,
    roundingMethod: partial.roundingMethod ?? null,
    roundingIncrement: partial.roundingIncrement ?? null,
    priority: partial.priority ?? 100,
    stackingBehavior: partial.stackingBehavior ?? 'STACK',
    exclusiveGroup: partial.exclusiveGroup ?? null,
    effectiveFrom: null,
    effectiveTo: null,
    sourceRegionId: null,
    rawValueText: null,
    extractionConfidence: partial.extractionConfidence ?? 1,
    reviewStatus: 'APPROVED',
    createdAt: '',
    updatedAt: '',
    conditions: partial.conditions ?? [],
    actionParameters: [],
    includedScopes: partial.includedScopes ?? [],
    quantityTiers: partial.quantityTiers ?? [],
  };
}

const emptyCatalog: HardwareCatalog = {
  setTemplates: [],
  prepCrosswalk: [],
  sellRules: [],
  serviceScopes: [],
  linearRules: [],
};

function baseSpec(overrides: Partial<NormalizedOpeningSpec> = {}): NormalizedOpeningSpec {
  return {
    openingId: null,
    estimateId: null,
    configurationType: 'single',
    leafCount: 1,
    quantity: 1,
    openingWidthIn: 36,
    openingHeightIn: 84,
    fireLabelRequired: true,
    fields: {},
    components: [{ id: 'd1', entityType: 'door', label: 'Door 1', quantity: 1, code: 'H', fields: {} }],
    hardware: [],
    keying: null,
    accessControl: null,
    ...overrides,
  };
}

const opts = { priceBookDocumentId: 'doc1', minConfidence: 0.5 };

describe('pricing engine core', () => {
  it('prices a matched BASE rule as a BASE line', () => {
    const ruleSet: LoadedRuleSet = { rules: [rule({ id: 'base', actionType: 'BASE_AMOUNT', amount: 500, chargeCategory: 'base' })], dependencyRules: [] };
    const res = priceOpeningCore(baseSpec(), ruleSet, emptyCatalog, new Map(), opts);
    const base = res.lines.find((l) => l.lineType === 'BASE');
    expect(base).toBeTruthy();
    expect(base?.sellPrice).toBe(500);
    expect(res.totals.sellTotal).toBe(500);
  });

  it('multiplies the per-unit amount by the component quantity', () => {
    const ruleSet: LoadedRuleSet = { rules: [rule({ id: 'base', amount: 200 })], dependencyRules: [] };
    const spec = baseSpec({ components: [{ id: 'd1', entityType: 'door', label: 'Door', quantity: 3, code: 'H', fields: {} }] });
    const res = priceOpeningCore(spec, ruleSet, emptyCatalog, new Map(), opts);
    expect(res.lines.find((l) => l.lineType === 'BASE')?.sellPrice).toBe(600);
  });

  it('prices each component only from its pinned manufacturer document', () => {
    const ruleSet: LoadedRuleSet = {
      rules: [
        rule({ id: 'pioneer', priceBookId: 'doc-pioneer', amount: 500 }),
        rule({ id: 'ceco', priceBookId: 'doc-ceco', amount: 725 }),
      ],
      dependencyRules: [],
    };
    const spec = baseSpec({
      components: [{
        id: 'd1',
        entityType: 'door',
        label: 'Door',
        quantity: 1,
        code: null,
        manufacturerId: 'ceco',
        priceBookDocumentId: 'doc-ceco',
        fields: {},
      }],
    });
    const res = priceOpeningCore(spec, ruleSet, emptyCatalog, new Map(), {
      priceBookDocumentId: null,
      minConfidence: 0.5,
    });
    const priced = res.lines.filter((line) => line.lineType === 'BASE');
    expect(priced).toHaveLength(1);
    expect(priced[0].priceRuleId).toBe('ceco');
    expect(priced[0].priceBookId).toBe('doc-ceco');
    expect(priced[0].sellPrice).toBe(725);
  });

  it('does not match another manufacturer when a component has no resolvable document', () => {
    const ruleSet: LoadedRuleSet = {
      rules: [
        rule({ id: 'pioneer', priceBookId: 'doc-pioneer', amount: 500 }),
        rule({ id: 'ceco', priceBookId: 'doc-ceco', amount: 725 }),
      ],
      dependencyRules: [],
    };
    const spec = baseSpec({
      components: [{
        id: 'd1',
        entityType: 'door',
        label: 'Door',
        quantity: 1,
        code: null,
        manufacturerId: 'unknown-manufacturer',
        priceBookDocumentId: null,
        fields: {},
      }],
    });
    const res = priceOpeningCore(spec, ruleSet, emptyCatalog, new Map(), {
      priceBookDocumentId: null,
      priceBookDocumentIdsByManufacturer: {},
      minConfidence: 0.5,
    });
    expect(res.lines.some((line) => line.lineType === 'BASE')).toBe(false);
    expect(res.lines.some((line) => line.priceStatus === 'INVALID')).toBe(true);
  });

  it('routes CONTACT_FACTORY to the manual-quote queue', () => {
    const ruleSet: LoadedRuleSet = { rules: [rule({ id: 'cf', actionType: 'CONTACT_FACTORY', priceStatus: 'CONTACT_FACTORY' })], dependencyRules: [] };
    const res = priceOpeningCore(baseSpec(), ruleSet, emptyCatalog, new Map(), opts);
    expect(res.manualQuotes.some((m) => m.reason === 'CONTACT_FACTORY')).toBe(true);
  });

  it('suppresses the lower-priority rule in an exclusive group', () => {
    const ruleSet: LoadedRuleSet = {
      rules: [
        rule({ id: 'hi', actionType: 'BASE_AMOUNT', amount: 500, exclusiveGroup: 'g', priority: 1, chargeCategory: 'base' }),
        rule({ id: 'lo', actionType: 'BASE_AMOUNT', amount: 999, exclusiveGroup: 'g', priority: 5, chargeCategory: 'base' }),
      ],
      dependencyRules: [],
    };
    const res = priceOpeningCore(baseSpec(), ruleSet, emptyCatalog, new Map(), opts);
    const priced = res.lines.filter((l) => l.lineType === 'BASE');
    expect(priced).toHaveLength(1);
    expect(priced[0].sellPrice).toBe(500);
    expect(res.lines.some((l) => l.includedOrSuppressedBy === 'hi')).toBe(true);
  });

  it('emits an explicit exception when no base rule matches (never a silent zero)', () => {
    const res = priceOpeningCore(baseSpec(), { rules: [], dependencyRules: [] }, emptyCatalog, new Map(), opts);
    expect(res.lines.some((l) => l.priceStatus === 'INVALID')).toBe(true);
    expect(res.manualQuotes.some((m) => m.reason === 'MISSING_PRICE')).toBe(true);
  });

  it('applies manual sell prices to missing-price engine lines', () => {
    const firstPass = priceOpeningCore(baseSpec(), { rules: [], dependencyRules: [] }, emptyCatalog, new Map(), opts);
    const missing = firstPass.lines.find((l) => l.priceStatus === 'INVALID');
    expect(missing).toBeTruthy();

    const res = priceOpeningCore(baseSpec(), { rules: [], dependencyRules: [] }, emptyCatalog, new Map(), {
      ...opts,
      manualSellPriceByLineKey: { [engineLineOverrideKey(missing!)]: 475 },
    });

    const manualLine = res.lines.find((l) => l.manualSellPrice === 475);
    expect(manualLine?.priceStatus).toBe('PRICED');
    expect(manualLine?.sellPrice).toBe(475);
    expect(manualLine?.isManualOverride).toBe(true);
    expect(res.totals.exceptionCount).toBe(0);
    expect(res.totals.sellTotal).toBe(475);
    expect(res.manualQuotes).toHaveLength(0);
  });

  it('evaluates a BETWEEN condition against a dimension field', () => {
    const ruleSet: LoadedRuleSet = {
      rules: [rule({
        id: 'base', amount: 500,
        conditions: [{
          id: 'c1', priceRuleId: 'base', conditionGroup: 0, fieldId: null,
          fieldPath: 'door.nominal_door_width', operator: 'BETWEEN', valueType: 'DIMENSION',
          value1: '2-0', value2: '4-0', unit: null, inclusiveMin: true, inclusiveMax: true,
          normalizedValue: null, sourcePhrase: null, derivedFlag: false, nullBehavior: 'FAIL', createdAt: '',
        }],
      })],
      dependencyRules: [],
    };
    const spec = baseSpec({ components: [{ id: 'd1', entityType: 'door', label: 'Door', quantity: 1, code: 'H', fields: { 'door.nominal_door_width': '3-0' } }] });
    const res = priceOpeningCore(spec, ruleSet, emptyCatalog, new Map(), opts);
    expect(res.lines.find((l) => l.lineType === 'BASE')?.sellPrice).toBe(500);
  });

  it('matches A40 and A60 material selections against Galvannealed rules', () => {
    const ruleSet: LoadedRuleSet = {
      rules: [rule({
        id: 'base', amount: 625,
        conditions: [{
          id: 'c1', priceRuleId: 'base', conditionGroup: 0, fieldId: null,
          fieldPath: 'door.door_material', operator: 'EQ', valueType: 'TEXT',
          value1: 'Galvannealed', value2: null, unit: null, inclusiveMin: null, inclusiveMax: null,
          normalizedValue: null, sourcePhrase: null, derivedFlag: false, nullBehavior: 'FAIL', createdAt: '',
        }],
      })],
      dependencyRules: [],
    };

    for (const material of ['A40', 'A60']) {
      const spec = baseSpec({
        components: [{
          id: `d-${material}`,
          entityType: 'door',
          label: 'Door',
          quantity: 1,
          code: 'H',
          fields: { 'door.door_material': material },
        }],
      });
      const res = priceOpeningCore(spec, ruleSet, emptyCatalog, new Map(), opts);
      expect(res.lines.find((l) => l.lineType === 'BASE')?.sellPrice).toBe(625);
    }
  });

  it('matches frame jamb-depth LTE conditions against mixed fractional inch values', () => {
    const ruleSet: LoadedRuleSet = {
      rules: [rule({
        id: 'frame-base',
        entityType: 'frame',
        chargeCategory: 'base',
        amount: 311,
        conditions: [{
          id: 'c1', priceRuleId: 'frame-base', conditionGroup: 0, fieldId: null,
          fieldPath: 'frame.jamb_depth', operator: 'LTE', valueType: 'DIMENSION',
          value1: '7.875', value2: null, unit: 'in', inclusiveMin: null, inclusiveMax: true,
          normalizedValue: null, sourcePhrase: null, derivedFlag: false, nullBehavior: 'FAIL', createdAt: '',
        }],
      })],
      dependencyRules: [],
    };
    const spec = baseSpec({
      components: [{
        id: 'f1',
        entityType: 'frame',
        label: 'Frame',
        quantity: 1,
        code: 'F',
        fields: { 'frame.jamb_depth': '6 5/8' },
      }],
    });
    const res = priceOpeningCore(spec, ruleSet, emptyCatalog, new Map(), opts);
    expect(res.lines.find((l) => l.lineType === 'BASE')?.sellPrice).toBe(311);
  });

  it('treats standard manufacturer-scoped hardware preps as included when no prep price rule is published', () => {
    const docId = 'doc-ceco';
    const catalog: HardwareCatalog = {
      ...emptyCatalog,
      prepCrosswalk: [
        {
          id: 'cw-butt', hardwareCategory: 'butt_hinge', hardwareProductId: null, hardwareVariantId: null,
          doorPrepCode: '450--', framePrepCode: '450--', templateId: null, handRequired: false, locationRequired: false,
          additionalRequiredFields: null, quantityBasis: null, pricingBehavior: null, notes: null, createdAt: '', updatedAt: '',
        },
        {
          id: 'cw-deadbolt', hardwareCategory: 'deadbolt', hardwareProductId: null, hardwareVariantId: null,
          doorPrepCode: 'CDL', framePrepCode: '234N', templateId: null, handRequired: false, locationRequired: false,
          additionalRequiredFields: null, quantityBasis: null, pricingBehavior: null, notes: null, createdAt: '', updatedAt: '',
        },
      ],
    };
    const variantMap = new Map<string, VariantWithPrice>([
      ['hinge', {
        category: 'butt_hinges',
        subcategory: 'butt_hinge',
        variant: { id: 'hinge', hardwareProductId: 'p-hinge', sku: 'HINGE', function: null, finish: null, size: null, hand: null, voltage: null, rating: null, material: null, optionAttributes: {}, createdAt: '', updatedAt: '' },
        price: { id: 'hp-hinge', hardwareVariantId: 'hinge', hardwarePriceBookId: null, listPrice: 10, discountMultiplier: null, netCost: 10, uom: 'each', effectiveFrom: null, effectiveTo: null, minimumQuantity: null, sourceRowRef: null, reviewStatus: 'APPROVED', createdAt: '', updatedAt: '' },
      }],
      ['deadbolt', {
        category: 'cylindrical_mortise_locks_and_deadbolts',
        subcategory: 'deadbolt',
        variant: { id: 'deadbolt', hardwareProductId: 'p-deadbolt', sku: 'DB', function: null, finish: null, size: null, hand: null, voltage: null, rating: null, material: null, optionAttributes: {}, createdAt: '', updatedAt: '' },
        price: { id: 'hp-deadbolt', hardwareVariantId: 'deadbolt', hardwarePriceBookId: null, listPrice: 20, discountMultiplier: null, netCost: 20, uom: 'each', effectiveFrom: null, effectiveTo: null, minimumQuantity: null, sourceRowRef: null, reviewStatus: 'APPROVED', createdAt: '', updatedAt: '' },
      }],
    ]);
    const spec = baseSpec({
      components: [
        { id: 'd1', entityType: 'door', label: 'Door', quantity: 1, code: null, manufacturerId: 'ceco', priceBookDocumentId: docId, fields: {} },
        { id: 'f1', entityType: 'frame', label: 'Frame', quantity: 1, code: null, manufacturerId: 'ceco', priceBookDocumentId: docId, fields: {} },
      ],
      hardware: [
        { category: 'butt_hinges', variantId: 'hinge', quantity: 3, required: true, source: 'manual' },
        { category: 'cylindrical_mortise_locks_and_deadbolts', variantId: 'deadbolt', quantity: 1, required: true, source: 'manual' },
      ],
    });
    const res = priceOpeningCore(
      spec,
      {
        rules: [
          rule({ id: 'door-base', priceBookId: docId, entityType: 'door', amount: 100, chargeCategory: 'base' }),
          rule({ id: 'frame-base', priceBookId: docId, entityType: 'frame', amount: 100, chargeCategory: 'base' }),
        ],
        dependencyRules: [],
      },
      catalog,
      variantMap,
      { priceBookDocumentId: null, minConfidence: 0.5 },
    );

    const includedPrepCodes = res.lines
      .filter((line) => line.entityType === 'prep' && line.priceStatus === 'INCLUDED')
      .map((line) => line.selectedOptionCode)
      .sort();
    expect(includedPrepCodes).toEqual(['234N', '450--', '450--', 'CDL']);
    expect(res.lines.filter((line) => line.entityType === 'prep').every((line) => line.priceBookId === docId)).toBe(true);
    expect(res.manualQuotes.some((manual) => /Prep price/i.test(String(manual.requestedInputs)))).toBe(false);
  });

  it('still routes unknown/special preps to manual review when no prep price rule is published', () => {
    const docId = 'doc-ceco';
    const catalog: HardwareCatalog = {
      ...emptyCatalog,
      prepCrosswalk: [{
        id: 'cw-special', hardwareCategory: 'special_hardware', hardwareProductId: null, hardwareVariantId: null,
        doorPrepCode: 'ZZZ', framePrepCode: null, templateId: null, handRequired: false, locationRequired: false,
        additionalRequiredFields: null, quantityBasis: null, pricingBehavior: null, notes: null, createdAt: '', updatedAt: '',
      }],
    };
    const variantMap = new Map<string, VariantWithPrice>([['special', {
      category: 'special_hardware',
      subcategory: 'special_hardware',
      variant: { id: 'special', hardwareProductId: 'p-special', sku: 'SPECIAL', function: null, finish: null, size: null, hand: null, voltage: null, rating: null, material: null, optionAttributes: {}, createdAt: '', updatedAt: '' },
      price: { id: 'hp-special', hardwareVariantId: 'special', hardwarePriceBookId: null, listPrice: 20, discountMultiplier: null, netCost: 20, uom: 'each', effectiveFrom: null, effectiveTo: null, minimumQuantity: null, sourceRowRef: null, reviewStatus: 'APPROVED', createdAt: '', updatedAt: '' },
    }]]);
    const spec = baseSpec({
      components: [{ id: 'd1', entityType: 'door', label: 'Door', quantity: 1, code: null, manufacturerId: 'ceco', priceBookDocumentId: docId, fields: {} }],
      hardware: [{ category: 'special_hardware', variantId: 'special', quantity: 1, required: true, source: 'manual' }],
    });
    const res = priceOpeningCore(
      spec,
      { rules: [rule({ id: 'door-base', priceBookId: docId, entityType: 'door', amount: 100, chargeCategory: 'base' })], dependencyRules: [] },
      catalog,
      variantMap,
      { priceBookDocumentId: null, minConfidence: 0.5 },
    );

    const specialPrep = res.lines.find((line) => line.entityType === 'prep' && line.selectedOptionCode === 'ZZZ');
    expect(specialPrep?.priceStatus).toBe('INVALID');
    expect(res.manualQuotes.some((manual) => /Prep price.*ZZZ/i.test(String(manual.requestedInputs)))).toBe(true);
  });

  it('prices selected hardware net × qty and computes sell via a sell rule', () => {
    const catalog: HardwareCatalog = {
      ...emptyCatalog,
      sellRules: [{
        id: 's1', name: 'std', costBasis: 'net', markupMultiplier: 2, gmTargetPct: null, rounding: null,
        customerClass: null, companyId: null, category: null, effectiveFrom: null, effectiveTo: null, priority: 1, createdAt: '', updatedAt: '',
      }],
    };
    const variantMap = new Map<string, VariantWithPrice>([['v1', {
      category: 'butt_hinges',
      subcategory: 'butt_hinge',
      manufacturerId: 'hardware-maker-id',
      manufacturerName: 'Hardware Maker',
      variant: { id: 'v1', hardwareProductId: 'p1', sku: 'HG-1', function: null, finish: null, size: null, hand: null, voltage: null, rating: null, material: null, optionAttributes: {}, createdAt: '', updatedAt: '' },
      price: { id: 'pr1', hardwareVariantId: 'v1', hardwarePriceBookId: null, listPrice: 50, discountMultiplier: 0.5, netCost: 25, uom: 'each', effectiveFrom: null, effectiveTo: null, minimumQuantity: null, sourceRowRef: null, reviewStatus: 'APPROVED', createdAt: '', updatedAt: '' },
    }]]);
    const spec = baseSpec({ hardware: [{ category: 'butt_hinges', variantId: 'v1', quantity: 3, required: true, source: 'manual' }] });
    const res = priceOpeningCore(spec, { rules: [], dependencyRules: [] }, catalog, variantMap, opts);
    const hwLine = res.lines.find((l) => l.chargeCategory === 'butt_hinges' && l.priceStatus === 'PRICED');
    expect(hwLine?.extendedNetPrice).toBe(75); // 25 × 3
    expect(hwLine?.sellPrice).toBe(150); // 50 sell × 3
    expect(hwLine?.manufacturerId).toBe('hardware-maker-id');
    expect(hwLine?.manufacturerName).toBe('Hardware Maker');
    expect(hwLine?.priceBookId).toBe('doc1'); // pricing audit source, not RFQ routing identity
  });

  it('does not assign the structural manufacturer to unmatched manual hardware', () => {
    const spec = baseSpec({
      components: [{ id: 'd1', entityType: 'door', label: 'Door', quantity: 1, code: 'H', manufacturerId: 'door-maker', fields: {} }],
      hardware: [{ category: 'butt_hinges', variantId: null, quantity: 3, required: true, source: 'manual' }],
    });
    const res = priceOpeningCore(spec, { rules: [], dependencyRules: [] }, emptyCatalog, new Map(), opts);
    const manualHardware = res.lines.find((line) => line.entityType === 'hardware');
    expect(manualHardware?.manufacturerId).toBeNull();
    expect(manualHardware?.manufacturerName).toBeNull();
  });
});

describe('quantity formula', () => {
  it('derives hinge count from height and doubles for pairs', () => {
    const tall = evalQuantityFormula('hinge_count(height, leaf_count) per leaf', baseSpec({ configurationType: 'pair', leafCount: 2, openingHeightIn: 96 }));
    expect(tall.quantity).toBe(8); // 4 per leaf (>88") × 2 leaves
    const std = evalQuantityFormula('hinge_count(height, leaf_count)', baseSpec({ openingHeightIn: 84 }));
    expect(std.quantity).toBe(3);
  });

  it('computes flush bolts top+bottom', () => {
    expect(evalQuantityFormula('flush bolts top+bottom on inactive leaf', baseSpec()).quantity).toBe(2);
  });
});

describe('computeSell', () => {
  it('applies a GM target', () => {
    const r = computeSell(60, 100, { id: 's', name: 'gm', costBasis: 'net', markupMultiplier: null, gmTargetPct: 40, rounding: null, customerClass: null, companyId: null, category: null, effectiveFrom: null, effectiveTo: null, priority: 1, createdAt: '', updatedAt: '' });
    expect(r.sell).toBe(100); // 60 / (1 - 0.4)
    expect(Math.round(r.gmPct)).toBe(40);
  });
});
