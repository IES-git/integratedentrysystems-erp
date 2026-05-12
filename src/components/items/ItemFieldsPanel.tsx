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
import { Loader2, Plus, GripVertical, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { ItemFieldView, ItemFieldsView, FieldDefinition } from '@/types';
import {
  getItemFieldsView,
  addItemField,
  removeItemField,
  reorderItemFields,
  BIG_FIVE_KEYS,
} from '@/lib/item-fields-api';
import { getFieldDefinitions } from '@/lib/estimates-api';
import { FieldOptionsPanel } from './FieldOptionsPanel';

const BIG_FIVE_SET = new Set<string>(BIG_FIVE_KEYS);

// ---------------------------------------------------------------------------
// Sortable base-field row (grip handle only — no delete for base fields)
// ---------------------------------------------------------------------------

interface SortableBaseFieldRowProps {
  field: ItemFieldView;
  canonicalCode: string;
}

function SortableBaseFieldRow({ field, canonicalCode }: SortableBaseFieldRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.definition.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  const effectiveLabelOverride =
    field.effectiveLabel !== field.definition.fieldLabel ? field.effectiveLabel : undefined;

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
          field={field.definition}
          dataSource={{ canonicalCode }}
          isAdder={field.isAdder}
          isBigFive={BIG_FIVE_SET.has(field.definition.fieldKey)}
          overrideLabel={effectiveLabelOverride}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable other-field row
// ---------------------------------------------------------------------------

interface SortableFieldRowProps {
  field: ItemFieldView;
  canonicalCode: string;
  onDelete: () => void;
}

function SortableFieldRow({ field, canonicalCode, onDelete }: SortableFieldRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.definition.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  const effectiveLabelOverride =
    field.effectiveLabel !== field.definition.fieldLabel ? field.effectiveLabel : undefined;

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
          key={field.definition.id}
          field={field.definition}
          dataSource={{ canonicalCode }}
          isAdder={field.isAdder}
          isBigFive={false}
          overrideLabel={effectiveLabelOverride}
          onDeleteField={onDelete}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface ItemFieldsPanelProps {
  canonicalCode: string;
}

export function ItemFieldsPanel({ canonicalCode }: ItemFieldsPanelProps) {
  const { toast } = useToast();

  const [view, setView] = useState<ItemFieldsView | null>(null);
  const [loading, setLoading] = useState(true);

  // Add-field dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [allFieldDefs, setAllFieldDefs] = useState<FieldDefinition[]>([]);
  const [fieldDefsLoading, setFieldDefsLoading] = useState(false);
  const [selectedFieldDefId, setSelectedFieldDefId] = useState('');
  const [addingField, setAddingField] = useState(false);

  // Delete/hide field confirmation
  const [deleteTarget, setDeleteTarget] = useState<ItemFieldView | null>(null);
  const [deletingField, setDeletingField] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const loadView = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getItemFieldsView(canonicalCode);
      setView(data);
    } catch {
      toast({ title: 'Error', description: 'Failed to load field configuration', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [canonicalCode, toast]);

  useEffect(() => {
    void loadView();
  }, [loadView]);

  // ── Base field drag-to-reorder ─────────────────────────────────────────────
  async function handleBaseFieldDragEnd(event: DragEndEvent) {
    if (!view) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = view.baseFields.findIndex((f) => f.definition.id === active.id);
    const newIndex = view.baseFields.findIndex((f) => f.definition.id === over.id);
    const reordered = arrayMove(view.baseFields, oldIndex, newIndex);
    setView({ ...view, baseFields: reordered });

    try {
      await reorderItemFields(canonicalCode, reordered.map((f) => f.definition.id));
    } catch {
      toast({ title: 'Error', description: 'Failed to save field order', variant: 'destructive' });
      void loadView();
    }
  }

  // ── Field drag-to-reorder ──────────────────────────────────────────────────
  async function handleFieldDragEnd(event: DragEndEvent) {
    if (!view) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = view.otherFields.findIndex((f) => f.definition.id === active.id);
    const newIndex = view.otherFields.findIndex((f) => f.definition.id === over.id);
    const reordered = arrayMove(view.otherFields, oldIndex, newIndex);
    setView({ ...view, otherFields: reordered });

    try {
      await reorderItemFields(canonicalCode, reordered.map((f) => f.definition.id));
    } catch {
      toast({ title: 'Error', description: 'Failed to save field order', variant: 'destructive' });
      void loadView();
    }
  }

  // ── Add field ──────────────────────────────────────────────────────────────
  async function openAddField() {
    setAddDialogOpen(true);
    setSelectedFieldDefId('');
    if (allFieldDefs.length === 0) {
      setFieldDefsLoading(true);
      try {
        const defs = await getFieldDefinitions();
        setAllFieldDefs(defs);
      } catch {
        toast({ title: 'Error', description: 'Failed to load field definitions', variant: 'destructive' });
      } finally {
        setFieldDefsLoading(false);
      }
    }
  }

  async function handleAddField() {
    if (!selectedFieldDefId) return;
    setAddingField(true);
    try {
      await addItemField(canonicalCode, selectedFieldDefId);
      setAddDialogOpen(false);
      toast({ title: 'Field added' });
      void loadView();
    } catch {
      toast({ title: 'Error', description: 'Failed to add field', variant: 'destructive' });
    } finally {
      setAddingField(false);
    }
  }

  // ── Remove / hide field ────────────────────────────────────────────────────
  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeletingField(true);
    try {
      await removeItemField(canonicalCode, deleteTarget.definition.id, deleteTarget.isAddedLocally);
      setDeleteTarget(null);
      toast({ title: deleteTarget.isAddedLocally ? 'Field removed' : 'Field hidden' });
      void loadView();
    } catch {
      toast({ title: 'Error', description: 'Failed to remove field', variant: 'destructive' });
    } finally {
      setDeletingField(false);
    }
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  if (!view) return null;

  // IDs already on this item — used to filter the "Add Field" picker
  const presentFieldIds = new Set([
    ...view.baseFields.map((f) => f.definition.id),
    ...view.otherFields.map((f) => f.definition.id),
  ]);

  return (
    <>
      <div className="p-4 flex flex-col gap-0">
        {/* ── Base Fields ─────────────────────────────────────────────────── */}
        <section className="mb-8">
          <div className="mb-3">
            <h2 className="text-base font-semibold">Base Fields</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Core structural fields. Drag to reorder, expand to manage options and aliases.
            </p>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleBaseFieldDragEnd}
          >
            <SortableContext
              items={view.baseFields.map((f) => f.definition.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-2">
                {view.baseFields.map((field) => (
                  <SortableBaseFieldRow
                    key={field.definition.id}
                    field={field}
                    canonicalCode={canonicalCode}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>

        {/* ── Other Fields ────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold">Other Fields</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Additional fields for this item. Drag to reorder, expand to manage options.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void openAddField()}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Field
            </Button>
          </div>

          {view.otherFields.length === 0 ? (
            <div className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
              No additional fields yet.{' '}
              <button
                className="underline underline-offset-2 hover:text-foreground transition-colors"
                onClick={() => void openAddField()}
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
                items={view.otherFields.map((f) => f.definition.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-2">
                  {view.otherFields.map((field) => (
                    <SortableFieldRow
                      key={field.definition.id}
                      field={field}
                      canonicalCode={canonicalCode}
                      onDelete={() => setDeleteTarget(field)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </section>
      </div>

      {/* ── Add Field Dialog ────────────────────────────────────────────────── */}
      <Dialog
        open={addDialogOpen}
        onOpenChange={(o) => {
          setAddDialogOpen(o);
          if (!o) setSelectedFieldDefId('');
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Field</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {fieldDefsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading fields…
              </div>
            ) : (
              <Select value={selectedFieldDefId} onValueChange={setSelectedFieldDefId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a field to add…" />
                </SelectTrigger>
                <SelectContent>
                  {allFieldDefs
                    .filter((def) => !presentFieldIds.has(def.id))
                    .map((def) => (
                      <SelectItem key={def.id} value={def.id}>
                        {def.fieldLabel}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={addingField}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAddField()}
              disabled={!selectedFieldDefId || addingField}
            >
              {addingField ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Field'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete / Hide Field Confirmation Dialog ──────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {deleteTarget?.isAddedLocally ? 'Remove Field' : 'Hide Field'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            {deleteTarget?.isAddedLocally ? (
              <>
                Remove <strong>{deleteTarget.effectiveLabel}</strong> from this item type?
              </>
            ) : (
              <>
                Hide <strong>{deleteTarget?.effectiveLabel}</strong> from this item type?{' '}
                The global field definition is preserved and can be un-hidden later.
              </>
            )}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deletingField}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleConfirmDelete()}
              disabled={deletingField}
            >
              {deletingField
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : deleteTarget?.isAddedLocally ? 'Remove' : 'Hide'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
