/**
 * NGP infill intelligence (pure, testable).
 *
 * Turns a beginner-friendly cutout selection (infill type + cutout size, plus
 * the door thickness and opening fire rating already known from the build) into
 * a fully-resolved, priceable set of NGP components — auto-filtering to
 * compatible kits/louvers, auto-selecting the glazing tape from the kit/door/
 * glass capacity table, deciding bundling, computing order/exposed sizes and
 * louver cores, and validating fire visible-area limits.
 *
 * No DB access here — it operates entirely on a loaded `NgpCatalog`, so it is
 * deterministic and unit-testable. The builder uses it for live filtering/
 * preview; `opening-spec.ts` uses it to expand cutouts into engine components.
 */

import type { NgpProduct } from '@/types';
import type { NgpCatalog } from '@/lib/ngp-catalog-api';
import type { CompletenessIssue } from './completeness';

export type NgpInfillType = 'NONE' | 'LITE' | 'LOUVER';

export interface InfillSelectionInput {
  infillType: NgpInfillType;
  cutoutWidthIn: number | null;
  cutoutHeightIn: number | null;
  doorThicknessIn: number | null;
  /** Opening fire rating in minutes (0/null = non-rated). */
  fireRatingMinutes: number | null;
  /** User selections / overrides (each optional — auto-selected when absent). */
  kitModel?: string | null;
  louverModel?: string | null;
  glassModel?: string | null;
  glassThicknessIn?: number | null;
  tapeModel?: string | null;
  finishCode?: string | null;
  optionCodes?: string[];
  /** Prefer single-line assembly pricing (kit+glass+tape) when available. */
  preferAssembly?: boolean;
}

export interface InfillComponentDraft {
  entityType: 'lite_kit' | 'louver' | 'glass' | 'glazing_tape';
  code: string;
  label: string;
  quantity: number;
  /** infill.* fields the engine's NGP matrix/direct rules match on. */
  fields: Record<string, string | number>;
}

export interface ResolvedInfill {
  infillType: NgpInfillType;
  kit: NgpProduct | null;
  louver: NgpProduct | null;
  glass: NgpProduct | null;
  tapeModel: string | null;
  glassBundled: boolean;
  assemblyMode: boolean;
  priceTableId: string | null;
  glassPriceTableId: string | null;
  orderWidthIn: number | null;
  orderHeightIn: number | null;
  exposedWidthIn: number | null;
  exposedHeightIn: number | null;
  louverCores: number;
  candidateKits: NgpProduct[];
  candidateGlass: NgpProduct[];
  candidateLouvers: NgpProduct[];
  /** Auto-selected fields shown with an "auto" badge (value + reason). */
  autoFields: Record<string, { value: string; reason: string }>;
  components: InfillComponentDraft[];
  issues: CompletenessIssue[];
}

const STANDARD_TAPE = 'L-GT-118';

/** Round up to the next even inch ("odd-inch/fractional → next largest even size"). */
export function nextEvenSize(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return 2 * Math.ceil(x / 2);
}

function bundled(scope: string | null | undefined): boolean {
  const s = String(scope ?? '').toUpperCase();
  return s === 'BUNDLED' || s === 'BUNDLED_IN_ASSEMBLY';
}

function fireOk(product: NgpProduct, fireRatingMinutes: number | null): boolean {
  if (!fireRatingMinutes || fireRatingMinutes <= 0) return true;
  return (product.fireRatingMax ?? 0) >= fireRatingMinutes;
}

function thicknessOk(product: NgpProduct, doorThicknessIn: number | null): boolean {
  if (doorThicknessIn == null) return true;
  const lo = product.doorThicknessMinIn;
  const hi = product.doorThicknessMaxIn;
  if (lo != null && doorThicknessIn < lo - 1e-6) return false;
  if (hi != null && doorThicknessIn > hi + 1e-6) return false;
  return true;
}

/** Apply an NGP size rule (EQUALS/ADD/SUBTRACT) for one output field. */
export function applySizeRule(
  catalog: NgpCatalog,
  model: string,
  outputField: string,
  basis: number,
): number {
  const rule = catalog.sizeRules.find(
    (r) => r.modelOrFamily === model && r.outputField === outputField,
  ) ?? catalog.sizeRules.find(
    (r) => r.outputField === outputField && /ALL/i.test(r.modelOrFamily),
  );
  if (!rule) return basis;
  const v = rule.value ?? 0;
  switch ((rule.operator ?? 'EQUALS').toUpperCase()) {
    case 'SUBTRACT': return basis - v;
    case 'ADD': return basis + v;
    case 'EQUALS':
    default:
      // door_cutout EQUALS order_size (value 0) → output equals the basis.
      return basis;
  }
}

