/**
 * Hardware pricing branch (Phase 3 engine, integration-workbook steps 2-8).
 *
 *  2. Generate hardware-set requirements + quantities from the opening.
 *  3. Select variants (the spec carries the chosen variant per category).
 *  4. Generate Pioneer door/frame prep requirements via the crosswalk.
 *  5. Price actual hardware  (net = list × discount).
 *  6. Price length-driven accessories via linear_hardware_rule.
 *  7. Apply hardware_sell_rule (markup / GM target / rounding) → sell + GM.
 *  8. (services handled in engine.ts)
 *
 * Hardware lines stay SEPARATE from but LINKED to the Pioneer prep lines (the
 * prep requirements are returned for the engine to price through the rule path).
 * Missing prices / templates are explicit exceptions, never silent zeros.
 */

import type {
  HardwareSellRule,
  HardwarePrepCrosswalk,
} from '@/types';
import type { EngineLine, EngineManualQuote } from './engine-types';
import type { NormalizedOpeningSpec, HardwareSelection } from './spec';
import { evalQuantityFormula } from './quantity';
import type { HardwareCatalog, VariantWithPrice } from './loader';

export interface PrepRequirement {
  hardwareCategory: string;
  entityType: 'door' | 'frame';
  prepCode: string;
  quantity: number;
  source: string;
  templateId: string | null;
  pricingBehavior: string | null;
}

export interface HardwarePricingResult {
  lines: EngineLine[];
  manualQuotes: EngineManualQuote[];
  prepRequirements: PrepRequirement[];
  warnings: string[];
}

/** Normalizes a category label to comparable tokens (drops separators/case). */
function tokens(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !['and', 'the', 'with'].includes(t)),
  );
}

/** Token-overlap score between two category labels (0..1). */
function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

/**
 * Picks the hardware set template whose selection_conditions match the opening.
 * Conditions are a flat object compared against the spec (configuration_type,
 * fire_label_required, access_controlled). The best (most conditions matched)
 * wins; ties break toward fewer total conditions (more specific fit).
 */
export function selectSetTemplate(
  spec: NormalizedOpeningSpec,
  catalog: HardwareCatalog,
): HardwareCatalog['setTemplates'][number] | null {
  let best: { tpl: HardwareCatalog['setTemplates'][number]; score: number } | null = null;
  for (const tpl of catalog.setTemplates) {
    const cond = tpl.selectionConditions ?? {};
    const entries = Object.entries(cond);
    let matched = 0;
    let failed = false;
    for (const [key, val] of entries) {
      if (key === 'configuration_type') {
        if (String(val) === spec.configurationType) matched++;
        else failed = true;
      } else if (key === 'fire_label_required') {
        if (Boolean(val) === Boolean(spec.fireLabelRequired)) matched++;
        else failed = true;
      } else if (key === 'access_controlled') {
        if (Boolean(val) === Boolean(spec.accessControl)) matched++;
        else failed = true;
      }
    }
    if (failed) continue;
    const score = matched - entries.length * 0.01;
    if (!best || score > best.score) best = { tpl, score };
  }
  return best?.tpl ?? null;
}

/**
 * Expands the matched set template into hardware requirements with resolved
 * quantities, then merges in any manual selections from the spec (manual wins,
 * extra manual categories are appended). Used by both the engine and the builder
 * (so the hardware step is pre-populated).
 */
export function generateHardwareRequirements(
  spec: NormalizedOpeningSpec,
  catalog: HardwareCatalog,
): { requirements: HardwareSelection[]; warnings: string[] } {
  const warnings: string[] = [];
  const tpl = selectSetTemplate(spec, catalog);
  const byCategory = new Map<string, HardwareSelection>();

  if (tpl) {
    for (const item of tpl.items) {
      const q = evalQuantityFormula(item.quantityFormula, spec);
      if (q.defaulted && item.quantityFormula) {
        warnings.push(`Hardware "${item.category}": could not parse quantity "${item.quantityFormula}" — defaulted to ${q.quantity}.`);
      }
      byCategory.set(item.category, {
        category: item.category,
        variantId: null,
        quantity: q.quantity,
        required: item.required,
        source: 'set_template',
      });
    }
  } else if (spec.hardware.length === 0) {
    warnings.push('No hardware set template matched this opening configuration.');
  }

  // Merge manual selections (override quantity/variant; add new categories).
  for (const sel of spec.hardware) {
    const existing = byCategory.get(sel.category);
    byCategory.set(sel.category, {
      ...existing,
      ...sel,
      source: sel.source ?? (existing ? existing.source : 'manual'),
      required: sel.required ?? existing?.required ?? false,
    });
  }

  return { requirements: [...byCategory.values()], warnings };
}

