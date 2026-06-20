import { describe, it, expect } from 'vitest';
import {
  deriveBuilderContext,
  derivedLeafCount,
  mergeDerived,
  fieldTier,
  allowedEnumOptions,
  isStepVisible,
  optionLabelsForField,
  deriveHardwareIntelligence,
  validateBuilderIntegrity,
  type OptionDescriptors,
} from '@/lib/cpq/builder-logic';
import { hingesPerLeaf } from '@/components/estimates/wizard/opening-rules';
import { createOpeningDraft, buildNormalizedSpec, type OpeningDraft, type ComponentDraft } from '@/lib/cpq/opening-spec';
import type { SpecFieldWithPath } from '@/lib/cpq-catalog-api';
import type { SpecFieldEntity } from '@/types';

let seq = 0;
function door(fields: Record<string, string> = {}, familyCode: string | null = null): ComponentDraft {
  return { id: `d${seq++}`, entityType: 'door', label: 'Door', familyCode, quantity: 1, fields };
}
function frame(fields: Record<string, string> = {}): ComponentDraft {
  return { id: `f${seq++}`, entityType: 'frame', label: 'Frame', familyCode: null, quantity: 1, fields };
}

function makeField(
  fieldId: string,
  entity: SpecFieldEntity,
  partial: Partial<SpecFieldWithPath> = {},
): SpecFieldWithPath {
  return {
    id: fieldId,
    fieldId,
    entity,
    category: null,
    fieldLabel: fieldId,
    dataType: 'Enum',
    requiredWhen: 'Always',
    allowedValues: null,
    pricingLogic: null,
    pdfPages: null,
    pricedBy: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    fieldPath: null,
    enumOptions: [],
    ...partial,
  };
}

describe('derivedLeafCount', () => {
  it('maps configuration to leaf count', () => {
    expect(derivedLeafCount('single', 1)).toBe(1);
    expect(derivedLeafCount('dutch', 5)).toBe(1);
    expect(derivedLeafCount('pair', 1)).toBe(2);
    expect(derivedLeafCount('double_egress', 1)).toBe(2);
    expect(derivedLeafCount('communicating', 1)).toBe(2);
    expect(derivedLeafCount('specialty', 3)).toBe(3); // falls back to draft value
  });
});

describe('deriveBuilderContext size cascade', () => {
  it('flows opening size to a single door and the frame verbatim', () => {
    const d = door({ 'door.door_gauge': '18', 'door.door_material': 'CRS' });
    const f = frame();
    const draft: OpeningDraft = createOpeningDraft({
      configurationType: 'single',
      openingWidth: '36',
      openingHeight: '84',
      doors: [d],
      frames: [f],
    });
    const ctx = deriveBuilderContext(draft);
    expect(ctx.leafCount).toBe(1);
    expect(ctx.derivedByComponent[d.id]['door.nominal_door_width'].value).toBe('36');
    expect(ctx.derivedByComponent[d.id]['door.nominal_door_height'].value).toBe('84');
    expect(ctx.derivedByComponent[f.id]['frame.nominal_frame_width'].value).toBe('36');
    expect(ctx.derivedByComponent[f.id]['frame.nominal_frame_height'].value).toBe('84');
  });

  it('splits the width per leaf for a pair', () => {
    const d = door();
    const draft = createOpeningDraft({
      configurationType: 'pair',
      openingWidth: '6-0', // 72"
      openingHeight: '7-0',
      doors: [d],
    });
    const ctx = deriveBuilderContext(draft);
    expect(ctx.leafCount).toBe(2);
    expect(ctx.derivedByComponent[d.id]['door.nominal_door_width'].value).toBe('3-0'); // 36"
    expect(ctx.derivedByComponent[d.id]['door.nominal_door_height'].value).toBe('7-0');
    expect(ctx.astragalApplies).toBe(true);
  });
});

