import { useState, useEffect, useMemo } from 'react';
import { Check, Loader2, Plus, X, Save, Percent, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { updateCompanySettings } from '@/lib/companies-api';
import type { CompanyWithContactCount } from '@/lib/companies-api';
import { cn } from '@/lib/utils';
import { listCustomerMarkupTargets } from '@/lib/customer-markup-targets-api';
import {
  getMarkupTargetKindLabel,
  getMarkupTargetLabel,
  type MarkupTargetCatalog,
} from '@/lib/customer-markups';

interface BulkMarkupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: CompanyWithContactCount[];
  onSaved: () => void;
}

interface RowState {
  companyId: string;
  defaultMultiplier: string;
  overrides: Record<string, string>;
  isDirty: boolean;
}

const EMPTY_TARGET_CATALOG: MarkupTargetCatalog = {
  categories: [],
  subcategories: [],
  items: [],
};

function MultiplierInput({
  value,
  placeholder,
  onChange,
  isDefault,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  isDefault?: boolean;
}) {
  return (
    <div className="relative flex items-center justify-center">
      <Input
        className={`h-8 w-[100px] text-center text-sm pr-7 tabular-nums ${
          isDefault ? 'border-primary/40 bg-primary/5 font-medium' : ''
        } ${value ? '' : 'text-muted-foreground'}`}
        type="number"
        step="0.01"
        min="0.01"
        value={value}
        placeholder={placeholder ?? '1.00'}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">×</span>
    </div>
  );
}

type TargetMode = 'category' | 'subcategory' | 'item';

