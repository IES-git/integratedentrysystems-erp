import { describe, it, expect } from 'vitest';
import { priceOpeningCore } from '@/lib/pricing';
import type { NormalizedOpeningSpec } from '@/lib/pricing';
import type { DependencyRule } from '@/types';
import { buildGoldenRuleSet, buildGoldenSpec, emptyCatalog, emptyVariantMap } from './golden/golden-openings';

const opts = { priceBookDocumentId: 'golden-doc', minConfidence: 0.5 };

function dep(partial: Partial<DependencyRule> & Pick<DependencyRule, 'id' | 'triggerConditions' | 'severity'>): DependencyRule {
  return {
    ruleKey: partial.id, priceBookId: 'golden-doc', relationshipType: 'REQUIRES', targetType: 'spec_field',
    targetIdOrValue: null, autoApplyAllowed: false, messageTemplate: 'dep', priceEffect: null,
    sourceRegionId: null, priority: 100, reviewStatus: 'APPROVED', createdAt: '', updatedAt: '',
    ...partial,
  };
}

function specWith(fields: Record<string, string>): NormalizedOpeningSpec {
  const s = buildGoldenSpec({ id: 'd', label: 'd', configurationType: 'single', leafCount: 1, fireLabel: true, doorWidths: ['3-0'], doorQtys: [1], frameQty: 1, openingQty: 1 });
  s.fields = { ...s.fields, ...fields };
  return s;
}

function run(spec: NormalizedOpeningSpec, deps: DependencyRule[]) {
  const ruleSet = { ...buildGoldenRuleSet(), dependencyRules: deps };
  return priceOpeningCore(spec, ruleSet, emptyCatalog, emptyVariantMap, opts);
}

describe('executable narrative dependencies', () => {
  it('matches a structured predicate with an operator and blocks on ERROR severity', () => {
    const d = dep({
      id: 'd1', severity: 'ERROR',
      triggerConditions: { note: 'Fire openings must be labeled', predicates: [{ field: 'opening.fire_label_required', operator: 'EQ', value: 'true' }], mode: 'all' },
    });
    const res = run(specWith({}), [d]);
    const outcome = res.dependencyResults.find((o) => o.rule.id === 'd1');
    expect(outcome).toBeTruthy();
    expect(outcome?.blocking).toBe(true);
  });

  it('does not fire when a predicate is unmet', () => {
    const d = dep({
      id: 'd2', severity: 'WARNING',
      triggerConditions: { predicates: [{ field: 'door.door_gauge', operator: 'EQ', value: '14' }] },
    });
    const res = run(specWith({ 'door.door_gauge': '18' }), [d]);
    expect(res.dependencyResults.some((o) => o.rule.id === 'd2')).toBe(false);
  });

  it('supports a numeric comparison predicate (GTE)', () => {
    const d = dep({
      id: 'd3', severity: 'WARNING',
      triggerConditions: { predicates: [{ field: 'opening.stc_target', operator: 'GTE', value: 45 }] },
    });
    expect(run(specWith({ 'opening.stc_target': '50' }), [d]).dependencyResults.some((o) => o.rule.id === 'd3')).toBe(true);
    expect(run(specWith({ 'opening.stc_target': '35' }), [d]).dependencyResults.some((o) => o.rule.id === 'd3')).toBe(false);
  });

  it('still supports the legacy simple-equality trigger form (ignoring metadata keys)', () => {
    const d = dep({
      id: 'd4', severity: 'WARNING',
      triggerConditions: { source: 'notes table', 'opening.fire_label_required': 'true' },
    });
    expect(run(specWith({}), [d]).dependencyResults.some((o) => o.rule.id === 'd4')).toBe(true);
  });
});
