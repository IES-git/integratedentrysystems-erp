/**
 * Quote completeness validation + prep-vs-device reconciliation (Phase 5).
 *
 * Implements pricing-flow step 11: a final opening status is blocked on
 * missing external prices, missing templates, incompatible ratings, CF items,
 * or unresolved scope — explicit exceptions, never silent zeros. Dependency
 * rule outcomes (block vs warn) and the prep<->device crosswalk reconciliation
 * are surfaced as issues so nothing can be quoted with a silent gap.
 *
 * Pure + UI-agnostic: works off the auditable quote model so both the live
 * builder review and the persisted wizard ReviewStep validate identically.
 */

import type { DependencyOutcome } from '@/lib/pricing';
import { requiresDoorFramePrep } from '@/lib/pricing';
import { classifyLayer, type AuditableQuote, type QuoteLayer, type QuoteLine } from './auditable-quote';

export type CompletenessSeverity = 'block' | 'warn' | 'info';

/**
 * A spec-builder step an issue can deep-link to so the estimator can jump
 * straight to the section that needs fixing. Mirrors the builder's `StepId`.
 */
export type BuilderStepTarget =
  | 'classify'
  | 'ratings'
  | 'doors'
  | 'frame'
  | 'panels'
  | 'lites'
  | 'cutouts'
  | 'preps'
  | 'hardware'
  | 'keying'
  | 'access'
  | 'construction'
  | 'review';

export interface CompletenessIssue {
  code: string;
  severity: CompletenessSeverity;
  message: string;
  /** The offending line's description, when the issue traces to one line. */
  lineDescription?: string;
  /**
   * The builder step that fixes this issue. Lets the review surface a "Fix"
   * button that jumps the user to the exact section that needs attention.
   */
  target?: BuilderStepTarget;
}

/**
 * Maps a quote line to the builder step where the estimator changes the
 * selection behind it (e.g. a hardware exception → the Hardware step, a missing
 * door base price → the Construction/series step).
 */
export function targetForLine(line: QuoteLine): BuilderStepTarget | undefined {
  const layer = classifyLayer(line);
  switch (layer) {
    case 'pioneer_base':
    case 'pioneer_adders':
      return line.entityType === 'frame'
        ? 'frame'
        : line.entityType === 'panel'
          ? 'panels'
          : line.entityType === 'door'
            ? 'doors'
            : 'construction';
    case 'pioneer_preps':
      return 'hardware';
    case 'ngp_infill':
      return 'cutouts';
    case 'hardware':
    case 'linear':
      return 'hardware';
    case 'keying':
      return 'keying';
    case 'access_control':
      return 'access';
    case 'services':
      return undefined;
    default: {
      const _exhaustive: never = layer;
      return _exhaustive;
    }
  }
}

export interface CompletenessReport {
  issues: CompletenessIssue[];
  blockingCount: number;
  warningCount: number;
  /** True when no blocking issues remain — the opening may be finalized. */
  canFinalize: boolean;
}

/** Maps an exception line-status to a stable issue code + message. */
function statusIssue(line: QuoteLine): CompletenessIssue | null {
  const target = targetForLine(line);
  switch (line.priceStatus) {
    case 'INVALID': {
      const isTemplate = /template/i.test(line.exceptionMessage ?? '');
      return {
        code: isTemplate ? 'MISSING_TEMPLATE' : 'MISSING_PRICE',
        severity: 'block',
        message: line.exceptionMessage ?? `No price resolved for "${line.description}".`,
        lineDescription: line.description,
        target,
      };
    }
    case 'CONTACT_FACTORY':
      return {
        code: 'CONTACT_FACTORY',
        severity: 'block',
        message: line.exceptionMessage ?? `"${line.description}" is contact-factory — obtain a factory quote before finalizing.`,
        lineDescription: line.description,
        target,
      };
    case 'EXTERNAL_PENDING':
      return {
        code: 'EXTERNAL_PENDING',
        severity: 'block',
        message: line.exceptionMessage ?? `"${line.description}" requires external pricing before finalizing.`,
        lineDescription: line.description,
        target,
      };
    case 'PRICED':
    case 'INCLUDED':
    case 'NO_CHARGE':
      return null;
    default: {
      const _exhaustive: never = line.priceStatus;
      return _exhaustive;
    }
  }
}

/** Token set for a category label (drops separators/short words). */
function tokens(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !['and', 'the', 'with', 'door', 'frame', 'prep'].includes(t))
      .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t)),
  );
}

function tokenOverlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

