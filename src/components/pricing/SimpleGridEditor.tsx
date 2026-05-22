/**
 * SimpleGridEditor — a clean height (rows) × width (columns) pricing grid.
 * Used for Lites, Louvers & Glass pricing tables.
 *
 * Rows represent heights (e.g. "6'8"", "7'0""), columns represent widths
 * (e.g. "2'0"", "2'4""). Each cell holds a price.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Plus, Trash2, GripVertical, Loader2, Check, Pencil, Tag, X, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import type { PricingTable, PricingRow, PricingColumn, PricingCell, PricingTableItem } from '@/types';
import {
  getPricingTableFull,
  updatePricingTable,
  addPricingRow,
  addPricingColumn,
  updatePricingRow,
  updatePricingColumn,
  deletePricingRow,
  deletePricingColumn,
  reorderPricingRows,
  reorderPricingColumns,
  upsertPricingCell,
  listPricingTableItems,
  addPricingTableItem,
  removePricingTableItem,
  listItemsForCategory,
} from '@/lib/pricing-api';

interface SimpleGridEditorProps {
  tableId: string;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(price: number | null): string {
  if (price === null || price === undefined) return '';
  return price.toString();
}

function parsePrice(raw: string): number | null {
  const v = parseFloat(raw.replace(/[^0-9.-]/g, ''));
  if (isNaN(v)) return null;
  return v;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SimpleGridEditor({ tableId, onBack }: SimpleGridEditorProps) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [table, setTable] = useState<PricingTable | null>(null);
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [columns, setColumns] = useState<PricingColumn[]>([]);
  const [cells, setCells] = useState<PricingCell[]>([]);

  // Pending cell saves: key = "rowId:colId" → timeout id
  const savingCells = useRef<Set<string>>(new Set());
  const [savedCells, setSavedCells] = useState<Set<string>>(new Set());

  // Table name editing
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');

  // Tagged items
  const [taggedItems, setTaggedItems] = useState<PricingTableItem[]>([]);
  const [allItems, setAllItems] = useState<{ canonicalCode: string; label: string }[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [addingItem, setAddingItem] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const full = await getPricingTableFull(tableId);
      setTable(full.table);
      setRows(full.rows);
      setColumns(full.columns);
      setCells(full.cells);
      setNameValue(full.table.name);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to load table',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [tableId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load tagged items and available items list
  const loadTaggedItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const items = await listPricingTableItems(tableId);
      setTaggedItems(items);
    } catch {
      // Non-fatal
    } finally {
      setItemsLoading(false);
    }
  }, [tableId]);

  const loadAllItems = useCallback(async (category: string) => {
    try {
      const items = await listItemsForCategory(category);
      setAllItems(items);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    void loadTaggedItems();
  }, [loadTaggedItems]);

  // Once table is loaded, fetch all items for that category
  useEffect(() => {
    if (table) {
      void loadAllItems(table.category);
    }
  }, [table, loadAllItems]);

  async function handleAddItem(canonicalCode: string, label: string) {
    if (!table) return;
    setAddingItem(true);
    try {
      const item = await addPricingTableItem(tableId, canonicalCode, table.category);
      setTaggedItems((prev) => [...prev, { ...item, itemLabel: label }]);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to add item',
        variant: 'destructive',
      });
    } finally {
      setAddingItem(false);
    }
  }

  async function handleRemoveItem(canonicalCode: string) {
    try {
      await removePricingTableItem(tableId, canonicalCode);
      setTaggedItems((prev) => prev.filter((i) => i.canonicalCode !== canonicalCode));
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to remove item',
        variant: 'destructive',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Name editing
  // ---------------------------------------------------------------------------

  async function handleSaveName() {
    const name = nameValue.trim();
    if (!name || !table || name === table.name) {
      setEditingName(false);
      setNameValue(table?.name ?? '');
      return;
    }
    try {
      const updated = await updatePricingTable(tableId, { name });
      setTable(updated);
      setNameValue(updated.name);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update name',
        variant: 'destructive',
      });
    } finally {
      setEditingName(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Rows (heights)
  // ---------------------------------------------------------------------------

  const [addingRow, setAddingRow] = useState(false);
  const [newRowLabel, setNewRowLabel] = useState('');

  async function handleAddRow() {
    const label = newRowLabel.trim();
    if (!label) return;
    setAddingRow(true);
    try {
      const row = await addPricingRow(tableId, label);
      setRows((prev) => [...prev, row]);
      setNewRowLabel('');
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to add row',
        variant: 'destructive',
      });
    } finally {
      setAddingRow(false);
    }
  }

  async function handleDeleteRow(rowId: string) {
    try {
      await deletePricingRow(rowId);
      setRows((prev) => prev.filter((r) => r.id !== rowId));
      setCells((prev) => prev.filter((c) => c.pricingRowId !== rowId));
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete row',
        variant: 'destructive',
      });
    }
  }

  async function handleUpdateRowLabel(rowId: string, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    try {
      const updated = await updatePricingRow(rowId, { label: trimmed });
      setRows((prev) => prev.map((r) => (r.id === rowId ? updated : r)));
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update row',
        variant: 'destructive',
      });
    }
  }

  // Row drag reorder
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);

  function handleRowDragStart(rowId: string) {
    setDraggingRowId(rowId);
  }

  function handleRowDragOver(e: React.DragEvent, rowId: string) {
    e.preventDefault();
    setDragOverRowId(rowId);
  }

  async function handleRowDrop(targetRowId: string) {
    if (!draggingRowId || draggingRowId === targetRowId) {
      setDraggingRowId(null);
      setDragOverRowId(null);
      return;
    }
    const newOrder = [...rows];
    const fromIdx = newOrder.findIndex((r) => r.id === draggingRowId);
    const toIdx = newOrder.findIndex((r) => r.id === targetRowId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    setRows(newOrder);
    setDraggingRowId(null);
    setDragOverRowId(null);
    try {
      await reorderPricingRows(tableId, newOrder.map((r) => r.id));
    } catch {
      await load();
    }
  }

  // ---------------------------------------------------------------------------
  // Columns (widths)
  // ---------------------------------------------------------------------------

  const [addingCol, setAddingCol] = useState(false);
  const [newColLabel, setNewColLabel] = useState('');

  async function handleAddColumn() {
    const label = newColLabel.trim();
    if (!label) return;
    setAddingCol(true);
    try {
      const col = await addPricingColumn(tableId, label);
      setColumns((prev) => [...prev, col]);
      setNewColLabel('');
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to add column',
        variant: 'destructive',
      });
    } finally {
      setAddingCol(false);
    }
  }

  async function handleDeleteColumn(colId: string) {
    try {
      await deletePricingColumn(colId);
      setColumns((prev) => prev.filter((c) => c.id !== colId));
      setCells((prev) => prev.filter((c) => c.pricingColumnId !== colId));
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete column',
        variant: 'destructive',
      });
    }
  }

  async function handleUpdateColumnLabel(colId: string, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    try {
      const updated = await updatePricingColumn(colId, { label: trimmed });
      setColumns((prev) => prev.map((c) => (c.id === colId ? updated : c)));
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update column',
        variant: 'destructive',
      });
    }
  }

  // Column drag reorder
  const [draggingColId, setDraggingColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  function handleColDragStart(colId: string) {
    setDraggingColId(colId);
  }

  function handleColDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault();
    setDragOverColId(colId);
  }

  async function handleColDrop(targetColId: string) {
    if (!draggingColId || draggingColId === targetColId) {
      setDraggingColId(null);
      setDragOverColId(null);
      return;
    }
    const newOrder = [...columns];
    const fromIdx = newOrder.findIndex((c) => c.id === draggingColId);
    const toIdx = newOrder.findIndex((c) => c.id === targetColId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    setColumns(newOrder);
    setDraggingColId(null);
    setDragOverColId(null);
    try {
      await reorderPricingColumns(tableId, newOrder.map((c) => c.id));
    } catch {
      await load();
    }
  }

  // ---------------------------------------------------------------------------
  // Cells
  // ---------------------------------------------------------------------------

  function getCellPrice(rowId: string, colId: string): string {
    const cell = cells.find((c) => c.pricingRowId === rowId && c.pricingColumnId === colId);
    return formatPrice(cell?.price ?? null);
  }

  // Debounced cell save
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function handleCellChange(rowId: string, colId: string, rawValue: string) {
    const key = `${rowId}:${colId}`;

    // Optimistically update local state
    const price = parsePrice(rawValue);
    setCells((prev) => {
      const idx = prev.findIndex((c) => c.pricingRowId === rowId && c.pricingColumnId === colId);
      if (idx === -1) {
        return [
          ...prev,
          {
            id: key,
            pricingRowId: rowId,
            pricingColumnId: colId,
            price,
            currency: 'USD',
            notes: null,
            updatedAt: new Date().toISOString(),
          },
        ];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], price };
      return next;
    });

    // Debounce the save
    const existing = saveTimers.current.get(key);
    if (existing) clearTimeout(existing);
    savingCells.current.add(key);

    const timer = setTimeout(async () => {
      try {
        const saved = await upsertPricingCell(rowId, colId, price);
        setCells((prev) => {
          const idx = prev.findIndex(
            (c) => c.pricingRowId === rowId && c.pricingColumnId === colId,
          );
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = saved;
          return next;
        });
        setSavedCells((prev) => {
          const next = new Set(prev);
          next.add(key);
          return next;
        });
        setTimeout(() => {
          setSavedCells((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }, 1200);
      } catch {
        // silently ignore — user can retry
      } finally {
        savingCells.current.delete(key);
        saveTimers.current.delete(key);
      }
    }, 600);

    saveTimers.current.set(key, timer);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!table) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Pricing table not found.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={() => void handleSaveName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveName();
                  if (e.key === 'Escape') {
                    setEditingName(false);
                    setNameValue(table.name);
                  }
                }}
                className="text-2xl font-bold h-auto py-0.5 px-2 w-80"
                autoFocus
              />
            </div>
          ) : (
            <button
              onClick={() => setEditingName(true)}
              className="group flex items-center gap-2 text-left"
            >
              <h1 className="text-2xl font-bold tracking-tight truncate">{table.name}</h1>
              <Pencil className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
          <p className="text-muted-foreground text-sm mt-0.5">
            Rows = heights · Columns = widths · Click any cell to enter a price.
          </p>
        </div>
      </div>

      {/* Tagged Items */}
      <div className="rounded-xl border bg-card px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Tag className="h-3.5 w-3.5" />
            Tagged Items
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={addingItem}>
                {addingItem ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Add Item
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-h-64 overflow-y-auto">
              {allItems.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No items found for this category
                </div>
              ) : (
                allItems
                  .filter((i) => !taggedItems.some((t) => t.canonicalCode === i.canonicalCode))
                  .map((item) => (
                    <DropdownMenuItem
                      key={item.canonicalCode}
                      onSelect={() => void handleAddItem(item.canonicalCode, item.label)}
                      className="flex flex-col items-start gap-0 cursor-pointer"
                    >
                      <span className="text-sm">{item.label}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{item.canonicalCode}</span>
                    </DropdownMenuItem>
                  ))
              )}
              {allItems.filter((i) => !taggedItems.some((t) => t.canonicalCode === i.canonicalCode)).length === 0 &&
                allItems.length > 0 && (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    All items already added
                  </div>
                )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {itemsLoading ? (
          <div className="flex gap-2 flex-wrap">
            {[1, 2].map((n) => (
              <Skeleton key={n} className="h-6 w-28 rounded-full" />
            ))}
          </div>
        ) : taggedItems.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No items tagged yet. Click <strong>Add Item</strong> to link items from this category to this pricing table.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {taggedItems.map((item) => (
              <Badge
                key={item.canonicalCode}
                variant="secondary"
                className="gap-1 pr-1 text-xs font-normal"
              >
                <span>{item.itemLabel}</span>
                <button
                  onClick={() => void handleRemoveItem(item.canonicalCode)}
                  className="ml-0.5 rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5 transition-colors"
                  aria-label={`Remove ${item.itemLabel}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Grid container */}
      <div className="rounded-xl border bg-card overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {/* Top-left corner cell */}
              <th className="w-[160px] min-w-[140px] border-b border-r bg-muted/40 px-3 py-2 text-left text-xs font-semibold text-muted-foreground sticky left-0 z-10">
                Height ↓ / Width →
              </th>

              {/* Column headers */}
              {columns.map((col) => (
                <ColumnHeader
                  key={col.id}
                  col={col}
                  isDragOver={dragOverColId === col.id}
                  onDragStart={() => handleColDragStart(col.id)}
                  onDragOver={(e) => handleColDragOver(e, col.id)}
                  onDrop={() => void handleColDrop(col.id)}
                  onDragEnd={() => { setDraggingColId(null); setDragOverColId(null); }}
                  onLabelChange={(label) => void handleUpdateColumnLabel(col.id, label)}
                  onDelete={() => void handleDeleteColumn(col.id)}
                />
              ))}

              {/* Add column */}
              <th className="border-b bg-muted/20 px-2 py-2 min-w-[120px]">
                <div className="flex items-center gap-1">
                  <Input
                    placeholder="+ Width"
                    value={newColLabel}
                    onChange={(e) => setNewColLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddColumn();
                    }}
                    className="h-7 text-xs w-24"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => void handleAddColumn()}
                    disabled={!newColLabel.trim() || addingCol}
                  >
                    {addingCol ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                draggable
                onDragStart={() => handleRowDragStart(row.id)}
                onDragOver={(e) => handleRowDragOver(e, row.id)}
                onDrop={() => void handleRowDrop(row.id)}
                onDragEnd={() => { setDraggingRowId(null); setDragOverRowId(null); }}
                className={
                  dragOverRowId === row.id
                    ? 'bg-primary/5 outline outline-2 outline-primary/30 outline-offset-[-2px]'
                    : draggingRowId === row.id
                    ? 'opacity-40'
                    : 'hover:bg-muted/20'
                }
              >
                {/* Row header */}
                <RowHeader
                  row={row}
                  onLabelChange={(label) => void handleUpdateRowLabel(row.id, label)}
                  onDelete={() => void handleDeleteRow(row.id)}
                />

                {/* Cells */}
                {columns.map((col) => {
                  const key = `${row.id}:${col.id}`;
                  return (
                    <td key={col.id} className="border-b border-r p-0">
                      <PriceCellInput
                        value={getCellPrice(row.id, col.id)}
                        onChange={(v) => handleCellChange(row.id, col.id, v)}
                        isSaved={savedCells.has(key)}
                      />
                    </td>
                  );
                })}

                {/* Empty column spacer */}
                <td className="border-b bg-muted/10" />
              </tr>
            ))}

            {/* Add row */}
            <tr>
              <td className="border-b border-r bg-muted/20 px-3 py-2 sticky left-0">
                <div className="flex items-center gap-1">
                  <Input
                    placeholder="+ Height"
                    value={newRowLabel}
                    onChange={(e) => setNewRowLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddRow();
                    }}
                    className="h-7 text-xs w-24"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => void handleAddRow()}
                    disabled={!newRowLabel.trim() || addingRow}
                  >
                    {addingRow ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </td>
              {columns.map((col) => (
                <td key={col.id} className="border-b border-r bg-muted/10" />
              ))}
              <td className="border-b bg-muted/10" />
            </tr>
          </tbody>
        </table>

        {/* Empty state */}
        {rows.length === 0 && columns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <p className="font-medium">Empty grid</p>
            <p className="text-sm mt-1">
              Add height rows and width columns above to build your pricing table.
            </p>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Drag rows/columns to reorder. Prices are saved automatically.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ColumnHeader({
  col,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onLabelChange,
  onDelete,
}: {
  col: PricingColumn;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onLabelChange: (label: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(col.label);

  function handleBlur() {
    setEditing(false);
    if (value.trim() && value.trim() !== col.label) {
      onLabelChange(value.trim());
    } else {
      setValue(col.label);
    }
  }

  return (
    <th
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`group border-b border-r bg-muted/40 px-2 py-1.5 text-center text-xs font-semibold min-w-[90px] cursor-grab active:cursor-grabbing transition-colors ${
        isDragOver ? 'bg-primary/10 outline outline-2 outline-primary/30' : ''
      }`}
    >
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-1 w-full justify-center">
          <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0" />
          {editing ? (
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleBlur();
                if (e.key === 'Escape') { setEditing(false); setValue(col.label); }
              }}
              className="w-full text-center text-xs border rounded px-1 py-0 outline-none bg-background"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="hover:text-primary transition-colors truncate max-w-[80px]"
              title={col.label}
            >
              {col.label}
            </button>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity"
          aria-label="Delete column"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </th>
  );
}

function RowHeader({
  row,
  onLabelChange,
  onDelete,
}: {
  row: PricingRow;
  onLabelChange: (label: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.label);

  function handleBlur() {
    setEditing(false);
    if (value.trim() && value.trim() !== row.label) {
      onLabelChange(value.trim());
    } else {
      setValue(row.label);
    }
  }

  return (
    <td className="group border-b border-r bg-muted/40 px-3 py-1.5 sticky left-0 z-10">
      <div className="flex items-center gap-1.5">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 cursor-grab" />
        {editing ? (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleBlur();
              if (e.key === 'Escape') { setEditing(false); setValue(row.label); }
            }}
            className="flex-1 text-xs border rounded px-1 py-0 outline-none bg-background"
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="flex-1 text-left text-xs font-medium hover:text-primary transition-colors truncate"
            title={row.label}
          >
            {row.label}
          </button>
        )}
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity shrink-0"
          aria-label="Delete row"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </td>
  );
}

function PriceCellInput({
  value,
  onChange,
  isSaved,
}: {
  value: string;
  onChange: (v: string) => void;
  isSaved: boolean;
}) {
  const [localValue, setLocalValue] = useState(value);
  const [focused, setFocused] = useState(false);

  // Keep in sync when external value changes (e.g. on initial load)
  useEffect(() => {
    if (!focused) setLocalValue(value);
  }, [value, focused]);

  return (
    <div className="relative flex items-center">
      <input
        type="text"
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          onChange(e.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="—"
        className="w-full px-2 py-1.5 text-right text-xs bg-transparent outline-none focus:bg-primary/5 hover:bg-muted/30 transition-colors placeholder:text-muted-foreground/40"
      />
      {isSaved && (
        <Check className="absolute right-1 h-3 w-3 text-emerald-500 pointer-events-none" />
      )}
    </div>
  );
}
