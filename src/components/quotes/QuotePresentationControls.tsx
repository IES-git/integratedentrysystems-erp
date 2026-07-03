import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  FileText,
  ListFilter,
  Loader2,
  PanelTop,
  SlidersHorizontal,
  Sparkles,
  Type,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getBlockLabel,
  getLineOverride,
  normalizeAudienceDisplayConfig,
  normalizeQuoteDisplayConfig,
  type QuotePresentationLineOption,
} from '@/lib/quote-display';
import { cn } from '@/lib/utils';
import type {
  QuoteAudienceDisplayConfig,
  QuoteDisplayBlockId,
  QuoteDisplayConfig,
  QuoteDisplayConfigV2,
  QuoteDisplayDetailMode,
  QuoteDisplayDetailLevel,
  QuoteOrganizationMode,
  QuoteVisibleColumn,
  QuoteLineDisplayOverride,
  QuoteType,
  TemplateAudience,
} from '@/types';

export type QuoteCopyField = 'summaryText' | 'scopeText' | 'termsText' | 'customText';

export interface QuoteCopyGenerationRequest {
  audience: TemplateAudience;
  field: QuoteCopyField;
  label: string;
  currentText: string;
  prompt?: string;
}

interface QuotePresentationControlsProps {
  value: QuoteDisplayConfig;
  quoteType: QuoteType;
  lineOptions: QuotePresentationLineOption[];
  onChange: (value: QuoteDisplayConfig) => void;
  onGenerateCopy?: (request: QuoteCopyGenerationRequest) => Promise<string>;
  className?: string;
}

const DETAIL_LABELS: Record<QuoteDisplayDetailLevel, string> = {
  summary: 'Summary',
  standard: 'Standard',
  detailed: 'Detailed',
};

const ORGANIZATION_LABELS: Record<QuoteOrganizationMode, string> = {
  by_opening: 'By opening',
  by_product_group: 'By product group',
};

const DETAIL_MODE_LABELS: Record<QuoteDisplayDetailMode, string> = {
  summary: 'Summary',
  rolled_up: 'Rolled up',
  per_item_sell: 'Per item sell',
  full_internal: 'Full internal',
};

const COLUMN_LABELS: Record<QuoteVisibleColumn, string> = {
  mark: 'Mark',
  description: 'Description',
  product_code: 'Product code',
  quantity: 'Qty',
  uom: 'UOM',
  unit_price: 'Unit price',
  line_total: 'Line total',
  unit_cost: 'Unit cost',
  net_cost: 'Net cost',
  gross_margin: 'Gross margin',
};

function detailModeToBlockDetailLevel(mode: QuoteDisplayDetailMode): QuoteDisplayDetailLevel {
  if (mode === 'summary') return 'summary';
  if (mode === 'rolled_up') return 'standard';
  return 'detailed';
}

function blockDetailLevelToDetailMode(
  level: QuoteDisplayDetailLevel,
  currentMode: QuoteDisplayDetailMode,
): QuoteDisplayDetailMode {
  if (level === 'summary') return 'summary';
  if (level === 'standard') return 'rolled_up';
  return currentMode === 'full_internal' ? 'full_internal' : 'per_item_sell';
}

function getLineItemsDetailLevel(config: QuoteAudienceDisplayConfig): QuoteDisplayDetailLevel | null {
  return config.blocks.find((block) => block.id === 'lineItems')?.detailLevel ?? null;
}

function syncLineItemsBlockDetail(
  config: QuoteAudienceDisplayConfig,
  detailLevel: QuoteDisplayDetailLevel,
): QuoteAudienceDisplayConfig {
  return {
    ...config,
    blocks: config.blocks.map((block) =>
      block.id === 'lineItems' ? { ...block, detailLevel } : block,
    ),
    ...(config.audience === 'customer'
      ? {
          groupCustomerLineItems: detailLevel === 'summary',
          showQuantities: detailLevel !== 'summary',
          showProductCodes: detailLevel === 'detailed',
          showUnitPrices: detailLevel === 'detailed',
        }
      : {
          showProductCodes: detailLevel !== 'summary',
          showUnitCosts: detailLevel !== 'summary',
          showSpecFields: detailLevel === 'detailed',
        }),
  };
}

