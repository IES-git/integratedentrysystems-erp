import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdderTableEditor } from './AdderTableEditor';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  GripVertical,
  GripHorizontal,
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
  SlidersHorizontal,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type {
  PricingTable,
  PricingColumn,
  PricingRow,
  DimensionCriteria,
  ColumnCriteria,
} from '@/types';
import {
  getPricingTableFull,
  updatePricingTable,
  addPricingColumn,
  updatePricingColumn,
  deletePricingColumn,
  reorderPricingColumns,
  addPricingRow,
  updatePricingRow,
  deletePricingRow,
  reorderPricingRows,
  upsertPricingCell,
} from '@/lib/pricing-api';
import { useToast } from '@/hooks/use-toast';
import { VendorMultiSelect, type VendorChip } from './VendorMultiSelect';
import { CriteriaPopover } from './CriteriaPopover';
import { describeDimensionCriteria, describeDimensionCriteriaWith, formatDimensionHyphen } from './dimension-utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WIDTH_COL_W = 145;
const HEIGHT_COL_W = 100;
const STANDARD_SIZES_W = WIDTH_COL_W + HEIGHT_COL_W;
const COL_W = 130;
const ADD_BTN_W = 44;
const HEADER_H = 64;
const ROW_H = 36; // fixed row height so CSS Grid row-span math works

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cellKey(rowId: string, colId: string): string {
  return `${rowId}:${colId}`;
}

function parseDimensionCriteria(raw: unknown): DimensionCriteria | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return r.type ? (r as unknown as DimensionCriteria) : null;
}

// ---------------------------------------------------------------------------
// Height group computation
// ---------------------------------------------------------------------------

interface HeightGroup {
  heightCriteria: DimensionCriteria | null;
  /** String key used to detect same-height groups. Ungrouped rows get unique keys. */
  heightKey: string;
  rows: PricingRow[];
  /** Index into the `rows` array where this group starts. */
  startIndex: number;
}

