/**
 * Rule-condition evaluation (Phase 3 engine).
 *
 * A `price_rule` carries N `rule_condition` rows grouped by `condition_group`.
 * Semantics: conditions in the SAME group are AND-ed; the rule matches when at
 * least one group fully matches (OR across groups). A rule with a single group
 * (the common case) therefore reduces to plain AND. A rule with zero conditions
 * is an unconditional match (e.g. a flat base amount).
 */

import { parseDoorDimension, parseDimension } from '@/components/pricing/dimension-utils';
import type { ConditionOperator, ConditionValueType, RuleCondition } from '@/types';
import { readField, type NormalizedOpeningSpec, type SpecComponent, type SpecValue } from './spec';

export interface ConditionMatch {
  matched: boolean;
  /** field_path/value pairs that satisfied the rule, for audit. */
  evidence: Record<string, SpecValue>;
  /** When a condition could not be evaluated because the spec value was missing. */
  missingFields: string[];
}

/**
 * Coerce a SPEC value (user/builder input) to inches. Door notation applies:
 * "3-0" → 36, "36" → 3'6" = 42 (the field wizard's compact-nominal convention).
 */
function toNumber(value: SpecValue, valueType: ConditionValueType | null): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const str = String(value).trim();
  if (str === '') return null;
  if (valueType === 'DIMENSION') {
    const parsed = parseDoorDimension(str);
    if (parsed != null) return parsed;
  }
  const n = Number(str.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Coerce a RULE BOUND (compiled from a price-book size grid) to inches. These
 * are authored in PLAIN inches ("36" = 36", "84" = 84"), so they must NOT use
 * the compact-nominal door reading (which would turn "36" into 3'6" = 42").
 */
function boundToNumber(value: string | null, valueType: ConditionValueType | null): number | null {
  if (value == null) return null;
  const str = String(value).trim();
  if (str === '') return null;
  if (valueType === 'DIMENSION') {
    const parsed = parseDimension(str);
    if (parsed != null) return parsed;
  }
  const n = Number(str.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normText(value: SpecValue): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Split a multi-value condition operand ("A | B, C") into normalized tokens. */
function splitList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[|,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function evalOne(
  cond: RuleCondition,
  spec: NormalizedOpeningSpec,
  component: SpecComponent | null,
): { ok: boolean; value: SpecValue; missing: boolean } {
  const key = cond.fieldPath ?? cond.fieldId ?? '';
  const value = key ? readField(spec, component, key) : null;
  const present = value != null && String(value).trim() !== '';
  const op: ConditionOperator = cond.operator;

  switch (op) {
    case 'EXISTS':
      return { ok: present, value, missing: false };
    case 'MISSING':
      return { ok: !present, value, missing: false };
    case 'EQ':
      return { ok: present && normText(value) === normText(cond.value1), value, missing: !present };
    case 'NE':
      // NE is satisfied by a present, differing value (missing != not-equal).
      return { ok: present && normText(value) !== normText(cond.value1), value, missing: !present };
    case 'IN':
      return { ok: present && splitList(cond.value1).includes(normText(value)), value, missing: !present };
    case 'NOT_IN':
      return { ok: present && !splitList(cond.value1).includes(normText(value)), value, missing: !present };
    case 'GT':
    case 'GTE':
    case 'LT':
    case 'LTE':
    case 'BETWEEN': {
      const num = toNumber(value, cond.valueType);
      const a = boundToNumber(cond.value1, cond.valueType);
      if (num == null) return { ok: false, value, missing: true };
      if (op === 'GT') return { ok: a != null && num > a, value, missing: false };
      if (op === 'GTE') return { ok: a != null && num >= a, value, missing: false };
      if (op === 'LT') return { ok: a != null && num < a, value, missing: false };
      if (op === 'LTE') return { ok: a != null && num <= a, value, missing: false };
      // BETWEEN
      const b = boundToNumber(cond.value2, cond.valueType);
      const lowOk = a == null || (cond.inclusiveMin === false ? num > a : num >= a);
      const highOk = b == null || (cond.inclusiveMax === false ? num < b : num <= b);
      return { ok: lowOk && highOk, value, missing: false };
    }
    default: {
      const _exhaustive: never = op;
      return { ok: false, value: null, missing: false };
    }
  }
}

/**
 * Evaluates all conditions for a rule and returns whether it matches the spec,
 * with the matched evidence and any fields that were required but missing.
 */
export function evaluateConditions(
  conditions: RuleCondition[],
  spec: NormalizedOpeningSpec,
  component: SpecComponent | null,
): ConditionMatch {
  if (conditions.length === 0) {
    return { matched: true, evidence: {}, missingFields: [] };
  }

  const groups = new Map<number, RuleCondition[]>();
  for (const cond of conditions) {
    const g = cond.conditionGroup ?? 0;
    const list = groups.get(g) ?? [];
    list.push(cond);
    groups.set(g, list);
  }

  const allMissing = new Set<string>();
  for (const [, groupConds] of groups) {
    const evidence: Record<string, SpecValue> = {};
    let groupOk = true;
    const groupMissing: string[] = [];
    for (const cond of groupConds) {
      const { ok, value, missing } = evalOne(cond, spec, component);
      if (missing) groupMissing.push(cond.fieldPath ?? cond.fieldId ?? 'unknown');
      if (!ok) {
        groupOk = false;
        continue;
      }
      const key = cond.fieldPath ?? cond.fieldId ?? 'unknown';
      evidence[key] = value;
    }
    if (groupOk) {
      return { matched: true, evidence, missingFields: [] };
    }
    for (const m of groupMissing) allMissing.add(m);
  }

  return { matched: false, evidence: {}, missingFields: [...allMissing] };
}
