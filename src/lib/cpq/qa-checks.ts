/**
 * Price-book QA publication gate (Phase 5).
 *
 * Implements the Pioneer "QA Checks" tab + the hardware data-quality checks as
 * a gate that runs before a `price_book_document` is published: source
 * completeness, value semantics, unit basis, rule overlap, hardware net
 * reconciliation, and dependency coverage. Findings persist to `qa_issue` and
 * ERROR/BLOCK findings stop publication so no book goes live with silent gaps.
 *
 * The pure evaluators (`evaluateRuleQa` / `evaluateHardwareQa`) are DB-free and
 * unit-tested; the DB wrapper loads, persists, and gates.
 */

import { supabase } from '@/lib/supabase';
import { publishPriceBookDocument } from '@/lib/price-rules-api';
import type { QaIssueSeverity } from '@/types';
import { getPriceBookProfile } from '../../../services/price-book-worker/src/profiles.js';

export interface QaFinding {
  checkName: string;
  severity: QaIssueSeverity;
  detail: string;
  priceRuleId?: string | null;
  sourceRegionId?: string | null;
}

export interface QaResult {
  findings: QaFinding[];
  /** ERROR + BLOCK findings — these stop publication. */
  blockingCount: number;
  warningCount: number;
  /** True when no blocking findings remain. */
  passed: boolean;
}

/** Minimal rule shape the QA evaluators need (one per price_rule). */
export interface QaRule {
  id: string;
  entityType: string;
  chargeCategory: string | null;
  itemOrOptionCode: string | null;
  priceStatus: string;
  actionType: string;
  amount: number | null;
  percentage: number | null;
  referenceRuleId: string | null;
  unitOfMeasure: string | null;
  quantityBasisField: string | null;
  sourceRegionId: string | null;
  rawValueText: string | null;
  exclusiveGroup: string | null;
  /** Stable serialization of the rule's conditions, for overlap detection. */
  conditionsKey: string;
}

export interface QaHardwarePrice {
  id: string;
  listPrice: number | null;
  discountMultiplier: number | null;
  netCost: number | null;
}

/** One enum condition operand to validate against the governed vocabulary. */
export interface QaCondition {
  priceRuleId: string;
  fieldPath: string | null;
  operator: string;
  value1: string | null;
  sourceRegionId: string | null;
}

export interface QaIngestionProfileInput {
  profileKey: string | null;
  profileVersion: string | null;
  fileType: string | null;
  sourceSha256: string | null;
  sourcePageCount: number | null;
  coverage: Record<string, unknown> | null;
  baseRuleEntities: Set<string>;
}

/**
 * Governed vocabulary for an enum spec field: the canonical token set (from
 * `opening_spec_field.allowed_values`) plus any known raw->canonical aliases
 * (from `spec_value_alias`). All tokens are lower-cased/trimmed.
 */
export interface VocabField {
  canon: Set<string>;
  aliases: Map<string, 'alias' | 'reject'>;
}

const MULTI_VALUE_OPERATORS = new Set(['IN', 'NOT_IN']);
const VALUE_OPERATORS = new Set(['EQ', 'NE', 'IN', 'NOT_IN']);

