/**
 * Builder draft → NormalizedOpeningSpec (Phase 4).
 *
 * The unified spec builder holds a draft keyed by machine field_path; this
 * module converts it into the engine's `NormalizedOpeningSpec`, dual-keying
 * every field by both field_path and field_id so `rule_condition`s referencing
 * either form resolve, and parsing dimensions to inches.
 */

import { parseDoorDimension } from '@/components/pricing/dimension-utils';
import type {
  NormalizedOpeningSpec,
  SpecComponent,
  SpecValue,
  HardwareSelection,
  KeyingInput,
  AccessControlInput,
} from '@/lib/pricing';
import type { OpeningConfigurationType, RuleEntityType, SpecFieldMapping } from '@/types';

export interface ComponentDraft {
  id: string;
  entityType: RuleEntityType;
  label: string;
  familyCode: string | null;
  quantity: number;
  /** Field values keyed by machine field_path. */
  fields: Record<string, string>;
}

export interface HardwareSelectionDraft {
  category: string;
  variantId: string | null;
  quantity: number;
  required: boolean;
  selectedFunction?: string | null;
  selectedFinish?: string | null;
  selectedSize?: string | null;
  selectedHand?: string | null;
  selectedRating?: string | null;
  source?: 'set_template' | 'manual';
}

export interface OpeningDraft {
  openingId: string | null;
  estimateId: string | null;
  name: string;
  quantity: number;
  configurationType: OpeningConfigurationType;
  leafCount: number;
  openingWidth: string;
  openingHeight: string;
  fireLabelRequired: boolean;
  /** Opening-level field values keyed by machine field_path. */
  openingFields: Record<string, string>;
  doors: ComponentDraft[];
  frames: ComponentDraft[];
  panels: ComponentDraft[];
  lites: ComponentDraft[];
  hardware: HardwareSelectionDraft[];
  keying: KeyingInput | null;
  accessControl: AccessControlInput | null;
}

function emptyDraft(): OpeningDraft {
  return {
    openingId: null,
    estimateId: null,
    name: '',
    quantity: 1,
    configurationType: 'single',
    leafCount: 1,
    openingWidth: '',
    openingHeight: '',
    fireLabelRequired: false,
    openingFields: {},
    doors: [],
    frames: [],
    panels: [],
    lites: [],
    hardware: [],
    keying: null,
    accessControl: null,
  };
}

export function createOpeningDraft(partial: Partial<OpeningDraft> = {}): OpeningDraft {
  return { ...emptyDraft(), ...partial };
}

/** Adds both field_path and field_id keys for one field value. */
function setDual(
  target: Record<string, SpecValue>,
  path: string,
  value: string,
  fieldIdByPath: Map<string, string>,
): void {
  if (value === '' || value == null) return;
  target[path] = value;
  const fieldId = fieldIdByPath.get(path);
  if (fieldId) target[fieldId] = value;
}

function buildComponent(draft: ComponentDraft, fieldIdByPath: Map<string, string>): SpecComponent {
  const fields: Record<string, SpecValue> = {};
  for (const [path, value] of Object.entries(draft.fields)) {
    setDual(fields, path, value, fieldIdByPath);
  }
  return {
    id: draft.id,
    entityType: draft.entityType,
    label: draft.label,
    quantity: Math.max(1, draft.quantity),
    code: draft.familyCode,
    fields,
  };
}

/**
 * Converts a builder draft into the engine input. `mappings` supplies the
 * field_id ↔ field_path correspondence used for dual-keying.
 */
export function buildNormalizedSpec(
  draft: OpeningDraft,
  mappings: SpecFieldMapping[],
): NormalizedOpeningSpec {
  const fieldIdByPath = new Map(mappings.map((m) => [m.fieldPath, m.fieldId]));

  const openingFields: Record<string, SpecValue> = {};
  for (const [path, value] of Object.entries(draft.openingFields)) {
    setDual(openingFields, path, value, fieldIdByPath);
  }

  const components: SpecComponent[] = [
    ...draft.doors.map((d) => buildComponent({ ...d, entityType: 'door' }, fieldIdByPath)),
    ...draft.frames.map((d) => buildComponent({ ...d, entityType: 'frame' }, fieldIdByPath)),
    ...draft.panels.map((d) => buildComponent({ ...d, entityType: 'panel' }, fieldIdByPath)),
    ...draft.lites.map((d) => buildComponent({ ...d, entityType: 'specialty' }, fieldIdByPath)),
  ];

  const hardware: HardwareSelection[] = draft.hardware.map((h) => ({
    category: h.category,
    variantId: h.variantId,
    quantity: h.quantity,
    required: h.required,
    selectedFunction: h.selectedFunction ?? null,
    selectedFinish: h.selectedFinish ?? null,
    selectedSize: h.selectedSize ?? null,
    selectedHand: h.selectedHand ?? null,
    selectedRating: h.selectedRating ?? null,
    source: h.source,
  }));

  return {
    openingId: draft.openingId,
    estimateId: draft.estimateId,
    configurationType: draft.configurationType,
    leafCount: Math.max(1, draft.leafCount),
    quantity: Math.max(1, draft.quantity),
    openingWidthIn: draft.openingWidth ? parseDoorDimension(draft.openingWidth) : null,
    openingHeightIn: draft.openingHeight ? parseDoorDimension(draft.openingHeight) : null,
    fireLabelRequired: draft.fireLabelRequired,
    fields: openingFields,
    components,
    hardware,
    keying: draft.keying,
    accessControl: draft.accessControl,
  };
}