describe('deriveBuilderContext shared attributes + series', () => {
  it('inherits frame gauge/material/hand from the door and core/edge from series', () => {
    const d = door({ 'door.door_gauge': '16', 'door.door_material': 'galvannealed', 'door.door_hand': 'LH' }, 'HF');
    const f = frame();
    const draft = createOpeningDraft({ doors: [d], frames: [f], openingWidth: '36', openingHeight: '84' });
    const ctx = deriveBuilderContext(draft);
    expect(ctx.derivedByComponent[f.id]['frame.frame_gauge'].value).toBe('16');
    expect(ctx.derivedByComponent[f.id]['frame.frame_material'].value).toBe('galvannealed');
    expect(ctx.derivedByComponent[f.id]['frame.frame_hand'].value).toBe('LH');
    expect(ctx.derivedByComponent[d.id]['door.core_type'].value).toBe('Honeycomb');
    expect(ctx.derivedByComponent[d.id]['door.edge_seam_construction'].value).toBe('seamless tack-and-fill');
  });

  it('derives jamb depth and fire labels', () => {
    const d = door();
    const f = frame();
    const draft = createOpeningDraft({
      doors: [d],
      frames: [f],
      fireLabelRequired: true,
      openingFields: { 'opening.finished_wall_thickness_jamb_depth': '5 3/4' },
    });
    const ctx = deriveBuilderContext(draft);
    expect(ctx.derivedByComponent[f.id]['frame.jamb_depth'].value).toBe('5 3/4');
    expect(ctx.derivedByComponent[d.id]['door.door_label_required_specific_designation'].value).toBe('Labeled');
    expect(ctx.derivedByComponent[f.id]['frame.frame_label_required_designation'].value).toBe('Labeled');
  });
});

describe('mergeDerived', () => {
  it('lets user overrides win over derived values', () => {
    const merged = mergeDerived(
      { 'door.nominal_door_width': '40' },
      { 'door.nominal_door_width': { value: '36', reason: 'x' }, 'door.core_type': { value: 'Honeycomb', reason: 'y' } },
    );
    expect(merged['door.nominal_door_width']).toBe('40'); // override wins
    expect(merged['door.core_type']).toBe('Honeycomb'); // derived flows through
  });
});

describe('fieldTier', () => {
  const baseDraft = () => createOpeningDraft({ doors: [door()], frames: [frame()] });

  it('marks curated fields essential and others advanced', () => {
    const draft = baseDraft();
    const ctx = deriveBuilderContext(draft);
    expect(fieldTier(makeField('DOR-002', 'door'), draft, ctx, draft.doors[0])).toBe('essential');
    expect(fieldTier(makeField('DOR-061', 'door'), draft, ctx, draft.doors[0])).toBe('advanced');
  });

  it('hides astragal for single, reveals it for pairs', () => {
    const single = baseDraft();
    const singleCtx = deriveBuilderContext(single);
    expect(fieldTier(makeField('DOR-014', 'door'), single, singleCtx, single.doors[0])).toBe('hidden');

    const pair = createOpeningDraft({ configurationType: 'pair', doors: [door()], frames: [frame()] });
    const pairCtx = deriveBuilderContext(pair);
    expect(fieldTier(makeField('DOR-014', 'door'), pair, pairCtx, pair.doors[0])).toBe('essential');
  });

  it('reveals lite-kit fields only when the door is glazed', () => {
    const flush = createOpeningDraft({ doors: [door({ 'door.door_face_elevation_style': 'Flush' })] });
    const flushCtx = deriveBuilderContext(flush);
    expect(fieldTier(makeField('DOR-016', 'door'), flush, flushCtx, flush.doors[0])).toBe('hidden');

    const glass = createOpeningDraft({ doors: [door({ 'door.door_face_elevation_style': 'full glass' })] });
    const glassCtx = deriveBuilderContext(glass);
    expect(fieldTier(makeField('DOR-016', 'door'), glass, glassCtx, glass.doors[0])).toBe('essential');
  });

  it('reveals fire label fields only when labeled', () => {
    const noFire = baseDraft();
    const noFireCtx = deriveBuilderContext(noFire);
    expect(fieldTier(makeField('OPN-015', 'opening'), noFire, noFireCtx)).toBe('hidden');

    const fire = createOpeningDraft({ fireLabelRequired: true, doors: [door()] });
    const fireCtx = deriveBuilderContext(fire);
    expect(fieldTier(makeField('OPN-015', 'opening'), fire, fireCtx)).toBe('essential');
  });
});