/** Extracts the crosswalk source category embedded in a prep line description. */
function prepSourceCategory(line: QuoteLine): string {
  // The source category is the parenthetical, e.g.
  // "Door prep CYL (Cylindrical lock) — included in base" → "Cylindrical lock".
  // Match the LAST parenthetical anywhere (a trailing "— included in base" suffix
  // means it's no longer anchored to end-of-string).
  const matches = [...line.description.matchAll(/\(([^)]+)\)/g)];
  const last = matches.length > 0 ? matches[matches.length - 1][1] : null;
  return (last ?? line.chargeCategory ?? line.description).trim();
}

function findLayer(quote: AuditableQuote, id: QuoteLayer['id']): QuoteLine[] {
  return quote.layers.find((l) => l.id === id)?.lines ?? [];
}

/**
 * Reconciles selected hardware devices against the Pioneer preps the crosswalk
 * generated: a device with no matching door/frame prep (and vice-versa) is a
 * warning so preps and devices stay in sync. Token-overlap based so it works on
 * both live and persisted lines.
 */
export function reconcilePrepVsDevice(quote: AuditableQuote): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];
  const devices = findLayer(quote, 'hardware').filter((l) => l.priceStatus !== 'INVALID' || l.selectedOptionCode);
  const preps = findLayer(quote, 'pioneer_preps');

  // Devices with no matching prep.
  for (const device of devices) {
    const group = device.chargeCategory ?? device.description;
    // Surface-mounted hardware (closers / plates / applied seals) needs no
    // machined door/frame prep — not a reconciliation gap.
    if (!requiresDoorFramePrep(group)) continue;
    const hasPrep = preps.some((p) => tokenOverlap(group, prepSourceCategory(p)) >= 0.34);
    if (!hasPrep) {
      issues.push({
        code: 'PREP_MISSING_FOR_DEVICE',
        severity: 'warn',
        message: `Hardware "${humanize(group)}" has no matching door/frame prep — verify the prep crosswalk.`,
        lineDescription: device.description,
        target: 'hardware',
      });
    }
  }

  // Preps with no matching device (orphans).
  for (const prep of preps) {
    const source = prepSourceCategory(prep);
    const hasDevice = devices.some((d) => tokenOverlap(d.chargeCategory ?? d.description, source) >= 0.34);
    if (!hasDevice) {
      issues.push({
        code: 'DEVICE_MISSING_FOR_PREP',
        severity: 'warn',
        message: `Prep "${prep.description}" has no matching hardware device selected.`,
        lineDescription: prep.description,
        target: 'hardware',
      });
    }
  }

  return issues;
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ');
}

export interface ValidateOptions {
  /** Dependency-rule outcomes from the engine (block vs warn). */
  dependencyResults?: DependencyOutcome[];
  /** Engine warnings (e.g. "no sell rule" / "cannot resolve length"). */
  warnings?: string[];
  /** Extra issues the caller computed (e.g. crosswalk-derive warnings). */
  extraIssues?: CompletenessIssue[];
  /** Skip the prep<->device reconciliation pass (defaults to on). */
  skipReconciliation?: boolean;
}

/**
 * Validates an auditable quote for completeness. Returns a report whose
 * `canFinalize` is false whenever any blocking issue remains.
 */
export function validateQuoteCompleteness(
  quote: AuditableQuote,
  opts: ValidateOptions = {},
): CompletenessReport {
  const issues: CompletenessIssue[] = [];

  // 1. Per-line price-status exceptions (missing price/template/CF/external).
  for (const layer of quote.layers) {
    for (const line of layer.lines) {
      const issue = statusIssue(line);
      if (issue) issues.push(issue);
    }
  }

  // 2. Dependency-rule outcomes (incompatible ratings / required combos).
  // These almost always trace to a hardware/config combination, so route the
  // user to the Hardware step to resolve the incompatibility.
  for (const dep of opts.dependencyResults ?? []) {
    issues.push({
      code: 'DEPENDENCY_RULE',
      severity: dep.blocking ? 'block' : 'warn',
      message: dep.message,
      target: 'hardware',
    });
  }

  // 3. Engine warnings (informational unless they hide a gap).
  for (const w of opts.warnings ?? []) {
    issues.push({ code: 'ENGINE_WARNING', severity: 'warn', message: w });
  }

  // 4. Prep <-> device reconciliation.
  if (!opts.skipReconciliation) {
    issues.push(...reconcilePrepVsDevice(quote));
  }

  // 5. Caller-supplied issues (e.g. crosswalk derive warnings).
  if (opts.extraIssues) issues.push(...opts.extraIssues);

  const blockingCount = issues.filter((i) => i.severity === 'block').length;
  const warningCount = issues.filter((i) => i.severity === 'warn').length;

  return {
    issues,
    blockingCount,
    warningCount,
    canFinalize: blockingCount === 0,
  };
}
