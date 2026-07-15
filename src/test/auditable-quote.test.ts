import { describe, it, expect } from 'vitest';
import {
  buildAuditableQuote,
  buildAuditableQuoteFromEngine,
  buildAuditableQuoteFromEstimateLines,
  classifyLayer,
  type QuoteLine,
} from '@/lib/cpq/auditable-quote';
import { targetForLine, validateQuoteCompleteness } from '@/lib/cpq/completeness';
import { priceExampleOpening } from '@/lib/cpq/example-opening';
import type { EstimateLine } from '@/types';

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

function estimateLine(p: Partial<EstimateLine>): EstimateLine {
  return {
    id: 'line-1',
    estimateId: 'estimate-1',
    openingId: 'opening-1',
    componentId: null,
    entityType: 'door',
    lineType: 'WARNING',
    priceRuleId: null,
    chargeCategory: 'base',
    description: 'Door: no base price matched',
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
    priceStatus: 'INVALID',
    calculationExpression: 'No matching base price rule',
    matchedConditions: null,
    includedOrSuppressedBy: null,
    sourcePage: null,
    sourceRegionId: null,
    priceBookId: null,
    confidence: null,
    reviewStatus: null,
    exceptionMessage: 'No base price rule matched.',
    sortOrder: 0,
    createdAt: '',
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

  it('does not warn when a plural hardware category matches a singular prep source', () => {
    const quote = buildAuditableQuote([
      line({ entityType: 'hardware', chargeCategory: 'cylindrical_mortise_locks_and_deadbolts', priceStatus: 'PRICED', sellPrice: 300 }),
      line({ entityType: 'prep', chargeCategory: 'prep', description: 'Door prep CDL (deadbolt) — standard prep, included in base', priceStatus: 'INCLUDED', sellPrice: 0 }),
      line({ entityType: 'prep', chargeCategory: 'prep', description: 'Frame prep 234N (deadbolt) — standard prep, included in base', priceStatus: 'INCLUDED', sellPrice: 0 }),
    ]);
    const report = validateQuoteCompleteness(quote);
    expect(report.issues.some((i) => i.code === 'PREP_MISSING_FOR_DEVICE' || i.code === 'DEVICE_MISSING_FOR_PREP')).toBe(false);
  });

  it('routes each line to the builder step that fixes it', () => {
    expect(targetForLine(line({ entityType: 'door', lineType: 'BASE' }))).toBe('doors');
    expect(targetForLine(line({ entityType: 'frame', lineType: 'BASE' }))).toBe('frame');
    expect(targetForLine(line({ entityType: 'panel', lineType: 'BASE' }))).toBe('panels');
    expect(targetForLine(line({ entityType: 'prep', chargeCategory: 'prep' }))).toBe('hardware');
    expect(targetForLine(line({ entityType: 'hardware', chargeCategory: 'cylindrical_lock' }))).toBe('hardware');
    expect(targetForLine(line({ entityType: 'hardware', chargeCategory: 'gasketing', unitOfMeasure: 'ft' }))).toBe('hardware');
    expect(targetForLine(line({ entityType: 'lite_kit', chargeCategory: 'ngp_policy' }))).toBe('cutouts');
    expect(targetForLine(line({ entityType: 'hardware', chargeCategory: 'keying' }))).toBe('keying');
    expect(targetForLine(line({ entityType: 'hardware', chargeCategory: 'access_control' }))).toBe('access');
    expect(targetForLine(line({ entityType: 'hardware', chargeCategory: 'freight' }))).toBeUndefined();
  });

  it('attaches a navigation target to each surfaced exception', () => {
    const quote = buildAuditableQuote([
      line({ priceStatus: 'INVALID', exceptionMessage: 'No base price' }),
      line({ entityType: 'hardware', chargeCategory: 'exit', priceStatus: 'CONTACT_FACTORY' }),
    ]);
    const report = validateQuoteCompleteness(quote, { skipReconciliation: true });
    const missing = report.issues.find((i) => i.code === 'MISSING_PRICE');
    const cf = report.issues.find((i) => i.code === 'CONTACT_FACTORY');
    expect(missing?.target).toBe('doors');
    expect(cf?.target).toBe('hardware');
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

  it('treats persisted manual sell prices as resolved pricing', () => {
    const quote = buildAuditableQuoteFromEstimateLines([
      estimateLine({ manualSellPrice: 475, isManualOverride: true }),
    ]);
    const report = validateQuoteCompleteness(quote, { skipReconciliation: true });

    expect(quote.sellTotal).toBe(480);
    expect(quote.exceptionCount).toBe(0);
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
