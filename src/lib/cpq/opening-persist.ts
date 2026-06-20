/**
 * Unified spec-builder persistence (Phase 4).
 *
 * Saves an OpeningDraft into the canonical model: the opening, its components
 * (estimate_items + item_fields, so existing estimate views still resolve), the
 * selected hardware (opening_hardware_item referencing hardware_variant), the
 * keying schedule + access-control bundle, and the engine's auditable lines
 * (estimate_line via the rule engine) + manual-quote routes.
 */

import { supabase } from '@/lib/supabase';
import {
  createEstimateOpening,
  updateEstimateOpening,
  addEstimateItem,
  addItemField,
  deleteEstimateItem,
} from '@/lib/estimates-api';
import { priceOpening, type EngineOptions } from '@/lib/pricing';
import { buildNormalizedSpec, resolveComponentFields, componentCode, createCutoutDraft, type OpeningDraft, type ComponentDraft, type CutoutDraft } from './opening-spec';
import { deriveBuilderContext, type BuilderContext } from './builder-logic';
import type { NgpCatalog } from '@/lib/ngp-catalog-api';
import type { EstimateOpening, SpecFieldMapping } from '@/types';
import type { NgpInfillType } from './ngp-infill';

async function saveComponentItems(
  estimateId: string,
  openingId: string,
  components: ComponentDraft[],
  startSort: number,
  ctx: BuilderContext,
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
    });
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
    opening = await updateEstimateOpening(existingOpeningId, { name: draft.name.trim(), quantity: draft.quantity });
    // Clear prior children for a clean replace.
    const { data: items } = await supabase.from('estimate_items').select('id').eq('opening_id', existingOpeningId);
    for (const it of items ?? []) await deleteEstimateItem(it.id as string);
    await supabase.from('opening_hardware_item').delete().eq('opening_id', existingOpeningId);
    await supabase.from('access_control_bundle').delete().eq('opening_id', existingOpeningId);
    await supabase.from('opening_cutout').delete().eq('opening_id', existingOpeningId);
    await supabase.from('estimate_line').delete().eq('opening_id', existingOpeningId);
  } else {
    opening = await createEstimateOpening(estimateId, draft.name.trim(), draft.quantity);
  }

  // Components → estimate_items + item_fields (effective, builder-derived fields).
  const ctx = deriveBuilderContext(draft);
  await saveComponentItems(estimateId, opening.id, draft.doors.map((d) => ({ ...d, entityType: 'door' as const })), 0, ctx);
  await saveComponentItems(estimateId, opening.id, draft.frames.map((d) => ({ ...d, entityType: 'frame' as const })), 100, ctx);
  await saveComponentItems(estimateId, opening.id, draft.panels.map((d) => ({ ...d, entityType: 'panel' as const })), 200, ctx);
  await saveComponentItems(estimateId, opening.id, draft.lites.map((d) => ({ ...d, entityType: 'specialty' as const })), 300, ctx);

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

  // Keying schedule (estimate-scoped).
  if (draft.keying) {
    await supabase.from('keying_schedule').insert({
      estimate_id: estimateId,
      format: draft.keying.format,
      keyway: draft.keying.keyway,
      master_key_hierarchy: draft.keying.masterKeyHierarchy ?? null,
      construction_core_strategy: draft.keying.constructionCoreStrategy ?? null,
      notes: draft.keying.notes ?? null,
    });
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
  await priceOpening(spec, { ...options, persist: true });

  return { opening };
}
