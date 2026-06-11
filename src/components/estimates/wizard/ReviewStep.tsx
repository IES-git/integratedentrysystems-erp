/**
 * ReviewStep — final step of the manual estimate wizard.
 *
 * Shows a full per-opening, per-item pricing breakdown, allows inline
 * manual price overrides, and exposes a "Refresh Prices" action that
 * re-runs the pricing lookup engine for all non-overridden items.
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  getEstimateOpenings,
  updateEstimateItem,
} from '@/lib/estimates-api';
import { evaluateOpeningsCompatibility } from '@/lib/compatibility-rules-api';
import { priceEstimate } from '@/lib/cpq/service';
import { listManufacturerCompanies } from '@/lib/pricing-api';
import { supabase } from '@/lib/supabase';
import { ExceptionReviewPanel } from './ExceptionReviewPanel';
import { CompareVendorsPanel } from './CompareVendorsPanel';
import { ShieldAlert } from 'lucide-react';
import type { EstimateOpeningWithItems, EstimateItem, CompatibilityViolation, Company } from '@/types';

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

function openingSubtotal(opening: EstimateOpeningWithItems): number {
  const itemsTotal = opening.items.reduce((s, i) => s + (i.unitPrice ?? 0) * i.quantity, 0);
  const hardwareTotal = (opening.hardware ?? []).reduce((s, h) => s + (h.unitPrice ?? 0) * h.quantity, 0);
  return itemsTotal + hardwareTotal;
}

function openingTotal(opening: EstimateOpeningWithItems): number {
  return openingSubtotal(opening) * opening.quantity;
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
}

// ---------------------------------------------------------------------------
// ItemPricingRow — single line item
// ---------------------------------------------------------------------------

interface ItemPricingRowProps {
  item: EstimateItem;
  manufacturerName: string | null;
  onPriceChange: (itemId: string, price: number | null, isManual: boolean) => void;
}

function ItemPricingRow({ item, manufacturerName, onPriceChange }: ItemPricingRowProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(item.unitPrice !== null && item.unitPrice !== undefined ? String(item.unitPrice) : '');
  const [saving, setSaving] = useState(false);

  // Keep input in sync when item.unitPrice changes (e.g. after Refresh)
  useEffect(() => {
    if (!editing) {
      setInputValue(item.unitPrice !== null && item.unitPrice !== undefined ? String(item.unitPrice) : '');
    }
  }, [item.unitPrice, editing]);

  const hasPrice = item.unitPrice !== null && item.unitPrice !== undefined;
  const isManual = item.isManualPriceOverride === true;
  const metadata = item.priceLookupMetadata;
  const priceSource = item.priceSource;
  const lineTotal = hasPrice ? (item.unitPrice! * item.quantity) : null;

  const handleCommit = async () => {
    const parsed = parseFloat(inputValue);
    if (isNaN(parsed) && inputValue.trim() !== '') return; // invalid number
    const newPrice = inputValue.trim() === '' ? null : parsed;
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
      {/* Item info */}
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

      {/* Qty */}
      <span className="text-xs text-muted-foreground tabular-nums w-10 text-center">
        ×{item.quantity}
      </span>

      {/* Unit price — editable */}
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
                : 'text-muted-foreground/50 hover:bg-muted cursor-text border border-dashed'
            )}
            title="Click to enter or override price"
          >
            {hasPrice ? formatCurrency(item.unitPrice) : 'click to set'}
          </button>
        )}
      </div>

      {/* Line total */}
      <div className="w-24 shrink-0 text-right tabular-nums text-xs font-medium">
        {lineTotal !== null ? formatCurrency(lineTotal) : '—'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OpeningReviewCard
// ---------------------------------------------------------------------------

interface OpeningReviewCardProps {
  opening: EstimateOpeningWithItems;
  manufacturerNameById: Map<string, string>;
  onPriceChange: (itemId: string, price: number | null, isManual: boolean) => void;
  highlightedItemIds: Set<string>;
}

function OpeningReviewCard({ opening, manufacturerNameById, onPriceChange, highlightedItemIds }: OpeningReviewCardProps) {
  const [expanded, setExpanded] = useState(true);

  const subtotal = openingSubtotal(opening);
  const total = openingTotal(opening);
  const hasAnyPrice = allOpeningLineItems(opening).some((i) => i.unitPrice !== null && i.unitPrice !== undefined);

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
                    {formatCurrency(subtotal)} × {opening.quantity}
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
          {/* Column headers */}
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
                className={cn(
                  'transition-colors',
                  highlightedItemIds.has(item.id) && 'bg-green-50 dark:bg-green-950/20'
                )}
              >
                <ItemPricingRow
                  item={item}
                  manufacturerName={item.manufacturerId ? (manufacturerNameById.get(item.manufacturerId) ?? null) : null}
                  onPriceChange={onPriceChange}
                />
              </div>
            ))
          )}

          {/* Opening subtotal row */}
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
// ReviewStep
// ---------------------------------------------------------------------------

