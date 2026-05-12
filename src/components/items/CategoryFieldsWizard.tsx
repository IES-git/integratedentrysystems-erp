import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Home,
  Loader2,
  Plus,
  GripVertical,
  AlertTriangle,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import type { FieldDefinition, ItemTypeBaseField } from '@/types';
import {
  getFieldDefinitions,
  createOrApproveFieldDefinition,
} from '@/lib/estimates-api';
import {
  getItemTypeBaseFields,
  addItemTypeBaseField,
  removeItemTypeBaseField,
  reorderItemTypeBaseFields,
  setItemTypeBaseFieldPassValueToFrame,
} from '@/lib/item-fields-api';
import { FieldOptionsPanel } from './FieldOptionsPanel';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Big Five fields use sort_orders 0–9 to keep them pinned at the top.
// Other fields start at sort_order 100 to stay in their own range.
const OTHER_FIELDS_SORT_OFFSET = 100;

// ---------------------------------------------------------------------------
// Sortable "other field" row wrapper
// ---------------------------------------------------------------------------

interface SortableFieldRowProps {
  bf: ItemTypeBaseField;
  itemTypeSlug: string;
  itemTypeName: string;
  onRemove: () => void;
  passToFrame?: { value: boolean; onChange: (next: boolean) => Promise<void> };
}

