import type { QuoteContextSnapshot, QuoteLineSnapshot } from '@/types';

export type OperationalOutputKind = 'bom' | 'vendor' | 'kitting';
export type VendorExportPreset = 'internal' | 'ceco' | 'pioneer' | 'de_la_fontaine';
export type OperationalCsvPreset = VendorExportPreset | 'kitting';

export interface OperationalOutputRow {
  /** Stable source identity used for quote-specific manufacturer overrides. */
  sourceKey: string;
  manufacturerId: string | null;
  openingId: string | null;
  openingMark: string;
  entityType: string;
  category: string;
  vendor: string;
  partNumber: string;
  description: string;
  quantity: number;
  uom: string;
  size: string;
  cutoutSize: string;
  kitOrderSize: string;
  visibleGlassSize: string;
  glassType: string;
  finish: string;
  unitList: number | null;
  extendedList: number | null;
  unitNet: number | null;
  extendedNet: number | null;
  unitSell: number | null;
  lineTotal: number | null;
  grossMargin: number | null;
  grossMarginPct: number | null;
  frameOrderCallout: string;
  suggestedPo: string;
  reviewStatus: string;
  specifications: Array<{ key: string; label: string; value: string }>;
  specificationSummary: string;
}

export interface ManufacturerOutputGroup {
  key: string;
  manufacturerId: string | null;
  manufacturerName: string;
  rows: OperationalOutputRow[];
}

export type OperationalSnapshot = Partial<QuoteLineSnapshot> & {
  snapshotJson?: Record<string, unknown>;
};

export function operationalSnapshotKey(snapshot: OperationalSnapshot): string {
  if (snapshot.estimateLineId) return `estimate-line:${snapshot.estimateLineId}`;
  if (snapshot.estimateItemId) return `estimate-item:${snapshot.estimateItemId}`;
  if (snapshot.id) return `snapshot:${snapshot.id}`;
  return [
    snapshot.sourceTable ?? 'line',
    snapshot.openingId ?? 'no-opening',
    snapshot.componentId ?? 'no-component',
    snapshot.selectedOptionCode ?? snapshot.partNumber ?? snapshot.description ?? 'item',
    snapshot.sortOrder ?? 0,
  ].join(':');
}

type OpeningOrderData = {
  nominalWidth?: string | null;
  nominalHeight?: string | null;
  dodWidth?: string | null;
  dodHeight?: string | null;
  transomWidth?: string | null;
  transomHeight?: string | null;
  overallFrameWidth?: string | null;
  overallFrameHeight?: string | null;
  frameOrderCallout?: string | null;
};

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function number(value: unknown): number | null {
  const parsed = value == null ? null : Number(value);
  return parsed != null && Number.isFinite(parsed) ? parsed : null;
}

function snapshotFields(snapshot: OperationalSnapshot): Array<{ key: string; label: string; value: string }> {
  const fields = snapshot.snapshotJson?.fields;
  const explicit = Array.isArray(fields) ? fields.map((field) => {
    const row = field as Record<string, unknown>;
    return { key: text(row.key), label: text(row.label), value: text(row.value) };
  }) : [];
  const matched = snapshot.snapshotJson?.matchedConditions;
  const matchedFields = matched && typeof matched === 'object'
    ? Object.entries(matched as Record<string, unknown>).map(([key, value]) => ({
        key,
        label: key,
        value: text(value),
      }))
    : [];
  const seen = new Set(explicit.map((field) => field.key));
  return [...explicit, ...matchedFields.filter((field) => !seen.has(field.key))];
}

function findField(snapshot: OperationalSnapshot, pattern: RegExp): string {
  const field = snapshotFields(snapshot).find((candidate) => pattern.test(`${candidate.key} ${candidate.label}`));
  return field?.value ?? '';
}

function orderData(snapshot: OperationalSnapshot): OpeningOrderData {
  const data = snapshot.snapshotJson?.openingOrderData;
  return data && typeof data === 'object' ? data as OpeningOrderData : {};
}

function sizeFor(snapshot: OperationalSnapshot): string {
  const data = orderData(snapshot);
  const entity = text(snapshot.entityType).toLowerCase();
  const join = (width?: string | null, height?: string | null) => width && height ? `${width} x ${height}` : '';
  if (entity === 'frame') {
    return join(data.overallFrameWidth, data.overallFrameHeight)
      || join(data.dodWidth, data.dodHeight)
      || join(data.nominalWidth, data.nominalHeight);
  }
  if (entity === 'panel') {
    return join(data.transomWidth, data.transomHeight)
      || join(data.nominalWidth, data.nominalHeight);
  }
  if (entity === 'door') {
    return join(data.dodWidth, data.dodHeight)
      || join(data.nominalWidth, data.nominalHeight);
  }
  return findField(snapshot, /\b(size|length|width|height)\b/i);
}