/** Compatible lite kits for the given door/rating/size, best candidate first. */
export function filterKits(catalog: NgpCatalog, input: InfillSelectionInput): NgpProduct[] {
  return catalog.products
    .filter((p) => p.category === 'LITE_KIT' && p.active)
    .filter((p) => thicknessOk(p, input.doorThicknessIn))
    .filter((p) => fireOk(p, input.fireRatingMinutes))
    .sort((a, b) => {
      // Prefer simpler standard vision kits, then by name for stability.
      const rank = (p: NgpProduct) => (p.subcategory === 'VISION_LITE' ? 0 : 1);
      return rank(a) - rank(b) || String(a.model ?? '').localeCompare(String(b.model ?? ''));
    });
}

/** Compatible louvers for the given door/rating. */
export function filterLouvers(catalog: NgpCatalog, input: InfillSelectionInput): NgpProduct[] {
  return catalog.products
    .filter((p) => p.category === 'LOUVER' && p.active)
    .filter((p) => thicknessOk(p, input.doorThicknessIn))
    .filter((p) => fireOk(p, input.fireRatingMinutes))
    .sort((a, b) => {
      const rank = (p: NgpProduct) => (p.subcategory === 'NO_VISION' ? 0 : 1);
      return rank(a) - rank(b) || String(a.model ?? '').localeCompare(String(b.model ?? ''));
    });
}

/** Glass options compatible with the fire rating (fire-rated glass for fire openings). */
export function glassOptions(catalog: NgpCatalog, input: InfillSelectionInput): NgpProduct[] {
  return catalog.products
    .filter((p) => p.category === 'GLASS' && p.active)
    .filter((p) => fireOk(p, input.fireRatingMinutes))
    .sort((a, b) => String(a.model ?? '').localeCompare(String(b.model ?? '')));
}

/** Closest capacity row for a kit/door/glass thickness → required glazing tape. */
export function resolveTape(
  catalog: NgpCatalog,
  kitModel: string,
  doorThicknessIn: number | null,
  glassThicknessIn: number | null,
): { tapeModel: string | null; matched: boolean } {
  const rows = catalog.capacities.filter((c) => c.kitModel === kitModel && c.allowed);
  if (rows.length === 0) return { tapeModel: null, matched: false };
  const score = (c: { doorThicknessIn: number | null; glassThicknessIn: number | null }) => {
    let s = 0;
    if (doorThicknessIn != null && c.doorThicknessIn != null) s += Math.abs(c.doorThicknessIn - doorThicknessIn);
    if (glassThicknessIn != null && c.glassThicknessIn != null) s += Math.abs(c.glassThicknessIn - glassThicknessIn);
    return s;
  };
  const best = [...rows].sort((a, b) => score(a) - score(b))[0];
  return { tapeModel: best?.requiredTapeModel ?? null, matched: !!best?.requiredTapeModel };
}

/** Resolve the compiled price table for a model, preferring assembly when asked. */
export function resolvePriceTable(
  catalog: NgpCatalog,
  model: string,
  opts: { glassModel?: string | null; preferAssembly?: boolean } = {},
): { priceTableId: string | null; includedScope: string | null; assembly: boolean } {
  const maps = catalog.tableMaps.filter((m) => m.model === model);
  if (maps.length === 0) return { priceTableId: null, includedScope: null, assembly: false };

  if (opts.preferAssembly && opts.glassModel) {
    const assembly = maps.find(
      (m) => (m.glassModel ?? '').toLowerCase() === opts.glassModel!.toLowerCase() &&
        /KIT_GLASS|ASSEMBLY|BOTH_SIDES/i.test(m.includedScope ?? ''),
    );
    if (assembly) return { priceTableId: assembly.priceTableId, includedScope: assembly.includedScope, assembly: true };
  }

  // Otherwise the kit-only / base matrix (prefer KIT_ONLY/LOUVER_ONLY/GLASS_ONLY).
  const base = maps.find((m) => /ONLY|SSD_BASE|FACE_PLATE|SECURITY/i.test(m.includedScope ?? ''))
    ?? maps.find((m) => !m.glassModel)
    ?? maps[0];
  return { priceTableId: base.priceTableId, includedScope: base.includedScope, assembly: false };
}