function tokenize(value: string, operator: string): string[] {
  if (MULTI_VALUE_OPERATORS.has(operator)) {
    return value.split(/[|,]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  }
  return [value.trim().toLowerCase()].filter(Boolean);
}

/** Actions whose price legitimately has no numeric amount. */
const NON_NUMERIC_ACTIONS = new Set([
  'CONTACT_FACTORY',
  'EXTERNAL_REQUIRED',
  'NO_CHARGE',
  'INCLUDED',
  'NOT_APPLICABLE',
  'WAIVER',
  'PERCENT_OF',
  'REFERENCE_PLUS_ADD',
  'TIERED_ADD',
]);

const QTY_BASED_ACTIONS = new Set(['RATE_X_QUANTITY', 'FIXED_ADD_X_QTY']);

/**
 * Evaluates the rule-side QA checks (source completeness, value semantics, unit
 * basis, rule overlap) over a document's price rules.
 */
export function evaluateRuleQa(rules: QaRule[]): QaFinding[] {
  const findings: QaFinding[] = [];

  for (const r of rules) {
    // Source completeness — every rule must cite its evidence.
    if (!r.sourceRegionId) {
      findings.push({ checkName: 'source_completeness', severity: 'WARNING', priceRuleId: r.id, detail: `Rule ${r.id} has no source region citation.` });
    }
    if (!r.rawValueText) {
      findings.push({ checkName: 'source_completeness', severity: 'INFO', priceRuleId: r.id, sourceRegionId: r.sourceRegionId, detail: `Rule ${r.id} has no raw source text snapshot.` });
    }

    // Value semantics — numeric actions must carry a sane amount.
    if (!NON_NUMERIC_ACTIONS.has(r.actionType)) {
      if (r.amount == null) {
        findings.push({ checkName: 'value_semantics', severity: 'ERROR', priceRuleId: r.id, sourceRegionId: r.sourceRegionId, detail: `Rule ${r.id} (${r.actionType}) has no amount.` });
      } else if (r.amount < 0) {
        findings.push({ checkName: 'value_semantics', severity: 'ERROR', priceRuleId: r.id, sourceRegionId: r.sourceRegionId, detail: `Rule ${r.id} has a negative amount (${r.amount}).` });
      }
    }
    if (r.actionType === 'PERCENT_OF' && (r.percentage == null || r.percentage <= 0)) {
      findings.push({ checkName: 'value_semantics', severity: 'ERROR', priceRuleId: r.id, sourceRegionId: r.sourceRegionId, detail: `PERCENT_OF rule ${r.id} has no valid percentage.` });
    }
    if ((r.actionType === 'PERCENT_OF' || r.actionType === 'REFERENCE_PLUS_ADD') && !r.referenceRuleId) {
      findings.push({ checkName: 'value_semantics', severity: 'ERROR', priceRuleId: r.id, sourceRegionId: r.sourceRegionId, detail: `Reference action ${r.id} (${r.actionType}) has no reference rule.` });
    }

    // Unit basis — quantity-based rules need a unit + basis field.
    if (QTY_BASED_ACTIONS.has(r.actionType)) {
      if (!r.unitOfMeasure) {
        findings.push({ checkName: 'unit_basis', severity: 'WARNING', priceRuleId: r.id, sourceRegionId: r.sourceRegionId, detail: `Quantity-based rule ${r.id} has no unit of measure.` });
      }
      if (!r.quantityBasisField) {
        findings.push({ checkName: 'unit_basis', severity: 'WARNING', priceRuleId: r.id, sourceRegionId: r.sourceRegionId, detail: `Quantity-based rule ${r.id} has no quantity basis field.` });
      }
    }
  }

  // Rule overlap — two unconditioned BASE rules for the same entity/category
  // that aren't in an exclusive group would double-count the base.
  const baseKey = new Map<string, QaRule[]>();
  for (const r of rules) {
    if (r.actionType !== 'BASE_AMOUNT') continue;
    const key = `${r.entityType}|${r.chargeCategory ?? ''}|${r.conditionsKey}`;
    if (!baseKey.has(key)) baseKey.set(key, []);
    baseKey.get(key)!.push(r);
  }
  for (const [key, group] of baseKey) {
    if (group.length < 2) continue;
    const allInExclusive = group.every((g) => g.exclusiveGroup);
    if (allInExclusive) continue;
    findings.push({
      checkName: 'rule_overlap',
      severity: 'WARNING',
      priceRuleId: group[0].id,
      detail: `${group.length} BASE rules share conditions (${key}) without an exclusive group — risk of double-counting.`,
    });
  }

  return findings;
}

/**
 * Evaluates the hardware data-quality checks (net reconciliation) — list ×
 * discount should equal net within 1%; rows that don't reconcile or have no
 * resolvable net are flagged for human review before publish.
 */
export function evaluateHardwareQa(prices: QaHardwarePrice[]): QaFinding[] {
  const findings: QaFinding[] = [];
  for (const p of prices) {
    const hasNet = p.netCost != null;
    const canCompute = p.listPrice != null && p.discountMultiplier != null;
    if (!hasNet && !canCompute) {
      findings.push({ checkName: 'net_reconciliation', severity: 'ERROR', detail: `Hardware price ${p.id} has neither a net cost nor list × discount.` });
      continue;
    }
    if (hasNet && canCompute) {
      const computed = p.listPrice! * p.discountMultiplier!;
      const denom = Math.abs(p.netCost!) || 1;
      const drift = Math.abs(computed - p.netCost!) / denom;
      if (drift > 0.01) {
        findings.push({
          checkName: 'net_reconciliation',
          severity: 'WARNING',
          detail: `Hardware price ${p.id}: list × discount (${computed.toFixed(2)}) ≠ net (${p.netCost!.toFixed(2)}), drift ${(drift * 100).toFixed(1)}%.`,
        });
      }
    }
  }
  return findings;
}

/**
 * Vocabulary integrity — every enum condition operand must resolve to a
 * canonical token in `opening_spec_field.allowed_values` (the same list the
 * builder offers). A value that the builder can never emit silently kills the
 * rule, so:
 *   * canonical token        -> ok
 *   * known recoverable alias -> WARNING (auto-fixable via spec_value_alias)
 *   * reject / unknown token  -> ERROR (blocks publication)
 * Fields not present in `vocab` (non-enum, or unmapped) are skipped.
 */
export function evaluateVocabularyQa(conditions: QaCondition[], vocab: Map<string, VocabField>): QaFinding[] {
  const findings: QaFinding[] = [];
  for (const c of conditions) {
    if (!c.fieldPath || !VALUE_OPERATORS.has(c.operator) || c.value1 == null) continue;
    const field = vocab.get(c.fieldPath);
    if (!field) continue;
    for (const token of tokenize(c.value1, c.operator)) {
      if (token === 'null' || field.canon.has(token)) continue;
      const aliasStatus = field.aliases.get(token);
      if (aliasStatus === 'alias') {
        findings.push({
          checkName: 'vocab_alias_pending',
          severity: 'WARNING',
          priceRuleId: c.priceRuleId,
          sourceRegionId: c.sourceRegionId,
          detail: `Condition ${c.fieldPath} value "${token}" is a known alias; run the vocabulary cleanup to canonicalize it.`,
        });
      } else {
        findings.push({
          checkName: 'vocab_out_of_vocabulary',
          severity: 'ERROR',
          priceRuleId: c.priceRuleId,
          sourceRegionId: c.sourceRegionId,
          detail: `Condition ${c.fieldPath} value "${token}" is not in the governed vocabulary for this field — the builder can never match it.`,
        });
      }
    }
  }
  return findings;
}

/** One hardware variant for the price-coverage check. */
export interface QaHardwareVariant {
  id: string;
  sku: string | null;
  category: string;
  label: string;
}

/**
 * Hardware coverage — a variant with no approved price routes to manual quote
 * with no visibility. Flag each uncovered variant so the gap gets sourced.
 */
export function evaluateHardwareCoverage(
  variants: QaHardwareVariant[],
  pricedVariantIds: Set<string>,
): QaFinding[] {
  const findings: QaFinding[] = [];
  for (const v of variants) {
    if (pricedVariantIds.has(v.id)) continue;
    findings.push({
      checkName: 'hardware_missing_price',
      severity: 'ERROR',
      detail: `Variant ${v.sku ?? v.id} (${v.category} / ${v.label}) has no approved price; selections route to manual quote.`,
    });
  }
  return findings;
}

/** Dependency coverage — a published book should carry at least some narrative deps. */
export function evaluateDependencyCoverage(ruleCount: number, dependencyCount: number): QaFinding[] {
  if (ruleCount > 0 && dependencyCount === 0) {
    return [{ checkName: 'dependency_coverage', severity: 'INFO', detail: 'No dependency rules compiled — verify the book has no requires/excludes/auto-add narrative.' }];
  }
  return [];
}

/**
 * Source-profile coverage — verifies the exact source identity, ingestion lane,
 * catalog completeness, and required base-rule entities before publication.
 */
export function evaluateIngestionProfileQa(input: QaIngestionProfileInput): QaFinding[] {
  const findings: QaFinding[] = [];
  if (!input.profileKey) {
    return [{
      checkName: 'ingestion_profile_missing',
      severity: 'WARNING',
      detail: 'No governed ingestion profile is attached; source-family coverage cannot be proven automatically.',
    }];
  }
  const profile = getPriceBookProfile(input.profileKey);
  if (!profile) {
    return [{
      checkName: 'ingestion_profile_unknown',
      severity: 'ERROR',
      detail: `Unknown ingestion profile "${input.profileKey}".`,
    }];
  }

  if (input.profileVersion && input.profileVersion !== profile.version) {
    findings.push({
      checkName: 'ingestion_profile_version',
      severity: 'WARNING',
      detail: `Document used profile ${input.profileVersion}; current governed version is ${profile.version}. Re-run coverage before publish.`,
    });
  }
  if (!input.sourceSha256 || !/^[0-9a-f]{64}$/i.test(input.sourceSha256)) {
    findings.push({
      checkName: 'source_fingerprint',
      severity: 'ERROR',
      detail: 'The uploaded source has no valid SHA-256 fingerprint.',
    });
  }

  const knownSource = profile.knownSources.find((source) => source.sha256 === input.sourceSha256);
  if (knownSource?.pageCount != null && input.sourcePageCount !== knownSource.pageCount) {
    findings.push({
      checkName: 'source_page_count',
      severity: 'ERROR',
      detail: `Source fingerprint expects ${knownSource.pageCount} pages; document records ${input.sourcePageCount ?? 'none'}.`,
    });
  }

  if (profile.ingestionLane === 'pdf_rule_compiler') {
    if (input.coverage?.passed !== true) {
      const issues = Array.isArray(input.coverage?.issues)
        ? (input.coverage.issues as unknown[]).map(String).join(' ')
        : 'Catalog-stage profile coverage did not pass.';
      findings.push({
        checkName: 'catalog_profile_coverage',
        severity: 'BLOCK',
        detail: issues,
      });
    }
  } else if (!['xlsx', 'csv'].includes(input.fileType ?? '')) {
    findings.push({
      checkName: 'source_ingestion_lane',
      severity: 'BLOCK',
      detail: `${profile.manufacturer} requires the ${profile.ingestionLane} workbook lane; a ${input.fileType ?? 'missing'} source cannot be published through this document.`,
    });
  } else if (input.coverage?.passed !== true) {
    findings.push({
      checkName: 'workbook_preflight',
      severity: 'BLOCK',
      detail: `${profile.manufacturer} normalized workbook preflight did not pass.`,
    });
  }

  for (const entity of profile.requiredRuleEntities) {
    if (!input.baseRuleEntities.has(entity)) {
      findings.push({
        checkName: 'required_entity_coverage',
        severity: 'BLOCK',
        detail: `Profile ${profile.key} requires published base pricing for entity "${entity}", but no base rule was compiled.`,
      });
    }
  }
  return findings;
}

function summarize(findings: QaFinding[]): QaResult {
  const blockingCount = findings.filter((f) => f.severity === 'ERROR' || f.severity === 'BLOCK').length;
  const warningCount = findings.filter((f) => f.severity === 'WARNING').length;
  return { findings, blockingCount, warningCount, passed: blockingCount === 0 };
}

/** Combines all pure QA evaluators into one result. */
export function evaluateQa(input: {
  rules: QaRule[];
  hardwarePrices: QaHardwarePrice[];
  dependencyCount: number;
  conditions?: QaCondition[];
  vocab?: Map<string, VocabField>;
  hardwareVariants?: QaHardwareVariant[];
  pricedVariantIds?: Set<string>;
  ingestionProfile?: QaIngestionProfileInput;
}): QaResult {
  return summarize([
    ...evaluateRuleQa(input.rules),
    ...evaluateHardwareQa(input.hardwarePrices),
    ...evaluateDependencyCoverage(input.rules.length, input.dependencyCount),
    ...(input.conditions && input.vocab ? evaluateVocabularyQa(input.conditions, input.vocab) : []),
    ...(input.hardwareVariants && input.pricedVariantIds
      ? evaluateHardwareCoverage(input.hardwareVariants, input.pricedVariantIds)
      : []),
    ...(input.ingestionProfile ? evaluateIngestionProfileQa(input.ingestionProfile) : []),
  ]);
}

/**
 * Loads the governed vocabulary: canonical tokens from
 * `opening_spec_field.allowed_values` (keyed by spec_field_mapping.field_path)
 * plus raw->status aliases from `spec_value_alias`. All tokens lower-cased.
 */
export async function loadGovernedVocabulary(): Promise<Map<string, VocabField>> {
  const [{ data: fields, error: fErr }, { data: aliases, error: aErr }] = await Promise.all([
    supabase
      .from('spec_field_mapping')
      .select('field_path, opening_spec_field!inner(data_type, allowed_values)'),
    supabase.from('spec_value_alias').select('field_path, raw_value, status'),
  ]);
  if (fErr) throw new Error(`QA: failed to load spec field vocabulary: ${fErr.message}`);
  if (aErr) throw new Error(`QA: failed to load value aliases: ${aErr.message}`);

  const vocab = new Map<string, VocabField>();
  for (const row of fields ?? []) {
    const r = row as { field_path: string; opening_spec_field: { data_type?: string; allowed_values?: string | null } | null };
    const field = r.opening_spec_field;
    if (!field || field.data_type !== 'Enum' || !field.allowed_values) continue;
    const canon = new Set(
      field.allowed_values.split(';').map((t) => t.trim().toLowerCase()).filter(Boolean),
    );
    vocab.set(r.field_path, { canon, aliases: new Map() });
  }
  for (const row of aliases ?? []) {
    const a = row as { field_path: string; raw_value: string; status: 'alias' | 'reject' };
    const entry = vocab.get(a.field_path);
    if (entry) entry.aliases.set(a.raw_value.trim().toLowerCase(), a.status);
  }
  return vocab;
}

// ---------------------------------------------------------------------------
// DB-backed gate
// ---------------------------------------------------------------------------

function conditionsKey(conds: Record<string, unknown>[]): string {
  return conds
    .map((c) => `${c.field_path ?? c.field_id ?? ''}:${c.operator ?? ''}:${c.value_1 ?? ''}:${c.value_2 ?? ''}`)
    .sort()
    .join('|');
}

/** Loads a document's rules + hardware prices and runs the QA evaluators. */
export async function runQaChecks(documentId: string): Promise<QaResult> {
  const [
    { data: ruleRows, error: rErr },
    { data: depRows, error: dErr },
    { data: priceRows, error: pErr },
    { data: variantRows, error: vErr },
    { data: documentRow, error: docErr },
    { data: stagingRow, error: stagingErr },
  ] = await Promise.all([
    // REJECTED rules are excluded from pricing by the engine, so they should not
    // gate publication either — only APPROVED/UNREVIEWED rules are QA-checked.
    supabase.from('price_rule').select('*, rule_condition(field_path, field_id, operator, value_1, value_2)').eq('price_book_id', documentId).neq('review_status', 'REJECTED'),
    supabase.from('dependency_rule').select('id', { count: 'exact' }).eq('price_book_id', documentId),
    supabase.from('hardware_price').select('id, list_price, discount_multiplier, net_cost').neq('review_status', 'REJECTED'),
    supabase.from('hardware_variant').select('id, sku, hardware_product(category, model, description)'),
    supabase.from('price_book_document')
      .select('source_file_hash, page_count, ingestion_profile_key, ingestion_profile_version')
      .eq('id', documentId)
      .maybeSingle(),
    supabase.from('price_books')
      .select('file_type, source_sha256, source_page_count, ingestion_profile_key, ingestion_profile_version, ingestion_coverage')
      .eq('price_book_document_id', documentId)
      .limit(1)
      .maybeSingle(),
  ]);
  if (rErr) throw new Error(`QA: failed to load rules: ${rErr.message}`);
  if (dErr) throw new Error(`QA: failed to load dependency rules: ${dErr.message}`);
  if (pErr) throw new Error(`QA: failed to load hardware prices: ${pErr.message}`);
  if (vErr) throw new Error(`QA: failed to load hardware variants: ${vErr.message}`);
  if (docErr) throw new Error(`QA: failed to load price-book document profile: ${docErr.message}`);
  if (stagingErr) throw new Error(`QA: failed to load staging price-book profile: ${stagingErr.message}`);

  const rules: QaRule[] = (ruleRows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      entityType: (r.entity_type as string) ?? '',
      chargeCategory: (r.charge_category as string | null) ?? null,
      itemOrOptionCode: (r.item_or_option_code as string | null) ?? null,
      priceStatus: (r.price_status as string) ?? '',
      actionType: (r.action_type as string) ?? '',
      amount: r.amount == null ? null : Number(r.amount),
      percentage: r.percentage == null ? null : Number(r.percentage),
      referenceRuleId: (r.reference_rule_id as string | null) ?? null,
      unitOfMeasure: (r.unit_of_measure as string | null) ?? null,
      quantityBasisField: (r.quantity_basis_field as string | null) ?? null,
      sourceRegionId: (r.source_region_id as string | null) ?? null,
      rawValueText: (r.raw_value_text as string | null) ?? null,
      exclusiveGroup: (r.exclusive_group as string | null) ?? null,
      conditionsKey: conditionsKey((r.rule_condition as Record<string, unknown>[] | undefined) ?? []),
    };
  });

  const hardwarePrices: QaHardwarePrice[] = (priceRows ?? []).map((row) => {
    const p = row as Record<string, unknown>;
    return {
      id: p.id as string,
      listPrice: p.list_price == null ? null : Number(p.list_price),
      discountMultiplier: p.discount_multiplier == null ? null : Number(p.discount_multiplier),
      netCost: p.net_cost == null ? null : Number(p.net_cost),
    };
  });

  // Flatten every condition for the vocabulary gate and load the governed vocab.
  const conditions: QaCondition[] = [];
  for (const row of ruleRows ?? []) {
    const r = row as Record<string, unknown>;
    for (const cond of (r.rule_condition as Record<string, unknown>[] | undefined) ?? []) {
      conditions.push({
        priceRuleId: r.id as string,
        fieldPath: (cond.field_path as string | null) ?? null,
        operator: (cond.operator as string) ?? 'EQ',
        value1: (cond.value_1 as string | null) ?? null,
        sourceRegionId: (r.source_region_id as string | null) ?? null,
      });
    }
  }
  const vocab = await loadGovernedVocabulary();

  // Hardware coverage: variants vs the set that has an approved price.
  const hardwareVariants: QaHardwareVariant[] = (variantRows ?? []).map((row) => {
    const v = row as { id: string; sku: string | null; hardware_product: { category?: string; model?: string | null; description?: string | null } | null };
    const p = v.hardware_product;
    return {
      id: v.id,
      sku: v.sku,
      category: p?.category ?? '',
      label: p?.model ?? p?.description ?? 'unnamed',
    };
  });
  const { data: pricedRows, error: pvErr } = await supabase
    .from('hardware_price')
    .select('hardware_variant_id')
    .eq('review_status', 'APPROVED');
  if (pvErr) throw new Error(`QA: failed to load priced hardware variants: ${pvErr.message}`);
  const pricedVariantIds = new Set((pricedRows ?? []).map((r) => (r as { hardware_variant_id: string }).hardware_variant_id));
  const baseRuleEntities = new Set(rules
    .filter((rule) => rule.actionType === 'BASE_AMOUNT' && rule.priceStatus === 'PRICED')
    .map((rule) => rule.entityType));
  const profileKey = (stagingRow?.ingestion_profile_key as string | null) ??
    (documentRow?.ingestion_profile_key as string | null) ?? null;
  const isHardwareCatalogDocument =
    getPriceBookProfile(profileKey ?? '')?.ingestionLane === 'hardware_normalized_workbook';

  return evaluateQa({
    rules,
    // Hardware is a shared catalog, not a child of every door/frame/NGP
    // document. Run its global reconciliation/coverage gate only while
    // publishing the governed hardware workbook revision.
    hardwarePrices: isHardwareCatalogDocument ? hardwarePrices : [],
    dependencyCount: depRows?.length ?? 0,
    conditions,
    vocab,
    hardwareVariants: isHardwareCatalogDocument ? hardwareVariants : undefined,
    pricedVariantIds: isHardwareCatalogDocument ? pricedVariantIds : undefined,
    ingestionProfile: {
      profileKey,
      profileVersion: (stagingRow?.ingestion_profile_version as string | null) ??
        (documentRow?.ingestion_profile_version as string | null) ?? null,
      fileType: (stagingRow?.file_type as string | null) ?? null,
      sourceSha256: (stagingRow?.source_sha256 as string | null) ??
        (documentRow?.source_file_hash as string | null) ?? null,
      sourcePageCount: (stagingRow?.source_page_count as number | null) ??
        (documentRow?.page_count as number | null) ?? null,
      coverage: (stagingRow?.ingestion_coverage as Record<string, unknown> | null) ?? null,
      baseRuleEntities,
    },
  });
}

