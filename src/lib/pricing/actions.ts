/**
 * Price-action resolution (Phase 3 engine).
 *
 * Maps a matched `price_rule` onto a money amount + status, covering all the
 * action types from the Pioneer schema's "Price Actions" tab. Statuses
 * (NC / INCLUDED / NA / CF) are first-class — never silent zeros: CONTACT_FACTORY
 * and EXTERNAL_REQUIRED route the line to the manual-quote / external path.
 */

import type { RoundingMethod } from '@/types';
import type { ActionResolution, LoadedPriceRule } from './engine-types';

export interface ActionContext {
  /** Quantity for the component being priced (e.g. leaf count, per-foot length). */
  quantity: number;
  /** Value of the rule's `quantity_basis_field` resolved from the spec, if any. */
  quantityBasisValue: number | null;
  /** Resolves a referenced rule's already-computed net amount (PERCENT_OF etc.). */
  resolveReference: (ruleId: string | null) => number | null;
  /** Confidence threshold below which a matched rule is routed to manual quote. */
  minConfidence: number;
}

function round(value: number, method: RoundingMethod | null, increment: number | null): number {
  const inc = increment && increment > 0 ? increment : 1;
  switch (method) {
    case 'CEILING':
    case 'CEILING_PER_ITEM':
    case 'CEILING_AFTER_SUM':
      return Math.ceil(value / inc) * inc;
    case 'FLOOR':
      return Math.floor(value / inc) * inc;
    case 'NEAREST':
      return Math.round(value / inc) * inc;
    case 'NONE':
    case null:
    case undefined:
      return value;
    default: {
      const _exhaustive: never = method;
      return value;
    }
  }
}

