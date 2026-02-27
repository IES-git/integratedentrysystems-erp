import { useState, useEffect, useRef } from 'react';
import { Plus, X, Save, Percent, Info } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { updateCompanySettings } from '@/lib/companies-api';
import type { CompanyWithContactCount } from '@/lib/companies-api';

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

export function BulkMarkupModal({
  open,
  onOpenChange,
  companies,
  onSaved,
}: BulkMarkupModalProps) {
  const { toast } = useToast();
  const [rows, setRows] = useState<RowState[]>([]);
  const [itemColumns, setItemColumns] = useState<string[]>([]);
  const [newColumnName, setNewColumnName] = useState('');
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const newColumnInputRef = useRef<HTMLInputElement>(null);

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
    setIsAddingColumn(false);
    setNewColumnName('');
  }, [open, companies]);

  useEffect(() => {
    if (isAddingColumn) {
      setTimeout(() => newColumnInputRef.current?.focus(), 50);
    }
  }, [isAddingColumn]);

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

  const addColumn = () => {
    const trimmed = newColumnName.trim();
    if (!trimmed) {
      setIsAddingColumn(false);
      return;
    }
    if (itemColumns.map((k) => k.toLowerCase()).includes(trimmed.toLowerCase())) {
      toast({ title: 'Column already exists', variant: 'destructive' });
      return;
    }
    setItemColumns((prev) => [...prev, trimmed]);
    setNewColumnName('');
    setIsAddingColumn(false);
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
              Set a default multiplier per customer, then add item-specific overrides in columns.
              Blank item cells inherit the default.
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
            <span>Leave item cells blank to inherit the customer's default</span>
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
                    className="min-w-[130px] border-b border-r px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className="truncate max-w-[90px]" title={col}>
                        {col}
                      </span>
                      <button
                        onClick={() => removeColumn(col)}
                        className="shrink-0 rounded text-muted-foreground/50 transition-colors hover:text-destructive"
                        title={`Remove ${col} column`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </th>
                ))}

                {/* Add column */}
                <th className="min-w-[150px] border-b px-3 py-2.5">
                  {isAddingColumn ? (
                    <div className="flex items-center gap-1">
                      <Input
                        ref={newColumnInputRef}
                        className="h-7 w-24 text-xs"
                        placeholder="Item name…"
                        value={newColumnName}
                        onChange={(e) => setNewColumnName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addColumn();
                          if (e.key === 'Escape') {
                            setIsAddingColumn(false);
                            setNewColumnName('');
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
                        onClick={addColumn}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => {
                          setIsAddingColumn(false);
                          setNewColumnName('');
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setIsAddingColumn(true)}
                    >
                      <Plus className="h-3 w-3" />
                      Add Item
                    </Button>
                  )}
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
