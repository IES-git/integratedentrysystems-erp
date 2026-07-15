import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Database, Loader2, Pencil, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  updateHardwareSpecReview,
  updateHardwarePricingRow,
  type CpqRuleTableSummary,
  type EnginePricingLibrary,
  type HardwarePricingRow,
  type HardwareSpecReviewRow,
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
  const [hardwareEdit, setHardwareEdit] = useState<HardwarePricingRow | null>(null);
  const [hardwareSpecEdit, setHardwareSpecEdit] = useState<HardwareSpecReviewRow | null>(null);
  const [hardwareSaving, setHardwareSaving] = useState(false);

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
    for (const row of library?.hardwareSpecs ?? []) values.add(optionKey(row.category));
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [library?.hardwarePrices, library?.hardwareSpecs, library?.ruleTables]);

  const manufacturerOptions = useMemo(() => {
    const values = new Set<string>();
    for (const table of library?.ruleTables ?? []) values.add(optionKey(table.manufacturerName));
    for (const row of library?.hardwarePrices ?? []) values.add(optionKey(row.manufacturerName ?? row.supplierName));
    for (const row of library?.hardwareSpecs ?? []) row.manufacturerNames.forEach((name) => values.add(optionKey(name)));
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [library?.hardwarePrices, library?.hardwareSpecs, library?.ruleTables]);

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

  const filteredHardwareSpecs = useMemo(() => {
    return (library?.hardwareSpecs ?? []).filter((row) => {
      if (view !== 'hardware' && view !== 'all') return false;
      if (categoryFilter !== 'all' && optionKey(row.category) !== categoryFilter) return false;
      if (manufacturerFilter !== 'all' && !row.manufacturerNames.some((name) => optionKey(name) === manufacturerFilter)) return false;
      return matchesSearch([
        row.externalSpecId, row.category, row.description, row.func, row.finish,
        row.size, row.rating, row.approvalState, row.sourceFile,
        ...row.manufacturerNames, ...row.models, ...row.skus,
      ], combinedSearch);
    });
  }, [categoryFilter, combinedSearch, library?.hardwareSpecs, manufacturerFilter, view]);

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

  async function saveHardwarePrice(input: Parameters<typeof updateHardwarePricingRow>[1]) {
    if (!hardwareEdit) return;
    setHardwareSaving(true);
    try {
      await updateHardwarePricingRow(hardwareEdit.id, input);
      toast({ title: 'Hardware price updated', description: `${hardwareEdit.sku ?? hardwareEdit.description ?? 'Price row'} was saved.` });
      setHardwareEdit(null);
      await load();
    } catch (error) {
      toast({
        title: 'Hardware price was not saved',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setHardwareSaving(false);
    }
  }

  async function saveHardwareSpec(input: Parameters<typeof updateHardwareSpecReview>[1]) {
    if (!hardwareSpecEdit) return;
    setHardwareSaving(true);
    try {
      await updateHardwareSpecReview(hardwareSpecEdit, input);
      toast({ title: 'Hardware specification updated', description: `${hardwareSpecEdit.externalSpecId} was saved.` });
      setHardwareSpecEdit(null);
      await load();
    } catch (error) {
      toast({
        title: 'Hardware specification was not saved',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setHardwareSaving(false);
    }
  }

  const viewOptions: { id: EngineView; label: string; count: string | number }[] = [
    { id: 'base', label: 'Base pricing', count: baseRuleTables.length },
    { id: 'adders', label: 'Adders & options', count: adderRuleTables.length },
    { id: 'hardware', label: 'Hardware', count: (library?.hardwareSpecs.length ?? 0) + (library?.hardwarePriceTotal ?? 0) },
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
                  <CardTitle className="text-base">Hardware Specifications & Review Queue</CardTitle>
                  <CardDescription>
                    Vendor-neutral requirements, including hardware staged directly from estimates. Inactive and review-staged records remain visible here.
                  </CardDescription>
                </div>
                <Badge variant="secondary">{filteredHardwareSpecs.length} shown</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {filteredHardwareSpecs.length === 0
                ? <EmptyMessage message="No hardware specifications match the current filters." />
                : <HardwareSpecTable rows={filteredHardwareSpecs} onEdit={setHardwareSpecEdit} />}
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
                <HardwarePriceTable rows={filteredHardwarePrices} onEdit={setHardwareEdit} />
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
      <HardwarePriceEditor
        row={hardwareEdit}
        saving={hardwareSaving}
        onClose={() => setHardwareEdit(null)}
        onSave={saveHardwarePrice}
      />
      <HardwareSpecEditor
        row={hardwareSpecEdit}
        saving={hardwareSaving}
        onClose={() => setHardwareSpecEdit(null)}
        onSave={saveHardwareSpec}
      />
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

function HardwareSpecTable({ rows, onEdit }: { rows: HardwareSpecReviewRow[]; onEdit: (row: HardwareSpecReviewRow) => void }) {
  return (
    <Table>
      <TableHeader><TableRow>
        <TableHead>Status</TableHead><TableHead>Category</TableHead><TableHead>Requirement</TableHead>
        <TableHead>Known Offer</TableHead><TableHead>Source</TableHead><TableHead className="w-12"><span className="sr-only">Edit</span></TableHead>
      </TableRow></TableHeader>
      <TableBody>{rows.map((row) => (
        <TableRow key={row.id}>
          <TableCell><Badge variant={row.approvalState === 'approved' ? 'default' : 'outline'} className="text-[10px]">{labelize(row.approvalState)}</Badge></TableCell>
          <TableCell className="capitalize">{labelize(row.category)}</TableCell>
          <TableCell><div className="max-w-md"><p className="font-medium">{row.description || row.externalSpecId}</p><p className="text-xs text-muted-foreground">{[row.func, row.finish, row.size, row.rating].filter(Boolean).join(' · ') || row.externalSpecId}</p></div></TableCell>
          <TableCell className="text-xs text-muted-foreground">{[...row.manufacturerNames, ...row.models, ...row.skus].join(' · ') || 'Vendor offer not supplied'}</TableCell>
          <TableCell className="text-xs"><div>{row.sourceFile || '-'}</div><div className="text-muted-foreground">{row.externalSpecId}</div></TableCell>
          <TableCell><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(row)} aria-label={`Review ${row.externalSpecId}`}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
        </TableRow>
      ))}</TableBody>
    </Table>
  );
}

function HardwareSpecEditor({
  row, saving, onClose, onSave,
}: {
  row: HardwareSpecReviewRow | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof updateHardwareSpecReview>[1]) => Promise<void>;
}) {
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [func, setFunc] = useState('');
  const [finish, setFinish] = useState('');
  const [size, setSize] = useState('');
  const [rating, setRating] = useState('');
  const [approvalState, setApprovalState] = useState<HardwareSpecReviewRow['approvalState']>('needs_review');
  useEffect(() => {
    if (!row) return;
    setCategory(row.category);
    setDescription(row.description ?? '');
    setFunc(row.func ?? '');
    setFinish(row.finish ?? '');
    setSize(row.size ?? '');
    setRating(row.rating ?? '');
    setApprovalState(row.approvalState);
  }, [row]);
  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Review hardware specification</DialogTitle><DialogDescription>{row?.externalSpecId} · Changes also update linked staged products and offers.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1.5"><Label>Category</Label><Input value={category} onChange={(event) => setCategory(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Review state</Label><Select value={approvalState} onValueChange={(value) => setApprovalState(value as typeof approvalState)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="needs_review">Needs review</SelectItem><SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="draft">Draft</SelectItem>
          </SelectContent></Select></div>
          <div className="col-span-2 space-y-1.5"><Label>Reviewed requirement description</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Function</Label><Input value={func} onChange={(event) => setFunc(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Finish</Label><Input value={finish} onChange={(event) => setFinish(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Size</Label><Input value={size} onChange={(event) => setSize(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Rating</Label><Input value={rating} onChange={(event) => setRating(event.target.value)} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Approving makes linked offers reusable in estimating. An offer without approved pricing remains a manual-quote item until a hardware price row is added and approved.</p>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button disabled={saving} onClick={() => void onSave({
          category, description: description.trim() || null, func: func.trim() || null, finish: finish.trim() || null,
          size: size.trim() || null, rating: rating.trim() || null, approvalState,
        })}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save review</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HardwarePriceTable({ rows, onEdit }: { rows: HardwarePricingRow[]; onEdit: (row: HardwarePricingRow) => void }) {
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
          <TableHead className="w-12"><span className="sr-only">Edit</span></TableHead>
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
            <TableCell className="whitespace-nowrap tabular-nums">
              {row.discountChain ?? row.discountMultiplier ?? '-'}
            </TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">{money(row.netCost)}</TableCell>
            <TableCell>
              <Badge variant={row.reviewStatus === 'APPROVED' ? 'default' : 'outline'} className="text-[10px]">
                {row.reviewStatus}
              </Badge>
            </TableCell>
            <TableCell>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(row)} aria-label={`Edit ${row.sku ?? row.description ?? 'hardware price'}`}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function nullableNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function HardwarePriceEditor({
  row,
  saving,
  onClose,
  onSave,
}: {
  row: HardwarePricingRow | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof updateHardwarePricingRow>[1]) => Promise<void>;
}) {
  const [listPrice, setListPrice] = useState('');
  const [discountMultiplier, setDiscountMultiplier] = useState('');
  const [discountChain, setDiscountChain] = useState('');
  const [netCost, setNetCost] = useState('');
  const [uom, setUom] = useState('EA');
  const [reviewStatus, setReviewStatus] = useState<'APPROVED' | 'NEEDS_REVIEW' | 'REJECTED'>('NEEDS_REVIEW');

  useEffect(() => {
    if (!row) return;
    setListPrice(row.listPrice == null ? '' : String(row.listPrice));
    setDiscountMultiplier(row.discountMultiplier == null ? '' : String(row.discountMultiplier));
    setDiscountChain(row.discountChain ?? '');
    setNetCost(row.netCost == null ? '' : String(row.netCost));
    setUom(row.uom || 'EA');
    setReviewStatus(row.reviewStatus === 'APPROVED' || row.reviewStatus === 'REJECTED' ? row.reviewStatus : 'NEEDS_REVIEW');
  }, [row]);

  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit hardware price</DialogTitle>
          <DialogDescription>
            {row ? [row.manufacturerName ?? row.supplierName, row.sku, row.description].filter(Boolean).join(' · ') : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5"><Label>List price</Label><Input inputMode="decimal" value={listPrice} onChange={(event) => setListPrice(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Net cost</Label><Input inputMode="decimal" value={netCost} onChange={(event) => setNetCost(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Discount multiplier</Label><Input inputMode="decimal" placeholder="e.g. 0.40" value={discountMultiplier} onChange={(event) => setDiscountMultiplier(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Discount chain</Label><Input placeholder="e.g. 50/20" value={discountChain} onChange={(event) => setDiscountChain(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Unit of measure</Label><Input value={uom} onChange={(event) => setUom(event.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Review status</Label>
            <Select value={reviewStatus} onValueChange={(value) => setReviewStatus(value as typeof reviewStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NEEDS_REVIEW">Needs review</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Stored net cost wins. Otherwise pricing uses the multiplier, then the discount chain, then list price. Only approved rows can price a quote.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={() => void onSave({
              listPrice: nullableNumber(listPrice),
              discountMultiplier: nullableNumber(discountMultiplier),
              discountChain: discountChain.trim() || null,
              netCost: nullableNumber(netCost),
              uom,
              reviewStatus,
            })}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save price
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
