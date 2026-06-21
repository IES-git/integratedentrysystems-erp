/**
 * Builder intelligence layer (Phase 4 simplification).
 *
 * Pure, dependency-free logic that makes the spec opening builder smart:
 *   1. deriveBuilderContext — cascades shared values (leaf count, door/frame
 *      sizes, frame gauge/material/hand from the door, core/edge from the
 *      series, fire labels) so the user enters each thing once.
 *   2. fieldTier — classifies every spec field as essential / advanced / hidden
 *      via a curated allowlist + conditional triggers (progressive disclosure).
 *   3. allowedEnumOptions — filters enum options to the physically-possible set
 *      given the current selections (series by fire/specialty, core by series,
 *      frame series + anchor by wall construction).
 *   4. isStepVisible — hides whole steps (panels/lites) that the configuration
 *      doesn't use.
 *
 * Derived values are returned, never written back into the draft, so the draft
 * stays the single source of truth: effective value = user override ?? derived.
 */

import { parseDoorDimension, formatDimensionHyphen } from '@/components/pricing/dimension-utils';
import { hingesPerLeaf } from '@/components/estimates/wizard/opening-rules';
import type { OpeningConfigurationType, SpecFieldEntity } from '@/types';
import type { SpecFieldWithPath, BaseSignature } from '@/lib/cpq-catalog-api';
import type { OpeningDraft, ComponentDraft } from './opening-spec';

// ---------------------------------------------------------------------------
// Machine field paths (mirrors spec_field_mapping)
// ---------------------------------------------------------------------------

const PATH = {
  opening: {
    wallConstruction: 'opening.wall_construction',
    wallStudWidth: 'opening.wall_stud_width',
    jambDepth: 'opening.finished_wall_thickness_jamb_depth',
    windstorm: 'opening.windstorm_design_pressure_requirement',
    fema: 'opening.storm_shelter_fema_requirement',
    stc: 'opening.stc_rating_and_gasket_type',
    blast: 'opening.blast_resistance_requirement',
    bullet: 'opening.bullet_resistance_level',
  },
  door: {
    series: 'door.door_series_construction',
    core: 'door.core_type',
    edge: 'door.edge_seam_construction',
    gauge: 'door.door_gauge',
    material: 'door.door_material',
    thickness: 'door.door_thickness',
    width: 'door.nominal_door_width',
    height: 'door.nominal_door_height',
    leafActivity: 'door.leaf_activity',
    hand: 'door.door_hand',
    elevation: 'door.door_face_elevation_style',
    hingePrep: 'door.hinge_preparation_type',
    hingeQty: 'door.hinge_quantity',
    lockPrep: 'door.primary_lock_exit_device_preparation',
    closerPrep: 'door.closer_holder_preparation',
    hwLocation: 'door.primary_hardware_location_standard',
    label: 'door.door_label_required_specific_designation',
  },
  frame: {
    series: 'frame.frame_series',
    type: 'frame.frame_type',
    gauge: 'frame.frame_gauge',
    material: 'frame.frame_material',
    hand: 'frame.frame_hand',
    rabbetDoorThickness: 'frame.door_thickness_hardware_rabbet',
    width: 'frame.nominal_frame_width',
    height: 'frame.nominal_frame_height',
    jambDepth: 'frame.jamb_depth',
    rabbetType: 'frame.rabbet_type',
    anchorFamily: 'frame.anchor_family',
    hingePrep: 'frame.hinge_preparation_type',
    hingeQty: 'frame.hinge_quantity',
    hingeLocation: 'frame.hinge_locations',
    strikePrep: 'frame.primary_strike_preparation',
    strikeLocation: 'frame.primary_strike_location',
    closerPrep: 'frame.closer_holder_coordinator_preparation',
    label: 'frame.frame_label_required_designation',
  },
} as const;

/** Continuous-hinge prep codes (mutually exclusive with butt-hinge quantity). */
const CONTINUOUS_HINGE_CODES = new Set(['CONH', 'CONN', 'CONU', 'CONHF']);

function isContinuousHinge(code: string): boolean {
  return CONTINUOUS_HINGE_CODES.has(code.trim().toUpperCase());
}

// ---------------------------------------------------------------------------
// Series → core/edge derivation (from product_family descriptions). Values use
// the EXACT casing of the DOR-003/DOR-004 enum options so a derived value
// renders as the selected option and stays overridable.
// ---------------------------------------------------------------------------

interface SeriesAttrs { core?: string; edge?: string }

const SERIES_DERIVATION: Record<string, SeriesAttrs> = {
  H: { core: 'Honeycomb', edge: 'Lockseam' },
  HF: { core: 'Honeycomb', edge: 'seamless tack-and-fill' },
  HP: { core: 'polystyrene', edge: 'Lockseam' },
  HPF: { core: 'polystyrene', edge: 'seamless tack-and-fill' },
  HT: { core: 'polyurethane', edge: 'Lockseam' },
  HTF: { core: 'polyurethane', edge: 'seamless tack-and-fill' },
  HR: { core: 'temperature rise', edge: 'Lockseam' },
  HRF: { core: 'temperature rise', edge: 'seamless tack-and-fill' },
  CH: { core: 'Honeycomb', edge: 'continuous weld' },
  CHP: { core: 'polystyrene', edge: 'continuous weld' },
  CHT: { core: 'polyurethane', edge: 'continuous weld' },
  CHR: { core: 'temperature rise', edge: 'continuous weld' },
  LW: { core: 'steel stiffened', edge: 'Lockseam' },
  LWF: { core: 'steel stiffened', edge: 'seamless tack-and-fill' },
  C: { core: 'steel stiffened', edge: 'continuous weld' },
  EH: { core: 'Honeycomb', edge: 'embossed' },
  EHF: { core: 'Honeycomb', edge: 'embossed' },
  EP: { core: 'polystyrene', edge: 'embossed' },
  EPF: { core: 'polystyrene', edge: 'embossed' },
};