/** Glass matrix table for a glass model (separate-glass component pricing). */
export function glassPriceTable(catalog: NgpCatalog, glassModel: string): string | null {
  const m = catalog.tableMaps.find(
    (t) => t.model === glassModel && (t.entityType === 'glass' || /GLASS_ONLY/i.test(t.includedScope ?? '')),
  );
  return m?.priceTableId ?? null;
}

/** Louver core count from the catalog split-core thresholds. */
export function louverCores(catalog: NgpCatalog, material: string | null, orderW: number, orderH: number): number {
  const isAluminum = /alumin/i.test(material ?? '');
  const widthRule = catalog.sizeRules.find(
    (r) => r.outputField === 'two_core_width_threshold' &&
      (isAluminum ? /ALUMIN/i.test(r.modelOrFamily) : /STEEL|ALL/i.test(r.modelOrFamily)),
  );
  const heightRule = catalog.sizeRules.find((r) => r.outputField === 'two_core_height_threshold');
  const wThresh = widthRule?.value ?? (isAluminum ? 36 : 46);
  const hThresh = heightRule?.value ?? 64;
  let cores = 1;
  if (orderW > wThresh) cores = 2;
  if (orderH >= hThresh) cores = Math.max(cores, 2);
  return cores;
}

/** Validate exposed glass dimensions against fire rating limits. */
export function validateRating(
  catalog: NgpCatalog,
  glassModel: string,
  fireRatingMinutes: number | null,
  exposedW: number | null,
  exposedH: number | null,
): CompletenessIssue[] {
  if (!fireRatingMinutes || fireRatingMinutes <= 0) return [];
  const rows = catalog.ratings.filter(
    (r) => r.glassModel === glassModel && /door/i.test(r.application ?? '') &&
      ratingCoversMinutes(r.fireMinutes, fireRatingMinutes),
  );
  if (rows.length === 0) {
    return [{
      code: 'NGP_RATING_UNVERIFIED',
      severity: 'warn',
      message: `No published ${fireRatingMinutes}-min fire rating row found for glass "${glassModel}" in a door — verify the assembly rating.`,
    }];
  }
  const issues: CompletenessIssue[] = [];
  for (const r of rows) {
    if (exposedW != null && r.maxVisibleWidthIn != null && exposedW > r.maxVisibleWidthIn + 1e-6) {
      issues.push({ code: 'NGP_RATING_WIDTH', severity: 'block', message: `Exposed glass width ${exposedW}" exceeds the ${fireRatingMinutes}-min limit (${r.maxVisibleWidthIn}") for ${glassModel}.` });
    }
    if (exposedH != null && r.maxVisibleHeightIn != null && exposedH > r.maxVisibleHeightIn + 1e-6) {
      issues.push({ code: 'NGP_RATING_HEIGHT', severity: 'block', message: `Exposed glass height ${exposedH}" exceeds the ${fireRatingMinutes}-min limit (${r.maxVisibleHeightIn}") for ${glassModel}.` });
    }
    if (exposedW != null && exposedH != null && r.maxVisibleAreaSqIn != null && exposedW * exposedH > r.maxVisibleAreaSqIn + 1e-6) {
      issues.push({ code: 'NGP_RATING_AREA', severity: 'block', message: `Exposed glass area ${(exposedW * exposedH).toFixed(0)} sq in exceeds the ${fireRatingMinutes}-min limit (${r.maxVisibleAreaSqIn} sq in) for ${glassModel}.` });
    }
  }
  return issues;
}

/** True when a rating row's fire-minutes string covers the required minutes. */
function ratingCoversMinutes(fireMinutes: string | null, required: number): boolean {
  if (!fireMinutes) return false;
  const nums = fireMinutes.split(/[^0-9]+/).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0);
  return nums.includes(required) || nums.some((n) => n >= required);
}

/**
 * The orchestrator: resolves a beginner-friendly cutout selection into a fully
 * priceable infill (components + auto fields + issues). Everything the builder
 * shows as "auto" and everything `opening-spec.ts` turns into engine components
 * comes from here.
 */
