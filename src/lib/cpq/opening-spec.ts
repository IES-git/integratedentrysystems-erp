/**
 * Builder draft → NormalizedOpeningSpec (Phase 4).
 *
 * The unified spec builder holds a draft keyed by machine field_path; this
 * module converts it into the engine's `NormalizedOpeningSpec`, dual-keying
 * every field by both field_path and field_id so `rule_condition`s referencing
 * either form resolve, and parsing dimensions to inches.
 */

import { parseDoorDimension } from '@/components/pricing/dimension-utils';
import { deriveBuilderContext, mergeDerived, type DerivedMap } from './builder-logic';
import { resolveInfill, type NgpInfillType } from './ngp-infill';
import type { NgpCatalog } from '@/lib/ngp-catalog-api';
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

/**
 * A door cutout filled with NGP infill (vision lite or louver). Beginner-facing
 * fields are the infill type + cutout size; everything else is auto-resolved by
 * `resolveInfill` from the NGP catalog (kit, glass, tape, options, sizes). User
 * overrides win when set.
 */
export interface CutoutDraft {
  id: string;
  /** Owning door leaf id (for labeling / scope). */
  doorId: string | null;
  infillType: NgpInfillType;
  cutoutWidth: string;
  cutoutHeight: string;
  /** Resolved from the door/opening, but overridable. */
  doorThicknessIn: number | null;
  fireRatingMinutes: number | null;
  kitModel: string | null;
  louverModel: string | null;
  glassModel: string | null;
  tapeModel: string | null;
  glassThicknessIn: number | null;
  finishCode: string | null;
  optionCodes: string[];
  preferAssembly: boolean;
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
  /** NGP infill cutouts (glass / lite kits / louvers) on the doors. */
  cutouts: CutoutDraft[];
  hardware: HardwareSelectionDraft[];
  /** Opening-wide finish default, flowed to every hardware category. */
  hardwareFinishDefault: string | null;
  keying: KeyingInput | null;
  accessControl: AccessControlInput | null;
}