function clamp(value: number, min: number | null, max: number | null): number {
  let v = value;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Picks the quantity-tier amount/status that brackets the resolved quantity. */
function resolveTier(rule: LoadedPriceRule, qty: number): { amount: number | null; setup: boolean; status: string | null } {
  for (const tier of rule.quantityTiers) {
    const min = tier.minQty ?? Number.NEGATIVE_INFINITY;
    const max = tier.maxQty ?? Number.POSITIVE_INFINITY;
    if (qty >= min && qty <= max) {
      return { amount: tier.amount, setup: tier.isSetupCharge, status: tier.status };
    }
  }
  return { amount: null, setup: false, status: null };
}

/**
 * Resolves a matched rule into a money amount + status. Pure — does not touch
 * the DB. Reference-based actions use ctx.resolveReference (the engine resolves
 * referenced base rules first, by priority).
 */
export function resolveAction(rule: LoadedPriceRule, ctx: ActionContext): ActionResolution {
  const amount = rule.amount ?? 0;
  const qty = ctx.quantityBasisValue ?? ctx.quantity;

  // Low-confidence rules are matched but pushed to manual review, never auto-priced.
  if (rule.extractionConfidence != null && rule.extractionConfidence < ctx.minConfidence) {
    return {
      amount: null,
      status: 'INVALID',
      lineType: 'MANUAL_QUOTE',
      expression: `Low extraction confidence (${rule.extractionConfidence.toFixed(2)}) — manual review`,
      manualReason: 'LOW_CONFIDENCE',
      exceptionMessage: 'Rule confidence below threshold; routed to manual quote.',
    };
  }

  switch (rule.actionType) {
    case 'BASE_AMOUNT': {
      const v = clamp(round(amount, rule.roundingMethod, rule.roundingIncrement), rule.minimumCharge, rule.maximumCharge);
      return { amount: v, status: 'PRICED', lineType: 'BASE', expression: `Base ${fmt(v)}`, manualReason: null, exceptionMessage: null };
    }
    case 'FIXED_ADD': {
      const v = clamp(round(amount, rule.roundingMethod, rule.roundingIncrement), rule.minimumCharge, rule.maximumCharge);
      return { amount: v, status: 'PRICED', lineType: 'ADDER', expression: `Add ${fmt(v)}`, manualReason: null, exceptionMessage: null };
    }
    case 'FIXED_ADD_X_QTY':
    case 'RATE_X_QUANTITY': {
      // Quantity contract (single extension): the billable quantity comes ONLY
      // from the rule's basis field (e.g. width in inches, length in feet). It
      // does NOT fall back to the component count — the engine multiplies the
      // returned per-instance amount by the component quantity exactly once.
      // Without a basis field the rule is a flat per-component charge (billable
      // = 1), so component multiplication still happens exactly once downstream.
      const billable = ctx.quantityBasisValue != null
        ? Math.max(0, ctx.quantityBasisValue - (rule.baseQuantityIncluded ?? 0))
        : 1;
      const raw = amount * billable;
      const v = clamp(round(raw, rule.roundingMethod, rule.roundingIncrement), rule.minimumCharge, rule.maximumCharge);
      return {
        amount: v,
        status: 'PRICED',
        lineType: 'ADDER',
        expression: `${fmt(amount)} × ${billable}${rule.unitOfMeasure ? ` ${rule.unitOfMeasure}` : ''} = ${fmt(v)}`,
        manualReason: null,
        exceptionMessage: null,
      };
    }
    case 'PERCENT_OF': {
      const ref = ctx.resolveReference(rule.referenceRuleId);
      const pct = rule.percentage ?? 0;
      if (ref == null) {
        return {
          amount: null, status: 'INVALID', lineType: 'WARNING',
          expression: `PERCENT_OF unresolved reference`, manualReason: 'UNRESOLVED_REFERENCE',
          exceptionMessage: 'Percentage rule references a base that did not resolve.',
        };
      }
      const raw = ref * (pct / 100);
      const v = clamp(round(raw, rule.roundingMethod, rule.roundingIncrement), rule.minimumCharge, rule.maximumCharge);
      return { amount: v, status: 'PRICED', lineType: 'ADDER', expression: `${pct}% of ${fmt(ref)} = ${fmt(v)}`, manualReason: null, exceptionMessage: null };
    }
    case 'REFERENCE_PLUS_ADD': {
      const ref = ctx.resolveReference(rule.referenceRuleId);
      if (ref == null) {
        return {
          amount: null, status: 'INVALID', lineType: 'WARNING',
          expression: `REFERENCE_PLUS_ADD unresolved reference`, manualReason: 'UNRESOLVED_REFERENCE',
          exceptionMessage: 'Reference-plus-add rule references a base that did not resolve.',
        };
      }
      const add = rule.fixedAddAfterReference ?? 0;
      const v = clamp(round(ref + add, rule.roundingMethod, rule.roundingIncrement), rule.minimumCharge, rule.maximumCharge);
      return { amount: v, status: 'PRICED', lineType: 'ADDER', expression: `${fmt(ref)} + ${fmt(add)} = ${fmt(v)}`, manualReason: null, exceptionMessage: null };
    }
    case 'TIERED_ADD': {
      const tier = resolveTier(rule, qty);
      if (tier.amount == null) {
        return {
          amount: null, status: 'INVALID', lineType: 'WARNING',
          expression: `No quantity tier matched qty ${qty}`, manualReason: 'MISSING_PRICE',
          exceptionMessage: `No quantity tier covers quantity ${qty}.`,
        };
      }
      const v = clamp(round(tier.amount, rule.roundingMethod, rule.roundingIncrement), rule.minimumCharge, rule.maximumCharge);
      return {
        amount: v, status: 'PRICED', lineType: 'ADDER',
        expression: `Tier @ qty ${qty}${tier.setup ? ' (setup)' : ''} = ${fmt(v)}`,
        manualReason: null, exceptionMessage: null,
      };
    }
    case 'WAIVER': {
      // Charge waived (e.g. minimum waived above a quantity threshold).
      return { amount: 0, status: 'NO_CHARGE', lineType: 'ADDER', expression: 'Charge waived', manualReason: null, exceptionMessage: null };
    }
    case 'OVERRIDE': {
      const v = clamp(round(amount, rule.roundingMethod, rule.roundingIncrement), rule.minimumCharge, rule.maximumCharge);
      return { amount: v, status: 'PRICED', lineType: 'ADDER', expression: `Override ${fmt(v)}`, manualReason: null, exceptionMessage: null };
    }
    case 'NO_CHARGE':
      return { amount: 0, status: 'NO_CHARGE', lineType: 'INCLUDED', expression: 'No charge (N/C)', manualReason: null, exceptionMessage: null };
    case 'INCLUDED':
      return { amount: 0, status: 'INCLUDED', lineType: 'INCLUDED', expression: 'Included in base', manualReason: null, exceptionMessage: null };
    case 'NOT_APPLICABLE':
      // N/A means this configuration is NOT a valid combination — it must block,
      // not silently produce a $0 "included" line. Route to manual review so the
      // incompatible configuration is surfaced and cannot be finalized as-is.
      return {
        amount: null, status: 'INVALID', lineType: 'WARNING',
        expression: 'Not applicable (N/A) — incompatible configuration',
        manualReason: 'INVALID_COMBINATION',
        exceptionMessage: 'This option is not applicable to the selected configuration (N/A) and cannot be priced.',
      };
    case 'CONTACT_FACTORY':
      return {
        amount: null, status: 'CONTACT_FACTORY', lineType: 'MANUAL_QUOTE',
        expression: 'Contact factory (CF)', manualReason: 'CONTACT_FACTORY',
        exceptionMessage: 'Priced by factory — routed to manual quote.',
      };
    case 'EXTERNAL_REQUIRED':
      return {
        amount: null, status: 'EXTERNAL_PENDING', lineType: 'EXTERNAL',
        expression: 'External scope required', manualReason: null,
        exceptionMessage: 'External item/price required before this opening can be finalized.',
      };
    default: {
      const _exhaustive: never = rule.actionType;
      return { amount: null, status: 'INVALID', lineType: 'WARNING', expression: 'Unknown action', manualReason: 'MISSING_PRICE', exceptionMessage: 'Unrecognized action type.' };
    }
  }
}
