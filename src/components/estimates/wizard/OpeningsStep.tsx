import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Layers,
  Loader2,
  Trash2,
  DoorOpen,
  Square,
  Wrench,
  LayoutPanelLeft,
  AlertCircle,
  Copy,
  ChevronDown,
  Minus,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  getEstimateOpenings,
  deleteEstimateOpening,
  updateEstimateOpening,
} from '@/lib/estimates-api';
import { groupHardwareBySubcategory } from '@/lib/hardware-utils';
import { loadEstimateLinesByOpening } from '@/lib/cpq/estimate-lines-api';
import {
  estimateGrandTotal,
  estimateHasAnyPrice,
  countEstimateMissingPrices,
  openingTotalWithLines,
  engineSellSubtotal,
} from '@/lib/cpq/opening-totals';
import { SpecOpeningBuilder } from './SpecOpeningBuilder';
import { ChooseExistingOpeningDialog } from './ChooseExistingOpeningDialog';
import type { EstimateOpeningWithItems, EstimateLine } from '@/types';

// ---------------------------------------------------------------------------
// Pricing total helpers
// ---------------------------------------------------------------------------

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

interface OpeningsStepProps {
  estimateId: string | null;
  /** Provided for new (unsaved) estimates — lazily creates the DB record the
   *  first time the user actually opens an add-opening dialog. */
  createEstimate?: () => Promise<string>;
  onBack: () => void;
  onFinish: () => void;
  finishLabel?: string;
  finishLoading?: boolean;
  backLabel?: string;
  /**
   * When the user navigates back from the Review step via "Edit configuration",
   * this is set to the opening to edit. OpeningsStep auto-opens the builder for it.
   */
  autoEditOpening?: import('@/types').EstimateOpeningWithItems | null;
  /** Builder step to deep-link to when auto-editing (from a Review "Fix" button). */
  autoEditStep?: import('@/lib/cpq/completeness').BuilderStepTarget | null;
  onAutoEditDone?: () => void;
}

interface OpeningCardProps {
  opening: EstimateOpeningWithItems;
  onDelete: (id: string) => void;
  onEdit: (opening: EstimateOpeningWithItems) => void;
  onQuantityChange: (id: string, quantity: number) => Promise<void>;
  deleting: boolean;
  /** Whether any item in this opening has a price (for showing total vs dash). */
  hasAnyPrice: boolean;
  /** Engine sell subtotal for this opening (null when only legacy prices exist). */
  engineSubtotal: number | null;
}

// Detect item category from the stored item_type first, then fall back to label heuristics.
// opening.items already contains ONLY top-level items; hardware is nested in item.hardware.
function getItemCategory(
  label: string,
  itemType?: string | null
): 'door' | 'frame' | 'panel' | 'item' {
  if (itemType === 'panels') return 'panel';
  if (itemType === 'doors') return 'door';
  if (itemType === 'frames') return 'frame';
  const l = label.toLowerCase();
  if (l.includes('door')) return 'door';
  if (l.includes('frame')) return 'frame';
  if (l.includes('panel')) return 'panel';
  return 'item';
}

function countItems(opening: EstimateOpeningWithItems) {
  const topLevel = opening.items.length;
  // Count opening-level hardware (new style) + legacy nested hardware
  const openingHardware = opening.hardware?.length ?? 0;
  const nestedHardware = opening.items.reduce((acc, i) => acc + i.hardware.length, 0);
  return { topLevel, hardware: openingHardware + nestedHardware };
}

