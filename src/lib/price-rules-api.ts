/**
 * CPQ v2 rule review/approval API (Phase 2.1).
 *
 * The worker's rule compiler emits `price_rule` + `rule_condition` (and
 * `dependency_rule`) rows UNREVIEWED, gated behind a `pricing_change_proposals`
 * row per table. This module reads those compiled rules for the review UI and
 * approves/rejects them — the human approval boundary that replaces the legacy
 * grid-mapping approval.
 *
 * Nothing here writes prices into the legacy `pricing_*` grid tables; approval
 * flips `review_status` on the canonical rows and publishes the document.
 */

import { supabase } from './supabase';
import { updateProposalStatus } from './pricing-proposals-api';
import type {
  PriceRule,
  RuleCondition,
  DependencyRule,
  ReviewStatus,
  ConditionOperator,
  ConditionValueType,
  PriceStatus,
  PriceActionType,
  StackingBehavior,
  RuleEntityType,
} from '@/types';

/** A compiled price rule with its conditions, for the review UI. */
export interface CompiledPriceRule extends PriceRule {
  conditions: RuleCondition[];
}

function mapCondition(row: Record<string, unknown>): RuleCondition {
  return {
    id: row.id as string,
    priceRuleId: row.price_rule_id as string,
    conditionGroup: (row.condition_group as number) ?? 0,
    fieldId: (row.field_id as string | null) ?? null,
    fieldPath: (row.field_path as string | null) ?? null,
    operator: row.operator as ConditionOperator,
    valueType: (row.value_type as ConditionValueType | null) ?? null,
    value1: (row.value_1 as string | null) ?? null,
    value2: (row.value_2 as string | null) ?? null,
    unit: (row.unit as string | null) ?? null,
    inclusiveMin: (row.inclusive_min as boolean | null) ?? null,
    inclusiveMax: (row.inclusive_max as boolean | null) ?? null,
    normalizedValue: (row.normalized_value as string | null) ?? null,
    sourcePhrase: (row.source_phrase as string | null) ?? null,
    derivedFlag: (row.derived_flag as boolean) ?? false,
    nullBehavior: (row.null_behavior as RuleCondition['nullBehavior']) ?? 'FAIL',
    createdAt: row.created_at as string,
  };
}

function mapRule(row: Record<string, unknown>): CompiledPriceRule {
  const conditionRows = (row.rule_condition as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: row.id as string,
    ruleKey: (row.rule_key as string | null) ?? null,
    priceBookId: row.price_book_id as string,
    priceTableId: (row.price_table_id as string | null) ?? null,
    entityType: row.entity_type as RuleEntityType,
    chargeCategory: (row.charge_category as string | null) ?? null,
    itemOrOptionCode: (row.item_or_option_code as string | null) ?? null,
    priceStatus: row.price_status as PriceStatus,
    actionType: row.action_type as PriceActionType,
    amount: (row.amount as number | null) ?? null,
    currencyCode: (row.currency_code as string) ?? 'USD',
    unitOfMeasure: (row.unit_of_measure as string | null) ?? null,
    quantityBasisField: (row.quantity_basis_field as string | null) ?? null,
    baseQuantityIncluded: (row.base_quantity_included as number | null) ?? null,
    minimumCharge: (row.minimum_charge as number | null) ?? null,
    maximumCharge: (row.maximum_charge as number | null) ?? null,
    referenceRuleId: (row.reference_rule_id as string | null) ?? null,
    percentage: (row.percentage as number | null) ?? null,
    fixedAddAfterReference: (row.fixed_add_after_reference as number | null) ?? null,
    roundingMethod: (row.rounding_method as PriceRule['roundingMethod']) ?? null,
    roundingIncrement: (row.rounding_increment as number | null) ?? null,
    priority: (row.priority as number) ?? 100,
    stackingBehavior: (row.stacking_behavior as StackingBehavior) ?? 'STACK',
    exclusiveGroup: (row.exclusive_group as string | null) ?? null,
    effectiveFrom: (row.effective_from as string | null) ?? null,
    effectiveTo: (row.effective_to as string | null) ?? null,
    sourceRegionId: (row.source_region_id as string | null) ?? null,
    rawValueText: (row.raw_value_text as string | null) ?? null,
    extractionConfidence: (row.extraction_confidence as number | null) ?? null,
    reviewStatus: row.review_status as ReviewStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    conditions: conditionRows.map(mapCondition).sort((a, b) => a.conditionGroup - b.conditionGroup),
  };
}

