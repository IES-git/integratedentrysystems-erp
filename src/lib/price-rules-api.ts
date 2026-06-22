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

export type ManufacturerPricedEntity = 'door' | 'frame' | 'panel';

/** Latest published price-book document per manufacturer and component type. */
export interface ManufacturerCatalogOption {
  manufacturerId: string;
  manufacturerName: string;
  documentIds: Partial<Record<ManufacturerPricedEntity, string>>;
  effectiveDates: Partial<Record<ManufacturerPricedEntity, string | null>>;
  titles: Partial<Record<ManufacturerPricedEntity, string>>;
}

/**
 * Lists manufacturers that have a published canonical rule book. A manufacturer
 * can use one document for all components or separate door/frame revisions; the
 * returned map pins the correct immutable document for each component type.
 */
export async function listPublishedManufacturerCatalogs(
  pricedAsOf = new Date().toISOString().slice(0, 10),
): Promise<ManufacturerCatalogOption[]> {
  const { data: docs, error: docErr } = await supabase
    .from('price_book_document')
    .select('id, manufacturer_id, title, effective_date, created_at')
    .eq('status', 'published')
    .eq('review_status', 'APPROVED')
    .eq('source_verified', true)
    .not('manufacturer_id', 'is', null)
    .order('effective_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (docErr) throw new Error(docErr.message);

  const eligibleDocs = (docs ?? []).filter(
    (d) => !d.effective_date || String(d.effective_date) <= pricedAsOf,
  );
  const documentIds = eligibleDocs.map((d) => d.id as string);
  if (documentIds.length === 0) return [];

  const manufacturerIds = [...new Set(eligibleDocs.map((d) => d.manufacturer_id as string))];
  const [{ data: tables, error: tableErr }, { data: companies, error: companyErr }] = await Promise.all([
    supabase
      .from('price_table')
      .select('price_book_id, entity_type')
      .in('price_book_id', documentIds)
      .in('entity_type', ['door', 'frame', 'panel']),
    supabase
      .from('companies')
      .select('id, name')
      .in('id', manufacturerIds),
  ]);
  if (tableErr) throw new Error(tableErr.message);
  if (companyErr) throw new Error(companyErr.message);

  const entitiesByDocument = new Map<string, Set<ManufacturerPricedEntity>>();
  for (const row of tables ?? []) {
    const entity = row.entity_type as ManufacturerPricedEntity;
    const id = row.price_book_id as string;
    if (!entitiesByDocument.has(id)) entitiesByDocument.set(id, new Set());
    entitiesByDocument.get(id)!.add(entity);
  }
  const nameById = new Map((companies ?? []).map((c) => [c.id as string, c.name as string]));
  const byManufacturer = new Map<string, ManufacturerCatalogOption>();

  // Documents are already newest-first; first assignment per entity wins.
  for (const doc of eligibleDocs) {
    const manufacturerId = doc.manufacturer_id as string;
    const entities = entitiesByDocument.get(doc.id as string);
    if (!entities || entities.size === 0) continue;
    const option = byManufacturer.get(manufacturerId) ?? {
      manufacturerId,
      manufacturerName: nameById.get(manufacturerId) ?? 'Unknown manufacturer',
      documentIds: {},
      effectiveDates: {},
      titles: {},
    };
    for (const entity of entities) {
      if (option.documentIds[entity]) continue;
      option.documentIds[entity] = doc.id as string;
      option.effectiveDates[entity] = (doc.effective_date as string | null) ?? null;
      option.titles[entity] = doc.title as string;
    }
    byManufacturer.set(manufacturerId, option);
  }

  return [...byManufacturer.values()].sort((a, b) =>
    a.manufacturerName.localeCompare(b.manufacturerName),
  );
}

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

export interface BulkApproveResult {
  approvedExtractions: number;
  approvedRules: number;
  approvedDependencies: number;
  /** The document these rules hang off (publish target), if resolvable. */
  documentId: string | null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Bulk-approves every COMPILED table for a book in one pass: flips all their
 * UNREVIEWED price_rule + dependency_rule rows to APPROVED, marks the
 * extractions approved, and applies their ingestion proposals. This replaces
 * opening and approving 200 tables one at a time.
 *
 * Safe to auto-approve at scale: the pricing engine still routes low-confidence
 * rules to the manual-quote queue at quote time, and the QA gate blocks publish
 * on structural errors — so nothing unreviewed silently reaches a customer quote.
 */
export async function approveAllCompiledExtractions(priceBookId: string): Promise<BulkApproveResult> {
  const { data: exts, error } = await supabase
    .from('price_book_extractions')
    .select('id, source_region_id, price_book_document_id')
    .eq('price_book_id', priceBookId)
    .eq('status', 'compiled');
  if (error) throw new Error(error.message);

  const compiled = (exts ?? []).filter((e) => e.source_region_id) as {
    id: string; source_region_id: string; price_book_document_id: string | null;
  }[];
  if (compiled.length === 0) {
    return { approvedExtractions: 0, approvedRules: 0, approvedDependencies: 0, documentId: null };
  }

  const regionIds = compiled.map((e) => e.source_region_id);
  const extIds = compiled.map((e) => e.id);
  const documentId = compiled.find((e) => e.price_book_document_id)?.price_book_document_id ?? null;

  let approvedRules = 0;
  let approvedDependencies = 0;
  for (const ids of chunk(regionIds, 100)) {
    const { data: pr, error: prErr } = await supabase
      .from('price_rule').update({ review_status: 'APPROVED' })
      .in('source_region_id', ids).eq('review_status', 'UNREVIEWED').select('id');
    if (prErr) throw new Error(prErr.message);
    approvedRules += pr?.length ?? 0;

    const { data: dr, error: drErr } = await supabase
      .from('dependency_rule').update({ review_status: 'APPROVED' })
      .in('source_region_id', ids).eq('review_status', 'UNREVIEWED').select('id');
    if (drErr) throw new Error(drErr.message);
    approvedDependencies += dr?.length ?? 0;
  }

  for (const ids of chunk(extIds, 100)) {
    const { error: exErr } = await supabase.from('price_book_extractions').update({ status: 'approved' }).in('id', ids);
    if (exErr) throw new Error(exErr.message);
  }

  // Apply the matching ingestion proposals (best-effort; never blocks approval).
  const { data: props } = await supabase
    .from('pricing_change_proposals')
    .select('id, target_ids')
    .eq('source', 'ingestion')
    .eq('status', 'pending');
  const extIdSet = new Set(extIds);
  const proposalIds = (props ?? [])
    .filter((p) => extIdSet.has((p.target_ids as { extractionId?: string } | null)?.extractionId ?? ''))
    .map((p) => p.id as string);
  for (const ids of chunk(proposalIds, 100)) {
    await supabase.from('pricing_change_proposals')
      .update({ status: 'applied', reviewed_at: new Date().toISOString() }).in('id', ids);
  }

  return { approvedExtractions: extIds.length, approvedRules, approvedDependencies, documentId };
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
    .update({
      status: 'published',
      review_status: 'APPROVED',
      source_verified: true,
      source_verified_at: new Date().toISOString(),
      supersedes_id: supersedesId ?? null,
    })
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
