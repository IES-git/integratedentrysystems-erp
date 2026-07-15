import type {
  QuoteAudienceDisplayConfig,
  CompanySettings,
  QuoteDisplayBlock,
  QuoteDisplayBlockId,
  QuoteDisplayConfig,
  QuoteDisplayConfigV2,
  QuoteDisplayDetailLevel,
  QuoteDisplayDetailMode,
  QuoteItem,
  QuoteOrganizationMode,
  QuoteVisibleColumn,
  Template,
  TemplateAudience,
} from '@/types';

export interface QuotePresentationLineOption {
  displayKey: string;
  label: string;
  canonicalCode?: string | null;
  quantity: number;
  lineTotal: number;
  unitPrice?: number;
  unitCost?: number;
}

export interface QuoteDisplayRow {
  id: string;
  label: string;
  mark: string | null;
  productGroup: string | null;
  canonicalCode?: string | null;
  quantity: number;
  unitOfMeasure: string | null;
  unitPrice: number;
  unitCost: number;
  netCost: number;
  grossMargin: number | null;
  lineTotal: number;
  sourceItemCount: number;
}

export interface QuoteDisplayRowOptions {
  organizationMode?: QuoteOrganizationMode;
  detailMode?: QuoteDisplayDetailMode;
}

export type QuoteDocumentDisplayConfigInput =
  | QuoteDisplayConfig
  | QuoteAudienceDisplayConfig
  | null
  | undefined;

export interface ResolvedQuoteDocumentDisplayConfig {
  documentConfig: QuoteDisplayConfigV2 | null;
  audienceConfig: QuoteAudienceDisplayConfig;
}

export const CUSTOMER_SAFE_VISIBLE_COLUMNS: QuoteVisibleColumn[] = [
  'mark',
  'description',
  'product_code',
  'quantity',
  'uom',
  'unit_price',
  'line_total',
];

const BLOCK_LABELS: Record<QuoteDisplayBlockId, string> = {
  project: 'Project Information',
  summary: 'Quote Overview',
  scope: 'Scope Of Work',
  openings: 'Opening Summary',
  lineItems: 'Pricing Lines',
  totals: 'Totals',
  terms: 'Terms',
  notes: 'Notes',
  delivery: 'Delivery Requirements',
  custom: 'Custom Message',
};

const CUSTOMER_BLOCKS: QuoteDisplayBlock[] = [
  block('project', 10, 'summary', true),
  block('summary', 20, 'summary', true),
  block('scope', 30, 'summary', true),
  block('lineItems', 40, 'summary', true),
  block('totals', 50, 'summary', true),
  block('terms', 60, 'summary', true),
  block('notes', 70, 'summary', true),
  block('custom', 80, 'summary', false),
];

const MANUFACTURER_BLOCKS: QuoteDisplayBlock[] = [
  block('project', 10, 'standard', true),
  block('openings', 20, 'detailed', true),
  block('lineItems', 30, 'detailed', true),
  block('totals', 40, 'standard', true),
  block('notes', 50, 'standard', true),
  block('delivery', 60, 'standard', true),
  block('custom', 70, 'standard', false),
];

const DEFAULT_VISIBLE_COLUMNS: QuoteVisibleColumn[] = [
  'mark',
  'description',
  'quantity',
  'unit_price',
  'line_total',
];

function block(
  id: QuoteDisplayBlockId,
  sortOrder: number,
  detailLevel: QuoteDisplayDetailLevel,
  enabled: boolean,
): QuoteDisplayBlock {
  return {
    id,
    title: BLOCK_LABELS[id],
    enabled,
    sortOrder,
    detailLevel,
  };
}

export function getBlockLabel(id: QuoteDisplayBlockId): string {
  return BLOCK_LABELS[id];
}

