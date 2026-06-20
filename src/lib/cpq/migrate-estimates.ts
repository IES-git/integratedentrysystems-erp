/**
 * Legacy estimate → engine model migration (Phase 6 cutover).
 *
 * Re-enters existing legacy openings (estimate_items + item_fields) into the
 * canonical spec-driven model by reconstructing a NormalizedOpeningSpec per
 * opening and pricing it through the rule engine with persistence on — so each
 * legacy opening gains its auditable `estimate_line` build-up (and, where the
 * published book has no rule yet, explicit manual-quote exceptions rather than
 * silent zeros). Re-runnable: it replaces an opening's prior engine lines.
 *
 * Volume is trivial (3 estimates), so this doubles as the re-entry tool the
 * plan calls for. It does NOT delete the legacy items — the legacy grid view
 * keeps working until the tables are retired.
 */

import { supabase } from '@/lib/supabase';
import { getEstimateOpenings } from '@/lib/estimates-api';
import { loadSpecFieldDictionary } from '@/lib/cpq-catalog-api';
import { priceOpening } from '@/lib/pricing';
import { buildNormalizedSpec, createOpeningDraft, type ComponentDraft, type HardwareSelectionDraft } from './opening-spec';
import type {
  EstimateItem,
  EstimateItemWithHardware,
  EstimateOpeningWithItems,
  ItemField,
  OpeningConfigurationType,
  RuleEntityType,
  SpecFieldMapping,
} from '@/types';

/** Legacy item rows carry their `fields` array at runtime (see getEstimateOpenings). */
type ItemWithFields = EstimateItem & { fields?: ItemField[] };

/** Maps a legacy item_type slug to a canonical rule entity type. */
function entityForItemType(itemType: string | null | undefined): RuleEntityType {
  switch (itemType) {
    case 'doors':
      return 'door';
    case 'frames':
      return 'frame';
    case 'panels':
      return 'panel';
    case 'lites_louvers_glass':
      return 'specialty';
    default:
      return 'door';
  }
}

/** Maps a legacy opening template type to the canonical configuration + leaf count. */
function configForTemplate(template: string | null): { configurationType: OpeningConfigurationType; leafCount: number } {
  switch (template) {
    case 'pair':
      return { configurationType: 'pair', leafCount: 2 };
    case 'pair_with_panel':
      return { configurationType: 'pair', leafCount: 2 };
    case 'single_with_panel':
      return { configurationType: 'single', leafCount: 1 };
    case 'single':
    default:
      return { configurationType: 'single', leafCount: 1 };
  }
}

function fieldsRecord(item: ItemWithFields): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of item.fields ?? []) {
    if (f.fieldValue != null && f.fieldValue !== '') out[f.fieldKey] = f.fieldValue;
  }
  return out;
}

function componentDraft(item: EstimateItemWithHardware, entity: RuleEntityType): ComponentDraft {
  return {
    id: item.id,
    entityType: entity,
    label: item.itemLabel || item.canonicalCode,
    familyCode: item.canonicalCode || null,
    quantity: Math.max(1, item.quantity),
    fields: fieldsRecord(item as ItemWithFields),
  };
}

function hardwareDraft(item: EstimateItem): HardwareSelectionDraft {
  return {
    category: item.subcategory ?? item.itemType ?? 'hardware',
    variantId: null,
    quantity: Math.max(1, item.quantity),
    required: false,
    source: 'manual',
  };
}

export interface OpeningMigrationResult {
  openingId: string;
  name: string;
  lineCount: number;
  exceptionCount: number;
  manualQuoteCount: number;
}

export interface EstimateMigrationResult {
  estimateId: string;
  openings: OpeningMigrationResult[];
}

/** Reconstructs a NormalizedOpeningSpec for one legacy opening and prices it. */
async function migrateOpening(
  estimateId: string,
  opening: EstimateOpeningWithItems,
  mappings: SpecFieldMapping[],
): Promise<OpeningMigrationResult> {
  const { configurationType, leafCount } = configForTemplate(opening.templateType);

  const doors: ComponentDraft[] = [];
  const frames: ComponentDraft[] = [];
  const panels: ComponentDraft[] = [];
  const lites: ComponentDraft[] = [];
  for (const item of opening.items) {
    const entity = entityForItemType(item.itemType);
    const draft = componentDraft(item, entity);
    if (entity === 'door') doors.push(draft);
    else if (entity === 'frame') frames.push(draft);
    else if (entity === 'panel') panels.push(draft);
    else lites.push(draft);
  }

  const hardware: HardwareSelectionDraft[] = (opening.hardware ?? []).map(hardwareDraft);

  const draft = createOpeningDraft({
    openingId: opening.id,
    estimateId,
    name: opening.name,
    quantity: Math.max(1, opening.quantity),
    configurationType,
    leafCount,
    doors,
    frames,
    panels,
    lites,
    hardware,
  });

  const spec = buildNormalizedSpec(draft, mappings);
  const result = await priceOpening(spec, { priceBookDocumentId: null, persist: true });

  return {
    openingId: opening.id,
    name: opening.name,
    lineCount: result.lines.length,
    exceptionCount: result.totals.exceptionCount,
    manualQuoteCount: result.manualQuotes.length,
  };
}

/** Migrates every opening of one estimate into the engine model (persisting lines). */
export async function migrateEstimate(estimateId: string): Promise<EstimateMigrationResult> {
  const [openings, dict] = await Promise.all([
    getEstimateOpenings(estimateId),
    loadSpecFieldDictionary(),
  ]);

  const results: OpeningMigrationResult[] = [];
  for (const opening of openings) {
    results.push(await migrateOpening(estimateId, opening, dict.mappings));
  }
  return { estimateId, openings: results };
}

/** Migrates all estimates in the database. Trivial volume (a handful of rows). */
export async function migrateAllEstimates(): Promise<EstimateMigrationResult[]> {
  const { data, error } = await supabase.from('estimates').select('id');
  if (error) throw new Error(`Failed to list estimates: ${error.message}`);
  const results: EstimateMigrationResult[] = [];
  for (const row of data ?? []) {
    results.push(await migrateEstimate(row.id as string));
  }
  return results;
}
