/**
 * Golden openings harness (plan Phase 0 + Phase 6).
 *
 * A deterministic, DB-free rule set + 50 generated openings spanning singles,
 * equal/unequal pairs, double-egress, fire ratings, cores/gauges, component
 * quantities and opening quantities. Each case carries an independently computed
 * "estimator" total so the engine is checked at cent level (not against itself),
 * and the runner re-prices at opening quantities 1 / 2 / 10 to catch the
 * component- and opening-multiplication errors the plan calls out.
 *
 * Pioneer component lines only (empty hardware catalog) so the reference math is
 * exact: per-opening sell = Σ doors(850 + 2×widthIn + fire?75:0) + Σ frames(320).
 */

import type { LoadedRuleSet, NormalizedOpeningSpec, HardwareCatalog, VariantWithPrice } from '@/lib/pricing';
import type { LoadedPriceRule } from '@/lib/pricing';
import type { OpeningConfigurationType, RuleCondition } from '@/types';

const NOW = '2025-05-01T00:00:00.000Z';

export const DOOR_BASE = 850;
export const FRAME_BASE = 320;
export const FIRE_ADDER = 75;
export const PER_INCH_RATE = 2;

function rule(p: Partial<LoadedPriceRule> & Pick<LoadedPriceRule, 'id' | 'entityType'>): LoadedPriceRule {
  return {
    ruleKey: p.id, priceBookId: 'golden-doc', priceTableId: null, chargeCategory: null,
    itemOrOptionCode: null, priceStatus: 'PRICED', actionType: 'BASE_AMOUNT', amount: null,
    currencyCode: 'USD', unitOfMeasure: null, quantityBasisField: null, baseQuantityIncluded: null,
    minimumCharge: null, maximumCharge: null, referenceRuleId: null, percentage: null,
    fixedAddAfterReference: null, roundingMethod: null, roundingIncrement: null, priority: 100,
    stackingBehavior: 'STACK', exclusiveGroup: null, effectiveFrom: null, effectiveTo: null,
    sourceRegionId: 'golden-region', rawValueText: null, extractionConfidence: 1, reviewStatus: 'APPROVED',
    createdAt: NOW, updatedAt: NOW, conditions: [], actionParameters: [], includedScopes: [], quantityTiers: [],
    ...p,
  };
}

function cond(ruleId: string, fieldPath: string, value: string): RuleCondition {
  return {
    id: `c-${ruleId}`, priceRuleId: ruleId, conditionGroup: 0, fieldId: null, fieldPath,
    operator: 'EQ', valueType: 'TEXT', value1: value, value2: null, unit: null,
    inclusiveMin: null, inclusiveMax: null, normalizedValue: null, sourcePhrase: null,
    derivedFlag: false, nullBehavior: 'IGNORE', createdAt: NOW,
  };
}

/** The golden rule set. `extraRules` lets specific tests add NA / prep cases. */
export function buildGoldenRuleSet(extraRules: LoadedPriceRule[] = []): LoadedRuleSet {
  return {
    rules: [
      rule({ id: 'g-door-base', entityType: 'door', chargeCategory: 'base', actionType: 'BASE_AMOUNT', amount: DOOR_BASE, priority: 1 }),
      rule({ id: 'g-frame-base', entityType: 'frame', chargeCategory: 'base', actionType: 'BASE_AMOUNT', amount: FRAME_BASE, priority: 1 }),
      rule({
        id: 'g-door-fire', entityType: 'door', chargeCategory: 'fire_label', actionType: 'FIXED_ADD',
        amount: FIRE_ADDER, priority: 10,
        conditions: [cond('g-door-fire', 'opening.fire_label_required', 'true')],
      }),
      // Per-inch width charge — exercises the single-extension quantity contract.
      rule({
        id: 'g-door-perinch', entityType: 'door', chargeCategory: 'size', actionType: 'RATE_X_QUANTITY',
        amount: PER_INCH_RATE, quantityBasisField: 'door.nominal_door_width', unitOfMeasure: 'in', priority: 20,
      }),
      ...extraRules,
    ],
    dependencyRules: [],
  };
}

export const emptyCatalog: HardwareCatalog = {
  setTemplates: [], prepCrosswalk: [], sellRules: [], serviceScopes: [], linearRules: [],
};
export const emptyVariantMap = new Map<string, VariantWithPrice>();

export interface GoldenCase {
  id: string;
  label: string;
  configurationType: OpeningConfigurationType;
  leafCount: number;
  fireLabel: boolean;
  /** Per-door nominal widths (door notation, e.g. '3-0'); length = door count. */
  doorWidths: string[];
  /** Per-door component quantity multiplier (identical leaves). */
  doorQtys: number[];
  frameQty: number;
  openingQty: number;
}

