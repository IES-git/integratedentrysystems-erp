import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Clock3,
  Search,
  Table2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  listPricingTableLibrary,
  type PricingTableLibraryRow,
} from '@/lib/pricing-api';
import type { PricingTable } from '@/types';
import { PricingEngineDataLibrary } from './PricingEngineDataLibrary';

interface PricingTableLibraryProps {
  onSelectTable: (table: PricingTableLibraryRow) => void;
  onSelectCategory: (category: PricingTable['category']) => void;
  onBack: () => void;
  onOpenDefaults: () => void;
  onOpenIngestion: () => void;
  onOpenQa: () => void;
  onOpenRuleTable: (priceTableId: string) => void;
}

const CATEGORY_LABELS: Record<PricingTable['category'], string> = {
  doors: 'Doors',
  frames: 'Frames',
  hardware: 'Hardware',
  lites_louvers_glass: 'Lites, Louvers & Glass',
  panels: 'Panels',
};

const CATEGORY_ORDER: PricingTable['category'][] = [
  'doors',
  'frames',
  'lites_louvers_glass',
  'hardware',
  'panels',
];

const TABLE_WORKSPACE_CATEGORIES: PricingTable['category'][] = [
  'doors',
  'frames',
  'lites_louvers_glass',
];

function formatKind(kind: PricingTable['kind']): string {
  return kind.replace(/_/g, ' ');
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function primaryManufacturer(table: PricingTableLibraryRow): string {
  return table.vendors[0]?.name || 'Unassigned manufacturer';
}

function searchableText(table: PricingTableLibraryRow): string {
  return [
    table.name,
    table.seriesValue,
    table.description,
    CATEGORY_LABELS[table.category],
    table.kind,
    ...table.vendors.map((vendor) => vendor.name),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function PricingTableLibrary({
  onSelectTable,
  onSelectCategory,
  onBack,
  onOpenDefaults,
  onOpenIngestion,
  onOpenQa,
  onOpenRuleTable,
}: PricingTableLibraryProps) {
  const { toast } = useToast();
  const [tables, setTables] = useState<PricingTableLibraryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PricingTable['category'] | 'all'>('all');
  const [manufacturer, setManufacturer] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTables(await listPricingTableLibrary());
    } catch (err) {
      toast({
        title: 'Failed to load pricing tables',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const manufacturerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const table of tables) {
      if (table.vendors.length === 0) names.add('Unassigned manufacturer');
      for (const vendor of table.vendors) names.add(vendor.name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [tables]);

  const filteredTables = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tables.filter((table) => {
      if (category !== 'all' && table.category !== category) return false;
      if (manufacturer !== 'all') {
        const vendorNames = table.vendors.map((vendor) => vendor.name);
        if (manufacturer === 'Unassigned manufacturer') {
          if (table.vendors.length > 0) return false;
        } else if (!vendorNames.includes(manufacturer)) {
          return false;
        }
      }
      if (query && !searchableText(table).includes(query)) return false;
      return true;
    });
  }, [category, manufacturer, search, tables]);

  const groups = useMemo(() => {
    const grouped = new Map<string, PricingTableLibraryRow[]>();
    for (const table of filteredTables) {
      const key = primaryManufacturer(table);
      grouped.set(key, [...(grouped.get(key) ?? []), table]);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, rows]) => [
        name,
        rows.sort((a, b) => {
          const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
          if (catDiff !== 0) return catDiff;
          return `${a.seriesValue} ${a.name}`.localeCompare(`${b.seriesValue} ${b.name}`);
        }),
      ] as const);
  }, [filteredTables]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pricing Tables</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Browse existing tables by manufacturer, category, and series.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {TABLE_WORKSPACE_CATEGORIES.map((slug) => (
            <Button
              key={slug}
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => onSelectCategory(slug)}
            >
              {CATEGORY_LABELS[slug]}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_220px_240px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tables, series, manufacturers..."
            className="pl-9"
          />
        </div>

        <Select value={category} onValueChange={(value) => setCategory(value as typeof category)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORY_ORDER.map((slug) => (
              <SelectItem key={slug} value={slug}>
                {CATEGORY_LABELS[slug]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={manufacturer} onValueChange={setManufacturer}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All manufacturers</SelectItem>
            {manufacturerOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-5">
          {Array.from({ length: 3 }).map((_, groupIndex) => (
            <div key={groupIndex} className="space-y-3">
              <Skeleton className="h-5 w-48" />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((__, cardIndex) => (
                  <Skeleton key={cardIndex} className="h-44 rounded-lg" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Table2 className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-muted-foreground">No pricing tables found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Adjust the filters, use a category shortcut above, or ingest a price book to create new tables.
          </p>
        </div>
      ) : (
        <div className="space-y-7">
          <p className="text-sm text-muted-foreground">
            Showing {filteredTables.length} of {tables.length} pricing {tables.length === 1 ? 'table' : 'tables'}.
          </p>
          {groups.map(([groupName, rows]) => (
            <section key={groupName} className="space-y-3">
              <div className="flex items-center justify-between gap-3 border-b pb-2">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">{groupName}</h2>
                </div>
                <Badge variant="secondary">
                  {rows.length} {rows.length === 1 ? 'table' : 'tables'}
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((table) => (
                  <button
                    key={table.id}
                    onClick={() => onSelectTable(table)}
                    className={cn(
                      'group flex min-h-44 flex-col gap-4 rounded-lg border bg-card p-4 text-left shadow-sm transition-all',
                      'hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {CATEGORY_LABELS[table.category]}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px] capitalize">
                            {formatKind(table.kind)}
                          </Badge>
                        </div>
                        <h3 className="line-clamp-2 text-base font-semibold">{table.name}</h3>
                      </div>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>

                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center justify-between gap-3">
                        <span>Series</span>
                        <span className="max-w-[60%] truncate text-right font-medium text-foreground">
                          {table.seriesValue || 'General'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Grid</span>
                        <span className="font-medium text-foreground">
                          {table.rowCount} rows / {table.columnCount} columns
                        </span>
                      </div>
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {table.vendors.map((vendor) => vendor.name).join(', ') || 'No manufacturer'}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatRelativeDate(table.lastUpdatedAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <PricingEngineDataLibrary
        matrixTableCount={tables.length}
        search={search}
        onOpenDefaults={onOpenDefaults}
        onOpenIngestion={onOpenIngestion}
        onOpenQa={onOpenQa}
        onOpenRuleTable={onOpenRuleTable}
      />
    </div>
  );
}
