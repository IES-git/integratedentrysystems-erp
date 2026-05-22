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
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
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
const COL_W = 120;
const ADD_DEPTH_BTN_W = 28;
const ADD_BTN_W = 44;
const GAUGE_HEADER_H = 36;
const DEPTH_HEADER_H = 36;
const HEADER_H = GAUGE_HEADER_H + DEPTH_HEADER_H;
const ROW_H = 36;

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
// Column grouping
// ---------------------------------------------------------------------------

interface ColumnGroup {
  /** The parent (gauge) column. */
  parent: PricingColumn;
  /** Child (depth) columns under this gauge. */
  children: PricingColumn[];
}

function buildColumnGroups(columns: PricingColumn[]): ColumnGroup[] {
  const parents = columns
    .filter((c) => c.parentColumnId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return parents.map((parent) => ({
    parent,
    children: columns
      .filter((c) => c.parentColumnId === parent.id)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}

/** Flat list of all leaf (depth) columns in display order. */
function getLeafColumns(groups: ColumnGroup[]): PricingColumn[] {
  return groups.flatMap((g) => g.children);
}

// ---------------------------------------------------------------------------
// Height group computation (same as PricingTableEditor)
// ---------------------------------------------------------------------------

interface HeightGroup {
  heightCriteria: DimensionCriteria | null;
  heightKey: string;
  rows: PricingRow[];
  startIndex: number;
}

function computeHeightGroups(sortedRows: PricingRow[]): HeightGroup[] {
  const groups: HeightGroup[] = [];
  for (let i = 0; i < sortedRows.length; i++) {
    const row = sortedRows[i];
    const crit = parseDimensionCriteria(row.heightCriteria);
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

  function handleBlur() { setEditing(false); void commit(draft); }
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
// HeightGroupCell (same as PricingTableEditor)
// ---------------------------------------------------------------------------

interface HeightGroupCellProps {
  group: HeightGroup;
  rowsTotal: number;
  previewSpan: number;
  isResizing: boolean;
  onResizeStart: (startY: number) => void;
  onResizeMove: (currentY: number) => void;
  onResizeEnd: () => void;
  onCriteriaChange: (c: DimensionCriteria | null) => void;
  onDelete: () => void;
}

function HeightGroupCell({ group, rowsTotal, previewSpan, isResizing, onResizeStart, onResizeMove, onResizeEnd, onCriteriaChange, onDelete }: HeightGroupCellProps) {
  const span = isResizing ? previewSpan : group.rows.length;
  const heightText = group.heightCriteria ? describeDimensionCriteria(group.heightCriteria) : null;
  const canResize = rowsTotal > 1;
  const [heightEditing, setHeightEditing] = useState(false);
  const [heightDraft, setHeightDraft] = useState('');

  function startHeightEdit() { setHeightDraft(heightText ?? ''); setHeightEditing(true); }
  function commitHeightEdit() {
    setHeightEditing(false);
    const trimmed = heightDraft.trim();
    onCriteriaChange(trimmed ? ({ type: 'raw', label: trimmed } as const) : null);
  }
  function cancelHeightEdit() { setHeightEditing(false); setHeightDraft(''); }

  return (
    <div
      className="group/hg relative border-r border-b border-border bg-muted/20 flex flex-col"
      style={{ gridColumn: 2, gridRow: `${group.startIndex + 1} / span ${span}`, willChange: isResizing ? 'grid-row' : 'auto' }}
    >
      <div className="flex-1 flex flex-col items-center justify-center px-1.5 overflow-hidden gap-0.5">
        {heightEditing ? (
          <div className="w-full" onClick={(e) => e.stopPropagation()}>
            <Input value={heightDraft} onChange={(e) => setHeightDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commitHeightEdit(); if (e.key === 'Escape') cancelHeightEdit(); }} onBlur={commitHeightEdit} className="h-6 text-xs px-1 w-full text-center" autoFocus />
          </div>
        ) : (
          <>
            <span className={cn('w-full text-xs text-center truncate cursor-text group-hover/hg:hidden', !heightText && 'text-muted-foreground/40 italic')} title={heightText ?? undefined} onClick={startHeightEdit}>{heightText ?? '—'}</span>
            <Input defaultValue={heightText ?? ''} key={heightText ?? ''} onFocus={(e) => { setHeightDraft(e.currentTarget.value); setHeightEditing(true); }} className="hidden group-hover/hg:block h-6 text-xs px-1 w-full text-center" placeholder={`e.g. 6'8"`} />
          </>
        )}
        {!heightEditing && (
          <div className="opacity-0 group-hover/hg:opacity-100 transition-opacity flex items-center gap-0.5">
            <CriteriaPopover value={group.heightCriteria} onChange={onCriteriaChange} label="Height" formatHint={`e.g. 6'8"`} />
            <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete height group">
              <Trash2 className="h-2.5 w-2.5" />
            </Button>
          </div>
        )}
      </div>
      {canResize && (
        <div
          className={cn('shrink-0 flex items-center justify-center h-3 cursor-ns-resize select-none transition-colors', isResizing ? 'bg-primary/25' : 'hover:bg-primary/10')}
          title="Drag to expand or shrink height group"
          onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onResizeStart(e.clientY); }}
          onPointerMove={(e) => { if (!isResizing) return; onResizeMove(e.clientY); }}
          onPointerUp={(e) => { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); onResizeEnd(); }}
          onPointerCancel={(e) => { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); onResizeEnd(); }}
        >
          <div className="flex gap-0.5 opacity-0 group-hover/hg:opacity-60 transition-opacity">
            {[0, 1, 2].map((i) => <div key={i} className="w-3 h-0.5 rounded-full bg-muted-foreground" />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortableGridRowCells
// ---------------------------------------------------------------------------

interface SortableGridRowCellsProps {
  row: PricingRow;
  rowIdx: number;
  leafColumns: PricingColumn[];
  cellMap: Map<string, number | null>;
  onCellSave: (rowId: string, colId: string, price: number | null) => Promise<void>;
  onWidthCriteriaChange: (c: DimensionCriteria | null) => void;
  onDelete: () => void;
}

function SortableGridRowCells({ row, rowIdx, leafColumns, cellMap, onCellSave, onWidthCriteriaChange, onDelete }: SortableGridRowCellsProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const widthCriteria = parseDimensionCriteria(row.widthCriteria);
  const widthText = widthCriteria ? describeDimensionCriteriaWith(widthCriteria, formatDimensionHyphen) : null;

  const t: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined, opacity: isDragging ? 0.75 : 1 };
  const gridRow = rowIdx + 1;

  return (
    <>
      <div ref={setNodeRef} className="group/wc flex items-center border-r border-b border-border bg-muted/20 px-1.5" style={{ ...t, gridColumn: 1, gridRow, height: ROW_H }}>
        <span {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground opacity-0 group-hover/wc:opacity-100 transition-opacity mr-1 shrink-0" title="Drag to reorder"><GripVertical className="h-3.5 w-3.5" /></span>
        <span className={cn('flex-1 min-w-0 text-xs truncate', !widthText && 'text-muted-foreground/40 italic')} title={widthText ?? undefined}>{widthText ?? '—'}</span>
        <div className="opacity-0 group-hover/wc:opacity-100 transition-opacity shrink-0 flex items-center gap-0.5">
          <CriteriaPopover value={widthCriteria} onChange={onWidthCriteriaChange} label="Width" plainNumbers />
          <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive hover:text-destructive" onClick={onDelete} title="Delete row"><Trash2 className="h-2.5 w-2.5" /></Button>
        </div>
      </div>
      {leafColumns.map((col, colIdx) => (
        <div key={col.id} style={{ ...t, gridColumn: 3 + colIdx, gridRow }}>
          <PriceCell rowId={row.id} colId={col.id} initialPrice={cellMap.get(cellKey(row.id, col.id)) ?? null} onSave={onCellSave} />
        </div>
      ))}
      <div className="border-b border-border" style={{ ...t, gridColumn: 3 + leafColumns.length, gridRow, height: ROW_H }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// GaugeGroupHeader — one cell in the top header row
// ---------------------------------------------------------------------------

interface GaugeGroupHeaderProps {
  group: ColumnGroup;
  onRenameParent: (col: PricingColumn) => void;
  onDeleteGauge: (col: PricingColumn) => void;
  onAddDepth: (parentId: string) => void;
}

function GaugeGroupHeader({ group, onRenameParent, onDeleteGauge, onAddDepth }: GaugeGroupHeaderProps) {
  const colSpan = Math.max(1, group.children.length);
  // When gauge has depths, we reserve ADD_DEPTH_BTN_W px at the right for the always-visible "+" button
  const hasChildren = group.children.length > 0;
  const width = colSpan * COL_W + (hasChildren ? ADD_DEPTH_BTN_W : 0);

  return (
    <div
      className="group/gauge relative flex items-center border-r border-b border-border bg-muted/60 select-none shrink-0"
      style={{ width, height: GAUGE_HEADER_H }}
    >
      {/* Label + hover rename/delete actions */}
      <div className="flex-1 min-w-0 flex items-center justify-center gap-1 px-2 overflow-hidden">
        <span
          className="text-xs font-semibold uppercase tracking-wide truncate cursor-pointer hover:text-primary"
          onClick={() => onRenameParent(group.parent)}
          title={group.parent.label}
        >
          {group.parent.label}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover/gauge:opacity-100 transition-opacity shrink-0">
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => onRenameParent(group.parent)} title="Rename gauge"><Pencil className="h-2.5 w-2.5" /></Button>
          <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive hover:text-destructive" onClick={() => onDeleteGauge(group.parent)} title="Delete gauge and all depths"><Trash2 className="h-2.5 w-2.5" /></Button>
        </div>
      </div>

      {/* Always-visible "add depth" button — shown to the right when gauge has children */}
      {hasChildren && (
        <button
          className="flex items-center justify-center border-l border-border/60 hover:bg-primary/10 transition-colors shrink-0 h-full text-muted-foreground hover:text-primary"
          style={{ width: ADD_DEPTH_BTN_W }}
          onClick={() => onAddDepth(group.parent.id)}
          title={`Add depth to ${group.parent.label}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DepthColumnHeader — one cell in the bottom header row (the actual price col)
// ---------------------------------------------------------------------------

interface DepthColumnHeaderProps {
  col: PricingColumn;
  onRename: (col: PricingColumn) => void;
  onDelete: (col: PricingColumn) => void;
}

function DepthColumnHeader({ col, onRename, onDelete }: DepthColumnHeaderProps) {
  return (
    <div
      className="group/depth relative flex flex-col items-center justify-center border-r border-b border-border bg-muted/30 px-2 select-none shrink-0"
      style={{ width: COL_W, height: DEPTH_HEADER_H }}
    >
      <span className="text-xs font-medium truncate w-full text-center cursor-pointer" onClick={() => onRename(col)} title={col.label}>{col.label}</span>
      <div className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 opacity-0 group-hover/depth:opacity-100 transition-opacity">
        <Button size="icon" variant="ghost" className="h-4 w-4" onClick={() => onRename(col)} title="Rename depth"><Pencil className="h-2 w-2" /></Button>
        <Button size="icon" variant="ghost" className="h-4 w-4 text-destructive hover:text-destructive" onClick={() => onDelete(col)} title="Delete depth"><Trash2 className="h-2 w-2" /></Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineRenameDialog — lightweight inline rename popover
// ---------------------------------------------------------------------------

interface InlineRenameProps {
  open: boolean;
  initialValue: string;
  label: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}

function InlineRename({ open, initialValue, label, onSave, onCancel }: InlineRenameProps) {
  const [draft, setDraft] = useState(initialValue);
  useEffect(() => { if (open) setDraft(initialValue); }, [open, initialValue]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={onCancel}>
      <div className="bg-background rounded-xl border shadow-lg p-4 w-72 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <Label className="text-sm font-medium">{label}</Label>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSave(draft); if (e.key === 'Escape') onCancel(); }} autoFocus className="h-8 text-sm" />
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(draft)}>Save</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FramePricingTableEditor
// ---------------------------------------------------------------------------

interface FramePricingTableEditorProps {
  tableId: string;
  seriesValue: string;
  embedded?: boolean;
  onVendorSync?: (vendors: { id: string; name: string }[]) => void;
  onDelete?: () => void;
  onBack?: () => void;
}

export function FramePricingTableEditor({ tableId, seriesValue, embedded = false, onVendorSync, onDelete, onBack }: FramePricingTableEditorProps) {
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

  // Rename state — shared for both gauge and depth columns
  const [renamingCol, setRenamingCol] = useState<PricingColumn | null>(null);
  const [renameLabel, setRenameLabel] = useState('');

  // Delete confirmation
  const [deleteColId, setDeleteColId] = useState<string | null>(null);
  const [deleteColLabel, setDeleteColLabel] = useState('');
  const [deleteColIsGauge, setDeleteColIsGauge] = useState(false);
  const [deleteRowId, setDeleteRowId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // "Add gauge" popover
  const [addingGauge, setAddingGauge] = useState(false);
  const [newGaugeLabel, setNewGaugeLabel] = useState('');

  // "Add depth" popover — keyed by parentId
  const [addingDepthParentId, setAddingDepthParentId] = useState<string | null>(null);
  const [newDepthLabel, setNewDepthLabel] = useState('');

  // Resize state
  const [resizingGroupIdx, setResizingGroupIdx] = useState<number | null>(null);
  const [resizeStartY, setResizeStartY] = useState(0);
  const [resizeOriginalCount, setResizeOriginalCount] = useState(0);
  const [resizePreviewCount, setResizePreviewCount] = useState(0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const columnGroups = useMemo(() => buildColumnGroups(columns), [columns]);
  const leafColumns = useMemo(() => getLeafColumns(columnGroups), [columnGroups]);
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

  function startRename(col: PricingColumn) {
    setRenamingCol(col);
    setRenameLabel(col.label);
  }

  async function handleSaveRename(value: string) {
    if (!renamingCol) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === renamingCol.label) { setRenamingCol(null); return; }
    try {
      const updated = await updatePricingColumn(renamingCol.id, { label: trimmed });
      setColumns((prev) => prev.map((c) => (c.id === renamingCol.id ? updated : c)));
    } catch {
      toast({ title: 'Error', description: 'Failed to rename column', variant: 'destructive' });
    }
    setRenamingCol(null);
  }

  async function handleAddGauge() {
    if (!table || !newGaugeLabel.trim()) return;
    setAddingGauge(false);
    const label = newGaugeLabel.trim();
    setNewGaugeLabel('');
    try {
      const col = await addPricingColumn(table.id, label, {}, null);
      setColumns((prev) => [...prev, col]);
    } catch {
      toast({ title: 'Error', description: 'Failed to add gauge', variant: 'destructive' });
    }
  }

  async function handleAddDepth() {
    if (!table || !addingDepthParentId || !newDepthLabel.trim()) return;
    const parentId = addingDepthParentId;
    const label = newDepthLabel.trim();
    setAddingDepthParentId(null);
    setNewDepthLabel('');
    try {
      const col = await addPricingColumn(table.id, label, {}, parentId);
      setColumns((prev) => [...prev, col]);
    } catch {
      toast({ title: 'Error', description: 'Failed to add depth column', variant: 'destructive' });
    }
  }

  function confirmDeleteGauge(col: PricingColumn) {
    setDeleteColId(col.id);
    setDeleteColLabel(col.label);
    setDeleteColIsGauge(true);
  }

  function confirmDeleteDepth(col: PricingColumn) {
    setDeleteColId(col.id);
    setDeleteColLabel(col.label);
    setDeleteColIsGauge(false);
  }

  async function handleDeleteCol() {
    if (!deleteColId) return;
    setDeleting(true);
    try {
      await deletePricingColumn(deleteColId);
      // Remove the column and all its children (children cascade from DB, but we update local state too)
      setColumns((prev) => prev.filter((c) => c.id !== deleteColId && c.parentColumnId !== deleteColId));
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

  async function handleReorderGaugeGroups(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !table) return;
    // Reorder parent columns only
    const parents = columnGroups.map((g) => g.parent);
    const oldIndex = parents.findIndex((c) => c.id === active.id);
    const newIndex = parents.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(parents, oldIndex, newIndex);
    // Rebuild columns: new order of parents, children stay attached
    const childMap = new Map<string, PricingColumn[]>();
    for (const col of columns) {
      if (col.parentColumnId) {
        if (!childMap.has(col.parentColumnId)) childMap.set(col.parentColumnId, []);
        childMap.get(col.parentColumnId)!.push(col);
      }
    }
    const newColumns: PricingColumn[] = [];
    for (const p of reordered) {
      newColumns.push(p);
      newColumns.push(...(childMap.get(p.id) ?? []));
    }
    setColumns(newColumns);
    try { await reorderPricingColumns(table.id, newColumns.map((c) => c.id)); } catch {
      toast({ title: 'Error', description: 'Failed to reorder gauges', variant: 'destructive' });
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

  async function handleGroupHeightChange(group: HeightGroup, criteria: DimensionCriteria | null) {
    const crit = criteria ?? ({} as Record<string, never>);
    setRows((prev) => prev.map((r) => (group.rows.find((gr) => gr.id === r.id) ? { ...r, heightCriteria: crit } : r)));
    try {
      const updates = await Promise.all(group.rows.map((r) => updatePricingRow(r.id, { heightCriteria: crit })));
      setRows((prev) => { const next = [...prev]; for (const u of updates) { const idx = next.findIndex((r) => r.id === u.id); if (idx >= 0) next[idx] = u; } return next; });
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
      for (const key of next.keys()) { if (ids.some((id) => key.startsWith(`${id}:`))) next.delete(key); }
      return next;
    });
    try { await Promise.all(ids.map((id) => deletePricingRow(id))); } catch {
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
      setCellMap((prev) => { const next = new Map(prev); for (const key of next.keys()) { if (key.startsWith(`${deleteRowId}:`)) next.delete(key); } return next; });
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
    setResizePreviewCount(Math.max(1, Math.min(maxRows, resizeOriginalCount + deltaRows)));
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
        const toUpdate = rows.slice(group.startIndex + currentCount, group.startIndex + targetCount);
        const crit = group.heightCriteria ?? ({} as Record<string, never>);
        const updates = await Promise.all(toUpdate.map((r) => updatePricingRow(r.id, { heightCriteria: crit })));
        setRows((prev) => { const next = [...prev]; for (const u of updates) { const idx = next.findIndex((r) => r.id === u.id); if (idx >= 0) next[idx] = u; } return next; });
      } else {
        const toUpdate = group.rows.slice(targetCount);
        const updates = await Promise.all(toUpdate.map((r) => updatePricingRow(r.id, { heightCriteria: {} })));
        setRows((prev) => { const next = [...prev]; for (const u of updates) { const idx = next.findIndex((r) => r.id === u.id); if (idx >= 0) next[idx] = u; } return next; });
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
    try { await upsertPricingCell(rowId, colId, price); } catch {
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

  const gaugesWithChildren = columnGroups.filter((g) => g.children.length > 0).length;
  const minWidth = STANDARD_SIZES_W + leafColumns.length * COL_W + gaugesWithChildren * ADD_DEPTH_BTN_W + ADD_BTN_W;
  const gridTemplateColumns = `${WIDTH_COL_W}px ${HEIGHT_COL_W}px ${leafColumns.map(() => `${COL_W}px`).join(' ')} ${ADD_BTN_W}px`;

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
          {editingName ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveName(); if (e.key === 'Escape') { setEditingName(false); setNameDraft(table.name); } }} className="h-8 text-lg font-bold w-72" autoFocus />
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void handleSaveName()}><Check className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingName(false); setNameDraft(table.name); }}><X className="h-3.5 w-3.5" /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group/name">
              {!embedded && <h1 className="text-2xl font-bold tracking-tight">{table.name}</h1>}
              {!embedded && <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover/name:opacity-100 transition-opacity" onClick={() => setEditingName(true)} title="Rename table"><Pencil className="h-3 w-3" /></Button>}
            </div>
          )}
          {editingDesc ? (
            <div className="flex items-start gap-2">
              <Textarea value={descDraft} onChange={(e) => setDescDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setEditingDesc(false); setDescDraft(table.description ?? ''); } }} className="text-sm min-h-[60px] w-72 resize-none" placeholder="Add a description…" autoFocus />
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
          <div className="mt-2">
            <Label className="text-xs text-muted-foreground mb-1 block">Manufacturers</Label>
            <VendorMultiSelect tableId={table.id} vendors={vendors} onVendorsChange={(v) => { setVendors(v); onVendorSync?.(v); }} />
          </div>
        </div>
        {embedded && onDelete && (
          <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1.5 mt-1" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />Delete table
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

              {/* ------------------------------------------------------------ */}
              {/* Two-row column header                                          */}
              {/* ------------------------------------------------------------ */}

              {/* Row 1: Standard Sizes + Gauge groups + Add gauge */}
              <div className="flex" style={{ height: GAUGE_HEADER_H }}>
                {/* Standard Sizes (spans 2 rows via rowspan simulation — use border-b-0 and let row2 close it) */}
                <div
                  className="flex items-center justify-center border-r border-border bg-muted/70 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0 select-none"
                  style={{ width: STANDARD_SIZES_W, height: GAUGE_HEADER_H }}
                >
                  Standard Sizes
                </div>

                {/* Gauge group headers */}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorderGaugeGroups}>
                  <SortableContext items={columnGroups.map((g) => g.parent.id)} strategy={horizontalListSortingStrategy}>
                    {columnGroups.map((group) => (
                      <GaugeGroupHeader
                        key={group.parent.id}
                        group={group}
                        onRenameParent={startRename}
                        onDeleteGauge={confirmDeleteGauge}
                        onAddDepth={(parentId) => { setAddingDepthParentId(parentId); setNewDepthLabel(''); }}
                      />
                    ))}
                  </SortableContext>
                </DndContext>

                {/* Add gauge button */}
                <div className="flex items-center justify-center border-b border-border bg-muted/50 shrink-0" style={{ width: ADD_BTN_W, height: GAUGE_HEADER_H }}>
                  <Popover open={addingGauge} onOpenChange={(o) => { setAddingGauge(o); if (!o) setNewGaugeLabel(''); }}>
                    <PopoverTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Add gauge group"><Plus className="h-4 w-4" /></Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-3" align="end">
                      <div className="flex flex-col gap-2">
                        <Label className="text-xs">Gauge label</Label>
                        <Input value={newGaugeLabel} onChange={(e) => setNewGaugeLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void handleAddGauge(); if (e.key === 'Escape') { setAddingGauge(false); setNewGaugeLabel(''); } }} placeholder="e.g. 18 Gauge" className="h-7 text-xs" autoFocus />
                        <div className="flex gap-1">
                          <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => void handleAddGauge()}>Add</Button>
                          <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={() => { setAddingGauge(false); setNewGaugeLabel(''); }}>Cancel</Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Row 2: Width/Height sub-headers + Depth column headers */}
              <div className="flex" style={{ height: DEPTH_HEADER_H }}>
                {/* Width sub-header */}
                <div className="flex items-center justify-center border-r border-b border-border bg-muted/60 text-[10px] font-medium text-muted-foreground shrink-0 select-none" style={{ width: WIDTH_COL_W }}>Width</div>
                {/* Height sub-header */}
                <div className="flex items-center justify-center border-r border-b border-border bg-muted/60 text-[10px] font-medium text-muted-foreground shrink-0 select-none" style={{ width: HEIGHT_COL_W }}>Height</div>

                {/* Depth sub-column headers per gauge group */}
                {columnGroups.map((group) => (
                  <div key={group.parent.id} className="flex">
                    {group.children.length === 0 ? (
                      /* Gauge with no depths yet — show placeholder + add button */
                      <div className="flex items-center justify-center border-r border-b border-border bg-muted/20 shrink-0" style={{ width: COL_W, height: DEPTH_HEADER_H }}>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground gap-1" onClick={() => { setAddingDepthParentId(group.parent.id); setNewDepthLabel(''); }}>
                          <Plus className="h-3 w-3" />Add depth
                        </Button>
                      </div>
                    ) : (
                      <>
                        {group.children.map((child) => (
                          <DepthColumnHeader key={child.id} col={child} onRename={startRename} onDelete={confirmDeleteDepth} />
                        ))}
                        {/* Spacer matching the ADD_DEPTH_BTN_W in the gauge header row above */}
                        <div
                          className="flex items-center justify-center border-r border-b border-border bg-muted/10 shrink-0"
                          style={{ width: ADD_DEPTH_BTN_W, height: DEPTH_HEADER_H }}
                        />
                      </>
                    )}
                  </div>
                ))}

                {/* Spacer for add-gauge button column */}
                <div className="border-b border-border shrink-0" style={{ width: ADD_BTN_W, height: DEPTH_HEADER_H }} />
              </div>

              {/* ------------------------------------------------------------ */}
              {/* Body: CSS Grid                                                 */}
              {/* ------------------------------------------------------------ */}
              <div style={{ display: 'grid', gridTemplateColumns, gridAutoRows: `${ROW_H}px` }}>
                {/* Height group cells */}
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

                {rows.length === 0 && (
                  <div className="flex items-center justify-center py-10 text-sm text-muted-foreground border-b border-border" style={{ gridColumn: '1 / -1', gridRow: 1 }}>
                    {leafColumns.length > 0 ? 'No rows yet — click "Add row" below.' : 'Add gauge groups and depth columns above, then add rows below.'}
                  </div>
                )}

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRowDragEnd}>
                  <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                    {rows.map((row, rowIdx) => (
                      <SortableGridRowCells
                        key={row.id}
                        row={row}
                        rowIdx={rowIdx}
                        leafColumns={leafColumns}
                        cellMap={cellMap}
                        onCellSave={handleCellSave}
                        onWidthCriteriaChange={(c) => void handleRowWidthCriteriaChange(row.id, c)}
                        onDelete={() => setDeleteRowId(row.id)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>

                {/* Footer row */}
                <div className="flex items-center px-2 border-b border-border" style={{ gridColumn: 1, gridRow: rows.length + 1, height: ROW_H }}>
                  <Button size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground gap-1" onClick={() => void handleAddRow()}>
                    <Plus className="h-3 w-3" />Add row
                  </Button>
                </div>
                <div className="border-b border-r border-border" style={{ gridColumn: 2, gridRow: rows.length + 1, height: ROW_H }} />
                {leafColumns.map((_, colIdx) => (
                  <div key={colIdx} className="border-b border-r border-border" style={{ gridColumn: 3 + colIdx, gridRow: rows.length + 1, height: ROW_H }} />
                ))}
                <div className="border-b border-border" style={{ gridColumn: 3 + leafColumns.length, gridRow: rows.length + 1, height: ROW_H }} />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Add depth popover (shown as modal-like popover when triggered from gauge header) */}
      {addingDepthParentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => { setAddingDepthParentId(null); setNewDepthLabel(''); }}>
          <div className="bg-background rounded-xl border shadow-lg p-4 w-64 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <Label className="text-sm font-medium">
              Add depth to: <span className="text-primary">{columnGroups.find((g) => g.parent.id === addingDepthParentId)?.parent.label}</span>
            </Label>
            <Input value={newDepthLabel} onChange={(e) => setNewDepthLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void handleAddDepth(); if (e.key === 'Escape') { setAddingDepthParentId(null); setNewDepthLabel(''); } }} placeholder={`e.g. 4 3/4"`} className="h-8 text-sm" autoFocus />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => { setAddingDepthParentId(null); setNewDepthLabel(''); }}>Cancel</Button>
              <Button size="sm" onClick={() => void handleAddDepth()} disabled={!newDepthLabel.trim()}>Add</Button>
            </div>
          </div>
        </div>
      )}

      {/* Inline rename dialog */}
      <InlineRename
        open={renamingCol !== null}
        initialValue={renameLabel}
        label={renamingCol?.parentColumnId === null ? 'Rename gauge group' : 'Rename depth column'}
        onSave={(v) => void handleSaveRename(v)}
        onCancel={() => setRenamingCol(null)}
      />

      {/* Delete column dialog */}
      <AlertDialog open={deleteColId !== null} onOpenChange={(o) => { if (!o) setDeleteColId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteColIsGauge ? 'gauge group' : 'depth column'}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteColIsGauge
                ? <>This will permanently delete <strong>{deleteColLabel}</strong> and all its depth columns and prices.</>
                : <>This will permanently delete the depth column <strong>{deleteColLabel}</strong> and all its prices.</>}
              {' '}This cannot be undone.
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
            <AlertDialogDescription>This will permanently delete this size row and all its prices. This cannot be undone.</AlertDialogDescription>
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