function OpeningCard({ opening, onDelete, onEdit, onQuantityChange, deleting, hasAnyPrice, engineSubtotal }: OpeningCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [updatingQty, setUpdatingQty] = useState(false);

  const { topLevel, hardware } = countItems(opening);
  const unitSubtotal = engineSubtotal ?? opening.items.reduce((s, i) => s + (i.unitPrice ?? 0) * i.quantity, 0) + (opening.hardware ?? []).reduce((s, h) => s + (h.unitPrice ?? 0) * h.quantity, 0);
  const total = unitSubtotal * opening.quantity;

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

  return (
    <Card
      className={cn(
        'transition-opacity overflow-hidden',
        deleting && 'opacity-50 pointer-events-none'
      )}
    >
      {/* Clickable header row */}
      <button
        type="button"
        className="w-full text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <Layers className="h-4 w-4 text-primary" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm truncate">{opening.name}</span>
                <div className="flex flex-wrap gap-1.5 mt-0.5">
                  {topLevel > 0 && (
                    <Badge variant="outline" className="text-xs gap-1 px-2 py-0.5 font-normal">
                      <Layers className="h-3 w-3" />
                      {topLevel} item{topLevel !== 1 ? 's' : ''}
                    </Badge>
                  )}
                  {hardware > 0 && (
                    <Badge variant="outline" className="text-xs gap-1 px-2 py-0.5 font-normal">
                      <Wrench className="h-3 w-3" />
                      {hardware} hardware
                    </Badge>
                  )}
                  {opening.items.length === 0 && hardware === 0 && (
                    <span className="text-xs text-muted-foreground italic">No items yet</span>
                  )}
                </div>
              </div>
            </div>

            {/* Quantity stepper */}
            <div
              className="flex items-center gap-1 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={updatingQty || opening.quantity <= 1}
                onClick={(e) => handleQtyStep(e, -1)}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-8 text-center text-sm font-medium tabular-nums">
                {updatingQty ? (
                  <Loader2 className="h-3 w-3 animate-spin mx-auto" />
                ) : (
                  opening.quantity
                )}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={updatingQty}
                onClick={(e) => handleQtyStep(e, +1)}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onEdit(opening); }}
              disabled={deleting}
              title="Edit opening"
            >
              <Pencil className="h-4 w-4" />
            </Button>

            {/* Per-opening subtotal */}
            <div className="shrink-0 text-right min-w-[80px]" onClick={(e) => e.stopPropagation()}>
              {hasAnyPrice ? (
                <>
                  <p className="text-sm font-semibold tabular-nums">
                    {formatCurrency(total)}
                  </p>
                  {opening.quantity > 1 && (
                    <p className="text-[10px] text-muted-foreground">×{opening.quantity}</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground/40">no price</p>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(opening.id); }}
              disabled={deleting}
            >
              <Trash2 className="h-4 w-4" />
            </Button>

            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200',
                expanded && 'rotate-180'
              )}
            />
          </div>
        </CardContent>
      </button>

      {/* Expanded items detail */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3 bg-muted/20">
          {/* Door / Frame items */}
          {opening.items.length === 0 && (hardware === 0) ? (
            <p className="text-sm text-muted-foreground italic text-center py-2">
              No items in this opening.
            </p>
          ) : (
            <>
              {opening.items.map((item) => {
                const cat = getItemCategory(item.itemLabel, item.itemType);
                const Icon =
                  cat === 'door'
                    ? DoorOpen
                    : cat === 'frame'
                    ? Square
                    : cat === 'panel'
                    ? LayoutPanelLeft
                    : Layers;
                return (
                  <div key={item.id} className="space-y-1">
                    <div className="flex items-center gap-2 rounded-md bg-background border px-3 py-2">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm flex-1 truncate">{item.itemLabel}</span>
                      <Badge variant="secondary" className="font-mono text-[10px] shrink-0">
                        {item.canonicalCode}
                      </Badge>
                    </div>
                    {/* Legacy nested hardware (backward compat) */}
                    {item.hardware.length > 0 && (
                      <div className="ml-5 space-y-2 mt-1">
                        {groupHardwareBySubcategory(item.hardware).map((group) => (
                          <div key={group.key}>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                              {group.label}
                            </p>
                            <div className="space-y-1">
                              {group.items.map((hw) => (
                                <div
                                  key={hw.id}
                                  className="flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5"
                                >
                                  <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <span className="text-xs flex-1 truncate text-muted-foreground">
                                    {hw.itemLabel}
                                  </span>
                                  <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                                    {hw.canonicalCode}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Opening-level hardware grouped by subcategory */}
              {(opening.hardware?.length ?? 0) > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-1.5">
                    <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Hardware
                    </span>
                  </div>
                  {groupHardwareBySubcategory(opening.hardware!).map((group) => (
                    <div key={group.key}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 ml-5">
                        {group.label}
                      </p>
                      <div className="ml-5 space-y-1">
                        {group.items.map((hw) => (
                          <div
                            key={hw.id}
                            className="flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5"
                          >
                            <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-xs flex-1 truncate text-muted-foreground">
                              {hw.itemLabel}
                            </span>
                            <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                              {hw.canonicalCode}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export function OpeningsStep({
  estimateId,
  createEstimate,
  onBack,
  onFinish,
  finishLabel = 'Save & Finish',
  finishLoading = false,
  backLabel = 'Back to Customer',
  autoEditOpening = null,
  autoEditStep = null,
  onAutoEditDone,
}: OpeningsStepProps) {
  const navigate = useNavigate();

  const [openings, setOpenings] = useState<EstimateOpeningWithItems[]>([]);
  const [resolvedId, setResolvedId] = useState<string | null>(estimateId);
  const [engineLinesByOpening, setEngineLinesByOpening] = useState<Map<string, EstimateLine[]>>(new Map());
  const [loadingOpenings, setLoadingOpenings] = useState(!!estimateId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buildDialogOpen, setBuildDialogOpen] = useState(false);
  const [chooseDialogOpen, setChooseDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingOpening, setEditingOpening] = useState<EstimateOpeningWithItems | null>(null);
  const [editingStep, setEditingStep] = useState<import('@/lib/cpq/completeness').BuilderStepTarget | null>(null);
  const [creatingEstimate, setCreatingEstimate] = useState(false);

  // When the parent passes autoEditOpening (from "Edit configuration" or a
  // Review "Fix" button), auto-open the builder for that opening at the target step.
  useEffect(() => {
    if (!autoEditOpening) return;
    setEditingOpening(autoEditOpening);
    setEditingStep(autoEditStep ?? null);
    setBuildDialogOpen(true);
    onAutoEditDone?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEditOpening]);

  // Sync resolvedId if the parent provides a real ID after mount (editing flow).
  useEffect(() => {
    if (estimateId && !resolvedId) setResolvedId(estimateId);
  }, [estimateId, resolvedId]);

  // Load existing openings (and their engine sell lines) when an estimate exists.
  useEffect(() => {
    if (!resolvedId) return;
    setLoadingOpenings(true);
    Promise.all([
      getEstimateOpenings(resolvedId),
      loadEstimateLinesByOpening(resolvedId).catch(() => new Map<string, EstimateLine[]>()),
    ])
      .then(([fresh, lines]) => {
        setOpenings(fresh);
        setEngineLinesByOpening(lines);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load openings.');
      })
      .finally(() => setLoadingOpenings(false));
  }, [resolvedId]);

  // Helper: returns existing resolvedId or calls createEstimate() to get one.
  const getOrCreateId = async (): Promise<string | null> => {
    if (resolvedId) return resolvedId;
    if (!createEstimate) return null;
    setCreatingEstimate(true);
    try {
      const id = await createEstimate();
      setResolvedId(id);
      return id;
    } catch {
      return null;
    } finally {
      setCreatingEstimate(false);
    }
  };

  // "Build Opening" opens the spec builder as a full page (estimate created
  // lazily on save). "Choose existing" still opens its dialog.
  const openDialog = (
    type: 'build' | 'choose',
  ) => {
    if (type === 'build') {
      navigate(
        resolvedId
          ? `/app/estimates/${resolvedId}/openings/build?count=${openings.length}`
          : `/app/estimates/openings/build?count=${openings.length}`
      );
    } else {
      setChooseDialogOpen(true);
    }
  };

  /**
   * Refresh the openings list from the server. The unified spec builder persists
   * components/hardware/lines directly, so we re-read to reflect the saved shape.
   */
  const refreshOpenings = async (eid: string) => {
    try {
      const [fresh, lines] = await Promise.all([
        getEstimateOpenings(eid),
        loadEstimateLinesByOpening(eid).catch(() => new Map<string, EstimateLine[]>()),
      ]);
      setOpenings(fresh);
      setEngineLinesByOpening(lines);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to refresh openings.');
    }
  };

  const handleEditOpening = (opening: EstimateOpeningWithItems) => {
    // Editing always requires a real estimate (opening exists means estimate exists).
    setEditingOpening(opening);
    setEditingStep(null);
    setBuildDialogOpen(true);
  };

  const handleBuildDialogOpenChange = (open: boolean) => {
    setBuildDialogOpen(open);
    if (!open) { setEditingOpening(null); setEditingStep(null); }
  };

  const handleOpeningsCopied = (updatedOpenings: EstimateOpeningWithItems[]) => {
    setOpenings(updatedOpenings);
  };

  const handleDeleteOpening = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteEstimateOpening(id);
      setOpenings((prev) => prev.filter((o) => o.id !== id));
    } catch (err) {
      console.error('Failed to delete opening:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleQuantityChange = async (id: string, quantity: number) => {
    await updateEstimateOpening(id, { quantity });
    setOpenings((prev) =>
      prev.map((o) => (o.id === id ? { ...o, quantity } : o))
    );
  };

  return (
    <>
      {/* SpecOpeningBuilder — unified spec-driven configurator (estimate created lazily) */}
      <SpecOpeningBuilder
        estimateId={resolvedId}
        resolveEstimateId={resolvedId ? undefined : getOrCreateId}
        open={buildDialogOpen}
        onOpenChange={handleBuildDialogOpenChange}
        onSaved={(opening) => {
          const eid = opening.estimateId ?? resolvedId;
          if (eid) {
            if (!resolvedId) setResolvedId(eid);
            void refreshOpenings(eid);
          }
        }}
        openingCount={openings.length}
        editingOpeningId={editingOpening?.id ?? null}
        editingName={editingOpening?.name}
        editingQuantity={editingOpening?.quantity}
        initialStep={editingStep}
      />

      {/* ChooseExistingOpeningDialog — estimate created lazily inside handleCopy */}
      <ChooseExistingOpeningDialog
        estimateId={resolvedId ?? undefined}
        resolveEstimateId={resolvedId ? undefined : getOrCreateId}
        open={chooseDialogOpen}
        onOpenChange={setChooseDialogOpen}
        onCopied={(updatedOpenings) => {
          if (!resolvedId && updatedOpenings[0]?.estimateId) {
            setResolvedId(updatedOpenings[0].estimateId);
          }
          handleOpeningsCopied(updatedOpenings);
        }}
      />

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">Openings</h3>
            <p className="text-sm text-muted-foreground">
              Group doors, frames, and hardware into named openings.
            </p>
          </div>
          <Badge variant="secondary" className="text-sm">
            {openings.length} opening{openings.length !== 1 ? 's' : ''}
          </Badge>
        </div>

        {/* Loading state */}
        {loadingOpenings ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <AlertCircle className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{loadError}</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Opening cards */}
            {openings.length > 0 && (
              <div className="space-y-3">
                {openings.map((opening) => {
                  const engineSubtotal = engineSellSubtotal(engineLinesByOpening.get(opening.id));
                  const hasAnyPrice = engineSubtotal !== null
                    || allOpeningItems(opening).some((i) => i.unitPrice !== null && i.unitPrice !== undefined);
                  return (
                    <OpeningCard
                      key={opening.id}
                      opening={opening}
                      onDelete={handleDeleteOpening}
                      onEdit={handleEditOpening}
                      onQuantityChange={handleQuantityChange}
                      deleting={deletingId === opening.id}
                      hasAnyPrice={hasAnyPrice}
                      engineSubtotal={engineSubtotal}
                    />
                  );
                })}
              </div>
            )}

            {/* Empty state + add actions */}
            <div
              className={cn(
                'rounded-xl border-2 border-dashed p-8',
                openings.length === 0 ? 'block' : 'hidden'
              )}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Layers className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">No openings yet</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Build a new opening or copy one from a past estimate.
                  </p>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={creatingEstimate}
                  onClick={() => openDialog('build')}
                >
                  <Plus className="h-4 w-4" />
                  Build Opening
                </Button>
              </div>
            </div>

            {/* Add / Choose buttons */}
            <div className="flex gap-3">
              <Button
                className="flex-1 gap-2"
                disabled={creatingEstimate}
                onClick={() => openDialog('build')}
              >
                {creatingEstimate ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Creating…</>
                ) : (
                  <><Plus className="h-4 w-4" />Build Opening</>
                )}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={creatingEstimate}
                onClick={() => openDialog('choose')}
              >
                <Copy className="h-4 w-4 mr-2" />
                Choose Existing Opening
              </Button>
            </div>
          </>
        )}

        {/* Grand total summary card */}
        {openings.length > 0 && (() => {
          const grandTotal = estimateGrandTotal(openings, engineLinesByOpening);
          const missingCount = countEstimateMissingPrices(openings, engineLinesByOpening);
          const hasAnyGrandPrice = estimateHasAnyPrice(openings, engineLinesByOpening);
          if (!hasAnyGrandPrice) return null;
          return (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Estimated Total
                    </p>
                    {missingCount > 0 && (
                      <p className="text-[11px] text-amber-600 mt-0.5">
                        {missingCount} exception{missingCount !== 1 ? 's' : ''} — see Review step
                      </p>
                    )}
                  </div>
                  <p className="text-xl font-bold tabular-nums">
                    {formatCurrency(grandTotal)}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Footer navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={onBack}>
            {backLabel}
          </Button>
          <Button onClick={onFinish} size="lg" disabled={finishLoading}>
            {finishLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {finishLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
