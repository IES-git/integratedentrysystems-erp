import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Layers, Clock, Building2, Tag, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { LitesLouversGlassPricingGroup } from '@/types';
import { getLitesLouversGlassGroupedList } from '@/lib/pricing-api';
import { useToast } from '@/hooks/use-toast';

interface LitesLouversGlassListProps {
  /** Called when user clicks a pricing-table group card (navigate to table editor) */
  onSelectTable: (tableId: string) => void;
  /** Called when user clicks an untagged item card (navigate to item editor / create flow) */
  onSelectItem: (canonicalCode: string) => void;
  onBack: () => void;
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

export function LitesLouversGlassList({ onSelectTable, onSelectItem, onBack }: LitesLouversGlassListProps) {
  const { toast } = useToast();
  const [pricingTables, setPricingTables] = useState<LitesLouversGlassPricingGroup[]>([]);
  const [untaggedItems, setUntaggedItems] = useState<{ canonicalCode: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getLitesLouversGlassGroupedList();
      setPricingTables(result.pricingTables);
      setUntaggedItems(result.untaggedItems);
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to load items',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const isEmpty = pricingTables.length === 0 && untaggedItems.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lites, Louvers & Glass Pricing</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Select a pricing table to manage it, or click an unpriced item to create a new table.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Layers className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="font-medium text-muted-foreground">No items found</p>
          <p className="text-sm text-muted-foreground mt-1">
            Add lites, louvers, or glass items in Item Management first.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* Pricing table groups */}
          {pricingTables.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Pricing Tables ({pricingTables.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {pricingTables.map((group) => (
                  <PricingTableCard
                    key={group.tableId}
                    group={group}
                    onClick={() => onSelectTable(group.tableId)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Untagged items */}
          {untaggedItems.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                No Pricing Table ({untaggedItems.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {untaggedItems.map((item) => (
                  <UntaggedItemCard
                    key={item.canonicalCode}
                    item={item}
                    onClick={() => onSelectItem(item.canonicalCode)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pricing table group card
// ---------------------------------------------------------------------------

function PricingTableCard({
  group,
  onClick,
}: {
  group: LitesLouversGlassPricingGroup;
  onClick: () => void;
}) {
  const hasDimensions = group.rowCount > 0 && group.columnCount > 0;

  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col gap-3 rounded-2xl border bg-card p-5 text-left shadow-sm hover:border-primary hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {/* Top row */}
      <div className="flex items-start justify-between">
        <div className="rounded-xl bg-primary/10 p-2.5">
          <Layers className="h-5 w-5 text-primary" />
        </div>
        <div className="flex items-center gap-1.5">
          {hasDimensions ? (
            <Badge
              variant="secondary"
              className="text-[10px] gap-1 font-medium bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
            >
              {group.rowCount}H × {group.columnCount}W
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Empty grid
            </Badge>
          )}
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </div>
      </div>

      {/* Table name */}
      <div>
        <h3 className="text-base font-semibold">{group.tableName}</h3>
      </div>

      {/* Tagged items */}
      {group.items.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            <Tag className="h-2.5 w-2.5" />
            Items ({group.items.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {group.items.slice(0, 4).map((item) => (
              <span
                key={item.canonicalCode}
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                title={item.canonicalCode}
              >
                {item.label}
              </span>
            ))}
            {group.items.length > 4 && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                +{group.items.length - 4} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto flex flex-col gap-1.5 min-h-[24px]">
        {group.vendors.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {group.vendors.map((v) => (
              <span
                key={v.id}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                <Building2 className="h-2.5 w-2.5" />
                {v.name}
              </span>
            ))}
          </div>
        )}
        {group.lastUpdatedAt && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            Updated {formatRelativeDate(group.lastUpdatedAt)}
          </div>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Untagged item card
// ---------------------------------------------------------------------------

function UntaggedItemCard({
  item,
  onClick,
}: {
  item: { canonicalCode: string; label: string };
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col gap-3 rounded-2xl border border-dashed bg-card/60 p-5 text-left hover:border-primary hover:bg-card hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-start justify-between">
        <div className="rounded-xl bg-muted p-2.5">
          <Plus className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          No pricing
        </Badge>
      </div>

      <div>
        <h3 className="text-base font-semibold">{item.label}</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{item.canonicalCode}</p>
      </div>

      <p className="text-xs text-muted-foreground mt-auto">
        Click to create a pricing table or add to an existing one.
      </p>
    </button>
  );
}