export function QuotePresentationControls({
  value,
  quoteType,
  lineOptions,
  onChange,
  onGenerateCopy,
  className,
}: QuotePresentationControlsProps) {
  const audiences = useMemo<TemplateAudience[]>(
    () => (quoteType === 'both' ? ['customer', 'manufacturer'] : [quoteType]),
    [quoteType],
  );
  const [activeAudience, setActiveAudience] = useState<TemplateAudience>(audiences[0]);
  const fullConfig = useMemo(() => normalizeQuoteDisplayConfig(value), [value]);

  useEffect(() => {
    if (!audiences.includes(activeAudience)) {
      setActiveAudience(audiences[0]);
    }
  }, [activeAudience, audiences]);

  const config = fullConfig[activeAudience];

  const updateAudience = (nextAudience: QuoteAudienceDisplayConfig) => {
    const previousLineItemsLevel = getLineItemsDetailLevel(config);
    const normalizedAudience = normalizeAudienceDisplayConfig(nextAudience, activeAudience);
    const nextLineItemsLevel = getLineItemsDetailLevel(normalizedAudience);
    const nextConfig: QuoteDisplayConfigV2 = {
      ...fullConfig,
      [activeAudience]: normalizedAudience,
    };
    if (nextLineItemsLevel && nextLineItemsLevel !== previousLineItemsLevel) {
      nextConfig.detailMode = blockDetailLevelToDetailMode(nextLineItemsLevel, fullConfig.detailMode);
    }
    onChange(normalizeQuoteDisplayConfig(nextConfig));
  };

  const updateDocument = (nextConfig: QuoteDisplayConfigV2) => {
    onChange(normalizeQuoteDisplayConfig(nextConfig));
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <PanelTop className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Document Layout</p>
            {config.templateName && (
              <p className="truncate text-xs text-muted-foreground">{config.templateName}</p>
            )}
          </div>
        </div>
        <Badge variant="outline" className="capitalize">
          {activeAudience}
        </Badge>
      </div>

      {audiences.length > 1 && (
        <Tabs value={activeAudience} onValueChange={(v) => setActiveAudience(v as TemplateAudience)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="customer">Customer</TabsTrigger>
            <TabsTrigger value="manufacturer">Manufacturer</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <DocumentSettingsControls config={fullConfig} onChange={updateDocument} />
      <Separator />
      <BlockControls config={config} onChange={updateAudience} />
      <Separator />
      <DetailControls config={config} onChange={updateAudience} />
      <Separator />
      <CopyControls config={config} onChange={updateAudience} onGenerateCopy={onGenerateCopy} />
      <Separator />
      <LineDisplayControls
        config={config}
        lineOptions={lineOptions}
        onChange={updateAudience}
      />
    </div>
  );
}

function DocumentSettingsControls({
  config,
  onChange,
}: {
  config: QuoteDisplayConfigV2;
  onChange: (config: QuoteDisplayConfigV2) => void;
}) {
  const update = (updates: Partial<QuoteDisplayConfigV2>) => onChange({ ...config, ...updates });
  const toggleColumn = (column: QuoteVisibleColumn, checked: boolean) => {
    const next = checked
      ? [...new Set([...config.visibleColumns, column])]
      : config.visibleColumns.filter((value) => value !== column);
    update({ visibleColumns: next.length ? next : ['description'] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quote Settings
        </Label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Organize</Label>
          <Select
            value={config.organizationMode}
            onValueChange={(organizationMode) => update({ organizationMode: organizationMode as QuoteOrganizationMode })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(ORGANIZATION_LABELS) as QuoteOrganizationMode[]).map((mode) => (
                <SelectItem key={mode} value={mode}>{ORGANIZATION_LABELS[mode]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Detail mode</Label>
          <Select
            value={config.detailMode}
            onValueChange={(detailMode) => {
              const nextDetailMode = detailMode as QuoteDisplayDetailMode;
              const detailLevel = detailModeToBlockDetailLevel(nextDetailMode);
              update({
                detailMode: nextDetailMode,
                customer: syncLineItemsBlockDetail(config.customer, detailLevel),
                manufacturer: syncLineItemsBlockDetail(config.manufacturer, detailLevel),
              });
            }}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(DETAIL_MODE_LABELS) as QuoteDisplayDetailMode[]).map((mode) => (
                <SelectItem key={mode} value={mode}>{DETAIL_MODE_LABELS[mode]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Validity days</Label>
          <Input
            type="number"
            min={1}
            value={config.validityDays}
            onChange={(e) => update({ validityDays: Math.max(1, Number(e.target.value) || 1) })}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Customer template key</Label>
          <Input
            value={config.customerTemplateKey ?? ''}
            onChange={(e) => update({ customerTemplateKey: e.target.value.trim() || null })}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Visible columns</Label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(COLUMN_LABELS) as QuoteVisibleColumn[]).map((column) => (
            <label key={column} className="flex items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs">
              <Checkbox
                checked={config.visibleColumns.includes(column)}
                onCheckedChange={(checked) => toggleColumn(column, checked === true)}
              />
              <span>{COLUMN_LABELS[column]}</span>
            </label>
          ))}
        </div>
      </div>

      <FieldTextarea
        label="Header"
        field="customText"
        value={config.headerText}
        onChange={(headerText) => update({ headerText })}
      />
      <FieldTextarea
        label="Footer"
        field="customText"
        value={config.footerText}
        onChange={(footerText) => update({ footerText })}
      />
      <FieldTextarea
        label="Disclaimer"
        field="termsText"
        value={config.disclaimerText}
        onChange={(disclaimerText) => update({ disclaimerText })}
      />
    </div>
  );
}

function BlockControls({
  config,
  onChange,
}: {
  config: QuoteAudienceDisplayConfig;
  onChange: (config: QuoteAudienceDisplayConfig) => void;
}) {
  const blocks = [...config.blocks].sort((a, b) => a.sortOrder - b.sortOrder);

  const updateBlock = (
    blockId: QuoteDisplayBlockId,
    updates: Partial<QuoteAudienceDisplayConfig['blocks'][number]>,
  ) => {
    const nextConfig = {
      ...config,
      blocks: config.blocks.map((block) =>
        block.id === blockId ? { ...block, ...updates } : block,
      ),
    };

    if (
      config.audience === 'customer' &&
      blockId === 'lineItems' &&
      updates.detailLevel
    ) {
      nextConfig.groupCustomerLineItems = updates.detailLevel === 'summary';
      nextConfig.showQuantities = updates.detailLevel !== 'summary';
      nextConfig.showProductCodes = updates.detailLevel === 'detailed';
      nextConfig.showUnitPrices = updates.detailLevel === 'detailed';
    }

    if (
      config.audience === 'manufacturer' &&
      blockId === 'lineItems' &&
      updates.detailLevel
    ) {
      nextConfig.showProductCodes = updates.detailLevel !== 'summary';
      nextConfig.showUnitCosts = updates.detailLevel !== 'summary';
      nextConfig.showSpecFields = updates.detailLevel === 'detailed';
    }

    onChange({
      ...nextConfig,
    });
  };

  const moveBlock = (blockId: QuoteDisplayBlockId, direction: -1 | 1) => {
    const next = [...blocks];
    const index = next.findIndex((block) => block.id === blockId);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= next.length) return;
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    onChange({
      ...config,
      blocks: next.map((block, idx) => ({ ...block, sortOrder: (idx + 1) * 10 })),
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Blocks
        </Label>
      </div>
      <div className="space-y-2">
        {blocks.map((block, index) => (
          <div key={block.id} className="rounded-md border bg-background p-2">
            <div className="flex items-center gap-2">
              <Switch
                checked={block.enabled}
                onCheckedChange={(enabled) => updateBlock(block.id, { enabled })}
                aria-label={`Toggle ${block.title}`}
              />
              <Input
                value={block.title}
                onChange={(e) => updateBlock(block.id, { title: e.target.value })}
                className="h-8 min-w-0 flex-1 text-xs font-medium"
                aria-label={`${block.title} title`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={index === 0}
                onClick={() => moveBlock(block.id, -1)}
                title="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={index === blocks.length - 1}
                onClick={() => moveBlock(block.id, 1)}
                title="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Select
              value={block.detailLevel}
              onValueChange={(detailLevel) =>
                updateBlock(block.id, { detailLevel: detailLevel as QuoteDisplayDetailLevel })
              }
            >
              <SelectTrigger className="mt-2 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DETAIL_LABELS) as QuoteDisplayDetailLevel[]).map((level) => (
                  <SelectItem key={level} value={level}>
                    {DETAIL_LABELS[level]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailControls({
  config,
  onChange,
}: {
  config: QuoteAudienceDisplayConfig;
  onChange: (config: QuoteAudienceDisplayConfig) => void;
}) {
  const isCustomer = config.audience === 'customer';
  const update = (updates: Partial<QuoteAudienceDisplayConfig>) => onChange({ ...config, ...updates });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Details
        </Label>
      </div>
      <ToggleRow
        label="Product codes"
        checked={config.showProductCodes}
        onChange={(showProductCodes) => update({ showProductCodes })}
      />
      <ToggleRow
        label="Quantities"
        checked={config.showQuantities}
        onChange={(showQuantities) => update({ showQuantities })}
      />
      {isCustomer && (
        <ToggleRow
          label="Group customer lines"
          checked={config.groupCustomerLineItems}
          onChange={(groupCustomerLineItems) => update({ groupCustomerLineItems })}
        />
      )}
      <ToggleRow
        label={isCustomer ? 'Unit prices' : 'Sell prices'}
        checked={config.showUnitPrices}
        onChange={(showUnitPrices) => update({ showUnitPrices })}
      />
      <ToggleRow
        label="Line totals"
        checked={config.showLineTotals}
        onChange={(showLineTotals) => update({ showLineTotals })}
      />
      {!isCustomer && (
        <>
          <ToggleRow
            label="Unit costs"
            checked={config.showUnitCosts}
            onChange={(showUnitCosts) => update({ showUnitCosts })}
          />
          <ToggleRow
            label="Spec fields"
            checked={config.showSpecFields}
            onChange={(showSpecFields) => update({ showSpecFields })}
          />
        </>
      )}
    </div>
  );
}

function CopyControls({
  config,
  onChange,
  onGenerateCopy,
}: {
  config: QuoteAudienceDisplayConfig;
  onChange: (config: QuoteAudienceDisplayConfig) => void;
  onGenerateCopy?: (request: QuoteCopyGenerationRequest) => Promise<string>;
}) {
  const [promptByField, setPromptByField] = useState<Partial<Record<QuoteCopyField, string>>>({});
  const [generatingField, setGeneratingField] = useState<QuoteCopyField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = (updates: Partial<QuoteAudienceDisplayConfig>) => onChange({ ...config, ...updates });
  const updatePrompt = (field: QuoteCopyField, prompt: string) => {
    setPromptByField((prev) => ({ ...prev, [field]: prompt }));
  };
  const generate = async (field: QuoteCopyField, label: string, currentText: string) => {
    if (!onGenerateCopy || generatingField) return;
    setError(null);
    setGeneratingField(field);
    try {
      const text = await onGenerateCopy({
        audience: config.audience,
        field,
        label,
        currentText,
        prompt: promptByField[field]?.trim() || undefined,
      });
      update({ [field]: text } as Partial<QuoteAudienceDisplayConfig>);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI copy generation failed.');
    } finally {
      setGeneratingField(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Type className="h-3.5 w-3.5 text-muted-foreground" />
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Copy
        </Label>
      </div>
      <FieldTextarea
        label="Overview"
        field="summaryText"
        value={config.summaryText}
        onChange={(summaryText) => update({ summaryText })}
        prompt={promptByField.summaryText ?? ''}
        onPromptChange={(prompt) => updatePrompt('summaryText', prompt)}
        onGenerate={onGenerateCopy ? generate : undefined}
        isGenerating={generatingField === 'summaryText'}
      />
      <FieldTextarea
        label="Scope"
        field="scopeText"
        value={config.scopeText}
        onChange={(scopeText) => update({ scopeText })}
        prompt={promptByField.scopeText ?? ''}
        onPromptChange={(prompt) => updatePrompt('scopeText', prompt)}
        onGenerate={onGenerateCopy ? generate : undefined}
        isGenerating={generatingField === 'scopeText'}
      />
      <FieldTextarea
        label="Terms"
        field="termsText"
        value={config.termsText}
        onChange={(termsText) => update({ termsText })}
        prompt={promptByField.termsText ?? ''}
        onPromptChange={(prompt) => updatePrompt('termsText', prompt)}
        onGenerate={onGenerateCopy ? generate : undefined}
        isGenerating={generatingField === 'termsText'}
      />
      <FieldTextarea
        label={getBlockLabel('custom')}
        field="customText"
        value={config.customText}
        onChange={(customText) => update({ customText })}
        prompt={promptByField.customText ?? ''}
        onPromptChange={(prompt) => updatePrompt('customText', prompt)}
        onGenerate={onGenerateCopy ? generate : undefined}
        isGenerating={generatingField === 'customText'}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function LineDisplayControls({
  config,
  lineOptions,
  onChange,
}: {
  config: QuoteAudienceDisplayConfig;
  lineOptions: QuotePresentationLineOption[];
  onChange: (config: QuoteAudienceDisplayConfig) => void;
}) {
  const updateLine = (displayKey: string, updates: Partial<QuoteLineDisplayOverride>) => {
    const existing = getLineOverride(config, displayKey);
    const nextOverride: QuoteLineDisplayOverride = {
      displayKey,
      ...existing,
      ...updates,
    };
    onChange({
      ...config,
      lineOverrides: [
        ...config.lineOverrides.filter((override) => override.displayKey !== displayKey),
        nextOverride,
      ],
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ListFilter className="h-3.5 w-3.5 text-muted-foreground" />
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Display Lines
        </Label>
      </div>
      <ScrollArea className="h-56 rounded-md border bg-background">
        <div className="space-y-2 p-2">
          {lineOptions.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No lines yet</p>
          ) : (
            lineOptions.map((line) => {
              const override = getLineOverride(config, line.displayKey);
              const visible = override?.hidden !== true;
              return (
                <div key={line.displayKey} className="space-y-2 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={visible}
                      onCheckedChange={(checked) =>
                        updateLine(line.displayKey, { hidden: checked !== true })
                      }
                      aria-label={`Show ${line.label}`}
                    />
                    {visible ? (
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <Input
                      value={override?.label ?? line.label}
                      onChange={(e) => updateLine(line.displayKey, { label: e.target.value })}
                      disabled={!visible}
                      className="h-8 min-w-0 text-xs"
                    />
                  </div>
                  {config.audience === 'customer' && (
                    <Input
                      value={override?.section ?? ''}
                      onChange={(e) => updateLine(line.displayKey, { section: e.target.value })}
                      placeholder="Display group"
                      disabled={!visible}
                      className="h-8 text-xs"
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-sm">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function FieldTextarea({
  label,
  field,
  value,
  onChange,
  prompt,
  onPromptChange,
  onGenerate,
  isGenerating = false,
}: {
  label: string;
  field: QuoteCopyField;
  value: string;
  onChange: (value: string) => void;
  prompt?: string;
  onPromptChange?: (value: string) => void;
  onGenerate?: (field: QuoteCopyField, label: string, currentText: string) => void;
  isGenerating?: boolean;
}) {
  const rows =
    field === 'summaryText' || field === 'scopeText'
      ? 6
      : field === 'customText'
      ? 4
      : 5;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className="resize-none pr-10 text-xs"
        />
        {onGenerate && (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1.5 top-1.5 h-7 w-7 bg-background/80 text-primary shadow-sm hover:bg-primary/10"
                  onClick={() => onGenerate(field, label, value)}
                  disabled={isGenerating}
                  aria-label={`Generate ${label}`}
                >
                  {isGenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Generate {label}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {onGenerate && onPromptChange && (
        <Input
          value={prompt ?? ''}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="Optional AI direction"
          className="h-8 text-xs"
          aria-label={`${label} AI direction`}
        />
      )}
    </div>
  );
}
