import { describe, it, expect } from 'vitest';
import {
  resolveOpeningSpec,
  type ResolverCatalog,
  type ResolverCapability,
  type ResolverPolicy,
} from '@/lib/cpq/resolver';
import { RESOLVER_VERSION, type UserOpeningSpec } from '@/types';

const SPECIALTY = [
  'opening.windstorm_design_pressure_requirement',
  'opening.storm_shelter_fema_requirement',
  'opening.stc_rating_and_gasket_type',
  'opening.blast_resistance_requirement',
  'opening.bullet_resistance_level',
];

function cap(familyCode: string, scope: ResolverCapability['scope'], field: string, operator: ResolverCapability['operator'], value: string | null = null): ResolverCapability {
  return { familyCode, scope, field, operator, value, value2: null };
}

/** Minimal catalog mirroring the R1 seed for H/HF/CH doors and F/DW frames. */
function catalog(): ResolverCatalog {
  const capabilities: ResolverCapability[] = [];
  for (const fam of ['H', 'HF', 'CH']) {
    for (const f of SPECIALTY) capabilities.push(cap(fam, 'door', f, 'MISSING'));
  }
  capabilities.push(cap('F', 'frame', 'opening.wall_construction', 'IN', 'masonry'));
  capabilities.push(cap('DW', 'frame', 'opening.wall_construction', 'IN', 'steel stud|wood stud|drywall'));
  // specialty door requires its field
  capabilities.push(cap('W50', 'door', 'opening.windstorm_design_pressure_requirement', 'EXISTS'));

  const policies: ResolverPolicy[] = [
    { scope: 'door', familyCode: 'H', rank: 10, autoAccept: true, label: 'Honeycomb core, lockseam' },
    { scope: 'door', familyCode: 'HF', rank: 12, autoAccept: true, label: 'Honeycomb core, seamless edge' },
    { scope: 'door', familyCode: 'CH', rank: 30, autoAccept: true, label: 'Continuous-weld seamless' },
    { scope: 'frame', familyCode: 'F', rank: 10, autoAccept: true, label: 'Masonry face-welded frame' },
    { scope: 'frame', familyCode: 'DW', rank: 20, autoAccept: true, label: 'Drywall knock-down frame' },
  ];
  return { capabilities, policies, catalogVersion: 'R1' };
}

function spec(requirements: Record<string, string>): UserOpeningSpec {
  return {
    openingId: null, estimateId: null, name: 'O', quantity: 1,
    configurationType: 'single', leafCount: 1, openingWidth: '3-0', openingHeight: '7-0',
    fireLabelRequired: false, requirements,
  };
}

describe('resolveOpeningSpec', () => {
  it('auto-accepts a single compliant construction (core narrows to one series)', () => {
    const r = resolveOpeningSpec(spec({ 'opening.wall_construction': 'masonry', 'door.core_type': 'Honeycomb', 'door.edge_seam_construction': 'Lockseam' }), catalog());
    expect(r.status).toBe('auto');
    expect(r.selected?.technical.doorSeries).toBe('H');
    expect(r.selected?.technical.frameSeries).toBe('F');
    expect(r.resolverVersion).toBe(RESOLVER_VERSION);
  });

  it('requires estimator choice when several constructions comply', () => {
    const r = resolveOpeningSpec(spec({ 'opening.wall_construction': 'masonry' }), catalog());
    expect(r.status).toBe('choice_required');
    expect(r.candidates.length).toBeGreaterThan(1);
    // series are present only in technical detail, ranked best-first
    expect(r.candidates[0].technical.doorSeries).toBe('H');
    expect(r.selected).toBeNull();
  });

  it('routes specialty requirements to manual quote', () => {
    const r = resolveOpeningSpec(spec({ 'opening.wall_construction': 'masonry', 'opening.windstorm_design_pressure_requirement': 'DP+50' }), catalog());
    expect(r.status).toBe('manual_quote');
    expect(r.candidates).toHaveLength(0);
  });

  it('is invalid when no frame satisfies the wall construction', () => {
    const r = resolveOpeningSpec(spec({ 'opening.wall_construction': 'unobtainium' }), catalog());
    expect(r.status).toBe('invalid');
  });

  it('derives a hidden core-upgrade option code for an upgraded core', () => {
    const r = resolveOpeningSpec(spec({ 'opening.wall_construction': 'masonry', 'door.core_type': 'polystyrene', 'door.edge_seam_construction': 'Lockseam' }), catalog());
    // H + polystyrene -> HP adder code, surfaced only in technical detail
    const codes = r.candidates.flatMap((c) => c.technical.optionCodes);
    expect(codes).toContain('HP');
  });

  it('keeps the BASE series and puts the core upgrade in options (CHP is not a series)', () => {
    // Polystyrene + continuous weld must resolve to base series CH with a CHP
    // core-upgrade option — NOT a non-existent "CHP" base series.
    const r = resolveOpeningSpec(spec({ 'opening.wall_construction': 'masonry', 'door.core_type': 'polystyrene', 'door.edge_seam_construction': 'continuous weld' }), catalog());
    expect(r.status).toBe('auto');
    expect(r.selected?.technical.doorSeries).toBe('CH');
    expect(r.selected?.technical.optionCodes).toContain('CHP');
  });

  it('resolves a steel-stiffened core to the stiffened base family (C), not a glued series', () => {
    const r = resolveOpeningSpec(spec({ 'opening.wall_construction': 'masonry', 'door.core_type': 'steel stiffened', 'door.edge_seam_construction': 'continuous weld' }), {
      ...catalog(),
      // add C as an eligible base family for this test
      capabilities: [
        ...catalog().capabilities,
        ...SPECIALTY.map((f) => cap('C', 'door', f, 'MISSING')),
      ],
      policies: [...catalog().policies, { scope: 'door', familyCode: 'C', rank: 42, autoAccept: true, label: 'Steel-stiffened, continuous weld' }],
    });
    expect(r.status).toBe('auto');
    expect(r.selected?.technical.doorSeries).toBe('C');
  });
});
