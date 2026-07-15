/**
 * ReviewStep — final step of the manual estimate wizard.
 *
 * One clean page for reviewing pricing and making adjustments before saving:
 *   - Per-opening AuditableQuote (engine lines) or legacy item rows
 *   - Per-opening quantity stepper and "Edit configuration" jump-back
 *   - Per-line sell price override (stored on estimate_line)
 *   - Estimate-level markup/discount percentage and free-text notes
 *   - Refresh Prices (re-runs the rule engine for spec openings, legacy lookup for others)
 *   - Single authoritative Grand Total card
 */

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  DollarSign,
  Info,
  Pencil,
  Plus,
  Minus,
  StickyNote,
  Percent,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { roundOptionalPriceToNearestTen, roundPriceToNearestTen } from '@/lib/pricing-rounding';
import { supabase } from '@/lib/supabase';
import {
  getEstimateOpenings,
  updateEstimateItem,
  updateEstimateOpening,
} from '@/lib/estimates-api';
import { evaluateOpeningsCompatibility } from '@/lib/compatibility-rules-api';
import { priceEstimate } from '@/lib/cpq/service';
import { listManufacturerCompanies } from '@/lib/pricing-api';
import {
  loadEstimateLinesByOpening,
  updateEstimateLineOverride,
  updateEstimateReviewFields,
} from '@/lib/cpq/estimate-lines-api';
import { buildAuditableQuoteFromEstimateLines } from '@/lib/cpq/auditable-quote';
import { validateQuoteCompleteness, type BuilderStepTarget, type CompletenessReport } from '@/lib/cpq/completeness';
import {
  estimateGrandTotal,
  estimateHasAnyPrice,
  countEstimateMissingPrices,
  openingTotalWithLines,
} from '@/lib/cpq/opening-totals';
import { ExceptionReviewPanel } from './ExceptionReviewPanel';
import { CompareVendorsPanel } from './CompareVendorsPanel';
import { AuditableQuote } from './AuditableQuote';
import { ShieldAlert } from 'lucide-react';
import type {
  EstimateOpeningWithItems,
  EstimateItem,
  CompatibilityViolation,
  Company,
  EstimateLine,
} from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** All line items in an opening (top-level + hardware). */
function allOpeningLineItems(opening: EstimateOpeningWithItems): EstimateItem[] {
  return [...opening.items, ...(opening.hardware ?? [])];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReviewStepProps {
  estimateId: string;
  onBack: () => void;
  onFinish: () => void | Promise<void>;
  finishLoading?: boolean;
  finishLabel?: string;
  /**
   * Called when the user clicks "Edit configuration" for an opening, or a
   * completeness "Fix" button. `target` deep-links the builder to the step that
   * resolves the issue.
   */
  onEditOpening?: (opening: EstimateOpeningWithItems, target?: BuilderStepTarget) => void;
}

// ---------------------------------------------------------------------------
// ItemPricingRow — single legacy line item with inline override
// ---------------------------------------------------------------------------

interface ItemPricingRowProps {
  item: EstimateItem;
  manufacturerName: string | null;
  onPriceChange: (itemId: string, price: number | null, isManual: boolean) => void;
}

function ItemPricingRow({ item, manufacturerName, onPriceChange }: ItemPricingRowProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(
    item.unitPrice !== null && item.unitPrice !== undefined ? String(item.unitPrice) : '',
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setInputValue(item.unitPrice !== null && item.unitPrice !== undefined ? String(item.unitPrice) : '');
    }
  }, [item.unitPrice, editing]);

  const hasPrice = item.unitPrice !== null && item.unitPrice !== undefined;
  const isManual = item.isManualPriceOverride === true;
  const metadata = item.priceLookupMetadata;
  const priceSource = item.priceSource;
  const lineTotal = hasPrice ? item.unitPrice! * item.quantity : null;

  const handleCommit = async () => {
    const parsed = parseFloat(inputValue);
    if (isNaN(parsed) && inputValue.trim() !== '') return;
    const newPrice = inputValue.trim() === '' ? null : roundPriceToNearestTen(parsed);
    setSaving(true);
    try {
      await onPriceChange(item.id, newPrice, newPrice !== null);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm border-b last:border-0 hover:bg-muted/30">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium truncate">{item.itemLabel}</span>
          {item.itemType && (
            <Badge variant="outline" className="text-[10px] py-0 px-1 font-normal capitalize shrink-0">
              {item.itemType.replace('_', ' ')}
            </Badge>
          )}
          {isManual && (
            <Badge variant="secondary" className="text-[10px] py-0 px-1 shrink-0 text-amber-700 bg-amber-50 border-amber-200">
              manual
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
          {manufacturerName && <span>{manufacturerName}</span>}
          {priceSource === 'lookup' && metadata?.computedAt && (
            <span className="flex items-center gap-0.5">
              <Info className="h-2.5 w-2.5" />
              Table snapshot {formatDate(metadata.computedAt)}
            </span>
          )}
          {metadata?.status && metadata.status !== 'matched' && (
            <span className="text-amber-600 flex items-center gap-0.5">
              <AlertTriangle className="h-2.5 w-2.5" />
              {metadata.status.replace('_', ' ')}
            </span>
          )}
        </div>
      </div>
      <span className="text-xs text-muted-foreground tabular-nums w-10 text-center">×{item.quantity}</span>
      <div className="w-28 shrink-0">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onBlur={handleCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommit();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="h-6 text-xs w-full px-1.5"
              placeholder="0.00"
            />
            {saving && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn(
              'h-6 w-full text-right text-xs rounded px-1.5 tabular-nums',
              hasPrice
                ? 'text-foreground hover:bg-muted cursor-text'
                : 'text-muted-foreground/50 hover:bg-muted cursor-text border border-dashed',
            )}
            title="Click to enter or override price"
          >
            {hasPrice ? formatCurrency(item.unitPrice) : 'click to set'}
          </button>
        )}
      </div>
      <div className="w-24 shrink-0 text-right tabular-nums text-xs font-medium">
        {lineTotal !== null ? formatCurrency(lineTotal) : '—'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EngineLineOverrideRow — per-engine-line sell price override
// ---------------------------------------------------------------------------

interface EngineLineOverrideRowProps {
  line: EstimateLine;
  onOverrideChange: (lineId: string, price: number | null) => void;
}

function EngineLineOverrideRow({ line, onOverrideChange }: EngineLineOverrideRowProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(
    line.manualSellPrice !== null && line.manualSellPrice !== undefined
      ? String(line.manualSellPrice)
      : line.sellPrice !== null && line.sellPrice !== undefined
      ? String(line.sellPrice)
      : '',
  );
  const [saving, setSaving] = useState(false);

  const displayPrice = line.manualSellPrice ?? line.sellPrice;
  const isOverride = line.isManualOverride === true || line.manualSellPrice !== null;

  useEffect(() => {
    if (!editing) {
      setInputValue(
        line.manualSellPrice !== null && line.manualSellPrice !== undefined
          ? String(line.manualSellPrice)
          : line.sellPrice !== null && line.sellPrice !== undefined
          ? String(line.sellPrice)
          : '',
      );
    }
  }, [line.manualSellPrice, line.sellPrice, editing]);

  const handleCommit = async () => {
    const trimmed = inputValue.trim();
    const parsed = trimmed === '' ? null : parseFloat(trimmed);
    if (parsed !== null && isNaN(parsed)) { setEditing(false); return; }
    const roundedPrice = roundOptionalPriceToNearestTen(parsed);
    setSaving(true);
    try {
      await onOverrideChange(line.id, roundedPrice);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (line.lineType === 'INCLUDED' || line.includedOrSuppressedBy) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs border-b last:border-0 hover:bg-muted/20">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="truncate text-muted-foreground">{line.description}</span>
          {isOverride && (
            <Badge variant="secondary" className="text-[9px] py-0 px-1 shrink-0 text-amber-700 bg-amber-50 border-amber-200">
              override
            </Badge>
          )}
        </div>
      </div>
      <span className="w-10 text-center text-muted-foreground">
        {line.quantity !== null ? `×${line.quantity}` : ''}
      </span>
      <div className="w-24 shrink-0">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onBlur={handleCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommit();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="h-5 text-xs w-full px-1"
              placeholder="0.00"
            />
            {saving && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn(
              'h-5 w-full text-right text-xs rounded px-1 tabular-nums',
              isOverride
                ? 'text-amber-700 font-medium hover:bg-amber-50'
                : 'text-foreground hover:bg-muted',
            )}
            title="Click to override sell price for this line"
          >
            {formatCurrency(displayPrice)}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OpeningReviewCard — legacy item-based opening
// ---------------------------------------------------------------------------

interface OpeningReviewCardProps {
  opening: EstimateOpeningWithItems;
  engineLines: EstimateLine[];
  manufacturerNameById: Map<string, string>;
  onPriceChange: (itemId: string, price: number | null, isManual: boolean) => void;
  highlightedItemIds: Set<string>;
}

function OpeningReviewCard({ opening, engineLines, manufacturerNameById, onPriceChange, highlightedItemIds }: OpeningReviewCardProps) {
  const [expanded, setExpanded] = useState(true);

  const total = openingTotalWithLines(opening, engineLines);
  const hasAnyPrice = total > 0 || allOpeningLineItems(opening).some((i) => i.unitPrice !== null && i.unitPrice !== undefined);

  return (
    <Card className={cn('overflow-hidden')}>
      <CardHeader
        className="py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform shrink-0', !expanded && '-rotate-90')} />
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-sm">{opening.name}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {opening.items.length} item{opening.items.length !== 1 ? 's' : ''}
              {opening.quantity > 1 && ` × ${opening.quantity} openings`}
            </span>
          </div>
          <div className="text-right shrink-0">
            {hasAnyPrice ? (
              <>
                <p className="text-sm font-bold tabular-nums">{formatCurrency(total)}</p>
                {opening.quantity > 1 && (
                  <p className="text-[10px] text-muted-foreground">
                    {formatCurrency(total / opening.quantity)} × {opening.quantity}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground/50">no prices</p>
            )}
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="p-0">
          <div className="flex items-center gap-2 px-3 py-1 bg-muted/30 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-y">
            <div className="flex-1">Item</div>
            <div className="w-10 text-center">Qty</div>
            <div className="w-28 text-right">Unit Price</div>
            <div className="w-24 text-right">Line Total</div>
          </div>
          {allOpeningLineItems(opening).length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground italic">No items in this opening.</p>
          ) : (
            allOpeningLineItems(opening).map((item) => (
              <div
                key={item.id}
                className={cn('transition-colors', highlightedItemIds.has(item.id) && 'bg-green-50 dark:bg-green-950/20')}
              >
                <ItemPricingRow
                  item={item}
                  manufacturerName={item.manufacturerId ? (manufacturerNameById.get(item.manufacturerId) ?? null) : null}
                  onPriceChange={onPriceChange}
                />
              </div>
            ))
          )}
          {hasAnyPrice && (
            <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-t">
              <span className="text-xs text-muted-foreground">
                Opening subtotal{opening.quantity > 1 ? ` (×${opening.quantity} = total)` : ''}
              </span>
              <span className="text-sm font-semibold tabular-nums">{formatCurrency(total)}</span>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// EngineOpeningCard — spec-built opening with auditable quote + per-line overrides
// ---------------------------------------------------------------------------

interface EngineOpeningCardProps {
  opening: EstimateOpeningWithItems;
  engineLines: EstimateLine[];
  onQuantityChange: (id: string, qty: number) => Promise<void>;
  onEditOpening: ((target?: BuilderStepTarget) => void) | undefined;
  onLineOverride: (lineId: string, price: number | null) => void;
  sellAdjustmentPct: number | null;
}

function EngineOpeningCard({
  opening,
  engineLines,
  onQuantityChange,
  onEditOpening,
  onLineOverride,
  sellAdjustmentPct,
}: EngineOpeningCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [showOverrides, setShowOverrides] = useState(false);
  const [updatingQty, setUpdatingQty] = useState(false);

  const quote = buildAuditableQuoteFromEstimateLines(engineLines);
  const completeness = validateQuoteCompleteness(quote);
  const openingTotal = openingTotalWithLines(opening, engineLines);
  const adjustedTotal = sellAdjustmentPct
    ? roundPriceToNearestTen(openingTotal * (1 + sellAdjustmentPct / 100))
    : openingTotal;

  const handleQtyStep = async (e: React.MouseEvent, delta: number) => {
    e.stopPropagation();
    const next = Math.max(1, opening.quantity + delta);
    if (next === opening.quantity) return;
    setUpdatingQty(true);
    try {
      await onQuantityChange(opening.id, next);
    } finally {
      setUpdatingQty(false);
    }
  };

  const visibleLines = engineLines.filter((l) => !l.includedOrSuppressedBy && l.lineType !== 'INCLUDED');
  const hasOverrides = visibleLines.some((l) => l.isManualOverride || l.manualSellPrice !== null);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex-1 flex items-center gap-2 text-left"
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform shrink-0', !expanded && '-rotate-90')} />
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-sm">{opening.name}</span>
              {quote.exceptionCount > 0 && (
                <Badge variant="destructive" className="ml-2 text-[10px] py-0 px-1">
                  {quote.exceptionCount} exception{quote.exceptionCount !== 1 ? 's' : ''}
                </Badge>
              )}
              {hasOverrides && (
                <Badge variant="secondary" className="ml-1 text-[10px] py-0 px-1 text-amber-700 bg-amber-50 border-amber-200">
                  overrides
                </Badge>
              )}
            </div>
          </button>

          {/* Quantity stepper */}
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6"
              disabled={updatingQty || opening.quantity <= 1}
              onClick={(e) => handleQtyStep(e, -1)}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-6 text-center text-xs font-medium tabular-nums">
              {updatingQty ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : opening.quantity}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6"
              disabled={updatingQty}
              onClick={(e) => handleQtyStep(e, +1)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {/* Edit configuration */}
          {onEditOpening && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs shrink-0 gap-1.5"
              onClick={(e) => { e.stopPropagation(); onEditOpening(); }}
              title="Reopen in the spec builder to change the configuration"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          )}

          {/* Opening total */}
          <div className="shrink-0 text-right min-w-[80px]" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold tabular-nums">{formatCurrency(adjustedTotal)}</p>
            {opening.quantity > 1 && (
              <p className="text-[10px] text-muted-foreground">×{opening.quantity}</p>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-3 pb-4">
          {/* Auditable quote breakdown */}
          <AuditableQuote quote={quote} completeness={completeness} onNavigate={onEditOpening} />

          {/* Per-line sell price overrides toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowOverrides((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-2"
            >
              <Pencil className="h-3 w-3" />
              {showOverrides ? 'Hide line overrides' : `Override individual sell prices${hasOverrides ? ' (active)' : ''}`}
            </button>
            {showOverrides && (
              <div className="mt-2 rounded-md border bg-muted/10 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1 bg-muted/30 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b">
                  <div className="flex-1">Line description</div>
                  <div className="w-10 text-center">Qty</div>
                  <div className="w-24 text-right">Sell price</div>
                </div>
                {visibleLines.map((line) => (
                  <EngineLineOverrideRow
                    key={line.id}
                    line={line}
                    onOverrideChange={onLineOverride}
                  />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ReviewStep
// ---------------------------------------------------------------------------

export function ReviewStep({
  estimateId,
  onBack,
  onFinish,
  finishLoading = false,
  finishLabel = 'Save & Finish',
  onEditOpening,
}: ReviewStepProps) {
  const [openings, setOpenings] = useState<EstimateOpeningWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSummary, setRefreshSummary] = useState<{ updated: number; warnings: { itemLabel: string; status: string; message: string }[] } | null>(null);
  const [highlightedItemIds, setHighlightedItemIds] = useState<Set<string>>(new Set());
  const [manufacturerNameById, setManufacturerNameById] = useState<Map<string, string>>(new Map());
  const [exceptionsReloadKey, setExceptionsReloadKey] = useState(0);
  const [violations, setViolations] = useState<CompatibilityViolation[]>([]);
  const [manufacturers, setManufacturers] = useState<Company[]>([]);
  const [linesByOpening, setLinesByOpening] = useState<Map<string, EstimateLine[]>>(new Map());
  const [acknowledgeExceptions, setAcknowledgeExceptions] = useState(false);

  // Estimate-level adjustment & notes state (loaded from DB, persisted on blur/change)
  const [sellAdjustmentPct, setSellAdjustmentPct] = useState<string>('');
  const [estimateNotes, setEstimateNotes] = useState<string>('');
  const [savingAdjustment, setSavingAdjustment] = useState(false);

  const loadOpenings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getEstimateOpenings(estimateId);
      setOpenings(data);

      try {
        setLinesByOpening(await loadEstimateLinesByOpening(estimateId));
      } catch (lineErr) {
        console.error('Failed to load engine lines:', lineErr);
        setLinesByOpening(new Map());
      }

      const mfrIds = [...new Set(
        data.flatMap((o) => o.items.map((i) => i.manufacturerId).filter(Boolean) as string[]),
      )];
      if (mfrIds.length > 0) {
        const { data: companies } = await supabase
          .from('companies')
          .select('id, name')
          .in('id', mfrIds);
        const nameMap = new Map<string, string>();
        for (const c of companies ?? []) nameMap.set(c.id as string, c.name as string);
        setManufacturerNameById(nameMap);
      }

      try {
        const byOpening = await evaluateOpeningsCompatibility(data);
        setViolations([...byOpening.values()].flat());
      } catch (compatErr) {
        console.error('Compatibility evaluation failed:', compatErr);
        setViolations([]);
      }
    } catch (err) {
      console.error('Failed to load openings for review:', err);
    } finally {
      setLoading(false);
    }
  }, [estimateId]);

  // Load estimate-level adjustment/notes from DB.
  useEffect(() => {
    supabase
      .from('estimates')
      .select('sell_adjustment_pct, estimate_notes')
      .eq('id', estimateId)
      .single()
      .then(({ data }) => {
        if (data) {
          setSellAdjustmentPct(data.sell_adjustment_pct != null ? String(data.sell_adjustment_pct) : '');
          setEstimateNotes(data.estimate_notes ?? '');
        }
      })
      .catch(() => {});
  }, [estimateId]);

  useEffect(() => { loadOpenings(); }, [loadOpenings]);

  useEffect(() => {
    listManufacturerCompanies().then(setManufacturers).catch(() => setManufacturers([]));
  }, []);

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    setRefreshSummary(null);
    try {
      const priced = await priceEstimate(estimateId, { persist: true });
      if (priced.refreshSummary) {
        setRefreshSummary({ updated: priced.refreshSummary.updated, warnings: priced.refreshSummary.warnings });
      }
      const updated = priced.openings.map((o) => o.opening);
      setOpenings(updated);
      setViolations(priced.violations);

      // Reload engine lines after re-pricing.
      try {
        setLinesByOpening(await loadEstimateLinesByOpening(estimateId));
      } catch { /* non-fatal */ }

      const newPricedIds = new Set<string>();
      for (const o of updated) {
        for (const item of allOpeningLineItems(o)) {
          if (item.unitPrice !== null && item.unitPrice !== undefined) newPricedIds.add(item.id);
        }
      }
      setHighlightedItemIds(newPricedIds);
      setTimeout(() => setHighlightedItemIds(new Set()), 3000);
      setExceptionsReloadKey((k) => k + 1);
    } catch (err) {
      console.error('Refresh prices failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const handlePriceChange = async (itemId: string, price: number | null, isManual: boolean) => {
    const roundedPrice = roundOptionalPriceToNearestTen(price);
    await updateEstimateItem(itemId, {
      unitPrice: roundedPrice,
      priceSource: isManual ? 'manual' : null,
      isManualPriceOverride: isManual,
    });
    const applyUpdate = (i: EstimateItem) =>
      i.id === itemId
        ? { ...i, unitPrice: roundedPrice, priceSource: isManual ? ('manual' as const) : null, isManualPriceOverride: isManual }
        : i;
    setOpenings((prev) =>
      prev.map((o) => ({
        ...o,
        items: o.items.map(applyUpdate),
        hardware: (o.hardware ?? []).map(applyUpdate),
      })),
    );
  };

  const handleLineOverride = async (lineId: string, price: number | null) => {
    const roundedPrice = roundOptionalPriceToNearestTen(price);
    await updateEstimateLineOverride(lineId, roundedPrice);
    setLinesByOpening((prev) => {
      const next = new Map(prev);
      for (const [key, lines] of next.entries()) {
        const updated = lines.map((l) =>
          l.id === lineId
            ? { ...l, manualSellPrice: roundedPrice, isManualOverride: roundedPrice !== null }
            : l,
        );
        next.set(key, updated);
      }
      return next;
    });
  };

  const handleQuantityChange = async (id: string, quantity: number) => {
    await updateEstimateOpening(id, { quantity });
    setOpenings((prev) => prev.map((o) => (o.id === id ? { ...o, quantity } : o)));
  };

  const handleAdjustmentBlur = async () => {
    const pct = sellAdjustmentPct.trim() === '' ? null : parseFloat(sellAdjustmentPct);
    if (pct !== null && isNaN(pct)) return;
    setSavingAdjustment(true);
    try {
      await updateEstimateReviewFields(estimateId, { sellAdjustmentPct: pct });
    } finally {
      setSavingAdjustment(false);
    }
  };

  const handleNotesBlur = async () => {
    await updateEstimateReviewFields(estimateId, {
      estimateNotes: estimateNotes.trim() || null,
    });
  };

  const adjustmentPct = sellAdjustmentPct.trim() === '' ? null : parseFloat(sellAdjustmentPct);
  const adjustmentMultiplier = (adjustmentPct !== null && !isNaN(adjustmentPct))
    ? (1 + adjustmentPct / 100)
    : 1;

  // Derived totals
  const baseGrandTotal = estimateGrandTotal(openings, linesByOpening);
  const grandTotal = baseGrandTotal * adjustmentMultiplier;
  const missingPriceCount = countEstimateMissingPrices(openings, linesByOpening);
  const hasAnyPrice = estimateHasAnyPrice(openings, linesByOpening);
  const errorViolations = violations.filter((v) => v.severity === 'error');
  const warningViolations = violations.filter((v) => v.severity === 'warning');

  const hasEngineLines = [...linesByOpening.values()].some((l) => l.length > 0);
  const combinedQuote = hasEngineLines
    ? buildAuditableQuoteFromEstimateLines([...linesByOpening.values()].flat())
    : null;
  const completeness: CompletenessReport | null = combinedQuote
    ? validateQuoteCompleteness(combinedQuote)
    : null;
  const hasCompletenessBlockers = (completeness?.blockingCount ?? 0) > 0;
  const hasBlockingViolations =
    errorViolations.length > 0 || (hasCompletenessBlockers && !acknowledgeExceptions);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">Review & Pricing</h3>
          <p className="text-sm text-muted-foreground">
            Review all items, adjust quantities or prices, and save your estimate.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefreshPrices} disabled={refreshing}>
          {refreshing ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Refreshing…</>
          ) : (
            <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh Prices</>
          )}
        </Button>
      </div>

      {/* Refresh result banner */}
      {refreshSummary && (
        <div className={cn(
          'flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm',
          refreshSummary.updated > 0 ? 'bg-green-50 border-green-200 text-green-800' : 'bg-muted border-muted-foreground/20',
        )}>
          {refreshSummary.updated > 0
            ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-green-600" />
            : <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          }
          <div>
            <p className="font-medium">
              {refreshSummary.updated > 0
                ? `${refreshSummary.updated} opening${refreshSummary.updated !== 1 ? 's' : ''} re-priced`
                : 'No prices updated'}
            </p>
            {refreshSummary.warnings.length > 0 && (
              <ul className="mt-1 text-xs space-y-0.5 text-muted-foreground">
                {refreshSummary.warnings.slice(0, 5).map((w, i) => (
                  <li key={i}>{w.itemLabel}: {w.message}</li>
                ))}
                {refreshSummary.warnings.length > 5 && <li>…and {refreshSummary.warnings.length - 5} more</li>}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Compatibility violations */}
      {violations.length > 0 && (
        <div className="space-y-2">
          {errorViolations.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2 font-medium text-destructive">
                <ShieldAlert className="h-4 w-4" />
                {errorViolations.length} configuration error{errorViolations.length !== 1 ? 's' : ''} — must fix before saving
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {errorViolations.map((v, i) => (
                  <li key={i}><span className="font-medium text-foreground">{v.itemLabel}:</span> {v.message}</li>
                ))}
              </ul>
            </div>
          )}
          {warningViolations.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                {warningViolations.length} configuration warning{warningViolations.length !== 1 ? 's' : ''}
              </div>
              <ul className="mt-1 space-y-0.5 text-xs">
                {warningViolations.map((v, i) => (
                  <li key={i}><span className="font-medium">{v.itemLabel}:</span> {v.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Pricing exceptions */}
      <ExceptionReviewPanel key={exceptionsReloadKey} estimateId={estimateId} onResolved={loadOpenings} />

      {/* Missing prices warning (legacy openings only) */}
      {missingPriceCount > 0 && !hasEngineLines && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>
            <span className="font-medium">{missingPriceCount} item{missingPriceCount !== 1 ? 's' : ''} without a price.</span>{' '}
            Click any price cell to enter a manual price, or use Refresh Prices.
          </p>
        </div>
      )}

      {/* Opening cards */}
      {openings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <DollarSign className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No openings to review.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onBack}>
              Go back and add openings
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {openings.map((opening) => {
            const engineLines = linesByOpening.get(opening.id) ?? [];
            if (engineLines.length > 0) {
              return (
                <EngineOpeningCard
                  key={opening.id}
                  opening={opening}
                  engineLines={engineLines}
                  onQuantityChange={handleQuantityChange}
                  onEditOpening={onEditOpening ? (target) => onEditOpening(opening, target) : undefined}
                  onLineOverride={handleLineOverride}
                  sellAdjustmentPct={adjustmentPct && !isNaN(adjustmentPct) ? adjustmentPct : null}
                />
              );
            }
            return (
              <div key={opening.id} className="space-y-1.5">
                <div className="flex justify-end">
                  <CompareVendorsPanel opening={opening} manufacturers={manufacturers} onApplied={handleRefreshPrices} />
                </div>
                <OpeningReviewCard
                  opening={opening}
                  engineLines={engineLines}
                  manufacturerNameById={manufacturerNameById}
                  onPriceChange={handlePriceChange}
                  highlightedItemIds={highlightedItemIds}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Estimate-level adjustments & notes */}
      {openings.length > 0 && (
        <Card>
          <CardContent className="py-4 px-5 space-y-4">
            <p className="text-sm font-semibold">Estimate Adjustments</p>

            {/* Markup / discount */}
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-[160px]">
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Markup / Discount (%)
                </Label>
                <div className="relative">
                  <Input
                    value={sellAdjustmentPct}
                    onChange={(e) => setSellAdjustmentPct(e.target.value)}
                    onBlur={handleAdjustmentBlur}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdjustmentBlur(); }}
                    placeholder="0"
                    className="pr-8 text-sm"
                  />
                  <Percent className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                </div>
                {savingAdjustment && <p className="text-[10px] text-muted-foreground mt-0.5">Saving…</p>}
              </div>
              {adjustmentPct !== null && !isNaN(adjustmentPct) && adjustmentPct !== 0 && (
                <p className="text-sm text-muted-foreground mb-0.5">
                  {adjustmentPct > 0 ? '+' : ''}{adjustmentPct}% applied to sell total
                </p>
              )}
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <StickyNote className="h-3 w-3" />
                Notes
              </Label>
              <Textarea
                value={estimateNotes}
                onChange={(e) => setEstimateNotes(e.target.value)}
                onBlur={handleNotesBlur}
                placeholder="Add any notes, scope clarifications, or special conditions…"
                rows={3}
                className="text-sm resize-none"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grand total card */}
      {hasAnyPrice && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4 px-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Grand Total</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {openings.length} opening{openings.length !== 1 ? 's' : ''}
                  {adjustmentPct !== null && !isNaN(adjustmentPct) && adjustmentPct !== 0 && (
                    <span> · {adjustmentPct > 0 ? '+' : ''}{adjustmentPct}% adjustment</span>
                  )}
                  {missingPriceCount > 0 && ` · ${missingPriceCount} exception${missingPriceCount !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div className="text-right">
                {adjustmentPct !== null && !isNaN(adjustmentPct) && adjustmentPct !== 0 && (
                  <p className="text-xs text-muted-foreground tabular-nums line-through">
                    {formatCurrency(baseGrandTotal)}
                  </p>
                )}
                <p className="text-2xl font-bold tabular-nums">{formatCurrency(grandTotal)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completeness gate */}
      {hasCompletenessBlockers && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <ShieldAlert className="h-4 w-4" />
            {completeness!.blockingCount} pricing exception{completeness!.blockingCount !== 1 ? 's' : ''} block finalization
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Missing prices, incompatible ratings, contact-factory items, or unresolved external scope must be
            resolved. You may finish anyway and leave them in the manual-quote queue.
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={acknowledgeExceptions}
              onChange={(e) => setAcknowledgeExceptions(e.target.checked)}
            />
            Acknowledge open exceptions and finish anyway
          </label>
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack}>
          Back to Openings
        </Button>
        <Button
          onClick={onFinish}
          size="lg"
          disabled={finishLoading || openings.length === 0 || hasBlockingViolations}
          title={hasBlockingViolations ? 'Resolve configuration errors / pricing exceptions before saving' : undefined}
        >
          {finishLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {finishLabel}
        </Button>
      </div>
    </div>
  );
}
