/**
 * Spec resolver (Release 1).
 *
 * Turns a {@link UserOpeningSpec} (requirements only) into compliant
 * manufacturer constructions. Manufacturer series (DOR-002 / FRM-002) are
 * OUTPUTS here, never inputs:
 *
 *   1. Eliminate product families whose `product_family_capability` predicates
 *      fail any requirement.
 *   2. Resolve door / frame / (panel) construction independently, then validate
 *      the complete assembly.
 *   3. Return plain-language {@link ResolutionCandidate}s (construction, gauge,
 *      core, edge, compliance, price impact). Series codes live only in
 *      `candidate.technical`, shown behind an "audit detail" disclosure.
 *   4. Auto-accept a single compliant candidate; require an estimator choice
 *      when several remain.
 *   5. Route specialty configurations (acoustic / wind / FEMA / blast / bullet)
 *      to an explicit manual-quote path until their rule packs are validated.
 *
 * The core is pure (catalog passed in) so it is fully unit-testable; the DB
 * loader hydrates the catalog from `product_family_capability` /
 * `family_resolution_policy` / `product_family`.
 */

import { supabase } from '@/lib/supabase';
import { coreUpgradeOptionCode } from './builder-logic';
import {
  RESOLVER_VERSION,
  type ConditionOperator,
  type ResolverComponentScope,
  type ResolutionCandidate,
  type ResolutionResult,
  type ResolvedOpeningConfig,
  type ResolvedComponentOption,
  type UserOpeningSpec,
} from '@/types';

// ---------------------------------------------------------------------------
// Catalog shapes (joined from product_family_capability / policy)
// ---------------------------------------------------------------------------

export interface ResolverCapability {
  familyCode: string;
  scope: ResolverComponentScope;
  field: string;
  operator: ConditionOperator;
  value: string | null;
  value2: string | null;
}

export interface ResolverPolicy {
  scope: ResolverComponentScope;
  familyCode: string;
  rank: number;
  autoAccept: boolean;
  label: string | null;
}

export interface ResolverCatalog {
  capabilities: ResolverCapability[];
  policies: ResolverPolicy[];
  catalogVersion: string;
}

export interface ResolveOptions {
  priceBookId?: string | null;
  pricedAsOf?: string | null;
}

// ---------------------------------------------------------------------------
// Series construction (port of SERIES_DERIVATION in builder-logic) — used to
// derive a series from the requested core/edge, the inverse of the builder.
// ---------------------------------------------------------------------------

interface SeriesConstruction { core: string; edge: string }

const SERIES_CONSTRUCTION: Record<string, SeriesConstruction> = {
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
  EP: { core: 'polystyrene', edge: 'embossed' },
};

/** The five performance requirements that mark a specialty opening (Release 1: manual quote). */
const SPECIALTY_FIELDS = [
  'opening.windstorm_design_pressure_requirement',
  'opening.storm_shelter_fema_requirement',
  'opening.stc_rating_and_gasket_type',
  'opening.blast_resistance_requirement',
  'opening.bullet_resistance_level',
] as const;

// ---------------------------------------------------------------------------
// Predicate evaluation
// ---------------------------------------------------------------------------

/** Reads a requirement value, honoring synthetic opening fields. */
function readRequirement(spec: UserOpeningSpec, field: string): string | null {
  if (field in spec.requirements) {
    const v = spec.requirements[field];
    return v == null || v === '' ? null : v;
  }
  switch (field) {
    case 'opening.configuration_type':
      return spec.configurationType;
    case 'opening.fire_label_required':
      return spec.fireLabelRequired ? 'true' : 'false';
    default:
      return null;
  }
}