export function createDefaultAudienceDisplayConfig(
  audience: TemplateAudience,
  templateName: string | null = null,
): QuoteAudienceDisplayConfig {
  if (audience === 'manufacturer') {
    return {
      audience,
      templateName,
      blocks: MANUFACTURER_BLOCKS.map((b) => ({ ...b })),
      lineOverrides: [],
      showProductCodes: true,
      showQuantities: true,
      showUnitPrices: false,
      showLineTotals: true,
      showUnitCosts: true,
      showSpecFields: true,
      groupCustomerLineItems: false,
      summaryText: '',
      scopeText: '',
      termsText: 'Please confirm current lead times, availability, and any exceptions before acceptance.',
      customText: '',
    };
  }

  return {
    audience,
    templateName,
    blocks: CUSTOMER_BLOCKS.map((b) => ({ ...b })),
    lineOverrides: [],
    showProductCodes: false,
    showQuantities: true,
    showUnitPrices: false,
    showLineTotals: true,
    showUnitCosts: false,
    showSpecFields: false,
    groupCustomerLineItems: true,
    summaryText: '',
    scopeText: 'Commercial door, frame, hardware, and related opening scope as priced from the source estimate.',
    termsText: 'Pricing is valid for 90 days unless noted otherwise. Taxes, freight, field labor, and lead times are subject to final confirmation.',
    customText: '',
  };
}

export function createDefaultQuoteDisplayConfig(
  template?: Template | null,
  quoteType?: 'customer' | 'manufacturer' | 'both',
): QuoteDisplayConfig {
  const customerTemplate =
    template?.audience === 'customer' ? parseAudienceDisplayConfig(template.displayConfigJson, 'customer', template.name) : null;
  const manufacturerTemplate =
    template?.audience === 'manufacturer'
      ? parseAudienceDisplayConfig(template.displayConfigJson, 'manufacturer', template.name)
      : null;

  return {
    version: 2,
    customer:
      quoteType === 'manufacturer'
        ? createDefaultAudienceDisplayConfig('customer')
        : customerTemplate ?? createDefaultAudienceDisplayConfig('customer', template?.audience === 'customer' ? template.name : null),
    manufacturer:
      quoteType === 'customer'
        ? createDefaultAudienceDisplayConfig('manufacturer')
        : manufacturerTemplate ??
          createDefaultAudienceDisplayConfig('manufacturer', template?.audience === 'manufacturer' ? template.name : null),
    organizationMode: 'by_product_group',
    detailMode: 'rolled_up',
    customerTemplateKey: template?.audience === 'customer' ? template.id : null,
    visibleColumns: DEFAULT_VISIBLE_COLUMNS,
    validityDays: 90,
    headerText: '',
    footerText: '',
    disclaimerText: '',
  };
}

/** Applies persisted customer/company presentation defaults to a fresh quote config. */
export function applyCompanyQuoteDefaults(
  config: QuoteDisplayConfig,
  settings?: CompanySettings | null,
): QuoteDisplayConfigV2 {
  const normalized = normalizeQuoteDisplayConfig(config);
  if (!settings) return normalized;

  return normalizeQuoteDisplayConfig({
    ...normalized,
    organizationMode: settings.defaultQuoteOrganizationMode ?? normalized.organizationMode,
    detailMode: settings.defaultQuoteDetailLevel ?? normalized.detailMode,
    customerTemplateKey: settings.defaultQuoteTemplateKey ?? normalized.customerTemplateKey,
    validityDays: settings.quoteValidityDays ?? normalized.validityDays,
    headerText: settings.quoteHeaderText ?? normalized.headerText,
    footerText: settings.quoteFooterText ?? normalized.footerText,
    disclaimerText: settings.quoteDisclaimerText ?? normalized.disclaimerText,
  });
}

/** Resolves an internal code to a customer-specific part number when enabled. */
export function resolveCustomerPartNumber(
  internalCode: string | null | undefined,
  enabled: boolean,
  partNumberMap?: Record<string, string> | null,
): string | null {
  const code = internalCode?.trim();
  if (!code) return null;
  if (!enabled) return code;
  const exact = partNumberMap?.[code]?.trim();
  if (exact) return exact;
  const insensitive = Object.entries(partNumberMap ?? {}).find(([key]) => key.trim().toLowerCase() === code.toLowerCase())?.[1]?.trim();
  return insensitive || code;
}