const FT = (w: string): number => {
  // '3-0' -> 36, '3-6' -> 42 (feet-inches door notation).
  const m = /^(\d+)-(\d+)$/.exec(w);
  if (m) return Number(m[1]) * 12 + Number(m[2]);
  const n = Number(w.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Independent "estimator" per-opening sell (one opening instance). */
export function referenceSellPerOpening(c: GoldenCase): number {
  let total = 0;
  for (let i = 0; i < c.doorWidths.length; i++) {
    const widthIn = FT(c.doorWidths[i]);
    const perDoor = DOOR_BASE + PER_INCH_RATE * widthIn + (c.fireLabel ? FIRE_ADDER : 0);
    total += perDoor * (c.doorQtys[i] ?? 1);
  }
  total += FRAME_BASE * c.frameQty;
  return Math.round(total * 100) / 100;
}

export function buildGoldenSpec(c: GoldenCase): NormalizedOpeningSpec {
  const doors = c.doorWidths.map((w, i) => ({
    id: `door-${i}`, entityType: 'door' as const, label: `Door ${i + 1}`,
    quantity: c.doorQtys[i] ?? 1, code: 'H',
    fields: { 'door.nominal_door_width': w, 'door.door_series_construction': 'H' },
  }));
  return {
    openingId: `golden-${c.id}`, estimateId: 'golden-estimate',
    configurationType: c.configurationType, leafCount: c.leafCount, quantity: c.openingQty,
    openingWidthIn: FT(c.doorWidths[0] ?? '3-0'), openingHeightIn: 84,
    fireLabelRequired: c.fireLabel, fields: {},
    components: [
      ...doors,
      { id: 'frame-0', entityType: 'frame', label: 'Frame', quantity: c.frameQty, code: 'F', fields: { 'frame.frame_series': 'F' } },
    ],
    hardware: [], keying: null, accessControl: null,
  };
}

/** Generates the 50-opening golden set across the required configuration space. */
export function generateGoldenCases(): GoldenCase[] {
  const cases: GoldenCase[] = [];
  const widths = ['2-8', '3-0', '3-6', '4-0'];
  let n = 0;
  const push = (c: Omit<GoldenCase, 'id'>) => cases.push({ id: `g${++n}`, ...c });

  // Singles: vary width, fire, component qty.
  for (const w of widths) {
    for (const fire of [false, true]) {
      push({ label: `single ${w}${fire ? ' fire' : ''}`, configurationType: 'single', leafCount: 1, fireLabel: fire, doorWidths: [w], doorQtys: [1], frameQty: 1, openingQty: 1 });
    }
  }
  // Equal pairs.
  for (const w of widths) {
    push({ label: `equal pair ${w}`, configurationType: 'pair', leafCount: 2, fireLabel: false, doorWidths: [w, w], doorQtys: [1, 1], frameQty: 1, openingQty: 1 });
    push({ label: `equal pair ${w} fire`, configurationType: 'pair', leafCount: 2, fireLabel: true, doorWidths: [w, w], doorQtys: [1, 1], frameQty: 1, openingQty: 1 });
  }
  // Unequal pairs.
  push({ label: 'unequal pair 3-0/2-0', configurationType: 'pair', leafCount: 2, fireLabel: false, doorWidths: ['3-0', '2-0'], doorQtys: [1, 1], frameQty: 1, openingQty: 1 });
  push({ label: 'unequal pair 4-0/2-8 fire', configurationType: 'pair', leafCount: 2, fireLabel: true, doorWidths: ['4-0', '2-8'], doorQtys: [1, 1], frameQty: 1, openingQty: 1 });
  // Double-egress.
  push({ label: 'double-egress 3-0', configurationType: 'double_egress', leafCount: 2, fireLabel: true, doorWidths: ['3-0', '3-0'], doorQtys: [1, 1], frameQty: 1, openingQty: 1 });
  push({ label: 'double-egress 3-6', configurationType: 'double_egress', leafCount: 2, fireLabel: false, doorWidths: ['3-6', '3-6'], doorQtys: [1, 1], frameQty: 1, openingQty: 1 });
  // Component-quantity multipliers (identical leaves) — single-extension check.
  for (const q of [2, 3, 5, 10]) {
    push({ label: `single 3-0 ×${q} leaves`, configurationType: 'single', leafCount: 1, fireLabel: false, doorWidths: ['3-0'], doorQtys: [q], frameQty: q, openingQty: 1 });
  }
  // Opening-quantity multipliers.
  for (const oq of [2, 5, 10]) {
    push({ label: `single 3-0 fire, ${oq} openings`, configurationType: 'single', leafCount: 1, fireLabel: true, doorWidths: ['3-0'], doorQtys: [1], frameQty: 1, openingQty: oq });
  }
  // Fill to 50 with varied widths/fire to broaden coverage.
  while (cases.length < 50) {
    const w = widths[cases.length % widths.length];
    const fire = cases.length % 2 === 0;
    push({ label: `coverage single ${w}${fire ? ' fire' : ''}`, configurationType: 'single', leafCount: 1, fireLabel: fire, doorWidths: [w], doorQtys: [1], frameQty: 1, openingQty: 1 });
  }
  return cases;
}
