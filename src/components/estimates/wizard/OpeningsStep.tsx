import { useState, useEffect } from 'react';
import {
  Plus,
  Layers,
  Loader2,
  Trash2,
  DoorOpen,
  Square,
  Wrench,
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
import { BuildOpeningDialog } from './BuildOpeningDialog';
import { ChooseExistingOpeningDialog } from './ChooseExistingOpeningDialog';
import type { EstimateOpeningWithItems } from '@/types';

interface OpeningsStepProps {
  estimateId: string;
  onBack: () => void;
  onFinish: () => void;
  finishLabel?: string;
  finishLoading?: boolean;
  backLabel?: string;
}

interface OpeningCardProps {
  opening: EstimateOpeningWithItems;
  onDelete: (id: string) => void;
  onEdit: (opening: EstimateOpeningWithItems) => void;
  onQuantityChange: (id: string, quantity: number) => Promise<void>;
  deleting: boolean;
}

// Label-based category detection is best-effort — item labels stored in the DB
// come from ItemType.itemLabel (the series name) and may not contain "door"/"frame".
// opening.items already contains ONLY top-level items; hardware is nested in item.hardware.
function getItemCategory(label: string): 'door' | 'frame' | 'item' {
  const l = label.toLowerCase();
  if (l.includes('door')) return 'door';
  if (l.includes('frame')) return 'frame';
  return 'item';
}

function countItems(opening: EstimateOpeningWithItems) {
  const topLevel = opening.items.length;
  // Count opening-level hardware (new style) + legacy nested hardware
  const openingHardware = opening.hardware?.length ?? 0;
  const nestedHardware = opening.items.reduce((acc, i) => acc + i.hardware.length, 0);
  return { topLevel, hardware: openingHardware + nestedHardware };
}

function OpeningCard({ opening, onDelete, onEdit, onQuantityChange, deleting }: OpeningCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [updatingQty, setUpdatingQty] = useState(false);

  const { topLevel, hardware } = countItems(opening);

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
                const cat = getItemCategory(item.itemLabel);
                const Icon =
                  cat === 'door' ? DoorOpen : cat === 'frame' ? Square : Layers;
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
  onBack,
  onFinish,
  finishLabel = 'Save & Finish',
  finishLoading = false,
  backLabel = 'Back to Customer',
}: OpeningsStepProps) {
  const [openings, setOpenings] = useState<EstimateOpeningWithItems[]>([]);
  const [loadingOpenings, setLoadingOpenings] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buildDialogOpen, setBuildDialogOpen] = useState(false);
  const [chooseDialogOpen, setChooseDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingOpening, setEditingOpening] = useState<EstimateOpeningWithItems | null>(null);

  useEffect(() => {
    setLoadingOpenings(true);
    getEstimateOpenings(estimateId)
      .then(setOpenings)
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load openings.');
      })
      .finally(() => setLoadingOpenings(false));
  }, [estimateId]);

  const handleOpeningSaved = (newOpening: EstimateOpeningWithItems) => {
    setOpenings((prev) => [...prev, newOpening]);
  };

  const handleOpeningUpdated = (updated: EstimateOpeningWithItems) => {
    setOpenings((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  };

  const handleEditOpening = (opening: EstimateOpeningWithItems) => {
    setEditingOpening(opening);
    setBuildDialogOpen(true);
  };

  const handleBuildDialogOpenChange = (open: boolean) => {
    setBuildDialogOpen(open);
    if (!open) setEditingOpening(null);
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
      <BuildOpeningDialog
        estimateId={estimateId}
        open={buildDialogOpen}
        onOpenChange={handleBuildDialogOpenChange}
        onSaved={handleOpeningSaved}
        onUpdated={handleOpeningUpdated}
        openingCount={openings.length}
        editingOpening={editingOpening ?? undefined}
      />

      <ChooseExistingOpeningDialog
        estimateId={estimateId}
        open={chooseDialogOpen}
        onOpenChange={setChooseDialogOpen}
        onCopied={handleOpeningsCopied}
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
                {openings.map((opening) => (
                  <OpeningCard
                    key={opening.id}
                    opening={opening}
                    onDelete={handleDeleteOpening}
                    onEdit={handleEditOpening}
                    onQuantityChange={handleQuantityChange}
                    deleting={deletingId === opening.id}
                  />
                ))}
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
              </div>
            </div>

            {/* Add / Choose buttons */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setBuildDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Opening
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setChooseDialogOpen(true)}
              >
                <Copy className="h-4 w-4 mr-2" />
                Choose Existing Opening
              </Button>
            </div>
          </>
        )}

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