function eq(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function toNum(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Evaluates one capability predicate against the spec. */
function evalPredicate(spec: UserOpeningSpec, cap: ResolverCapability): boolean {
  const actual = readRequirement(spec, cap.field);
  const value = cap.value;
  switch (cap.operator) {
    case 'EXISTS':
      return actual != null;
    case 'MISSING':
      return actual == null;
    case 'EQ':
      return actual != null && value != null && eq(actual, value);
    case 'NE':
      return value == null || actual == null || !eq(actual, value);
    case 'IN': {
      const set = (value ?? '').split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
      return actual != null && set.includes(actual.trim().toLowerCase());
    }
    case 'NOT_IN': {
      const set = (value ?? '').split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
      return actual == null || !set.includes(actual.trim().toLowerCase());
    }
    case 'GT': { const a = toNum(actual); const b = toNum(value); return a != null && b != null && a > b; }
    case 'GTE': { const a = toNum(actual); const b = toNum(value); return a != null && b != null && a >= b; }
    case 'LT': { const a = toNum(actual); const b = toNum(value); return a != null && b != null && a < b; }
    case 'LTE': { const a = toNum(actual); const b = toNum(value); return a != null && b != null && a <= b; }
    case 'BETWEEN': {
      const a = toNum(actual); const lo = toNum(value); const hi = toNum(cap.value2);
      return a != null && lo != null && hi != null && a >= lo && a <= hi;
    }
    default: {
      const _exhaustive: never = cap.operator;
      return false;
    }
  }
}

/** Families (within a scope) whose every predicate matches the spec. */
function eligibleFamilies(spec: UserOpeningSpec, catalog: ResolverCatalog, scope: ResolverComponentScope): string[] {
  const byFamily = new Map<string, ResolverCapability[]>();
  for (const cap of catalog.capabilities) {
    if (cap.scope !== scope) continue;
    const list = byFamily.get(cap.familyCode) ?? [];
    list.push(cap);
    byFamily.set(cap.familyCode, list);
  }
  const eligible: string[] = [];
  for (const [family, caps] of byFamily) {
    if (caps.every((c) => evalPredicate(spec, c))) eligible.push(family);
  }
  return eligible;
}

function rankOf(catalog: ResolverCatalog, scope: ResolverComponentScope, family: string): number {
  return catalog.policies.find((p) => p.scope === scope && eq(p.familyCode, family))?.rank ?? 100;
}

function labelOf(catalog: ResolverCatalog, scope: ResolverComponentScope, family: string): string | null {
  return catalog.policies.find((p) => p.scope === scope && eq(p.familyCode, family))?.label ?? null;
}

function isSpecialty(spec: UserOpeningSpec): boolean {
  return SPECIALTY_FIELDS.some((f) => (spec.requirements[f] ?? '').trim() !== '');
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolves a user spec into compliant constructions. Pure: pass the catalog in.
 */
export function resolveOpeningSpec(
  spec: UserOpeningSpec,
  catalog: ResolverCatalog,
  options: ResolveOptions = {},
): ResolutionResult {
  const diagnostics: string[] = [];
  const base = {
    resolverVersion: RESOLVER_VERSION,
    catalogVersion: catalog.catalogVersion,
  };

  // Release 1: specialty performance requirements route to manual quote.
  if (isSpecialty(spec)) {
    const which = SPECIALTY_FIELDS.filter((f) => (spec.requirements[f] ?? '').trim() !== '');
    diagnostics.push(`Specialty requirement(s) present (${which.join(', ')}) — routed to manual quote for Release 1.`);
    return { status: 'manual_quote', candidates: [], selected: null, diagnostics, ...base };
  }

  // 1. Eligible door families, narrowed by requested core / edge.
  let doorFamilies = eligibleFamilies(spec, catalog, 'door');
  if (doorFamilies.length === 0) {
    diagnostics.push('No door family satisfies the requirements.');
    return { status: 'invalid', candidates: [], selected: null, diagnostics, ...base };
  }
  const reqCore = readRequirement(spec, 'door.core_type');
  const reqEdge = readRequirement(spec, 'door.edge_seam_construction');
  if (reqCore || reqEdge) {
    const narrowed = doorFamilies.filter((fam) => {
      const c = SERIES_CONSTRUCTION[fam.toUpperCase()];
      if (!c) return false;
      if (reqCore && !eq(c.core, reqCore)) return false;
      if (reqEdge && !eq(c.edge, reqEdge)) return false;
      return true;
    });
    if (narrowed.length > 0) doorFamilies = narrowed;
    else diagnostics.push('No door construction exactly matches the requested core/edge; offering the eligible standard constructions.');
  }
  doorFamilies = [...new Set(doorFamilies)].sort((a, b) => rankOf(catalog, 'door', a) - rankOf(catalog, 'door', b));

  // 2. Eligible frame families by wall construction; pick the top-ranked.
  const frameFamilies = eligibleFamilies(spec, catalog, 'frame')
    .sort((a, b) => rankOf(catalog, 'frame', a) - rankOf(catalog, 'frame', b));
  const frameFamily = frameFamilies[0] ?? null;
  if (!frameFamily) {
    diagnostics.push(`No frame family satisfies wall construction "${readRequirement(spec, 'opening.wall_construction') ?? '(unspecified)'}".`);
    return { status: 'invalid', candidates: [], selected: null, diagnostics, ...base };
  }
  if (frameFamilies.length > 1) {
    diagnostics.push(`Frame resolved to ${frameFamily} (top-ranked of ${frameFamilies.join(', ')}).`);
  }

  // 3. One candidate per compliant door construction, paired with the frame.
  const candidates: ResolutionCandidate[] = doorFamilies.map((doorFamily) =>
    buildCandidate(spec, catalog, doorFamily, frameFamily, reqCore, options),
  );

  if (candidates.length === 1) {
    return { status: 'auto', candidates, selected: candidates[0], diagnostics, ...base };
  }
  diagnostics.push(`${candidates.length} compliant constructions — estimator selection required.`);
  return { status: 'choice_required', candidates, selected: null, diagnostics, ...base };
}

function buildCandidate(
  spec: UserOpeningSpec,
  catalog: ResolverCatalog,
  doorFamily: string,
  frameFamily: string,
  reqCore: string | null,
  options: ResolveOptions,
): ResolutionCandidate {
  const construction = SERIES_CONSTRUCTION[doorFamily.toUpperCase()] ?? null;
  const gauge = spec.requirements['door.door_gauge'] ?? null;
  const core = reqCore ?? construction?.core ?? null;
  const edge = spec.requirements['door.edge_seam_construction'] ?? construction?.edge ?? null;

  const compliance: string[] = [];
  if (spec.fireLabelRequired) compliance.push('Fire-labeled');

  // Derive option/prep codes (Release 1: door core-upgrade adder).
  const options_: ResolvedComponentOption[] = [];
  const upgrade = coreUpgradeOptionCode(doorFamily, core ?? '');
  if (upgrade) {
    options_.push({ scope: 'door', componentId: null, kind: 'option', code: upgrade, source: 'derived', description: `${core} core upgrade` });
  }

  const resolved: ResolvedOpeningConfig = {
    series: { door: doorFamily, frame: frameFamily },
    baseTableId: { door: null, frame: null },
    options: options_,
    ngpProductIds: [],
    hardwareVariantIds: [],
    resolverVersion: RESOLVER_VERSION,
    catalogVersion: catalog.catalogVersion,
    priceBookId: options.priceBookId ?? null,
  };

  const constructionLabel = labelOf(catalog, 'door', doorFamily) ?? construction?.core ?? doorFamily;
  const descParts = [
    constructionLabel,
    gauge ? `${gauge} ga` : null,
    edge ? edge : null,
    spec.fireLabelRequired ? 'fire-labeled' : null,
  ].filter(Boolean);

  return {
    id: `cand-${doorFamily}-${frameFamily}`,
    title: constructionLabel,
    description: descParts.join(', '),
    construction: construction?.edge ?? null,
    gauge,
    core,
    edge,
    compliance,
    priceImpact: rankOf(catalog, 'door', doorFamily) <= 12 ? 'base' : null,
    technical: {
      doorSeries: doorFamily,
      frameSeries: frameFamily,
      panelSeries: null,
      optionCodes: options_.map((o) => o.code),
    },
    resolved,
  };
}

// ---------------------------------------------------------------------------
// DB loader
// ---------------------------------------------------------------------------

/** Rejects if `promise` does not settle within `ms` (prevents indefinite spinners). */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'request'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Loads the resolver catalog (capabilities + policies joined to family codes)
 * for a catalog version. Uses plain queries + an in-JS join (no PostgREST embed)
 * so it cannot stall on join-RLS / relationship resolution, and times out rather
 * than hanging. Returns an empty catalog on any error so callers fall back.
 */
export async function loadResolverCatalog(catalogVersion = 'R1'): Promise<ResolverCatalog> {
  const empty: ResolverCatalog = { capabilities: [], policies: [], catalogVersion };
  try {
    const [famRes, capRes, polRes] = await withTimeout(Promise.all([
      supabase.from('product_family').select('id, family_code'),
      supabase.from('product_family_capability').select('family_id, component_scope, field, operator, value, value2').eq('catalog_version', catalogVersion),
      supabase.from('family_resolution_policy').select('family_id, component_scope, rank, auto_accept, display_label').eq('catalog_version', catalogVersion),
    ]), 15000, 'Resolver catalog load');

    const codeById = new Map<string, string>(
      ((famRes.data ?? []) as Array<{ id: string; family_code: string }>).map((f) => [f.id, f.family_code]),
    );

    const capabilities: ResolverCapability[] = ((capRes.data ?? []) as Array<Record<string, unknown>>)
      .filter((r) => codeById.has(r.family_id as string))
      .map((r) => ({
        familyCode: codeById.get(r.family_id as string)!,
        scope: r.component_scope as ResolverComponentScope,
        field: r.field as string,
        operator: r.operator as ConditionOperator,
        value: (r.value as string | null) ?? null,
        value2: (r.value2 as string | null) ?? null,
      }));
    const policies: ResolverPolicy[] = ((polRes.data ?? []) as Array<Record<string, unknown>>)
      .filter((r) => codeById.has(r.family_id as string))
      .map((r) => ({
        scope: r.component_scope as ResolverComponentScope,
        familyCode: codeById.get(r.family_id as string)!,
        rank: (r.rank as number) ?? 100,
        autoAccept: (r.auto_accept as boolean) ?? true,
        label: (r.display_label as string | null) ?? null,
      }));
    return { capabilities, policies, catalogVersion };
  } catch {
    return empty;
  }
}

/** Convenience: load the catalog and resolve in one call. */
export async function resolveOpeningSpecFromDb(
  spec: UserOpeningSpec,
  options: ResolveOptions & { catalogVersion?: string } = {},
): Promise<ResolutionResult> {
  const catalog = await loadResolverCatalog(options.catalogVersion ?? 'R1');
  return resolveOpeningSpec(spec, catalog, options);
}
