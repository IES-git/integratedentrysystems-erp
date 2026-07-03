/**
 * Estimate spec summary (list-view quick reference).
 *
 * Spec-driven estimates carry their distinguishing selections in
 * `estimate_openings.spec_snapshot` (an OpeningDraft with `effectiveFields`),
 * NOT in the `estimate_items` labels/codes. This module reads the primary
 * opening's snapshot and produces short, human-readable door / frame / size
 * descriptors so the Estimates list is easy to tell apart at a glance.
 */

import type { EstimateSpecSummary } from '@/types';
import { normalizeCompactNominalDimension } from '@/components/pricing/dimension-utils';

/** Loosely-typed view of a persisted spec_snapshot component. */
interface SnapshotComponent {
  effectiveFields?: Record<string, string> | null;
  fields?: Record<string, string> | null;
  quantity?: number;
}

/** Loosely-typed view of a persisted spec_snapshot opening. */
interface OpeningSnapshot {
  doors?: SnapshotComponent[] | null;
  frames?: SnapshotComponent[] | null;
  configurationType?: string | null;
  openingWidth?: string | null;
  openingHeight?: string | null;
  fireLabelRequired?: boolean | null;
  openingFields?: Record<string, string> | null;
}

/** One opening row from the DB carrying its sort order + raw snapshot JSON. */
export interface OpeningSnapshotRow {
  sortOrder: number;
  snapshot: unknown;
}

/** Reads a component field, preferring the engine-effective value. */
function field(component: SnapshotComponent | undefined, key: string): string | null {
  if (!component) return null;
  const raw = component.effectiveFields?.[key] ?? component.fields?.[key];
  const value = raw == null ? '' : String(raw).trim();
  return value ? value : null;
}

/**
 * Title-cases a value only when it is entirely lowercase, so acronyms and
 * codes (e.g. "CRS", "3S") keep their casing while "steel stiffened" becomes
 * "Steel Stiffened".
 */
function pretty(value: string | null): string | null {
  if (!value) return null;
  if (value === value.toLowerCase()) {
    return value.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return value;
}

/** "18" → "18ga"; passes through anything that already has letters. */
function gauge(value: string | null): string | null {
  if (!value) return null;
  return /^\d+$/.test(value) ? `${value}ga` : value;
}

/** Returns compact nominal notation such as "30" / "70"; leaves custom text untouched. */
function compactNominal(value: string | null): string | null {
  if (!value) return null;
  return normalizeCompactNominalDimension(value) ?? value;
}

function joinParts(parts: (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length ? kept.join(' · ') : null;
}

function describeDoor(door: SnapshotComponent | undefined): string | null {
  return joinParts([
    field(door, 'door.door_series_construction'),
    gauge(field(door, 'door.door_gauge')),
    pretty(field(door, 'door.door_material')),
    pretty(field(door, 'door.core_type')),
  ]);
}

function describeFrame(frame: SnapshotComponent | undefined): string | null {
  const jamb = field(frame, 'frame.jamb_depth');
  return joinParts([
    field(frame, 'frame.frame_series'),
    field(frame, 'frame.frame_type'),
    pretty(field(frame, 'frame.frame_material')),
    jamb ? `${jamb}" jamb` : null,
  ]);
}

function describeConfig(configurationType: string | null | undefined): string | null {
  if (!configurationType) return null;
  return configurationType
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function describeSize(opening: OpeningSnapshot, door: SnapshotComponent | undefined): string | null {
  const width = field(door, 'door.nominal_door_width') ?? opening.openingWidth ?? null;
  const height = field(door, 'door.nominal_door_height') ?? opening.openingHeight ?? null;
  const w = compactNominal(width);
  const h = compactNominal(height);
  if (w && h) return `${w} × ${h}`;
  return w || h || null;
}

function asOpeningSnapshot(value: unknown): OpeningSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  return value as OpeningSnapshot;
}

/**
 * Builds a quick-reference spec summary from an estimate's opening snapshots.
 * Uses the primary opening (lowest sort_order) for the headline door / frame /
 * size, since the list already shows the total opening count separately.
 * Returns null when no opening carries a usable snapshot (legacy estimates).
 */
export function buildEstimateSpecSummary(
  rows: OpeningSnapshotRow[],
): EstimateSpecSummary | null {
  const snapshots = rows
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => asOpeningSnapshot(r.snapshot))
    .filter((s): s is OpeningSnapshot => s != null);

  if (snapshots.length === 0) return null;

  const primary = snapshots[0];
  const door = primary.doors?.[0];
  const frame = primary.frames?.[0];

  const summary: EstimateSpecSummary = {
    door: describeDoor(door),
    frame: describeFrame(frame),
    size: describeSize(primary, door),
    config: describeConfig(primary.configurationType),
    wall: pretty(field({ fields: primary.openingFields }, 'opening.wall_construction')),
    fireLabeled: Boolean(primary.fireLabelRequired),
  };

  const hasAny =
    summary.door || summary.frame || summary.size || summary.config || summary.wall || summary.fireLabeled;
  return hasAny ? summary : null;
}