const SPECIALTY_SERIES = new Set(['W50', 'W70', 'FEMA', 'STC', 'SBR', 'BR752']);

// ---------------------------------------------------------------------------
// Core upgrades. Each base series carries published FIXED_ADD core-upgrade
// adders keyed on `door.option_code` (gated on that series). Selecting a non-
// base core applies the matching adder over the series base price. The base
// core (honeycomb for glued-core series, steel-stiffened for stiffened series)
// is included (no adder). Codes mirror the Pioneer per-series nomenclature:
//   H : HP / HT / HR              CH: CHP / CHT / CHR
//   LW: PS / TS (between stiffeners)   C: PS / TS (between stiffeners)
//   EH: EP
// Series not listed here have a single (locked) core derived from the series.
// ---------------------------------------------------------------------------

/** series → { DOR-003 core_type value → door.option_code the adder matches }. */
const SERIES_CORE_UPGRADES: Record<string, Record<string, string>> = {
  H: { polystyrene: 'HP', polyurethane: 'HT', 'temperature rise': 'HR' },
  CH: { polystyrene: 'CHP', polyurethane: 'CHT', 'temperature rise': 'CHR' },
  LW: { polystyrene: 'PS', polyurethane: 'TS' },
  C: { polystyrene: 'PS', polyurethane: 'TS' },
  EH: { polystyrene: 'EP' },
};

/**
 * Core-type choices offered for a series: the series-derived base core plus any
 * priced upgrades, or null when the series has no published upgrades (caller
 * falls back to the single derived core).
 */
function coreChoicesForSeries(series: string): string[] | null {
  const upgrades = SERIES_CORE_UPGRADES[series];
  if (!upgrades) return null;
  const base = SERIES_DERIVATION[series]?.core;
  const choices = base ? [base] : [];
  for (const core of Object.keys(upgrades)) {
    if (!choices.includes(core)) choices.push(core);
  }
  return choices;
}

/**
 * Resolves the `door.option_code` that triggers the core-upgrade adder for a
 * door's effective series + core selection, or null when no upgrade applies
 * (base core, or a series without published core upgrades). Used by the spec
 * builder to bridge the Core-type picker into the priced adder.
 */
export function coreUpgradeOptionCode(seriesRaw: string, coreRaw: string): string | null {
  const series = trimmed(seriesRaw).toUpperCase();
  const upgrades = SERIES_CORE_UPGRADES[series];
  if (!upgrades) return null;
  const core = trimmed(coreRaw).toLowerCase();
  return upgrades[core] ?? null;
}