export function parseQuoteDisplayConfigJson(raw?: string | null): QuoteDisplayConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<QuoteDisplayConfig>;
    if ((parsed?.version === 1 || parsed?.version === 2) && parsed.customer && parsed.manufacturer) {
      return normalizeQuoteDisplayConfig(parsed as QuoteDisplayConfig);
    }
  } catch {
    return null;
  }
  return null;
}

export function parseAudienceDisplayConfig(
  raw?: string | null,
  audience: TemplateAudience = 'customer',
  templateName: string | null = null,
): QuoteAudienceDisplayConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<QuoteAudienceDisplayConfig | QuoteDisplayConfig>;
    if ('version' in parsed && (parsed.version === 1 || parsed.version === 2)) {
      const full = parsed as Partial<QuoteDisplayConfig>;
      const config = audience === 'customer' ? full.customer : full.manufacturer;
      return config ? normalizeAudienceDisplayConfig(config, audience, templateName) : null;
    }
    return normalizeAudienceDisplayConfig(parsed as Partial<QuoteAudienceDisplayConfig>, audience, templateName);
  } catch {
    return null;
  }
}

export function serializeQuoteDisplayConfig(config: QuoteDisplayConfig): string {
  return JSON.stringify(normalizeQuoteDisplayConfig(config));
}

export function serializeAudienceDisplayConfig(config: QuoteAudienceDisplayConfig): string {
  return JSON.stringify(normalizeAudienceDisplayConfig(config, config.audience));
}

export function normalizeQuoteDisplayConfig(config: QuoteDisplayConfig): QuoteDisplayConfigV2 {
  const detailMode = 'detailMode' in config ? config.detailMode : 'rolled_up';
  const organizationMode = 'organizationMode' in config ? config.organizationMode : 'by_product_group';
  const visibleColumns = 'visibleColumns' in config && Array.isArray(config.visibleColumns)
    ? config.visibleColumns
    : DEFAULT_VISIBLE_COLUMNS;

  return {
    version: 2,
    customer: normalizeAudienceDisplayConfig(config.customer, 'customer'),
    manufacturer: normalizeAudienceDisplayConfig(config.manufacturer, 'manufacturer'),
    organizationMode: normalizeOrganizationMode(organizationMode),
    detailMode: normalizeDetailMode(detailMode),
    customerTemplateKey: 'customerTemplateKey' in config ? config.customerTemplateKey ?? null : null,
    visibleColumns: normalizeVisibleColumns(visibleColumns),
    validityDays:
      'validityDays' in config && Number.isFinite(config.validityDays)
        ? Math.max(1, Math.round(config.validityDays))
        : 90,
    headerText: 'headerText' in config ? config.headerText ?? '' : '',
    footerText: 'footerText' in config ? config.footerText ?? '' : '',
    disclaimerText: 'disclaimerText' in config ? config.disclaimerText ?? '' : '',
  };
}

export function resolveQuoteDocumentDisplayConfig(
  config: QuoteDocumentDisplayConfigInput,
  audience: TemplateAudience,
): ResolvedQuoteDocumentDisplayConfig {
  if (isFullQuoteDisplayConfig(config)) {
    const documentConfig = normalizeQuoteDisplayConfig(config);
    return {
      documentConfig,
      audienceConfig: audience === 'customer' ? documentConfig.customer : documentConfig.manufacturer,
    };
  }

  return {
    documentConfig: null,
    audienceConfig: normalizeAudienceDisplayConfig(
      config ?? createDefaultAudienceDisplayConfig(audience),
      audience,
    ),
  };
}

export function getEffectiveQuoteDetailMode(
  config: QuoteAudienceDisplayConfig,
  documentConfig?: QuoteDisplayConfigV2 | null,
): QuoteDisplayDetailMode {
  if (documentConfig) return documentConfig.detailMode;

  const lineBlock = getBlock(config, 'lineItems');
  if (lineBlock.detailLevel === 'detailed') return 'per_item_sell';
  if (lineBlock.detailLevel === 'standard') return 'rolled_up';
  return 'summary';
}