export function resolveInfill(catalog: NgpCatalog, input: InfillSelectionInput): ResolvedInfill {
  const auto: Record<string, { value: string; reason: string }> = {};
  const issues: CompletenessIssue[] = [];
  const components: InfillComponentDraft[] = [];

  const orderW = input.cutoutWidthIn != null ? nextEvenSize(input.cutoutWidthIn) : null;
  const orderH = input.cutoutHeightIn != null ? nextEvenSize(input.cutoutHeightIn) : null;

  const base: ResolvedInfill = {
    infillType: input.infillType,
    kit: null, louver: null, glass: null, tapeModel: null,
    glassBundled: false, assemblyMode: false,
    priceTableId: null, glassPriceTableId: null,
    orderWidthIn: orderW, orderHeightIn: orderH,
    exposedWidthIn: null, exposedHeightIn: null,
    louverCores: 1,
    candidateKits: [], candidateGlass: [], candidateLouvers: [],
    autoFields: auto, components, issues,
  };

  if (input.infillType === 'NONE') return base;

  if (input.infillType === 'LOUVER') {
    const candidates = filterLouvers(catalog, input);
    base.candidateLouvers = candidates;
    const louver = candidates.find((p) => p.model === input.louverModel) ?? candidates[0] ?? null;
    base.louver = louver;
    if (!louver) {
      issues.push({ code: 'NGP_NO_LOUVER', severity: 'block', message: 'No compatible NGP louver for this door thickness / fire rating.' });
      return base;
    }
    if (!input.louverModel && louver.model) auto['louverModel'] = { value: louver.model, reason: 'Only compatible louver for this door/rating' };
    const cores = orderW != null && orderH != null ? louverCores(catalog, louver.material, orderW, orderH) : 1;
    base.louverCores = cores;
    if (cores > 1) auto['louverCores'] = { value: String(cores), reason: 'Catalog forces split cores above the size threshold' };

    const pt = resolvePriceTable(catalog, louver.model ?? '', {});
    base.priceTableId = pt.priceTableId;
    if (!pt.priceTableId) issues.push({ code: 'NGP_NO_PRICE', severity: 'block', message: `No published price matrix for louver "${louver.model}".` });
    else if (orderW != null && orderH != null) {
      components.push({
        entityType: 'louver', code: louver.model ?? 'louver', quantity: cores,
        label: `NGP louver ${louver.model} (${orderW}×${orderH})`,
        fields: ngpFields(pt.priceTableId, orderW, orderH, input),
      });
    }
    return base;
  }

  // ---- LITE ----
  const kits = filterKits(catalog, input);
  base.candidateKits = kits;
  const kit = kits.find((p) => p.model === input.kitModel) ?? kits[0] ?? null;
  base.kit = kit;
  if (!kit) {
    issues.push({ code: 'NGP_NO_KIT', severity: 'block', message: 'No compatible NGP lite kit for this door thickness / fire rating.' });
    return base;
  }
  if (!input.kitModel && kit.model) auto['kitModel'] = { value: kit.model, reason: 'Only / best compatible lite kit for this door' };

  const kitModel = kit.model ?? '';
  const glassScopeBundled = bundled(kit.glassScope);
  base.glassBundled = glassScopeBundled;

  // Glass selection (skipped when the kit bundles its glazing).
  const glassList = glassOptions(catalog, input);
  base.candidateGlass = glassList;
  let glass: NgpProduct | null = null;
  if (!glassScopeBundled) {
    glass = glassList.find((p) => p.model === input.glassModel) ?? glassList[0] ?? null;
    base.glass = glass;
    if (glass && !input.glassModel && glass.model) auto['glassModel'] = { value: glass.model, reason: 'Compatible glass for this fire rating' };
  }

  const glassThickness = input.glassThicknessIn ?? glass?.glassThicknessMinIn ?? null;

  // Order/exposed sizes from the size rules.
  if (orderW != null && orderH != null) {
    base.exposedWidthIn = applySizeRule(catalog, kitModel, 'exposed_glass', orderW);
    base.exposedHeightIn = applySizeRule(catalog, kitModel, 'exposed_glass', orderH);
  }

  // Assembly vs component pricing.
  const pt = resolvePriceTable(catalog, kitModel, { glassModel: glass?.model ?? null, preferAssembly: input.preferAssembly ?? true });
  base.assemblyMode = pt.assembly;
  base.priceTableId = pt.priceTableId;
  if (pt.assembly) auto['pricing'] = { value: 'Assembly (kit + glass + tape)', reason: 'Standard fire-glass assembly matrix prices the whole unit' };

  if (!pt.priceTableId) {
    issues.push({ code: 'NGP_NO_PRICE', severity: 'block', message: `No published price matrix for lite kit "${kitModel}".` });
  } else if (orderW != null && orderH != null) {
    components.push({
      entityType: 'lite_kit', code: kitModel, quantity: 1,
      label: `NGP lite kit ${kitModel} (${orderW}×${orderH})${pt.assembly ? ' assembly' : ''}`,
      fields: ngpFields(pt.priceTableId, orderW, orderH, input),
    });
  }

  // Separate glass + tape only when NOT bundled and NOT a full assembly.
  const needSeparateGlass = !glassScopeBundled && !pt.assembly;
  if (needSeparateGlass && glass) {
    const gpt = glassPriceTable(catalog, glass.model ?? '');
    base.glassPriceTableId = gpt;
    if (gpt && orderW != null && orderH != null) {
      components.push({
        entityType: 'glass', code: glass.model ?? 'glass', quantity: 1,
        label: `NGP glass ${glass.model} (${orderW}×${orderH})`,
        fields: { 'infill.price_table_id': gpt, 'infill.order_width_in': orderW, 'infill.order_height_in': orderH },
      });
    } else if (!gpt) {
      // Glass may be priced by a direct rule (round/polycarbonate) — opt-in code.
      issues.push({ code: 'NGP_GLASS_PRICE', severity: 'warn', message: `No standard glass matrix for "${glass.model}"; verify glass pricing.` });
    }
  }

  // Glazing tape (auto from capacity) — needed for component-mode lite kits.
  if (!glassScopeBundled && !pt.assembly) {
    const tape = input.tapeModel
      ? { tapeModel: input.tapeModel, matched: true }
      : resolveTape(catalog, kitModel, input.doorThicknessIn, glassThickness);
    const tapeModel = tape.tapeModel ?? STANDARD_TAPE;
    base.tapeModel = tapeModel;
    if (!input.tapeModel) {
      auto['tapeModel'] = { value: tapeModel, reason: tape.matched ? 'Required tape from the kit/glass capacity table' : 'Standard glazing tape default' };
    }
    components.push({
      entityType: 'glazing_tape', code: tapeModel, quantity: 1,
      label: `NGP glazing tape ${tapeModel}`,
      fields: { 'infill.tape_model': tapeModel },
    });
  }

  // Fire visible-area validation (block when exceeded).
  if (glass?.model && !glassScopeBundled) {
    issues.push(...validateRating(catalog, glass.model, input.fireRatingMinutes, base.exposedWidthIn, base.exposedHeightIn));
  }

  return base;
}

