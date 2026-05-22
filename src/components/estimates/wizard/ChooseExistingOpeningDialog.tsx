import { useState, useEffect, useMemo } from 'react';
import { Search, Copy, Loader2, Layers, DoorOpen, Square, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  listReusableOpenings,
  copyOpeningToEstimate,
  getEstimateOpenings,
} from '@/lib/estimates-api';
import type { EstimateOpeningWithItems } from '@/types';

interface ChooseExistingOpeningDialogProps {
  /** Existing estimate ID, if already created. Provide this OR resolveEstimateId. */
  estimateId?: string;
  /**
   * Async callback that creates (or returns) the estimate ID.
   * Called inside handleCopy so the estimate is only created when the user
   * actually copies an opening, not when they open the browser dialog.
   */
  resolveEstimateId?: () => Promise<string | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopied: (openings: EstimateOpeningWithItems[]) => void;
}

function countByCategory(opening: EstimateOpeningWithItems) {
  const doors = opening.items.filter((i) =>
    i.itemLabel.toLowerCase().includes('door')
  ).length;
  const frames = opening.items.filter((i) =>
    i.itemLabel.toLowerCase().includes('frame')
  ).length;
  const hardware = opening.items.reduce((acc, i) => acc + i.hardware.length, 0);
  return { doors, frames, hardware };
}

export function ChooseExistingOpeningDialog({
  estimateId,
  resolveEstimateId,
  open,
  onOpenChange,
  onCopied,
}: ChooseExistingOpeningDialogProps) {
  const [reusableOpenings, setReusableOpenings] = useState<EstimateOpeningWithItems[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setCopyError(null);
      return;
    }
    setLoading(true);
    listReusableOpenings()
      .then(setReusableOpenings)
      .catch((err) => console.error('Failed to load reusable openings:', err))
      .finally(() => setLoading(false));
  }, [open]);

  const filteredOpenings = useMemo(() => {
    if (!searchQuery.trim()) return reusableOpenings;
    const q = searchQuery.toLowerCase();
    return reusableOpenings.filter((o) => {
      if (o.name.toLowerCase().includes(q)) return true;
      return o.items.some(
        (item) =>
          item.itemLabel.toLowerCase().includes(q) ||
          (item.canonicalCode ?? '').toLowerCase().includes(q)
      );
    });
  }, [reusableOpenings, searchQuery]);

  const handleCopy = async (opening: EstimateOpeningWithItems) => {
    setCopyingId(opening.id);
    setCopyError(null);
    try {
      // Resolve estimate ID — creates the estimate only when the user actually copies.
      const eid = estimateId ?? (resolveEstimateId ? await resolveEstimateId() : null);
      if (!eid) {
        setCopyError('Unable to create estimate. Please try again.');
        return;
      }
      await copyOpeningToEstimate(opening.id, eid);
      const updated = await getEstimateOpenings(eid);
      onCopied(updated);
      onOpenChange(false);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Failed to copy opening.');
    } finally {
      setCopyingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Choose Existing Opening</DialogTitle>
          <DialogDescription>
            Select a past opening to copy its doors, frames, and hardware into this estimate.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or item…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        {copyError && (
          <p className="text-sm text-destructive mt-1">{copyError}</p>
        )}

        <ScrollArea className="h-[360px] mt-1 -mx-1 px-1">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredOpenings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Layers className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                {searchQuery
                  ? 'No openings match your search.'
                  : 'No past openings found.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredOpenings.map((opening) => {
                const { doors, frames, hardware } = countByCategory(opening);
                const isThisCopying = copyingId === opening.id;

                return (
                  <div
                    key={opening.id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors',
                      isThisCopying
                        ? 'opacity-60 pointer-events-none'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="font-medium text-sm truncate">{opening.name}</span>
                        {opening.quantity > 1 && (
                          <Badge variant="secondary" className="text-xs shrink-0">
                            ×{opening.quantity}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {doors > 0 && (
                          <Badge variant="outline" className="text-xs gap-1 px-1.5 py-0.5">
                            <DoorOpen className="h-3 w-3" />
                            {doors} door{doors !== 1 ? 's' : ''}
                          </Badge>
                        )}
                        {frames > 0 && (
                          <Badge variant="outline" className="text-xs gap-1 px-1.5 py-0.5">
                            <Square className="h-3 w-3" />
                            {frames} frame{frames !== 1 ? 's' : ''}
                          </Badge>
                        )}
                        {hardware > 0 && (
                          <Badge variant="outline" className="text-xs gap-1 px-1.5 py-0.5">
                            <Wrench className="h-3 w-3" />
                            {hardware} hardware
                          </Badge>
                        )}
                        {opening.items.length === 0 && (
                          <span className="text-xs text-muted-foreground">No items</span>
                        )}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => handleCopy(opening)}
                      disabled={!!copyingId}
                    >
                      {isThisCopying ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 mr-1.5" />
                          Use
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