export function getEffectiveVisibleColumns(
  config: QuoteAudienceDisplayConfig,
  documentConfig?: QuoteDisplayConfigV2 | null,
): QuoteVisibleColumn[] {
  if (documentConfig) {
    const columns = documentConfig.visibleColumns.filter((column) =>
      config.audience === 'customer'
        ? CUSTOMER_SAFE_VISIBLE_COLUMNS.includes(column)
        : true,
    );
    return columns.length > 0 ? columns : ['description'];
  }

  const columns: QuoteVisibleColumn[] = ['description'];
  if (config.showProductCodes) columns.push('product_code');
  if (config.showQuantities) columns.push('quantity');
  if (config.showUnitPrices) columns.push('unit_price');
  if (config.showLineTotals) columns.push('line_total');
  if (config.audience !== 'customer' && config.showUnitCosts) columns.push('unit_cost');
  return columns;
}

function isFullQuoteDisplayConfig(
  config: QuoteDocumentDisplayConfigInput,
): config is QuoteDisplayConfig {
  return Boolean(
    config &&
      typeof config === 'object' &&
      'customer' in config &&
      'manufacturer' in config,
  );
}

function normalizeOrganizationMode(value: unknown): QuoteOrganizationMode {
  return value === 'by_product_group' ? 'by_product_group' : 'by_opening';
}

function normalizeDetailMode(value: unknown): QuoteDisplayDetailMode {
  if (
    value === 'rolled_up' ||
    value === 'per_item_sell' ||
    value === 'full_internal'
  ) {
    return value;
  }
  return 'summary';
}

function normalizeVisibleColumns(values: QuoteVisibleColumn[]): QuoteVisibleColumn[] {
  const allowed = new Set<QuoteVisibleColumn>([
    'mark',
    'description',
    'product_code',
    'quantity',
    'uom',
    'unit_price',
    'line_total',
    'unit_cost',
    'net_cost',
    'gross_margin',
  ]);
  const normalized = values.filter((value) => allowed.has(value));
  return normalized.length > 0 ? normalized : DEFAULT_VISIBLE_COLUMNS;
}