export function ReviewStep({ estimateId, onBack, onFinish, finishLoading = false }: ReviewStepProps) {
  const [openings, setOpenings] = useState<EstimateOpeningWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSummary, setRefreshSummary] = useState<{ updated: number; warnings: { itemLabel: string; status: string; message: string }[] } | null>(null);
  const [highlightedItemIds, setHighlightedItemIds] = useState<Set<string>>(new Set());
  const [manufacturerNameById, setManufacturerNameById] = useState<Map<string, string>>(new Map());
  const [exceptionsReloadKey, setExceptionsReloadKey] = useState(0);
  const [violations, setViolations] = useState<CompatibilityViolation[]>([]);
  const [manufacturers, setManufacturers] = useState<Company[]>([]);

  const loadOpenings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getEstimateOpenings(estimateId);
      setOpenings(data);

      // Resolve manufacturer names
      const mfrIds = [...new Set(
        data.flatMap((o) => o.items.map((i) => i.manufacturerId).filter(Boolean) as string[])
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

      // Evaluate compatibility/configuration rules (non-fatal on error).
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

  useEffect(() => {
    loadOpenings();
  }, [loadOpenings]);

  useEffect(() => {
    listManufacturerCompanies().then(setManufacturers).catch(() => setManufacturers([]));
  }, []);

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    setRefreshSummary(null);
    try {
      // Single CPQ orchestrator: persists prices, enqueues exceptions, and
      // re-evaluates compatibility in one pass.
      const priced = await priceEstimate(estimateId, { persist: true });
      if (priced.refreshSummary) {
        setRefreshSummary({ updated: priced.refreshSummary.updated, warnings: priced.refreshSummary.warnings });
      }

      const updated = priced.openings.map((o) => o.opening);
      setOpenings(updated);
      setViolations(priced.violations);

      // Highlight items that now have prices (top-level + hardware)
      const newPricedIds = new Set<string>();
      for (const o of updated) {
        for (const item of allOpeningLineItems(o)) {
          if (item.unitPrice !== null && item.unitPrice !== undefined) {
            newPricedIds.add(item.id);
          }
        }
      }
      setHighlightedItemIds(newPricedIds);
      // Clear highlights after 3 seconds
      setTimeout(() => setHighlightedItemIds(new Set()), 3000);
      // Reload the exception panel — failed lookups were just enqueued.
      setExceptionsReloadKey((k) => k + 1);
    } catch (err) {
      console.error('Refresh prices failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const handlePriceChange = async (itemId: string, price: number | null, isManual: boolean) => {
    await updateEstimateItem(itemId, {
      unitPrice: price,
      priceSource: isManual ? 'manual' : null,
      isManualPriceOverride: isManual,
    });
    // Update local state — apply to both top-level items and hardware
    const applyUpdate = (i: EstimateItem) =>
      i.id === itemId
        ? { ...i, unitPrice: price, priceSource: isManual ? ('manual' as const) : null, isManualPriceOverride: isManual }
        : i;
    setOpenings((prev) =>
      prev.map((o) => ({
        ...o,
        items: o.items.map(applyUpdate),
        hardware: (o.hardware ?? []).map(applyUpdate),
      }))
    );
  };

  // Derived totals — include opening-level hardware in all counts
  const grandTotal = openings.reduce((s, o) => s + openingTotal(o), 0);
  const allItems = openings.flatMap(allOpeningLineItems);
  const missingPriceCount = allItems.filter((i) => i.unitPrice === null || i.unitPrice === undefined).length;
  const hasAnyPrice = allItems.some((i) => i.unitPrice !== null && i.unitPrice !== undefined);
  const errorViolations = violations.filter((v) => v.severity === 'error');
  const warningViolations = violations.filter((v) => v.severity === 'warning');
  const hasBlockingViolations = errorViolations.length > 0;

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
            Review all items, confirm prices, and save your estimate.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefreshPrices}
          disabled={refreshing}
        >
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
          refreshSummary.updated > 0 ? 'bg-green-50 border-green-200 text-green-800' : 'bg-muted border-muted-foreground/20'
        )}>
          {refreshSummary.updated > 0 ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-green-600" />
          ) : (
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          )}
          <div>
            <p className="font-medium">
              {refreshSummary.updated > 0
                ? `${refreshSummary.updated} item price${refreshSummary.updated !== 1 ? 's' : ''} updated`
                : 'No prices updated'}
            </p>
            {refreshSummary.warnings.length > 0 && (
              <ul className="mt-1 text-xs space-y-0.5 text-muted-foreground">
                {refreshSummary.warnings.slice(0, 5).map((w, i) => (
                  <li key={i}>{w.itemLabel}: {w.message}</li>
                ))}
                {refreshSummary.warnings.length > 5 && (
                  <li>…and {refreshSummary.warnings.length - 5} more</li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Compatibility / configuration violations */}
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

      {/* Pricing exceptions (agent-assisted resolution) */}
      <ExceptionReviewPanel
        key={exceptionsReloadKey}
        estimateId={estimateId}
        onResolved={loadOpenings}
      />

      {/* Missing prices warning */}
      {missingPriceCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>
            <span className="font-medium">{missingPriceCount} item{missingPriceCount !== 1 ? 's' : ''} without a price.</span>{' '}
            Click any price cell to enter a manual price, or use Refresh Prices to pull from pricing tables.
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
          {openings.map((opening) => (
            <div key={opening.id} className="space-y-1.5">
              <div className="flex justify-end">
                <CompareVendorsPanel
                  opening={opening}
                  manufacturers={manufacturers}
                  onApplied={handleRefreshPrices}
                />
              </div>
              <OpeningReviewCard
                opening={opening}
                manufacturerNameById={manufacturerNameById}
                onPriceChange={handlePriceChange}
                highlightedItemIds={highlightedItemIds}
              />
            </div>
          ))}
        </div>
      )}

      {/* Grand total card */}
      {hasAnyPrice && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4 px-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Grand Total</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {openings.reduce((s, o) => s + allOpeningLineItems(o).length, 0)} items across {openings.length} opening{openings.length !== 1 ? 's' : ''}
                  {missingPriceCount > 0 && ` (${missingPriceCount} missing price)`}
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums">{formatCurrency(grandTotal)}</p>
            </div>
          </CardContent>
        </Card>
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
          title={hasBlockingViolations ? 'Resolve configuration errors before saving' : undefined}
        >
          {finishLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save & Finish
        </Button>
      </div>
    </div>
  );
}