/** A specialty door series forces a matching specialty frame series. */
const SPECIALTY_DOOR_TO_FRAME: Record<string, string[]> = {
  W50: ['F50'], W70: ['F70'], FEMA: ['FEMA'], STC: ['FST'], SBR: ['SBR'], BR752: ['BR752'],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DerivedValue {
  value: string;
  /** Short human-readable explanation, e.g. "from opening size". */
  reason: string;
}

export type DerivedMap = Record<string, DerivedValue>;

export interface BuilderContext {
  /** Leaf count derived from configuration (falls back to the draft value). */
  leafCount: number;
  /** Whether the configuration needs an astragal (pairs / double-egress). */
  astragalApplies: boolean;
  /** Suggested active-leaf designation, when a pair. */
  activeLeafDesignation: string | null;
  /** Opening-level derived field values, keyed by field_path. */
  derivedOpeningFields: DerivedMap;
  /** Per-component derived field values: componentId → field_path → value. */
  derivedByComponent: Record<string, DerivedMap>;
}

export type FieldTier = 'essential' | 'advanced' | 'hidden';

/** option_definition descriptions: entity -> CODE(upper) -> description. */
export type OptionDescriptors = Map<string, Map<string, string>>;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function trimmed(v: string | undefined | null): string {
  return (v ?? '').trim();
}

function openingVal(draft: OpeningDraft, path: string): string {
  return trimmed(draft.openingFields[path]);
}

function compVal(component: ComponentDraft | undefined, path: string): string {
  return trimmed(component?.fields[path]);
}

/** First door's effective value for a path (override only; derived feeds itself). */
function firstDoorVal(draft: OpeningDraft, path: string): string {
  for (const d of draft.doors) {
    const v = trimmed(d.fields[path]);
    if (v) return v;
  }
  return '';
}

/** Leaf count implied by the configuration; falls back to the draft value. */
export function derivedLeafCount(config: OpeningConfigurationType, fallback: number): number {
  switch (config) {
    case 'single':
    case 'dutch':
      return 1;
    case 'pair':
    case 'double_egress':
    case 'communicating':
      return 2;
    case 'borrowed_lite':
    case 'sidelite_transom':
    case 'storefront':
    case 'specialty':
      return Math.max(1, fallback);
    default: {
      const _exhaustive: never = config;
      return Math.max(1, fallback);
    }
  }
}

function isGlazedElevation(elevation: string): boolean {
  return ['vision', 'narrow lite', 'half glass', 'full glass'].includes(elevation.toLowerCase());
}

function isPairLike(config: OpeningConfigurationType): boolean {
  return config === 'pair' || config === 'double_egress' || config === 'communicating';
}

/** Frame unit type (FRM-005) implied by the configuration. */
function derivedFrameType(config: OpeningConfigurationType): string | null {
  switch (config) {
    case 'single':
    case 'dutch':
      return '3S';
    case 'pair':
    case 'double_egress':
    case 'communicating':
      return '3P';
    case 'borrowed_lite':
      return '4S';
    case 'sidelite_transom':
    case 'storefront':
    case 'specialty':
      return null;
    default: {
      const _exhaustive: never = config;
      return null;
    }
  }
}

/** Door leaf width derived from the opening width (split evenly for pairs). */
function deriveDoorWidth(draft: OpeningDraft, leafCount: number): string | null {
  const w = trimmed(draft.openingWidth);
  if (!w) return null;
  if (leafCount <= 1) return w; // single leaf: opening width verbatim
  const inches = parseDoorDimension(w);
  if (inches == null) return null;
  const per = inches / leafCount;
  if (!Number.isInteger(per)) return null; // non-even split → let the user enter it
  return formatDimensionHyphen(per);
}

// ---------------------------------------------------------------------------
// 1. Cascade / auto-fill
// ---------------------------------------------------------------------------

export function deriveBuilderContext(draft: OpeningDraft): BuilderContext {
  const leafCount = derivedLeafCount(draft.configurationType, draft.leafCount);
  const astragalApplies = draft.configurationType === 'pair' || draft.configurationType === 'double_egress';
  const activeLeafDesignation = !isPairLike(draft.configurationType)
    ? null
    : draft.configurationType === 'double_egress'
      ? 'active-active'
      : 'active-inactive';

  const derivedOpeningFields: DerivedMap = {};
  const derivedByComponent: Record<string, DerivedMap> = {};

  const openingHeight = trimmed(draft.openingHeight);
  const openingWidth = trimmed(draft.openingWidth);
  const doorWidth = deriveDoorWidth(draft, leafCount);
  const jambDepth = openingVal(draft, PATH.opening.jambDepth);
  const fireLabeled = draft.fireLabelRequired;

  // Door leaves.
  for (const door of draft.doors) {
    const dm: DerivedMap = {};
    if (doorWidth) dm[PATH.door.width] = { value: doorWidth, reason: 'from opening size' };
    if (openingHeight) dm[PATH.door.height] = { value: openingHeight, reason: 'from opening size' };

    const series = trimmed(door.fields[PATH.door.series] || door.familyCode || '').toUpperCase();
    const attrs = SERIES_DERIVATION[series];
    if (attrs?.core) dm[PATH.door.core] = { value: attrs.core, reason: `from ${series} series` };
    if (attrs?.edge) dm[PATH.door.edge] = { value: attrs.edge, reason: `from ${series} series` };

    dm[PATH.door.leafActivity] = {
      value: leafCount >= 2 ? 'PAIR' : 'SNGL',
      reason: 'from configuration',
    };
    if (fireLabeled) dm[PATH.door.label] = { value: 'Labeled', reason: 'fire label required' };

    // Hinge quantity per leaf (NFPA 80 / BHMA), unless a continuous hinge is used.
    if (!isContinuousHinge(compVal(door, PATH.door.hingePrep))) {
      const hIn = parseDoorDimension(compVal(door, PATH.door.height) || openingHeight);
      dm[PATH.door.hingeQty] = { value: String(hingesPerLeaf(hIn)), reason: 'NFPA 80 hinge count by height' };
    }

    derivedByComponent[door.id] = dm;
  }

  // Frames inherit shared attributes from the (first) door + opening.
  const doorGauge = firstDoorVal(draft, PATH.door.gauge);
  const doorMaterial = firstDoorVal(draft, PATH.door.material);
  const doorHand = firstDoorVal(draft, PATH.door.hand);
  const doorThickness = firstDoorVal(draft, PATH.door.thickness);
  const firstDoorSeries = trimmed(firstDoorVal(draft, PATH.door.series) || (draft.doors[0]?.familyCode ?? '')).toUpperCase();
  const frameSpecialty = SPECIALTY_DOOR_TO_FRAME[firstDoorSeries]?.[0] ?? null;
  const frameType = derivedFrameType(draft.configurationType);
  const hasDoorLeaves = draft.doors.length > 0;
  // Door hardware that drives the matching frame preps.
  const doorHingePrep = firstDoorVal(draft, PATH.door.hingePrep);
  const doorLockPrep = firstDoorVal(draft, PATH.door.lockPrep);
  const doorCloserPrep = firstDoorVal(draft, PATH.door.closerPrep);

  for (const frame of draft.frames) {
    const fm: DerivedMap = {};
    if (openingWidth) fm[PATH.frame.width] = { value: openingWidth, reason: 'from opening size' };
    if (openingHeight) fm[PATH.frame.height] = { value: openingHeight, reason: 'from opening size' };
    if (doorGauge) fm[PATH.frame.gauge] = { value: doorGauge, reason: 'matches door gauge' };
    if (doorMaterial) fm[PATH.frame.material] = { value: doorMaterial, reason: 'matches door material' };
    if (doorHand) fm[PATH.frame.hand] = { value: doorHand, reason: 'matches door hand' };
    if (doorThickness) fm[PATH.frame.rabbetDoorThickness] = { value: doorThickness, reason: 'matches door thickness' };
    if (jambDepth) fm[PATH.frame.jambDepth] = { value: jambDepth, reason: 'from opening jamb depth' };
    if (frameType) fm[PATH.frame.type] = { value: frameType, reason: 'from configuration' };
    if (frameSpecialty) fm[PATH.frame.series] = { value: frameSpecialty, reason: `matches ${firstDoorSeries} door` };
    if (draft.configurationType === 'double_egress') {
      fm[PATH.frame.rabbetType] = { value: 'DE', reason: 'double-egress opening' };
    } else if (!hasDoorLeaves) {
      fm[PATH.frame.rabbetType] = { value: 'CO', reason: 'cased opening (no door)' };
    }
    if (fireLabeled) fm[PATH.frame.label] = { value: 'Labeled', reason: 'fire label required' };
    // Frame hinge prep matches the door's hinge prep (same hinge, both sides).
    if (doorHingePrep) fm[PATH.frame.hingePrep] = { value: doorHingePrep, reason: 'matches door hinge prep' };
    // Frame hinge quantity per leaf, matching the door (unless continuous hinge).
    const effFrameHingePrep = compVal(frame, PATH.frame.hingePrep) || doorHingePrep;
    if (!isContinuousHinge(effFrameHingePrep)) {
      const hIn = parseDoorDimension(openingHeight);
      fm[PATH.frame.hingeQty] = { value: String(hingesPerLeaf(hIn)), reason: 'NFPA 80 hinge count by height' };
      fm[PATH.frame.hingeLocation] = { value: 'PIO', reason: 'Pioneer standard location' };
    }
    // Frame strike pairs with the door's lock / exit device (standard ANSI 478).
    if (doorLockPrep) {
      fm[PATH.frame.strikePrep] = { value: '478', reason: 'pairs with door lock/exit device' };
      fm[PATH.frame.strikeLocation] = { value: 'PIO', reason: 'Pioneer standard location' };
    }
    // Frame closer reinforcement when the door has a closer prep.
    if (doorCloserPrep) {
      fm[PATH.frame.closerPrep] = { value: 'REG', reason: 'matches door closer' };
    }
    derivedByComponent[frame.id] = fm;
  }

  return {
    leafCount,
    astragalApplies,
    activeLeafDesignation,
    derivedOpeningFields,
    derivedByComponent,
  };
}

/** Effective field map: derived values overlaid by user overrides (override wins). */
export function mergeDerived(own: Record<string, string>, derived: DerivedMap | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (derived) {
    for (const [path, dv] of Object.entries(derived)) {
      if (dv.value) out[path] = dv.value;
    }
  }
  for (const [path, value] of Object.entries(own)) {
    if (value !== '' && value != null) out[path] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Progressive disclosure (field tiering)
// ---------------------------------------------------------------------------

/** The few fields a non-expert must actively consider, per entity. */
const ESSENTIAL_FIELDS: Partial<Record<SpecFieldEntity, Set<string>>> = {
  // Construction REQUIREMENTS the estimator enters (core/edge/material/gauge,
  // size, activity) + the primary hardware preps. The manufacturer SERIES
  // (DOR-002 / FRM-002) is intentionally NOT here — it is a resolver OUTPUT,
  // surfaced only in the "Compliant construction selection" step + advanced/
  // audit detail, so the user never picks a Pioneer series directly.
  door: new Set(['DOR-003', 'DOR-004', 'DOR-005', 'DOR-006', 'DOR-007', 'DOR-008', 'DOR-009', 'DOR-012', 'DOR-015', 'DOR-026', 'DOR-035', 'DOR-041']),
  frame: new Set(['FRM-005', 'FRM-003', 'FRM-004', 'FRM-007', 'FRM-008', 'FRM-009', 'FRM-010', 'FRM-014']),
  opening: new Set(['OPN-010']),
};

/**
 * Conditional fields keyed by field_id. A trigger returns true (reveal as
 * essential), false (hide), or is absent (not a recognized conditional → falls
 * through to the curated/heuristic tiering).
 */
const TRIGGERS: Record<string, (draft: OpeningDraft, ctx: BuilderContext, component?: ComponentDraft) => boolean> = {
  // Opening
  'OPN-009': (_d, ctx) => ctx.leafCount >= 2, // active leaf designation
  'OPN-011': (d) => /stud/i.test(openingVal(d, PATH.opening.wallConstruction)), // wall/stud width
  'OPN-014': (d) => d.fireLabelRequired, // label agency
  'OPN-015': (d) => d.fireLabelRequired, // hourly fire rating
  'OPN-016': (d) => d.fireLabelRequired, // label form/material
  // Door
  'DOR-014': (_d, ctx) => ctx.astragalApplies, // astragal (pairs)
  'DOR-016': (_d, _c, comp) => isGlazedElevation(compVal(comp, PATH.door.elevation)),
  'DOR-017': (_d, _c, comp) => isGlazedElevation(compVal(comp, PATH.door.elevation)),
  'DOR-018': (_d, _c, comp) => isGlazedElevation(compVal(comp, PATH.door.elevation)),
  'DOR-019': (_d, _c, comp) => isGlazedElevation(compVal(comp, PATH.door.elevation)),
  'DOR-020': (_d, _c, comp) => isGlazedElevation(compVal(comp, PATH.door.elevation)),
  'DOR-021': (_d, _c, comp) => isGlazedElevation(compVal(comp, PATH.door.elevation)),
  'DOR-022': (_d, _c, comp) => isGlazedElevation(compVal(comp, PATH.door.elevation)),
  'DOR-024': (_d, _c, comp) => compVal(comp, PATH.door.elevation).toLowerCase() === 'louvered',
  'DOR-025': (_d, _c, comp) => compVal(comp, PATH.door.elevation).toLowerCase() === 'louvered',
  'DOR-040': (_d, _c, comp) => compVal(comp, PATH.door.hingePrep).toUpperCase() === 'PIVOT',
  'DOR-036': (_d, _c, comp) => !isContinuousHinge(compVal(comp, PATH.door.hingePrep)), // hinge qty (hidden for continuous)
  'DOR-048': (d) => d.fireLabelRequired, // door label
  'DOR-058': (d) => d.configurationType === 'dutch',
  // Frame — preps that pair with the door reveal once the door driver is set.
  'FRM-018': (d) => !!firstDoorVal(d, PATH.door.hingePrep), // hinge prep (matches door)
  'FRM-019': (d, _c, comp) => !isContinuousHinge(compVal(comp, PATH.frame.hingePrep) || firstDoorVal(d, PATH.door.hingePrep)), // hinge qty
  'FRM-015': (d) => !!firstDoorVal(d, PATH.door.lockPrep), // strike prep (pairs with door lock/exit)
  'FRM-022': (d) => !!firstDoorVal(d, PATH.door.closerPrep), // closer reinforcement (matches door closer)
  'FRM-031': (d) => d.fireLabelRequired, // frame label
};

/**
 * Classifies a spec field into a disclosure tier given the current draft.
 * `component` is required for component-scoped triggers (door/frame fields).
 */
export function fieldTier(
  field: SpecFieldWithPath,
  draft: OpeningDraft,
  ctx: BuilderContext,
  component?: ComponentDraft,
): FieldTier {
  const trigger = TRIGGERS[field.fieldId];
  if (trigger) return trigger(draft, ctx, component) ? 'essential' : 'hidden';

  const essential = ESSENTIAL_FIELDS[field.entity];
  if (essential) {
    return essential.has(field.fieldId) ? 'essential' : 'advanced';
  }

  // Entities without a curated list (panel/lite/special): fall back to the
  // dictionary's required_when so the common "Always"/"… supplied" fields stay
  // up front and everything else collapses into advanced.
  const rw = (field.requiredWhen ?? '').toLowerCase().trim();
  if (rw === 'always' || rw.startsWith('panel supplied') || rw.startsWith('each ')) return 'essential';
  return 'advanced';
}

// ---------------------------------------------------------------------------
// 2b. Abbreviation + meaning labels
// ---------------------------------------------------------------------------

/**
 * Curated, plain-English descriptions for the few cryptic fields where the
 * option_definition text is ambiguous or shared across codes. Keyed by field_id
 * then by code. These take precedence over the DB descriptors.
 */
const CURATED_OPTION_LABELS: Record<string, Record<string, string>> = {
  // Door core type (DOR-003) — honeycomb is the included base core; the others
  // are priced upgrades over the H base (see core-upgrade adders).
  'DOR-003': {
    Honeycomb: 'Honeycomb (standard, included)',
    polystyrene: 'Polystyrene (insulated core upgrade)',
    polyurethane: 'Polyurethane (insulated core upgrade)',
    'temperature rise': 'Temperature-rise core (stairwell)',
    'steel stiffened': 'Steel-stiffened core',
    fiberglass: 'Fiberglass core',
    specialty: 'Specialty core',
  },
  // Door hand (DOR-012) / Frame hand (FRM-014)
  'DOR-012': {
    RH: 'Right hand', LH: 'Left hand', RHR: 'Right hand reverse', LHR: 'Left hand reverse', NH: 'Non-handed',
  },
  'FRM-014': {
    RH: 'Right hand', LH: 'Left hand', NH: 'Non-handed', RHA: 'Right hand active', LHA: 'Left hand active', DA: 'Double acting',
  },
  // Frame rabbet / profile (FRM-007)
  'FRM-007': {
    ER: 'Equal rabbet', UR: 'Unequal rabbet', SR: 'Single rabbet', CO: 'Cased opening (no door)', DE: 'Double egress',
  },
  // Frame type (FRM-005)
  'FRM-005': {
    '3S': '3-sided, single', '3P': '3-sided, pair', '4S': '4-sided (borrowed lite)',
    H: 'Head', PH: 'Pair head', HJ: 'Hinge jamb', SJ: 'Strike jamb', BJ: 'Blank jamb', BLJ: 'Borrowed-lite jamb',
    UNIT: 'Stick / special-unit component',
  },
};

/**
 * Builds a `code -> "CODE - description"` label map for a field's enum options,
 * preferring curated overrides then the DB option_definition descriptors.
 * Returns null when no descriptions are available (use bare codes).
 */
export function optionLabelsForField(
  field: SpecFieldWithPath,
  descriptors: OptionDescriptors | null,
): Record<string, string> | null {
  if (field.enumOptions.length === 0) return null;
  const curated = CURATED_OPTION_LABELS[field.fieldId];
  const byCode = descriptors?.get(field.entity) ?? null;
  const out: Record<string, string> = {};
  let any = false;
  for (const code of field.enumOptions) {
    const desc = curated?.[code] ?? byCode?.get(code.toUpperCase()) ?? null;
    if (desc) {
      out[code] = `${code} — ${desc}`;
      any = true;
    }
  }
  return any ? out : null;
}

// ---------------------------------------------------------------------------
// 3. Compatibility filtering (allowed enum options)
// ---------------------------------------------------------------------------

const WALL_TO_FRAME_SERIES: Record<string, string[]> = {
  masonry: ['F', 'F-BL'],
  'steel stud': ['DW', 'DWBL', 'WF', 'SPF', 'STK'],
  'wood stud': ['DW', 'DWBL', 'WF'],
  drywall: ['DW', 'DWBL'],
  'existing opening': ['WF', 'SPF', 'STK'],
};

const WALL_TO_ANCHOR_FAMILY: Record<string, string[]> = {
  masonry: ['MAS'],
  'steel stud': ['WS', 'STS'],
  'wood stud': ['WS'],
  drywall: ['DWCS', 'DWBH'],
  'existing opening': ['EO'],
};

/**
 * Returns the physically-possible subset of a field's enum options given the
 * current selections, or null to use the full list unchanged. Always a subset
 * of the field's own options so unknown codes never appear.
 */
export function allowedEnumOptions(
  field: SpecFieldWithPath,
  draft: OpeningDraft,
  _ctx: BuilderContext,
  component?: ComponentDraft,
): string[] | null {
  const opts = field.enumOptions;
  if (opts.length === 0) return null;
  const keep = (allowed: string[]): string[] | null => {
    const set = new Set(allowed.map((a) => a.toUpperCase()));
    const filtered = opts.filter((o) => set.has(o.toUpperCase()));
    return filtered.length > 0 ? filtered : null;
  };

  switch (field.fieldId) {
    case 'DOR-002': { // door series by fire / specialty context
      if (openingVal(draft, PATH.opening.windstorm)) return keep(['W50', 'W70']);
      if (openingVal(draft, PATH.opening.fema)) return keep(['FEMA']);
      if (openingVal(draft, PATH.opening.stc)) return keep(['STC']);
      if (openingVal(draft, PATH.opening.blast) || openingVal(draft, PATH.opening.bullet)) return keep(['SBR', 'BR752']);
      return opts.filter((o) => !SPECIALTY_SERIES.has(o.toUpperCase()));
    }
    case 'DOR-003': { // core type: per-series priced upgrades, else locked to the series
      const series = trimmed(component?.fields[PATH.door.series] || component?.familyCode || '').toUpperCase();
      // Series with published core upgrades offer the base core + each upgrade
      // (e.g. H/CH: honeycomb + polystyrene/polyurethane/temp-rise; LW/C: steel-
      // stiffened + polystyrene/polyurethane). Every other series stays locked
      // to its single derived core.
      const choices = coreChoicesForSeries(series);
      if (choices) return keep(choices);
      const core = SERIES_DERIVATION[series]?.core;
      return core ? keep([core]) : null;
    }
    case 'FRM-002': { // frame series: specialty door wins, else by wall construction
      const doorSeries = trimmed(firstDoorVal(draft, PATH.door.series) || (draft.doors[0]?.familyCode ?? '')).toUpperCase();
      const specialty = SPECIALTY_DOOR_TO_FRAME[doorSeries];
      if (specialty) return keep(specialty);
      const wall = openingVal(draft, PATH.opening.wallConstruction).toLowerCase();
      const allowed = WALL_TO_FRAME_SERIES[wall];
      return allowed ? keep(allowed) : null;
    }
    case 'FRM-005': { // frame unit type by configuration
      const ft = derivedFrameType(draft.configurationType);
      return ft ? keep([ft]) : null;
    }
    case 'FRM-007': { // rabbet/profile by config + presence of a door
      if (draft.configurationType === 'double_egress') return keep(['DE']);
      if (draft.doors.length === 0) return keep(['CO']);
      return keep(['ER', 'UR', 'SR']);
    }
    case 'FRM-026': { // anchor family by wall construction
      const wall = openingVal(draft, PATH.opening.wallConstruction).toLowerCase();
      const allowed = WALL_TO_ANCHOR_FAMILY[wall];
      return allowed ? keep(allowed) : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 4. Step visibility
// ---------------------------------------------------------------------------

const PANEL_CONFIGS = new Set<OpeningConfigurationType>([
  'sidelite_transom', 'storefront', 'borrowed_lite', 'specialty',
]);

// ---------------------------------------------------------------------------
// 5. Hardware variant intelligence
// ---------------------------------------------------------------------------

/** Door hand selected on the first door leaf (override only), or null. */
export function doorHand(draft: OpeningDraft): string | null {
  const h = firstDoorVal(draft, PATH.door.hand);
  return h || null;
}

/** Categories whose variant is handed (a door hand should default onto them). */
export function isHandedCategory(category: string): boolean {
  return /lock|exit|closer|lever|handle|panic|deadbolt|deadlock/i.test(category);
}

/** Heuristic: does a rating string denote a fire/UL rating? */
export function isFireRating(rating: string | null | undefined): boolean {
  const r = (rating ?? '').toLowerCase();
  if (!r) return false;
  return /ul|fire|min|hour|hr|\b20\b|\b45\b|\b60\b|\b90\b|180|positive/.test(r);
}

// ---------------------------------------------------------------------------
// 6. Hardware interdependency intelligence (curated tribal knowledge)
// ---------------------------------------------------------------------------

/** Canonical hardware categories (from hardware_category_dict). */
const HW = {
  butt: 'butt_hinges',
  continuous: 'continuous_hinges',
  ept: 'electric_hinges_ept_loops',
  closer: 'closers_and_arms',
  lock: 'cylindrical_mortise_locks_and_deadbolts',
  exit: 'exit_devices',
  exitTrim: 'exit_trim_pulls',
  inactive: 'inactive_leaf_hardware',
  access: 'access_control',
} as const;

export type IntegritySeverity = 'block' | 'warn' | 'info';

export interface IntegrityIssue {
  code: string;
  severity: IntegritySeverity;
  message: string;
}

export interface HardwareAutoAdd {
  category: string;
  reason: string;
  required: boolean;
}

export interface HardwareIntel {
  /** Companion categories that should be present for a code-compliant set. */
  autoAddCategories: HardwareAutoAdd[];
  /** Conflicts / cautions surfaced to the user (and the integrity gate). */
  conflicts: IntegrityIssue[];
}

/** Minimal hardware-selection shape the intelligence needs. */
export interface HardwareSelectionLike {
  category: string;
  selectedFunction?: string | null;
  quantity?: number;
}

function hasCategory(selections: HardwareSelectionLike[], category: string): boolean {
  return selections.some((s) => s.category === category && (s.quantity == null || s.quantity > 0));
}

function looksLikeDeadbolt(selections: HardwareSelectionLike[]): boolean {
  return selections.some((s) => /dead(bolt|lock)/i.test(s.selectedFunction ?? ''));
}

/**
 * Curated door-hardware interdependency rules (NFPA 80 + Pioneer crosswalk
 * tribal knowledge). Pure: given the opening and its current hardware
 * categories, returns required companion categories + conflict messages.
 */
export function deriveHardwareIntelligence(
  draft: OpeningDraft,
  selections: HardwareSelectionLike[],
): HardwareIntel {
  const autoAddCategories: HardwareAutoAdd[] = [];
  const conflicts: IntegrityIssue[] = [];

  const fire = draft.fireLabelRequired;
  const pair = derivedLeafCount(draft.configurationType, draft.leafCount) >= 2;
  const accessControlled = draft.accessControl != null || hasCategory(selections, HW.access);

  const hasLock = hasCategory(selections, HW.lock);
  const hasExit = hasCategory(selections, HW.exit);
  const hasCloser = hasCategory(selections, HW.closer);
  const hasInactive = hasCategory(selections, HW.inactive);
  const hasEpt = hasCategory(selections, HW.ept);
  const activeLatch = hasLock || hasExit;

  // Fire doors must be self-closing (NFPA 80 6.x) -> require a closer.
  if (fire && !hasCloser) {
    autoAddCategories.push({ category: HW.closer, reason: 'Fire doors must be self-closing (NFPA 80)', required: true });
  }
  // Fire doors must positively latch with an active latchbolt (lock or fire exit).
  if (fire && !activeLatch) {
    conflicts.push({
      code: 'FIRE_NO_ACTIVE_LATCH',
      severity: 'block',
      message: 'Fire door requires a positive-latching lockset or fire exit device (a deadbolt does not satisfy this).',
    });
  }
  // Deadbolt on an egress / exit-device door is a code conflict unless interconnected.
  if (looksLikeDeadbolt(selections) && (hasExit || fire)) {
    conflicts.push({
      code: 'DEADBOLT_ON_EGRESS',
      severity: 'block',
      message: 'Deadbolt on an egress/fire door is not allowed unless interconnected to retract with the latch in one motion.',
    });
  }
  // Fire exit hardware cannot have mechanical dogging.
  if (fire && hasExit) {
    conflicts.push({
      code: 'FIRE_EXIT_NO_DOGGING',
      severity: 'info',
      message: 'Use fire-rated exit hardware (no mechanical dogging) on labeled openings.',
    });
  }
  // Pair: inactive leaf needs flush bolts; closers on both leaves need a coordinator.
  if (pair) {
    if (!hasInactive) {
      autoAddCategories.push({ category: HW.inactive, reason: 'Pair: inactive leaf needs flush bolts', required: true });
    }
    if (hasCloser) {
      conflicts.push({
        code: 'PAIR_NEEDS_COORDINATOR',
        severity: 'warn',
        message: 'Pair with closers on both leaves requires a coordinator to sequence the leaves.',
      });
    }
  }
  // Electrified / access-controlled hardware needs power transfer + power supply.
  if (accessControlled && !hasEpt) {
    autoAddCategories.push({ category: HW.ept, reason: 'Access control needs an electric power transfer (EPT)', required: false });
    conflicts.push({
      code: 'ACCESS_POWER',
      severity: 'warn',
      message: 'Access-controlled opening also needs a power supply and frame conduit (verify they are scheduled).',
    });
  }

  return { autoAddCategories, conflicts };
}

/**
 * The foolproof gate: every reason the current draft could NOT yield a sensible,
 * code-compliant, buildable estimate. Combines hardware interdependency
 * conflicts with structural door/frame consistency checks. `block` issues must
 * be resolved before the opening can be saved.
 */
export function validateBuilderIntegrity(draft: OpeningDraft): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  // 1. Hardware interdependency conflicts.
  issues.push(...deriveHardwareIntelligence(draft, draft.hardware).conflicts);

  // 2. Specialty door <-> frame series consistency.
  const doorSeries = trimmed(firstDoorVal(draft, PATH.door.series) || (draft.doors[0]?.familyCode ?? '')).toUpperCase();
  const requiredFrame = SPECIALTY_DOOR_TO_FRAME[doorSeries];
  const frameSeries = trimmed(draft.frames[0]?.fields[PATH.frame.series]).toUpperCase();
  if (requiredFrame && frameSeries && !requiredFrame.map((s) => s.toUpperCase()).includes(frameSeries)) {
    issues.push({
      code: 'SPECIALTY_FRAME_MISMATCH',
      severity: 'block',
      message: `A ${doorSeries} specialty door requires a ${requiredFrame.join('/')} frame series, not ${frameSeries}.`,
    });
  }

  // 3. A door opening needs a frame to be a complete, priceable assembly.
  if (draft.doors.length > 0 && draft.frames.length === 0) {
    issues.push({
      code: 'DOOR_WITHOUT_FRAME',
      severity: 'warn',
      message: 'This opening has a door but no frame — add a frame for a complete assembly.',
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Priceable-combination filtering (only offer values that have a base price)
// ---------------------------------------------------------------------------

function normVal(v: string): string {
  return String(v ?? '').trim().toLowerCase();
}

/** All enumerable field_paths that appear in a set of base-rule signatures. */
export function baseFieldPaths(signatures: BaseSignature[]): string[] {
  const s = new Set<string>();
  for (const sig of signatures) for (const k of Object.keys(sig)) s.add(k);
  return [...s];
}

/**
 * The values of `fieldPath` that keep a priceable base rule reachable given the
 * OTHER fields already chosen (cascading). When the current selection is itself
 * unsatisfiable, falls back to every priceable value for the field so the user
 * can recover instead of facing an empty list.
 */
export function availableBaseValues(
  signatures: BaseSignature[],
  fieldPath: string,
  selection: Record<string, string>,
): string[] {
  const consistent = new Set<string>();
  const all = new Set<string>();
  for (const sig of signatures) {
    const val = sig[fieldPath];
    if (val == null) continue;
    all.add(val);
    let ok = true;
    for (const [k, v] of Object.entries(selection)) {
      if (k === fieldPath || !v) continue;
      if (sig[k] != null && normVal(sig[k]) !== normVal(v)) { ok = false; break; }
    }
    if (ok) consistent.add(val);
  }
  return [...(consistent.size > 0 ? consistent : all)];
}

/** The component's current base-field selection (field_path → value). */
export function componentBaseSelection(
  comp: ComponentDraft,
  fieldPaths: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const seriesPath = SERIES_FIELD_PATH_BY_ENTITY[comp.entityType];
  for (const fp of fieldPaths) {
    const v = comp.fields[fp] ?? (fp === seriesPath ? comp.familyCode ?? '' : '');
    if (v) out[fp] = v;
  }
  return out;
}

const SERIES_FIELD_PATH_BY_ENTITY: Record<string, string | undefined> = {
  door: 'door.door_series_construction',
  frame: 'frame.frame_series',
  panel: 'panel.panel_construction_series',
};

/**
 * Restricts a field's enum options to those that (a) pass the compatibility
 * filter and (b) keep a priceable base rule reachable. Returns `base` unchanged
 * when the field isn't a base-driving field or no signatures are known.
 */
export function priceableEnumOptions(
  base: string[] | null,
  field: SpecFieldWithPath,
  comp: ComponentDraft,
  signatures: BaseSignature[],
): string[] | null {
  if (!field.fieldPath || signatures.length === 0) return base;
  const paths = baseFieldPaths(signatures);
  if (!paths.includes(field.fieldPath)) return base;
  const selection = componentBaseSelection(comp, paths);
  const priceable = availableBaseValues(signatures, field.fieldPath, selection);
  // `base` is null when the compatibility layer imposed no restriction — in that
  // case filter the field's full enum so priceability still applies.
  const candidates = base ?? field.enumOptions;
  if (!candidates || candidates.length === 0) {
    // The dictionary has no enum for this base field (e.g. jamb depth is a free
    // "Dimension"), but the price book DOES define which values are valid for the
    // current series/gauge — surface them as a guided dropdown instead of a blank
    // text box. Sorted so dimension-like values read in ascending order.
    return priceable.length > 0 ? sortDimensionLike(priceable) : base;
  }
  const allowed = new Set(priceable.map(normVal));
  const filtered = candidates.filter((o) => allowed.has(normVal(o)));
  // Safeguard: never hide everything (avoids an un-pickable field on odd data).
  return filtered.length > 0 ? filtered : (base ?? candidates);
}

/** Parses a dimension-like token ("6 3/4", "4-3/4", "36") to inches for sorting. */
function dimensionValue(raw: string): number | null {
  const s = String(raw).trim();
  const m = /^(\d+)(?:\s*[-\s]\s*(\d+)\s*\/\s*(\d+))?$/.exec(s);
  if (m) {
    const whole = Number(m[1]);
    const frac = m[2] && m[3] ? Number(m[2]) / Number(m[3]) : 0;
    return whole + frac;
  }
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Sorts values numerically when they all look like dimensions, else alphabetically. */
function sortDimensionLike(values: string[]): string[] {
  const parsed = values.map((v) => ({ v, n: dimensionValue(v) }));
  if (parsed.every((p) => p.n != null)) {
    return [...parsed].sort((a, b) => (a.n as number) - (b.n as number)).map((p) => p.v);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

/**
 * Base-field values that are FORCED (exactly one priceable choice given the rest
 * of the selection) and not yet set — so the builder can auto-fill them. Returns
 * field_path → value (e.g. door.door_material → CRS once a CRS-only series is
 * chosen).
 */
export function forcedBaseValues(
  comp: ComponentDraft,
  signatures: BaseSignature[],
): Record<string, string> {
  if (signatures.length === 0) return {};
  const paths = baseFieldPaths(signatures);
  const selection = componentBaseSelection(comp, paths);
  const out: Record<string, string> = {};
  for (const fp of paths) {
    if (selection[fp]) continue; // already chosen
    const opts = availableBaseValues(signatures, fp, selection);
    if (opts.length === 1) out[fp] = opts[0];
  }
  return out;
}

/** The most frequent value in a list (ties → first sorted, deterministic). */
function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/**
 * Auto-fill values for base fields that are MANDATORY for pricing (appear in
 * every reachable signature) but not yet chosen — forced values when there's one
 * option, else a sensible default (the most common priceable value). Only runs
 * once the component's series is chosen, and never overrides the series itself,
 * so a non-expert lands on a priceable combination with zero extra picks while
 * everything stays overridable.
 */
export function autoFillBaseValues(
  comp: ComponentDraft,
  signatures: BaseSignature[],
): Record<string, string> {
  if (signatures.length === 0) return {};
  const paths = baseFieldPaths(signatures);
  const seriesPath = SERIES_FIELD_PATH_BY_ENTITY[comp.entityType];
  const selection = componentBaseSelection(comp, paths);
  // Wait until the identity pick (series) is made so defaults are consistent.
  if (seriesPath && !selection[seriesPath]) return {};

  const matches = (working: Record<string, string>) => signatures.filter((sig) =>
    Object.entries(working).every(([k, v]) => !v || sig[k] == null || normVal(sig[k]) === normVal(v)));
  if (matches(selection).length === 0) return {};

  const out: Record<string, string> = {};
  const working = { ...selection };
  // Accumulate each pick into `working` so later fields stay consistent with it
  // (e.g. once gauge is defaulted, jamb depth defaults to a value valid for it).
  for (const fp of paths) {
    if (fp === seriesPath || working[fp]) continue;
    const consistent = matches(working);
    if (consistent.length === 0) continue;
    // Mandatory = present in every reachable signature (missing it blocks pricing).
    const present = consistent.filter((sig) => sig[fp] != null);
    if (present.length !== consistent.length) continue;
    const value = mostCommon(present.map((sig) => sig[fp]));
    if (value) { out[fp] = value; working[fp] = value; }
  }
  return out;
}

/** Whether a builder step should be shown for the current configuration. */
export function isStepVisible(stepId: string, draft: OpeningDraft): boolean {
  switch (stepId) {
    case 'panels':
      return PANEL_CONFIGS.has(draft.configurationType);
    case 'lites':
      return (
        PANEL_CONFIGS.has(draft.configurationType) ||
        draft.doors.some((d) => isGlazedElevation(compVal(d, PATH.door.elevation)))
      );
    default:
      return true;
  }
}