function inchesPair(snapshot: OperationalSnapshot, widthKey: RegExp, heightKey: RegExp): string {
  const width = findField(snapshot, widthKey);
  const height = findField(snapshot, heightKey);
  return width && height ? `${width}" x ${height}"` : '';
}

function poBase(context: QuoteContextSnapshot | null | undefined): string {
  const raw = context?.job.jobNumber || context?.job.customerPo || context?.job.jobName || 'JOB';
  return raw.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'JOB';
}

function vendorToken(vendor: string): string {
  return (vendor || 'UNASSIGNED').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 16) || 'UNASSIGNED';
}

export function buildOperationalOutputRows(
  snapshots: OperationalSnapshot[],
  context?: QuoteContextSnapshot | null,
  options: { includeIncluded?: boolean } = {},
): OperationalOutputRow[] {
  const base = poBase(context);
  return snapshots
    .filter((snapshot) => {
      const status = text(snapshot.priceStatus).toUpperCase();
      return status !== 'NOT_APPLICABLE' && (options.includeIncluded || status !== 'INCLUDED');
    })
    .map((snapshot) => {
      const quantity = snapshot.quantity && snapshot.quantity > 0 ? snapshot.quantity : 1;
      const unitNet = snapshot.extendedNetPrice == null ? null : snapshot.extendedNetPrice / quantity;
      const vendor = text(snapshot.manufacturerName) || 'Unassigned';
      const cutoutSize = inchesPair(snapshot, /infill\.cutout_width_in/i, /infill\.cutout_height_in/i);
      const kitOrderSize = inchesPair(snapshot, /infill\.order_width_in/i, /infill\.order_height_in/i);
      const visibleGlassSize = inchesPair(snapshot, /infill\.visible_width_in/i, /infill\.visible_height_in/i);
      const glassType = findField(snapshot, /infill\.glass_type/i);
      const specifications = snapshotFields(snapshot).filter((field) => field.value);
      return {
        sourceKey: operationalSnapshotKey(snapshot),
        manufacturerId: snapshot.manufacturerId ?? null,
        openingId: snapshot.openingId ?? null,
        openingMark: text(snapshot.openingName) || 'Unassigned',
        entityType: text(snapshot.entityType) || 'item',
        category: text(snapshot.chargeCategory) || text(snapshot.sourceLineType) || 'Uncategorized',
        vendor,
        partNumber: text(snapshot.partNumber) || text(snapshot.selectedOptionCode),
        description: text(snapshot.description) || text(snapshot.snapshotJson?.itemLabel),
        quantity,
        uom: text(snapshot.unitOfMeasure) || 'EA',
        size: sizeFor(snapshot),
        cutoutSize,
        kitOrderSize,
        visibleGlassSize,
        glassType,
        finish: findField(snapshot, /\bfinish\b/i),
        unitList: snapshot.unitListPrice,
        extendedList: snapshot.extendedListPrice,
        unitNet,
        extendedNet: snapshot.extendedNetPrice,
        unitSell: snapshot.unitSellPrice ?? snapshot.sellPrice,
        lineTotal: snapshot.lineTotal,
        grossMargin: number(snapshot.snapshotJson?.grossMargin),
        grossMarginPct: number(snapshot.snapshotJson?.grossMarginPct),
        frameOrderCallout: text(orderData(snapshot).frameOrderCallout),
        suggestedPo: `${base}_${vendorToken(vendor)}`,
        reviewStatus: text(snapshot.reviewStatus),
        specifications,
        specificationSummary: specifications.map((field) => `${field.label}: ${field.value}`).join(' | '),
      };
    });
}

/** Internal commercial/service charges belong on the customer quote, not a manufacturer RFQ. */
export function isManufacturerProcurementRow(row: OperationalOutputRow): boolean {
  return !/\b(freight|shipping|tax|labor|installation|field install|service)\b/i.test(
    `${row.entityType} ${row.category} ${row.description}`,
  );
}

export function groupOperationalRowsByManufacturer(
  rows: OperationalOutputRow[],
): ManufacturerOutputGroup[] {
  const groups = new Map<string, ManufacturerOutputGroup>();
  for (const row of rows) {
    const key = row.manufacturerId
      ? `id:${row.manufacturerId}`
      : row.vendor && row.vendor !== 'Unassigned'
        ? `name:${row.vendor.toLowerCase()}`
        : 'unassigned';
    const group = groups.get(key) ?? {
      key,
      manufacturerId: row.manufacturerId,
      manufacturerName: row.vendor || 'Unassigned',
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === 'unassigned') return 1;
    if (b.key === 'unassigned') return -1;
    return a.manufacturerName.localeCompare(b.manufacturerName);
  });
}

export function buildKittingRows(rows: OperationalOutputRow[]): OperationalOutputRow[] {
  return rows.filter((row) => /hardware|hinge|lock|closer|exit|threshold|seal|strike|access.?control/i.test(
    `${row.entityType} ${row.category}`,
  ));
}

