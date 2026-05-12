/**
 * Pure helpers for evaluating and merging conditional field dependencies.
 * No Supabase calls — safe to use in both admin config and runtime wizards.
 */

import type {
  DependencyOperator,
  ItemTypeFieldDependency,
  ItemTypeFieldDependencyOverride,
  ResolvedFieldDependency,
} from '@/types';

/**
 * Evaluates whether a parent field's current value satisfies a dependency
 * condition.  Returns `false` for missing/incompatible values rather than
 * throwing.
 */
export function evaluateDependency(
  parentValue: string | null,
  op: DependencyOperator,
  triggerValues: (string | number)[]
): boolean {
  if (parentValue === null || parentValue === undefined) return false;

  switch (op) {
    case 'equals':
      return triggerValues.length > 0 && String(triggerValues[0]) === parentValue;

    case 'not_equals':
      return triggerValues.length > 0 && String(triggerValues[0]) !== parentValue;

    case 'in':
      return triggerValues.map(String).includes(parentValue);

    case 'not_in':
      return !triggerValues.map(String).includes(parentValue);

    case 'gt': {
      const n = parseFloat(parentValue);
      return !isNaN(n) && triggerValues.length > 0 && n > Number(triggerValues[0]);
    }

    case 'lt': {
      const n = parseFloat(parentValue);
      return !isNaN(n) && triggerValues.length > 0 && n < Number(triggerValues[0]);
    }

    case 'gte': {
      const n = parseFloat(parentValue);
      return !isNaN(n) && triggerValues.length > 0 && n >= Number(triggerValues[0]);
    }

    case 'lte': {
      const n = parseFloat(parentValue);
      return !isNaN(n) && triggerValues.length > 0 && n <= Number(triggerValues[0]);
    }

    case 'between': {
      const n = parseFloat(parentValue);
      return (
        !isNaN(n) &&
        triggerValues.length >= 2 &&
        n >= Number(triggerValues[0]) &&
        n <= Number(triggerValues[1])
      );
    }

    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return false;
    }
  }
}

/**
 * Merges item-type-level dependency rules with per-canonical-code overrides
 * to produce the final resolved set:
 * - NULL override columns → inherit from type rule
 * - `is_hidden = true` → remove the rule
 * - `is_added_locally = true` → append (not present in type rules)
 */
export function mergeDependencies(
  typeRules: ItemTypeFieldDependency[],
  overrides: ItemTypeFieldDependencyOverride[]
): ResolvedFieldDependency[] {
  const overrideMap = new Map<string, ItemTypeFieldDependencyOverride>();
  for (const ov of overrides) {
    overrideMap.set(`${ov.parentFieldDefinitionId}::${ov.childFieldDefinitionId}`, ov);
  }

  const results: ResolvedFieldDependency[] = [];

  for (const rule of typeRules) {
    const ov = overrideMap.get(
      `${rule.parentFieldDefinitionId}::${rule.childFieldDefinitionId}`
    );
    if (ov?.isHidden) continue;
    if (!rule.childField) continue;

    results.push({
      parentFieldDefinitionId: rule.parentFieldDefinitionId,
      childField: rule.childField,
      operator: ov?.operator ?? rule.operator,
      triggerValues: ov?.triggerValues ?? rule.triggerValues,
      sortOrder: ov?.sortOrder ?? rule.sortOrder,
    });
  }

  // Locally-added overrides (no corresponding type rule)
  for (const ov of overrides) {
    if (!ov.isAddedLocally) continue;
    if (!ov.childField) continue;
    if (!ov.operator || !ov.triggerValues) continue;

    results.push({
      parentFieldDefinitionId: ov.parentFieldDefinitionId,
      childField: ov.childField,
      operator: ov.operator,
      triggerValues: ov.triggerValues,
      sortOrder: ov.sortOrder ?? 999,
    });
  }

  return results.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Groups resolved dependencies by their parent field definition ID. */
export function groupByParent(
  resolved: ResolvedFieldDependency[]
): Map<string, ResolvedFieldDependency[]> {
  const map = new Map<string, ResolvedFieldDependency[]>();
  for (const dep of resolved) {
    const list = map.get(dep.parentFieldDefinitionId) ?? [];
    list.push(dep);
    map.set(dep.parentFieldDefinitionId, list);
  }
  return map;
}

/** Returns a short human-readable summary of a condition for badge display. */
export function formatConditionBadge(
  op: DependencyOperator,
  triggerValues: (string | number)[]
): string {
  switch (op) {
    case 'equals':
      return `= "${triggerValues[0] ?? ''}"`;
    case 'not_equals':
      return `≠ "${triggerValues[0] ?? ''}"`;
    case 'in':
      return `one of ${triggerValues.map((v) => `"${v}"`).join(', ')}`;
    case 'not_in':
      return `not in ${triggerValues.map((v) => `"${v}"`).join(', ')}`;
    case 'gt':
      return `> ${triggerValues[0] ?? ''}`;
    case 'lt':
      return `< ${triggerValues[0] ?? ''}`;
    case 'gte':
      return `≥ ${triggerValues[0] ?? ''}`;
    case 'lte':
      return `≤ ${triggerValues[0] ?? ''}`;
    case 'between':
      return `${triggerValues[0] ?? ''} – ${triggerValues[1] ?? ''}`;
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return '';
    }
  }
}