function AddMarkupTargetPicker({
  catalog,
  existingKeys,
  loading,
  onAdd,
}: {
  catalog: MarkupTargetCatalog;
  existingKeys: string[];
  loading: boolean;
  onAdd: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TargetMode>('category');
  const [categorySlug, setCategorySlug] = useState('');
  const [subcategorySlug, setSubcategorySlug] = useState('__all__');

  const existingKeySet = useMemo(
    () => new Set(existingKeys.map((key) => key.toLowerCase())),
    [existingKeys],
  );

  const activeCategorySlug = categorySlug || catalog.categories[0]?.slug || '';
  const categorySubcategories = catalog.subcategories.filter(
    (subcategory) => subcategory.categorySlug === activeCategorySlug,
  );
  const visibleItems = catalog.items.filter((item) => {
    if (item.categorySlug !== activeCategorySlug) return false;
    if (subcategorySlug === '__all__') return true;
    return item.subcategorySlug === subcategorySlug;
  });

  useEffect(() => {
    if (!open) return;
    if (!categorySlug && catalog.categories[0]) {
      setCategorySlug(catalog.categories[0].slug);
    }
  }, [open, categorySlug, catalog.categories]);

  const addTarget = (key: string) => {
    if (existingKeySet.has(key.toLowerCase())) return;
    onAdd(key);
    setOpen(false);
  };

  const modeButton = (value: TargetMode, label: string) => (
    <button
      type="button"
      className={cn(
        'rounded px-2 py-1 text-xs font-medium transition-colors',
        mode === value
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
      onClick={() => setMode(value)}
    >
      {label}
    </button>
  );

  const renderCategorySelect = () => (
    <Select
      value={activeCategorySlug}
      onValueChange={(value) => {
        setCategorySlug(value);
        setSubcategorySlug('__all__');
      }}
      disabled={catalog.categories.length === 0}
    >
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Category" />
      </SelectTrigger>
      <SelectContent>
        {catalog.categories.map((category) => (
          <SelectItem key={category.key} value={category.slug}>
            {category.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add Item
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="end">
        <div className="border-b p-3">
          <div className="grid grid-cols-3 rounded-md border bg-muted/40 p-1">
            {modeButton('category', 'Category')}
            {modeButton('subcategory', 'Subcategory')}
            {modeButton('item', 'Item')}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading targets…
          </div>
        ) : mode === 'category' ? (
          <Command>
            <CommandInput placeholder="Search categories…" className="h-9" />
            <CommandList>
              <CommandEmpty>No categories found.</CommandEmpty>
              <CommandGroup>
                {catalog.categories.map((category) => {
                  const isExisting = existingKeySet.has(category.key.toLowerCase());
                  return (
                    <CommandItem
                      key={category.key}
                      value={`${category.label} ${category.slug}`}
                      disabled={isExisting}
                      onSelect={() => addTarget(category.key)}
                    >
                      <Check className={cn('mr-2 h-4 w-4', isExisting ? 'opacity-100' : 'opacity-0')} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{category.label}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {category.itemCount} {category.itemCount === 1 ? 'target' : 'targets'}
                          {category.subcategoryCount > 0 ? ` · ${category.subcategoryCount} subcategories` : ''}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : mode === 'subcategory' ? (
          <div className="space-y-3 p-3">
            {renderCategorySelect()}
            <div className="max-h-[260px] overflow-y-auto rounded-md border">
              {categorySubcategories.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No subcategories found.
                </div>
              ) : (
                categorySubcategories.map((subcategory) => {
                  const isExisting = existingKeySet.has(subcategory.key.toLowerCase());
                  return (
                    <button
                      key={subcategory.key}
                      type="button"
                      disabled={isExisting}
                      className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-accent disabled:cursor-default disabled:opacity-60"
                      onClick={() => addTarget(subcategory.key)}
                    >
                      <Check className={cn('h-4 w-4 shrink-0', isExisting ? 'opacity-100' : 'opacity-0')} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{subcategory.label}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {subcategory.itemCount} {subcategory.itemCount === 1 ? 'target' : 'targets'}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-3">
            <div className="grid grid-cols-2 gap-2">
              {renderCategorySelect()}
              <Select
                value={subcategorySlug}
                onValueChange={setSubcategorySlug}
                disabled={categorySubcategories.length === 0}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Subcategory" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All subcategories</SelectItem>
                  {categorySubcategories.map((subcategory) => (
                    <SelectItem key={subcategory.key} value={subcategory.slug}>
                      {subcategory.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border">
              <Command>
                <CommandInput placeholder="Search items…" className="h-9" />
                <CommandList>
                  <CommandEmpty>No items found.</CommandEmpty>
                  <CommandGroup>
                    {visibleItems.map((item) => {
                      const isExisting = existingKeySet.has(item.key.toLowerCase());
                      return (
                        <CommandItem
                          key={item.key}
                          value={`${item.label} ${item.canonicalCode}`}
                          disabled={isExisting}
                          onSelect={() => addTarget(item.key)}
                        >
                          <Check className={cn('mr-2 h-4 w-4', isExisting ? 'opacity-100' : 'opacity-0')} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm">{item.label}</div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground">
                              {item.canonicalCode}
                              <span className="font-sans">
                                {item.usageCount > 0 ? ` · ${item.usageCount} uses` : ''}
                              </span>
                            </div>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function BulkMarkupModal({
  open,
  onOpenChange,
  companies,
  onSaved,
}: BulkMarkupModalProps) {
  const { toast } = useToast();
  const [rows, setRows] = useState<RowState[]>([]);
  const [itemColumns, setItemColumns] = useState<string[]>([]);
  const [targetCatalog, setTargetCatalog] = useState<MarkupTargetCatalog>(EMPTY_TARGET_CATALOG);
  const [isLoadingTargets, setIsLoadingTargets] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    const allKeys = new Set<string>();
    companies.forEach((c) => {
      Object.keys(c.settings.markupOverrides ?? {}).forEach((k) => allKeys.add(k));
    });

    setItemColumns(Array.from(allKeys).sort());
    setRows(
      companies.map((c) => ({
        companyId: c.id,
        defaultMultiplier: String(c.settings.costMultiplier ?? 1.0),
        overrides: Object.fromEntries(
          Object.entries(c.settings.markupOverrides ?? {}).map(([k, v]) => [k, String(v)])
        ),
        isDirty: false,
      }))
    );
  }, [open, companies]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setIsLoadingTargets(true);
    listCustomerMarkupTargets()
      .then((catalog) => {
        if (!cancelled) setTargetCatalog(catalog);
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          title: 'Error loading markup targets',
          description: err instanceof Error ? err.message : 'Unable to load categories and items.',
          variant: 'destructive',
        });
        setTargetCatalog(EMPTY_TARGET_CATALOG);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTargets(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, toast]);

  const updateDefault = (companyId: string, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.companyId === companyId ? { ...r, defaultMultiplier: value, isDirty: true } : r
      )
    );
  };

  const updateOverride = (companyId: string, key: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.companyId !== companyId) return r;
        const newOverrides = { ...r.overrides };
        if (value === '') {
          delete newOverrides[key];
        } else {
          newOverrides[key] = value;
        }
        return { ...r, overrides: newOverrides, isDirty: true };
      })
    );
  };

  const addColumn = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;

    if (itemColumns.map((k) => k.toLowerCase()).includes(trimmed.toLowerCase())) {
      toast({ title: 'Column already exists', variant: 'destructive' });
      return;
    }

    setItemColumns((prev) =>
      [...prev, trimmed].sort((a, b) =>
        getMarkupTargetLabel(a, targetCatalog).localeCompare(getMarkupTargetLabel(b, targetCatalog))
      )
    );
  };

  const removeColumn = (key: string) => {
    setItemColumns((prev) => prev.filter((k) => k !== key));
    setRows((prev) =>
      prev.map((r) => {
        const newOverrides = { ...r.overrides };
        delete newOverrides[key];
        return { ...r, overrides: newOverrides, isDirty: true };
      })
    );
  };

  const dirtyCount = rows.filter((r) => r.isDirty).length;

  const handleSave = async () => {
    const dirtyRows = rows.filter((r) => r.isDirty);
    if (dirtyRows.length === 0) {
      onOpenChange(false);
      return;
    }

    setIsSaving(true);
    try {
      await Promise.all(
        dirtyRows.map((row) => {
          const defaultMult = parseFloat(row.defaultMultiplier);
          const overrides: Record<string, number> = {};
          Object.entries(row.overrides).forEach(([k, v]) => {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) overrides[k] = n;
          });

          return updateCompanySettings(row.companyId, {
            costMultiplier: isNaN(defaultMult) || defaultMult <= 0 ? 1.0 : defaultMult,
            markupOverrides: overrides,
          });
        })
      );

      toast({
        title: 'Markups saved',
        description: `Updated ${dirtyRows.length} customer${dirtyRows.length !== 1 ? 's' : ''}.`,
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Error saving markups',
        description: err instanceof Error ? err.message : 'An unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[96vw] max-w-6xl flex-col gap-0 p-0">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b px-6 py-4">
          <div>
            <DialogTitle className="font-display text-xl">Bulk Markup Manager</DialogTitle>
            <DialogDescription className="mt-1 max-w-xl">
              Set a default multiplier per customer, then add category, subcategory, or item
              overrides in columns. Blank cells inherit the default.
            </DialogDescription>
          </div>
          <div className="ml-4 flex shrink-0 items-center gap-2">
            {dirtyCount > 0 && (
              <Badge variant="outline" className="border-amber-400 text-amber-600 dark:text-amber-400">
                {dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}
              </Badge>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex shrink-0 items-center gap-4 border-b bg-muted/30 px-6 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Percent className="h-3 w-3" />
            <span>Multiplier — e.g. <strong className="text-foreground">1.25</strong> = 25% markup</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Info className="h-3 w-3" />
            <span>Leave override cells blank to inherit the customer's default</span>
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/60 backdrop-blur">
                {/* Customer column */}
                <th className="sticky left-0 z-20 min-w-[200px] border-b border-r bg-muted/60 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                  Customer
                </th>

                {/* Default column */}
                <th className="min-w-[130px] border-b border-r bg-primary/10 px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide">
                  <div className="flex flex-col items-center gap-0.5">
                    <span>Default</span>
                    <span className="text-[10px] font-normal normal-case text-muted-foreground">
                      applies to all
                    </span>
                  </div>
                </th>

                {/* Item override columns */}
                {itemColumns.map((col) => (
                  <th
                    key={col}
                    className="min-w-[150px] border-b border-r px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <div className="min-w-0">
                        <span
                          className="block max-w-[100px] truncate text-foreground"
                          title={getMarkupTargetLabel(col, targetCatalog)}
                        >
                          {getMarkupTargetLabel(col, targetCatalog)}
                        </span>
                        <span className="block text-[9px] font-medium normal-case text-muted-foreground">
                          {getMarkupTargetKindLabel(col)}
                        </span>
                      </div>
                      <button
                        onClick={() => removeColumn(col)}
                        className="shrink-0 rounded text-muted-foreground/50 transition-colors hover:text-destructive"
                        title={`Remove ${getMarkupTargetLabel(col, targetCatalog)} column`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </th>
                ))}

                {/* Add column */}
                <th className="min-w-[150px] border-b px-3 py-2.5">
                  <AddMarkupTargetPicker
                    catalog={targetCatalog}
                    existingKeys={itemColumns}
                    loading={isLoadingTargets}
                    onAdd={addColumn}
                  />
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3 + itemColumns.length} className="py-12 text-center text-muted-foreground">
                    No customers found.
                  </td>
                </tr>
              )}
              {rows.map((row, idx) => {
                const company = companies.find((c) => c.id === row.companyId);
                if (!company) return null;

                const parsedDefault = parseFloat(row.defaultMultiplier);
                const defaultPlaceholder = isNaN(parsedDefault)
                  ? '1.00'
                  : parsedDefault.toFixed(2);

                const rowBase =
                  row.isDirty
                    ? 'bg-amber-50 dark:bg-amber-950/20'
                    : idx % 2 === 0
                    ? 'bg-background'
                    : 'bg-muted/20';

                return (
                  <tr key={row.companyId} className={`border-b transition-colors ${rowBase}`}>
                    {/* Customer name */}
                    <td
                      className={`sticky left-0 z-10 border-r px-4 py-2.5 ${
                        row.isDirty
                          ? 'bg-amber-50 dark:bg-amber-950/20'
                          : idx % 2 === 0
                          ? 'bg-background'
                          : 'bg-muted/20'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {row.isDirty && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-medium leading-tight">{company.name}</p>
                          {(company.billingCity || company.billingState) && (
                            <p className="truncate text-xs text-muted-foreground">
                              {[company.billingCity, company.billingState]
                                .filter(Boolean)
                                .join(', ')}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Default multiplier */}
                    <td className="border-r px-3 py-2 text-center">
                      <MultiplierInput
                        value={row.defaultMultiplier}
                        onChange={(v) => updateDefault(row.companyId, v)}
                        isDefault
                      />
                    </td>

                    {/* Item override cells */}
                    {itemColumns.map((col) => {
                      const val = row.overrides[col] ?? '';
                      return (
                        <td key={col} className="border-r px-3 py-2 text-center">
                          <MultiplierInput
                            value={val}
                            placeholder={defaultPlaceholder}
                            onChange={(v) => updateOverride(row.companyId, col, v)}
                          />
                        </td>
                      );
                    })}

                    <td />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
            Rows with a dot have unsaved changes
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} Change${dirtyCount !== 1 ? 's' : ''}` : 'Done'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
