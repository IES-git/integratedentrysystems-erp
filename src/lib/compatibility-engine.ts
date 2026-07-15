/**
 * Compatibility / configuration rule engine (CPQ Phase 3).
 *
 * Separate from the pricing engine: this answers "is this opening buildable?"
 * (configuration rules) rather than "what does it cost?" (price rules).
 *
 * A rule is scoped to an item_type slug or a specific canonical_code. For each
 * in-scope item, when the optional `when` clause holds, the `require` clause
 * must also hold across the opening's field values — otherwise it is a
 * violation (error blocks, warning informs).
 */

import type {
  CompatibilityCondition,
  CompatibilityOperator,
  CompatibilityRule,
  CompatibilityViolation,
  EstimateItem,
  EstimateOpeningWithItems,
  ItemField,
} from '@/types';

function toNumber(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

function eqStr(a: string, b: string | number): boolean {
  return a.trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Evaluates one condition against a field-value map. Missing field = condition fails. */
function evalCondition(map: Record<string, string>, cond: CompatibilityCondition): boolean {
  const raw = map[cond.fieldKey];
  if (raw === undefined) return false;
  const op: CompatibilityOperator = cond.operator;
  const vals = cond.values ?? [];

  switch (op) {
    case 'equals':
      return vals.some((v) => eqStr(raw, v));
    case 'not_equals':
      return !vals.some((v) => eqStr(raw, v));
    case 'in':
      return vals.some((v) => eqStr(raw, v));
    case 'not_in':
      return !vals.some((v) => eqStr(raw, v));
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      const n = toNumber(raw);
      const target = toNumber(vals[0]);
      if (n === null || target === null) return false;
      if (op === 'gt') return n > target;
      if (op === 'lt') return n < target;
      if (op === 'gte') return n >= target;
      return n <= target;
    }
    case 'between': {
      const n = toNumber(raw);
      const min = toNumber(vals[0]);
      const max = toNumber(vals[1]);
      if (n === null || min === null || max === null) return false;
      return n >= min && n <= max;
    }
    default:
      return false;
  }
}

function ruleAppliesToItem(rule: CompatibilityRule, item: EstimateItem): boolean {
  if (rule.scopeType === 'canonical_code') {
    return item.canonicalCode === rule.scopeValue;
  }
  // item_type: exact slug or hardware family prefix match
  const itemType = item.itemType ?? '';
  return itemType === rule.scopeValue || itemType.startsWith(`${rule.scopeValue}-`);
}

function fieldMap(fields: ItemField[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of fields) m[f.fieldKey] = f.fieldValue;
  return m;
}

export interface OpeningFieldData {
  /** All items in the opening (doors, frames, hardware, panels, lites). */
  items: EstimateItem[];
  /** Fields keyed by estimate_item id. */
  fieldsByItem: Map<string, ItemField[]>;
}

/**
 * Evaluates all active rules against one opening's items + fields and returns
 * the list of violations. The `require` clause is checked against the merged
 * opening-wide field map (item values take precedence), enabling cross-item
 * rules (e.g. door gauge vs frame gauge).
 */
export function evaluateOpeningCompatibility(
  rules: CompatibilityRule[],
  data: OpeningFieldData,
): CompatibilityViolation[] {
  const violations: CompatibilityViolation[] = [];
  if (rules.length === 0 || data.items.length === 0) return violations;

  // Opening-wide merged field map (last write wins).
  const openingMap: Record<string, string> = {};
  for (const item of data.items) {
    for (const f of data.fieldsByItem.get(item.id) ?? []) openingMap[f.fieldKey] = f.fieldValue;
  }

  for (const item of data.items) {
    const itemMap = fieldMap(data.fieldsByItem.get(item.id) ?? []);
    const combined = { ...openingMap, ...itemMap };

    for (const rule of rules) {
      if (!rule.active) continue;
      if (!ruleAppliesToItem(rule, item)) continue;

      const whenHolds = rule.predicate.when ? evalCondition(itemMap, rule.predicate.when) : true;
      if (!whenHolds) continue;

      const requireHolds = evalCondition(combined, rule.predicate.require);
      if (!requireHolds) {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: rule.message,
          itemId: item.id,
          itemLabel: item.itemLabel,
        });
      }
    }
  }

  return violations;
}

/** Convenience: evaluate a fully-loaded opening (with items + hardware). */
export function evaluateLoadedOpening(
  rules: CompatibilityRule[],
  opening: EstimateOpeningWithItems,
  fieldsByItem: Map<string, ItemField[]>,
): CompatibilityViolation[] {
  const items: EstimateItem[] = [
    ...opening.items,
    ...opening.items.flatMap((i) => i.hardware ?? []),
    ...(opening.hardware ?? []),
  ];
  return evaluateOpeningCompatibility(rules, { items, fieldsByItem });
}
