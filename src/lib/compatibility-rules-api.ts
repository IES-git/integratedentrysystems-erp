/**
 * CRUD for compatibility/configuration rules (CPQ Phase 3).
 * Backed by `compatibility_rules` (+ optional `compatibility_rule_overrides`).
 */

import { supabase } from './supabase';
import { evaluateLoadedOpening } from './compatibility-engine';
import type {
  CompatibilityPredicate,
  CompatibilityRule,
  CompatibilityScopeType,
  CompatibilitySeverity,
  CompatibilityViolation,
  EstimateOpeningWithItems,
  ItemField,
} from '@/types';

function mapRule(row: Record<string, unknown>): CompatibilityRule {
  return {
    id: row.id as string,
    name: row.name as string,
    scopeType: row.scope_type as CompatibilityScopeType,
    scopeValue: row.scope_value as string,
    predicate: (row.predicate ?? {}) as CompatibilityPredicate,
    severity: row.severity as CompatibilitySeverity,
    message: row.message as string,
    active: row.active as boolean,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function listCompatibilityRules(activeOnly = false): Promise<CompatibilityRule[]> {
  let query = supabase.from('compatibility_rules').select('*').order('created_at', { ascending: false });
  if (activeOnly) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRule(r as Record<string, unknown>));
}

export interface CompatibilityRuleInput {
  name: string;
  scopeType: CompatibilityScopeType;
  scopeValue: string;
  predicate: CompatibilityPredicate;
  severity: CompatibilitySeverity;
  message: string;
  active?: boolean;
}

export async function createCompatibilityRule(input: CompatibilityRuleInput): Promise<CompatibilityRule> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('compatibility_rules')
    .insert({
      name: input.name,
      scope_type: input.scopeType,
      scope_value: input.scopeValue,
      predicate: input.predicate,
      severity: input.severity,
      message: input.message,
      active: input.active ?? true,
      created_by: userData?.user?.id ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapRule(data as Record<string, unknown>);
}

export async function updateCompatibilityRule(
  id: string,
  updates: Partial<CompatibilityRuleInput>,
): Promise<CompatibilityRule> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.scopeType !== undefined) dbUpdates.scope_type = updates.scopeType;
  if (updates.scopeValue !== undefined) dbUpdates.scope_value = updates.scopeValue;
  if (updates.predicate !== undefined) dbUpdates.predicate = updates.predicate;
  if (updates.severity !== undefined) dbUpdates.severity = updates.severity;
  if (updates.message !== undefined) dbUpdates.message = updates.message;
  if (updates.active !== undefined) dbUpdates.active = updates.active;

  const { data, error } = await supabase
    .from('compatibility_rules')
    .update(dbUpdates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapRule(data as Record<string, unknown>);
}

export async function deleteCompatibilityRule(id: string): Promise<void> {
  const { error } = await supabase.from('compatibility_rules').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Loads active rules + item fields for the given openings and returns
 * violations grouped by opening id. Used by the wizard Review step and the
 * CPQ service before quote generation.
 */
export async function evaluateOpeningsCompatibility(
  openings: EstimateOpeningWithItems[],
): Promise<Map<string, CompatibilityViolation[]>> {
  const result = new Map<string, CompatibilityViolation[]>();
  if (openings.length === 0) return result;

  const rules = await listCompatibilityRules(true);
  if (rules.length === 0) {
    for (const o of openings) result.set(o.id, []);
    return result;
  }

  // Collect every item id across openings (top-level + nested + opening hardware).
  const itemIds = new Set<string>();
  for (const o of openings) {
    for (const i of o.items) {
      itemIds.add(i.id);
      for (const h of i.hardware ?? []) itemIds.add(h.id);
    }
    for (const h of o.hardware ?? []) itemIds.add(h.id);
  }

  const fieldsByItem = new Map<string, ItemField[]>();
  if (itemIds.size > 0) {
    const { data, error } = await supabase
      .from('item_fields')
      .select('*')
      .in('estimate_item_id', [...itemIds]);
    if (error) throw new Error(error.message);
    for (const f of data ?? []) {
      const list = fieldsByItem.get(f.estimate_item_id as string) ?? [];
      list.push({
        id: f.id as string,
        estimateItemId: f.estimate_item_id as string,
        fieldDefinitionId: (f.field_definition_id as string | null) ?? null,
        fieldKey: f.field_key as string,
        fieldLabel: f.field_label as string,
        fieldValue: f.field_value as string,
        valueType: f.value_type as ItemField['valueType'],
        sourceConfidence: (f.source_confidence as number | null) ?? null,
        createdAt: f.created_at as string,
        updatedAt: f.updated_at as string,
      });
      fieldsByItem.set(f.estimate_item_id as string, list);
    }
  }

  for (const o of openings) {
    result.set(o.id, evaluateLoadedOpening(rules, o, fieldsByItem));
  }
  return result;
}
