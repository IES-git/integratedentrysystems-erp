/**
 * Rule-based pricing engine (Phase 3) — replaces the procedural grid lookup in
 * `src/lib/pricing-lookup.ts`.
 *
 * Input  : a NormalizedOpeningSpec (from the unified builder / live-pricing).
 * Output : EstimateLine[] (BASE / ADDER / INCLUDED / EXTERNAL / MANUAL_QUOTE /
 *          WARNING) each with the full calc expression + source rule/page, plus
 *          the manual-quote routes and dependency outcomes.
 *
 * Pipeline per opening:
 *   1. Price each Pioneer component (door / frame / panel / lite) through the
 *      rule path: match `rule_condition`s → resolve `action_type` → enforce
 *      priority / stacking / exclusive_group / included_scope (no double counts).
 *   2. Hardware branch (hardware.ts): set requirements → variant pricing →
 *      Pioneer prep requirements (crosswalk) → linear accessories → sell rule.
 *   3. Price the derived prep requirements through the rule path (kept SEPARATE
 *      from but LINKED to the hardware lines).
 *   4. Keying + access-control bundles, then service_scope (install/freight/tax).
 *   5. Evaluate dependency rules (warn vs block) and roll up totals.
 *
 * Version-aware: every run pins one immutable `price_book_document`. CF /
 * low-confidence / unresolved combos route to `manual_quote_queue` — explicit
 * exceptions, never silent zeros.
 */

import { supabase } from '@/lib/supabase';
import type {
  DependencyRule,
  EstimateLinePriceStatus,
  NgpOption,
  NgpCommercialPolicy,
  RuleEntityType,
} from '@/types';
import { readField, type EngineOptions, type NormalizedOpeningSpec, type SpecComponent, type SpecValue } from './spec';
import type {
  DependencyOutcome,
  EngineLine,
  EngineManualQuote,
  EngineResult,
  LoadedPriceRule,
} from './engine-types';
import { engineLineOverrideKey } from './engine-types';
import { evaluateConditions } from './conditions';
import { resolveAction, type ActionContext } from './actions';
import { loadHardwareCatalog, loadRuleSet, loadNgpScopedRuleSet, loadVariantsWithPrices, type HardwareCatalog, type LoadedRuleSet } from './loader';
import { priceHardware, type PrepRequirement } from './hardware';
import { parseDoorDimension } from '@/components/pricing/dimension-utils';
import { loadNgpCatalog, resolveActiveNgpDocument } from '@/lib/ngp-catalog-api';

const NGP_ENTITY_SET: ReadonlySet<RuleEntityType> = new Set<RuleEntityType>(['lite_kit', 'louver', 'glass', 'glazing_tape']);

/** NGP data threaded into the pure core for the option + commercial-policy passes. */
export interface NgpEngineData {
  options: NgpOption[];
  optionRuleById: Map<string, LoadedPriceRule>;
  policies: NgpCommercialPolicy[];
}

const EXCEPTION_STATUSES: EstimateLinePriceStatus[] = ['INVALID', 'CONTACT_FACTORY', 'EXTERNAL_PENDING'];

function isException(status: EstimateLinePriceStatus): boolean {
  return EXCEPTION_STATUSES.includes(status);
}