/**
 * Checks whose scope is the whole catalog (not one price book). These are
 * persisted once with `price_book_id = null` and deduped globally so they are
 * NOT multiplied by the number of published documents (e.g. hardware coverage
 * is a property of the shared hardware catalog, not of any single book).
 */
const GLOBAL_CHECKS: ReadonlySet<string> = new Set(['hardware_missing_price']);

/** Runs QA, replaces the document's open qa_issue rows, and returns the result. */
export async function runAndPersistQaChecks(documentId: string): Promise<QaResult> {
  const result = await runQaChecks(documentId);

  const docFindings = result.findings.filter((f) => !GLOBAL_CHECKS.has(f.checkName));
  const globalFindings = result.findings.filter((f) => GLOBAL_CHECKS.has(f.checkName));

  // Per-document findings: clear+replace this document's open rows.
  await supabase.from('qa_issue').delete().eq('price_book_id', documentId).eq('status', 'open');
  if (docFindings.length > 0) {
    const rows = docFindings.map((f) => ({
      price_book_id: documentId,
      price_rule_id: f.priceRuleId ?? null,
      source_region_id: f.sourceRegionId ?? null,
      check_name: f.checkName,
      severity: f.severity,
      detail: f.detail,
      status: 'open',
    }));
    const { error } = await supabase.from('qa_issue').insert(rows);
    if (error) throw new Error(`QA: failed to persist issues: ${error.message}`);
  }

  // Catalog-wide findings: clear ALL open rows for these checks (any document /
  // null) and re-insert once with no document scope, so they are counted once.
  for (const check of GLOBAL_CHECKS) {
    await supabase.from('qa_issue').delete().eq('check_name', check).eq('status', 'open');
  }
  if (globalFindings.length > 0) {
    const rows = globalFindings.map((f) => ({
      price_book_id: null,
      price_rule_id: f.priceRuleId ?? null,
      source_region_id: f.sourceRegionId ?? null,
      check_name: f.checkName,
      severity: f.severity,
      detail: f.detail,
      status: 'open',
    }));
    const { error } = await supabase.from('qa_issue').insert(rows);
    if (error) throw new Error(`QA: failed to persist global issues: ${error.message}`);
  }

  return result;
}

export class QaGateError extends Error {
  constructor(public readonly result: QaResult) {
    super(`QA gate blocked publication: ${result.blockingCount} blocking issue(s).`);
    this.name = 'QaGateError';
  }
}

export interface PublishWithQaOptions {
  supersedesId?: string | null;
  /** Publish despite blocking QA findings (records an explicit override). */
  override?: boolean;
}

/** BLOCK findings represent source-integrity invariants and are never overrideable. */
export function qaAllowsOverride(result: QaResult): boolean {
  return !result.findings.some((finding) => finding.severity === 'BLOCK');
}

/**
 * Publishes a draft price_book_document only after the QA gate passes. Throws a
 * `QaGateError` (carrying the result) when blocking findings remain and no
 * override was given. Findings are always persisted to `qa_issue` first.
 */
export async function publishPriceBookDocumentWithQa(
  documentId: string,
  opts: PublishWithQaOptions = {},
): Promise<QaResult> {
  const result = await runAndPersistQaChecks(documentId);
  if (!result.passed && (!opts.override || !qaAllowsOverride(result))) {
    throw new QaGateError(result);
  }
  await publishPriceBookDocument(documentId, opts.supersedesId ?? null);
  return result;
}