/** Finds the best crosswalk row for a (canonical or descriptive) category. */
export function matchCrosswalk(
  category: string,
  prepCrosswalk: HardwarePrepCrosswalk[],
): HardwarePrepCrosswalk | null {
  let best: { row: HardwarePrepCrosswalk; score: number } | null = null;
  for (const row of prepCrosswalk) {
    const score = similarity(category, row.hardwareCategory);
    if (score > 0 && (!best || score > best.score)) best = { row, score };
  }
  return best && best.score >= 0.34 ? best.row : null;
}

/** Splits a crosswalk prep code field ("CYL / L / T") into individual codes. */
function splitPrepCodes(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[/]/)
    .map((s) => s.trim())
    .filter((s) => s && !/^or$/i.test(s));
}

/**
 * Derives the Pioneer door/frame prep requirements for the opening's selected
 * hardware via the crosswalk. The engine prices these through the rule path
 * (entity_type prep, item_or_option_code = prep code).
 */
export function derivePrepRequirements(
  requirements: HardwareSelection[],
  catalog: HardwareCatalog,
): { prepRequirements: PrepRequirement[]; warnings: string[] } {
  const prepRequirements: PrepRequirement[] = [];
  const warnings: string[] = [];

  for (const req of requirements) {
    if (req.quantity <= 0) continue;
    const cw = matchCrosswalk(req.category, catalog.prepCrosswalk);
    if (!cw) {
      warnings.push(`No prep crosswalk found for hardware category "${req.category}".`);
      continue;
    }
    const doorCodes = splitPrepCodes(cw.doorPrepCode);
    const frameCodes = splitPrepCodes(cw.framePrepCode);
    // Use the primary code from each side (first listed) to avoid double-charging
    // every alternate; the rest are alternates surfaced via the crosswalk notes.
    if (doorCodes[0]) {
      prepRequirements.push({
        hardwareCategory: req.category, entityType: 'door', prepCode: doorCodes[0],
        quantity: req.quantity, source: cw.hardwareCategory, templateId: cw.templateId, pricingBehavior: cw.pricingBehavior,
      });
    }
    if (frameCodes[0]) {
      prepRequirements.push({
        hardwareCategory: req.category, entityType: 'frame', prepCode: frameCodes[0],
        quantity: req.quantity, source: cw.hardwareCategory, templateId: cw.templateId, pricingBehavior: cw.pricingBehavior,
      });
    }
  }

  return { prepRequirements, warnings };
}

export interface SellComputation {
  sell: number;
  gm: number;
  gmPct: number;
}

/** Picks the highest-priority sell rule matching category + customer/company. */
export function pickSellRule(
  category: string,
  sellRules: HardwareSellRule[],
  ctx: { customerClass?: string | null; companyId?: string | null },
): HardwareSellRule | null {
  const candidates = sellRules.filter((r) => {
    if (r.category && r.category !== category) return false;
    if (r.customerClass && r.customerClass !== (ctx.customerClass ?? null)) return false;
    if (r.companyId && r.companyId !== (ctx.companyId ?? null)) return false;
    return true;
  });
  // Lower priority number = higher precedence (matches loader ordering).
  return candidates.sort((a, b) => a.priority - b.priority)[0] ?? null;
}

function roundMoney(value: number, mode: string | null): number {
  switch (mode) {
    case 'ceil':
    case 'ceiling':
      return Math.ceil(value);
    case 'nearest':
    case 'round':
      return Math.round(value);
    case 'nearest_5':
      return Math.round(value / 5) * 5;
    default:
      return Math.round(value * 100) / 100;
  }
}

/** Computes sell + GM from a net cost using a sell rule (markup or GM target). */
export function computeSell(
  net: number,
  list: number | null,
  rule: HardwareSellRule | null,
): SellComputation {
  if (!rule) {
    // No sell rule configured: sell defaults to net (zero margin) and the engine
    // surfaces a warning so a margin is applied before quoting.
    return { sell: net, gm: 0, gmPct: 0 };
  }
  const basis = rule.costBasis === 'list' ? (list ?? net) : net;
  let sell: number;
  if (rule.gmTargetPct != null && rule.gmTargetPct > 0 && rule.gmTargetPct < 100) {
    sell = basis / (1 - rule.gmTargetPct / 100);
  } else if (rule.markupMultiplier != null && rule.markupMultiplier > 0) {
    sell = basis * rule.markupMultiplier;
  } else {
    sell = basis;
  }
  sell = roundMoney(sell, rule.rounding);
  const gm = sell - net;
  const gmPct = sell > 0 ? (gm / sell) * 100 : 0;
  return { sell, gm, gmPct };
}

