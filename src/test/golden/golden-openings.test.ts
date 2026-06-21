import { describe, it, expect } from 'vitest';
import { priceOpeningCore } from '@/lib/pricing';
import type { LoadedPriceRule, HardwareCatalog, VariantWithPrice } from '@/lib/pricing';
import {
  buildGoldenRuleSet,
  buildGoldenSpec,
  emptyCatalog,
  emptyVariantMap,
  generateGoldenCases,
  referenceSellPerOpening,
} from './golden-openings';

const opts = { priceBookDocumentId: 'golden-doc', minConfidence: 0.5 };
const cases = generateGoldenCases();

function sellTotal(spec: ReturnType<typeof buildGoldenSpec>, rules = buildGoldenRuleSet()) {
  return priceOpeningCore(spec, rules, emptyCatalog, emptyVariantMap, opts).totals.sellTotal;
}

describe('golden openings — cent-level agreement (50 cases)', () => {
  it('generates 50 cases spanning the required configuration space', () => {
    expect(cases).toHaveLength(50);
  });

  for (const c of cases) {
    it(`prices "${c.label}" to the estimator total`, () => {
      const expected = referenceSellPerOpening(c);
      const got = sellTotal(buildGoldenSpec(c));
      expect(got).toBeCloseTo(expected, 2);
    });
  }
});

describe('quantity contract — single extension, opening qty applied once', () => {
  for (const c of cases.slice(0, 10)) {
    it(`"${c.label}" per-opening total is independent of opening quantity (1/2/10)`, () => {
      const base = referenceSellPerOpening(c);
      for (const oq of [1, 2, 10]) {
        const perOpening = sellTotal(buildGoldenSpec({ ...c, openingQty: oq }));
        // Engine lines describe ONE opening; the per-opening subtotal must not
        // change with opening quantity (no double extension). Rollup multiplies once.
        expect(perOpening).toBeCloseTo(base, 2);
        expect(perOpening * oq).toBeCloseTo(base * oq, 2);
      }
    });
  }

  it('extends a per-inch (RATE_X_QUANTITY) charge exactly once per component instance', () => {
    // 3 identical 3-0 (36") doors: each = 850 base + 2×36 + 0 fire = 922; ×3 = 2766; + frame 320.
    const spec = buildGoldenSpec({
      id: 'x', label: 'qty', configurationType: 'single', leafCount: 1, fireLabel: false,
      doorWidths: ['3-0'], doorQtys: [3], frameQty: 1, openingQty: 1,
    });
    expect(sellTotal(spec)).toBeCloseTo(922 * 3 + 320, 2);
  });
});

