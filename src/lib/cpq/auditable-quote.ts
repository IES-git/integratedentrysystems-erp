/**
 * Auditable end-to-end opening quote model (Phase 5).
 *
 * Groups the rule engine's flat `EngineLine[]` (or persisted `estimate_line`
 * rows) into the separate-but-coordinated layers the "Example Opening" tab
 * lays out: door/frame base + adders, manufacturer preparations (from the
 * crosswalk), actual hardware, linear accessories, keying, access control, and
 * services/freight/tax. Each layer carries its own list/net/sell rollup, and
 * the hardware layers can be rolled up by group or as one all-hardware figure.
 *
 * Pure + UI-agnostic: both the live builder review and the wizard ReviewStep
 * render the same model (the latter via the `fromEstimateLines` adapter).
 */

import type {
  EngineLine,
  EstimateLine,
  EstimateLineType,
  EstimateLinePriceStatus,
  RuleEntityType,
  ServiceScopeType,
} from '@/types';

/** The minimal line shape the auditable quote groups + totals. */
export interface QuoteLine {
  componentId: string | null;
  entityType: RuleEntityType | null;
  lineType: EstimateLineType;
  chargeCategory: string | null;
  description: string;
  selectedOptionCode: string | null;
  quantity: number;
  unitOfMeasure: string | null;
  unitListPrice: number | null;
  extendedListPrice: number | null;
  discountMultiplier: number | null;
  extendedNetPrice: number | null;
  sellPrice: number | null;
  grossMargin: number | null;
  grossMarginPct: number | null;
  priceStatus: EstimateLinePriceStatus;
  calculationExpression: string;
  /** The spec field_path → value pairs that satisfied the matched rule. */
  matchedConditions: Record<string, unknown> | null;
  sourcePage: string | null;
  priceBookId: string | null;
  confidence: number | null;
  exceptionMessage: string | null;
  manualSellPrice?: number | null;
  isManualOverride?: boolean | null;
}

export type QuoteLayerId =
  | 'pioneer_base'
  | 'pioneer_adders'
  | 'pioneer_preps'
  | 'ngp_infill'
  | 'hardware'
  | 'linear'
  | 'keying'
  | 'access_control'
  | 'services';

export interface QuoteLayer {
  id: QuoteLayerId;
  title: string;
  lines: QuoteLine[];
  listTotal: number;
  netTotal: number;
  sellTotal: number;
  grossMargin: number;
  /** Lines with an unresolved exception status (INVALID/CF/EXTERNAL_PENDING). */
  exceptionCount: number;
  /** Data-quality warning, e.g. when one component matched >1 base price. */
  warning: string | null;
}

export interface HardwareRollup {
  /** Hardware charge category (e.g. butt_hinges), or 'all' for the grand row. */
  group: string;
  label: string;
  netTotal: number;
  sellTotal: number;
  grossMargin: number;
  grossMarginPct: number;
  lineCount: number;
}

export interface AuditableQuote {
  layers: QuoteLayer[];
  /** Hardware-only rollups by charge category + an 'all hardware' row. */
  hardwareRollups: HardwareRollup[];
  listTotal: number;
  netTotal: number;
  sellTotal: number;
  grossMargin: number;
  grossMarginPct: number;
  exceptionCount: number;
}

const SERVICE_SCOPE_TYPES: ReadonlySet<string> = new Set<ServiceScopeType>([
  'install',
  'labor',
  'wiring',
  'glazing',
  'freight',
  'packaging',
  'tax',
  'commissioning',
  'field_work',
]);

const EXCEPTION_STATUSES: ReadonlySet<EstimateLinePriceStatus> = new Set<EstimateLinePriceStatus>([
  'INVALID',
  'CONTACT_FACTORY',
  'EXTERNAL_PENDING',
]);

const LAYER_TITLES: Record<QuoteLayerId, string> = {
  pioneer_base: 'Door / frame / panel base',
  pioneer_adders: 'Door / frame adders & options',
  pioneer_preps: 'Door / frame preparations (crosswalk)',
  ngp_infill: 'NGP infill (glass / lite kits / louvers)',
  hardware: 'Actual hardware',
  linear: 'Linear accessories',
  keying: 'Keying',
  access_control: 'Access control',
  services: 'Services / freight / tax',
};

const LAYER_ORDER: QuoteLayerId[] = [
  'pioneer_base',
  'pioneer_adders',
  'pioneer_preps',
  'ngp_infill',
  'hardware',
  'linear',
  'keying',
  'access_control',
  'services',
];

const NGP_ENTITIES: ReadonlySet<RuleEntityType> = new Set<RuleEntityType>([
  'lite_kit',
  'louver',
  'glass',
  'glazing_tape',
]);

const DOOR_FRAME_ENTITIES: ReadonlySet<RuleEntityType> = new Set<RuleEntityType>([
  'door',
  'frame',
  'panel',
  'stick',
  'specialty',
  'anchor',
  'packaging',
]);