function mapDependency(row: Record<string, unknown>): DependencyRule {
  return {
    id: row.id as string,
    ruleKey: (row.rule_key as string | null) ?? null,
    priceBookId: (row.price_book_id as string | null) ?? null,
    triggerConditions: (row.trigger_conditions as Record<string, unknown>) ?? {},
    relationshipType: row.relationship_type as DependencyRule['relationshipType'],
    targetType: (row.target_type as DependencyRule['targetType']) ?? null,
    targetIdOrValue: (row.target_id_or_value as string | null) ?? null,
    severity: row.severity as DependencyRule['severity'],
    autoApplyAllowed: (row.auto_apply_allowed as boolean) ?? false,
    messageTemplate: (row.message_template as string | null) ?? null,
    priceEffect: (row.price_effect as string | null) ?? null,
    sourceRegionId: (row.source_region_id as string | null) ?? null,
    priority: (row.priority as number) ?? 100,
    reviewStatus: row.review_status as ReviewStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** All compiled price rules (with conditions) produced from a table's source region. */
export async function listCompiledRules(sourceRegionId: string): Promise<CompiledPriceRule[]> {
  const { data, error } = await supabase
    .from('price_rule')
    .select('*, rule_condition(*)')
    .eq('source_region_id', sourceRegionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRule(r as Record<string, unknown>));
}

/** All compiled dependency rules produced from a table's source region. */
export async function listCompiledDependencyRules(sourceRegionId: string): Promise<DependencyRule[]> {
  const { data, error } = await supabase
    .from('dependency_rule')
    .select('*')
    .eq('source_region_id', sourceRegionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapDependency(r as Record<string, unknown>));
}

export interface CompiledRuleReview {
  rules: CompiledPriceRule[];
  dependencyRules: DependencyRule[];
}

/** Reads everything a reviewer needs for one compiled table. */
export async function getCompiledReview(sourceRegionId: string): Promise<CompiledRuleReview> {
  const [rules, dependencyRules] = await Promise.all([
    listCompiledRules(sourceRegionId),
    listCompiledDependencyRules(sourceRegionId),
  ]);
  return { rules, dependencyRules };
}

export interface ApproveCompiledInput {
  extractionId: string;
  sourceRegionId: string;
  proposalId?: string | null;
}

/**
 * Approves a compiled table: flips every price_rule + dependency_rule from that
 * table's source region to APPROVED, marks the extraction approved, and applies
 * the proposal. Rules become eligible for the pricing engine once the document
 * is published.
 */
export async function approveCompiledExtraction(input: ApproveCompiledInput): Promise<{ approvedRules: number; approvedDependencies: number }> {
  const { data: priceRows, error: prErr } = await supabase
    .from('price_rule')
    .update({ review_status: 'APPROVED' })
    .eq('source_region_id', input.sourceRegionId)
    .select('id');
  if (prErr) throw new Error(prErr.message);

  const { data: depRows, error: depErr } = await supabase
    .from('dependency_rule')
    .update({ review_status: 'APPROVED' })
    .eq('source_region_id', input.sourceRegionId)
    .select('id');
  if (depErr) throw new Error(depErr.message);

  await supabase.from('price_book_extractions').update({ status: 'approved' }).eq('id', input.extractionId);
  if (input.proposalId) await updateProposalStatus(input.proposalId, 'applied');

  return { approvedRules: priceRows?.length ?? 0, approvedDependencies: depRows?.length ?? 0 };
}

/**
 * Rejects a compiled table: marks its rules REJECTED (kept for audit), the
 * extraction discarded, and the proposal rejected. No prices are published.
 */
export async function rejectCompiledExtraction(input: ApproveCompiledInput): Promise<void> {
  await supabase.from('price_rule').update({ review_status: 'REJECTED' }).eq('source_region_id', input.sourceRegionId);
  await supabase.from('dependency_rule').update({ review_status: 'REJECTED' }).eq('source_region_id', input.sourceRegionId);
  await supabase.from('price_book_extractions').update({ status: 'discarded' }).eq('id', input.extractionId);
  if (input.proposalId) await updateProposalStatus(input.proposalId, 'rejected');
}

/**
 * Publishes a draft price_book_document so its APPROVED rules become the active
 * priced version (pins for estimates). Supersedes the prior version if given.
 */
export async function publishPriceBookDocument(documentId: string, supersedesId?: string | null): Promise<void> {
  const { error } = await supabase
    .from('price_book_document')
    .update({ status: 'published', review_status: 'APPROVED', supersedes_id: supersedesId ?? null })
    .eq('id', documentId);
  if (error) throw new Error(error.message);
  if (supersedesId) {
    await supabase.from('price_book_document').update({ status: 'superseded' }).eq('id', supersedesId);
  }
}

export interface DocumentCompileSummary {
  documentId: string;
  priceRuleCount: number;
  approvedRuleCount: number;
  dependencyRuleCount: number;
  status: string;
}

/** Counts of compiled vs approved rules for a document (drives the publish gate). */
export async function getDocumentCompileSummary(documentId: string): Promise<DocumentCompileSummary> {
  const [{ count: total }, { count: approved }, { count: deps }, { data: doc }] = await Promise.all([
    supabase.from('price_rule').select('id', { count: 'exact', head: true }).eq('price_book_id', documentId),
    supabase.from('price_rule').select('id', { count: 'exact', head: true }).eq('price_book_id', documentId).eq('review_status', 'APPROVED'),
    supabase.from('dependency_rule').select('id', { count: 'exact', head: true }).eq('price_book_id', documentId),
    supabase.from('price_book_document').select('status').eq('id', documentId).maybeSingle(),
  ]);
  return {
    documentId,
    priceRuleCount: total ?? 0,
    approvedRuleCount: approved ?? 0,
    dependencyRuleCount: deps ?? 0,
    status: (doc?.status as string) ?? 'draft',
  };
}
