/**
 * Unified spec-builder persistence (Phase 4).
 *
 * Saves an OpeningDraft into the canonical model: the opening, its components
 * (estimate_items + item_fields, so existing estimate views still resolve), the
 * selected hardware (opening_hardware_item referencing hardware_variant), the
 * keying schedule + access-control bundle, and the engine's auditable lines
 * (estimate_line via the rule engine) + manual-quote routes.
 *
 * Phase 6: also writes the full OpeningDraft as spec_snapshot on estimate_openings
 * so edits can be faithfully rehydrated and re-priced without lossy reconstruction.
 */

import { supabase } from '@/lib/supabase';
import {
  addEstimateItem,
  addItemField,
  deleteEstimateItem,
} from '@/lib/estimates-api';
import { priceOpening, type EngineOptions } from '@/lib/pricing';
import {
  buildNormalizedSpec,
  resolveComponentFields,
  componentCode,
  createCutoutDraft,
  createOpeningDraft,
  type OpeningDraft,
  type ComponentDraft,
  type CutoutDraft,
} from './opening-spec';
import { deriveBuilderContext, type BuilderContext } from './builder-logic';
import type { NgpCatalog } from '@/lib/ngp-catalog-api';
import { RESOLVER_VERSION, type EstimateOpening, type SpecFieldMapping } from '@/types';
import type { NgpInfillType } from './ngp-infill';

async function saveComponentItems(
  estimateId: string,
  openingId: string,
  components: ComponentDraft[],
  startSort: number,
  ctx: BuilderContext,
  componentIdMap: Map<string, string>,
): Promise<void> {
  let sort = startSort;
  for (const comp of components) {
    const code = componentCode(comp, ctx.derivedByComponent[comp.id]);
    const created = await addEstimateItem(estimateId, {
      itemLabel: comp.label || code || comp.entityType,
      canonicalCode: code ?? comp.label ?? comp.entityType,
      quantity: Math.max(1, comp.quantity),
      sortOrder: sort++,
      openingId,
      parentItemId: null,
      itemType: comp.entityType,
      manufacturerId: comp.manufacturerId ?? null,
    });
    // Record draft-id -> real estimate_items.id so engine lines persist a valid
    // component_id FK (instead of null) — the spec component keeps its draft id.
    componentIdMap.set(comp.id, created.id);
    // Persist the EFFECTIVE fields (builder-derived overlaid by overrides) so the
    // saved record matches exactly what the engine priced.
    const effective = resolveComponentFields(comp, ctx.derivedByComponent[comp.id]);
    for (const [path, value] of Object.entries(effective)) {
      if (!value) continue;
      await addItemField(created.id, {
        fieldKey: path,
        fieldLabel: path.split('.').pop() ?? path,
        fieldValue: value,
        valueType: 'string',
      });
    }
  }
}