/** Creates an empty NGP cutout draft. */
export function createCutoutDraft(partial: Partial<CutoutDraft> = {}): CutoutDraft {
  return {
    id: partial.id ?? `cutout-${Math.random().toString(36).slice(2, 9)}`,
    doorId: partial.doorId ?? null,
    infillType: partial.infillType ?? 'LITE',
    cutoutWidth: partial.cutoutWidth ?? '',
    cutoutHeight: partial.cutoutHeight ?? '',
    doorThicknessIn: partial.doorThicknessIn ?? null,
    fireRatingMinutes: partial.fireRatingMinutes ?? null,
    kitModel: partial.kitModel ?? null,
    louverModel: partial.louverModel ?? null,
    glassModel: partial.glassModel ?? null,
    tapeModel: partial.tapeModel ?? null,
    glassThicknessIn: partial.glassThicknessIn ?? null,
    finishCode: partial.finishCode ?? null,
    optionCodes: partial.optionCodes ?? [],
    preferAssembly: partial.preferAssembly ?? true,
  };
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
    cutouts: [],
    hardware: [],
    hardwareFinishDefault: null,
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

/** The spec field a component's series/construction selection should populate. */
const SERIES_FIELD_PATH: Partial<Record<RuleEntityType, string>> = {
  door: 'door.door_series_construction',
  frame: 'frame.frame_series',
  panel: 'panel.panel_construction_series',
  specialty: 'door.door_series_construction',
};

/**
 * Effective component fields = builder-derived values overlaid by user overrides
 * (override wins), plus the series bridge. Shared by spec-build and persistence
 * so the saved record always matches what was priced.
 */
export function resolveComponentFields(draft: ComponentDraft, derived: DerivedMap | undefined): Record<string, string> {
  const effective = mergeDerived(draft.fields, derived);
  // Bridge the "Series…" picker (familyCode) into the spec field the price rules
  // actually match on, so choosing a series populates the base-rule condition.
  const seriesPath = SERIES_FIELD_PATH[draft.entityType];
  if (draft.familyCode && seriesPath && !(seriesPath in effective)) {
    effective[seriesPath] = draft.familyCode;
  }
  return effective;
}

/** The component's series/option code, sourced from the series spec field. */
export function componentCode(draft: ComponentDraft, derived: DerivedMap | undefined): string | null {
  const effective = resolveComponentFields(draft, derived);
  const seriesPath = SERIES_FIELD_PATH[draft.entityType];
  return (seriesPath ? effective[seriesPath] : null) || draft.familyCode || null;
}

function buildComponent(
  draft: ComponentDraft,
  fieldIdByPath: Map<string, string>,
  derived: DerivedMap | undefined,
): SpecComponent {
  const fields: Record<string, SpecValue> = {};
  for (const [path, value] of Object.entries(resolveComponentFields(draft, derived))) {
    setDual(fields, path, value, fieldIdByPath);
  }
  return {
    id: draft.id,
    entityType: draft.entityType,
    label: draft.label,
    quantity: Math.max(1, draft.quantity),
    code: componentCode(draft, derived),
    fields,
  };
}

/** Plain-inch parse for NGP cutout dimensions (NOT door-nominal notation). */
function parsePlainInches(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Default door thickness (in) used when the draft has no explicit value. */
const DEFAULT_DOOR_THICKNESS_IN = 1.75;

/** Reads the door's thickness in inches from its fields, with a sane default. */
function doorThicknessIn(draft: OpeningDraft): number | null {
  for (const d of draft.doors) {
    for (const [path, value] of Object.entries(d.fields)) {
      if (/thickness/i.test(path)) {
        const n = parsePlainInches(value);
        if (n != null) return n;
      }
    }
  }
  return DEFAULT_DOOR_THICKNESS_IN;
}

/** Reads the opening fire rating in minutes from opening fields (0 = non-rated). */
function fireRatingMinutes(draft: OpeningDraft): number | null {
  for (const [path, value] of Object.entries(draft.openingFields)) {
    if (/fire.*(rating|label|minutes)/i.test(path)) {
      const n = Number(String(value).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return draft.fireLabelRequired ? null : 0;
}

/**
 * Expands NGP infill cutouts into engine SpecComponents (lite_kit / glass /
 * glazing_tape / louver) using the loaded NGP catalog. Bundling suppression is
 * handled inside `resolveInfill` (it simply does not emit a separate glass/tape
 * component when the kit/assembly includes it).
 */
function buildCutoutComponents(draft: OpeningDraft, ngpCatalog: NgpCatalog): SpecComponent[] {
  const out: SpecComponent[] = [];
  const defaultThickness = doorThicknessIn(draft);
  const defaultFire = fireRatingMinutes(draft);
  for (const cutout of draft.cutouts) {
    if (cutout.infillType === 'NONE') continue;
    const resolved = resolveInfill(ngpCatalog, {
      infillType: cutout.infillType,
      cutoutWidthIn: parsePlainInches(cutout.cutoutWidth),
      cutoutHeightIn: parsePlainInches(cutout.cutoutHeight),
      doorThicknessIn: cutout.doorThicknessIn ?? defaultThickness,
      fireRatingMinutes: cutout.fireRatingMinutes ?? defaultFire,
      kitModel: cutout.kitModel,
      louverModel: cutout.louverModel,
      glassModel: cutout.glassModel,
      tapeModel: cutout.tapeModel,
      glassThicknessIn: cutout.glassThicknessIn,
      finishCode: cutout.finishCode,
      optionCodes: cutout.optionCodes,
      preferAssembly: cutout.preferAssembly,
    });
    for (const c of resolved.components) {
      const fields: Record<string, SpecValue> = {};
      for (const [k, v] of Object.entries(c.fields)) fields[k] = v;
      out.push({
        id: `${cutout.id}-${c.entityType}`,
        entityType: c.entityType,
        label: c.label,
        quantity: Math.max(1, c.quantity),
        code: c.code,
        fields,
      });
    }
  }
  return out;
}

/**
 * Converts a builder draft into the engine input. `mappings` supplies the
 * field_id ↔ field_path correspondence used for dual-keying. When `ngpCatalog`
 * is provided, NGP infill cutouts are expanded into priceable components.
 */
export function buildNormalizedSpec(
  draft: OpeningDraft,
  mappings: SpecFieldMapping[],
  ngpCatalog?: NgpCatalog | null,
): NormalizedOpeningSpec {
  const fieldIdByPath = new Map(mappings.map((m) => [m.fieldPath, m.fieldId]));
  const ctx = deriveBuilderContext(draft);

  const openingFields: Record<string, SpecValue> = {};
  for (const [path, value] of Object.entries(mergeDerived(draft.openingFields, ctx.derivedOpeningFields))) {
    setDual(openingFields, path, value, fieldIdByPath);
  }

  const derivedFor = (id: string): DerivedMap | undefined => ctx.derivedByComponent[id];
  const components: SpecComponent[] = [
    ...draft.doors.map((d) => buildComponent({ ...d, entityType: 'door' }, fieldIdByPath, derivedFor(d.id))),
    ...draft.frames.map((d) => buildComponent({ ...d, entityType: 'frame' }, fieldIdByPath, derivedFor(d.id))),
    ...draft.panels.map((d) => buildComponent({ ...d, entityType: 'panel' }, fieldIdByPath, derivedFor(d.id))),
    ...draft.lites.map((d) => buildComponent({ ...d, entityType: 'specialty' }, fieldIdByPath, derivedFor(d.id))),
    ...(ngpCatalog ? buildCutoutComponents(draft, ngpCatalog) : []),
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
    leafCount: Math.max(1, ctx.leafCount),
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
