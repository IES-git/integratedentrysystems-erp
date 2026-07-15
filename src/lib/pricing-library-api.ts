import { supabase } from '@/lib/supabase';
import { loadPricingDefaults, type PricingDefaults } from '@/lib/pricing-defaults-api';
import { parseDiscountChainMultiplier, resolveHardwareNet } from '@/lib/pricing/hardware';
import type {
  HardwareApprovalState,
  PriceActionType,
  PriceStatus,
  PriceTableArchetype,
  ReviewStatus,
  RuleEntityType,
} from '@/types';

export interface EnginePricingLibrary {
  ruleTables: CpqRuleTableSummary[];
  hardwarePrices: HardwarePricingRow[];
  hardwarePriceTotal: number;
  hardwareSpecs: HardwareSpecReviewRow[];
  defaults: PricingDefaults;
}

export interface HardwareSpecReviewRow {
  id: string;
  externalSpecId: string;
  category: string;
  description: string | null;
  func: string | null;
  finish: string | null;
  size: string | null;
  rating: string | null;
  approvalState: HardwareApprovalState;
  active: boolean;
  sourceFile: string | null;
  sourceMetadata: Record<string, unknown>;
  variantIds: string[];
  productIds: string[];
  manufacturerNames: string[];
  models: string[];
  skus: string[];
  updatedAt: string;
}

export interface HardwareSpecReviewUpdate {
  category: string;
  description: string | null;
  func: string | null;
  finish: string | null;
  size: string | null;
  rating: string | null;
  approvalState: HardwareApprovalState;
}

export async function updateHardwareSpecReview(
  row: HardwareSpecReviewRow,
  input: HardwareSpecReviewUpdate,
): Promise<void> {
  if (!input.category.trim()) throw new Error('Category is required.');
  if (input.approvalState === 'approved' && !input.description?.trim()) {
    throw new Error('Approved hardware requires a reviewed description.');
  }
  const { data: auth } = await supabase.auth.getUser();
  const active = !['inactive', 'rejected'].includes(input.approvalState);
  const reviewedAt = ['approved', 'rejected', 'inactive'].includes(input.approvalState)
    ? new Date().toISOString()
    : null;
  const { error } = await supabase.from('hardware_spec').update({
    category: input.category.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    other_requirements: input.description?.trim() || null,
    function: input.func?.trim() || null,
    finish: input.finish?.trim() || null,
    size: input.size?.trim() || null,
    rating: input.rating?.trim() || null,
    approval_state: input.approvalState,
    active,
    updated_by: auth.user?.id ?? null,
    last_reviewed_at: reviewedAt,
  }).eq('id', row.id);
  if (error) throw new Error(`Failed to update hardware specification: ${error.message}`);

  if (row.variantIds.length > 0) {
    const { error: variantError } = await supabase.from('hardware_variant').update({
      approval_state: input.approvalState,
      active,
      updated_by: auth.user?.id ?? null,
      last_reviewed_at: reviewedAt,
    }).in('id', row.variantIds);
    if (variantError) throw new Error(`Specification saved, but linked offers were not updated: ${variantError.message}`);
  }
  if (row.productIds.length > 0) {
    const { error: productError } = await supabase.from('hardware_product').update({
      category: input.category.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      description: input.description?.trim() || null,
      approval_state: input.approvalState,
      active,
      updated_by: auth.user?.id ?? null,
      last_reviewed_at: reviewedAt,
    }).in('id', row.productIds);
    if (productError) throw new Error(`Specification saved, but linked products were not updated: ${productError.message}`);
  }
}

export interface CpqRuleTableDetail {
  table: CpqRuleTableSummary;
  rules: CpqRuleRow[];
}

export interface CpqRuleTableSummary {
  id: string;
  priceBookId: string;
  priceBookTitle: string;
  manufacturerName: string | null;
  documentStatus: string | null;
  documentReviewStatus: string | null;
  effectiveDate: string | null;
  ingestionProfileKey: string | null;
  entityType: string | null;
  archetype: PriceTableArchetype;
  name: string;
  section: string | null;
  basis: string | null;
  unit: string | null;
  precedence: number;
  ruleCount: number;
  approvedRuleCount: number;
  updatedAt: string;
}