/** Persists the NGP infill cutouts for an opening (selections, not resolved lines). */
async function saveOpeningCutouts(estimateId: string, openingId: string, cutouts: CutoutDraft[]): Promise<void> {
  const rows = cutouts
    .filter((c) => c.infillType !== 'NONE')
    .map((c, i) => ({
      opening_id: openingId,
      estimate_id: estimateId,
      door_ref: c.doorId,
      infill_type: c.infillType,
      cutout_width: c.cutoutWidth || null,
      cutout_height: c.cutoutHeight || null,
      door_thickness_in: c.doorThicknessIn,
      fire_rating_minutes: c.fireRatingMinutes,
      kit_model: c.kitModel,
      louver_model: c.louverModel,
      glass_model: c.glassModel,
      tape_model: c.tapeModel,
      glass_thickness_in: c.glassThicknessIn,
      finish_code: c.finishCode,
      option_codes: c.optionCodes ?? [],
      prefer_assembly: c.preferAssembly,
      sort_order: i,
    }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('opening_cutout').insert(rows);
  if (error) throw new Error(`Failed to save cutouts: ${error.message}`);
}

/** Loads persisted NGP cutouts for an opening back into draft form (for edit). */
export async function loadOpeningCutouts(openingId: string): Promise<CutoutDraft[]> {
  const { data, error } = await supabase
    .from('opening_cutout')
    .select('*')
    .eq('opening_id', openingId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Failed to load cutouts: ${error.message}`);
  return (data ?? []).map((r) => createCutoutDraft({
    id: r.id as string,
    doorId: (r.door_ref as string | null) ?? null,
    infillType: (r.infill_type as NgpInfillType) ?? 'LITE',
    cutoutWidth: (r.cutout_width as string | null) ?? '',
    cutoutHeight: (r.cutout_height as string | null) ?? '',
    doorThicknessIn: r.door_thickness_in != null ? Number(r.door_thickness_in) : null,
    fireRatingMinutes: r.fire_rating_minutes != null ? Number(r.fire_rating_minutes) : null,
    kitModel: (r.kit_model as string | null) ?? null,
    louverModel: (r.louver_model as string | null) ?? null,
    glassModel: (r.glass_model as string | null) ?? null,
    tapeModel: (r.tape_model as string | null) ?? null,
    glassThicknessIn: r.glass_thickness_in != null ? Number(r.glass_thickness_in) : null,
    finishCode: (r.finish_code as string | null) ?? null,
    optionCodes: Array.isArray(r.option_codes) ? (r.option_codes as string[]) : [],
    preferAssembly: (r.prefer_assembly as boolean) ?? true,
  }));
}

export interface SaveDraftResult {
  opening: EstimateOpening;
}

// ---------------------------------------------------------------------------
// Snapshot persistence helpers
// ---------------------------------------------------------------------------

/** Creates a new estimate opening row, storing the draft spec snapshot. */
async function createEstimateOpeningWithSnapshot(
  estimateId: string,
  name: string,
  quantity: number,
  draft: OpeningDraft,
): Promise<EstimateOpening> {
  const { count } = await supabase
    .from('estimate_openings')
    .select('id', { count: 'exact', head: true })
    .eq('estimate_id', estimateId);

  const { data, error } = await supabase
    .from('estimate_openings')
    .insert({
      estimate_id: estimateId,
      name,
      quantity,
      sort_order: count ?? 0,
      spec_snapshot: draft,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create opening with snapshot: ${error.message}`);
  return mapOpeningRow(data as Record<string, unknown>);
}

/** Updates name/quantity and overwrites the spec snapshot on an existing opening. */
async function updateEstimateOpeningWithSnapshot(
  id: string,
  name: string,
  quantity: number,
  draft: OpeningDraft,
): Promise<EstimateOpening> {
  const { data, error } = await supabase
    .from('estimate_openings')
    .update({ name, quantity, spec_snapshot: draft })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update opening with snapshot: ${error.message}`);
  return mapOpeningRow(data as Record<string, unknown>);
}

function mapOpeningRow(r: Record<string, unknown>): EstimateOpening {
  return {
    id: r.id as string,
    estimateId: r.estimate_id as string,
    name: r.name as string,
    quantity: (r.quantity as number) ?? 1,
    sortOrder: (r.sort_order as number) ?? 0,
    templateType: (r.template_type as EstimateOpening['templateType']) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/**
 * Loads the full OpeningDraft for an opening. If a `spec_snapshot` was written
 * by the spec builder, it is returned directly (faithful round-trip). Otherwise
 * the function falls back to a lossy reconstruction from `estimate_items` +
 * `item_fields` + `opening_hardware_item` for legacy openings.
 */
export async function loadOpeningDraft(openingId: string): Promise<OpeningDraft | null> {
  // 1. Try the snapshot first.
  const { data: openingRow, error: openingErr } = await supabase
    .from('estimate_openings')
    .select('id, estimate_id, name, quantity, spec_snapshot')
    .eq('id', openingId)
    .single();
  if (openingErr || !openingRow) return null;

  if (openingRow.spec_snapshot) {
    try {
      const snap = openingRow.spec_snapshot as OpeningDraft;
      // Restore the live opening id/estimateId so the draft targets the right rows.
      return createOpeningDraft({
        ...snap,
        openingId,
        estimateId: openingRow.estimate_id as string,
        name: openingRow.name as string,
        quantity: openingRow.quantity as number,
      });
    } catch {
      // Fall through to lossy reconstruction if the snapshot is malformed.
    }
  }

  // 2. Lossy reconstruction from estimate_items + item_fields.
  const { data: items } = await supabase
    .from('estimate_items')
    .select('id, item_label, canonical_code, quantity, item_type, manufacturer_id, item_fields(*)')
    .eq('opening_id', openingId)
    .is('parent_item_id', null)
    .order('sort_order', { ascending: true });

  const { data: hwItems } = await supabase
    .from('opening_hardware_item')
    .select('category, hardware_variant_id, quantity, selected_finish, selected_function, selected_hand, source')
    .eq('opening_id', openingId);

  const doors: ComponentDraft[] = [];
  const frames: ComponentDraft[] = [];
  const panels: ComponentDraft[] = [];
  const lites: ComponentDraft[] = [];

  for (const item of items ?? []) {
    const fields: Record<string, string> = {};
    for (const f of (item.item_fields as Array<{ field_key: string; field_value: string }> ?? [])) {
      if (f.field_value) fields[f.field_key] = f.field_value;
    }
    const comp: ComponentDraft = {
      id: item.id as string,
      entityType: (() => {
        switch (item.item_type) {
          case 'door':
          case 'doors': return 'door';
          case 'frame':
          case 'frames': return 'frame';
          case 'panel':
          case 'panels': return 'panel';
          default: return 'specialty';
        }
      })(),
      label: item.item_label as string,
      familyCode: (item.canonical_code as string | null) ?? null,
      quantity: Math.max(1, (item.quantity as number) ?? 1),
      manufacturerId: (item.manufacturer_id as string | null) ?? null,
      priceBookDocumentId: null,
      fields,
    };
    if (comp.entityType === 'door') doors.push(comp);
    else if (comp.entityType === 'frame') frames.push(comp);
    else if (comp.entityType === 'panel') panels.push(comp);
    else lites.push(comp);
  }

  const hardware = (hwItems ?? []).map((h) => ({
    category: h.category as string,
    variantId: (h.hardware_variant_id as string | null) ?? null,
    quantity: Math.max(1, (h.quantity as number) ?? 1),
    required: false,
    selectedFinish: (h.selected_finish as string | null) ?? null,
    selectedFunction: (h.selected_function as string | null) ?? null,
    selectedHand: (h.selected_hand as string | null) ?? null,
    source: (h.source as 'set_template' | 'manual') ?? 'manual',
  }));

  // Reload cutouts (already done separately in SpecOpeningBuilder — included
  // here for completeness so loadOpeningDraft returns a fully usable draft).
  const cutouts = await loadOpeningCutouts(openingId);

  return createOpeningDraft({
    openingId,
    estimateId: openingRow.estimate_id as string,
    name: openingRow.name as string,
    quantity: openingRow.quantity as number,
    doors: doors.length ? doors : [{ id: `c${Date.now()}`, entityType: 'door', label: 'Door', familyCode: null, quantity: 1, manufacturerId: null, priceBookDocumentId: null, fields: {} }],
    frames: frames.length ? frames : [{ id: `c${Date.now() + 1}`, entityType: 'frame', label: 'Frame', familyCode: null, quantity: 1, manufacturerId: null, priceBookDocumentId: null, fields: {} }],
    panels,
    lites,
    hardware,
    cutouts,
  });
}

// ---------------------------------------------------------------------------
// Save pipeline
// ---------------------------------------------------------------------------

/**
 * Persists a draft opening end-to-end. `existingOpeningId` (edit mode) clears the
 * prior items/hardware/lines first so the save is a clean replace.
 */
export async function saveOpeningDraft(
  estimateId: string,
  draft: OpeningDraft,
  mappings: SpecFieldMapping[],
  options: Omit<EngineOptions, 'persist'>,
  existingOpeningId?: string | null,
  ngpCatalog?: NgpCatalog | null,
): Promise<SaveDraftResult> {
  let opening: EstimateOpening;
  if (existingOpeningId) {
    opening = await updateEstimateOpeningWithSnapshot(existingOpeningId, draft.name.trim(), draft.quantity, draft);
    // Clear prior children for a clean replace.
    const { data: items } = await supabase.from('estimate_items').select('id').eq('opening_id', existingOpeningId);
    for (const it of items ?? []) await deleteEstimateItem(it.id as string);
    await supabase.from('opening_hardware_item').delete().eq('opening_id', existingOpeningId);
    await supabase.from('access_control_bundle').delete().eq('opening_id', existingOpeningId);
    await supabase.from('opening_cutout').delete().eq('opening_id', existingOpeningId);
    await supabase.from('estimate_line').delete().eq('opening_id', existingOpeningId);
  } else {
    opening = await createEstimateOpeningWithSnapshot(estimateId, draft.name.trim(), draft.quantity, draft);
  }

  // Components → estimate_items + item_fields (effective, builder-derived fields).
  // Collect draft-id → real estimate_items.id so engine lines persist a valid
  // component_id (deterministic save, plan Phase 5).
  const ctx = deriveBuilderContext(draft);
  const componentIdMap = new Map<string, string>();
  await saveComponentItems(estimateId, opening.id, draft.doors.map((d) => ({ ...d, entityType: 'door' as const })), 0, ctx, componentIdMap);
  await saveComponentItems(estimateId, opening.id, draft.frames.map((d) => ({ ...d, entityType: 'frame' as const })), 100, ctx, componentIdMap);
  await saveComponentItems(estimateId, opening.id, draft.panels.map((d) => ({ ...d, entityType: 'panel' as const })), 200, ctx, componentIdMap);
  await saveComponentItems(estimateId, opening.id, draft.lites.map((d) => ({ ...d, entityType: 'specialty' as const })), 300, ctx, componentIdMap);

  // Hardware → opening_hardware_item.
  const hwRows = draft.hardware
    .filter((h) => h.quantity > 0)
    .map((h) => ({
      opening_id: opening.id,
      estimate_id: estimateId,
      hardware_variant_id: h.variantId,
      category: h.category,
      quantity: h.quantity,
      selected_finish: h.selectedFinish ?? null,
      selected_function: h.selectedFunction ?? null,
      selected_hand: h.selectedHand ?? null,
      source: h.source ?? 'manual',
    }));
  if (hwRows.length > 0) {
    const { error } = await supabase.from('opening_hardware_item').insert(hwRows);
    if (error) throw new Error(`Failed to save hardware items: ${error.message}`);
  }

  // Keying schedule (estimate-scoped). Upsert instead of blind insert so repeated
  // saves don't accumulate duplicate keying rows (plan Phase 5).
  if (draft.keying) {
    const keyingRow = {
      estimate_id: estimateId,
      format: draft.keying.format,
      keyway: draft.keying.keyway,
      master_key_hierarchy: draft.keying.masterKeyHierarchy ?? null,
      construction_core_strategy: draft.keying.constructionCoreStrategy ?? null,
      notes: draft.keying.notes ?? null,
    };
    const { data: existingKeying } = await supabase
      .from('keying_schedule')
      .select('id')
      .eq('estimate_id', estimateId)
      .limit(1)
      .maybeSingle();
    if (existingKeying?.id) {
      await supabase.from('keying_schedule').update(keyingRow).eq('id', existingKeying.id as string);
    } else {
      await supabase.from('keying_schedule').insert(keyingRow);
    }
  }

  // Access-control bundle.
  if (draft.accessControl) {
    const ac = draft.accessControl;
    await supabase.from('access_control_bundle').insert({
      opening_id: opening.id,
      estimate_id: estimateId,
      reader: ac.reader ?? null,
      lock_strike: ac.lockStrike ?? null,
      power_transfer: ac.powerTransfer ?? null,
      power_supply: ac.powerSupply ?? null,
      dps: ac.dps ?? null,
      panel_io: ac.panelIo ?? null,
      cable_requirements: ac.cableRequirements ?? null,
      components: ac.components ?? {},
      notes: ac.notes ?? null,
    });
  }

  // NGP infill cutouts (selections) so the build round-trips on edit.
  await saveOpeningCutouts(estimateId, opening.id, draft.cutouts ?? []);

  // Auditable engine lines (+ manual-quote routes) via the rule engine. The NGP
  // catalog expands cutouts into priceable lite_kit/glass/tape/louver components.
  const spec = buildNormalizedSpec(
    { ...draft, openingId: opening.id, estimateId },
    mappings,
    ngpCatalog ?? null,
  );
  await priceOpening(spec, { ...options, persist: true, componentIdMap });

  // Pin the price book + as-of date on the estimate and snapshot a resolution
  // revision so reprice is deterministic and the audit trail is retained.
  await pinEstimatePricing(estimateId, options);
  await writeResolutionRevision(opening.id, estimateId, draft, options);

  // Keep estimates.total_price in sync so the estimates list always shows a
  // current total — even before the user reaches "Save & Finish".
  await syncEstimateTotal(estimateId);

  return { opening };
}

/**
 * Pins `estimates.price_book_id` + `priced_as_of` so a later reprice uses the
 * SAME document/date instead of re-resolving "latest". Non-fatal.
 */
async function pinEstimatePricing(estimateId: string, options: Omit<EngineOptions, 'persist'>): Promise<void> {
  try {
    const update: Record<string, unknown> = {
      price_book_id: options.priceBookDocumentId ?? null,
    };
    update.priced_as_of = options.pricedAsOf ?? new Date().toISOString().slice(0, 10);
    await supabase.from('estimates').update(update).eq('id', estimateId);
  } catch {
    // Non-fatal — pinning is an optimization, not a correctness requirement.
  }
}

/**
 * Appends an immutable opening_resolution_revision (input spec + pinned
 * versions). Repricing appends a new row, retaining prior revisions for audit.
 * Non-fatal so it never blocks a save.
 */
async function writeResolutionRevision(
  openingId: string,
  estimateId: string,
  draft: OpeningDraft,
  options: Omit<EngineOptions, 'persist'>,
): Promise<void> {
  try {
    const componentPriceBooks = [...draft.doors, ...draft.frames, ...draft.panels]
      .filter((component) => component.manufacturerId || component.priceBookDocumentId)
      .map((component) => ({
        componentId: component.id,
        entityType: component.entityType,
        manufacturerId: component.manufacturerId ?? null,
        priceBookDocumentId: component.priceBookDocumentId ?? null,
      }));
    await supabase.from('opening_resolution_revision').insert({
      opening_id: openingId,
      estimate_id: estimateId,
      resolver_version: RESOLVER_VERSION,
      catalog_version: 'R1',
      price_book_id: options.priceBookDocumentId ?? null,
      priced_as_of: options.pricedAsOf ?? new Date().toISOString().slice(0, 10),
      input_spec: draft as unknown as Record<string, unknown>,
      candidates: [],
      estimator_selection_id: null,
      resolved_config: { componentPriceBooks },
    });
  } catch {
    // Non-fatal — the resolution-revision table may not be provisioned yet.
  }
}

// ---------------------------------------------------------------------------
// Estimate total sync
// ---------------------------------------------------------------------------

/**
 * Re-computes and persists `estimates.total_price` from the current engine
 * lines for the estimate. Called after any opening save or reprice so the
 * estimates list always shows an up-to-date total, even for in-progress
 * estimates that have not yet been through "Save & Finish".
 *
 * Non-fatal: any error is swallowed so it never blocks the save flow.
 */
/** Loads the estimate's pinned price book + as-of date (for deterministic reprice). */
async function loadEstimatePricingPin(estimateId: string): Promise<{ priceBookId: string | null; pricedAsOf: string | null }> {
  try {
    const { data } = await supabase
      .from('estimates')
      .select('price_book_id, priced_as_of')
      .eq('id', estimateId)
      .maybeSingle();
    return {
      priceBookId: (data?.price_book_id as string | null) ?? null,
      pricedAsOf: (data?.priced_as_of as string | null) ?? null,
    };
  } catch {
    return { priceBookId: null, pricedAsOf: null };
  }
}

async function syncEstimateTotal(estimateId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from('estimate_line')
      .select('sell_price')
      .eq('estimate_id', estimateId)
      .is('included_or_suppressed_by', null)
      .neq('line_type', 'INCLUDED');

    const total = (data ?? []).reduce((s, r) => s + ((r.sell_price as number | null) ?? 0), 0);
    await supabase.from('estimates').update({ total_price: total }).eq('id', estimateId);
  } catch {
    // Non-fatal — estimates list will show '--' until the next save.
  }
}

// ---------------------------------------------------------------------------
// Re-pricing
// ---------------------------------------------------------------------------

/**
 * Re-prices a single spec opening through the rule engine without touching the
 * structural tables (estimate_items, hardware, etc.). Loads the draft from the
 * spec_snapshot (or reconstructs it for legacy openings), rebuilds the
 * NormalizedOpeningSpec, and overwrites the opening's estimate_line rows.
 *
 * Returns true if re-pricing ran, false if no draft could be reconstructed
 * (caller should fall back to legacy lookup for those openings).
 */
export async function repriceSpecOpening(
  estimateId: string,
  openingId: string,
  mappings: SpecFieldMapping[],
  options: Omit<EngineOptions, 'persist'>,
  ngpCatalog?: NgpCatalog | null,
): Promise<boolean> {
  const draft = await loadOpeningDraft(openingId);
  if (!draft) return false;

  // Deterministic reprice: use the estimate's PINNED price book + as-of date
  // instead of re-resolving "latest", unless the caller explicitly overrides.
  const pinned = await loadEstimatePricingPin(estimateId);
  const effectiveOptions: Omit<EngineOptions, 'persist'> = {
    ...options,
    priceBookDocumentId: options.priceBookDocumentId ?? pinned.priceBookId,
    pricedAsOf: options.pricedAsOf ?? pinned.pricedAsOf,
  };

  // Clear existing engine lines so the persist writes a clean set.
  await supabase.from('estimate_line').delete().eq('opening_id', openingId);

  const spec = buildNormalizedSpec(
    { ...draft, openingId, estimateId },
    mappings,
    ngpCatalog ?? null,
  );
  await priceOpening(spec, { ...effectiveOptions, persist: true });

  // Keep estimates.total_price in sync so the list view shows a current total.
  await syncEstimateTotal(estimateId);
  return true;
}