describe('allowedEnumOptions', () => {
  const doorSeries = makeField('DOR-002', 'door', {
    enumOptions: ['H', 'HF', 'HP', 'W50', 'W70', 'FEMA', 'STC', 'SBR', 'BR752'],
  });

  it('excludes specialty series by default', () => {
    const draft = createOpeningDraft({ doors: [door()] });
    const ctx = deriveBuilderContext(draft);
    const allowed = allowedEnumOptions(doorSeries, draft, ctx, draft.doors[0]);
    expect(allowed).toEqual(['H', 'HF', 'HP']);
  });

  it('restricts series to windstorm families when windstorm is set', () => {
    const draft = createOpeningDraft({
      doors: [door()],
      openingFields: { 'opening.windstorm_design_pressure_requirement': 'Piocane 50' },
    });
    const ctx = deriveBuilderContext(draft);
    const allowed = allowedEnumOptions(doorSeries, draft, ctx, draft.doors[0]);
    expect(allowed).toEqual(['W50', 'W70']);
  });

  it('filters frame series by wall construction', () => {
    const frameSeries = makeField('FRM-002', 'frame', {
      enumOptions: ['F', 'DW', 'F-BL', 'DWBL', 'WF', 'SPF', 'STK'],
    });
    const draft = createOpeningDraft({
      frames: [frame()],
      openingFields: { 'opening.wall_construction': 'masonry' },
    });
    const ctx = deriveBuilderContext(draft);
    expect(allowedEnumOptions(frameSeries, draft, ctx, draft.frames[0])).toEqual(['F', 'F-BL']);
  });
});

describe('buildNormalizedSpec cascade (engine input)', () => {
  const mappings = [
    { id: '1', fieldId: 'DOR-008', fieldPath: 'door.nominal_door_width', valueType: null, notes: null, createdAt: '' },
    { id: '2', fieldId: 'DOR-009', fieldPath: 'door.nominal_door_height', valueType: null, notes: null, createdAt: '' },
    { id: '3', fieldId: 'FRM-008', fieldPath: 'frame.nominal_frame_width', valueType: null, notes: null, createdAt: '' },
    { id: '4', fieldId: 'FRM-009', fieldPath: 'frame.nominal_frame_height', valueType: null, notes: null, createdAt: '' },
  ];

  it('flows the opening size into door and frame fields without re-entry', () => {
    const d = door({ 'door.door_series_construction': 'H', 'door.door_gauge': '18' });
    const f = frame({ 'frame.frame_series': 'F' });
    const draft = createOpeningDraft({
      configurationType: 'single', openingWidth: '36', openingHeight: '84', doors: [d], frames: [f],
    });
    const spec = buildNormalizedSpec(draft, mappings);
    const doorComp = spec.components.find((c) => c.entityType === 'door')!;
    const frameComp = spec.components.find((c) => c.entityType === 'frame')!;
    expect(doorComp.fields['door.nominal_door_width']).toBe('36');
    expect(doorComp.fields['door.nominal_door_height']).toBe('84');
    expect(frameComp.fields['frame.nominal_frame_width']).toBe('36');
    expect(frameComp.fields['frame.nominal_frame_height']).toBe('84');
    // dual-keyed by field_id too
    expect(doorComp.fields['DOR-008']).toBe('36');
  });

  it('honours an explicit door-size override over the cascade', () => {
    const d = door({ 'door.nominal_door_width': '40' });
    const draft = createOpeningDraft({ configurationType: 'single', openingWidth: '36', openingHeight: '84', doors: [d] });
    const spec = buildNormalizedSpec(draft, mappings);
    const doorComp = spec.components.find((c) => c.entityType === 'door')!;
    expect(doorComp.fields['door.nominal_door_width']).toBe('40');
  });
});

describe('isStepVisible', () => {
  it('hides panels and lites for a plain single door', () => {
    const draft = createOpeningDraft({ configurationType: 'single', doors: [door({ 'door.door_face_elevation_style': 'Flush' })] });
    expect(isStepVisible('panels', draft)).toBe(false);
    expect(isStepVisible('lites', draft)).toBe(false);
    expect(isStepVisible('doors', draft)).toBe(true);
  });

  it('shows panels for sidelite/transom configs', () => {
    const draft = createOpeningDraft({ configurationType: 'sidelite_transom', doors: [door()] });
    expect(isStepVisible('panels', draft)).toBe(true);
    expect(isStepVisible('lites', draft)).toBe(true);
  });

  it('shows lites when a door is glazed', () => {
    const draft = createOpeningDraft({ configurationType: 'single', doors: [door({ 'door.door_face_elevation_style': 'vision' })] });
    expect(isStepVisible('lites', draft)).toBe(true);
  });
});