export interface CpqRuleRow {
  id: string;
  ruleKey: string | null;
  priceBookId: string;
  priceTableId: string | null;
  entityType: RuleEntityType;
  chargeCategory: string | null;
  itemOrOptionCode: string | null;
  priceStatus: PriceStatus;
  actionType: PriceActionType;
  amount: number | null;
  percentage: number | null;
  unitOfMeasure: string | null;
  quantityBasisField: string | null;
  rawValueText: string | null;
  reviewStatus: ReviewStatus;
  priority: number;
  conditions: {
    fieldPath: string | null;
    operator: string;
    value1: string | null;
    value2: string | null;
    unit: string | null;
  }[];
  updatedAt: string;
}

export interface HardwarePricingRow {
  id: string;
  hardwarePriceBookId: string | null;
  priceBookTitle: string | null;
  supplierName: string | null;
  category: string;
  manufacturerName: string | null;
  description: string | null;
  sku: string | null;
  finish: string | null;
  func: string | null;
  size: string | null;
  listPrice: number | null;
  discountMultiplier: number | null;
  discountChain: string | null;
  netCost: number | null;
  uom: string;
  reviewStatus: string;
  sourceRowRef: string | null;
  updatedAt: string;
}

export interface HardwarePricingUpdate {
  listPrice: number | null;
  discountMultiplier: number | null;
  discountChain: string | null;
  netCost: number | null;
  uom: string;
  reviewStatus: ReviewStatus;
}

/**
 * Maintains a normalized hardware price observation. Approval is deliberately
 * explicit: edited rows can stay NEEDS_REVIEW, and APPROVED is refused unless
 * the engine can resolve a plausible net from the supplied values.
 */
export async function updateHardwarePricingRow(id: string, input: HardwarePricingUpdate): Promise<void> {
  if (input.listPrice != null && (!Number.isFinite(input.listPrice) || input.listPrice <= 0)) {
    throw new Error('List price must be greater than zero.');
  }
  if (
    input.discountMultiplier != null &&
    (!Number.isFinite(input.discountMultiplier) || input.discountMultiplier <= 0 || input.discountMultiplier > 1)
  ) {
    throw new Error('Discount multiplier must be greater than 0 and no more than 1.');
  }
  if (input.discountChain && parseDiscountChainMultiplier(input.discountChain) == null) {
    throw new Error('Discount chain must contain percentages from 0 to 100 separated by “/” (for example 50/20).');
  }
  if (input.netCost != null && (!Number.isFinite(input.netCost) || input.netCost <= 0)) {
    throw new Error('Net cost must be greater than zero.');
  }
  if (input.reviewStatus === 'APPROVED' && resolveHardwareNet(input) == null) {
    throw new Error('Approved hardware pricing requires a plausible net, list × multiplier, or list × discount chain.');
  }

  const { data: auth } = await supabase.auth.getUser();
  const approvalState = input.reviewStatus === 'APPROVED'
    ? 'approved'
    : input.reviewStatus === 'REJECTED'
      ? 'rejected'
      : 'needs_review';
  const { error } = await supabase
    .from('hardware_price')
    .update({
      list_price: input.listPrice,
      discount_multiplier: input.discountMultiplier,
      discount_chain: input.discountChain?.trim() || null,
      net_cost: input.netCost,
      uom: input.uom.trim() || 'EA',
      review_status: input.reviewStatus,
      approval_state: approvalState,
      updated_by: auth.user?.id ?? null,
      last_reviewed_at: input.reviewStatus === 'APPROVED' ? new Date().toISOString() : null,
    })
    .eq('id', id);
  if (error) throw new Error(`Failed to update hardware price: ${error.message}`);
}