function SortableFieldRow({ bf, itemTypeSlug, itemTypeName, onRemove, passToFrame }: SortableFieldRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: bf.fieldDefinitionId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  if (!bf.fieldDefinition) return null;

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
          field={bf.fieldDefinition}
          dataSource={{ itemTypeSlug }}
          passToFrame={passToFrame}
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="mt-2 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        title={`Remove "${bf.fieldDefinition.fieldLabel}" from ${itemTypeName}`}
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Droppable container — makes each section a valid drop target when empty
// ---------------------------------------------------------------------------

const BASE_DROPPABLE = 'base-droppable';
const OTHER_DROPPABLE = 'other-droppable';

interface DroppableContainerProps {
  id: string;
  children: React.ReactNode;
  isOver: boolean;
}

function DroppableContainer({ id, children, isOver }: DroppableContainerProps) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={isOver ? 'rounded-lg ring-2 ring-primary/25 ring-offset-1' : undefined}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CategoryFieldsWizardProps {
  slug: string;
  name: string;
  onBack: () => void;
}

export function CategoryFieldsWizard({ slug, name, onBack }: CategoryFieldsWizardProps) {
  const { toast } = useToast();

  // All fields for this type come from item_type_base_fields.
  // Big Five = rendered in "Base Fields" section.
  // Non-Big-Five = rendered in "Other Fields" section.
  const [baseFields, setBaseFields] = useState<ItemTypeBaseField[]>([]);
  const [otherFields, setOtherFields] = useState<ItemTypeBaseField[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-field dialog (shared for both base and other, controlled by which section triggered it)
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogTarget, setAddDialogTarget] = useState<'base' | 'other'>('other');
  const [addMode, setAddMode] = useState<'select' | 'create'>('select');
  const [allFieldDefs, setAllFieldDefs] = useState<FieldDefinition[]>([]);
  const [allFieldDefsLoading, setAllFieldDefsLoading] = useState(false);
  const [selectedFieldDefId, setSelectedFieldDefId] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [addingField, setAddingField] = useState(false);

  // Remove confirmation
  const [removeTarget, setRemoveTarget] = useState<ItemTypeBaseField | null>(null);
  const [removingField, setRemovingField] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Track which droppable container the dragged item is currently over
  const [overContainer, setOverContainer] = useState<string | null>(null);

  const loadFields = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getItemTypeBaseFields(slug);
      // Split by sort_order range: base fields live in 0–99, other fields at 100+.
      setBaseFields(all.filter((bf) => bf.sortOrder < OTHER_FIELDS_SORT_OFFSET));
      setOtherFields(all.filter((bf) => bf.sortOrder >= OTHER_FIELDS_SORT_OFFSET));
    } catch {
      toast({ title: 'Error', description: 'Failed to load field definitions', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [slug, toast]);

  useEffect(() => {
    void loadFields();
  }, [loadFields]);

  // ── Open add-field dialog ─────────────────────────────────────────────────
  async function openAddDialog(target: 'base' | 'other') {
    setAddDialogTarget(target);
    setAddMode('select');
    setSelectedFieldDefId('');
    setNewFieldLabel('');
    setAddDialogOpen(true);
    setAllFieldDefsLoading(true);
    try {
      const defs = await getFieldDefinitions();
      setAllFieldDefs(defs);
    } catch {
      toast({ title: 'Error', description: 'Failed to load field definitions', variant: 'destructive' });
    } finally {
      setAllFieldDefsLoading(false);
    }
  }

  // ── Add field ─────────────────────────────────────────────────────────────
  async function handleAddField() {
    setAddingField(true);
    try {
      let fieldDefId = selectedFieldDefId;

      if (addMode === 'create') {
        const label = newFieldLabel.trim();
        if (!label) return;
        const fieldKey = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const created = await createOrApproveFieldDefinition({ fieldKey, fieldLabel: label, valueType: 'string' });
        setAllFieldDefs((prev) => (prev.some((d) => d.id === created.id) ? prev : [...prev, created]));
        fieldDefId = created.id;
      }

      if (!fieldDefId) return;

      const added = await addItemTypeBaseField(slug, fieldDefId);
      // Backfill fieldDefinition from our local list if not returned
      if (!added.fieldDefinition) {
        const def = allFieldDefs.find((d) => d.id === fieldDefId);
        if (def) added.fieldDefinition = def;
      }

      // Route to the correct section based on which button triggered the dialog,
      // then normalize sort_orders so the range-based split survives a reload.
      if (addDialogTarget === 'base') {
        const newBase = [...baseFields, added];
        setBaseFields(newBase);
        await reorderItemTypeBaseFields(slug, newBase.map((bf) => bf.fieldDefinitionId), 0);
      } else {
        const newOther = [...otherFields, added];
        setOtherFields(newOther);
        await reorderItemTypeBaseFields(
          slug,
          newOther.map((bf) => bf.fieldDefinitionId),
          OTHER_FIELDS_SORT_OFFSET
        );
      }

      setAddDialogOpen(false);
      setSelectedFieldDefId('');
      setNewFieldLabel('');
      toast({
        title: 'Field added',
        description: `"${added.fieldDefinition?.fieldLabel ?? 'Field'}" is now a default field for all ${name.toLowerCase()} items.`,
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to add field', variant: 'destructive' });
    } finally {
      setAddingField(false);
    }
  }

  // ── Remove field ──────────────────────────────────────────────────────────
  async function handleConfirmRemove() {
    if (!removeTarget) return;
    setRemovingField(true);
    try {
      await removeItemTypeBaseField(slug, removeTarget.fieldDefinitionId);
      setBaseFields((prev) => prev.filter((bf) => bf.id !== removeTarget.id));
      setOtherFields((prev) => prev.filter((bf) => bf.id !== removeTarget.id));
      toast({
        title: 'Field removed',
        description: `"${removeTarget.fieldDefinition?.fieldLabel ?? 'Field'}" removed from ${name} defaults.`,
      });
      setRemoveTarget(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to remove field', variant: 'destructive' });
    } finally {
      setRemovingField(false);
    }
  }

  // ── Unified drag handler — handles same-section reorder and cross-section moves ──
  async function handleDragEnd(event: DragEndEvent) {
    setOverContainer(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeInBase = baseFields.some((bf) => bf.fieldDefinitionId === activeId);
    // overId may be a field ID or a container droppable ID
    const overInBase =
      overId === BASE_DROPPABLE ||
      (overId !== OTHER_DROPPABLE && baseFields.some((bf) => bf.fieldDefinitionId === overId));

    if (activeId === overId) return;

    try {
      if (activeInBase === overInBase) {
        // ── Same-container reorder ────────────────────────────────────────
        // Dropping on the container background itself is a no-op
        if (overId === BASE_DROPPABLE || overId === OTHER_DROPPABLE) return;

        if (activeInBase) {
          const oldIndex = baseFields.findIndex((bf) => bf.fieldDefinitionId === activeId);
          const newIndex = baseFields.findIndex((bf) => bf.fieldDefinitionId === overId);
          const reordered = arrayMove(baseFields, oldIndex, newIndex);
          setBaseFields(reordered);
          await reorderItemTypeBaseFields(slug, reordered.map((bf) => bf.fieldDefinitionId), 0);
        } else {
          const oldIndex = otherFields.findIndex((bf) => bf.fieldDefinitionId === activeId);
          const newIndex = otherFields.findIndex((bf) => bf.fieldDefinitionId === overId);
          const reordered = arrayMove(otherFields, oldIndex, newIndex);
          setOtherFields(reordered);
          await reorderItemTypeBaseFields(
            slug,
            reordered.map((bf) => bf.fieldDefinitionId),
            OTHER_FIELDS_SORT_OFFSET
          );
        }
      } else {
        // ── Cross-container move ──────────────────────────────────────────
        const activeField = activeInBase
          ? baseFields.find((bf) => bf.fieldDefinitionId === activeId)!
          : otherFields.find((bf) => bf.fieldDefinitionId === activeId)!;

        if (activeInBase) {
          // Base → Other
          const newBase = baseFields.filter((bf) => bf.fieldDefinitionId !== activeId);
          const newOther = [...otherFields];
          if (overId === OTHER_DROPPABLE) {
            newOther.push(activeField);
          } else {
            const overIndex = newOther.findIndex((bf) => bf.fieldDefinitionId === overId);
            newOther.splice(overIndex >= 0 ? overIndex : newOther.length, 0, activeField);
          }
          setBaseFields(newBase);
          setOtherFields(newOther);
          await Promise.all([
            reorderItemTypeBaseFields(slug, newBase.map((bf) => bf.fieldDefinitionId), 0),
            reorderItemTypeBaseFields(
              slug,
              newOther.map((bf) => bf.fieldDefinitionId),
              OTHER_FIELDS_SORT_OFFSET
            ),
          ]);
        } else {
          // Other → Base
          const newOther = otherFields.filter((bf) => bf.fieldDefinitionId !== activeId);
          const newBase = [...baseFields];
          if (overId === BASE_DROPPABLE) {
            newBase.push(activeField);
          } else {
            const overIndex = newBase.findIndex((bf) => bf.fieldDefinitionId === overId);
            newBase.splice(overIndex >= 0 ? overIndex : newBase.length, 0, activeField);
          }
          setBaseFields(newBase);
          setOtherFields(newOther);
          await Promise.all([
            reorderItemTypeBaseFields(slug, newBase.map((bf) => bf.fieldDefinitionId), 0),
            reorderItemTypeBaseFields(
              slug,
              newOther.map((bf) => bf.fieldDefinitionId),
              OTHER_FIELDS_SORT_OFFSET
            ),
          ]);
        }
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save field order', variant: 'destructive' });
      void loadFields();
    }
  }

  function handleDragOver(event: { active: { id: string | number }; over: { id: string | number } | null }) {
    const overId = event.over?.id as string | undefined;
    if (!overId) { setOverContainer(null); return; }
    if (overId === BASE_DROPPABLE || baseFields.some((bf) => bf.fieldDefinitionId === overId)) {
      setOverContainer(BASE_DROPPABLE);
    } else {
      setOverContainer(OTHER_DROPPABLE);
    }
  }

  // ── Compute already-linked IDs for the picker ─────────────────────────────
  const linkedIds = new Set([
    ...baseFields.map((bf) => bf.fieldDefinitionId),
    ...otherFields.map((bf) => bf.fieldDefinitionId),
  ]);
  const availableForPicker = allFieldDefs.filter((d) => !linkedIds.has(d.id));

  // ── Loading state ─────────────────────────────────────────────────────────
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
          <span className="font-semibold text-sm">{name}</span>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* ── Base Fields ────────────────────────────────────────────────── */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold">Base Fields</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Core structural fields shared by all {name.toLowerCase()} items. Drag to reorder or into Other Fields.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => void openAddDialog('base')}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Base Field
              </Button>
            </div>

            <DroppableContainer id={BASE_DROPPABLE} isOver={overContainer === BASE_DROPPABLE}>
              {baseFields.length === 0 ? (
                <div className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
                  No base fields configured yet.{' '}
                  <button
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                    onClick={() => void openAddDialog('base')}
                  >
                    Add one
                  </button>
                  .
                </div>
              ) : (
                <SortableContext
                  items={baseFields.map((bf) => bf.fieldDefinitionId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2">
                    {baseFields.map((bf) => (
                      <SortableFieldRow
                        key={bf.id}
                        bf={bf}
                        itemTypeSlug={slug}
                        itemTypeName={name}
                        onRemove={() => setRemoveTarget(bf)}
                        passToFrame={slug === 'doors' ? {
                          value: bf.passValueToFrame,
                          onChange: async (next: boolean) => {
                            await setItemTypeBaseFieldPassValueToFrame(slug, bf.fieldDefinitionId, next);
                            setBaseFields((prev) =>
                              prev.map((f) => f.id === bf.id ? { ...f, passValueToFrame: next } : f)
                            );
                          },
                        } : undefined}
                      />
                    ))}
                  </div>
                </SortableContext>
              )}
            </DroppableContainer>
          </section>

          {/* ── Other Fields ───────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold">Other Fields</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Additional {name.toLowerCase()}-specific fields. Drag to reorder or into Base Fields.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => void openAddDialog('other')}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Field
              </Button>
            </div>

            <DroppableContainer id={OTHER_DROPPABLE} isOver={overContainer === OTHER_DROPPABLE}>
              {otherFields.length === 0 ? (
                <div className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
                  No additional fields yet.{' '}
                  <button
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                    onClick={() => void openAddDialog('other')}
                  >
                    Add one
                  </button>
                  .
                </div>
              ) : (
                <SortableContext
                  items={otherFields.map((bf) => bf.fieldDefinitionId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2">
                    {otherFields.map((bf) => (
                      <SortableFieldRow
                        key={bf.id}
                        bf={bf}
                        itemTypeSlug={slug}
                        itemTypeName={name}
                        onRemove={() => setRemoveTarget(bf)}
                        passToFrame={slug === 'doors' ? {
                          value: bf.passValueToFrame,
                          onChange: async (next: boolean) => {
                            await setItemTypeBaseFieldPassValueToFrame(slug, bf.fieldDefinitionId, next);
                            setOtherFields((prev) =>
                              prev.map((f) => f.id === bf.id ? { ...f, passValueToFrame: next } : f)
                            );
                          },
                        } : undefined}
                      />
                    ))}
                  </div>
                </SortableContext>
              )}
            </DroppableContainer>
          </section>
        </DndContext>
      </div>

      {/* ── Add Field Dialog ─────────────────────────────────────────────── */}
      <Dialog
        open={addDialogOpen}
        onOpenChange={(o) => {
          setAddDialogOpen(o);
          if (!o) { setSelectedFieldDefId(''); setNewFieldLabel(''); }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {addDialogTarget === 'base' ? 'Add Base Field' : 'Add Field'}
            </DialogTitle>
          </DialogHeader>

          <Tabs
            value={addMode}
            onValueChange={(v) => { setAddMode(v as 'select' | 'create'); setSelectedFieldDefId(''); setNewFieldLabel(''); }}
            className="mt-1"
          >
            <TabsList className="w-full">
              <TabsTrigger value="select" className="flex-1">Select existing</TabsTrigger>
              <TabsTrigger value="create" className="flex-1">Create new</TabsTrigger>
            </TabsList>

            <TabsContent value="select" className="mt-3 space-y-2">
              {allFieldDefsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading fields…
                </div>
              ) : availableForPicker.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  All available field definitions are already configured for this category.
                </p>
              ) : (
                <>
                  <Select value={selectedFieldDefId} onValueChange={setSelectedFieldDefId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a field…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableForPicker.map((fd) => (
                        <SelectItem key={fd.id} value={fd.id}>
                          <span>{fd.fieldLabel}</span>
                          <span className="ml-1 font-mono text-xs text-muted-foreground">
                            ({fd.fieldKey})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    This field will appear by default on all new {name.toLowerCase()} items.
                  </p>
                </>
              )}
            </TabsContent>

            <TabsContent value="create" className="mt-3 space-y-2">
              <Input
                placeholder="Field label (e.g. Fire Rating)"
                value={newFieldLabel}
                onChange={(e) => setNewFieldLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAddField(); }}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                A new global field definition will be created and added to {name} defaults.
              </p>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={addingField}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAddField()}
              disabled={
                addingField ||
                allFieldDefsLoading ||
                (addMode === 'select' && !selectedFieldDefId) ||
                (addMode === 'create' && !newFieldLabel.trim())
              }
            >
              {addingField ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Field'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove Confirmation ───────────────────────────────────────────── */}
      <Dialog open={!!removeTarget} onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Remove Field
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            Remove <strong>{removeTarget?.fieldDefinition?.fieldLabel}</strong> from the default fields
            for {name}? Existing items that already have this field are not affected. The global
            field definition is preserved.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)} disabled={removingField}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleConfirmRemove()}
              disabled={removingField}
            >
              {removingField ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
