/**
 * CPQ v2 catalog API (Phase 4 builder).
 *
 * Loads the dictionary-driven catalog that powers the unified spec opening
 * builder: the 172-field `opening_spec_field` dictionary (+ machine field paths
 * from `spec_field_mapping`), `product_family` series, `option_definition`
 * codes, the hardware set templates / prep crosswalk, and hardware variants
 * (with prices) for variant selection.
 */

import { supabase } from './supabase';
import type {
  OpeningSpecField,
  SpecFieldMapping,
  ProductFamily,
  OptionDefinition,
  ProductEntityType,
  SpecFieldEntity,
  HardwareVariant,
  HardwarePrice,
} from '@/types';

export interface SpecFieldWithPath extends OpeningSpecField {
  /** Machine field path from spec_field_mapping (e.g. door.door_series_construction). */
  fieldPath: string | null;
  /** Parsed enum options from allowed_values (";"-separated), when an Enum. */
  enumOptions: string[];
}

function parseEnum(dataType: string | null, allowed: string | null): string[] {
  if (!allowed) return [];
  const isEnum = (dataType ?? '').toLowerCase().includes('enum') || (dataType ?? '').toLowerCase().includes('bool');
  if (!isEnum) return [];
  return allowed
    .split(/[;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function mapSpecField(row: Record<string, unknown>, pathByFieldId: Map<string, string>): SpecFieldWithPath {
  const dataType = (row.data_type as string | null) ?? null;
  const allowed = (row.allowed_values as string | null) ?? null;
  const fieldId = row.field_id as string;
  return {
    id: row.id as string,
    fieldId,
    entity: row.entity as SpecFieldEntity,
    category: (row.category as string | null) ?? null,
    fieldLabel: row.field_label as string,
    dataType,
    requiredWhen: (row.required_when as string | null) ?? null,
    allowedValues: allowed,
    pricingLogic: (row.pricing_logic as string | null) ?? null,
    pdfPages: (row.pdf_pages as string | null) ?? null,
    pricedBy: (row.priced_by as string | null) ?? null,
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    fieldPath: pathByFieldId.get(fieldId) ?? null,
    enumOptions: parseEnum(dataType, allowed),
  };
}

/** Loads the spec-field dictionary joined with machine paths, grouped by entity. */
export async function loadSpecFieldDictionary(): Promise<{
  fields: SpecFieldWithPath[];
  byEntity: Map<SpecFieldEntity, SpecFieldWithPath[]>;
  mappings: SpecFieldMapping[];
}> {
  const [{ data: fieldRows, error: fErr }, { data: mapRows, error: mErr }] = await Promise.all([
    supabase.from('opening_spec_field').select('*').order('sort_order', { ascending: true }),
    supabase.from('spec_field_mapping').select('*'),
  ]);
  if (fErr) throw new Error(`Failed to load spec fields: ${fErr.message}`);
  if (mErr) throw new Error(`Failed to load spec field mappings: ${mErr.message}`);

  const mappings: SpecFieldMapping[] = (mapRows ?? []).map((r) => ({
    id: r.id as string,
    fieldId: r.field_id as string,
    fieldPath: r.field_path as string,
    valueType: (r.value_type as SpecFieldMapping['valueType']) ?? null,
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
  const pathByFieldId = new Map(mappings.map((m) => [m.fieldId, m.fieldPath]));

  const fields = (fieldRows ?? []).map((r) => mapSpecField(r as Record<string, unknown>, pathByFieldId));
  const byEntity = new Map<SpecFieldEntity, SpecFieldWithPath[]>();
  for (const f of fields) {
    const list = byEntity.get(f.entity) ?? [];
    list.push(f);
    byEntity.set(f.entity, list);
  }
  return { fields, byEntity, mappings };
}

/** Loads product families grouped by entity (door / frame / panel …). */
export async function loadProductFamilies(): Promise<Map<ProductEntityType, ProductFamily[]>> {
  const { data, error } = await supabase.from('product_family').select('*').order('family_code', { ascending: true });
  if (error) throw new Error(`Failed to load product families: ${error.message}`);
  const byEntity = new Map<ProductEntityType, ProductFamily[]>();
  for (const r of data ?? []) {
    const fam: ProductFamily = {
      id: r.id as string,
      priceBookId: (r.price_book_id as string | null) ?? null,
      entityType: r.entity_type as ProductEntityType,
      familyCode: r.family_code as string,
      name: (r.name as string | null) ?? null,
      defaultAttributes: (r.default_attributes as Record<string, unknown>) ?? {},
      description: (r.description as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
    const list = byEntity.get(fam.entityType) ?? [];
    list.push(fam);
    byEntity.set(fam.entityType, list);
  }
  return byEntity;
}

/** Loads option definitions grouped by entity, for code-based selectors. */
export async function loadOptionDefinitions(): Promise<Map<string, OptionDefinition[]>> {
  const { data, error } = await supabase.from('option_definition').select('*').order('code', { ascending: true });
  if (error) throw new Error(`Failed to load option definitions: ${error.message}`);
  const byEntity = new Map<string, OptionDefinition[]>();
  for (const r of data ?? []) {
    const opt: OptionDefinition = {
      id: r.id as string,
      entityType: r.entity_type as OptionDefinition['entityType'],
      category: (r.category as string | null) ?? null,
      featureNumber: (r.feature_number as string | null) ?? null,
      code: r.code as string,
      description: (r.description as string | null) ?? null,
      templateRequired: (r.template_required as boolean) ?? false,
      handRequired: (r.hand_required as boolean) ?? false,
      pdfPages: (r.pdf_pages as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
    const list = byEntity.get(opt.entityType) ?? [];
    list.push(opt);
    byEntity.set(opt.entityType, list);
  }
  return byEntity;
}

/**
 * Loads `option_definition` descriptions into a lookup keyed by entity then by
 * upper-cased code, e.g. descriptors.get('door').get('H') -> "Honeycomb core…".
 * Powers the abbreviation + meaning labels in the builder dropdowns.
 */
export async function loadOptionDescriptors(): Promise<Map<string, Map<string, string>>> {
  const { data, error } = await supabase
    .from('option_definition')
    .select('entity_type, code, description');
  if (error) throw new Error(`Failed to load option descriptors: ${error.message}`);
  const byEntity = new Map<string, Map<string, string>>();
  for (const r of data ?? []) {
    const entity = (r.entity_type as string | null) ?? '';
    const code = (r.code as string | null)?.trim();
    const desc = (r.description as string | null)?.trim();
    if (!entity || !code || !desc) continue;
    let map = byEntity.get(entity);
    if (!map) {
      map = new Map<string, string>();
      byEntity.set(entity, map);
    }
    const key = code.toUpperCase();
    // Keep the first (shortest-context) description for a code.
    if (!map.has(key)) map.set(key, desc);
  }
  return byEntity;
}

export interface VariantOption {
  variant: HardwareVariant;
  price: HardwarePrice | null;
  productDescription: string | null;
}

/**
 * One approved base-price rule reduced to its enumerable EQ/IN constraints
 * (series / material / gauge / etc.) keyed by field_path. Used to drive
 * cascading "only priceable" filtering of the door/frame/panel dropdowns so a
 * non-expert can only pick combinations that actually have a published price.
 */
export type BaseSignature = Record<string, string>;
export type BaseSignatures = Record<string, BaseSignature[]>; // entity -> signatures

/** Resolves the published document that actually carries door base prices. */
async function resolveBaseDocId(): Promise<string | null> {
  const { data } = await supabase
    .from('price_rule')
    .select('price_book_id, price_book_document!inner(status, effective_date)')
    .eq('entity_type', 'door')
    .eq('action_type', 'BASE_AMOUNT')
    .eq('review_status', 'APPROVED')
    .eq('price_book_document.status', 'published')
    .order('effective_date', { ascending: false, foreignTable: 'price_book_document', nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data?.price_book_id as string | undefined) ?? null;
}

/**
 * Loads the enumerable constraint signatures of every approved base rule (door /
 * frame / panel) from the active base book. Dimension/numeric conditions are
 * skipped (those are free-entry, matched by range), leaving the discrete picks
 * (series, material, gauge, …) the builder should constrain.
 */
export async function loadBaseSignatures(): Promise<BaseSignatures> {
  const out: BaseSignatures = { door: [], frame: [], panel: [] };
  const docId = await resolveBaseDocId();
  if (!docId) return out;
  const { data, error } = await supabase
    .from('price_rule')
    .select('entity_type, rule_condition(field_path, operator, value_1, value_type)')
    .eq('price_book_id', docId)
    .eq('action_type', 'BASE_AMOUNT')
    .eq('review_status', 'APPROVED')
    .in('entity_type', ['door', 'frame', 'panel']);
  if (error) throw new Error(`Failed to load base signatures: ${error.message}`);
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>;
    const et = row.entity_type as string;
    if (!out[et]) continue;
    const sig: BaseSignature = {};
    for (const c of (row.rule_condition as Record<string, unknown>[] | undefined) ?? []) {
      const fp = c.field_path as string | null;
      const op = c.operator as string | null;
      const v1 = c.value_1 as string | null;
      if (!fp || !v1) continue;
      // Only discrete constraints (EQ/IN) — range conditions (width/height LTE/
      // BETWEEN) are free-entry and matched numerically, so they're excluded by
      // the operator filter. EQ dimension fields (e.g. jamb depth 8 3/4) ARE
      // discrete picks and must be captured.
      if (op !== 'EQ' && op !== 'IN') continue;
      // Take the first listed value of an IN list as the canonical key (rules are
      // typically single-valued EQ here).
      sig[fp] = String(v1).split(/[|,]/)[0].trim();
    }
    if (Object.keys(sig).length > 0) out[et].push(sig);
  }
  return out;
}

export interface HardwareCategoryOption {
  category: string;
  label: string;
  variantCount: number;
}

/**
 * Lists the hardware categories that actually have catalog variants, so the
 * builder can offer individual hardware selection (independent of any set
 * template). Categories with no variants are omitted (nothing to price).
 */
export async function loadHardwareCategories(): Promise<HardwareCategoryOption[]> {
  const { data, error } = await supabase
    .from('hardware_variant')
    .select('hardware_product!inner(category)');
  if (error) throw new Error(`Failed to load hardware categories: ${error.message}`);
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const cat = ((r as Record<string, unknown>).hardware_product as { category?: string | null } | null)?.category;
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, variantCount]) => ({
      category,
      label: category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      variantCount,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Loads selectable hardware variants for a canonical category, with their
 * current approved price. Used by the hardware step to filter by
 * function/finish/size/rating/hand.
 */
export async function loadVariantsForCategory(category: string): Promise<VariantOption[]> {
  const { data, error } = await supabase
    .from('hardware_variant')
    .select('*, hardware_product!inner(category, description), hardware_price(*)')
    .eq('hardware_product.category', category);
  if (error) throw new Error(`Failed to load variants for ${category}: ${error.message}`);

  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const product = row.hardware_product as { description?: string | null } | null;
    const prices = (row.hardware_price as Record<string, unknown>[] | undefined) ?? [];
    const approved = prices.find((p) => p.review_status === 'APPROVED') ?? prices[0];
    return {
      variant: {
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
      },
      price: approved
        ? {
            id: approved.id as string,
            hardwareVariantId: approved.hardware_variant_id as string,
            hardwarePriceBookId: (approved.hardware_price_book_id as string | null) ?? null,
            listPrice: approved.list_price != null ? Number(approved.list_price) : null,
            discountMultiplier: approved.discount_multiplier != null ? Number(approved.discount_multiplier) : null,
            netCost: approved.net_cost != null ? Number(approved.net_cost) : null,
            uom: (approved.uom as string) ?? 'each',
            effectiveFrom: (approved.effective_from as string | null) ?? null,
            effectiveTo: (approved.effective_to as string | null) ?? null,
            minimumQuantity: approved.minimum_quantity != null ? Number(approved.minimum_quantity) : null,
            sourceRowRef: (approved.source_row_ref as string | null) ?? null,
            reviewStatus: approved.review_status as HardwarePrice['reviewStatus'],
            createdAt: approved.created_at as string,
            updatedAt: approved.updated_at as string,
          }
        : null,
      productDescription: product?.description ?? null,
    };
  });
}