function computeHeightGroups(sortedRows: PricingRow[]): HeightGroup[] {
  const groups: HeightGroup[] = [];

  for (let i = 0; i < sortedRows.length; i++) {
    const row = sortedRows[i];
    const crit = parseDimensionCriteria(row.heightCriteria);
    // Ungrouped rows get a unique key so they never merge with each other.
    const key = crit ? describeDimensionCriteria(crit) : `__solo_${row.id}`;

    const last = groups[groups.length - 1];
    if (crit && last?.heightCriteria && last.heightKey === key) {
      last.rows.push(row);
    } else {
      groups.push({ heightCriteria: crit, heightKey: key, rows: [row], startIndex: i });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// ColumnCriteriaPopover
// ---------------------------------------------------------------------------

interface ColumnCriteriaPopoverProps {
  value: ColumnCriteria;
  onChange: (v: ColumnCriteria) => void;
  disabled?: boolean;
}

interface KVPair { key: string; value: string; }

function criteriaToKVPairs(c: ColumnCriteria): KVPair[] {
  return Object.entries(c).map(([key, val]) => ({
    key,
    value: typeof val === 'string' ? val : val.values.join(', '),
  }));
}

function kvPairsToCriteria(pairs: KVPair[]): ColumnCriteria {
  const result: ColumnCriteria = {};
  for (const { key, value } of pairs) {
    const trimKey = key.trim();
    const trimVal = value.trim();
    if (trimKey && trimVal) result[trimKey] = trimVal;
  }
  return result;
}

function ColumnCriteriaPopover({ value, onChange, disabled }: ColumnCriteriaPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pairs, setPairs] = useState<KVPair[]>([]);

  useEffect(() => {
    if (open) {
      const p = criteriaToKVPairs(value);
      setPairs(p.length > 0 ? p : [{ key: '', value: '' }]);
    }
  }, [open, value]);

  const hasCriteria = Object.keys(value).length > 0;

  function handleApply() { onChange(kvPairsToCriteria(pairs)); setOpen(false); }
  function handleClear() { onChange({}); setOpen(false); }
  function updatePair(idx: number, field: keyof KVPair, val: string) {
    setPairs((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p)));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost" size="icon"
          className={cn('h-5 w-5 shrink-0', hasCriteria && 'text-primary')}
          disabled={disabled}
          title={hasCriteria ? `Criteria set` : 'Set column criteria'}
        >
          <SlidersHorizontal className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">Column Criteria</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="px-4 py-3 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Set field key/value criteria this column applies to (e.g. gauge = 18 Gauge).
          </p>
          {pairs.map((pair, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <Input placeholder="field key" value={pair.key} onChange={(e) => updatePair(i, 'key', e.target.value)} className="h-7 text-xs flex-1" />
              <span className="text-muted-foreground text-xs">=</span>
              <Input placeholder="value" value={pair.value} onChange={(e) => updatePair(i, 'value', e.target.value)} className="h-7 text-xs flex-1" />
              <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0" onClick={() => setPairs((prev) => prev.filter((_, j) => j !== i))}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground gap-1" onClick={() => setPairs((prev) => [...prev, { key: '', value: '' }])}>
            <Plus className="h-3 w-3" />Add criterion
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={handleClear}>Clear</Button>
          <Button size="sm" onClick={handleApply}>Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// SortableColumnHeader
// ---------------------------------------------------------------------------

interface SortableColumnHeaderProps {
  col: PricingColumn;
  isEditing: boolean;
  draft: string;
  savingCriteria: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDraftChange: (v: string) => void;
  onCriteriaChange: (c: ColumnCriteria) => void;
  onDelete: () => void;
}

function SortableColumnHeader({ col, isEditing, draft, savingCriteria, onStartEdit, onCancelEdit, onSaveEdit, onDraftChange, onCriteriaChange, onDelete }: SortableColumnHeaderProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.id });

  const style: React.CSSProperties = {
    width: COL_W,
    height: HEADER_H,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative flex flex-col items-center justify-center border-r border-b border-border bg-muted/50 px-2 py-2 text-center select-none">
      <span {...attributes} {...listeners} className="absolute top-1 left-1/2 -translate-x-1/2 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" title="Drag to reorder">
        <GripHorizontal className="h-3 w-3" />
      </span>
      {isEditing ? (
        <div className="flex flex-col items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
          <Input value={draft} onChange={(e) => onDraftChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit(); }} className="h-6 text-xs text-center px-1 w-full" autoFocus />
          <div className="flex gap-0.5">
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onSaveEdit}><Check className="h-3 w-3" /></Button>
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onCancelEdit}><X className="h-3 w-3" /></Button>
          </div>
        </div>
      ) : (
        <>
          <span className="text-xs font-medium truncate w-full text-center cursor-text" onClick={onStartEdit} title={col.label}>{col.label}</span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onStartEdit} title="Rename"><Pencil className="h-2.5 w-2.5" /></Button>
            {savingCriteria ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : <ColumnCriteriaPopover value={col.criteria} onChange={onCriteriaChange} />}
            <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive hover:text-destructive" onClick={onDelete} title="Delete"><Trash2 className="h-2.5 w-2.5" /></Button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PriceCell
// ---------------------------------------------------------------------------

interface PriceCellProps {
  rowId: string;
  colId: string;
  initialPrice: number | null;
  onSave: (rowId: string, colId: string, price: number | null) => Promise<void>;
}

function PriceCell({ rowId, colId, initialPrice, onSave }: PriceCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialPrice !== null ? String(initialPrice) : '');
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editing) setDraft(initialPrice !== null ? String(initialPrice) : '');
  }, [initialPrice, editing]);

  async function commit(val: string) {
    const trimmed = val.trim();
    const parsed = trimmed === '' ? null : parseFloat(trimmed);
    if (isNaN(parsed as number) && parsed !== null) return;
    if (parsed === initialPrice) return;
    setSaving(true);
    try { await onSave(rowId, colId, parsed); } finally { setSaving(false); }
  }

  function handleBlur() {
    setEditing(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void commit(draft);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') { setEditing(false); setDraft(initialPrice !== null ? String(initialPrice) : ''); }
  }

  const displayValue = initialPrice !== null ? `$${Number(initialPrice).toFixed(2)}` : '';

  return (
    <div className={cn('flex items-center justify-center border-r border-b border-border px-1 text-sm tabular-nums', saving && 'opacity-60')} style={{ width: COL_W, height: ROW_H }}>
      {editing ? (
        <Input type="number" step="0.01" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={handleBlur} onKeyDown={handleKeyDown} className="h-7 text-xs text-center border-0 shadow-none focus-visible:ring-1 p-1 w-full" autoFocus />
      ) : (
        <button onClick={() => setEditing(true)} className={cn('w-full h-full flex items-center justify-center text-xs transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary', displayValue ? 'text-foreground' : 'text-muted-foreground/30')} title="Click to edit price">
          {saving ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : displayValue || '—'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HeightGroupCell — spans N grid rows
// ---------------------------------------------------------------------------

interface HeightGroupCellProps {
  group: HeightGroup;
  rowsTotal: number;
  /** Live span count during resize (may differ from group.rows.length). */
  previewSpan: number;
  isResizing: boolean;
  onResizeStart: (startY: number) => void;
  onResizeMove: (currentY: number) => void;
  onResizeEnd: () => void;
  onCriteriaChange: (c: DimensionCriteria | null) => void;
  onDelete: () => void;
}

function HeightGroupCell({
  group,
  rowsTotal,
  previewSpan,
  isResizing,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onCriteriaChange,
  onDelete,
}: HeightGroupCellProps) {
  const span = isResizing ? previewSpan : group.rows.length;
  const heightText = group.heightCriteria ? describeDimensionCriteria(group.heightCriteria) : null;
  const canResize = rowsTotal > 1;

  const [heightEditing, setHeightEditing] = useState(false);
  const [heightDraft, setHeightDraft] = useState('');

  function startHeightEdit() {
    setHeightDraft(heightText ?? '');
    setHeightEditing(true);
  }

  function commitHeightEdit() {
    setHeightEditing(false);
    const trimmed = heightDraft.trim();
    const newCriteria = trimmed ? ({ type: 'raw', label: trimmed } as const) : null;
    onCriteriaChange(newCriteria);
  }

  function cancelHeightEdit() {
    setHeightEditing(false);
    setHeightDraft('');
  }

  return (
    <div
      className="group/hg relative border-r border-b border-border bg-muted/20 flex flex-col"
      style={{
        gridColumn: 2,
        gridRow: `${group.startIndex + 1} / span ${span}`,
        willChange: isResizing ? 'grid-row' : 'auto',
      }}
    >
      {/* Height criteria — vertically centered with buttons stacked below */}
      <div className="flex-1 flex flex-col items-center justify-center px-1.5 overflow-hidden gap-0.5">
        {/* Height value / inline edit */}
        {heightEditing ? (
          <div className="w-full" onClick={(e) => e.stopPropagation()}>
            <Input
              value={heightDraft}
              onChange={(e) => setHeightDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitHeightEdit();
                if (e.key === 'Escape') cancelHeightEdit();
              }}
              onBlur={commitHeightEdit}
              className="h-6 text-xs px-1 w-full text-center"
              autoFocus
            />
          </div>
        ) : (
          <>
            <span
              className={cn(
                'w-full text-xs text-center truncate cursor-text group-hover/hg:hidden',
                !heightText && 'text-muted-foreground/40 italic',
              )}
              title={heightText ?? undefined}
              onClick={startHeightEdit}
            >
              {heightText ?? '—'}
            </span>
            <Input
              defaultValue={heightText ?? ''}
              key={heightText ?? ''}
              onFocus={(e) => {
                setHeightDraft(e.currentTarget.value);
                setHeightEditing(true);
              }}
              className="hidden group-hover/hg:block h-6 text-xs px-1 w-full text-center"
              placeholder={`e.g. 6'8"`}
            />
          </>
        )}

        {/* Action buttons — stacked below the text on hover */}
        {!heightEditing && (
          <div className="opacity-0 group-hover/hg:opacity-100 transition-opacity flex items-center gap-0.5">
            <CriteriaPopover
              value={group.heightCriteria}
              onChange={onCriteriaChange}
              label="Height"
              formatHint={`e.g. 6'8"`}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 text-destructive hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete height group"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Resize handle */}
      {canResize && (
        <div
          className={cn(
            'shrink-0 flex items-center justify-center h-3 cursor-ns-resize select-none transition-colors',
            isResizing ? 'bg-primary/25' : 'hover:bg-primary/10',
          )}
          title="Drag to expand or shrink height group"
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            onResizeStart(e.clientY);
          }}
          onPointerMove={(e) => {
            if (!isResizing) return;
            onResizeMove(e.clientY);
          }}
          onPointerUp={(e) => {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            onResizeEnd();
          }}
          onPointerCancel={(e) => {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            onResizeEnd();
          }}
        >
          {/* Grip dots */}
          <div className="flex gap-0.5 opacity-0 group-hover/hg:opacity-60 transition-opacity">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-3 h-0.5 rounded-full bg-muted-foreground" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortableGridRowCells — renders a row as multiple CSS Grid cells
// ---------------------------------------------------------------------------

interface SortableGridRowCellsProps {
  row: PricingRow;
  rowIdx: number;
  columns: PricingColumn[];
  cellMap: Map<string, number | null>;
  onCellSave: (rowId: string, colId: string, price: number | null) => Promise<void>;
  onWidthCriteriaChange: (c: DimensionCriteria | null) => void;
  onDelete: () => void;
}

function SortableGridRowCells({
  row,
  rowIdx,
  columns,
  cellMap,
  onCellSave,
  onWidthCriteriaChange,
  onDelete,
}: SortableGridRowCellsProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });

  const widthCriteria = parseDimensionCriteria(row.widthCriteria);
  const widthText = widthCriteria ? describeDimensionCriteriaWith(widthCriteria, formatDimensionHyphen) : null;

  const t: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.75 : 1,
  };

  const gridRow = rowIdx + 1;

  return (
    <>
      {/* Width cell — carries the DnD ref and drag handle */}
      <div
        ref={setNodeRef}
        className="group/wc flex items-center border-r border-b border-border bg-muted/20 px-1.5"
        style={{ ...t, gridColumn: 1, gridRow, height: ROW_H }}
      >
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground opacity-0 group-hover/wc:opacity-100 transition-opacity mr-1 shrink-0"
          title="Drag to reorder"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>

        <span
          className={cn('flex-1 min-w-0 text-xs truncate', !widthText && 'text-muted-foreground/40 italic')}
          title={widthText ?? undefined}
        >
          {widthText ?? '—'}
        </span>

        <div className="opacity-0 group-hover/wc:opacity-100 transition-opacity shrink-0 flex items-center gap-0.5">
          <CriteriaPopover
            value={widthCriteria}
            onChange={onWidthCriteriaChange}
            label="Width"
            plainNumbers
          />
          <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive hover:text-destructive" onClick={onDelete} title="Delete row">
            <Trash2 className="h-2.5 w-2.5" />
          </Button>
        </div>
      </div>

      {/* Price cells */}
      {columns.map((col, colIdx) => (
        <div key={col.id} style={{ ...t, gridColumn: 3 + colIdx, gridRow }}>
          <PriceCell
            rowId={row.id}
            colId={col.id}
            initialPrice={cellMap.get(cellKey(row.id, col.id)) ?? null}
            onSave={onCellSave}
          />
        </div>
      ))}

      {/* Spacer (add-col button column) */}
      <div
        className="border-b border-border"
        style={{ ...t, gridColumn: 3 + columns.length, gridRow, height: ROW_H }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// PricingTableEditor — main component
// ---------------------------------------------------------------------------

interface PricingTableEditorProps {
  /** The ID of the pricing table to load. */
  tableId: string;
  seriesValue: string;
  /** When true, the page-level back button and outer heading are hidden (used inside multi-table tab view). */
  embedded?: boolean;
  /** Called when vendors on this table change — lets the parent keep the tab label in sync. */
  onVendorSync?: (vendors: { id: string; name: string }[]) => void;
  /** Called when the user requests to delete this table (only shown in embedded mode). */
  onDelete?: () => void;
  onBack?: () => void;
}

export function PricingTableEditor({ tableId, seriesValue, embedded = false, onVendorSync, onDelete, onBack }: PricingTableEditorProps) {
  const { toast } = useToast();

  const [table, setTable] = useState<PricingTable | null>(null);
  const [vendors, setVendors] = useState<VendorChip[]>([]);
  const [columns, setColumns] = useState<PricingColumn[]>([]);
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [cellMap, setCellMap] = useState<Map<string, number | null>>(new Map());
  const [loading, setLoading] = useState(true);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');

  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [colDraft, setColDraft] = useState('');
  const [savingCriteriaColId, setSavingCriteriaColId] = useState<string | null>(null);

  const [deleteColId, setDeleteColId] = useState<string | null>(null);
  const [deleteRowId, setDeleteRowId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [addingCol, setAddingCol] = useState(false);
  const [newColLabel, setNewColLabel] = useState('');

  // Resize state
  const [resizingGroupIdx, setResizingGroupIdx] = useState<number | null>(null);
  const [resizeStartY, setResizeStartY] = useState(0);
  const [resizeOriginalCount, setResizeOriginalCount] = useState(0);
  const [resizePreviewCount, setResizePreviewCount] = useState(0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const heightGroups = useMemo(() => computeHeightGroups(rows), [rows]);

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const full = await getPricingTableFull(tableId);
      setTable(full.table);
      setNameDraft(full.table.name);
      setDescDraft(full.table.description ?? '');
      setVendors(full.vendors);
      setColumns(full.columns);
      setRows(full.rows);

      const map = new Map<string, number | null>();
      for (const cell of full.cells) {
        map.set(cellKey(cell.pricingRowId, cell.pricingColumnId), cell.price);
      }
      setCellMap(map);
    } catch {
      toast({ title: 'Error', description: 'Failed to load pricing table', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [tableId, toast]);

  useEffect(() => { void load(); }, [load]);

  // ---------------------------------------------------------------------------
  // Table name / description
  // ---------------------------------------------------------------------------

  async function handleSaveName() {
    if (!table || !nameDraft.trim() || nameDraft === table.name) { setEditingName(false); return; }
    try {
      const updated = await updatePricingTable(table.id, { name: nameDraft.trim() });
      setTable(updated);
    } catch {
      toast({ title: 'Error', description: 'Failed to save name', variant: 'destructive' });
      setNameDraft(table.name);
    }
    setEditingName(false);
  }

  async function handleSaveDesc() {
    if (!table) { setEditingDesc(false); return; }
    const desc = descDraft.trim() || null;
    if (desc === table.description) { setEditingDesc(false); return; }
    try {
      const updated = await updatePricingTable(table.id, { description: desc ?? undefined });
      setTable(updated);
    } catch {
      toast({ title: 'Error', description: 'Failed to save description', variant: 'destructive' });
      setDescDraft(table.description ?? '');
    }
    setEditingDesc(false);
  }

  // ---------------------------------------------------------------------------
  // Column actions
  // ---------------------------------------------------------------------------

  async function handleSaveColLabel() {
    if (!editingColId) return;
    const col = columns.find((c) => c.id === editingColId);
    if (!col || !colDraft.trim() || colDraft === col.label) { setEditingColId(null); return; }
    try {
      const updated = await updatePricingColumn(editingColId, { label: colDraft.trim() });
      setColumns((prev) => prev.map((c) => (c.id === editingColId ? updated : c)));
    } catch {
      toast({ title: 'Error', description: 'Failed to rename column', variant: 'destructive' });
    }
    setEditingColId(null);
  }

  async function handleColCriteriaChange(colId: string, criteria: ColumnCriteria) {
    setColumns((prev) => prev.map((c) => (c.id === colId ? { ...c, criteria } : c)));
    setSavingCriteriaColId(colId);
    try {
      const updated = await updatePricingColumn(colId, { criteria });
      setColumns((prev) => prev.map((c) => (c.id === colId ? updated : c)));
    } catch {
      toast({ title: 'Error', description: 'Failed to save criteria', variant: 'destructive' });
      void load();
    } finally {
      setSavingCriteriaColId(null);
    }
  }

  async function handleAddCol() {
    if (!table || !newColLabel.trim()) return;
    setAddingCol(false);
    setNewColLabel('');
    try {
      const col = await addPricingColumn(table.id, newColLabel.trim());
      setColumns((prev) => [...prev, col]);
    } catch {
      toast({ title: 'Error', description: 'Failed to add column', variant: 'destructive' });
    }
  }

  async function handleDeleteCol() {
    if (!deleteColId) return;
    setDeleting(true);
    try {
      await deletePricingColumn(deleteColId);
      setColumns((prev) => prev.filter((c) => c.id !== deleteColId));
      setCellMap((prev) => {
        const next = new Map(prev);
        for (const key of next.keys()) { if (key.endsWith(`:${deleteColId}`)) next.delete(key); }
        return next;
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete column', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteColId(null);
    }
  }

  async function handleColumnDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !table) return;
    const oldIndex = columns.findIndex((c) => c.id === active.id);
    const newIndex = columns.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(columns, oldIndex, newIndex);
    setColumns(reordered);
    try { await reorderPricingColumns(table.id, reordered.map((c) => c.id)); } catch {
      toast({ title: 'Error', description: 'Failed to reorder columns', variant: 'destructive' });
      void load();
    }
  }

  // ---------------------------------------------------------------------------
  // Row actions
  // ---------------------------------------------------------------------------

  async function handleRowWidthCriteriaChange(rowId: string, criteria: DimensionCriteria | null) {
    const crit = criteria ?? ({} as Record<string, never>);
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, widthCriteria: crit } : r)));
    try {
      const updated = await updatePricingRow(rowId, { widthCriteria: crit });
      setRows((prev) => prev.map((r) => (r.id === rowId ? updated : r)));
    } catch {
      toast({ title: 'Error', description: 'Failed to save width criteria', variant: 'destructive' });
      void load();
    }
  }

  /**
   * Update the height criteria for every row in a height group at once.
   * This keeps the group intact with a new (or cleared) height value.
   */
  async function handleGroupHeightChange(group: HeightGroup, criteria: DimensionCriteria | null) {
    const crit = criteria ?? ({} as Record<string, never>);
    // Optimistic
    setRows((prev) => prev.map((r) => (group.rows.find((gr) => gr.id === r.id) ? { ...r, heightCriteria: crit } : r)));
    try {
      const updates = await Promise.all(group.rows.map((r) => updatePricingRow(r.id, { heightCriteria: crit })));
      setRows((prev) => {
        const next = [...prev];
        for (const u of updates) {
          const idx = next.findIndex((r) => r.id === u.id);
          if (idx >= 0) next[idx] = u;
        }
        return next;
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to save height criteria', variant: 'destructive' });
      void load();
    }
  }

  async function handleDeleteHeightGroup(group: HeightGroup) {
    const ids = group.rows.map((r) => r.id);
    setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
    setCellMap((prev) => {
      const next = new Map(prev);
      for (const key of next.keys()) {
        if (ids.some((id) => key.startsWith(`${id}:`))) next.delete(key);
      }
      return next;
    });
    try {
      await Promise.all(ids.map((id) => deletePricingRow(id)));
    } catch {
      toast({ title: 'Error', description: 'Failed to delete height group', variant: 'destructive' });
      void load();
    }
  }

  async function handleAddRow() {
    if (!table) return;
    try {
      const row = await addPricingRow(table.id, '');
      setRows((prev) => [...prev, row]);
    } catch {
      toast({ title: 'Error', description: 'Failed to add row', variant: 'destructive' });
    }
  }

  async function handleDeleteRow() {
    if (!deleteRowId) return;
    setDeleting(true);
    try {
      await deletePricingRow(deleteRowId);
      setRows((prev) => prev.filter((r) => r.id !== deleteRowId));
      setCellMap((prev) => {
        const next = new Map(prev);
        for (const key of next.keys()) { if (key.startsWith(`${deleteRowId}:`)) next.delete(key); }
        return next;
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to delete row', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteRowId(null);
    }
  }

  async function handleRowDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !table) return;
    const oldIndex = rows.findIndex((r) => r.id === active.id);
    const newIndex = rows.findIndex((r) => r.id === over.id);
    const reordered = arrayMove(rows, oldIndex, newIndex);
    setRows(reordered);
    try { await reorderPricingRows(table.id, reordered.map((r) => r.id)); } catch {
      toast({ title: 'Error', description: 'Failed to reorder rows', variant: 'destructive' });
      void load();
    }
  }

  // ---------------------------------------------------------------------------
  // Height resize
  // ---------------------------------------------------------------------------

  function handleResizeStart(groupIdx: number, startY: number) {
    const group = heightGroups[groupIdx];
    setResizingGroupIdx(groupIdx);
    setResizeStartY(startY);
    setResizeOriginalCount(group.rows.length);
    setResizePreviewCount(group.rows.length);
  }

  function handleResizeMove(groupIdx: number, currentY: number) {
    if (resizingGroupIdx !== groupIdx) return;
    const group = heightGroups[groupIdx];
    const deltaRows = Math.round((currentY - resizeStartY) / ROW_H);
    const maxRows = rows.length - group.startIndex;
    const newCount = Math.max(1, Math.min(maxRows, resizeOriginalCount + deltaRows));
    setResizePreviewCount(newCount);
  }

  async function handleResizeEnd(groupIdx: number) {
    if (resizingGroupIdx !== groupIdx) return;

    const group = heightGroups[groupIdx];
    const targetCount = resizePreviewCount;
    const currentCount = group.rows.length;

    setResizingGroupIdx(null);
    if (targetCount === currentCount) return;

    try {
      if (targetCount > currentCount) {
        // Expand: copy height criteria into the next N rows
        const toUpdate = rows.slice(group.startIndex + currentCount, group.startIndex + targetCount);
        const crit = group.heightCriteria ?? ({} as Record<string, never>);
        const updates = await Promise.all(toUpdate.map((r) => updatePricingRow(r.id, { heightCriteria: crit })));
        setRows((prev) => {
          const next = [...prev];
          for (const u of updates) {
            const idx = next.findIndex((r) => r.id === u.id);
            if (idx >= 0) next[idx] = u;
          }
          return next;
        });
      } else {
        // Shrink: clear height criteria from rows that leave the group
        const toUpdate = group.rows.slice(targetCount);
        const updates = await Promise.all(toUpdate.map((r) => updatePricingRow(r.id, { heightCriteria: {} })));
        setRows((prev) => {
          const next = [...prev];
          for (const u of updates) {
            const idx = next.findIndex((r) => r.id === u.id);
            if (idx >= 0) next[idx] = u;
          }
          return next;
        });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to resize height group', variant: 'destructive' });
      void load();
    }
  }

  // ---------------------------------------------------------------------------
  // Cell save
  // ---------------------------------------------------------------------------

  async function handleCellSave(rowId: string, colId: string, price: number | null) {
    const key = cellKey(rowId, colId);
    const prev = cellMap.get(key) ?? null;
    setCellMap((m) => new Map(m).set(key, price));
    try {
      await upsertPricingCell(rowId, colId, price);
    } catch {
      setCellMap((m) => new Map(m).set(key, prev));
      toast({ title: 'Error', description: 'Failed to save price', variant: 'destructive' });
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-80" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!table) return null;

  const minWidth = STANDARD_SIZES_W + columns.length * COL_W + ADD_BTN_W;
  // Grid template: Width | Height | ...PriceCols | AddBtn
  const gridTemplateColumns = `${WIDTH_COL_W}px ${HEIGHT_COL_W}px ${columns.map(() => `${COL_W}px`).join(' ')} ${ADD_BTN_W}px`;

  return (
    <div className="flex flex-col gap-5 min-h-full">
      {/* Page header */}
      <div className="flex items-start gap-3">
        {!embedded && (
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 mt-1 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          {/* Table name */}
          {editingName ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveName(); if (e.key === 'Escape') { setEditingName(false); setNameDraft(table.name); } }}
                className="h-8 text-lg font-bold w-72" autoFocus />
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void handleSaveName()}><Check className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingName(false); setNameDraft(table.name); }}><X className="h-3.5 w-3.5" /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group/name">
              {!embedded && <h1 className="text-2xl font-bold tracking-tight">{table.name}</h1>}
              {!embedded && <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover/name:opacity-100 transition-opacity" onClick={() => setEditingName(true)} title="Rename table"><Pencil className="h-3 w-3" /></Button>}
            </div>
          )}

          {/* Description */}
          {editingDesc ? (
            <div className="flex items-start gap-2">
              <Textarea value={descDraft} onChange={(e) => setDescDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setEditingDesc(false); setDescDraft(table.description ?? ''); } }}
                className="text-sm min-h-[60px] w-72 resize-none" placeholder="Add a description…" autoFocus />
              <div className="flex flex-col gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void handleSaveDesc()}><Check className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingDesc(false); setDescDraft(table.description ?? ''); }}><X className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEditingDesc(true)} className="group/desc flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground text-left transition-colors">
              {table.description ? <span>{table.description}</span> : <span className="italic">Add a description…</span>}
              <Pencil className="h-3 w-3 opacity-0 group-hover/desc:opacity-100 transition-opacity shrink-0" />
            </button>
          )}

          {/* Manufacturers */}
          <div className="mt-2">
            <Label className="text-xs text-muted-foreground mb-1 block">Manufacturers</Label>
            <VendorMultiSelect
              tableId={table.id}
              vendors={vendors}
              onVendorsChange={(v) => { setVendors(v); onVendorSync?.(v); }}
            />
          </div>
        </div>

        {/* Delete button (embedded mode only) */}
        {embedded && onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1.5 mt-1"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete table
          </Button>
        )}
      </div>

      {/* Base / Adders tabs */}
      <Tabs defaultValue="base">
        <TabsList className="mb-4">
          <TabsTrigger value="base">Base Pricing</TabsTrigger>
          <TabsTrigger value="adders">Adders</TabsTrigger>
        </TabsList>

        <TabsContent value="adders">
          <AdderTableEditor tableId={table.id} seriesValue={seriesValue} vendors={vendors} />
        </TabsContent>

        <TabsContent value="base">

      {/* Grid */}
      <div className="rounded-xl border overflow-auto">
        <div style={{ minWidth }}>

          {/* ---------------------------------------------------------------- */}
          {/* Column header row (flex, outside CSS Grid body)                  */}
          {/* ---------------------------------------------------------------- */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
            <SortableContext items={columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex" style={{ height: HEADER_H }}>
                {/* Standard Sizes group header */}
                <div className="flex flex-col border-r border-b border-border bg-muted/70 select-none shrink-0" style={{ width: STANDARD_SIZES_W }}>
                  <div className="flex items-center justify-center border-b border-border/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider" style={{ height: HEADER_H - 28 }}>
                    Standard Sizes
                  </div>
                  <div className="flex" style={{ height: 28 }}>
                    <div className="flex items-center justify-center border-r border-border/50 text-[10px] font-medium text-muted-foreground" style={{ width: WIDTH_COL_W }}>Width</div>
                    <div className="flex items-center justify-center text-[10px] font-medium text-muted-foreground" style={{ width: HEIGHT_COL_W }}>Height</div>
                  </div>
                </div>

                {/* Sortable column headers */}
                {columns.map((col) => (
                  <SortableColumnHeader
                    key={col.id}
                    col={col}
                    isEditing={editingColId === col.id}
                    draft={colDraft}
                    savingCriteria={savingCriteriaColId === col.id}
                    onStartEdit={() => { setEditingColId(col.id); setColDraft(col.label); }}
                    onCancelEdit={() => setEditingColId(null)}
                    onSaveEdit={() => void handleSaveColLabel()}
                    onDraftChange={setColDraft}
                    onCriteriaChange={(c) => void handleColCriteriaChange(col.id, c)}
                    onDelete={() => setDeleteColId(col.id)}
                  />
                ))}

                {/* Add column */}
                <div className="flex items-center justify-center border-b border-border bg-muted/50 shrink-0" style={{ width: ADD_BTN_W, height: HEADER_H }}>
                  <Popover open={addingCol} onOpenChange={(o) => { setAddingCol(o); if (!o) setNewColLabel(''); }}>
                    <PopoverTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Add column"><Plus className="h-4 w-4" /></Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-3" align="end">
                      <div className="flex flex-col gap-2">
                        <Label className="text-xs">Column label</Label>
                        <Input value={newColLabel} onChange={(e) => setNewColLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void handleAddCol(); if (e.key === 'Escape') { setAddingCol(false); setNewColLabel(''); } }} placeholder="e.g. 18 Gauge / CRS" className="h-7 text-xs" autoFocus />
                        <div className="flex gap-1">
                          <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => void handleAddCol()}>Add</Button>
                          <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={() => { setAddingCol(false); setNewColLabel(''); }}>Cancel</Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </SortableContext>
          </DndContext>

          {/* ---------------------------------------------------------------- */}
          {/* Body: CSS Grid with true rowspan for height cells                 */}
          {/* ---------------------------------------------------------------- */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns,
              gridAutoRows: `${ROW_H}px`,
            }}
          >
            {/* Height group cells — rendered first so they sit behind row cells */}
            {heightGroups.map((group, groupIdx) => (
              <HeightGroupCell
                key={`hg-${group.startIndex}-${group.heightKey}`}
                group={group}
                rowsTotal={rows.length}
                previewSpan={resizingGroupIdx === groupIdx ? resizePreviewCount : group.rows.length}
                isResizing={resizingGroupIdx === groupIdx}
                onResizeStart={(startY) => handleResizeStart(groupIdx, startY)}
                onResizeMove={(currentY) => handleResizeMove(groupIdx, currentY)}
                onResizeEnd={() => void handleResizeEnd(groupIdx)}
                onCriteriaChange={(c) => void handleGroupHeightChange(group, c)}
                onDelete={() => void handleDeleteHeightGroup(group)}
              />
            ))}

            {/* Empty state — spans all columns at row 1 when there are no rows */}
            {rows.length === 0 && (
              <div
                className="flex items-center justify-center py-10 text-sm text-muted-foreground border-b border-border"
                style={{ gridColumn: '1 / -1', gridRow: 1 }}
              >
                {columns.length > 0 ? 'No rows yet — click "Add row" below.' : 'Add columns above and rows below to start.'}
              </div>
            )}

            {/* Sortable row data cells (Width + Price + Spacer) */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRowDragEnd}>
              <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                {rows.map((row, rowIdx) => (
                  <SortableGridRowCells
                    key={row.id}
                    row={row}
                    rowIdx={rowIdx}
                    columns={columns}
                    cellMap={cellMap}
                    onCellSave={handleCellSave}
                    onWidthCriteriaChange={(c) => void handleRowWidthCriteriaChange(row.id, c)}
                    onDelete={() => setDeleteRowId(row.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>

            {/* Add row footer */}
            <div
              className="flex items-center px-2 border-b border-border"
              style={{ gridColumn: 1, gridRow: rows.length + 1, height: ROW_H }}
            >
              <Button size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground gap-1" onClick={() => void handleAddRow()}>
                <Plus className="h-3 w-3" />
                Add row
              </Button>
            </div>
            {/* Footer: height col spacer */}
            <div
              className="border-b border-r border-border"
              style={{ gridColumn: 2, gridRow: rows.length + 1, height: ROW_H }}
            />
            {/* Footer: price col spacers */}
            {columns.map((_, colIdx) => (
              <div
                key={colIdx}
                className="border-b border-r border-border"
                style={{ gridColumn: 3 + colIdx, gridRow: rows.length + 1, height: ROW_H }}
              />
            ))}
            {/* Footer: add-col spacer */}
            <div
              className="border-b border-border"
              style={{ gridColumn: 3 + columns.length, gridRow: rows.length + 1, height: ROW_H }}
            />
          </div>
        </div>
      </div>

        </TabsContent>
      </Tabs>

      {/* Delete column dialog */}
      <AlertDialog open={deleteColId !== null} onOpenChange={(o) => { if (!o) setDeleteColId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete column?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{columns.find((c) => c.id === deleteColId)?.label}</strong> and all its prices. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleting} onClick={() => void handleDeleteCol()}>
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete row dialog */}
      <AlertDialog open={deleteRowId !== null} onOpenChange={(o) => { if (!o) setDeleteRowId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete row?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this size row and all its prices. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleting} onClick={() => void handleDeleteRow()}>
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