/** Classifies one line into a quote layer using entity + category + UOM. */
export function classifyLayer(line: QuoteLine): QuoteLayerId {
  const cat = (line.chargeCategory ?? '').toLowerCase();
  const entity = line.entityType;

  if (entity === 'prep' || cat === 'prep') return 'pioneer_preps';
  if ((entity && NGP_ENTITIES.has(entity)) || cat === 'ngp_policy') return 'ngp_infill';
  if (cat === 'keying') return 'keying';
  if (cat === 'access_control') return 'access_control';
  if (SERVICE_SCOPE_TYPES.has(cat)) return 'services';

  if (entity === 'hardware') {
    if ((line.unitOfMeasure ?? '').toLowerCase() === 'ft' || cat.includes('linear')) return 'linear';
    return 'hardware';
  }

  if (entity && DOOR_FRAME_ENTITIES.has(entity)) {
    return line.lineType === 'BASE' ? 'pioneer_base' : 'pioneer_adders';
  }

  // Unknown entity: fall back on line type (BASE → base, else adders).
  return line.lineType === 'BASE' ? 'pioneer_base' : 'pioneer_adders';
}

function isException(status: EstimateLinePriceStatus): boolean {
  return EXCEPTION_STATUSES.has(status);
}

/**
 * Flags when a single component matched more than one BASE price — the
 * double-counting signal (e.g. a mis-extracted size-code rule stacking on the
 * real base). Counts priced BASE lines per componentId.
 */
