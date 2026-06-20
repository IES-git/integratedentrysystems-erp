import { describe, it, expect } from 'vitest';
import {
  evaluateRuleQa,
  evaluateHardwareQa,
  evaluateQa,
  type QaRule,
  type QaHardwarePrice,
} from '@/lib/cpq/qa-checks';

function qaRule(p: Partial<QaRule>): QaRule {
  return {
    id: 'r1',
    entityType: 'door',
    chargeCategory: 'base',
    itemOrOptionCode: null,
    priceStatus: 'PRICED',
    actionType: 'BASE_AMOUNT',
    amount: 100,
    percentage: null,
    referenceRuleId: null,
    unitOfMeasure: null,
    quantityBasisField: null,
    sourceRegionId: 'sr1',
    rawValueText: '$100',
    exclusiveGroup: null,
    conditionsKey: '',
    ...p,
  };
}

describe('rule QA checks', () => {
  it('flags a numeric action with no amount as an ERROR', () => {
    const findings = evaluateRuleQa([qaRule({ amount: null })]);
    expect(findings.some((f) => f.checkName === 'value_semantics' && f.severity === 'ERROR')).toBe(true);
  });

  it('flags a PERCENT_OF rule with no percentage or reference', () => {
    const findings = evaluateRuleQa([qaRule({ actionType: 'PERCENT_OF', amount: null, percentage: null })]);
    const codes = findings.filter((f) => f.severity === 'ERROR');
    expect(codes.length).toBeGreaterThanOrEqual(2); // missing percentage + missing reference
  });

  it('does not require an amount for CONTACT_FACTORY / INCLUDED', () => {
    const findings = evaluateRuleQa([
      qaRule({ id: 'cf', actionType: 'CONTACT_FACTORY', amount: null, priceStatus: 'CONTACT_FACTORY' }),
      qaRule({ id: 'inc', actionType: 'INCLUDED', amount: null, priceStatus: 'INCLUDED' }),
    ]);
    expect(findings.some((f) => f.severity === 'ERROR')).toBe(false);
  });

  it('warns on missing unit/basis for quantity-based actions', () => {
    const findings = evaluateRuleQa([qaRule({ actionType: 'RATE_X_QUANTITY' })]);
    expect(findings.filter((f) => f.checkName === 'unit_basis')).toHaveLength(2);
  });

  it('warns on overlapping unconditioned BASE rules without an exclusive group', () => {
    const findings = evaluateRuleQa([
      qaRule({ id: 'a', conditionsKey: '' }),
      qaRule({ id: 'b', conditionsKey: '' }),
    ]);
    expect(findings.some((f) => f.checkName === 'rule_overlap')).toBe(true);
  });

  it('does not warn on overlap when both rules are in an exclusive group', () => {
    const findings = evaluateRuleQa([
      qaRule({ id: 'a', exclusiveGroup: 'g' }),
      qaRule({ id: 'b', exclusiveGroup: 'g' }),
    ]);
    expect(findings.some((f) => f.checkName === 'rule_overlap')).toBe(false);
  });
});

describe('hardware QA checks', () => {
  it('errors when neither net nor list × discount is available', () => {
    const findings = evaluateHardwareQa([{ id: 'p1', listPrice: null, discountMultiplier: null, netCost: null }]);
    expect(findings[0].severity).toBe('ERROR');
  });

  it('warns when list × discount drifts from net beyond 1%', () => {
    const prices: QaHardwarePrice[] = [{ id: 'p1', listPrice: 100, discountMultiplier: 0.5, netCost: 60 }];
    const findings = evaluateHardwareQa(prices);
    expect(findings.some((f) => f.checkName === 'net_reconciliation' && f.severity === 'WARNING')).toBe(true);
  });

  it('passes when net reconciles within 1%', () => {
    expect(evaluateHardwareQa([{ id: 'p1', listPrice: 100, discountMultiplier: 0.5, netCost: 50 }])).toHaveLength(0);
  });
});

describe('combined QA gate', () => {
  it('blocks when any ERROR finding exists', () => {
    const result = evaluateQa({
      rules: [qaRule({ amount: null })],
      hardwarePrices: [],
      dependencyCount: 1,
    });
    expect(result.passed).toBe(false);
    expect(result.blockingCount).toBeGreaterThan(0);
  });

  it('passes (no blockers) when everything is clean', () => {
    const result = evaluateQa({
      rules: [qaRule({})],
      hardwarePrices: [{ id: 'p1', listPrice: 100, discountMultiplier: 0.5, netCost: 50 }],
      dependencyCount: 2,
    });
    expect(result.passed).toBe(true);
  });
});
