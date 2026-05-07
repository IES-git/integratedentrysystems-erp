import { useState, useEffect, useRef } from 'react';
import { Loader2, DollarSign } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AdderFieldSummary, PricingAdderCell } from '@/types';
import { getAdderFieldsForSeries } from '@/lib/item-fields-api';
import { getAdderCells, upsertAdderCell } from '@/lib/pricing-api';
import { useToast } from '@/hooks/use-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Vendor {
  id: string;
  name: string;
}

interface AdderTableEditorProps {
  tableId: string;
  seriesValue: string;
  vendors: Vendor[];
}

function adderCellKey(
  canonicalCode: string,
  fieldDefinitionId: string,
  optionValue: string,
  companyId: string,
): string {
  return `${canonicalCode}::${fieldDefinitionId}::${optionValue}::${companyId}`;
}

// ---------------------------------------------------------------------------
// AdderPriceCell
// ---------------------------------------------------------------------------

interface AdderPriceCellProps {
  tableId: string;
  canonicalCode: string;
  fieldDefinitionId: string;
  optionValue: string;
  companyId: string;
  initialPrice: number | null;
  onSave: (key: string, price: number | null) => void;
}

function AdderPriceCell({
  tableId,
  canonicalCode,
  fieldDefinitionId,
  optionValue,
  companyId,
  initialPrice,
  onSave,
}: AdderPriceCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialPrice !== null ? String(initialPrice) : '');
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!editing) setDraft(initialPrice !== null ? String(initialPrice) : '');
  }, [initialPrice, editing]);

  async function commit(val: string) {
    const trimmed = val.trim();
    const parsed = trimmed === '' ? null : parseFloat(trimmed);
    if (parsed !== null && isNaN(parsed)) return;
    if (parsed === initialPrice) return;

    setSaving(true);
    try {
      await upsertAdderCell({
        tableId,
        canonicalCode,
        fieldDefinitionId,
        optionValue,
        companyId,
        price: parsed,
      });
      onSave(adderCellKey(canonicalCode, fieldDefinitionId, optionValue, companyId), parsed);
    } catch {
      toast({ title: 'Error', description: 'Failed to save adder price', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  function handleBlur() {
    setEditing(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void commit(draft);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      setEditing(false);
      setDraft(initialPrice !== null ? String(initialPrice) : '');
    }
  }

  const displayValue = initialPrice !== null ? `$${Number(initialPrice).toFixed(2)}` : '';

  return (
    <td className={cn('border-r border-b border-border px-1 text-sm tabular-nums text-center', saving && 'opacity-60')}>
      {editing ? (
        <Input
          type="number"
          step="0.01"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="h-8 text-xs text-center border-0 shadow-none focus-visible:ring-1 p-1 w-full"
          autoFocus
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={cn(
            'w-full h-8 flex items-center justify-center text-xs transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
            displayValue ? 'text-foreground' : 'text-muted-foreground/30',
          )}
          title="Click to edit adder price"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : displayValue || '—'}
        </button>
      )}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Single field mini-table
// ---------------------------------------------------------------------------

interface AdderFieldTableProps {
  tableId: string;
  field: AdderFieldSummary;
  vendors: Vendor[];
  cellMap: Map<string, number | null>;
  onCellSave: (key: string, price: number | null) => void;
}

function AdderFieldTable({ tableId, field, vendors, cellMap, onCellSave }: AdderFieldTableProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="rounded-xl border overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/70">
              {/* Field name as column header */}
              <th className="border-r border-b border-border px-3 py-2 text-left text-xs font-semibold text-foreground tracking-wide w-48">
                {field.fieldLabel}
                {field.itemLabel && (
                  <span className="ml-1.5 font-normal text-muted-foreground">({field.itemLabel})</span>
                )}
              </th>
              {vendors.map((v) => (
                <th
                  key={v.id}
                  className="border-r border-b border-border px-3 py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[120px]"
                >
                  {v.name}
                </th>
              ))}
              {vendors.length === 0 && (
                <th className="border-b border-border px-3 py-2 text-left text-xs text-muted-foreground italic">
                  No vendors attached — add vendors above.
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {field.options.length === 0 && (
              <tr>
                <td
                  colSpan={vendors.length + 1}
                  className="border-b border-border px-3 py-3 text-xs text-muted-foreground italic text-center"
                >
                  No options configured for this field.
                </td>
              </tr>
            )}
            {field.options.map((optionValue) => (
              <tr key={optionValue} className="group hover:bg-muted/20 transition-colors">
                {/* Option value as the row label */}
                <td className="border-r border-b border-border px-3 py-0 text-sm font-medium">
                  <div className="h-8 flex items-center">{optionValue}</div>
                </td>
                {vendors.map((vendor) => (
                  <AdderPriceCell
                    key={vendor.id}
                    tableId={tableId}
                    canonicalCode={field.canonicalCode}
                    fieldDefinitionId={field.fieldDefinitionId}
                    optionValue={optionValue}
                    companyId={vendor.id}
                    initialPrice={
                      cellMap.get(
                        adderCellKey(field.canonicalCode, field.fieldDefinitionId, optionValue, vendor.id),
                      ) ?? null
                    }
                    onSave={onCellSave}
                  />
                ))}
                {vendors.length === 0 && (
                  <td className="border-b border-border px-3 py-2 text-xs text-muted-foreground italic">—</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdderTableEditor
// ---------------------------------------------------------------------------

export function AdderTableEditor({ tableId, seriesValue, vendors }: AdderTableEditorProps) {
  const { toast } = useToast();

  const [adderFields, setAdderFields] = useState<AdderFieldSummary[]>([]);
  const [cellMap, setCellMap] = useState<Map<string, number | null>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [fields, cells] = await Promise.all([
          getAdderFieldsForSeries(seriesValue),
          getAdderCells(tableId),
        ]);

        if (cancelled) return;

        setAdderFields(fields);

        const map = new Map<string, number | null>();
        for (const cell of cells as PricingAdderCell[]) {
          map.set(
            adderCellKey(cell.canonicalCode, cell.fieldDefinitionId, cell.optionValue, cell.companyId),
            cell.price,
          );
        }
        setCellMap(map);
      } catch (err) {
        if (!cancelled) {
          toast({
            title: 'Error',
            description: err instanceof Error ? err.message : 'Failed to load adder fields',
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [tableId, seriesValue, toast]);

  function handleCellSave(key: string, price: number | null) {
    setCellMap((m) => new Map(m).set(key, price));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading adder fields…
      </div>
    );
  }

  if (adderFields.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
        <DollarSign className="h-8 w-8 opacity-30" />
        <p className="text-sm max-w-xs">
          No fields are flagged as adders for this series. Toggle the{' '}
          <strong className="text-foreground">money-sign icon</strong> on a field in{' '}
          <strong className="text-foreground">/items</strong> to add one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {adderFields.map((field) => (
        <AdderFieldTable
          key={`${field.canonicalCode}::${field.fieldDefinitionId}`}
          tableId={tableId}
          field={field}
          vendors={vendors}
          cellMap={cellMap}
          onCellSave={handleCellSave}
        />
      ))}
    </div>
  );
}