/** Linear accessory length (ft) from per-foot rules: cut increment + waste + min. */
export function computeLinearLength(
  spec: NormalizedOpeningSpec,
  rule: { lengthBasis: string; cutIncrement: number | null; wastePct: number | null; minimumLength: number | null },
): number | null {
  let baseIn: number | null = null;
  switch (rule.lengthBasis) {
    case 'width':
      baseIn = spec.openingWidthIn;
      break;
    case 'height':
      baseIn = spec.openingHeightIn;
      break;
    case 'perimeter':
    case 'head_plus_jambs':
      baseIn = spec.openingWidthIn != null && spec.openingHeightIn != null
        ? spec.openingWidthIn + 2 * spec.openingHeightIn
        : null;
      break;
    default:
      baseIn = null;
  }
  if (baseIn == null) return null;
  let lengthIn = baseIn * (1 + (rule.wastePct ?? 0) / 100);
  if (rule.cutIncrement && rule.cutIncrement > 0) {
    lengthIn = Math.ceil(lengthIn / rule.cutIncrement) * rule.cutIncrement;
  }
  if (rule.minimumLength != null) lengthIn = Math.max(lengthIn, rule.minimumLength);
  return lengthIn / 12; // feet
}

/**
 * Prices the opening's actual hardware (steps 5-7) and derives prep requirements
 * (step 4). Each hardware selection yields a quote line; missing variants/prices
 * become explicit exceptions and manual-quote routes.
 */
