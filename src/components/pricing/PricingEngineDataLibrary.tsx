import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Database, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  loadEnginePricingLibrary,
  type CpqRuleTableSummary,
  type EnginePricingLibrary,
  type HardwarePricingRow,
} from '@/lib/pricing-library-api';
import { cn } from '@/lib/utils';

interface PricingEngineDataLibraryProps {
  matrixTableCount: number;
  search: string;
  onOpenDefaults: () => void;
  onOpenIngestion: () => void;
  onOpenQa: () => void;
  onOpenRuleTable: (priceTableId: string) => void;
}

type EngineView = 'base' | 'adders' | 'hardware' | 'defaults' | 'all';

const BASE_ARCHETYPES = new Set([
  'base_matrix',
  'component_matrix',
  'specialty_assembly',
]);

function money(value: number | null): string {
  if (value == null) return '-';
  return `$${Number(value).toFixed(2)}`;
}

function labelize(value: string | null | undefined): string {
  if (!value) return '-';
  return value.replace(/_/g, ' ');
}

function matchesSearch(parts: Array<string | number | null | undefined>, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return parts.filter((part) => part != null).join(' ').toLowerCase().includes(query);
}

function optionKey(value: string | null | undefined): string {
  return value?.trim() || 'Unassigned';
}

function isBasePricingTable(table: CpqRuleTableSummary): boolean {
  return BASE_ARCHETYPES.has(table.archetype);
}

function tableSort(a: CpqRuleTableSummary, b: CpqRuleTableSummary): number {
  const baseRank = Number(!isBasePricingTable(a)) - Number(!isBasePricingTable(b));
  if (baseRank !== 0) return baseRank;
  const entityRank = optionKey(a.entityType).localeCompare(optionKey(b.entityType));
  if (entityRank !== 0) return entityRank;
  const manufacturerRank = optionKey(a.manufacturerName).localeCompare(optionKey(b.manufacturerName));
  if (manufacturerRank !== 0) return manufacturerRank;
  return a.name.localeCompare(b.name);
}

