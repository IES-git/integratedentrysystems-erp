/**
 * Normalized opening spec — the engine's single input shape (Phase 3).
 *
 * The unified builder (Phase 4) and live-pricing both produce this structure.
 * It is a denormalized snapshot of one opening: its configuration, dimensions,
 * the priceable components (doors / frame / panels / lites), the selected
 * hardware, and the optional keying / access-control sub-builds.
 *
 * Field maps are keyed by BOTH the machine `field_path` (e.g.
 * `door.door_series_construction`) and the spec `field_id` (e.g. `DOR-002`) so a
 * `rule_condition` can reference either form. See `spec_field_mapping`.
 */

import type {
  OpeningConfigurationType,
  RuleEntityType,
} from '@/types';

/** A single resolved spec value. Dimensions are stored raw (string) + parsed. */
export type SpecValue = string | number | boolean | null;

/** One priceable component within an opening (a door leaf, the frame, a panel…). */
export interface SpecComponent {
  /** Local builder id or persisted estimate_items.id. */
  id: string;
  entityType: RuleEntityType;
  label: string;
  /** How many identical copies of this component the opening contains. */
  quantity: number;
  /** Option/series code used for `item_or_option_code` matching, if known. */
  code: string | null;
  /**
   * Field map keyed by field_path AND field_id. Values are pre-normalized
   * (dimensions in inches as numbers where applicable).
   */
  fields: Record<string, SpecValue>;
}

/** A hardware category requirement filled (or to be filled) with a variant. */
export interface HardwareSelection {
  /** Canonical hardware category (matches hardware_set_item.category / crosswalk). */
  category: string;
  /** Chosen hardware_variant id, or null when not yet selected. */
  variantId: string | null;
  /** Resolved quantity for this opening (already expanded from the formula). */
  quantity: number;
  /** True when the set template marks this category required. */
  required: boolean;
  /** Free-form selection filters the user applied (function/finish/size…). */
  selectedFunction?: string | null;
  selectedFinish?: string | null;
  selectedSize?: string | null;
  selectedHand?: string | null;
  selectedRating?: string | null;
  /** Origin: 'set_template' (auto) or 'manual'. */
  source?: 'set_template' | 'manual';
}

export interface KeyingInput {
  format: string | null;
  keyway: string | null;
  masterKeyHierarchy?: Record<string, unknown> | null;
  constructionCoreStrategy?: string | null;
  keyedCylinderCount?: number | null;
  notes?: string | null;
}

export interface AccessControlInput {
  reader?: string | null;
  lockStrike?: string | null;
  powerTransfer?: string | null;
  powerSupply?: string | null;
  dps?: string | null;
  panelIo?: string | null;
  cableRequirements?: string | null;
  components?: Record<string, unknown>;
  notes?: string | null;
}

/** The complete engine input for a single opening. */
export interface NormalizedOpeningSpec {
  /** estimate_openings.id when persisted, else a local id. */
  openingId: string | null;
  estimateId: string | null;
  configurationType: OpeningConfigurationType;
  leafCount: number;
  /** Number of identical openings (multiplies the whole build-up). */
  quantity: number;
  openingWidthIn: number | null;
  openingHeightIn: number | null;
  wall?: string | null;
  fireLabelRequired?: boolean;
  /** Opening-level field map (config / performance fields), keyed by path + id. */
  fields: Record<string, SpecValue>;
  components: SpecComponent[];
  hardware: HardwareSelection[];
  keying?: KeyingInput | null;
  accessControl?: AccessControlInput | null;
}

/** Version pinning + routing options for an engine run. */
export interface EngineOptions {
  /** Immutable price_book_document version to price against. */
  priceBookDocumentId: string | null;
  /** Effective date used to filter price rules (defaults to today). */
  pricedAsOf?: string | null;
  /** Hardware sell rule selection. */
  customerClass?: string | null;
  companyId?: string | null;
  /** Persist resulting lines + manual quotes. Defaults to false (preview). */
  persist?: boolean;
  /** Confidence below this routes a matched rule to manual quote. 0..1. */
  minConfidence?: number;
  /**
   * Maps a draft component id (spec.components[].id) → the real estimate_items.id
   * it was saved as, so persisted estimate_line rows carry a valid component_id
   * FK instead of null. Supplied by the deterministic save flow (Phase 5).
   */
  componentIdMap?: Map<string, string>;
}

/**
 * Reads a spec value by field_path or field_id, checking the component first
 * then the opening-level fields, then a small set of well-known synthetic keys.
 */
export function readField(
  spec: NormalizedOpeningSpec,
  component: SpecComponent | null,
  key: string,
): SpecValue {
  if (component && key in component.fields) return component.fields[key];
  if (key in spec.fields) return spec.fields[key];
  // Well-known synthetic opening fields addressable from conditions.
  switch (key) {
    case 'opening.configuration_type':
    case 'OPN-005':
      return spec.configurationType;
    case 'opening.leaf_count':
    case 'OPN-008':
      return spec.leafCount;
    case 'opening.width_in':
      return spec.openingWidthIn;
    case 'opening.height_in':
      return spec.openingHeightIn;
    case 'opening.quantity':
      return spec.quantity;
    case 'opening.fire_label_required':
      return spec.fireLabelRequired ?? false;
    default:
      return null;
  }
}
