import { describe, it, expect } from 'vitest';
import {
  evaluateRuleQa,
  evaluateHardwareQa,
  evaluateVocabularyQa,
  evaluateIngestionProfileQa,
  evaluateQa,
  qaAllowsOverride,
  type QaRule,
  type QaHardwarePrice,
  type QaCondition,
  type VocabField,
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

describe('vocabulary QA checks', () => {
  const vocab = new Map<string, VocabField>([
    ['frame.frame_series', {
      canon: new Set(['f', 'dw', 'stk', 'spf']),
      aliases: new Map<string, 'alias' | 'reject'>([['stk 14', 'alias'], ['cnn', 'reject']]),
    }],
  ]);
  function cond(p: Partial<QaCondition>): QaCondition {
    return { priceRuleId: 'r1', fieldPath: 'frame.frame_series', operator: 'EQ', value1: 'F', sourceRegionId: null, ...p };
  }

  it('passes a canonical token', () => {
    expect(evaluateVocabularyQa([cond({ value1: 'F' })], vocab)).toHaveLength(0);
  });

  it('warns (recoverable) on a known alias token', () => {
    const findings = evaluateVocabularyQa([cond({ value1: 'STK 14' })], vocab);
    expect(findings.some((f) => f.checkName === 'vocab_alias_pending' && f.severity === 'WARNING')).toBe(true);
  });

  it('errors (blocking) on an out-of-vocabulary token', () => {
    const findings = evaluateVocabularyQa([cond({ value1: 'XYZ' })], vocab);
    expect(findings.some((f) => f.checkName === 'vocab_out_of_vocabulary' && f.severity === 'ERROR')).toBe(true);
  });

  it('treats every token of an IN list independently', () => {
    const findings = evaluateVocabularyQa([cond({ operator: 'IN', value1: 'F|DW' })], vocab);
    expect(findings).toHaveLength(0);
  });

  it('skips fields not in the governed vocabulary', () => {
    expect(evaluateVocabularyQa([cond({ fieldPath: 'door.unknown_field', value1: 'whatever' })], vocab)).toHaveLength(0);
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

  it('allows explicit override for ERROR findings but never for BLOCK findings', () => {
    expect(qaAllowsOverride({
      findings: [{ checkName: 'value', severity: 'ERROR', detail: 'review me' }],
      blockingCount: 1,
      warningCount: 0,
      passed: false,
    })).toBe(true);
    expect(qaAllowsOverride({
      findings: [{ checkName: 'source', severity: 'BLOCK', detail: 'wrong source lane' }],
      blockingCount: 1,
      warningCount: 0,
      passed: false,
    })).toBe(false);
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

describe('ingestion profile publication gate', () => {
  it('passes a complete fingerprinted Pioneer document', () => {
    const findings = evaluateIngestionProfileQa({
      profileKey: 'pioneer-steel-doors-frames',
      profileVersion: '2026-06-21.4',
      fileType: 'pdf',
      sourceSha256: 'ef32d45501233ff59e06311abc0dce91f310a439dd0015b61b2b13b482abcf27',
      sourcePageCount: 103,
      coverage: { passed: true },
      baseRuleEntities: new Set(['door', 'frame', 'panel']),
    });
    expect(findings.filter((f) => f.severity === 'ERROR' || f.severity === 'BLOCK')).toHaveLength(0);
  });

  it('blocks publication when required manufacturer entities are missing', () => {
    const findings = evaluateIngestionProfileQa({
      profileKey: 'ceco-steel-doors-frames',
      profileVersion: '2026-06-21.4',
      fileType: 'pdf',
      sourceSha256: 'e491ce09add14b4ccd193a146817a6929c07120821153a9ae7aaacd22d888101',
      sourcePageCount: 167,
      coverage: { passed: true },
      baseRuleEntities: new Set(['door']),
    });
    expect(findings.some((f) =>
      f.checkName === 'required_entity_coverage' &&
      f.severity === 'BLOCK' &&
      f.detail.includes('frame'))).toBe(true);
  });

  it('blocks the raw NGP PDF from the normalized-workbook publication lane', () => {
    const findings = evaluateIngestionProfileQa({
      profileKey: 'ngp-infill-2026',
      profileVersion: '2026-06-21.4',
      fileType: 'pdf',
      sourceSha256: '9ddb400c994d7416c04a488ae2be3bd29214f4ace40f9233bfe464e78ec2d2f7',
      sourcePageCount: 88,
      coverage: { passed: true },
      baseRuleEntities: new Set(['lite_kit', 'louver', 'glass', 'glazing_tape']),
    });
    expect(findings.some((f) => f.checkName === 'source_ingestion_lane' && f.severity === 'BLOCK')).toBe(true);
  });
});
