/**
 * NGP infill catalog API.
 *
 * Loads the NGP glass / lite-kit / louver compatibility catalog (the `ngp_*`
 * tables) for the active published NGP price_book_document. This is the data the
 * pure `ngp-infill.ts` logic consumes to auto-filter kits, auto-select glazing
 * tape and glass, validate ratings, and decide bundling. The dimensional price
 * matrices themselves live in `price_rule` (loaded by the pricing engine).
 */

import { supabase } from './supabase';
import type {
  NgpProduct,
  NgpKitGlassCapacity,
  NgpGlassRating,
  NgpSizeRule,
  NgpRelationship,
  NgpFinishCode,
  NgpOption,
  NgpCommercialPolicy,
  NgpPriceTableMap,
} from '@/types';

export interface NgpCatalog {
  documentId: string | null;
  products: NgpProduct[];
  capacities: NgpKitGlassCapacity[];
  ratings: NgpGlassRating[];
  sizeRules: NgpSizeRule[];
  relationships: NgpRelationship[];
  finishCodes: NgpFinishCode[];
  options: NgpOption[];
  commercialPolicies: NgpCommercialPolicy[];
  tableMaps: NgpPriceTableMap[];
}

export function emptyNgpCatalog(): NgpCatalog {
  return {
    documentId: null,
    products: [],
    capacities: [],
    ratings: [],
    sizeRules: [],
    relationships: [],
    finishCodes: [],
    options: [],
    commercialPolicies: [],
    tableMaps: [],
  };
}

/**
 * Resolves the active published NGP price_book_document: the latest published
 * document that has at least one NGP catalog product. Returns null when no NGP
 * catalog has been published yet.
 */
export async function resolveActiveNgpDocument(): Promise<string | null> {
  const { data, error } = await supabase
    .from('ngp_product')
    .select('price_book_document_id, price_book_document!inner(id, status, source_verified, effective_date)')
    .eq('price_book_document.status', 'published')
    .eq('price_book_document.source_verified', true)
    .order('effective_date', { ascending: false, foreignTable: 'price_book_document' })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data?.price_book_document_id as string | undefined) ?? null;
}

function n(v: unknown): number | null {
  return v == null ? null : Number(v);
}

