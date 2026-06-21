/**
 * Engine data loaders (Phase 3).
 *
 * Pulls the APPROVED rule graph (price_rule + conditions + action params +
 * included_scope + quantity_tier) for a pinned `price_book_document` version,
 * plus the dependency rules and the hardware catalog slices the engine needs
 * (sets, prep crosswalk, variants/prices, sell rules, linear rules, services).
 *
 * Mappers convert snake_case DB rows to the camelCase domain types in
 * `@/types/cpq`. Everything is read-only.
 */

import { supabase } from '@/lib/supabase';
import type {
  RuleCondition,
  RuleActionParameter,
  IncludedScope,
  QuantityTier,
  DependencyRule,
  HardwarePrepCrosswalk,
  HardwareSetTemplate,
  HardwareSetItem,
  HardwareSellRule,
  ServiceScope,
  LinearHardwareRule,
  HardwareVariant,
  HardwarePrice,
  ConditionOperator,
  ConditionValueType,
  PriceStatus,
  PriceActionType,
  StackingBehavior,
  RuleEntityType,
} from '@/types';
import type { LoadedPriceRule } from './engine-types';

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
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

function mapActionParam(row: Record<string, unknown>): RuleActionParameter {
  return {
    id: row.id as string,
    priceRuleId: row.price_rule_id as string,
    paramKey: row.param_key as string,
    paramValue: (row.param_value as string | null) ?? null,
    referenceRuleId: (row.reference_rule_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapIncludedScope(row: Record<string, unknown>): IncludedScope {
  return {
    id: row.id as string,
    priceRuleId: row.price_rule_id as string,
    includedFeature: (row.included_feature as string | null) ?? null,
    includedOptionCode: (row.included_option_code as string | null) ?? null,
    suppressesChargeCategory: (row.suppresses_charge_category as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapQuantityTier(row: Record<string, unknown>): QuantityTier {
  return {
    id: row.id as string,
    priceRuleId: row.price_rule_id as string,
    quantityField: (row.quantity_field as string | null) ?? null,
    minQty: num(row.min_qty),
    maxQty: num(row.max_qty),
    amount: num(row.amount),
    status: (row.status as PriceStatus | null) ?? null,
    isSetupCharge: (row.is_setup_charge as boolean) ?? false,
    createdAt: row.created_at as string,
  };
}

function mapRule(row: Record<string, unknown>): LoadedPriceRule {
  const conditions = ((row.rule_condition as Record<string, unknown>[] | undefined) ?? []).map(mapCondition);
  const actionParameters = ((row.rule_action_parameter as Record<string, unknown>[] | undefined) ?? []).map(mapActionParam);
  const includedScopes = ((row.included_scope as Record<string, unknown>[] | undefined) ?? []).map(mapIncludedScope);
  const quantityTiers = ((row.quantity_tier as Record<string, unknown>[] | undefined) ?? []).map(mapQuantityTier);
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
    amount: num(row.amount),
    currencyCode: (row.currency_code as string) ?? 'USD',
    unitOfMeasure: (row.unit_of_measure as string | null) ?? null,
    quantityBasisField: (row.quantity_basis_field as string | null) ?? null,
    baseQuantityIncluded: num(row.base_quantity_included),
    minimumCharge: num(row.minimum_charge),
    maximumCharge: num(row.maximum_charge),
    referenceRuleId: (row.reference_rule_id as string | null) ?? null,
    percentage: num(row.percentage),
    fixedAddAfterReference: num(row.fixed_add_after_reference),
    roundingMethod: (row.rounding_method as LoadedPriceRule['roundingMethod']) ?? null,
    roundingIncrement: num(row.rounding_increment),
    priority: (row.priority as number) ?? 100,
    stackingBehavior: (row.stacking_behavior as StackingBehavior) ?? 'STACK',
    exclusiveGroup: (row.exclusive_group as string | null) ?? null,
    effectiveFrom: (row.effective_from as string | null) ?? null,
    effectiveTo: (row.effective_to as string | null) ?? null,
    sourceRegionId: (row.source_region_id as string | null) ?? null,
    rawValueText: (row.raw_value_text as string | null) ?? null,
    extractionConfidence: num(row.extraction_confidence),
    reviewStatus: row.review_status as LoadedPriceRule['reviewStatus'],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    conditions,
    actionParameters,
    includedScopes,
    quantityTiers,
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
    reviewStatus: row.review_status as DependencyRule['reviewStatus'],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export interface LoadedRuleSet {
  rules: LoadedPriceRule[];
  dependencyRules: DependencyRule[];
}

/**
 * Loads every APPROVED price rule (with its full sub-graph) for a pinned
 * document, filtered to the effective window for `pricedAsOf`.
 */
export async function loadRuleSet(
  priceBookDocumentId: string,
  pricedAsOf: string,
): Promise<LoadedRuleSet> {
  // rule_action_parameter has TWO FKs to price_rule (price_rule_id + reference_rule_id),
  // so the embed must name the FK explicitly or PostgREST errors on the ambiguity.
  //
  // PostgREST caps a single response at ~1000 rows. A published book can have many
  // thousands of rules (NGP alone is ~18k dimensional cells), so we MUST page
  // through every row — otherwise rules past the first page silently fail to load
  // and components report "no base price matched". Order by (priority, id) for a
  // stable pagination window.
  const PAGE = 1000;
  const ruleRows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('price_rule')
      .select('*, rule_condition(*), rule_action_parameter!rule_action_parameter_price_rule_id_fkey(*), included_scope(*), quantity_tier(*)')
      .eq('price_book_id', priceBookDocumentId)
      .eq('review_status', 'APPROVED')
      .order('priority', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load price rules: ${error.message}`);
    const batch = (data ?? []) as Record<string, unknown>[];
    ruleRows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const rules = ruleRows
    .map((r) => mapRule(r))
    .filter((r) => withinEffective(r.effectiveFrom, r.effectiveTo, pricedAsOf));

  const { data: depRows, error: depErr } = await supabase
    .from('dependency_rule')
    .select('*')
    .eq('price_book_id', priceBookDocumentId)
    .eq('review_status', 'APPROVED')
    .order('priority', { ascending: true });
  if (depErr) throw new Error(`Failed to load dependency rules: ${depErr.message}`);

  return { rules, dependencyRules: (depRows ?? []).map((r) => mapDependency(r as Record<string, unknown>)) };
}

const RULE_EMBED = '*, rule_condition(*), rule_action_parameter!rule_action_parameter_price_rule_id_fkey(*), included_scope(*), quantity_tier(*)';

/** A PostgREST select builder that supports `.range()` (returns a thenable). */
type RangeableBuilder = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Pages through every approved rule matching a PostgREST query builder. */
async function loadAllRules(build: () => RangeableBuilder): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load price rules: ${error.message}`);
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

/**
 * Loads ONLY the NGP rules an opening references: the dimensional matrices for
 * the resolved price tables, the glazing-tape direct rules for the resolved tape
 * models, and the (few) option-adder rules. This keeps NGP pricing fast — a full
 * NGP book is ~18k rules; an opening touches a handful of tables.
 */
export async function loadNgpScopedRuleSet(
  ngpDocumentId: string | null,
  priceTableIds: string[],
  tapeModels: string[],
  pricedAsOf: string,
): Promise<LoadedRuleSet> {
  if (!ngpDocumentId) return { rules: [], dependencyRules: [] };
  const tableIds = [...new Set(priceTableIds.filter(Boolean))];
  const tapes = [...new Set(tapeModels.filter(Boolean))];
  const collected: Record<string, unknown>[] = [];

  if (tableIds.length > 0) {
    collected.push(...await loadAllRules(() => supabase
      .from('price_rule')
      .select(RULE_EMBED)
      .eq('price_book_id', ngpDocumentId)
      .eq('review_status', 'APPROVED')
      .in('price_table_id', tableIds)
      .order('id', { ascending: true })));
  }
  if (tapes.length > 0) {
    collected.push(...await loadAllRules(() => supabase
      .from('price_rule')
      .select(RULE_EMBED)
      .eq('price_book_id', ngpDocumentId)
      .eq('review_status', 'APPROVED')
      .eq('entity_type', 'glazing_tape')
      .in('item_or_option_code', tapes)
      .order('id', { ascending: true })));
  }
  // Option-adder rules (charge_category 'option:*') are few; load them all so the
  // NGP option pass can resolve finish/galv/zinc/etc.
  collected.push(...await loadAllRules(() => supabase
    .from('price_rule')
    .select(RULE_EMBED)
    .eq('price_book_id', ngpDocumentId)
    .eq('review_status', 'APPROVED')
    .like('charge_category', 'option:%')
    .order('id', { ascending: true })));

  const rules = collected
    .map((r) => mapRule(r))
    .filter((r) => withinEffective(r.effectiveFrom, r.effectiveTo, pricedAsOf));
  return { rules, dependencyRules: [] };
}

function withinEffective(from: string | null, to: string | null, asOf: string): boolean {
  if (from && asOf < from) return false;
  if (to && asOf > to) return false;
  return true;
}

// ===== Hardware catalog loaders =====

export interface HardwareCatalog {
  setTemplates: (HardwareSetTemplate & { items: HardwareSetItem[] })[];
  prepCrosswalk: HardwarePrepCrosswalk[];
  sellRules: HardwareSellRule[];
  serviceScopes: ServiceScope[];
  linearRules: LinearHardwareRule[];
}

function mapSetTemplate(row: Record<string, unknown>): HardwareSetTemplate & { items: HardwareSetItem[] } {
  const items = ((row.hardware_set_item as Record<string, unknown>[] | undefined) ?? []).map((i) => ({
    id: i.id as string,
    hardwareSetTemplateId: i.hardware_set_template_id as string,
    category: i.category as string,
    quantityFormula: (i.quantity_formula as string | null) ?? null,
    required: (i.required as boolean) ?? false,
    position: (i.position as number) ?? 0,
    compatibleVariants: (i.compatible_variants as Record<string, unknown>) ?? {},
    createdAt: i.created_at as string,
  })).sort((a, b) => a.position - b.position);
  return {
    id: row.id as string,
    name: row.name as string,
    useCase: (row.use_case as string | null) ?? null,
    fireRated: (row.fire_rated as boolean | null) ?? null,
    accessControlled: (row.access_controlled as boolean | null) ?? null,
    ratedFlags: (row.rated_flags as Record<string, unknown>) ?? {},
    selectionConditions: (row.selection_conditions as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    items,
  };
}

function mapPrep(row: Record<string, unknown>): HardwarePrepCrosswalk {
  return {
    id: row.id as string,
    hardwareCategory: row.hardware_category as string,
    hardwareProductId: (row.hardware_product_id as string | null) ?? null,
    hardwareVariantId: (row.hardware_variant_id as string | null) ?? null,
    doorPrepCode: (row.door_prep_code as string | null) ?? null,
    framePrepCode: (row.frame_prep_code as string | null) ?? null,
    templateId: (row.template_id as string | null) ?? null,
    handRequired: (row.hand_required as boolean) ?? false,
    locationRequired: (row.location_required as boolean) ?? false,
    additionalRequiredFields: (row.additional_required_fields as string | null) ?? null,
    quantityBasis: (row.quantity_basis as string | null) ?? null,
    pricingBehavior: (row.pricing_behavior as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapSellRule(row: Record<string, unknown>): HardwareSellRule {
  return {
    id: row.id as string,
    name: row.name as string,
    costBasis: row.cost_basis as HardwareSellRule['costBasis'],
    markupMultiplier: num(row.markup_multiplier),
    gmTargetPct: num(row.gm_target_pct),
    rounding: (row.rounding as string | null) ?? null,
    customerClass: (row.customer_class as string | null) ?? null,
    companyId: (row.company_id as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    effectiveFrom: (row.effective_from as string | null) ?? null,
    effectiveTo: (row.effective_to as string | null) ?? null,
    priority: (row.priority as number) ?? 100,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapServiceScope(row: Record<string, unknown>): ServiceScope {
  return {
    id: row.id as string,
    scopeType: row.scope_type as ServiceScope['scopeType'],
    name: row.name as string,
    basis: row.basis as ServiceScope['basis'],
    rate: num(row.rate),
    percent: num(row.percent),
    referenceBasis: (row.reference_basis as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapLinearRule(row: Record<string, unknown>): LinearHardwareRule {
  return {
    id: row.id as string,
    hardwareCategory: row.hardware_category as string,
    lengthBasis: row.length_basis as LinearHardwareRule['lengthBasis'],
    cutIncrement: num(row.cut_increment),
    wastePct: num(row.waste_pct),
    minimumLength: num(row.minimum_length),
    perFootPrice: num(row.per_foot_price),
    hardwareVariantId: (row.hardware_variant_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Loads the (small) shared hardware reference tables used on every run. */
export async function loadHardwareCatalog(pricedAsOf: string): Promise<HardwareCatalog> {
  const [tpl, prep, sell, svc, lin] = await Promise.all([
    supabase.from('hardware_set_template').select('*, hardware_set_item(*)'),
    supabase.from('hardware_prep_crosswalk').select('*'),
    supabase.from('hardware_sell_rule').select('*').order('priority', { ascending: true }),
    supabase.from('service_scope').select('*'),
    supabase.from('linear_hardware_rule').select('*'),
  ]);

  if (tpl.error) throw new Error(`Failed to load hardware set templates: ${tpl.error.message}`);
  if (prep.error) throw new Error(`Failed to load prep crosswalk: ${prep.error.message}`);

  const sellRules = (sell.data ?? [])
    .map((r) => mapSellRule(r as Record<string, unknown>))
    .filter((r) => withinEffective(r.effectiveFrom, r.effectiveTo, pricedAsOf));

  return {
    setTemplates: (tpl.data ?? []).map((r) => mapSetTemplate(r as Record<string, unknown>)),
    prepCrosswalk: (prep.data ?? []).map((r) => mapPrep(r as Record<string, unknown>)),
    sellRules,
    serviceScopes: (svc.data ?? []).map((r) => mapServiceScope(r as Record<string, unknown>)),
    linearRules: (lin.data ?? []).map((r) => mapLinearRule(r as Record<string, unknown>)),
  };
}

export interface VariantWithPrice {
  variant: HardwareVariant;
  category: string;
  /** hardware_product.subcategory — drives the subcategory-keyed prep crosswalk. */
  subcategory: string | null;
  price: HardwarePrice | null;
}

function mapVariant(row: Record<string, unknown>): HardwareVariant {
  return {
    id: row.id as string,
    hardwareProductId: row.hardware_product_id as string,
    sku: (row.sku as string | null) ?? null,
    function: (row.function as string | null) ?? null,
    finish: (row.finish as string | null) ?? null,
    size: (row.size as string | null) ?? null,
    hand: (row.hand as string | null) ?? null,
    voltage: (row.voltage as string | null) ?? null,
    rating: (row.rating as string | null) ?? null,
    material: (row.material as string | null) ?? null,
    optionAttributes: (row.option_attributes as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapPrice(row: Record<string, unknown>): HardwarePrice {
  return {
    id: row.id as string,
    hardwareVariantId: row.hardware_variant_id as string,
    hardwarePriceBookId: (row.hardware_price_book_id as string | null) ?? null,
    listPrice: num(row.list_price),
    discountMultiplier: num(row.discount_multiplier),
    netCost: num(row.net_cost),
    uom: (row.uom as string) ?? 'each',
    effectiveFrom: (row.effective_from as string | null) ?? null,
    effectiveTo: (row.effective_to as string | null) ?? null,
    minimumQuantity: num(row.minimum_quantity),
    sourceRowRef: (row.source_row_ref as string | null) ?? null,
    reviewStatus: row.review_status as HardwarePrice['reviewStatus'],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Loads the specific variants (with their current approved price) for a set of
 * variant ids the spec selected. Empty input returns an empty map.
 */
export async function loadVariantsWithPrices(
  variantIds: string[],
  pricedAsOf: string,
): Promise<Map<string, VariantWithPrice>> {
  const result = new Map<string, VariantWithPrice>();
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (ids.length === 0) return result;

  const [{ data: variants, error: vErr }, { data: prices, error: pErr }] = await Promise.all([
    supabase.from('hardware_variant').select('*, hardware_product(category, subcategory)').in('id', ids),
    supabase.from('hardware_price').select('*').in('hardware_variant_id', ids).eq('review_status', 'APPROVED'),
  ]);
  if (vErr) throw new Error(`Failed to load hardware variants: ${vErr.message}`);
  if (pErr) throw new Error(`Failed to load hardware prices: ${pErr.message}`);

  const priceByVariant = new Map<string, HardwarePrice>();
  for (const p of prices ?? []) {
    const mapped = mapPrice(p as Record<string, unknown>);
    if (!withinEffective(mapped.effectiveFrom, mapped.effectiveTo, pricedAsOf)) continue;
    // Keep the most recent effective price per variant.
    const existing = priceByVariant.get(mapped.hardwareVariantId);
    if (!existing || (mapped.effectiveFrom ?? '') > (existing.effectiveFrom ?? '')) {
      priceByVariant.set(mapped.hardwareVariantId, mapped);
    }
  }

  for (const v of variants ?? []) {
    const row = v as Record<string, unknown>;
    const variant = mapVariant(row);
    const product = row.hardware_product as { category?: string; subcategory?: string | null } | null;
    const category = product?.category ?? '';
    const subcategory = product?.subcategory ?? null;
    result.set(variant.id, { variant, category, subcategory, price: priceByVariant.get(variant.id) ?? null });
  }
  return result;
}