export function PricingEngineDataLibrary({
  matrixTableCount,
  search,
  onOpenDefaults,
  onOpenIngestion,
  onOpenQa,
  onOpenRuleTable,
}: PricingEngineDataLibraryProps) {
  const { toast } = useToast();
  const [library, setLibrary] = useState<EnginePricingLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<EngineView>('base');
  const [engineSearch, setEngineSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [manufacturerFilter, setManufacturerFilter] = useState('all');
  const [priceBookFilter, setPriceBookFilter] = useState('all');
  const [archetypeFilter, setArchetypeFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLibrary(await loadEnginePricingLibrary());
    } catch (err) {
      toast({
        title: 'Failed to load pricing engine data',
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

  const combinedSearch = [search.trim(), engineSearch.trim()].filter(Boolean).join(' ');

  const baseRuleTables = useMemo(
    () => (library?.ruleTables ?? []).filter(isBasePricingTable),
    [library?.ruleTables],
  );
  const adderRuleTables = useMemo(
    () => (library?.ruleTables ?? []).filter((table) => !isBasePricingTable(table)),
    [library?.ruleTables],
  );

  const categoryOptions = useMemo(() => {
    const values = new Set<string>();
    for (const table of library?.ruleTables ?? []) values.add(optionKey(table.entityType));
    for (const row of library?.hardwarePrices ?? []) values.add(optionKey(row.category));
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [library?.hardwarePrices, library?.ruleTables]);

  const manufacturerOptions = useMemo(() => {
    const values = new Set<string>();
    for (const table of library?.ruleTables ?? []) values.add(optionKey(table.manufacturerName));
    for (const row of library?.hardwarePrices ?? []) values.add(optionKey(row.manufacturerName ?? row.supplierName));
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [library?.hardwarePrices, library?.ruleTables]);

  const priceBookOptions = useMemo(() => {
    const values = new Set<string>();
    for (const table of library?.ruleTables ?? []) values.add(optionKey(table.priceBookTitle));
    for (const row of library?.hardwarePrices ?? []) values.add(optionKey(row.priceBookTitle));
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [library?.hardwarePrices, library?.ruleTables]);

  const archetypeOptions = useMemo(() => {
    const values = new Set<string>();
    for (const table of library?.ruleTables ?? []) values.add(table.archetype);
    return [...values].sort((a, b) => labelize(a).localeCompare(labelize(b)));
  }, [library?.ruleTables]);

  const filteredRuleTables = useMemo(() => {
    return (library?.ruleTables ?? []).filter((table) => {
      if (view === 'base' && !isBasePricingTable(table)) return false;
      if (view === 'adders' && isBasePricingTable(table)) return false;
      if (view === 'hardware' || view === 'defaults') return false;
      if (categoryFilter !== 'all' && optionKey(table.entityType) !== categoryFilter) return false;
      if (manufacturerFilter !== 'all' && optionKey(table.manufacturerName) !== manufacturerFilter) return false;
      if (priceBookFilter !== 'all' && optionKey(table.priceBookTitle) !== priceBookFilter) return false;
      if (archetypeFilter !== 'all' && table.archetype !== archetypeFilter) return false;
      return matchesSearch([
        table.name,
        table.priceBookTitle,
        table.manufacturerName,
        table.entityType,
        table.archetype,
        table.section,
        table.ingestionProfileKey,
      ], combinedSearch);
    }).sort(tableSort);
  }, [archetypeFilter, categoryFilter, combinedSearch, library?.ruleTables, manufacturerFilter, priceBookFilter, view]);

  const filteredHardwarePrices = useMemo(() => {
    return (library?.hardwarePrices ?? []).filter((row) => {
      if (view !== 'hardware' && view !== 'all') return false;
      if (categoryFilter !== 'all' && optionKey(row.category) !== categoryFilter) return false;
      if (manufacturerFilter !== 'all' && optionKey(row.manufacturerName ?? row.supplierName) !== manufacturerFilter) return false;
      if (priceBookFilter !== 'all' && optionKey(row.priceBookTitle) !== priceBookFilter) return false;
      return matchesSearch([
        row.priceBookTitle,
        row.supplierName,
        row.category,
        row.manufacturerName,
        row.description,
        row.sku,
        row.finish,
        row.func,
        row.size,
        row.reviewStatus,
      ], combinedSearch);
    });
  }, [categoryFilter, combinedSearch, library?.hardwarePrices, manufacturerFilter, priceBookFilter, view]);

  const approvedRuleCount = library?.ruleTables.reduce((sum, table) => sum + table.approvedRuleCount, 0) ?? 0;
  const totalRuleCount = library?.ruleTables.reduce((sum, table) => sum + table.ruleCount, 0) ?? 0;
  const filtersActive =
    engineSearch.trim() ||
    categoryFilter !== 'all' ||
    manufacturerFilter !== 'all' ||
    priceBookFilter !== 'all' ||
    archetypeFilter !== 'all';
  const showRuleTables = view === 'base' || view === 'adders' || view === 'all';
  const showHardwarePrices = view === 'hardware' || view === 'all';
  const showDefaults = view === 'defaults' || view === 'all';

  function clearFilters() {
    setEngineSearch('');
    setCategoryFilter('all');
    setManufacturerFilter('all');
    setPriceBookFilter('all');
    setArchetypeFilter('all');
  }

  const viewOptions: { id: EngineView; label: string; count: string | number }[] = [
    { id: 'base', label: 'Base pricing', count: baseRuleTables.length },
    { id: 'adders', label: 'Adders & options', count: adderRuleTables.length },
    { id: 'hardware', label: 'Hardware', count: library?.hardwarePriceTotal ?? 0 },
    { id: 'defaults', label: 'Defaults', count: (library?.defaults.sellRules.length ?? 0) + (library?.defaults.serviceScopes.length ?? 0) },
    { id: 'all', label: 'All', count: library?.ruleTables.length ?? 0 },
  ];

  return (
    <section className="space-y-5 border-t pt-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Pricing Engine Data</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            These are the records used by the Estimate Wizard, Opening Builder, and Spec Builder.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onOpenIngestion}>
            Ingestion <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onOpenQa}>
            QA <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onOpenDefaults}>
            Defaults <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Card key={index}>
              <CardContent className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Matrix grids" value={matrixTableCount} />
            <MetricCard label="CPQ rule tables" value={library?.ruleTables.length ?? 0} />
            <MetricCard label="Approved CPQ rules" value={`${approvedRuleCount}/${totalRuleCount}`} />
            <MetricCard label="Hardware prices" value={library?.hardwarePriceTotal ?? 0} />
            <MetricCard label="Defaults" value={(library?.defaults.sellRules.length ?? 0) + (library?.defaults.serviceScopes.length ?? 0)} />
          </div>

          <div className="space-y-4 rounded-lg border bg-card p-4">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
              {viewOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setView(option.id)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left transition-colors',
                    view === option.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'bg-background hover:border-primary/50 hover:bg-primary/5',
                  )}
                >
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.count} records</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_180px_200px_220px_190px_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={engineSearch}
                  onChange={(event) => setEngineSearch(event.target.value)}
                  placeholder="Search table name, series, code, manufacturer..."
                  className="pl-9"
                />
              </div>

              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categoryOptions.map((value) => (
                    <SelectItem key={value} value={value}>{labelize(value)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={manufacturerFilter} onValueChange={setManufacturerFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All manufacturers</SelectItem>
                  {manufacturerOptions.map((value) => (
                    <SelectItem key={value} value={value}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={priceBookFilter} onValueChange={setPriceBookFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All price books</SelectItem>
                  {priceBookOptions.map((value) => (
                    <SelectItem key={value} value={value}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={archetypeFilter} onValueChange={setArchetypeFilter} disabled={view === 'hardware' || view === 'defaults'}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All table types</SelectItem>
                  {archetypeOptions.map((value) => (
                    <SelectItem key={value} value={value}>{labelize(value)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button variant="ghost" onClick={clearFilters} disabled={!filtersActive}>
                Clear
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Start with Base pricing for the actual size/component tables, then switch to Adders & options for surcharges, install kits, prep charges, and other stacked rules.
            </p>
          </div>

          {showRuleTables && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    {view === 'base' ? 'Base Pricing Tables' : view === 'adders' ? 'Adders & Option Tables' : 'CPQ Rule Tables'}
                  </CardTitle>
                  <CardDescription>
                    {view === 'base'
                      ? 'Primary base/component pricing shown first, before any stacked adders or special charges.'
                      : 'Published and reviewed rule tables are matched by spec fields, dimensions, options, and manufacturer pins.'}
                  </CardDescription>
                </div>
                <Badge variant="secondary">{filteredRuleTables.length} shown</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {filteredRuleTables.length === 0 ? (
                <EmptyMessage message="No CPQ rule tables match the current filters." />
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {filteredRuleTables.map((table) => (
                    <button
                      key={table.id}
                      onClick={() => onOpenRuleTable(table.id)}
                      className={cn(
                        'group rounded-lg border p-4 text-left transition-all',
                        'bg-card hover:border-primary hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="mb-1 flex flex-wrap gap-1.5">
                            <Badge variant="outline" className="text-[10px] capitalize">{labelize(table.entityType)}</Badge>
                            <Badge variant="secondary" className="text-[10px] capitalize">{labelize(table.archetype)}</Badge>
                            {table.documentStatus === 'published' && (
                              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700">
                                <ShieldCheck className="mr-1 h-3 w-3" />Published
                              </Badge>
                            )}
                          </div>
                          <h3 className="truncate font-semibold">{table.name}</h3>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {table.manufacturerName ?? 'No manufacturer'} - {table.priceBookTitle}
                          </p>
                        </div>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{table.approvedRuleCount}/{table.ruleCount} approved rules</span>
                        {table.effectiveDate && <span>Effective {table.effectiveDate}</span>}
                        {table.section && <span>{table.section}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {showHardwarePrices && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Hardware Price Rows</CardTitle>
                  <CardDescription>
                    Approved hardware pricing is joined to selected hardware variants in the estimate/spec builders.
                  </CardDescription>
                </div>
                <Badge variant="secondary">
                  {filteredHardwarePrices.length} shown
                  {(library?.hardwarePriceTotal ?? 0) > (library?.hardwarePrices.length ?? 0)
                    ? ` of ${library?.hardwarePriceTotal}`
                    : ''}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {filteredHardwarePrices.length === 0 ? (
                <EmptyMessage message="No hardware prices match the current search." />
              ) : (
                <HardwarePriceTable rows={filteredHardwarePrices} />
              )}
            </CardContent>
          </Card>
          )}

          {showDefaults && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Markup, Services, Freight, and Tax Defaults</CardTitle>
              <CardDescription>
                These defaults are loaded by the pricing engine and can be edited from Pricing Defaults.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Markup rules</h3>
                {library?.defaults.sellRules.length === 0 ? (
                  <EmptyMessage message="No markup rules configured." />
                ) : (
                  <div className="space-y-2">
                    {library?.defaults.sellRules.map((rule) => (
                      <div key={rule.id} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{rule.name}</span>
                          <Badge variant="outline">{rule.costBasis}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Multiplier {rule.markupMultiplier ?? '-'} · GM {rule.gmTargetPct ?? '-'} · priority {rule.priority}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Service scopes</h3>
                {library?.defaults.serviceScopes.length === 0 ? (
                  <EmptyMessage message="No service scopes configured." />
                ) : (
                  <div className="space-y-2">
                    {library?.defaults.serviceScopes.map((scope) => (
                      <div key={scope.id} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{scope.name}</span>
                          <Badge variant="outline" className="capitalize">{labelize(scope.scopeType)}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {labelize(scope.basis)} · rate {money(scope.rate)} · percent {scope.percent ?? '-'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          )}
        </>
      )}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function EmptyMessage({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
      <Search className="h-4 w-4" />
      {message}
    </div>
  );
}

function HardwarePriceTable({ rows }: { rows: HardwarePricingRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Manufacturer</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Item</TableHead>
          <TableHead>Variant</TableHead>
          <TableHead>List</TableHead>
          <TableHead>Discount</TableHead>
          <TableHead>Net</TableHead>
          <TableHead>Review</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="whitespace-nowrap">{row.manufacturerName ?? row.supplierName ?? '-'}</TableCell>
            <TableCell className="whitespace-nowrap capitalize">{labelize(row.category)}</TableCell>
            <TableCell>
              <div className="max-w-xs">
                <p className="truncate font-medium">{row.description ?? row.sku ?? '-'}</p>
                {row.priceBookTitle && <p className="truncate text-xs text-muted-foreground">{row.priceBookTitle}</p>}
              </div>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {[row.sku, row.finish, row.func, row.size].filter(Boolean).join(' / ') || '-'}
            </TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">{money(row.listPrice)}</TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">{row.discountMultiplier ?? '-'}</TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">{money(row.netCost)}</TableCell>
            <TableCell>
              <Badge variant={row.reviewStatus === 'APPROVED' ? 'default' : 'outline'} className="text-[10px]">
                {row.reviewStatus}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