async function loadRuleCounts(): Promise<Map<string, { total: number; approved: number }>> {
  const counts = new Map<string, { total: number; approved: number }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('price_rule')
      .select('price_table_id, review_status')
      .not('price_table_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load CPQ rule counts: ${error.message}`);
    const batch = data ?? [];
    for (const row of batch) {
      const priceTableId = row.price_table_id as string | null;
      if (!priceTableId) continue;
      const current = counts.get(priceTableId) ?? { total: 0, approved: 0 };
      current.total += 1;
      if (row.review_status === 'APPROVED') current.approved += 1;
      counts.set(priceTableId, current);
    }
    if (batch.length < PAGE) break;
  }
  return counts;
}

export async function loadEnginePricingLibrary(): Promise<EnginePricingLibrary> {
  const [{ data: tableRows, error: tableError }, ruleCounts, hardware, hardwareSpecs, defaults] = await Promise.all([
    supabase
      .from('price_table')
      .select('id, price_book_id, entity_type, archetype, name, section, basis, unit, precedence, updated_at')
      .order('name', { ascending: true }),
    loadRuleCounts(),
    listHardwarePricingRows(1000),
    listHardwareSpecsForReview(1000),
    loadPricingDefaults(),
  ]);

  if (tableError) throw new Error(`Failed to load CPQ price tables: ${tableError.message}`);

  const documentIds = [...new Set((tableRows ?? []).map((row) => row.price_book_id as string).filter(Boolean))];
  const documentsById = new Map<string, Record<string, unknown>>();
  const manufacturerNamesById = new Map<string, string>();

  if (documentIds.length > 0) {
    const { data: documents, error: docError } = await supabase
      .from('price_book_document')
      .select('id, title, status, review_status, effective_date, ingestion_profile_key, manufacturer_id')
      .in('id', documentIds);
    if (docError) throw new Error(`Failed to load price book documents: ${docError.message}`);

    for (const doc of documents ?? []) documentsById.set(doc.id as string, doc as Record<string, unknown>);

    const manufacturerIds = [...new Set((documents ?? []).map((doc) => doc.manufacturer_id as string | null).filter(Boolean) as string[])];
    if (manufacturerIds.length > 0) {
      const { data: companies, error: companyError } = await supabase
        .from('companies')
        .select('id, name')
        .in('id', manufacturerIds);
      if (companyError) throw new Error(`Failed to load manufacturers: ${companyError.message}`);
      for (const company of companies ?? []) manufacturerNamesById.set(company.id as string, company.name as string);
    }
  }

  const ruleTables = (tableRows ?? []).map((row) => {
    const priceBookId = row.price_book_id as string;
    const doc = documentsById.get(priceBookId);
    const manufacturerId = doc?.manufacturer_id as string | null | undefined;
    const counts = ruleCounts.get(row.id as string) ?? { total: 0, approved: 0 };
    return {
      id: row.id as string,
      priceBookId,
      priceBookTitle: (doc?.title as string | undefined) ?? 'Unknown price book',
      manufacturerName: manufacturerId ? manufacturerNamesById.get(manufacturerId) ?? null : null,
      documentStatus: (doc?.status as string | null | undefined) ?? null,
      documentReviewStatus: (doc?.review_status as string | null | undefined) ?? null,
      effectiveDate: (doc?.effective_date as string | null | undefined) ?? null,
      ingestionProfileKey: (doc?.ingestion_profile_key as string | null | undefined) ?? null,
      entityType: (row.entity_type as string | null) ?? null,
      archetype: row.archetype as PriceTableArchetype,
      name: row.name as string,
      section: (row.section as string | null) ?? null,
      basis: (row.basis as string | null) ?? null,
      unit: (row.unit as string | null) ?? null,
      precedence: (row.precedence as number) ?? 0,
      ruleCount: counts.total,
      approvedRuleCount: counts.approved,
      updatedAt: row.updated_at as string,
    } satisfies CpqRuleTableSummary;
  });

  return {
    ruleTables,
    hardwarePrices: hardware.rows,
    hardwarePriceTotal: hardware.total,
    hardwareSpecs,
    defaults,
  };
}