describe('status semantics — never a silent zero', () => {
  it('NOT_APPLICABLE blocks the configuration (INVALID + INVALID_COMBINATION), not a $0 included line', () => {
    const naRule: LoadedPriceRule = {
      ...buildGoldenRuleSet().rules[0],
      id: 'g-door-na', entityType: 'door', chargeCategory: 'option', actionType: 'NOT_APPLICABLE',
      amount: null, itemOrOptionCode: null, conditions: [],
    };
    const rules = buildGoldenRuleSet([naRule]);
    const spec = buildGoldenSpec({
      id: 'na', label: 'na', configurationType: 'single', leafCount: 1, fireLabel: false,
      doorWidths: ['3-0'], doorQtys: [1], frameQty: 1, openingQty: 1,
    });
    const res = priceOpeningCore(spec, rules, emptyCatalog, emptyVariantMap, opts);
    expect(res.lines.some((l) => l.priceStatus === 'INVALID' && /not applicable/i.test(l.calculationExpression))).toBe(true);
    expect(res.manualQuotes.some((m) => m.reason === 'INVALID_COMBINATION')).toBe(true);
    // It must NOT be a $0 INCLUDED line.
    expect(res.lines.some((l) => l.lineType === 'INCLUDED' && /not applicable/i.test(l.calculationExpression))).toBe(false);
  });

  it('a missing prep price routes to manual review (not assumed included)', () => {
    // Hardware needs a HINGE prep, but the rule set publishes NO prep rule.
    const catalog: HardwareCatalog = {
      ...emptyCatalog,
      setTemplates: [{
        id: 'set', name: 'single', useCase: 'single', fireRated: false, accessControlled: false,
        ratedFlags: {}, selectionConditions: { configuration_type: 'single' },
        createdAt: '', updatedAt: '',
        items: [{ id: 'i1', hardwareSetTemplateId: 'set', category: 'butt_hinges', quantityFormula: '3', required: true, position: 1, compatibleVariants: {}, createdAt: '' }],
      }],
      prepCrosswalk: [{
        id: 'cw', hardwareCategory: 'butt_hinges', hardwareProductId: null, hardwareVariantId: null,
        doorPrepCode: 'HINGE', framePrepCode: 'HINGEF', templateId: null, handRequired: false, locationRequired: false,
        additionalRequiredFields: null, quantityBasis: 'per_device', pricingBehavior: 'separate_line', notes: null,
        createdAt: '', updatedAt: '',
      }],
    };
    const spec = buildGoldenSpec({
      id: 'mp', label: 'missing prep', configurationType: 'single', leafCount: 1, fireLabel: false,
      doorWidths: ['3-0'], doorQtys: [1], frameQty: 1, openingQty: 1,
    });
    // Variant IS selected and priced (so the prep gets derived), but the rule set
    // publishes NO prep rule — the prep must route to manual review, not $0.
    spec.hardware = [{ category: 'butt_hinges', variantId: 'v1', quantity: 3, required: true, source: 'set_template' }];
    const variantMap = new Map<string, VariantWithPrice>([['v1', {
      category: 'butt_hinges',
      variant: { id: 'v1', hardwareProductId: 'p1', sku: 'HG-1', function: null, finish: null, size: null, hand: null, voltage: null, rating: null, material: null, optionAttributes: {}, createdAt: '', updatedAt: '' },
      price: { id: 'pr1', hardwareVariantId: 'v1', hardwarePriceBookId: null, listPrice: 50, discountMultiplier: 0.5, netCost: 25, uom: 'each', effectiveFrom: null, effectiveTo: null, minimumQuantity: null, sourceRowRef: null, reviewStatus: 'APPROVED', createdAt: '', updatedAt: '' },
    }]]);
    const res = priceOpeningCore(spec, buildGoldenRuleSet(), catalog, variantMap, opts);
    const prepLine = res.lines.find((l) => l.entityType === 'prep');
    expect(prepLine?.priceStatus).toBe('INVALID');
    expect(prepLine?.lineType).not.toBe('INCLUDED');
    expect(res.manualQuotes.some((m) => m.reason === 'MISSING_PRICE')).toBe(true);
  });
});

describe('service double-extension fix', () => {
  it('keeps service lines per-opening (qty applied once at rollup)', () => {
    const catalog: HardwareCatalog = {
      ...emptyCatalog,
      serviceScopes: [{ id: 's', scopeType: 'install', name: 'Install', basis: 'per_opening', rate: 120, percent: null, referenceBasis: null, notes: null, createdAt: '', updatedAt: '' }],
    };
    const spec = buildGoldenSpec({
      id: 'svc', label: 'svc', configurationType: 'single', leafCount: 1, fireLabel: false,
      doorWidths: ['3-0'], doorQtys: [1], frameQty: 1, openingQty: 10,
    });
    const res = priceOpeningCore(spec, buildGoldenRuleSet(), catalog, emptyVariantMap, opts);
    const svc = res.lines.find((l) => l.chargeCategory === 'install');
    expect(svc?.quantity).toBe(1); // per opening, NOT × opening quantity
    expect(svc?.sellPrice).toBeCloseTo(120, 2);
  });
});