describe('hingesPerLeaf (NFPA 80 / BHMA)', () => {
  it('returns the standard counts by height', () => {
    expect(hingesPerLeaf(60)).toBe(2);
    expect(hingesPerLeaf(61)).toBe(3);
    expect(hingesPerLeaf(84)).toBe(3);
    expect(hingesPerLeaf(90)).toBe(3);
    expect(hingesPerLeaf(91)).toBe(4);
    expect(hingesPerLeaf(120)).toBe(4);
    expect(hingesPerLeaf(121)).toBe(5);
    expect(hingesPerLeaf(null)).toBe(3); // unknown -> commercial default
  });
});

describe('deriveBuilderContext hinge quantity', () => {
  it('auto-fills door & frame hinge quantity from height', () => {
    const d = door();
    const f = frame();
    const draft = createOpeningDraft({ openingHeight: '7-0', doors: [d], frames: [f] }); // 84"
    const ctx = deriveBuilderContext(draft);
    expect(ctx.derivedByComponent[d.id]['door.hinge_quantity'].value).toBe('3');
    expect(ctx.derivedByComponent[f.id]['frame.hinge_quantity'].value).toBe('3');
  });

  it('uses 4 hinges over 90 inches', () => {
    const d = door();
    const draft = createOpeningDraft({ openingHeight: '8-0', doors: [d] }); // 96"
    const ctx = deriveBuilderContext(draft);
    expect(ctx.derivedByComponent[d.id]['door.hinge_quantity'].value).toBe('4');
  });

  it('suppresses hinge quantity when a continuous hinge is chosen', () => {
    const d = door({ 'door.hinge_preparation_type': 'CONH' });
    const draft = createOpeningDraft({ openingHeight: '84', doors: [d] });
    const ctx = deriveBuilderContext(draft);
    expect(ctx.derivedByComponent[d.id]['door.hinge_quantity']).toBeUndefined();
    // and the field is hidden
    expect(fieldTier(makeField('DOR-036', 'door'), draft, ctx, draft.doors[0])).toBe('hidden');
  });
});

describe('optionLabelsForField', () => {
  const descriptors: OptionDescriptors = new Map([
    ['door', new Map([['H', 'Honeycomb core, full-flush']])],
  ]);

  it('builds CODE - description labels from DB descriptors', () => {
    const field = makeField('DOR-002', 'door', { enumOptions: ['H', 'HP'] });
    const labels = optionLabelsForField(field, descriptors);
    expect(labels?.['H']).toBe('H — Honeycomb core, full-flush');
  });

  it('prefers curated overrides (rabbet type)', () => {
    const field = makeField('FRM-007', 'frame', { enumOptions: ['ER', 'DE'] });
    const labels = optionLabelsForField(field, null);
    expect(labels?.['ER']).toBe('ER — Equal rabbet');
    expect(labels?.['DE']).toBe('DE — Double egress');
  });
});

describe('frame compatibility cascade', () => {
  it('filters frame type by configuration', () => {
    const single = createOpeningDraft({ configurationType: 'single', frames: [frame()] });
    const ctxS = deriveBuilderContext(single);
    const field = makeField('FRM-005', 'frame', { enumOptions: ['3S', '3P', '4S', 'H', 'HJ'] });
    expect(allowedEnumOptions(field, single, ctxS, single.frames[0])).toEqual(['3S']);

    const pair = createOpeningDraft({ configurationType: 'pair', frames: [frame()] });
    expect(allowedEnumOptions(field, pair, deriveBuilderContext(pair), pair.frames[0])).toEqual(['3P']);
  });

  it('pairs a specialty door series to its frame series', () => {
    const d = door({ 'door.door_series_construction': 'W50' });
    const f = frame();
    const draft = createOpeningDraft({ doors: [d], frames: [f] });
    const ctx = deriveBuilderContext(draft);
    expect(ctx.derivedByComponent[f.id]['frame.frame_series'].value).toBe('F50');
    const field = makeField('FRM-002', 'frame', { enumOptions: ['F', 'DW', 'F50', 'F70'] });
    expect(allowedEnumOptions(field, draft, ctx, f)).toEqual(['F50']);
  });

  it('forces cased-opening rabbet when there is no door', () => {
    const draft = createOpeningDraft({ configurationType: 'specialty', doors: [], frames: [frame()] });
    const field = makeField('FRM-007', 'frame', { enumOptions: ['ER', 'UR', 'SR', 'CO', 'DE'] });
    expect(allowedEnumOptions(field, draft, deriveBuilderContext(draft), draft.frames[0])).toEqual(['CO']);
  });
});