function mapProduct(r: Record<string, unknown>): NgpProduct {
  return {
    id: r.id as string,
    priceBookDocumentId: (r.price_book_document_id as string | null) ?? null,
    productId: r.product_id as string,
    manufacturer: (r.manufacturer as string | null) ?? null,
    category: r.category as string,
    subcategory: (r.subcategory as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    modelAliases: (r.model_aliases as string | null) ?? null,
    productName: (r.product_name as string | null) ?? null,
    material: (r.material as string | null) ?? null,
    standardFinish: (r.standard_finish as string | null) ?? null,
    doorThicknessMinIn: n(r.door_thickness_min_in),
    doorThicknessMaxIn: n(r.door_thickness_max_in),
    glassThicknessMinIn: n(r.glass_thickness_min_in),
    glassThicknessMaxIn: n(r.glass_thickness_max_in),
    fireRatingMax: n(r.fire_rating_max),
    preferredPriceUom: (r.preferred_price_uom as string | null) ?? null,
    glassScope: (r.glass_scope as string | null) ?? null,
    active: (r.active as boolean) ?? true,
    sourcePage: (r.source_page as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/**
 * Loads the full NGP catalog for a document (or the active published NGP
 * document when `documentId` is omitted). Returns an empty catalog when none.
 */
export async function loadNgpCatalog(documentId?: string | null): Promise<NgpCatalog> {
  const docId = documentId ?? (await resolveActiveNgpDocument());
  if (!docId) return emptyNgpCatalog();

  const [products, capacities, ratings, sizeRules, relationships, finishCodes, options, policies, maps] =
    await Promise.all([
      supabase.from('ngp_product').select('*').eq('price_book_document_id', docId).eq('active', true),
      supabase.from('ngp_kit_glass_capacity').select('*').eq('price_book_document_id', docId),
      supabase.from('ngp_glass_rating').select('*').eq('price_book_document_id', docId),
      supabase.from('ngp_size_rule').select('*').eq('price_book_document_id', docId),
      supabase.from('ngp_relationship').select('*').eq('price_book_document_id', docId),
      supabase.from('ngp_finish_code').select('*').eq('price_book_document_id', docId),
      supabase.from('ngp_option').select('*').eq('price_book_document_id', docId),
      supabase.from('ngp_commercial_policy').select('*').eq('price_book_document_id', docId),
      supabase.from('ngp_price_table_map').select('*').eq('price_book_document_id', docId),
    ]);

  return {
    documentId: docId,
    products: (products.data ?? []).map((r) => mapProduct(r as Record<string, unknown>)),
    capacities: (capacities.data ?? []).map((r) => ({
      id: r.id as string,
      priceBookDocumentId: (r.price_book_document_id as string | null) ?? null,
      capacityId: (r.capacity_id as string | null) ?? null,
      kitModel: r.kit_model as string,
      doorThicknessIn: n(r.door_thickness_in),
      glassThicknessIn: n(r.glass_thickness_in),
      requiredTapeModel: (r.required_tape_model as string | null) ?? null,
      profileGroup: (r.profile_group as string | null) ?? null,
      allowed: (r.allowed as boolean) ?? true,
      sourcePage: (r.source_page as string | null) ?? null,
    })),
    ratings: (ratings.data ?? []).map((r) => ({
      id: r.id as string,
      priceBookDocumentId: (r.price_book_document_id as string | null) ?? null,
      ratingId: (r.rating_id as string | null) ?? null,
      glassModel: r.glass_model as string,
      fireMinutes: (r.fire_minutes as string | null) ?? null,
      application: (r.application as string | null) ?? null,
      maxVisibleAreaSqIn: n(r.max_visible_area_sq_in),
      maxVisibleWidthIn: n(r.max_visible_width_in),
      maxVisibleHeightIn: n(r.max_visible_height_in),
      sourcePage: (r.source_page as string | null) ?? null,
    })),
    sizeRules: (sizeRules.data ?? []).map((r) => ({
      id: r.id as string,
      priceBookDocumentId: (r.price_book_document_id as string | null) ?? null,
      sizeRuleId: (r.size_rule_id as string | null) ?? null,
      modelOrFamily: r.model_or_family as string,
      outputField: r.output_field as string,
      operator: (r.operator as string | null) ?? null,
      value: n(r.value),
      unit: (r.unit as string | null) ?? null,
      inputBasis: (r.input_basis as string | null) ?? null,
      sourcePage: (r.source_page as string | null) ?? null,
    })),
    relationships: (relationships.data ?? []).map((r) => ({
      id: r.id as string,
      priceBookDocumentId: (r.price_book_document_id as string | null) ?? null,
      relationshipId: (r.relationship_id as string | null) ?? null,
      sourceModel: (r.source_model as string | null) ?? null,
      targetModel: (r.target_model as string | null) ?? null,
      relationshipType: r.relationship_type as string,
      rule: (r.rule as string | null) ?? null,
      inclusionScope: (r.inclusion_scope as string | null) ?? null,
      confidence: (r.confidence as string | null) ?? null,
      sourcePage: (r.source_page as string | null) ?? null,
    })),
    finishCodes: (finishCodes.data ?? []).map((r) => ({
      id: r.id as string,
      priceBookDocumentId: (r.price_book_document_id as string | null) ?? null,
      finishCode: r.finish_code as string,
      finishName: (r.finish_name as string | null) ?? null,
      availability: (r.availability as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
    })),
    options: (options.data ?? []).map((r) => ({
      id: r.id as string,
      priceBookDocumentId: (r.price_book_document_id as string | null) ?? null,
      optionId: (r.option_id as string | null) ?? null,
      appliesTo: (r.applies_to as string | null) ?? null,
      optionCode: (r.option_code as string | null) ?? null,
      optionName: (r.option_name as string | null) ?? null,
      optionType: (r.option_type as string | null) ?? null,
      requirements: (r.requirements as string | null) ?? null,
      exclusions: (r.exclusions as string | null) ?? null,
      pricingStatus: (r.pricing_status as string | null) ?? null,
      priceRuleId: (r.price_rule_id as string | null) ?? null,
      sourcePage: (r.source_page as string | null) ?? null,
    })),
    commercialPolicies: (policies.data ?? []).map((r) => ({
      id: r.id as string,
      priceBookDocumentId: (r.price_book_document_id as string | null) ?? null,
      policyId: (r.policy_id as string | null) ?? null,
      policyType: r.policy_type as string,
      description: (r.description as string | null) ?? null,
      basis: (r.basis as string | null) ?? null,
      amountOrThreshold: n(r.amount_or_threshold),
      unit: (r.unit as string | null) ?? null,
      condition: (r.condition as string | null) ?? null,
      sourcePage: (r.source_page as string | null) ?? null,
    })),
    tableMaps: (maps.data ?? []).map((r) => ({
      id: r.id as string,
      priceBookDocumentId: (r.price_book_document_id as string | null) ?? null,
      mapId: (r.map_id as string | null) ?? null,
      ngpPriceTableId: r.ngp_price_table_id as string,
      priceTableId: (r.price_table_id as string | null) ?? null,
      model: r.model as string,
      relationship: (r.relationship as string | null) ?? null,
      multiplier: n(r.multiplier),
      condition: (r.condition as string | null) ?? null,
      includedScope: (r.included_scope as string | null) ?? null,
      glassModel: (r.glass_model as string | null) ?? null,
      tapeModel: (r.tape_model as string | null) ?? null,
      entityType: (r.entity_type as string | null) ?? null,
      sourcePage: (r.source_page as string | null) ?? null,
    })),
  };
}
