import { supabase } from '@/lib/supabase';
import { loadPricingDefaults, type PricingDefaults } from '@/lib/pricing-defaults-api';
import type {
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
  defaults: PricingDefaults;
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
  netCost: number | null;
  uom: string;
  reviewStatus: string;
  sourceRowRef: string | null;
  updatedAt: string;
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
  const [{ data: tableRows, error: tableError }, ruleCounts, hardware, defaults] = await Promise.all([
    supabase
      .from('price_table')
      .select('id, price_book_id, entity_type, archetype, name, section, basis, unit, precedence, updated_at')
      .order('name', { ascending: true }),
    loadRuleCounts(),
    listHardwarePricingRows(1000),
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
    defaults,
  };
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
    .select('id, hardware_price_book_id, list_price, discount_multiplier, net_cost, uom, review_status, source_row_ref, updated_at, hardware_price_book(title, supplier_name), hardware_variant!inner(id, sku, finish, function, size, hardware_product!inner(category, manufacturer_name, description))', { count: 'exact' })
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
        netCost: (row.net_cost as number | null) ?? null,
        uom: (row.uom as string) ?? 'EA',
        reviewStatus: (row.review_status as string) ?? 'UNREVIEWED',
        sourceRowRef: (row.source_row_ref as string | null) ?? null,
        updatedAt: row.updated_at as string,
      };
    }),
  };
}