describe('cross-entity frame prep flow', () => {
  it('flows door hinge prep, lock->strike, and closer onto the frame', () => {
    const d = door({
      'door.hinge_preparation_type': '450',
      'door.primary_lock_exit_device_preparation': 'CYL',
      'door.closer_holder_preparation': 'STD',
    });
    const f = frame();
    const draft = createOpeningDraft({ openingHeight: '7-0', doors: [d], frames: [f] });
    const ctx = deriveBuilderContext(draft);
    const fm = ctx.derivedByComponent[f.id];
    expect(fm['frame.hinge_preparation_type'].value).toBe('450');
    expect(fm['frame.primary_strike_preparation'].value).toBe('478');
    expect(fm['frame.closer_holder_coordinator_preparation'].value).toBe('REG');
    // and those frame fields are revealed once the door driver is set
    expect(fieldTier(makeField('FRM-018', 'frame'), draft, ctx, f)).toBe('essential');
    expect(fieldTier(makeField('FRM-015', 'frame'), draft, ctx, f)).toBe('essential');
    expect(fieldTier(makeField('FRM-022', 'frame'), draft, ctx, f)).toBe('essential');
  });

  it('hides frame strike/closer when the door has no lock/closer', () => {
    const draft = createOpeningDraft({ doors: [door()], frames: [frame()] });
    const ctx = deriveBuilderContext(draft);
    expect(fieldTier(makeField('FRM-015', 'frame'), draft, ctx, draft.frames[0])).toBe('hidden');
    expect(fieldTier(makeField('FRM-022', 'frame'), draft, ctx, draft.frames[0])).toBe('hidden');
  });
});

describe('deriveHardwareIntelligence', () => {
  it('auto-adds a closer and requires positive latch on a fire door', () => {
    const draft = createOpeningDraft({ configurationType: 'single', fireLabelRequired: true, doors: [door()] });
    const intel = deriveHardwareIntelligence(draft, []);
    expect(intel.autoAddCategories.some((a) => a.category === 'closers_and_arms')).toBe(true);
    expect(intel.conflicts.some((c) => c.code === 'FIRE_NO_ACTIVE_LATCH')).toBe(true);
  });

  it('flags a deadbolt on an exit-device door', () => {
    const draft = createOpeningDraft({ configurationType: 'single', doors: [door()] });
    const intel = deriveHardwareIntelligence(draft, [
      { category: 'exit_devices' },
      { category: 'cylindrical_mortise_locks_and_deadbolts', selectedFunction: 'Deadbolt' },
    ]);
    expect(intel.conflicts.some((c) => c.code === 'DEADBOLT_ON_EGRESS')).toBe(true);
  });

  it('auto-adds inactive-leaf flush bolts and warns on coordinator for a pair with closers', () => {
    const draft = createOpeningDraft({ configurationType: 'pair', doors: [door(), door()] });
    const intel = deriveHardwareIntelligence(draft, [{ category: 'closers_and_arms' }]);
    expect(intel.autoAddCategories.some((a) => a.category === 'inactive_leaf_hardware')).toBe(true);
    expect(intel.conflicts.some((c) => c.code === 'PAIR_NEEDS_COORDINATOR')).toBe(true);
  });

  it('is clean for a simple non-fire single with a lockset', () => {
    const draft = createOpeningDraft({ configurationType: 'single', doors: [door()] });
    const intel = deriveHardwareIntelligence(draft, [{ category: 'cylindrical_mortise_locks_and_deadbolts', selectedFunction: 'Entry' }]);
    expect(intel.conflicts.filter((c) => c.severity === 'block')).toHaveLength(0);
  });
});

describe('validateBuilderIntegrity (foolproof gate)', () => {
  it('blocks a specialty door paired with the wrong frame series, then clears', () => {
    const bad = createOpeningDraft({
      doors: [door({ 'door.door_series_construction': 'W50' })],
      frames: [frame({ 'frame.frame_series': 'F' })],
    });
    expect(validateBuilderIntegrity(bad).some((i) => i.code === 'SPECIALTY_FRAME_MISMATCH' && i.severity === 'block')).toBe(true);

    const good = createOpeningDraft({
      doors: [door({ 'door.door_series_construction': 'W50' })],
      frames: [frame({ 'frame.frame_series': 'F50' })],
    });
    expect(validateBuilderIntegrity(good).some((i) => i.severity === 'block')).toBe(false);
  });
});
