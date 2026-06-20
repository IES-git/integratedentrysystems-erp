/**
 * Auditable end-to-end opening quote model (Phase 5).
 *
 * Groups the rule engine's flat `EngineLine[]` (or persisted `estimate_line`
 * rows) into the separate-but-coordinated layers the "Example Opening" tab
 * lays out: Pioneer base + adders, Pioneer preparations (from the crosswalk),
 * actual hardware, linear accessories, keying, access control, and
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
  sourcePage: string | null;
  priceBookId: string | null;
  confidence: number | null;
  exceptionMessage: string | null;
}

export type QuoteLayerId =
  | 'pioneer_base'
  | 'pioneer_adders'
  | 'pioneer_preps'
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
  pioneer_base: 'Pioneer base (door / frame / panel)',
  pioneer_adders: 'Pioneer adders & options',
  pioneer_preps: 'Pioneer preparations (crosswalk)',
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
  'hardware',
  'linear',
  'keying',
  'access_control',
  'services',
];

const PIONEER_ENTITIES: ReadonlySet<RuleEntityType> = new Set<RuleEntityType>([
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
  if (cat === 'keying') return 'keying';
  if (cat === 'access_control') return 'access_control';
  if (SERVICE_SCOPE_TYPES.has(cat)) return 'services';

  if (entity === 'hardware') {
    if ((line.unitOfMeasure ?? '').toLowerCase() === 'ft' || cat.includes('linear')) return 'linear';
    return 'hardware';
  }

  if (entity && PIONEER_ENTITIES.has(entity)) {
    return line.lineType === 'BASE' ? 'pioneer_base' : 'pioneer_adders';
  }

  // Unknown entity: fall back on line type (BASE → base, else adders).
  return line.lineType === 'BASE' ? 'pioneer_base' : 'pioneer_adders';
}

function isException(status: EstimateLinePriceStatus): boolean {
  return EXCEPTION_STATUSES.has(status);
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

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** Adapts a live `EngineLine` (Phase 3) to the auditable `QuoteLine` shape. */
export function fromEngineLine(line: EngineLine): QuoteLine {
  return {
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
    sourcePage: line.sourcePage,
    priceBookId: line.priceBookId,
    confidence: line.confidence,
    exceptionMessage: line.exceptionMessage,
  };
}

/** Adapts a persisted `estimate_line` row to the auditable `QuoteLine` shape. */
export function fromEstimateLine(line: EstimateLine): QuoteLine {
  return {
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
    sourcePage: line.sourcePage,
    priceBookId: line.priceBookId,
    confidence: line.confidence,
    exceptionMessage: line.exceptionMessage,
  };
}

export function buildAuditableQuoteFromEngine(lines: EngineLine[]): AuditableQuote {
  return buildAuditableQuote(lines.map(fromEngineLine));
}

export function buildAuditableQuoteFromEstimateLines(lines: EstimateLine[]): AuditableQuote {
  return buildAuditableQuote(lines.map(fromEstimateLine));
}