export function normalizeAudienceDisplayConfig(
  config: Partial<QuoteAudienceDisplayConfig>,
  audience: TemplateAudience,
  templateName: string | null = null,
): QuoteAudienceDisplayConfig {
  const fallback = createDefaultAudienceDisplayConfig(audience, templateName);
  const fallbackBlocks = audience === 'customer' ? CUSTOMER_BLOCKS : MANUFACTURER_BLOCKS;
  const incomingBlocks = Array.isArray(config.blocks) ? config.blocks : [];
  const incomingById = new Map(incomingBlocks.map((b) => [b.id, b]));
  const blocks = fallbackBlocks
    .map((fallbackBlock) => {
      const incoming = incomingById.get(fallbackBlock.id);
      return {
        ...fallbackBlock,
        ...incoming,
        id: fallbackBlock.id,
        title: incoming?.title || fallbackBlock.title,
        enabled: incoming?.enabled ?? fallbackBlock.enabled,
        detailLevel: incoming?.detailLevel ?? fallbackBlock.detailLevel,
        sortOrder: incoming?.sortOrder ?? fallbackBlock.sortOrder,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((b, idx) => ({ ...b, sortOrder: (idx + 1) * 10 }));

  return {
    ...fallback,
    ...config,
    audience,
    templateName: config.templateName ?? templateName ?? fallback.templateName ?? null,
    blocks,
    lineOverrides: Array.isArray(config.lineOverrides) ? config.lineOverrides : [],
    showProductCodes: config.showProductCodes ?? fallback.showProductCodes,
    showQuantities: config.showQuantities ?? fallback.showQuantities,
    showUnitPrices: config.showUnitPrices ?? fallback.showUnitPrices,
    showLineTotals: config.showLineTotals ?? fallback.showLineTotals,
    showUnitCosts: config.showUnitCosts ?? fallback.showUnitCosts,
    showSpecFields: config.showSpecFields ?? fallback.showSpecFields,
    groupCustomerLineItems: config.groupCustomerLineItems ?? fallback.groupCustomerLineItems,
    summaryText: config.summaryText ?? fallback.summaryText,
    scopeText: config.scopeText ?? fallback.scopeText,
    termsText: config.termsText ?? fallback.termsText,
    customText: config.customText ?? fallback.customText,
  };
}

export function getEnabledBlocks(config: QuoteAudienceDisplayConfig): QuoteDisplayBlock[] {
  return config.blocks.filter((b) => b.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getBlock(
  config: QuoteAudienceDisplayConfig,
  blockId: QuoteDisplayBlockId,
): QuoteDisplayBlock {
  return config.blocks.find((b) => b.id === blockId) ?? block(blockId, 999, 'standard', false);
}

export function getLineDisplayKey(item: Pick<QuoteItem, 'displayKey' | 'estimateItemId' | 'id' | 'canonicalCode' | 'itemLabel'>): string {
  return (
    item.displayKey ??
    (item.estimateItemId ? `estimate-item:${item.estimateItemId}` : null) ??
    (item.canonicalCode ? `code:${item.canonicalCode}` : null) ??
    `quote-item:${item.id || item.itemLabel}`
  );
}

export function getLineOverride(
  config: QuoteAudienceDisplayConfig,
  displayKey: string,
) {
  return config.lineOverrides.find((override) => override.displayKey === displayKey);
}

export function getLineDisplayLabel(
  item: Pick<QuoteItem, 'displayKey' | 'estimateItemId' | 'id' | 'canonicalCode' | 'itemLabel'>,
  config: QuoteAudienceDisplayConfig,
): string {
  const override = getLineOverride(config, getLineDisplayKey(item));
  return override?.label?.trim() || item.itemLabel;
}

export function isLineVisible(
  item: Pick<QuoteItem, 'displayKey' | 'estimateItemId' | 'id' | 'canonicalCode' | 'itemLabel'>,
  config: QuoteAudienceDisplayConfig,
): boolean {
  return getLineOverride(config, getLineDisplayKey(item))?.hidden !== true;
}

export function buildCustomerDisplayRows(
  items: QuoteItem[],
  config: QuoteAudienceDisplayConfig,
  options: QuoteDisplayRowOptions = {},
): QuoteDisplayRow[] {
  const visibleItems = items.filter((item) => isLineVisible(item, config));
  const lineBlock = getBlock(config, 'lineItems');
  const detailMode =
    options.detailMode ??
    (lineBlock.detailLevel === 'detailed'
      ? 'per_item_sell'
      : lineBlock.detailLevel === 'standard'
        ? 'rolled_up'
        : 'summary');
  const organizationMode = options.organizationMode ?? 'by_product_group';
  const shouldGroup = options.detailMode
    ? detailMode === 'summary' || detailMode === 'rolled_up'
    : config.groupCustomerLineItems || lineBlock.detailLevel === 'summary';

  if (!shouldGroup) {
    return visibleItems.map((item) => itemToDisplayRow(item, config));
  }

  const grouped = new Map<string, QuoteDisplayRow>();
  for (const item of visibleItems) {
    const group = getCustomerDisplayGroup(item, config, organizationMode);
    const key = group.key;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        id: key,
        label: group.label,
        mark: group.mark,
        productGroup: group.productGroup,
        canonicalCode: null,
        quantity: item.quantity,
        unitOfMeasure: item.unitOfMeasure ?? null,
        unitPrice: item.unitPrice,
        unitCost: item.unitCost,
        netCost: item.unitCost * item.quantity,
        grossMargin: item.lineTotal - item.unitCost * item.quantity,
        lineTotal: item.lineTotal,
        sourceItemCount: 1,
      });
      continue;
    }

    existing.quantity += item.quantity;
    existing.unitCost += item.unitCost;
    existing.unitPrice += item.unitPrice;
    existing.netCost += item.unitCost * item.quantity;
    existing.grossMargin = (existing.grossMargin ?? 0) + item.lineTotal - item.unitCost * item.quantity;
    existing.lineTotal += item.lineTotal;
    existing.sourceItemCount += 1;
    if (!existing.unitOfMeasure && item.unitOfMeasure) existing.unitOfMeasure = item.unitOfMeasure;
  }

  return Array.from(grouped.values()).map((row) => ({
    ...row,
    unitCost: row.sourceItemCount > 0 ? row.unitCost / row.sourceItemCount : row.unitCost,
    unitPrice: row.sourceItemCount > 0 ? row.unitPrice / row.sourceItemCount : row.unitPrice,
    lineTotal: parseFloat(row.lineTotal.toFixed(2)),
  }));
}

export function hasHiddenDisplayLines(items: QuoteItem[], config: QuoteAudienceDisplayConfig): boolean {
  return items.some((item) => !isLineVisible(item, config));
}

function classifyCustomerLine(item: QuoteItem): string {
  if (item.productGroup?.trim()) return item.productGroup.trim();
  const value = `${item.itemLabel} ${item.canonicalCode ?? ''}`.toLowerCase();
  if (/\b(freight|tax|install|labor|field|commission|delivery|shipping)\b/.test(value)) {
    return 'Services, freight, and project charges';
  }
  if (/\b(hinge|hinges|lock|locks|lockset|locksets|deadbolt|deadbolts|closer|closers|exit|panic|strike|strikes|seal|seals|threshold|thresholds|sweep|sweeps|weatherstrip|weatherstripping|pull|pulls|push|plate|plates|stop|stops|silencer|silencers|hardware|key|keys|keying)\b/.test(value)) {
    return 'Hardware package';
  }
  if (/\b(glass|lite|louver|vision|kit|glazing)\b/.test(value)) {
    return 'Lite, glass, and louver package';
  }
  if (/\b(frame|jamb|anchor|mullion|borrowed)\b/.test(value)) {
    return 'Frames and frame preparation';
  }
  if (/\b(door|leaf|panel|slab|core|gauge)\b/.test(value)) {
    return 'Doors and door preparation';
  }
  return 'Quoted opening scope';
}

function itemToDisplayRow(
  item: QuoteItem,
  config: QuoteAudienceDisplayConfig,
): QuoteDisplayRow {
  return {
    id: getLineDisplayKey(item),
    label: getLineDisplayLabel(item, config),
    mark: item.openingName ?? item.openingId ?? null,
    productGroup: item.productGroup ?? classifyCustomerLine(item),
    canonicalCode: item.canonicalCode,
    quantity: item.quantity,
    unitOfMeasure: item.unitOfMeasure ?? null,
    unitPrice: item.unitPrice,
    unitCost: item.unitCost,
    netCost: item.unitCost * item.quantity,
    grossMargin: item.grossMargin ?? item.lineTotal - item.unitCost * item.quantity,
    lineTotal: item.lineTotal,
    sourceItemCount: 1,
  };
}

function getCustomerDisplayGroup(
  item: QuoteItem,
  config: QuoteAudienceDisplayConfig,
  organizationMode: QuoteOrganizationMode,
): { key: string; label: string; mark: string | null; productGroup: string | null } {
  if (organizationMode === 'by_opening' && (item.openingId || item.openingName)) {
    const mark = item.openingName ?? item.openingId ?? 'Opening';
    return {
      key: `opening:${item.openingId ?? mark}`,
      label: mark,
      mark,
      productGroup: null,
    };
  }

  const override = getLineOverride(config, getLineDisplayKey(item))?.section?.trim();
  const productGroup = override || classifyCustomerLine(item);
  return {
    key: `group:${productGroup}`,
    label: productGroup,
    mark: item.openingName ?? item.openingId ?? null,
    productGroup,
  };
}
