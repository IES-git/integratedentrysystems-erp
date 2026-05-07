import { useState, useEffect, useCallback } from 'react';
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
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Home, Loader2, Plus, GripVertical, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import type { FieldDefinition } from '@/types';
import {
  getFieldDefinitions,
  getDoorFieldDefinitions,
  deleteFieldDefinition,
  createOrApproveFieldDefinition,
  reorderFieldDefinitions,
} from '@/lib/estimates-api';
import { FieldOptionsPanel } from './FieldOptionsPanel';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BIG_FIVE_KEYS = ['series', 'gauge', 'opening_width', 'opening_height'] as const;
type BigFiveKey = (typeof BIG_FIVE_KEYS)[number];

const BIG_FIVE_LABELS: Record<BigFiveKey, string> = {
  series: 'Series',
  gauge: 'Gauge',
  opening_width: 'Width',
  opening_height: 'Height',
};

// ---------------------------------------------------------------------------
// Sortable "other field" row wrapper
// ---------------------------------------------------------------------------

interface SortableFieldRowProps {
  field: FieldDefinition;
  onDelete: () => void;
}

function SortableFieldRow({ field, onDelete }: SortableFieldRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2">
      <span
        {...attributes}
        {...listeners}
        className="mt-3.5 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground shrink-0"
        title="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <div className="flex-1 min-w-0">
        <FieldOptionsPanel
          key={field.id}
          field={field}
          onDeleteField={onDelete}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DoorsWizardProps {
  onBack: () => void;
}

export function DoorsWizard({ onBack }: DoorsWizardProps) {
  const { toast } = useToast();
  const [bigFiveDefs, setBigFiveDefs] = useState<Partial<Record<BigFiveKey, FieldDefinition>>>({});
  const [otherDefs, setOtherDefs] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-field dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [addingField, setAddingField] = useState(false);

  // Delete-field confirmation state
  const [deleteTarget, setDeleteTarget] = useState<FieldDefinition | null>(null);
  const [deletingField, setDeletingField] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const loadDefinitions = useCallback(async () => {
    setLoading(true);
    try {
      const [allDefs, otherDefsResult] = await Promise.all([
        getFieldDefinitions(),
        getDoorFieldDefinitions(),
      ]);

      const big5: Partial<Record<BigFiveKey, FieldDefinition>> = {};
      for (const def of allDefs) {
        if ((BIG_FIVE_KEYS as readonly string[]).includes(def.fieldKey)) {
          big5[def.fieldKey as BigFiveKey] = def;
        }
      }
      setBigFiveDefs(big5);

      const materialDef = allDefs.find((d) => d.fieldKey === 'material');
      const sortedOthers = [...otherDefsResult].sort((a, b) => a.sortOrder - b.sortOrder || a.fieldLabel.localeCompare(b.fieldLabel));
      setOtherDefs(materialDef ? [materialDef, ...sortedOthers.filter((d) => d.fieldKey !== 'material')] : sortedOthers);
    } catch {
      toast({ title: 'Error', description: 'Failed to load field definitions', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadDefinitions();
  }, [loadDefinitions]);

  // ── Other-field drag end ──────────────────────────────────────────────────
  async function handleFieldDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = otherDefs.findIndex((d) => d.id === active.id);
    const newIndex = otherDefs.findIndex((d) => d.id === over.id);
    const reordered = arrayMove(otherDefs, oldIndex, newIndex);
    setOtherDefs(reordered);

    try {
      await reorderFieldDefinitions(reordered.map((d) => d.id));
    } catch {
      toast({ title: 'Error', description: 'Failed to save field order', variant: 'destructive' });
      void loadDefinitions();
    }
  }

  // ── Add new field ─────────────────────────────────────────────────────────
  async function handleAddField() {
    const label = newFieldLabel.trim();
    if (!label) return;
    setAddingField(true);
    try {
      const fieldKey = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      const created = await createOrApproveFieldDefinition({ fieldKey, fieldLabel: label, valueType: 'string' });
      setOtherDefs((prev) => [...prev, created]);
      setNewFieldLabel('');
      setAddDialogOpen(false);
      toast({ title: 'Field added', description: `"${label}" is now available.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to add field', variant: 'destructive' });
    } finally {
      setAddingField(false);
    }
  }

  // ── Delete field ──────────────────────────────────────────────────────────
  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeletingField(true);
    try {
      await deleteFieldDefinition(deleteTarget.id);
      setOtherDefs((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      toast({ title: 'Field deleted', description: `"${deleteTarget.fieldLabel}" has been removed.` });
      setDeleteTarget(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to delete field', variant: 'destructive' });
    } finally {
      setDeletingField(false);
    }
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Loading field definitions…</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-0 min-h-full">
        {/* Breadcrumb */}
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={onBack}
          >
            <Home className="h-4 w-4" />
            Item Management
          </Button>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold text-sm">Doors</span>
        </div>

        {/* ── Base Fields ─────────────────────────────────────────────────── */}
        <section className="mb-8">
          <div className="mb-3">
            <h2 className="text-base font-semibold">Base Fields</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Core structural fields shared by all door items. Expand any field to manage its options.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {(BIG_FIVE_KEYS as readonly BigFiveKey[]).map((key) => {
              const def = bigFiveDefs[key];
              if (!def) {
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground flex items-center justify-between"
                  >
                    <span>
                      <strong>{BIG_FIVE_LABELS[key]}</strong> — no field definition found
                    </span>
                    <span className="text-xs">(create via Admin › Field Definitions)</span>
                  </div>
                );
              }
              return (
                <FieldOptionsPanel
                  key={def.id}
                  field={def}
                />
              );
            })}
          </div>
        </section>

        {/* ── Other Fields ────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold">Other Fields</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Additional door-specific fields. Drag to reorder, expand to manage options.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Field
            </Button>
          </div>

          {otherDefs.length === 0 ? (
            <div className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
              No additional fields yet.{' '}
              <button
                className="underline underline-offset-2 hover:text-foreground transition-colors"
                onClick={() => setAddDialogOpen(true)}
              >
                Add one
              </button>
              .
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleFieldDragEnd}
            >
              <SortableContext
                items={otherDefs.map((d) => d.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-2">
                  {otherDefs.map((field) => (
                    <SortableFieldRow
                      key={field.id}
                      field={field}
                      onDelete={() => setDeleteTarget(field)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </section>
      </div>

      {/* ── Add Field Dialog ───────────────────────────────────────────────── */}
      <Dialog open={addDialogOpen} onOpenChange={(o) => { setAddDialogOpen(o); if (!o) setNewFieldLabel(''); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add New Field</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="Field label (e.g. Fire Rating)"
              value={newFieldLabel}
              onChange={(e) => setNewFieldLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAddField(); }}
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-2">
              The field key will be auto-generated from the label.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={addingField}>
              Cancel
            </Button>
            <Button onClick={() => void handleAddField()} disabled={!newFieldLabel.trim() || addingField}>
              {addingField ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Field'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Field Confirmation Dialog ──────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Field
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            Permanently delete <strong>{deleteTarget?.fieldLabel}</strong> and all its options? This
            cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deletingField}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleConfirmDelete()}
              disabled={deletingField}
            >
              {deletingField ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