function duplicateBaseWarning(baseLines: QuoteLine[]): string | null {
  const byComponent = new Map<string, QuoteLine[]>();
  for (const l of baseLines) {
    if (l.lineType !== 'BASE' || l.priceStatus !== 'PRICED') continue;
    const key = l.componentId ?? `${l.entityType ?? 'unknown'}:no-component`;
    if (!byComponent.has(key)) byComponent.set(key, []);
    byComponent.get(key)!.push(l);
  }
  const offenders = [...byComponent.values()].filter((lines) => lines.length > 1);
  if (offenders.length === 0) return null;
  const detail = offenders
    .map((lines) => `${lines[0].entityType ?? 'component'} matched ${lines.length} base prices (${lines.map((l) => money(l.sellPrice)).join(' + ')})`)
    .join('; ');
  return `Possible double-count: ${detail}. Verify the price book — only one base should apply per component.`;
}

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function humanizeCategory(category: string): string {
  return category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Builds the layered, auditable quote model from a flat set of quote lines. */
export function buildAuditableQuote(lines: QuoteLine[]): AuditableQuote {
  const byLayer = new Map<QuoteLayerId, QuoteLine[]>();
  for (const id of LAYER_ORDER) byLayer.set(id, []);
  for (const line of lines) byLayer.get(classifyLayer(line))!.push(line);

  const layers: QuoteLayer[] = [];
  for (const id of LAYER_ORDER) {
    const layerLines = byLayer.get(id)!;
    if (layerLines.length === 0) continue;
    const listTotal = sum(layerLines, (l) => l.extendedListPrice);
    const netTotal = sum(layerLines, (l) => l.extendedNetPrice);
    const sellTotal = sum(layerLines, (l) => l.sellPrice);
    layers.push({
      id,
      title: LAYER_TITLES[id],
      lines: layerLines,
      listTotal,
      netTotal,
      sellTotal,
      grossMargin: sellTotal - netTotal,
      exceptionCount: layerLines.filter((l) => isException(l.priceStatus)).length,
      warning: id === 'pioneer_base' ? duplicateBaseWarning(layerLines) : null,
    });
  }

  const hardwareLines = [...(byLayer.get('hardware') ?? []), ...(byLayer.get('linear') ?? [])];
  const hardwareRollups = buildHardwareRollups(hardwareLines);

  const listTotal = sum(lines, (l) => l.extendedListPrice);
  const netTotal = sum(lines, (l) => l.extendedNetPrice);
  const sellTotal = sum(lines, (l) => l.sellPrice);
  const grossMargin = sellTotal - netTotal;

  return {
    layers,
    hardwareRollups,
    listTotal,
    netTotal,
    sellTotal,
    grossMargin,
    grossMarginPct: sellTotal > 0 ? (grossMargin / sellTotal) * 100 : 0,
    exceptionCount: lines.filter((l) => isException(l.priceStatus)).length,
  };
}

/** Rolls hardware lines up by charge category, plus an 'all hardware' row. */
function buildHardwareRollups(hardwareLines: QuoteLine[]): HardwareRollup[] {
  if (hardwareLines.length === 0) return [];
  const byGroup = new Map<string, QuoteLine[]>();
  for (const line of hardwareLines) {
    const group = line.chargeCategory ?? 'uncategorized';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(line);
  }

  const rollups: HardwareRollup[] = [];
  for (const [group, groupLines] of byGroup) {
    const netTotal = sum(groupLines, (l) => l.extendedNetPrice);
    const sellTotal = sum(groupLines, (l) => l.sellPrice);
    const gm = sellTotal - netTotal;
    rollups.push({
      group,
      label: humanizeCategory(group),
      netTotal,
      sellTotal,
      grossMargin: gm,
      grossMarginPct: sellTotal > 0 ? (gm / sellTotal) * 100 : 0,
      lineCount: groupLines.length,
    });
  }
  rollups.sort((a, b) => b.sellTotal - a.sellTotal);

  const allNet = sum(hardwareLines, (l) => l.extendedNetPrice);
  const allSell = sum(hardwareLines, (l) => l.sellPrice);
  const allGm = allSell - allNet;
  rollups.push({
    group: 'all',
    label: 'All hardware',
    netTotal: allNet,
    sellTotal: allSell,
    grossMargin: allGm,
    grossMarginPct: allSell > 0 ? (allGm / allSell) * 100 : 0,
    lineCount: hardwareLines.length,
  });

  return rollups;
}

function sum(lines: QuoteLine[], pick: (l: QuoteLine) => number | null): number {
  return lines.reduce((s, l) => s + (pick(l) ?? 0), 0);
}

function withManualSellPrice(line: QuoteLine): QuoteLine {
  const manualSellPrice = line.manualSellPrice ?? null;
  if (manualSellPrice === null) return line;

  const grossMargin = line.extendedNetPrice != null ? manualSellPrice - line.extendedNetPrice : null;
  return {
    ...line,
    sellPrice: manualSellPrice,
    grossMargin,
    grossMarginPct: grossMargin != null && manualSellPrice > 0 ? (grossMargin / manualSellPrice) * 100 : null,
    priceStatus: 'PRICED',
    isManualOverride: true,
    calculationExpression: /manual sell/i.test(line.calculationExpression)
      ? line.calculationExpression
      : line.calculationExpression
      ? `${line.calculationExpression}; manual sell ${money(manualSellPrice)}`
      : `Manual sell ${money(manualSellPrice)}`,
  };
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** Adapts a live `EngineLine` (Phase 3) to the auditable `QuoteLine` shape. */
export function fromEngineLine(line: EngineLine): QuoteLine {
  return withManualSellPrice({
    componentId: line.componentId,
    entityType: line.entityType,
    lineType: line.lineType,
    chargeCategory: line.chargeCategory,
    description: line.description,
    selectedOptionCode: line.selectedOptionCode,
    quantity: line.quantity,
    unitOfMeasure: line.unitOfMeasure,
    unitListPrice: line.unitListPrice,
    extendedListPrice: line.extendedListPrice,
    discountMultiplier: line.discountMultiplier,
    extendedNetPrice: line.extendedNetPrice,
    sellPrice: line.sellPrice,
    grossMargin: line.grossMargin,
    grossMarginPct: line.grossMarginPct,
    priceStatus: line.priceStatus,
    calculationExpression: line.calculationExpression,
    matchedConditions: line.matchedConditions,
    sourcePage: line.sourcePage,
    priceBookId: line.priceBookId,
    confidence: line.confidence,
    exceptionMessage: line.exceptionMessage,
    manualSellPrice: line.manualSellPrice ?? null,
    isManualOverride: line.isManualOverride ?? null,
  });
}

/** Adapts a persisted `estimate_line` row to the auditable `QuoteLine` shape. */
export function fromEstimateLine(line: EstimateLine): QuoteLine {
  return withManualSellPrice({
    componentId: line.componentId,
    entityType: line.entityType,
    lineType: line.lineType,
    chargeCategory: line.chargeCategory,
    description: line.description ?? '',
    selectedOptionCode: line.selectedOptionCode,
    quantity: line.quantity ?? 1,
    unitOfMeasure: line.unitOfMeasure,
    unitListPrice: line.unitListPrice,
    extendedListPrice: line.extendedListPrice,
    discountMultiplier: line.discountMultiplier,
    extendedNetPrice: line.extendedNetPrice,
    sellPrice: line.sellPrice,
    grossMargin: line.grossMargin,
    grossMarginPct: line.grossMarginPct,
    priceStatus: line.priceStatus ?? 'PRICED',
    calculationExpression: line.calculationExpression ?? '',
    matchedConditions: line.matchedConditions,
    sourcePage: line.sourcePage,
    priceBookId: line.priceBookId,
    confidence: line.confidence,
    exceptionMessage: line.exceptionMessage,
    manualSellPrice: line.manualSellPrice ?? null,
    isManualOverride: line.isManualOverride ?? null,
  });
}

export function buildAuditableQuoteFromEngine(lines: EngineLine[]): AuditableQuote {
  // Hide exclusive-group / override / included-scope suppression lines from the
  // quote display (they're always $0 and just noise — e.g. every losing matrix
  // cell). They remain in the persisted estimate_line rows for the full audit.
  return buildAuditableQuote(lines.filter((l) => !l.includedOrSuppressedBy).map(fromEngineLine));
}

export function buildAuditableQuoteFromEstimateLines(lines: EstimateLine[]): AuditableQuote {
  return buildAuditableQuote(lines.filter((l) => !l.includedOrSuppressedBy).map(fromEstimateLine));
}