const PRESET_COLUMNS: Record<OperationalCsvPreset, Array<[keyof OperationalOutputRow, string]>> = {
  internal: [
    ['openingMark', 'Opening'], ['entityType', 'Type'], ['category', 'Category'], ['vendor', 'Vendor'],
    ['partNumber', 'Part Number'], ['description', 'Description'], ['quantity', 'Quantity'], ['uom', 'UOM'],
    ['size', 'Size'], ['cutoutSize', 'Cutout Size'], ['kitOrderSize', 'Kit Ordered Size'],
    ['visibleGlassSize', 'Visible Glass Size'], ['glassType', 'Glass Type'], ['finish', 'Finish'],
    ['unitList', 'Unit List'], ['extendedList', 'Extended List'],
    ['unitNet', 'Unit Net'], ['extendedNet', 'Extended Net'], ['unitSell', 'Unit Sell'], ['lineTotal', 'Sell Total'],
    ['grossMargin', 'Gross Margin'], ['grossMarginPct', 'GM Percent'], ['frameOrderCallout', 'Frame Order Callout'],
    ['specificationSummary', 'Technical Specifications'], ['suggestedPo', 'Suggested PO'], ['reviewStatus', 'Review Status'],
  ],
  ceco: [
    ['suggestedPo', 'PO'], ['openingMark', 'Opening Mark'], ['partNumber', 'Product / Series'],
    ['description', 'Description'], ['quantity', 'Qty'], ['size', 'Size'], ['cutoutSize', 'Cutout Size'],
    ['kitOrderSize', 'Kit Size'], ['visibleGlassSize', 'Visible Glass'], ['glassType', 'Glass'], ['finish', 'Finish'],
    ['frameOrderCallout', 'Frame Callout'], ['specificationSummary', 'Technical Specifications'], ['unitList', 'List'], ['unitNet', 'Net'],
  ],
  pioneer: [
    ['suggestedPo', 'PO'], ['openingMark', 'Mark'], ['frameOrderCallout', 'Order Callout'],
    ['partNumber', 'Code'], ['description', 'Description'], ['quantity', 'Qty'], ['size', 'Size'],
    ['cutoutSize', 'Cutout Size'], ['kitOrderSize', 'Kit Size'], ['visibleGlassSize', 'Visible Glass'], ['glassType', 'Glass'],
    ['finish', 'Finish'], ['specificationSummary', 'Technical Specifications'], ['unitList', 'List'], ['unitNet', 'Net'],
  ],
  de_la_fontaine: [
    ['suggestedPo', 'PO'], ['openingMark', 'Opening'], ['entityType', 'Product Type'],
    ['partNumber', 'Part / Series'], ['size', 'Dimensions'], ['cutoutSize', 'Cutout Size'],
    ['kitOrderSize', 'Kit Size'], ['visibleGlassSize', 'Visible Glass'], ['glassType', 'Glass'], ['description', 'Description'],
    ['finish', 'Finish'], ['quantity', 'Quantity'], ['unitList', 'List'], ['unitNet', 'Net'],
    ['frameOrderCallout', 'Order Notes'], ['specificationSummary', 'Technical Specifications'],
  ],
  kitting: [
    ['openingMark', 'Opening Mark'], ['category', 'Hardware Group'], ['partNumber', 'Part Number'],
    ['description', 'Description'], ['quantity', 'Quantity'], ['uom', 'UOM'], ['size', 'Size'],
    ['cutoutSize', 'Cutout Size'], ['kitOrderSize', 'Kit Size'], ['visibleGlassSize', 'Visible Glass'],
    ['glassType', 'Glass'], ['finish', 'Finish'], ['specificationSummary', 'Technical Specifications'],
  ],
};

function csvCell(value: unknown): string {
  const stringValue = value == null ? '' : String(value);
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

export function operationalRowsToCsv(
  rows: OperationalOutputRow[],
  preset: OperationalCsvPreset = 'internal',
): string {
  const columns = PRESET_COLUMNS[preset];
  return [
    columns.map(([, label]) => csvCell(label)).join(','),
    ...rows.map((row) => columns.map(([key]) => csvCell(row[key])).join(',')),
  ].join('\r\n');
}

export function manufacturerRfqFilename(
  context: QuoteContextSnapshot | null | undefined,
  manufacturerName: string,
  extension: 'pdf' | 'csv' = 'pdf',
): string {
  const manufacturer = vendorToken(manufacturerName).toLowerCase();
  return `${poBase(context)}-rfq-${manufacturer}.${extension}`;
}

export function operationalOutputFilename(
  kind: OperationalOutputKind,
  context?: QuoteContextSnapshot | null,
  preset?: VendorExportPreset,
): string {
  const job = poBase(context);
  const suffix = kind === 'vendor' && preset ? `-${preset.replace(/_/g, '-')}` : '';
  return `${job}-${kind}${suffix}.csv`;
}