async function listHardwareSpecsForReview(limit: number): Promise<HardwareSpecReviewRow[]> {
  const { data, error } = await supabase
    .from('hardware_spec')
    .select('id, external_spec_id, category, other_requirements, function, finish, size, rating, approval_state, active, source_file, source_metadata, updated_at, hardware_variant(id, sku, hardware_product_id, hardware_product(manufacturer_name, model))')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load hardware specifications: ${error.message}`);
  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    const variants = ((row.hardware_variant as Record<string, unknown>[] | null) ?? []);
    const products = variants.map((variant) => (variant.hardware_product as Record<string, unknown> | null) ?? {});
    return {
      id: String(row.id),
      externalSpecId: String(row.external_spec_id),
      category: String(row.category ?? ''),
      description: (row.other_requirements as string | null) ?? null,
      func: (row.function as string | null) ?? null,
      finish: (row.finish as string | null) ?? null,
      size: (row.size as string | null) ?? null,
      rating: (row.rating as string | null) ?? null,
      approvalState: (row.approval_state as HardwareApprovalState) ?? 'needs_review',
      active: (row.active as boolean | null) ?? true,
      sourceFile: (row.source_file as string | null) ?? null,
      sourceMetadata: (row.source_metadata as Record<string, unknown> | null) ?? {},
      variantIds: variants.map((variant) => String(variant.id)).filter(Boolean),
      productIds: [...new Set(variants.map((variant) => String(variant.hardware_product_id ?? '')).filter(Boolean))],
      manufacturerNames: [...new Set(products.map((product) => String(product.manufacturer_name ?? '')).filter(Boolean))],
      models: [...new Set(products.map((product) => String(product.model ?? '')).filter(Boolean))],
      skus: [...new Set(variants.map((variant) => String(variant.sku ?? '')).filter(Boolean))],
      updatedAt: String(row.updated_at ?? ''),
    };
  });
}

export async function listCpqRulesForPriceTable(priceTableId: string, limit = 1000): Promise<CpqRuleRow[]> {
  const { data, error } = await supabase
    .from('price_rule')
    .select('id, rule_key, price_book_id, price_table_id, entity_type, charge_category, item_or_option_code, price_status, action_type, amount, percentage, unit_of_measure, quantity_basis_field, raw_value_text, review_status, priority, updated_at, rule_condition(field_path, operator, value_1, value_2, unit)')
    .eq('price_table_id', priceTableId)
    .order('priority', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to load CPQ rules: ${error.message}`);

  return (data ?? []).map((row) => ({
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
    percentage: (row.percentage as number | null) ?? null,
    unitOfMeasure: (row.unit_of_measure as string | null) ?? null,
    quantityBasisField: (row.quantity_basis_field as string | null) ?? null,
    rawValueText: (row.raw_value_text as string | null) ?? null,
    reviewStatus: row.review_status as ReviewStatus,
    priority: (row.priority as number) ?? 0,
    updatedAt: row.updated_at as string,
    conditions: ((row.rule_condition as Record<string, unknown>[] | undefined) ?? []).map((condition) => ({
      fieldPath: (condition.field_path as string | null) ?? null,
      operator: condition.operator as string,
      value1: (condition.value_1 as string | null) ?? null,
      value2: (condition.value_2 as string | null) ?? null,
      unit: (condition.unit as string | null) ?? null,
    })),
  }));
}

