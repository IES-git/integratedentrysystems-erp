/**
 * Quantity-formula evaluation (Phase 3 engine).
 *
 * Hardware quantities are RULE-DRIVEN, not stored (the source has only 17
 * quantities, so it is not a reusable BOM). `hardware_set_item.quantity_formula`
 * holds a short human phrase; this resolver maps the known phrases to a count
 * derived from the opening spec (leaf count, height-based hinge counts, pairs,
 * perimeter/width for linear accessories). Unrecognized formulas default to 1
 * and are surfaced as a warning by the caller.
 */

import { calcHingeQty } from '@/components/estimates/wizard/opening-rules';
import type { NormalizedOpeningSpec } from './spec';

export interface QuantityEval {
  quantity: number;
  /** When true, the phrase wasn't recognized and a default was used. */
  defaulted: boolean;
  basis: string;
}

const PER_LEAF = /per\s+leaf|each\s+leaf/i;
const ACTIVE_LEAF = /active\s+leaf/i;
const PERIMETER = /perimeter|head\s*\+|head\s+plus/i;
const WIDTH_BASIS = /opening_width|width/i;
const HINGE = /hinge_count/i;
const FLUSH_BOLTS = /flush\s+bolt|top\s*\+\s*bottom|top\s+and\s+bottom/i;
const DPS_COND = /dps_required|if\s+dps/i;
const NUMERIC_LEAD = /^(\d+(?:\.\d+)?)/;

/** Perimeter of the opening (head + 2 jambs) in inches, used for seals. */
function perimeterIn(spec: NormalizedOpeningSpec): number | null {
  if (spec.openingWidthIn == null || spec.openingHeightIn == null) return null;
  return spec.openingWidthIn + 2 * spec.openingHeightIn;
}

/**
 * Resolves a quantity formula phrase against the opening spec. `leaf_count` and
 * height drive most counts; pairs double leaf-scoped quantities.
 */
export function evalQuantityFormula(
  formula: string | null,
  spec: NormalizedOpeningSpec,
): QuantityEval {
  const leaves = Math.max(1, spec.leafCount);
  const isPair = spec.configurationType === 'pair' || spec.configurationType === 'double_egress' || leaves >= 2;
  const text = (formula ?? '').trim();

  if (!text) return { quantity: 1, defaulted: true, basis: 'default 1' };

  if (HINGE.test(text)) {
    const perLeaf = calcHingeQty(spec.openingHeightIn, false);
    const total = PER_LEAF.test(text) || isPair ? perLeaf * leaves : perLeaf;
    return { quantity: total, defaulted: false, basis: `hinge_count(height=${spec.openingHeightIn ?? '?'}) × ${PER_LEAF.test(text) || isPair ? leaves : 1}` };
  }

  if (FLUSH_BOLTS.test(text)) {
    // Top + bottom flush bolts on the inactive leaf.
    return { quantity: 2, defaulted: false, basis: 'flush bolts top+bottom' };
  }

  if (DPS_COND.test(text)) {
    const want = Boolean(spec.accessControl?.dps) || Boolean(spec.fields['opening.dps_required']);
    return { quantity: want ? 1 : 0, defaulted: false, basis: 'dps conditional' };
  }

  if (PERIMETER.test(text)) {
    const p = perimeterIn(spec);
    return { quantity: p ?? 0, defaulted: p == null, basis: 'perimeter (in)' };
  }

  if (ACTIVE_LEAF.test(text)) {
    return { quantity: 1, defaulted: false, basis: 'active leaf' };
  }

  if (WIDTH_BASIS.test(text) && !PER_LEAF.test(text)) {
    return { quantity: spec.openingWidthIn ?? 0, defaulted: spec.openingWidthIn == null, basis: 'opening width (in)' };
  }

  if (PER_LEAF.test(text)) {
    const lead = text.match(NUMERIC_LEAD);
    const per = lead ? Number(lead[1]) : 1;
    return { quantity: per * leaves, defaulted: false, basis: `${per} per leaf × ${leaves}` };
  }

  // Leading number (e.g. "1 per active leaf" handled above; "2" -> 2).
  const lead = text.match(NUMERIC_LEAD);
  if (lead) {
    return { quantity: Number(lead[1]), defaulted: false, basis: `literal ${lead[1]}` };
  }

  return { quantity: 1, defaulted: true, basis: `unrecognized "${text}" → 1` };
}
