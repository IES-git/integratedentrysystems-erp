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
import { buildNormalizedSpec, type OpeningDraft, type ComponentDraft } from './opening-spec';
import type { EstimateOpening, SpecFieldMapping } from '@/types';

async function saveComponentItems(
  estimateId: string,
  openingId: string,
  components: ComponentDraft[],
  startSort: number,
): Promise<void> {
  let sort = startSort;
  for (const comp of components) {
    const created = await addEstimateItem(estimateId, {
      itemLabel: comp.label || comp.familyCode || comp.entityType,
      canonicalCode: comp.familyCode ?? comp.label ?? comp.entityType,
      quantity: Math.max(1, comp.quantity),
      sortOrder: sort++,
      openingId,
      parentItemId: null,
      itemType: comp.entityType,
    });
    for (const [path, value] of Object.entries(comp.fields)) {
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
): Promise<SaveDraftResult> {
  let opening: EstimateOpening;
  if (existingOpeningId) {
    opening = await updateEstimateOpening(existingOpeningId, { name: draft.name.trim(), quantity: draft.quantity });
    // Clear prior children for a clean replace.
    const { data: items } = await supabase.from('estimate_items').select('id').eq('opening_id', existingOpeningId);
    for (const it of items ?? []) await deleteEstimateItem(it.id as string);
    await supabase.from('opening_hardware_item').delete().eq('opening_id', existingOpeningId);
    await supabase.from('access_control_bundle').delete().eq('opening_id', existingOpeningId);
    await supabase.from('estimate_line').delete().eq('opening_id', existingOpeningId);
  } else {
    opening = await createEstimateOpening(estimateId, draft.name.trim(), draft.quantity);
  }

  // Components → estimate_items + item_fields.
  await saveComponentItems(estimateId, opening.id, draft.doors.map((d) => ({ ...d, entityType: 'door' as const })), 0);
  await saveComponentItems(estimateId, opening.id, draft.frames.map((d) => ({ ...d, entityType: 'frame' as const })), 100);
  await saveComponentItems(estimateId, opening.id, draft.panels.map((d) => ({ ...d, entityType: 'panel' as const })), 200);
  await saveComponentItems(estimateId, opening.id, draft.lites.map((d) => ({ ...d, entityType: 'specialty' as const })), 300);

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

  // Auditable engine lines (+ manual-quote routes) via the rule engine.
  const spec = buildNormalizedSpec(
    { ...draft, openingId: opening.id, estimateId },
    mappings,
  );
  await priceOpening(spec, { ...options, persist: true });

  return { opening };
}