export async function getCpqRuleTableDetail(priceTableId: string): Promise<CpqRuleTableDetail> {
  const { data: row, error } = await supabase
    .from('price_table')
    .select('id, price_book_id, entity_type, archetype, name, section, basis, unit, precedence, updated_at')
    .eq('id', priceTableId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load CPQ price table: ${error.message}`);
  if (!row) throw new Error('Pricing rule table not found.');

  const rules = await listCpqRulesForPriceTable(priceTableId, 5000);
  const priceBookId = row.price_book_id as string;
  let document: Record<string, unknown> | null = null;
  let manufacturerName: string | null = null;

  if (priceBookId) {
    const { data: doc, error: docError } = await supabase
      .from('price_book_document')
      .select('id, title, status, review_status, effective_date, ingestion_profile_key, manufacturer_id')
      .eq('id', priceBookId)
      .maybeSingle();
    if (docError) throw new Error(`Failed to load price book document: ${docError.message}`);
    document = (doc as Record<string, unknown> | null) ?? null;

    const manufacturerId = document?.manufacturer_id as string | null | undefined;
    if (manufacturerId) {
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('name')
        .eq('id', manufacturerId)
        .maybeSingle();
      if (companyError) throw new Error(`Failed to load manufacturer: ${companyError.message}`);
      manufacturerName = (company?.name as string | null | undefined) ?? null;
    }
  }

  return {
    table: {
      id: row.id as string,
      priceBookId,
      priceBookTitle: (document?.title as string | undefined) ?? 'Unknown price book',
      manufacturerName,
      documentStatus: (document?.status as string | null | undefined) ?? null,
      documentReviewStatus: (document?.review_status as string | null | undefined) ?? null,
      effectiveDate: (document?.effective_date as string | null | undefined) ?? null,
      ingestionProfileKey: (document?.ingestion_profile_key as string | null | undefined) ?? null,
      entityType: (row.entity_type as string | null) ?? null,
      archetype: row.archetype as PriceTableArchetype,
      name: row.name as string,
      section: (row.section as string | null) ?? null,
      basis: (row.basis as string | null) ?? null,
      unit: (row.unit as string | null) ?? null,
      precedence: (row.precedence as number) ?? 0,
      ruleCount: rules.length,
      approvedRuleCount: rules.filter((rule) => rule.reviewStatus === 'APPROVED').length,
      updatedAt: row.updated_at as string,
    },
    rules,
  };
}

async function listHardwarePricingRows(limit: number): Promise<{ rows: HardwarePricingRow[]; total: number }> {
  const { data, error, count } = await supabase
    .from('hardware_price')
    .select('id, hardware_price_book_id, list_price, discount_multiplier, discount_chain, net_cost, uom, review_status, source_row_ref, updated_at, hardware_price_book(title, supplier_name), hardware_variant!inner(id, sku, finish, function, size, hardware_product!inner(category, manufacturer_name, description))', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load hardware prices: ${error.message}`);

  return {
    total: count ?? 0,
    rows: (data ?? []).map((row) => {
      const variant = row.hardware_variant as unknown as Record<string, unknown>;
      const product = (variant?.hardware_product as unknown as Record<string, unknown>) ?? {};
      const book = (row.hardware_price_book as unknown as Record<string, unknown> | null) ?? null;
      return {
        id: row.id as string,
        hardwarePriceBookId: (row.hardware_price_book_id as string | null) ?? null,
        priceBookTitle: (book?.title as string | null) ?? null,
        supplierName: (book?.supplier_name as string | null) ?? null,
        category: (product.category as string | null) ?? '',
        manufacturerName: (product.manufacturer_name as string | null) ?? null,
        description: (product.description as string | null) ?? null,
        sku: (variant?.sku as string | null) ?? null,
        finish: (variant?.finish as string | null) ?? null,
        func: (variant?.function as string | null) ?? null,
        size: (variant?.size as string | null) ?? null,
        listPrice: (row.list_price as number | null) ?? null,
        discountMultiplier: (row.discount_multiplier as number | null) ?? null,
        discountChain: (row.discount_chain as string | null) ?? null,
        netCost: (row.net_cost as number | null) ?? null,
        uom: (row.uom as string) ?? 'EA',
        reviewStatus: (row.review_status as string) ?? 'UNREVIEWED',
        sourceRowRef: (row.source_row_ref as string | null) ?? null,
        updatedAt: row.updated_at as string,
      };
    }),
  };
}
