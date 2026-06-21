import { describe, it, expect } from 'vitest';
import {
  buildAuditableQuote,
  buildAuditableQuoteFromEngine,
  classifyLayer,
  type QuoteLine,
} from '@/lib/cpq/auditable-quote';
import { validateQuoteCompleteness } from '@/lib/cpq/completeness';
import { priceExampleOpening } from '@/lib/cpq/example-opening';

function line(p: Partial<QuoteLine>): QuoteLine {
  return {
    componentId: null,
    entityType: 'door',
    lineType: 'BASE',
    chargeCategory: 'base',
    description: 'Line',
    selectedOptionCode: null,
    quantity: 1,
    unitOfMeasure: 'each',
    unitListPrice: null,
    extendedListPrice: null,
    discountMultiplier: null,
    extendedNetPrice: null,
    sellPrice: null,
    grossMargin: null,
    grossMarginPct: null,
    priceStatus: 'PRICED',
    calculationExpression: '',
    matchedConditions: null,
    sourcePage: null,
    priceBookId: null,
    confidence: null,
    exceptionMessage: null,
    ...p,
  };
}

describe('auditable quote layer classification', () => {
  it('routes each line into its expected layer', () => {
    expect(classifyLayer(line({ entityType: 'door', lineType: 'BASE' }))).toBe('pioneer_base');
    expect(classifyLayer(line({ entityType: 'frame', lineType: 'ADDER', chargeCategory: 'oversize' }))).toBe('pioneer_adders');
    expect(classifyLayer(line({ entityType: 'prep', chargeCategory: 'prep' }))).toBe('pioneer_preps');
    expect(classifyLayer(line({ entityType: 'hardware', chargeCategory: 'butt_hinges', unitOfMeasure: 'each' }))).toBe('hardware');
    expect(classifyLayer(line({ entityType: 'hardware', chargeCategory: 'gasketing', unitOfMeasure: 'ft' }))).toBe('linear');
    expect(classifyLayer(line({ entityType: 'hardware', chargeCategory: 'keying' }))).toBe('keying');
    expect(classifyLayer(line({ entityType: 'hardware', chargeCategory: 'access_control' }))).toBe('access_control');
    expect(classifyLayer(line({ entityType: 'hardware', chargeCategory: 'freight' }))).toBe('services');
  });

  it('rolls hardware up by group and as all-hardware', () => {
    const quote = buildAuditableQuote([
      line({ entityType: 'hardware', chargeCategory: 'butt_hinges', extendedNetPrice: 60, sellPrice: 120 }),
      line({ entityType: 'hardware', chargeCategory: 'cylindrical_lock', extendedNetPrice: 150, sellPrice: 300 }),
    ]);
    const all = quote.hardwareRollups.find((r) => r.group === 'all');
    expect(all?.netTotal).toBe(210);
    expect(all?.sellTotal).toBe(420);
    expect(quote.hardwareRollups.filter((r) => r.group !== 'all')).toHaveLength(2);
  });

  it('warns when one component matches more than one base price', () => {
    const quote = buildAuditableQuote([
      line({ componentId: 'door-1', entityType: 'door', lineType: 'BASE', sellPrice: 828 }),
      line({ componentId: 'door-1', entityType: 'door', lineType: 'BASE', sellPrice: 69 }),
    ]);
    const base = quote.layers.find((l) => l.id === 'pioneer_base');
    expect(base?.warning).toMatch(/double-count/i);
  });

  it('does not warn when separate components each have one base', () => {
    const quote = buildAuditableQuote([
      line({ componentId: 'door-1', entityType: 'door', lineType: 'BASE', sellPrice: 828 }),
      line({ componentId: 'frame-1', entityType: 'frame', lineType: 'BASE', sellPrice: 41 }),
    ]);
    const base = quote.layers.find((l) => l.id === 'pioneer_base');
    expect(base?.warning).toBeNull();
  });
});

describe('completeness validation', () => {
  it('blocks on missing prices, CF, and external scope', () => {
    const quote = buildAuditableQuote([
      line({ priceStatus: 'INVALID', exceptionMessage: 'No base price' }),
      line({ entityType: 'hardware', chargeCategory: 'exit', priceStatus: 'CONTACT_FACTORY' }),
      line({ entityType: 'hardware', chargeCategory: 'keying', priceStatus: 'EXTERNAL_PENDING' }),
    ]);
    const report = validateQuoteCompleteness(quote, { skipReconciliation: true });
    expect(report.canFinalize).toBe(false);
    expect(report.blockingCount).toBe(3);
    expect(report.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['MISSING_PRICE', 'CONTACT_FACTORY', 'EXTERNAL_PENDING']),
    );
  });

  it('warns when a device has no matching prep (reconciliation)', () => {
    const quote = buildAuditableQuote([
      line({ entityType: 'hardware', chargeCategory: 'cylindrical_lock', priceStatus: 'PRICED', sellPrice: 300 }),
    ]);
    const report = validateQuoteCompleteness(quote);
    expect(report.issues.some((i) => i.code === 'PREP_MISSING_FOR_DEVICE')).toBe(true);
  });

  it('passes when every line is priced and preps match devices', () => {
    const quote = buildAuditableQuote([
      line({ entityType: 'door', lineType: 'BASE', priceStatus: 'PRICED', sellPrice: 850 }),
      line({ entityType: 'hardware', chargeCategory: 'cylindrical_lock', priceStatus: 'PRICED', sellPrice: 300 }),
      line({ entityType: 'prep', chargeCategory: 'prep', description: 'Door prep CYL (cylindrical_lock)', priceStatus: 'PRICED', sellPrice: 22 }),
    ]);
    const report = validateQuoteCompleteness(quote);
    expect(report.canFinalize).toBe(true);
  });
});

describe('Example Opening round-trip', () => {
  const result = priceExampleOpening();
  const quote = buildAuditableQuoteFromEngine(result.lines);

  it('reconstructs every quote layer', () => {
    const ids = quote.layers.map((l) => l.id);
    expect(ids).toEqual(
      expect.arrayContaining(['pioneer_base', 'pioneer_adders', 'pioneer_preps', 'hardware', 'linear', 'services']),
    );
  });

  it('prices the Pioneer base separately from the actual hardware', () => {
    const base = quote.layers.find((l) => l.id === 'pioneer_base');
    expect(base?.sellTotal).toBe(1170); // door 850 + frame 320
    const hw = quote.layers.find((l) => l.id === 'hardware');
    // hinges 120 + lock 300 + closer 300 + dps 80
    expect(hw?.sellTotal).toBe(800);
  });

  it('generates Pioneer preps from the crosswalk, distinct from devices', () => {
    const preps = quote.layers.find((l) => l.id === 'pioneer_preps');
    // hinge door 9×3 + hinge frame 11×3 + cyl 22 + strike 14 + closer 18 + dps 16
    expect(preps?.sellTotal).toBe(130);
  });

  it('has no unresolved exceptions and can be finalized', () => {
    expect(quote.exceptionCount).toBe(0);
    const report = validateQuoteCompleteness(quote, {
      dependencyResults: result.dependencyResults,
      warnings: result.warnings,
    });
    expect(report.blockingCount).toBe(0);
    expect(report.canFinalize).toBe(true);
  });

  it('produces an all-hardware rollup with positive gross margin', () => {
    const all = quote.hardwareRollups.find((r) => r.group === 'all');
    expect(all).toBeTruthy();
    expect(all!.grossMargin).toBeGreaterThan(0);
  });
});