/** Common infill.* fields used by the matrix rules + the option/area pass. */
function ngpFields(priceTableId: string, orderW: number, orderH: number, input: InfillSelectionInput): Record<string, string | number> {
  const areaSqft = Math.max(1, Math.ceil((orderW * orderH) / 144));
  const perimeterIn = 2 * (orderW + orderH);
  const fields: Record<string, string | number> = {
    'infill.price_table_id': priceTableId,
    'infill.order_width_in': orderW,
    'infill.order_height_in': orderH,
    'infill.area_sqft': areaSqft,
    'infill.perimeter_in': perimeterIn,
  };
  if (input.finishCode) fields['infill.finish_code'] = input.finishCode;
  if (input.optionCodes && input.optionCodes.length) fields['infill.options'] = input.optionCodes.join(',');
  return fields;
}

/**
 * Mutual-exclusion gate: a single cutout cannot be both a lite and a louver.
 * Returns a blocking issue when both are requested for the same cutout.
 */
export function validateMutualExclusion(infillType: NgpInfillType, hasLite: boolean, hasLouver: boolean): CompletenessIssue[] {
  if (infillType !== 'NONE' && hasLite && hasLouver) {
    return [{ code: 'NGP_LITE_LOUVER_CONFLICT', severity: 'block', message: 'A single cutout cannot be both a lite and a louver — split into separate cutouts.' }];
  }
  return [];
}