function manualOverrideValue(
  line: EngineLine,
  overrides?: Record<string, number | null | undefined>,
): number | null {
  if (!overrides) return null;
  const raw = overrides[engineLineOverrideKey(line)];
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function recalcTotals(lines: EngineLine[], manualQuoteCount: number): EngineResult['totals'] {
  return {
    listTotal: lines.reduce((s, l) => s + (l.extendedListPrice ?? 0), 0),
    netTotal: lines.reduce((s, l) => s + (l.extendedNetPrice ?? 0), 0),
    sellTotal: lines.reduce((s, l) => s + (l.sellPrice ?? 0), 0),
    exceptionCount: lines.filter((l) => isException(l.priceStatus)).length,
    manualQuoteCount,
  };
}

function manualQuoteResolvedByLine(quote: EngineManualQuote, line: EngineLine): boolean {
  if (!line.isManualOverride) return false;
  if (quote.priceRuleId) return line.priceRuleId === quote.priceRuleId && line.componentId === quote.componentId;
  if (quote.componentId) return line.componentId === quote.componentId;

  const normalize = (s: string | null | undefined) =>
    (s ?? '').trim().toLowerCase().replace(/[_\W]+/g, ' ').replace(/\s+/g, ' ');
  const requested = normalize(quote.requestedInputs);
  if (!requested) return false;
  const description = normalize(line.description);
  const exception = normalize(line.exceptionMessage);
  const category = normalize(line.chargeCategory);
  return requested.includes(description) ||
    description.includes(requested) ||
    exception.includes(requested) ||
    (!!category && requested.includes(category));
}

/** Applies user-entered manual sell prices to matching engine lines. */
export function applyManualSellPriceOverrides(
  result: EngineResult,
  overrides?: Record<string, number | null | undefined>,
): EngineResult {
  if (!overrides || Object.keys(overrides).length === 0) return result;

  let changed = false;
  const lines = result.lines.map((line) => {
    const manualSellPrice = manualOverrideValue(line, overrides);
    if (manualSellPrice === null) return line;

    changed = true;
    const grossMargin = line.extendedNetPrice != null ? manualSellPrice - line.extendedNetPrice : null;
    return {
      ...line,
      sellPrice: manualSellPrice,
      grossMargin,
      grossMarginPct: grossMargin != null && manualSellPrice > 0 ? (grossMargin / manualSellPrice) * 100 : null,
      priceStatus: 'PRICED' as EstimateLinePriceStatus,
      manualSellPrice,
      isManualOverride: true,
      calculationExpression: line.calculationExpression
        ? `${line.calculationExpression}; manual sell ${fmtUsd(manualSellPrice)}`
        : `Manual sell ${fmtUsd(manualSellPrice)}`,
    };
  });

  if (!changed) return result;

  const manualQuotes = result.manualQuotes.filter(
    (quote) => !lines.some((line) => manualQuoteResolvedByLine(quote, line)),
  );

  return {
    ...result,
    lines,
    manualQuotes,
    totals: recalcTotals(lines, manualQuotes.length),
  };
}

/** Resolves the numeric quantity-basis value for a rule from the spec. */
function quantityBasisValue(
  rule: LoadedPriceRule,
  spec: NormalizedOpeningSpec,
  component: SpecComponent | null,
): number | null {
  if (!rule.quantityBasisField) return null;
  const raw = readField(spec, component, rule.quantityBasisField);
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  const parsed = parseDoorDimension(String(raw));
  if (parsed != null) return parsed;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

interface SurvivingRule {
  rule: LoadedPriceRule;
  evidence: Record<string, SpecValue>;
  suppressedBy: string | null;
}

/**
 * Applies exclusive-group, override, and included-scope suppression to a set of
 * condition-matched rules, returning the survivors (suppressed rules carry the
 * id of the rule that suppressed them so the UI can show "Included by …").
 */
function applyStacking(matched: { rule: LoadedPriceRule; evidence: Record<string, SpecValue> }[]): SurvivingRule[] {
  const survivors: SurvivingRule[] = matched.map((m) => ({ rule: m.rule, evidence: m.evidence, suppressedBy: null }));

  // 1. Exclusive groups: keep the highest-priority (lowest number) rule per group.
  const bestByGroup = new Map<string, LoadedPriceRule>();
  for (const s of survivors) {
    const g = s.rule.exclusiveGroup;
    if (!g) continue;
    const cur = bestByGroup.get(g);
    if (!cur || s.rule.priority < cur.priority) bestByGroup.set(g, s.rule);
  }
  for (const s of survivors) {
    const g = s.rule.exclusiveGroup;
    if (g && bestByGroup.get(g)!.id !== s.rule.id) s.suppressedBy = bestByGroup.get(g)!.id;
  }

  // 2. OVERRIDE: per charge category, an OVERRIDE rule drops the others.
  const overrideByCategory = new Map<string, LoadedPriceRule>();
  for (const s of survivors) {
    if (s.suppressedBy) continue;
    if (s.rule.stackingBehavior === 'OVERRIDE' && s.rule.chargeCategory) {
      const cur = overrideByCategory.get(s.rule.chargeCategory);
      if (!cur || s.rule.priority < cur.priority) overrideByCategory.set(s.rule.chargeCategory, s.rule);
    }
  }
  for (const s of survivors) {
    if (s.suppressedBy) continue;
    const o = s.rule.chargeCategory ? overrideByCategory.get(s.rule.chargeCategory) : undefined;
    if (o && o.id !== s.rule.id) s.suppressedBy = o.id;
  }

  // 3. Included-scope suppression: INCLUDED rules suppress duplicate parts.
  const suppressedCategories = new Map<string, string>();
  const includedOptionCodes = new Map<string, string>();
  for (const s of survivors) {
    if (s.suppressedBy) continue;
    for (const inc of s.rule.includedScopes) {
      if (inc.suppressesChargeCategory) suppressedCategories.set(inc.suppressesChargeCategory.toLowerCase(), s.rule.id);
      if (inc.includedOptionCode) includedOptionCodes.set(inc.includedOptionCode.toLowerCase(), s.rule.id);
    }
  }
  for (const s of survivors) {
    if (s.suppressedBy) continue;
    const cat = s.rule.chargeCategory?.toLowerCase();
    const code = s.rule.itemOrOptionCode?.toLowerCase();
    const byCat = cat ? suppressedCategories.get(cat) : undefined;
    const byCode = code ? includedOptionCodes.get(code) : undefined;
    const suppressor = byCat ?? byCode;
    if (suppressor && suppressor !== s.rule.id) s.suppressedBy = suppressor;
  }

  return survivors;
}

interface ComponentPricing {
  lines: EngineLine[];
  manualQuotes: EngineManualQuote[];
  /** Per-rule resolved per-component amount, for reference-based actions. */
  amountByRuleId: Map<string, number>;
}

type ComponentPriceOptions = Required<Pick<EngineOptions, 'minConfidence'>> & {
  priceBookId: string | null;
  priceBookDocumentIdsByManufacturer?: Record<string, string>;
};

/** Resolves the immutable rule-book document that owns one component. */
function componentDocumentId(component: SpecComponent, options: ComponentPriceOptions): string | null {
  if (component.priceBookDocumentId) return component.priceBookDocumentId;
  if (component.manufacturerId) {
    return options.priceBookDocumentIdsByManufacturer?.[component.manufacturerId] ?? null;
  }
  // NGP infill rules are loaded separately and scoped by price-table ids; they
  // must not be filtered to the door/frame fallback document.
  if (NGP_ENTITY_SET.has(component.entityType)) return null;
  return options.priceBookId;
}

/** Prices one manufacturer component (door / frame / panel / lite / prep) via rules. */
function priceComponent(
  spec: NormalizedOpeningSpec,
  component: SpecComponent,
  rules: LoadedPriceRule[],
  options: ComponentPriceOptions,
  startSort: number,
): ComponentPricing {
  const lines: EngineLine[] = [];
  const manualQuotes: EngineManualQuote[] = [];
  const amountByRuleId = new Map<string, number>();

  const selectedDocumentId = componentDocumentId(component, options);
  const mayUseUnscopedRules = NGP_ENTITY_SET.has(component.entityType);
  const candidates = rules.filter(
    (r) => r.entityType === component.entityType &&
      (selectedDocumentId
        ? r.priceBookId === selectedDocumentId
        : mayUseUnscopedRules),
  );
  const matched: { rule: LoadedPriceRule; evidence: Record<string, SpecValue> }[] = [];
  for (const rule of candidates) {
    const m = evaluateConditions(rule.conditions, spec, component);
    if (m.matched) matched.push({ rule, evidence: m.evidence });
  }

  const survivors = applyStacking(matched);

  // Resolve non-reference rules first so reference-based actions can look them up.
  const refContext: ActionContext = {
    quantity: component.quantity,
    quantityBasisValue: null,
    minConfidence: options.minConfidence,
    resolveReference: (id) => (id ? amountByRuleId.get(id) ?? null : null),
  };

  const order = [...survivors].sort((a, b) => {
    const aRef = a.rule.actionType === 'PERCENT_OF' || a.rule.actionType === 'REFERENCE_PLUS_ADD' ? 1 : 0;
    const bRef = b.rule.actionType === 'PERCENT_OF' || b.rule.actionType === 'REFERENCE_PLUS_ADD' ? 1 : 0;
    if (aRef !== bRef) return aRef - bRef;
    return a.rule.priority - b.rule.priority;
  });

  let sort = startSort;
  for (const s of order) {
    const { rule, evidence, suppressedBy } = s;
    const ctx: ActionContext = { ...refContext, quantityBasisValue: quantityBasisValue(rule, spec, component) };
    const res = resolveAction(rule, ctx);
    if (res.amount != null) amountByRuleId.set(rule.id, res.amount);

    if (suppressedBy) {
      lines.push({
        lineType: 'INCLUDED', priceRuleId: rule.id, entityType: component.entityType,
        chargeCategory: rule.chargeCategory, description: `${component.label}: ${rule.chargeCategory ?? rule.ruleKey ?? 'option'}`,
        selectedOptionCode: rule.itemOrOptionCode, quantity: component.quantity, unitOfMeasure: rule.unitOfMeasure,
        unitListPrice: 0, extendedListPrice: 0, discountMultiplier: null, extendedNetPrice: 0, sellPrice: 0,
        grossMargin: null, grossMarginPct: null, priceStatus: 'INCLUDED',
        calculationExpression: 'Suppressed to avoid double-counting', matchedConditions: evidence,
        includedOrSuppressedBy: suppressedBy, sourcePage: null, sourceRegionId: rule.sourceRegionId,
        priceBookId: rule.priceBookId, confidence: rule.extractionConfidence, exceptionMessage: null,
        componentId: component.id, sortOrder: sort++,
      });
      continue;
    }

    const perUnit = res.amount ?? 0;
    const extended = perUnit * component.quantity;
    lines.push({
      lineType: res.lineType,
      priceRuleId: rule.id,
      entityType: component.entityType,
      chargeCategory: rule.chargeCategory,
      description: `${component.label}: ${rule.chargeCategory ?? rule.ruleKey ?? rule.actionType}`,
      selectedOptionCode: rule.itemOrOptionCode,
      quantity: component.quantity,
      unitOfMeasure: rule.unitOfMeasure,
      unitListPrice: res.amount,
      extendedListPrice: res.amount != null ? extended : null,
      discountMultiplier: null,
      extendedNetPrice: res.amount != null ? extended : null,
      sellPrice: res.amount != null ? extended : null,
      grossMargin: null,
      grossMarginPct: null,
      priceStatus: res.status,
      calculationExpression: component.quantity > 1 && res.amount != null
        ? `${res.expression} × ${component.quantity} = $${extended.toFixed(2)}`
        : res.expression,
      matchedConditions: evidence,
      includedOrSuppressedBy: null,
      sourcePage: null,
      sourceRegionId: rule.sourceRegionId,
      priceBookId: rule.priceBookId,
      confidence: rule.extractionConfidence,
      exceptionMessage: res.exceptionMessage,
      componentId: component.id,
      sortOrder: sort++,
    });

    if (res.manualReason) {
      manualQuotes.push({ componentId: component.id, priceRuleId: rule.id, reason: res.manualReason, requestedInputs: res.exceptionMessage });
    }
  }

  // No base rule matched at all → explicit exception (never a silent zero).
  const hasBase = lines.some((l) => l.lineType === 'BASE' && l.priceStatus === 'PRICED');
  const requiresBase = component.entityType === 'door' || component.entityType === 'frame' ||
    component.entityType === 'panel' || component.entityType === 'lite_kit' ||
    component.entityType === 'louver' || component.entityType === 'glass' ||
    component.entityType === 'glazing_tape';
  const hasException = lines.some((l) => isException(l.priceStatus));
  if (!hasBase && !hasException && requiresBase) {
    lines.push({
      lineType: 'WARNING', priceRuleId: null, entityType: component.entityType,
      chargeCategory: 'base', description: `${component.label}: no base price matched`,
      selectedOptionCode: component.code, quantity: component.quantity, unitOfMeasure: null,
      unitListPrice: null, extendedListPrice: null, discountMultiplier: null, extendedNetPrice: null,
      sellPrice: null, grossMargin: null, grossMarginPct: null, priceStatus: 'INVALID',
      calculationExpression: 'No matching base price rule for this configuration',
      matchedConditions: null, includedOrSuppressedBy: null, sourcePage: null, sourceRegionId: null,
      priceBookId: selectedDocumentId ?? options.priceBookId, confidence: null,
      exceptionMessage: 'No base price rule matched — configuration cannot be priced from the published book.',
      componentId: component.id, sortOrder: sort++,
    });
    manualQuotes.push({ componentId: component.id, priceRuleId: null, reason: 'MISSING_PRICE', requestedInputs: `Base price for ${component.label}` });
  }

  return { lines, manualQuotes, amountByRuleId };
}

/**
 * Standard machined preps that are commonly included in a door/frame base price
 * when the hardware crosswalk resolves them and no separate prep price rule is
 * published: butt-hinge (450/500), strike (478/234), cylindrical/mortise lock
 * prep (CYL/L/T/MST/MP/CBF/CBE), and standard deadbolt prep (CDL/234N).
 * Special/unknown preps still require manual review.
 */
function isStandardIncludedPrep(code: string | null): boolean {
  if (!code) return false;
  const c = code.trim().toUpperCase();
  if (c === 'L' || c === 'T') return true;
  return ['450', '500', '478', '234', 'CYL', 'CDL', 'MST', 'MP', 'CBF', 'CBE', 'HINGE', 'HINGEF'].some((p) => c.startsWith(p));
}

/** Prices the derived Pioneer prep requirements through the rule path. */
function pricePreps(
  spec: NormalizedOpeningSpec,
  preps: PrepRequirement[],
  rules: LoadedPriceRule[],
  options: ComponentPriceOptions,
  startSort: number,
): ComponentPricing {
  const prepComponents: SpecComponent[] = preps.map((p, i) => {
    const owners = spec.components.filter((c) => c.entityType === p.entityType);
    const ownerKeys = new Set(owners.map((owner) =>
      owner.priceBookDocumentId
        ? `document:${owner.priceBookDocumentId}`
        : owner.manufacturerId
          ? `manufacturer:${owner.manufacturerId}`
          : 'unassigned'));
    const owner = ownerKeys.size === 1 ? owners[0] : null;
    const ambiguousOwner = owners.length > 1 && ownerKeys.size > 1;
    return {
      id: `prep-${i}`,
      entityType: 'prep',
      label: `${p.entityType === 'door' ? 'Door' : 'Frame'} prep ${p.prepCode} (${p.source})`,
      quantity: p.quantity,
      code: p.prepCode,
      // A sentinel manufacturer deliberately resolves to no document. This
      // prevents a prep shared by differently pinned components from matching
      // whichever manufacturer's rule happens to load first.
      manufacturerId: ambiguousOwner ? '__ambiguous_owner__' : owner?.manufacturerId ?? null,
      priceBookDocumentId: owner?.priceBookDocumentId ?? null,
      fields: {
        'prep.code': p.prepCode,
        'prep.entity': p.entityType,
        'prep.hardware_category': p.hardwareCategory,
        'prep.owner_ambiguous': ambiguousOwner,
      },
    };
  });

  const lines: EngineLine[] = [];
  const manualQuotes: EngineManualQuote[] = [];
  let sort = startSort;

  for (const comp of prepComponents) {
    const prepRules = rules.filter(
      (r) => r.entityType === 'prep' &&
        (r.itemOrOptionCode?.toLowerCase() === comp.code?.toLowerCase() || r.conditions.length > 0),
    );
    const priced = priceComponent(spec, comp, prepRules, options, sort);
    if (priced.lines.length === 0) {
      const ambiguousOwner = comp.fields['prep.owner_ambiguous'] === true;
      // No prep rule matched. Distinguish two cases instead of blindly assuming
      // either way (plan: "priced, explicitly source-included, or manual review"):
      //   • STANDARD machined preps (butt-hinge 450/500, strike 478/234,
      //     cylindrical/mortise lock prep CYL/L/T/MST/MP, deadbolt CDL/234N)
      //     are included in the door/frame base by convention → emit a
      //     non-blocking INCLUDED (N/C) line, preserving the owning price-book
      //     document so the audit trail remains manufacturer-scoped.
      //   • Any other / special prep is NOT assumed included → manual review.
      if (isStandardIncludedPrep(comp.code)) {
        lines.push({
          lineType: 'INCLUDED', priceRuleId: null, entityType: 'prep', chargeCategory: 'prep',
          description: `${comp.label} — standard prep, included in base`, selectedOptionCode: comp.code, quantity: comp.quantity, unitOfMeasure: null,
          unitListPrice: 0, extendedListPrice: 0, discountMultiplier: null, extendedNetPrice: 0,
          sellPrice: 0, grossMargin: null, grossMarginPct: null, priceStatus: 'INCLUDED',
          calculationExpression: 'Standard machined prep — included (N/C) in the door/frame base price',
          matchedConditions: null, includedOrSuppressedBy: null, sourcePage: null, sourceRegionId: null,
          priceBookId: componentDocumentId(comp, options) ?? options.priceBookId, confidence: null, exceptionMessage: null,
          componentId: null, sortOrder: sort++,
        });
        continue;
      }
      lines.push({
        lineType: 'WARNING', priceRuleId: null, entityType: 'prep', chargeCategory: 'prep',
        description: `${comp.label} — no prep price published`, selectedOptionCode: comp.code, quantity: comp.quantity, unitOfMeasure: null,
        unitListPrice: null, extendedListPrice: null, discountMultiplier: null, extendedNetPrice: null,
        sellPrice: null, grossMargin: null, grossMarginPct: null, priceStatus: 'INVALID',
        calculationExpression: ambiguousOwner
          ? 'Prep ownership spans multiple manufacturer documents — manual assignment required'
          : 'No prep price rule matched — manual review required (not assumed included)',
        matchedConditions: null, includedOrSuppressedBy: null, sourcePage: null, sourceRegionId: null,
        priceBookId: componentDocumentId(comp, options) ?? options.priceBookId, confidence: null,
        exceptionMessage: ambiguousOwner
          ? `Preparation ${comp.code ?? ''} applies to components from multiple manufacturer documents; assign the prep to the owning component before pricing.`
          : `Preparation ${comp.code ?? ''} for ${comp.label} has no published price rule; confirm it is included by a source rule or price it manually.`,
        componentId: null, sortOrder: sort++,
      });
      manualQuotes.push({ componentId: null, priceRuleId: null, reason: 'MISSING_PRICE', requestedInputs: `Prep price for ${comp.label} (${comp.code ?? ''})` });
      continue;
    }
    lines.push(...priced.lines);
    manualQuotes.push(...priced.manualQuotes);
    sort += priced.lines.length;
  }

  return { lines, manualQuotes, amountByRuleId: new Map() };
}

/** Keying + access-control bundle lines (routed external/manual — no price book). */
function priceKeyingAndAccess(spec: NormalizedOpeningSpec, priceBookId: string | null, startSort: number): { lines: EngineLine[]; manualQuotes: EngineManualQuote[] } {
  const lines: EngineLine[] = [];
  const manualQuotes: EngineManualQuote[] = [];
  let sort = startSort;

  if (spec.keying) {
    const count = spec.keying.keyedCylinderCount ?? 0;
    lines.push({
      lineType: 'EXTERNAL', priceRuleId: null, entityType: 'hardware', chargeCategory: 'keying',
      description: `Keying schedule${spec.keying.keyway ? ` (${spec.keying.keyway})` : ''}${count ? ` — ${count} cylinders` : ''}`,
      selectedOptionCode: null, quantity: Math.max(1, count), unitOfMeasure: 'cylinder',
      unitListPrice: null, extendedListPrice: null, discountMultiplier: null, extendedNetPrice: null,
      sellPrice: null, grossMargin: null, grossMarginPct: null, priceStatus: 'EXTERNAL_PENDING',
      calculationExpression: 'Keying priced as external scope', matchedConditions: null,
      includedOrSuppressedBy: null, sourcePage: null, sourceRegionId: null, priceBookId, confidence: null,
      exceptionMessage: 'Keying schedule requires external pricing before finalizing.',
      componentId: null, sortOrder: sort++,
    });
    manualQuotes.push({ componentId: null, priceRuleId: null, reason: 'MISSING_PRICE', requestedInputs: 'Price keying schedule (cylinders/keys)' });
  }

  if (spec.accessControl) {
    const ac = spec.accessControl;
    const parts = [ac.reader, ac.lockStrike, ac.powerTransfer, ac.powerSupply, ac.dps, ac.panelIo].filter(Boolean);
    lines.push({
      lineType: 'EXTERNAL', priceRuleId: null, entityType: 'hardware', chargeCategory: 'access_control',
      description: `Access-control bundle${parts.length ? `: ${parts.join(', ')}` : ''}`,
      selectedOptionCode: null, quantity: 1, unitOfMeasure: 'bundle',
      unitListPrice: null, extendedListPrice: null, discountMultiplier: null, extendedNetPrice: null,
      sellPrice: null, grossMargin: null, grossMarginPct: null, priceStatus: 'EXTERNAL_PENDING',
      calculationExpression: 'Access control priced as external scope', matchedConditions: null,
      includedOrSuppressedBy: null, sourcePage: null, sourceRegionId: null, priceBookId, confidence: null,
      exceptionMessage: 'Access-control bundle requires external pricing (reader/lock/strike/power/DPS/panel/cable).',
      componentId: null, sortOrder: sort++,
    });
    manualQuotes.push({ componentId: null, priceRuleId: null, reason: 'MISSING_PRICE', requestedInputs: 'Price access-control bundle components' });
  }

  return { lines, manualQuotes };
}

/** Service scope lines (install / labor / wiring / glazing / freight / tax). */
function priceServices(spec: NormalizedOpeningSpec, catalog: HardwareCatalog, subtotalSell: number, priceBookId: string | null, startSort: number): EngineLine[] {
  const lines: EngineLine[] = [];
  let sort = startSort;
  for (const svc of catalog.serviceScopes) {
    let amount: number | null = null;
    let qty = 1;
    let expr = '';
    switch (svc.basis) {
      // Engine lines describe ONE opening instance. The opening quantity is
      // applied exactly once at estimate/quote rollup, so service lines must NOT
      // multiply by spec.quantity here (that was the service double-extension).
      case 'per_opening':
        amount = svc.rate; qty = 1; expr = `${svc.rate ?? 0} per opening`;
        break;
      case 'per_leaf':
        amount = svc.rate; qty = spec.leafCount; expr = `${svc.rate ?? 0} per leaf × ${qty}`;
        break;
      case 'per_unit':
        amount = svc.rate; qty = 1; expr = `${svc.rate ?? 0} per unit`;
        break;
      case 'flat':
        amount = svc.rate; qty = 1; expr = `flat ${svc.rate ?? 0}`;
        break;
      case 'per_hour':
        amount = svc.rate; qty = 1; expr = `${svc.rate ?? 0} per hour (hours TBD)`;
        break;
      case 'percent_of':
        amount = svc.percent != null ? (subtotalSell * svc.percent) / 100 : null; qty = 1;
        expr = `${svc.percent ?? 0}% of ${subtotalSell.toFixed(2)}`;
        break;
      default: {
        const _exhaustive: never = svc.basis;
        amount = null;
      }
    }
    const extended = amount != null ? amount * qty : null;
    lines.push({
      lineType: amount != null ? 'ADDER' : 'WARNING', priceRuleId: null, entityType: 'hardware',
      chargeCategory: svc.scopeType, description: `${svc.name} (${svc.scopeType})`,
      selectedOptionCode: null, quantity: qty, unitOfMeasure: svc.basis,
      unitListPrice: amount, extendedListPrice: extended, discountMultiplier: null,
      extendedNetPrice: extended, sellPrice: extended, grossMargin: null, grossMarginPct: null,
      priceStatus: amount != null ? 'PRICED' : 'INVALID',
      calculationExpression: expr || 'Service rate not configured',
      matchedConditions: null, includedOrSuppressedBy: null, sourcePage: null, sourceRegionId: null,
      priceBookId, confidence: null,
      exceptionMessage: amount != null ? null : `Service "${svc.name}" has no configured rate.`,
      componentId: null, sortOrder: sort++,
    });
  }
  return lines;
}

/** Reserved keys in trigger_conditions that are metadata, not field predicates. */
const TRIGGER_META_KEYS = new Set(['source', 'note', 'predicates', 'mode', 'scope']);

interface TriggerPredicate {
  field: string;
  operator?: string;
  value?: unknown;
  value2?: unknown;
}

/** Evaluates one structured trigger predicate (executable narrative) vs the spec. */
function matchTriggerPredicate(spec: NormalizedOpeningSpec, pred: TriggerPredicate): boolean {
  const actual = readField(spec, null, pred.field);
  const op = (pred.operator ?? 'EQ').toUpperCase();
  const asNum = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const eqi = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  const list = (v: unknown) => String(v ?? '').split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
  switch (op) {
    case 'EXISTS': return actual != null && String(actual).trim() !== '';
    case 'MISSING': return actual == null || String(actual).trim() === '';
    case 'EQ': return eqi(actual, pred.value);
    case 'NE': return !eqi(actual, pred.value);
    case 'IN': return actual != null && list(pred.value).includes(String(actual).trim().toLowerCase());
    case 'NOT_IN': return actual == null || !list(pred.value).includes(String(actual).trim().toLowerCase());
    case 'GT': { const a = asNum(actual), b = asNum(pred.value); return a != null && b != null && a > b; }
    case 'GTE': { const a = asNum(actual), b = asNum(pred.value); return a != null && b != null && a >= b; }
    case 'LT': { const a = asNum(actual), b = asNum(pred.value); return a != null && b != null && a < b; }
    case 'LTE': { const a = asNum(actual), b = asNum(pred.value); return a != null && b != null && a <= b; }
    case 'BETWEEN': { const a = asNum(actual), lo = asNum(pred.value), hi = asNum(pred.value2); return a != null && lo != null && hi != null && a >= lo && a <= hi; }
    default: return eqi(actual, pred.value);
  }
}

/**
 * Evaluates dependency rules against the spec (warn vs block). Supports two
 * forms of `trigger_conditions`:
 *   - structured (compiled narrative): `{ predicates: [{field,operator,value}], mode }`
 *   - legacy simple equality: `{ "field.path": "expected", ... }` (null = EXISTS)
 * Metadata keys (source/note/scope) are ignored as predicates.
 */
function evaluateDependencies(spec: NormalizedOpeningSpec, deps: DependencyRule[]): DependencyOutcome[] {
  const outcomes: DependencyOutcome[] = [];
  for (const dep of deps) {
    const trigger = (dep.triggerConditions ?? {}) as Record<string, unknown>;

    let matched: boolean;
    const predicates = Array.isArray(trigger.predicates) ? (trigger.predicates as TriggerPredicate[]) : null;
    if (predicates) {
      if (predicates.length === 0) continue;
      const mode = String(trigger.mode ?? 'all').toLowerCase();
      matched = mode === 'any'
        ? predicates.some((p) => matchTriggerPredicate(spec, p))
        : predicates.every((p) => matchTriggerPredicate(spec, p));
    } else {
      const entries = Object.entries(trigger).filter(([k]) => !TRIGGER_META_KEYS.has(k));
      if (entries.length === 0) continue;
      matched = entries.every(([key, expected]) => {
        const actual = readField(spec, null, key);
        if (expected == null) return actual != null;
        return String(actual ?? '').trim().toLowerCase() === String(expected).trim().toLowerCase();
      });
    }
    if (!matched) continue;

    const blocking = dep.severity === 'BLOCK_PRICING' || dep.severity === 'BLOCK_ORDER' || dep.severity === 'ERROR';
    outcomes.push({
      rule: dep,
      message: dep.messageTemplate ?? `${dep.relationshipType} ${dep.targetIdOrValue ?? ''}`.trim(),
      blocking,
    });
  }
  return outcomes;
}

/** Numeric infill field reader from an NGP component. */
function infillNum(component: SpecComponent, key: string): number | null {
  const v = component.fields[key];
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * NGP option-adder pass: for each priced NGP component, applies the selected
 * option codes (finish %, galvanneal %, zinc, torx, STC/area, lead/perimeter,
 * mullion×qty, ...) using each component's resolved base amount. Reuses the same
 * action math as the Pioneer engine. Returns ADDER/MANUAL_QUOTE lines.
 */
function priceNgpOptions(
  spec: NormalizedOpeningSpec,
  componentLines: EngineLine[],
  ngp: NgpEngineData,
  priceBookId: string | null,
  startSort: number,
): { lines: EngineLine[]; manualQuotes: EngineManualQuote[] } {
  const lines: EngineLine[] = [];
  const manualQuotes: EngineManualQuote[] = [];
  let sort = startSort;
  const optionByCode = new Map(ngp.options.filter((o) => o.optionCode).map((o) => [o.optionCode!.toLowerCase(), o]));

  for (const component of spec.components) {
    if (!NGP_ENTITY_SET.has(component.entityType)) continue;
    const raw = component.fields['infill.options'];
    if (raw == null || String(raw).trim() === '') continue;
    const codes = String(raw).split(',').map((c) => c.trim()).filter(Boolean);
    if (codes.length === 0) continue;

    const baseLine = componentLines.find(
      (l) => l.componentId === component.id && l.lineType === 'BASE' && l.priceStatus === 'PRICED',
    );
    const baseAmount = baseLine?.extendedListPrice ?? 0;

    for (const code of codes) {
      const opt = optionByCode.get(code.toLowerCase());
      const rule = opt?.priceRuleId ? ngp.optionRuleById.get(opt.priceRuleId) : undefined;
      if (!opt || !rule) continue;

      const ctx: ActionContext = {
        quantity: component.quantity,
        quantityBasisValue: rule.quantityBasisField ? infillNum(component, rule.quantityBasisField) : null,
        minConfidence: 0,
        // PERCENT_OF references the NGP component's resolved base amount.
        resolveReference: () => baseAmount,
      };
      // PERCENT_OF needs a non-null reference id to resolve; synthesize one.
      const ruleForAction = rule.actionType === 'PERCENT_OF' ? { ...rule, referenceRuleId: rule.id } : rule;
      const res = resolveAction(ruleForAction, ctx);
      const amount = res.amount;
      lines.push({
        lineType: res.lineType, priceRuleId: rule.id, entityType: component.entityType,
        chargeCategory: `option:${code}`,
        description: `${component.label}: ${opt.optionName ?? code}`,
        selectedOptionCode: code, quantity: 1, unitOfMeasure: rule.unitOfMeasure,
        unitListPrice: amount, extendedListPrice: amount, discountMultiplier: null,
        extendedNetPrice: amount, sellPrice: amount, grossMargin: null, grossMarginPct: null,
        priceStatus: res.status, calculationExpression: res.expression, matchedConditions: { option: code },
        includedOrSuppressedBy: null, sourcePage: null, sourceRegionId: rule.sourceRegionId,
        priceBookId, confidence: rule.extractionConfidence, exceptionMessage: res.exceptionMessage,
        componentId: component.id, sortOrder: sort++,
      });
      if (res.manualReason) {
        manualQuotes.push({ componentId: component.id, priceRuleId: rule.id, reason: res.manualReason, requestedInputs: res.exceptionMessage });
      }
    }
  }
  return { lines, manualQuotes };
}

/** Finds an NGP commercial policy amount by id (falls back to a default). */
function policyAmount(policies: NgpCommercialPolicy[], id: string, fallback: number): number {
  const p = policies.find((x) => x.policyId === id);
  return p?.amountOrThreshold ?? fallback;
}

/**
 * NGP order-level commercial policies: oversize surcharge (>60" any infill dim),
 * material minimum ($30 floor) and small-order handling ($25 ≤ $125 net). Freight
 * and special-marking are order/shipment-level and applied at order finalization,
 * not per opening.
 */
function priceNgpPolicies(
  spec: NormalizedOpeningSpec,
  ngpLines: EngineLine[],
  policies: NgpCommercialPolicy[],
  priceBookId: string | null,
  startSort: number,
): EngineLine[] {
  const lines: EngineLine[] = [];
  let sort = startSort;
  const ngpNet = ngpLines.reduce((s, l) => s + (l.extendedNetPrice ?? 0), 0);
  if (ngpNet <= 0) return lines;

  const policyLine = (charge: string, desc: string, amount: number, expr: string): EngineLine => ({
    lineType: 'ADDER', priceRuleId: null, entityType: 'lite_kit', chargeCategory: charge,
    description: desc, selectedOptionCode: null, quantity: 1, unitOfMeasure: 'order',
    unitListPrice: amount, extendedListPrice: amount, discountMultiplier: null, extendedNetPrice: amount,
    sellPrice: amount, grossMargin: null, grossMarginPct: null, priceStatus: 'PRICED',
    calculationExpression: expr, matchedConditions: null, includedOrSuppressedBy: null,
    sourcePage: null, sourceRegionId: null, priceBookId, confidence: null, exceptionMessage: null,
    componentId: null, sortOrder: sort++,
  });

  // Oversize surcharge: any infill cutout dimension over 60".
  const oversize = spec.components.some(
    (c) => NGP_ENTITY_SET.has(c.entityType) &&
      ((infillNum(c, 'infill.order_width_in') ?? 0) > 60 || (infillNum(c, 'infill.order_height_in') ?? 0) > 60),
  );
  if (oversize) {
    const amt = policyAmount(policies, 'POL-OVERSIZE-100', 100);
    lines.push(policyLine('ngp_policy', 'NGP oversize surcharge (>60")', amt, `Oversize surcharge ${fmtUsd(amt)}`));
  }

  // Material minimum: floor the NGP material subtotal.
  const matMin = policyAmount(policies, 'POL-MATERIAL-MIN', 30);
  if (ngpNet < matMin) {
    const adj = Math.round((matMin - ngpNet) * 100) / 100;
    lines.push(policyLine('ngp_policy', 'NGP material minimum adjustment', adj, `Material minimum ${fmtUsd(matMin)} (net was ${fmtUsd(ngpNet)})`));
  }

  // Small-order handling charge.
  const handleP = policies.find((x) => x.policyId === 'POL-HANDLING-MIN');
  const handleThreshold = handleP ? Number((handleP.condition ?? '').replace(/[^0-9.]/g, '')) || 125 : 125;
  if (ngpNet <= handleThreshold) {
    const amt = handleP?.amountOrThreshold ?? 25;
    lines.push(policyLine('ngp_policy', 'NGP packing/handling charge', amt, `Handling ${fmtUsd(amt)} (order ≤ ${fmtUsd(handleThreshold)} net)`));
  }

  return lines;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Resolves the published price_book_document to price against when none is pinned
 * (the latest published Pioneer document).
 */
export async function resolveActivePriceBookDocument(): Promise<string | null> {
  // The default base book is Pioneer. Other steel manufacturers are selected
  // through component/manufacturer pins; they should not silently replace the
  // default fallback just because their effective date is newer.
  const { data } = await supabase
    .from('price_rule')
    .select('price_book_id, price_book_document!inner(id, status, source_verified, effective_date, ingestion_profile_key)')
    .eq('entity_type', 'door')
    .eq('action_type', 'BASE_AMOUNT')
    .eq('review_status', 'APPROVED')
    .eq('price_book_document.status', 'published')
    .eq('price_book_document.source_verified', true)
    .eq('price_book_document.ingestion_profile_key', 'pioneer-steel-doors-frames')
    .order('effective_date', { ascending: false, foreignTable: 'price_book_document', nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (data?.price_book_id) return data.price_book_id as string;
  // Fallback: latest published Pioneer document (legacy behavior, but scoped).
  const { data: doc } = await supabase
    .from('price_book_document')
    .select('id')
    .eq('status', 'published')
    .eq('source_verified', true)
    .eq('ingestion_profile_key', 'pioneer-steel-doors-frames')
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (doc?.id as string | undefined) ?? null;
}

/** Latest published document for each selected manufacturer (legacy fallback). */
async function resolveManufacturerDocuments(
  manufacturerIds: string[],
  pricedAsOf: string,
): Promise<Record<string, string>> {
  const ids = [...new Set(manufacturerIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data } = await supabase
    .from('price_book_document')
    .select('id, manufacturer_id, effective_date, created_at')
    .in('manufacturer_id', ids)
    .eq('status', 'published')
    .eq('review_status', 'APPROVED')
    .eq('source_verified', true)
    .order('effective_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    const manufacturerId = row.manufacturer_id as string | null;
    if (!manufacturerId || out[manufacturerId]) continue;
    if (row.effective_date && String(row.effective_date) > pricedAsOf) continue;
    out[manufacturerId] = row.id as string;
  }
  return out;
}

/**
 * Pure core: prices one opening against an already-loaded rule set + hardware
 * catalog + variant price map. Deterministic and DB-free (testable).
 */
export function priceOpeningCore(
  spec: NormalizedOpeningSpec,
  ruleSet: LoadedRuleSet,
  catalog: HardwareCatalog,
  variantMap: Map<string, import('./loader').VariantWithPrice>,
  options: EngineOptions,
  ngp?: NgpEngineData | null,
): EngineResult {
  const priceBookId = options.priceBookDocumentId;
  const minConfidence = options.minConfidence ?? 0.5;
  const opts: ComponentPriceOptions = {
    minConfidence,
    priceBookId,
    priceBookDocumentIdsByManufacturer: options.priceBookDocumentIdsByManufacturer,
  };

  const lines: EngineLine[] = [];
  const manualQuotes: EngineManualQuote[] = [];
  const warnings: string[] = [];

  // 1. Manufacturer books + NGP infill components (same canonical rule path).
  let sort = 0;
  const componentLines: EngineLine[] = [];
  for (const component of spec.components) {
    const priced = priceComponent(spec, component, ruleSet.rules, opts, sort);
    lines.push(...priced.lines);
    componentLines.push(...priced.lines);
    manualQuotes.push(...priced.manualQuotes);
    sort += priced.lines.length + 1;
  }

  // 1b. NGP option adders (finish/galv/zinc/torx/STC/lead/mullion) per component.
  if (ngp) {
    const opt = priceNgpOptions(spec, componentLines, ngp, priceBookId, 1500);
    lines.push(...opt.lines);
    manualQuotes.push(...opt.manualQuotes);
  }

  // 2. Hardware branch (sets → variants → prep requirements → linear → sell).
  const hw = priceHardware(spec, catalog, variantMap, {
    customerClass: options.customerClass ?? null,
    companyId: options.companyId ?? null,
    priceBookId,
  });
  lines.push(...hw.lines);
  manualQuotes.push(...hw.manualQuotes);
  warnings.push(...hw.warnings);

  // 3. Price derived door/frame prep requirements through the owning book.
  const prepPricing = pricePreps(spec, hw.prepRequirements, ruleSet.rules, opts, 2000);
  lines.push(...prepPricing.lines);
  manualQuotes.push(...prepPricing.manualQuotes);

  // 4. Keying + access control.
  const ka = priceKeyingAndAccess(spec, priceBookId, 3000);
  lines.push(...ka.lines);
  manualQuotes.push(...ka.manualQuotes);

  // Freeze the selected component manufacturer onto structural lines. Hardware
  // already carries its manufacturer from hardware_product and must never
  // inherit the door/frame manufacturer merely because the same pricing run
  // used a structural price book.
  const componentManufacturer = new Map(
    spec.components.map((component) => [component.id, component.manufacturerId ?? null]),
  );
  for (const line of lines) {
    if (line.entityType === 'hardware' || line.manufacturerId) continue;
    if (line.componentId) line.manufacturerId = componentManufacturer.get(line.componentId) ?? null;
  }

  // 4b. NGP order-level commercial policies (oversize / minimums / handling).
  if (ngp && ngp.policies.length > 0) {
    const ngpLines = lines.filter((l) => l.entityType != null && NGP_ENTITY_SET.has(l.entityType));
    lines.push(...priceNgpPolicies(spec, ngpLines, ngp.policies, priceBookId, 3500));
  }

  // Subtotal of priced sell before services (services percent_of references it).
  const subtotalSell = lines.reduce((sum, l) => sum + (l.sellPrice ?? 0), 0);
  const serviceLines = priceServices(spec, catalog, subtotalSell, priceBookId, 4000);
  lines.push(...serviceLines);

  // 5. Dependencies + totals.
  const dependencyResults = evaluateDependencies(spec, ruleSet.dependencyRules);

  const listTotal = lines.reduce((s, l) => s + (l.extendedListPrice ?? 0), 0);
  const netTotal = lines.reduce((s, l) => s + (l.extendedNetPrice ?? 0), 0);
  const sellTotal = lines.reduce((s, l) => s + (l.sellPrice ?? 0), 0);
  const exceptionCount = lines.filter((l) => isException(l.priceStatus)).length;

  return applyManualSellPriceOverrides({
    lines,
    manualQuotes,
    dependencyResults,
    warnings,
    totals: { listTotal, netTotal, sellTotal, exceptionCount, manualQuoteCount: manualQuotes.length },
  }, options.manualSellPriceByLineKey);
}

/**
 * DB-backed entry: loads the pinned rule set + hardware catalog + variant prices
 * and prices the opening. When no document is pinned, the latest published
 * document is used. Optionally persists the result.
 */
export async function priceOpening(
  spec: NormalizedOpeningSpec,
  options: EngineOptions,
): Promise<EngineResult> {
  const pricedAsOf = options.pricedAsOf ?? new Date().toISOString().slice(0, 10);
  const componentManufacturerIds = spec.components
    .filter((c) => !NGP_ENTITY_SET.has(c.entityType))
    .map((c) => c.manufacturerId)
    .filter((id): id is string => !!id);
  const resolvedByManufacturer = {
    ...(await resolveManufacturerDocuments(componentManufacturerIds, pricedAsOf)),
    ...(options.priceBookDocumentIdsByManufacturer ?? {}),
  };
  const needsFallbackDocument = spec.components.some(
    (c) => !NGP_ENTITY_SET.has(c.entityType) &&
      !c.priceBookDocumentId &&
      (!c.manufacturerId || !resolvedByManufacturer[c.manufacturerId]),
  );
  const fallbackDocumentId = options.priceBookDocumentId ??
    (needsFallbackDocument ? await resolveActivePriceBookDocument() : null);
  const selectedDocumentIds = [...new Set([
    ...spec.components
      .filter((c) => !NGP_ENTITY_SET.has(c.entityType))
      .map((c) => c.priceBookDocumentId ??
        (c.manufacturerId ? resolvedByManufacturer[c.manufacturerId] : null))
      .filter((id): id is string => !!id),
    ...(fallbackDocumentId ? [fallbackDocumentId] : []),
  ])];
  const ngpDocumentId = await resolveActiveNgpDocument();

  // Only load the NGP rules this opening references (resolved price tables + tape
  // models) — a full NGP book is ~18k rules.
  const ngpTableIds = spec.components
    .filter((c) => NGP_ENTITY_SET.has(c.entityType))
    .map((c) => (c.fields['infill.price_table_id'] != null ? String(c.fields['infill.price_table_id']) : ''))
    .filter(Boolean);
  const ngpTapeModels = spec.components
    .filter((c) => c.entityType === 'glazing_tape')
    .map((c) => (c.fields['infill.tape_model'] != null ? String(c.fields['infill.tape_model']) : c.code ?? ''))
    .filter(Boolean);

  const [loadedRuleSets, catalog, ngpRuleSet, ngpCatalog] = await Promise.all([
    Promise.all(selectedDocumentIds.map((id) => loadRuleSet(id, pricedAsOf))),
    loadHardwareCatalog(pricedAsOf),
    loadNgpScopedRuleSet(ngpDocumentId, ngpTableIds, ngpTapeModels, pricedAsOf),
    loadNgpCatalog(ngpDocumentId),
  ]);
  const ruleSet: LoadedRuleSet = {
    rules: loadedRuleSets.flatMap((set) => set.rules),
    dependencyRules: loadedRuleSets.flatMap((set) => set.dependencyRules),
  };

  // NGP matrix/direct/tape rules are priced through the same component path, so
  // merge them into the rule set. Option rules carry a non-matching selector and
  // are applied by the dedicated NGP option pass via optionRuleById.
  const mergedRuleSet: LoadedRuleSet = {
    rules: [...ruleSet.rules, ...ngpRuleSet.rules],
    dependencyRules: [...ruleSet.dependencyRules, ...ngpRuleSet.dependencyRules],
  };
  const optionRuleById = new Map(ngpRuleSet.rules.map((r) => [r.id, r]));
  const ngpData: NgpEngineData = {
    options: ngpCatalog.options,
    optionRuleById,
    policies: ngpCatalog.commercialPolicies,
  };

  const variantIds = spec.hardware.map((h) => h.variantId).filter((v): v is string => !!v);
  const variantMap = await loadVariantsWithPrices(variantIds, pricedAsOf);

  const result = priceOpeningCore(spec, mergedRuleSet, catalog, variantMap, {
    ...options,
    priceBookDocumentId: fallbackDocumentId,
    priceBookDocumentIdsByManufacturer: resolvedByManufacturer,
  }, ngpData);

  const missingManufacturerDocs = [...new Set(spec.components
    .filter((c) => c.manufacturerId && !c.priceBookDocumentId && !resolvedByManufacturer[c.manufacturerId])
    .map((c) => c.manufacturerId as string))];
  if (missingManufacturerDocs.length > 0) {
    result.warnings.unshift(`No published price book found for ${missingManufacturerDocs.length} selected manufacturer(s).`);
  } else if (selectedDocumentIds.length === 0) {
    result.warnings.unshift('No published manufacturer price book document — base/adder/prep lines cannot be priced.');
  }

  if (options.persist && spec.estimateId) {
    await persistEngineResult(spec, result, fallbackDocumentId, options.componentIdMap);
  }

  return result;
}

/** Resolves source_region.id → page_number (as text) for the given region ids. */
async function loadSourcePages(regionIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(regionIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const { data } = await supabase.from('source_region').select('id, page_number').in('id', ids);
  for (const r of data ?? []) {
    if (r.page_number != null) out.set(r.id as string, String(r.page_number));
  }
  return out;
}

/**
 * Persists engine lines into `estimate_line` and routes to `manual_quote_queue`.
 * Replaces any existing engine lines for the opening (idempotent re-price).
 */
export async function persistEngineResult(
  spec: NormalizedOpeningSpec,
  result: EngineResult,
  documentId: string | null,
  componentIdMap?: Map<string, string>,
): Promise<void> {
  if (spec.openingId) {
    await supabase.from('estimate_line').delete().eq('opening_id', spec.openingId);
  }

  // Resolve source pages so every persisted line records its workbook page, and
  // translate draft component ids to real estimate_items ids for the FK.
  const sourcePages = await loadSourcePages(result.lines.map((l) => l.sourceRegionId).filter((x): x is string => !!x));
  const realComponentId = (draftId: string | null): string | null => {
    if (!draftId) return null;
    return componentIdMap?.get(draftId) ?? null;
  };

  const rows = result.lines.map((l) => ({
    estimate_id: spec.estimateId,
    opening_id: spec.openingId,
    component_id: realComponentId(l.componentId),
    entity_type: l.entityType,
    line_type: l.lineType,
    price_rule_id: l.priceRuleId,
    charge_category: l.chargeCategory,
    description: l.description,
    selected_option_code: l.selectedOptionCode,
    quantity: l.quantity,
    unit_of_measure: l.unitOfMeasure,
    unit_list_price: l.unitListPrice,
    extended_list_price: l.extendedListPrice,
    discount_multiplier: l.discountMultiplier,
    extended_net_price: l.extendedNetPrice,
    sell_price: l.sellPrice,
    gross_margin: l.grossMargin,
    gross_margin_pct: l.grossMarginPct,
    price_status: l.priceStatus,
    calculation_expression: l.calculationExpression,
    matched_conditions: l.matchedConditions,
    included_or_suppressed_by: l.includedOrSuppressedBy,
    source_page: l.sourcePage ?? sourcePages.get(l.sourceRegionId ?? '') ?? null,
    source_region_id: l.sourceRegionId,
    price_book_id: l.priceBookId ?? documentId,
    manufacturer_id: l.manufacturerId ?? null,
    manufacturer_name: l.manufacturerName?.trim() || null,
    confidence: l.confidence,
    exception_message: l.exceptionMessage,
    sort_order: l.sortOrder,
    manual_sell_price: l.manualSellPrice ?? null,
    is_manual_override: l.isManualOverride === true,
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from('estimate_line').insert(rows);
    if (error) throw new Error(`Failed to persist estimate lines: ${error.message}`);
  }

  if (result.manualQuotes.length > 0) {
    const mqRows = result.manualQuotes.map((m) => ({
      estimate_id: spec.estimateId,
      opening_id: spec.openingId,
      component_id: realComponentId(m.componentId),
      price_rule_id: m.priceRuleId,
      reason: m.reason,
      requested_inputs: m.requestedInputs,
      status: 'open',
    }));
    const { error } = await supabase.from('manual_quote_queue').insert(mqRows);
    if (error) throw new Error(`Failed to enqueue manual quotes: ${error.message}`);
  }
}
