/**
 * Pure utilities for assembling hardware canonical codes and item labels from
 * a selected family and a set of configured field values.
 *
 * No Supabase calls — safe to run synchronously inside UI render / useMemo.
 */

import { evaluateDependency } from './field-dependencies';
import type { HardwareCatalogItem, DependencyOperator } from '@/types';

// ---------------------------------------------------------------------------
// Minimal field shape — avoids a circular import from AddItemModal.tsx
// ---------------------------------------------------------------------------

export interface BuildableField {
  fieldKey: string;
  fieldValue: string;
  fieldDefinitionId?: string;
  /** Present when this field is only shown if its parent meets a condition. */
  conditionalParentDefId?: string;
  conditionOperator?: DependencyOperator;
  conditionTriggerValues?: (string | number)[];
}

/** Option shape — only the properties needed by the code builder. */
export interface BuildableOption {
  value: string;
  codeToken?: string | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the field's conditional parent dependency is satisfied
 * (or the field has no conditional parent at all).
 */
function isDependencyMet(field: BuildableField, allFields: BuildableField[]): boolean {
  if (
    !field.conditionalParentDefId ||
    !field.conditionOperator ||
    !field.conditionTriggerValues
  ) {
    return true;
  }
  const parent = allFields.find((f) => f.fieldDefinitionId === field.conditionalParentDefId);
  if (!parent) return false;
  return evaluateDependency(
    parent.fieldValue || null,
    field.conditionOperator,
    field.conditionTriggerValues
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assembles the canonical code for a hardware family item from the current
 * field values and their option tokens.
 *
 * Algorithm (per the progressive-disclosure plan):
 * 1. Start with the family's `codePrefix` as the first token.
 * 2. Walk `codeFieldKeys` in order. For each key:
 *    - Skip if the field has no value.
 *    - Skip if the field's conditional dependency is not met.
 *    - Append the option's `codeToken` if it has one; skip options with no token.
 * 3. Join all collected tokens with '-'.
 *
 * @param family           The hardware family row (must have isFamily=true).
 * @param fields           Current configured field values for this item.
 * @param optionsByFieldId Map from fieldDefinitionId → array of options (with codeToken).
 */
export function buildHardwareCode(
  family: HardwareCatalogItem,
  fields: BuildableField[],
  optionsByFieldId: Map<string, ReadonlyArray<BuildableOption>>
): string {
  if (!family.codePrefix) return family.canonicalCode;

  const tokens: string[] = [family.codePrefix];

  for (const key of family.codeFieldKeys ?? []) {
    const field = fields.find((f) => f.fieldKey === key);
    if (!field || !field.fieldValue) continue;
    if (!isDependencyMet(field, fields)) continue;

    if (!field.fieldDefinitionId) continue;
    const options = optionsByFieldId.get(field.fieldDefinitionId);
    const opt = options?.find((o) => o.value === field.fieldValue);
    if (opt?.codeToken) tokens.push(opt.codeToken);
  }

  return tokens.filter(Boolean).join('-');
}

/**
 * Builds the human-readable item label for a hardware family item.
 *
 * If `family.labelTemplate` is set, substitutes `{fieldKey}` placeholders
 * with current field values and collapses redundant whitespace.
 * Falls back to `family.name` if the template produces an empty string.
 *
 * @param family  The hardware family row.
 * @param fields  Current configured field values for this item.
 */
export function buildHardwareLabel(
  family: HardwareCatalogItem,
  fields: BuildableField[]
): string {
  if (!family.labelTemplate) return family.name;

  const result = family.labelTemplate.replace(/\{(\w+)\}/g, (_, key: string) => {
    const field = fields.find((f) => f.fieldKey === key);
    return field?.fieldValue ?? '';
  });

  return result.replace(/\s+/g, ' ').trim() || family.name;
}
