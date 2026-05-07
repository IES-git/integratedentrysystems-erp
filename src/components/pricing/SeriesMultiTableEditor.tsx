import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Plus, X, Building2, Search, Loader2, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { PricingTableSummary, Company } from '@/types';
import {
  listPricingTablesForSeries,
  listManufacturerCompanies,
  createPricingTable,
  attachPricingTableVendor,
  deletePricingTable,
} from '@/lib/pricing-api';
import { useToast } from '@/hooks/use-toast';
import { PricingTableEditor } from './PricingTableEditor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the display label for a pricing table tab — the manufacturer name if assigned. */
function tabLabel(t: PricingTableSummary): string {
  return t.vendors[0]?.name ?? t.name;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SeriesMultiTableEditorProps {
  seriesValue: string;
  fieldValueOptionId?: string;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SeriesMultiTableEditor({
  seriesValue,
  fieldValueOptionId,
  onBack,
}: SeriesMultiTableEditorProps) {
  const { toast } = useToast();

  const [tables, setTables] = useState<PricingTableSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Manufacturer picker popover
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allManufacturers, setAllManufacturers] = useState<Company[]>([]);
  const [loadingMfr, setLoadingMfr] = useState(false);
  const [mfrSearch, setMfrSearch] = useState('');
  const [creating, setCreating] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<PricingTableSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ---------------------------------------------------------------------------
  // Load tables
  // ---------------------------------------------------------------------------

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPricingTablesForSeries('doors', seriesValue);
      setTables(data);
      setActiveId((prev) => {
        if (prev && data.find((t) => t.id === prev)) return prev;
        return data[0]?.id ?? null;
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to load pricing tables', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [seriesValue, toast]);

  useEffect(() => { void load(); }, [load]);

  // ---------------------------------------------------------------------------
  // Load manufacturers when picker opens
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!pickerOpen || allManufacturers.length > 0) return;
    setLoadingMfr(true);
    listManufacturerCompanies()
      .then(setAllManufacturers)
      .catch(() => toast({ title: 'Error', description: 'Failed to load manufacturers', variant: 'destructive' }))
      .finally(() => setLoadingMfr(false));
  }, [pickerOpen, allManufacturers.length, toast]);

  // ---------------------------------------------------------------------------
  // Derive available manufacturers (not already assigned to any table)
  // ---------------------------------------------------------------------------

  const usedVendorIds = new Set(tables.flatMap((t) => t.vendors.map((v) => v.id)));

  const filteredManufacturers = allManufacturers.filter(
    (m) =>
      !usedVendorIds.has(m.id) &&
      m.name.toLowerCase().includes(mfrSearch.toLowerCase()),
  );

  // ---------------------------------------------------------------------------
  // Create table for a manufacturer
  // ---------------------------------------------------------------------------

  async function handleSelectManufacturer(company: Company) {
    setCreating(true);
    setPickerOpen(false);
    setMfrSearch('');
    try {
      const created = await createPricingTable(
        'doors',
        seriesValue,
        company.name,
        fieldValueOptionId,
      );
      await attachPricingTableVendor(created.id, company.id);

      const summary: PricingTableSummary = {
        id: created.id,
        name: created.name,
        rowCount: 0,
        columnCount: 0,
        lastUpdatedAt: created.updatedAt,
        vendors: [{ id: company.id, name: company.name }],
      };
      setTables((prev) => [...prev, summary]);
      setActiveId(created.id);
    } catch {
      toast({ title: 'Error', description: 'Failed to create pricing table', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete table
  // ---------------------------------------------------------------------------

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePricingTable(deleteTarget.id);
      const remaining = tables.filter((t) => t.id !== deleteTarget.id);
      setTables(remaining);
      if (activeId === deleteTarget.id) {
        setActiveId(remaining[0]?.id ?? null);
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete pricing table', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Sync vendor changes from within the editor back into the tab bar
  // (PricingTableEditor calls onVendorsChange via VendorMultiSelect)
  // ---------------------------------------------------------------------------

  function handleVendorSync(tableId: string, vendors: { id: string; name: string }[]) {
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, vendors } : t)),
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col min-h-full">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{seriesValue} Series Pricing</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            One pricing table per manufacturer.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-96 rounded-lg" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* ------------------------------------------------------------------ */}
          {/* Tab bar                                                              */}
          {/* ------------------------------------------------------------------ */}
          <div className="flex items-stretch gap-0 border-b border-border mb-6 overflow-x-auto">
            {tables.map((t) => (
              <div
                key={t.id}
                className={cn(
                  'group relative flex items-center gap-1.5 px-4 py-2.5 cursor-pointer select-none shrink-0 transition-colors text-sm font-medium border-b-2',
                  activeId === t.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
                onClick={() => setActiveId(t.id)}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="max-w-[200px] truncate">{tabLabel(t)}</span>

                {/* Remove tab */}
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(t); }}
                  className={cn(
                    'rounded-sm p-0.5 transition-colors shrink-0 ml-0.5',
                    activeId === t.id
                      ? 'text-muted-foreground opacity-50 hover:opacity-100 hover:text-destructive hover:bg-destructive/10'
                      : 'text-muted-foreground opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:text-destructive hover:bg-destructive/10',
                  )}
                  title={`Delete ${tabLabel(t)} pricing table`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {/* Add manufacturer tab — creates a new separate pricing table */}
            <Popover open={pickerOpen} onOpenChange={(o) => { setPickerOpen(o); if (!o) setMfrSearch(''); }}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0 border-b-2 border-transparent disabled:opacity-50"
                  disabled={creating}
                  title="Create a new, separate pricing table for a manufacturer"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline-flex items-center gap-1">
                    {creating ? 'Adding…' : (
                      <>
                        Add manufacturer
                        <Table2 className="h-3 w-3 opacity-40" />
                      </>
                    )}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <Input
                    value={mfrSearch}
                    onChange={(e) => setMfrSearch(e.target.value)}
                    placeholder="Search manufacturers…"
                    className="h-7 border-0 p-0 text-sm shadow-none focus-visible:ring-0"
                    autoFocus
                  />
                </div>
                <div className="max-h-60 overflow-y-auto py-1">
                  {loadingMfr && (
                    <p className="px-3 py-3 text-xs text-muted-foreground animate-pulse">
                      Loading manufacturers…
                    </p>
                  )}
                  {!loadingMfr && filteredManufacturers.length === 0 && (
                    <p className="px-3 py-3 text-xs text-muted-foreground italic">
                      {allManufacturers.length > 0
                        ? usedVendorIds.size >= allManufacturers.length
                          ? 'All manufacturers already have a pricing table.'
                          : 'No matches'
                        : 'No manufacturers found. Add them in Manufacturers first.'}
                    </p>
                  )}
                  {filteredManufacturers.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => void handleSelectManufacturer(m)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent text-left"
                    >
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {m.name}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Active table editor                                                  */}
          {/* ------------------------------------------------------------------ */}
          {activeId ? (
            <PricingTableEditor
              key={activeId}
              tableId={activeId}
              seriesValue={seriesValue}
              embedded
              onVendorSync={(vendors) => handleVendorSync(activeId, vendors)}
              onDelete={() => {
                const t = tables.find((x) => x.id === activeId);
                if (t) setDeleteTarget(t);
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center border rounded-2xl border-dashed">
              <Building2 className="h-12 w-12 text-muted-foreground/25 mb-4" />
              <p className="font-medium text-muted-foreground mb-1">No manufacturer tables yet</p>
              <p className="text-sm text-muted-foreground mb-5">
                Add a pricing table for each manufacturer that supplies this series.
              </p>
              <Popover open={pickerOpen} onOpenChange={(o) => { setPickerOpen(o); if (!o) setMfrSearch(''); }}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-1.5" title="Create a new pricing table for a manufacturer">
                    <Plus className="h-4 w-4" />
                    Add First Manufacturer
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0">
                  <div className="flex items-center gap-2 border-b px-3 py-2">
                    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Input
                      value={mfrSearch}
                      onChange={(e) => setMfrSearch(e.target.value)}
                      placeholder="Search manufacturers…"
                      className="h-7 border-0 p-0 text-sm shadow-none focus-visible:ring-0"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto py-1">
                    {loadingMfr && (
                      <p className="px-3 py-3 text-xs text-muted-foreground animate-pulse">Loading…</p>
                    )}
                    {!loadingMfr && filteredManufacturers.length === 0 && (
                      <p className="px-3 py-3 text-xs text-muted-foreground italic">
                        No manufacturers found.
                      </p>
                    )}
                    {filteredManufacturers.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => void handleSelectManufacturer(m)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent text-left"
                      >
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {m.name}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </>
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget ? tabLabel(deleteTarget) : ''} pricing table?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all columns, rows, prices, and adders for{' '}
              <strong>{deleteTarget ? tabLabel(deleteTarget) : ''}</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