export function priceHardware(
  spec: NormalizedOpeningSpec,
  catalog: HardwareCatalog,
  variantMap: Map<string, VariantWithPrice>,
  ctx: { customerClass?: string | null; companyId?: string | null; priceBookId: string | null },
): HardwarePricingResult {
  const lines: EngineLine[] = [];
  const manualQuotes: EngineManualQuote[] = [];
  const warnings: string[] = [];
  let sortOrder = 1000;

  const { requirements, warnings: reqWarnings } = generateHardwareRequirements(spec, catalog);
  warnings.push(...reqWarnings);

  const { prepRequirements, warnings: prepWarnings } = derivePrepRequirements(requirements, catalog);
  warnings.push(...prepWarnings);

  for (const req of requirements) {
    if (req.quantity <= 0) continue;
    const base: Omit<EngineLine, 'priceStatus' | 'lineType' | 'calculationExpression' | 'exceptionMessage' | 'unitListPrice' | 'extendedListPrice' | 'discountMultiplier' | 'extendedNetPrice' | 'sellPrice' | 'grossMargin' | 'grossMarginPct'> = {
      priceRuleId: null,
      entityType: 'hardware',
      chargeCategory: req.category,
      description: `${req.category.replace(/_/g, ' ')}`,
      selectedOptionCode: null,
      quantity: req.quantity,
      unitOfMeasure: 'each',
      matchedConditions: null,
      includedOrSuppressedBy: null,
      sourcePage: null,
      sourceRegionId: null,
      priceBookId: ctx.priceBookId,
      confidence: null,
      componentId: null,
      sortOrder: sortOrder++,
    };

    if (!req.variantId) {
      lines.push({
        ...base,
        lineType: req.required ? 'WARNING' : 'WARNING',
        priceStatus: 'INVALID',
        unitListPrice: null, extendedListPrice: null, discountMultiplier: null,
        extendedNetPrice: null, sellPrice: null, grossMargin: null, grossMarginPct: null,
        calculationExpression: 'No variant selected',
        exceptionMessage: req.required
          ? `Required hardware "${req.category}" has no variant selected.`
          : `Hardware "${req.category}" not yet selected.`,
      });
      if (req.required) {
        manualQuotes.push({ componentId: null, priceRuleId: null, reason: 'MISSING_PRICE', requestedInputs: `Select a variant for ${req.category}` });
      }
      continue;
    }

    const vp = variantMap.get(req.variantId);
    if (!vp || !vp.price || (vp.price.netCost == null && vp.price.listPrice == null)) {
      lines.push({
        ...base,
        lineType: 'MANUAL_QUOTE',
        priceStatus: 'INVALID',
        unitListPrice: vp?.price?.listPrice ?? null, extendedListPrice: null,
        discountMultiplier: vp?.price?.discountMultiplier ?? null,
        extendedNetPrice: null, sellPrice: null, grossMargin: null, grossMarginPct: null,
        calculationExpression: 'No approved price for selected variant',
        exceptionMessage: `No approved price for "${req.category}" variant — routed to manual quote.`,
      });
      manualQuotes.push({ componentId: null, priceRuleId: null, reason: 'MISSING_PRICE', requestedInputs: `Price hardware variant for ${req.category}` });
      continue;
    }

    const list = vp.price.listPrice;
    const disc = vp.price.discountMultiplier;
    const net = vp.price.netCost ?? (list != null && disc != null ? list * disc : null);
    if (net == null) {
      lines.push({
        ...base, lineType: 'MANUAL_QUOTE', priceStatus: 'INVALID',
        unitListPrice: list, extendedListPrice: null, discountMultiplier: disc,
        extendedNetPrice: null, sellPrice: null, grossMargin: null, grossMarginPct: null,
        calculationExpression: 'Net cost unresolved (list × discount missing)',
        exceptionMessage: `Cannot compute net for "${req.category}".`,
      });
      manualQuotes.push({ componentId: null, priceRuleId: null, reason: 'MISSING_PRICE', requestedInputs: `Provide list × discount for ${req.category}` });
      continue;
    }

    const extendedNet = net * req.quantity;
    const sellRule = pickSellRule(req.category, catalog.sellRules, ctx);
    if (!sellRule) warnings.push(`No hardware sell rule for "${req.category}" — sell defaults to net (0% GM).`);
    const { sell, gm, gmPct } = computeSell(net, list, sellRule);
    const extendedSell = sell * req.quantity;

    lines.push({
      ...base,
      lineType: 'ADDER',
      priceStatus: 'PRICED',
      description: `${req.category.replace(/_/g, ' ')}${vp.variant.sku ? ` (${vp.variant.sku})` : ''}`,
      selectedOptionCode: vp.variant.sku,
      unitListPrice: list,
      extendedListPrice: list != null ? list * req.quantity : null,
      discountMultiplier: disc,
      extendedNetPrice: extendedNet,
      sellPrice: extendedSell,
      grossMargin: gm * req.quantity,
      grossMarginPct: gmPct,
      calculationExpression: `net ${net.toFixed(2)} × ${req.quantity} = ${extendedNet.toFixed(2)}; sell ${extendedSell.toFixed(2)} (${gmPct.toFixed(1)}% GM)`,
      exceptionMessage: null,
    });
  }

  // Length-driven accessories (weatherstrip / sweeps / thresholds) — step 6.
  for (const lin of catalog.linearRules) {
    const wantsCategory = requirements.some((r) => similarity(r.category, lin.hardwareCategory) >= 0.34);
    if (!wantsCategory) continue;
    const lengthFt = computeLinearLength(spec, lin);
    if (lengthFt == null) {
      warnings.push(`Linear accessory "${lin.hardwareCategory}": cannot resolve ${lin.lengthBasis} length from opening dimensions.`);
      continue;
    }
    if (lin.perFootPrice == null) {
      manualQuotes.push({ componentId: null, priceRuleId: null, reason: 'MISSING_PRICE', requestedInputs: `Per-foot price for ${lin.hardwareCategory}` });
      continue;
    }
    const net = lin.perFootPrice * lengthFt;
    const sellRule = pickSellRule(lin.hardwareCategory, catalog.sellRules, ctx);
    const { sell, gm, gmPct } = computeSell(net, null, sellRule);
    lines.push({
      lineType: 'ADDER', priceRuleId: null, entityType: 'hardware',
      chargeCategory: lin.hardwareCategory, description: `${lin.hardwareCategory} (linear)`,
      selectedOptionCode: null, quantity: Math.round(lengthFt * 100) / 100, unitOfMeasure: 'ft',
      unitListPrice: lin.perFootPrice, extendedListPrice: null, discountMultiplier: null,
      extendedNetPrice: net, sellPrice: sell, grossMargin: gm, grossMarginPct: gmPct,
      priceStatus: 'PRICED',
      calculationExpression: `${lin.perFootPrice.toFixed(2)}/ft × ${lengthFt.toFixed(2)}ft = ${net.toFixed(2)}`,
      matchedConditions: null, includedOrSuppressedBy: null, sourcePage: null, sourceRegionId: null,
      priceBookId: ctx.priceBookId, confidence: null, exceptionMessage: null, componentId: null, sortOrder: sortOrder++,
    });
  }

  return { lines, manualQuotes, prepRequirements, warnings };
}
