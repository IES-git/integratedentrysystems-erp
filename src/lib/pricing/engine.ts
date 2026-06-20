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
} from '@/types';
import { readField, type EngineOptions, type NormalizedOpeningSpec, type SpecComponent, type SpecValue } from './spec';
import type {
  DependencyOutcome,
  EngineLine,
  EngineManualQuote,
  EngineResult,
  LoadedPriceRule,
} from './engine-types';
import { evaluateConditions } from './conditions';
import { resolveAction, type ActionContext } from './actions';
import { loadHardwareCatalog, loadRuleSet, loadVariantsWithPrices, type HardwareCatalog, type LoadedRuleSet } from './loader';
import { priceHardware, type PrepRequirement } from './hardware';
import { parseDoorDimension } from '@/components/pricing/dimension-utils';

const EXCEPTION_STATUSES: EstimateLinePriceStatus[] = ['INVALID', 'CONTACT_FACTORY', 'EXTERNAL_PENDING'];

function isException(status: EstimateLinePriceStatus): boolean {
  return EXCEPTION_STATUSES.includes(status);
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

/** Prices one Pioneer component (door / frame / panel / lite / prep) via rules. */
function priceComponent(
  spec: NormalizedOpeningSpec,
  component: SpecComponent,
  rules: LoadedPriceRule[],
  options: Required<Pick<EngineOptions, 'minConfidence'>> & { priceBookId: string | null },
  startSort: number,
): ComponentPricing {
  const lines: EngineLine[] = [];
  const manualQuotes: EngineManualQuote[] = [];
  const amountByRuleId = new Map<string, number>();

  const candidates = rules.filter((r) => r.entityType === component.entityType);
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
        priceBookId: options.priceBookId, confidence: rule.extractionConfidence, exceptionMessage: null,
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
      priceBookId: options.priceBookId,
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
  if (!hasBase && (component.entityType === 'door' || component.entityType === 'frame' || component.entityType === 'panel')) {
    lines.push({
      lineType: 'WARNING', priceRuleId: null, entityType: component.entityType,
      chargeCategory: 'base', description: `${component.label}: no base price matched`,
      selectedOptionCode: component.code, quantity: component.quantity, unitOfMeasure: null,
      unitListPrice: null, extendedListPrice: null, discountMultiplier: null, extendedNetPrice: null,
      sellPrice: null, grossMargin: null, grossMarginPct: null, priceStatus: 'INVALID',
      calculationExpression: 'No matching base price rule for this configuration',
      matchedConditions: null, includedOrSuppressedBy: null, sourcePage: null, sourceRegionId: null,
      priceBookId: options.priceBookId, confidence: null,
      exceptionMessage: 'No base price rule matched — configuration cannot be priced from the published book.',
      componentId: component.id, sortOrder: sort++,
    });
    manualQuotes.push({ componentId: component.id, priceRuleId: null, reason: 'MISSING_PRICE', requestedInputs: `Base price for ${component.label}` });
  }

  return { lines, manualQuotes, amountByRuleId };
}

/** Prices the derived Pioneer prep requirements through the rule path. */
function pricePreps(
  spec: NormalizedOpeningSpec,
  preps: PrepRequirement[],
  rules: LoadedPriceRule[],
  options: Required<Pick<EngineOptions, 'minConfidence'>> & { priceBookId: string | null },
  startSort: number,
): ComponentPricing {
  const prepComponents: SpecComponent[] = preps.map((p, i) => ({
    id: `prep-${i}`,
    entityType: 'prep',
    label: `${p.entityType === 'door' ? 'Door' : 'Frame'} prep ${p.prepCode} (${p.source})`,
    quantity: p.quantity,
    code: p.prepCode,
    fields: {
      'prep.code': p.prepCode,
      'prep.entity': p.entityType,
      'prep.hardware_category': p.hardwareCategory,
    },
  }));

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
      // No prep rule at all: surface as an exception line (Pioneer prep charge missing).
      lines.push({
        lineType: 'WARNING', priceRuleId: null, entityType: 'prep', chargeCategory: 'prep',
        description: comp.label, selectedOptionCode: comp.code, quantity: comp.quantity, unitOfMeasure: null,
        unitListPrice: null, extendedListPrice: null, discountMultiplier: null, extendedNetPrice: null,
        sellPrice: null, grossMargin: null, grossMarginPct: null, priceStatus: 'INVALID',
        calculationExpression: 'No Pioneer prep price rule matched',
        matchedConditions: null, includedOrSuppressedBy: null, sourcePage: null, sourceRegionId: null,
        priceBookId: options.priceBookId, confidence: null,
        exceptionMessage: `No Pioneer prep price for "${comp.code}" — prep-vs-device reconciliation pending.`,
        componentId: null, sortOrder: sort++,
      });
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
      case 'per_opening':
        amount = svc.rate; qty = spec.quantity; expr = `${svc.rate ?? 0} per opening × ${spec.quantity}`;
        break;
      case 'per_leaf':
        amount = svc.rate; qty = spec.leafCount * spec.quantity; expr = `${svc.rate ?? 0} per leaf × ${qty}`;
        break;
      case 'per_unit':
        amount = svc.rate; qty = spec.quantity; expr = `${svc.rate ?? 0} per unit × ${qty}`;
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

/** Evaluates dependency rules against the spec (warn vs block). */
function evaluateDependencies(spec: NormalizedOpeningSpec, deps: DependencyRule[]): DependencyOutcome[] {
  const outcomes: DependencyOutcome[] = [];
  for (const dep of deps) {
    const trigger = dep.triggerConditions ?? {};
    const entries = Object.entries(trigger);
    if (entries.length === 0) continue;
    const allMatch = entries.every(([key, expected]) => {
      const actual = readField(spec, null, key);
      if (expected == null) return actual != null;
      return String(actual ?? '').trim().toLowerCase() === String(expected).trim().toLowerCase();
    });
    if (!allMatch) continue;
    const blocking = dep.severity === 'BLOCK_PRICING' || dep.severity === 'BLOCK_ORDER' || dep.severity === 'ERROR';
    outcomes.push({
      rule: dep,
      message: dep.messageTemplate ?? `${dep.relationshipType} ${dep.targetIdOrValue ?? ''}`.trim(),
      blocking,
    });
  }
  return outcomes;
}

/**
 * Resolves the published price_book_document to price against when none is pinned
 * (the latest published Pioneer document).
 */
export async function resolveActivePriceBookDocument(): Promise<string | null> {
  const { data } = await supabase
    .from('price_book_document')
    .select('id')
    .eq('status', 'published')
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
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
): EngineResult {
  const priceBookId = options.priceBookDocumentId;
  const minConfidence = options.minConfidence ?? 0.5;
  const opts = { minConfidence, priceBookId };

  const lines: EngineLine[] = [];
  const manualQuotes: EngineManualQuote[] = [];
  const warnings: string[] = [];

  // 1. Pioneer components.
  let sort = 0;
  for (const component of spec.components) {
    const priced = priceComponent(spec, component, ruleSet.rules, opts, sort);
    lines.push(...priced.lines);
    manualQuotes.push(...priced.manualQuotes);
    sort += priced.lines.length + 1;
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

  // 3. Price the derived Pioneer prep requirements through the rule path.
  const prepPricing = pricePreps(spec, hw.prepRequirements, ruleSet.rules, opts, 2000);
  lines.push(...prepPricing.lines);
  manualQuotes.push(...prepPricing.manualQuotes);

  // 4. Keying + access control.
  const ka = priceKeyingAndAccess(spec, priceBookId, 3000);
  lines.push(...ka.lines);
  manualQuotes.push(...ka.manualQuotes);

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

  return {
    lines,
    manualQuotes,
    dependencyResults,
    warnings,
    totals: { listTotal, netTotal, sellTotal, exceptionCount, manualQuoteCount: manualQuotes.length },
  };
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
  const documentId = options.priceBookDocumentId ?? (await resolveActivePriceBookDocument());

  const [ruleSet, catalog] = await Promise.all([
    documentId ? loadRuleSet(documentId, pricedAsOf) : Promise.resolve<LoadedRuleSet>({ rules: [], dependencyRules: [] }),
    loadHardwareCatalog(pricedAsOf),
  ]);

  const variantIds = spec.hardware.map((h) => h.variantId).filter((v): v is string => !!v);
  const variantMap = await loadVariantsWithPrices(variantIds, pricedAsOf);

  const result = priceOpeningCore(spec, ruleSet, catalog, variantMap, { ...options, priceBookDocumentId: documentId });

  if (!documentId) {
    result.warnings.unshift('No published price book document — Pioneer base/adder/prep lines cannot be priced.');
  }

  if (options.persist && spec.estimateId) {
    await persistEngineResult(spec, result, documentId);
  }

  return result;
}

/**
 * Persists engine lines into `estimate_line` and routes to `manual_quote_queue`.
 * Replaces any existing engine lines for the opening (idempotent re-price).
 */
export async function persistEngineResult(
  spec: NormalizedOpeningSpec,
  result: EngineResult,
  documentId: string | null,
): Promise<void> {
  if (spec.openingId) {
    await supabase.from('estimate_line').delete().eq('opening_id', spec.openingId);
  }

  const rows = result.lines.map((l) => ({
    estimate_id: spec.estimateId,
    opening_id: spec.openingId,
    component_id: null,
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
    source_page: l.sourcePage,
    source_region_id: l.sourceRegionId,
    price_book_id: documentId,
    confidence: l.confidence,
    exception_message: l.exceptionMessage,
    sort_order: l.sortOrder,
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from('estimate_line').insert(rows);
    if (error) throw new Error(`Failed to persist estimate lines: ${error.message}`);
  }

  if (result.manualQuotes.length > 0) {
    const mqRows = result.manualQuotes.map((m) => ({
      estimate_id: spec.estimateId,
      opening_id: spec.openingId,
      component_id: null,
      price_rule_id: m.priceRuleId,
      reason: m.reason,
      requested_inputs: m.requestedInputs,
      status: 'open',
    }));
    const { error } = await supabase.from('manual_quote_queue').insert(mqRows);
    if (error) throw new Error(`Failed to enqueue manual quotes: ${error.message}`);
  }
}
