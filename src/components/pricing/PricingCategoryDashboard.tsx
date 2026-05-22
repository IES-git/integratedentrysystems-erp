import { useState, useEffect } from 'react';
import {
  DoorOpen,
  Square,
  Wrench,
  Package,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getItemTypeRegistry } from '@/lib/item-fields-api';
import type { ItemTypeRegistryEntry } from '@/types';

const ITEM_TYPE_ICON_MAP: Record<string, LucideIcon> = {
  DoorOpen,
  Square,
  Wrench,
  Package,
};

/** Slugs that have a real pricing flow wired up. */
const ACTIVE_PRICING_SLUGS = new Set(['doors', 'frames', 'lites_louvers_glass']);

interface PricingCategoryDashboardProps {
  onSelectCategory: (slug: string) => void;
}

export function PricingCategoryDashboard({ onSelectCategory }: PricingCategoryDashboardProps) {
  const { toast } = useToast();
  const [itemTypes, setItemTypes] = useState<ItemTypeRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getItemTypeRegistry()
      .then(setItemTypes)
      .catch((err: unknown) => {
        toast({
          title: 'Failed to load categories',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      })
      .finally(() => setLoading(false));
  }, [toast]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pricing</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage pricing tables for each product category. Select a category to get started.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {loading
          ? ['Doors', 'Frames', 'Hardware'].map((label) => (
              <div key={label} className="flex flex-col gap-4 rounded-2xl border bg-card p-6">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
                <Skeleton className="h-8 w-full mt-auto" />
              </div>
            ))
          : itemTypes.filter((t) => t.parentSlug === null).map((itemType) => {
              const Icon = ITEM_TYPE_ICON_MAP[itemType.icon ?? ''] ?? Package;
              const isActive = ACTIVE_PRICING_SLUGS.has(itemType.slug);

              if (isActive) {
                return (
                  <button
                    key={itemType.slug}
                    onClick={() => onSelectCategory(itemType.slug)}
                    className="group relative flex flex-col gap-4 rounded-2xl border bg-card p-6 text-left shadow-sm hover:border-primary hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <div className="flex items-start justify-between">
                      <div className="rounded-xl bg-primary/10 p-3">
                        <Icon className="h-6 w-6 text-primary" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold">{itemType.name}</h2>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {itemType.description ?? `Manage ${itemType.name.toLowerCase()} pricing tables.`}
                      </p>
                    </div>
                    <div className="mt-auto">
                      <Button size="sm" className="gap-1.5 w-full" tabIndex={-1} asChild>
                        <span>
                          Manage Pricing
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </Button>
                    </div>
                  </button>
                );
              }

              return (
                <div
                  key={itemType.slug}
                  className="relative flex flex-col gap-4 rounded-2xl border bg-card/60 p-6 opacity-60 cursor-not-allowed select-none"
                >
                  <div className="flex items-start justify-between">
                    <div className="rounded-xl bg-muted p-3">
                      <Icon className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                      Coming Soon
                    </Badge>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-muted-foreground">{itemType.name}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {itemType.description ?? `Pricing tables for ${itemType.name.toLowerCase()} items.`}
                    </p>
                  </div>
                  <div className="mt-auto">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1.5 w-full"
                      disabled
                      onClick={() =>
                        toast({
                          title: `${itemType.name} Pricing — Coming Soon`,
                          description: 'This category will be available in a future release.',
                        })
                      }
                    >
                      Coming Soon
                    </Button>
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
}
