import { useState, useRef, useEffect, useCallback } from 'react';
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
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Star,
  GripVertical,
  DollarSign,
  ArrowRightFromLine,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { FieldDefinition, FieldValueOption, ItemTypeFieldValueOption, OptionType } from '@/types';
import {
  getFieldValueOptions,
  addFieldValueOption,
  updateFieldValueOption,
  deleteFieldValueOption,
  updateFieldDefinition,
  updateFieldOptionType,
  setDefaultFieldValueOption,
  reorderFieldValueOptions,
} from '@/lib/estimates-api';
import {
  getItemFieldOptions,
  addItemFieldOption,
  updateItemFieldOption,
  deleteItemFieldOption,
  setDefaultItemFieldOption,
  reorderItemFieldOptions,
  setItemFieldLabel,
  setItemFieldAdder,
} from '@/lib/item-fields-api';
import { useToast } from '@/hooks/use-toast';
import { FieldAliasSection } from './FieldAliasSection';
import { FieldDependenciesSection } from './FieldDependenciesSection';

// ---------------------------------------------------------------------------
// Sortable row
// ---------------------------------------------------------------------------

type AnyOption = FieldValueOption | ItemTypeFieldValueOption;

interface SortableOptionRowProps {
  opt: AnyOption;
  isEditing: boolean;
  optionDraft: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDraftChange: (v: string) => void;
  onDelete: () => void;
  onToggleDefault: () => void;
}

function SortableOptionRow({
  opt,
  isEditing,
  optionDraft,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDraftChange,
  onDelete,
  onToggleDefault,
}: SortableOptionRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: opt.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm border border-transparent hover:border-border hover:bg-muted/30 transition-colors"
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground shrink-0"
        title="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>

      {isEditing ? (
        <span
          className="flex items-center gap-1 flex-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Input
            className="h-6 text-sm flex-1"
            value={optionDraft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit();
              if (e.key === 'Escape') onCancelEdit();
            }}
            autoFocus
          />
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onSaveEdit}>
            <Check className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCancelEdit}>
            <X className="h-3 w-3" />
          </Button>
        </span>
      ) : (
        <>
          <span className="flex-1 truncate">{opt.value}</span>

          <span
            className="ml-auto flex items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Star — default toggle */}
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                'h-6 w-6',
                opt.isDefault
                  ? 'text-amber-400 hover:text-amber-500'
                  : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-amber-400'
              )}
              title={opt.isDefault ? 'Remove as default' : 'Set as default'}
              onClick={onToggleDefault}
            >
              <Star className={cn('h-3 w-3', opt.isDefault && 'fill-amber-400')} />
            </Button>

            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 opacity-0 group-hover:opacity-100"
              onClick={onStartEdit}
            >
              <Pencil className="h-3 w-3" />
            </Button>

            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface FieldOptionsPanelProps {
  field: FieldDefinition;
  defaultExpanded?: boolean;
  /** When true, renders a compact collapsed summary row (used for base-field collapsed state). */
  collapsed?: boolean;
  /** If provided, a delete-field button appears in the header. */
  onDeleteField?: () => void;
  /**
   * Controls which backend tables are used for reads/writes:
   * - `'global'` (default): operates on global field_definitions / field_value_options
   * - `{ canonicalCode }`: per-item copy-on-write tables
   * - `{ itemTypeSlug }`: item-type defaults (options/aliases still global; deps from type table)
   */
  dataSource?: 'global' | { canonicalCode: string } | { itemTypeSlug: string };
  /** Initial adder state (per-item mode only). */
  isAdder?: boolean;
  /**
   * When true, the money-sign adder toggle is hidden (Big Five base fields
   * like series, gauge, opening_width, opening_height).
   */
  isBigFive?: boolean;
  /** Effective label override — initialises the label draft in per-item mode. */
  overrideLabel?: string;
  /**
   * When true, the "Conditional sub-fields" section is hidden.
   * Used to prevent grandchildren when rendering a child FieldOptionsPanel.
   */
  disableNestedDependencies?: boolean;
  /**
   * When provided, renders a "pass value to frame" toggle in the header.
   * Only meaningful for the Doors category in the category-level fields wizard.
   */
  passToFrame?: { value: boolean; onChange: (next: boolean) => Promise<void> };
}

export function FieldOptionsPanel({
  field,
  defaultExpanded = false,
  collapsed = false,
  onDeleteField,
  dataSource = 'global',
  isAdder: isAdderProp = false,
  isBigFive = false,
  overrideLabel,
  disableNestedDependencies = false,
  passToFrame,
}: FieldOptionsPanelProps) {
  const { toast } = useToast();
  const canonicalCode =
    typeof dataSource === 'object' && 'canonicalCode' in dataSource
      ? dataSource.canonicalCode
      : null;
  const itemTypeSlug =
    typeof dataSource === 'object' && 'itemTypeSlug' in dataSource
      ? dataSource.itemTypeSlug
      : null;
  // Per-item mode: options/aliases/labels use per-item tables
  const isPerItem = canonicalCode !== null;

  const [expanded, setExpanded] = useState(defaultExpanded && !collapsed);
  const [options, setOptions] = useState<AnyOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<'label' | null>(null);
  const initialLabel = overrideLabel ?? field.fieldLabel;
  const [labelDraft, setLabelDraft] = useState(initialLabel);
  const [adderActive, setAdderActive] = useState(isAdderProp);
  const [optionType, setOptionType] = useState<OptionType>(field.optionType ?? 'selection');
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [optionDraft, setOptionDraft] = useState('');
  const [newOptionValue, setNewOptionValue] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const loadOptions = useCallback(async () => {
    setLoadingOptions(true);
    try {
      const opts = isPerItem && canonicalCode
        ? await getItemFieldOptions(canonicalCode, field.id)
        : await getFieldValueOptions(field.id);
      setOptions(opts);
    } catch {
      toast({ title: 'Error', description: 'Failed to load options', variant: 'destructive' });
    } finally {
      setLoadingOptions(false);
    }
  }, [canonicalCode, field.id, isPerItem, toast]);

  useEffect(() => {
    if (expanded && optionType === 'selection' && options.length === 0 && !loadingOptions) {
      void loadOptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, optionType]);

  async function handleSaveLabel() {
    if (!labelDraft.trim() || labelDraft === initialLabel) {
      setEditingLabelId(null);
      return;
    }
    try {
      if (isPerItem && canonicalCode) {
        await setItemFieldLabel(canonicalCode, field.id, labelDraft.trim());
      } else {
        await updateFieldDefinition(field.id, { fieldLabel: labelDraft.trim() });
      }
      toast({ title: 'Label updated' });
    } catch {
      toast({ title: 'Error', description: 'Failed to update label', variant: 'destructive' });
      setLabelDraft(initialLabel);
    }
    setEditingLabelId(null);
  }

  async function handleToggleAdder() {
    if (!isPerItem || !canonicalCode) return;
    const newValue = !adderActive;
    setAdderActive(newValue);
    try {
      await setItemFieldAdder(canonicalCode, field.id, newValue);
    } catch {
      setAdderActive(!newValue);
      toast({ title: 'Error', description: 'Failed to update adder status', variant: 'destructive' });
    }
  }

  async function handleChangeOptionType(next: OptionType) {
    if (next === optionType) return;
    const prev = optionType;
    setOptionType(next);
    try {
      await updateFieldOptionType(field.id, next);
    } catch {
      setOptionType(prev);
      toast({ title: 'Error', description: 'Failed to update option type', variant: 'destructive' });
    }
  }

  async function handleAddOption() {
    const val = newOptionValue.trim();
    if (!val) return;
    try {
      const created = isPerItem && canonicalCode
        ? await addItemFieldOption(canonicalCode, field.id, val)
        : await addFieldValueOption(field.id, val);
      setOptions((prev) => [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value)));
      setNewOptionValue('');
      setAddingNew(false);
    } catch {
      toast({ title: 'Error', description: 'Failed to add option', variant: 'destructive' });
    }
  }

  async function handleSaveOptionEdit(id: string) {
    const val = optionDraft.trim();
    if (!val) {
      setEditingOptionId(null);
      return;
    }
    try {
      if (isPerItem) {
        await updateItemFieldOption(id, { value: val });
        setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, value: val } : o)));
      } else {
        const updated = await updateFieldValueOption(id, val);
        setOptions((prev) => prev.map((o) => (o.id === id ? updated : o)));
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update option', variant: 'destructive' });
    }
    setEditingOptionId(null);
  }

  async function handleDeleteOption(id: string) {
    try {
      if (isPerItem) {
        await deleteItemFieldOption(id);
      } else {
        await deleteFieldValueOption(id);
      }
      setOptions((prev) => prev.filter((o) => o.id !== id));
    } catch {
      toast({ title: 'Error', description: 'Failed to delete option', variant: 'destructive' });
    }
  }

  async function handleToggleDefault(opt: AnyOption) {
    // Optimistic update
    setOptions((prev) =>
      prev.map((o) => ({ ...o, isDefault: o.id === opt.id ? !opt.isDefault : false }))
    );
    try {
      if (isPerItem && canonicalCode) {
        if (opt.isDefault) {
          await updateItemFieldOption(opt.id, { isDefault: false });
        } else {
          await setDefaultItemFieldOption(canonicalCode, field.id, opt.id);
        }
      } else {
        const newDefault = opt.isDefault ? null : opt.id;
        await setDefaultFieldValueOption(field.id, newDefault);
      }
    } catch {
      // Revert
      setOptions((prev) =>
        prev.map((o) => ({ ...o, isDefault: o.id === opt.id ? opt.isDefault : o.isDefault }))
      );
      toast({ title: 'Error', description: 'Failed to update default', variant: 'destructive' });
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = options.findIndex((o) => o.id === active.id);
    const newIndex = options.findIndex((o) => o.id === over.id);
    const reordered = arrayMove(options, oldIndex, newIndex);
    setOptions(reordered);

    try {
      if (isPerItem && canonicalCode) {
        await reorderItemFieldOptions(canonicalCode, field.id, reordered.map((o) => o.id));
      } else {
        await reorderFieldValueOptions(reordered.map((o) => o.id));
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save option order', variant: 'destructive' });
      void loadOptions();
    }
  }

  const defaultOption = options.find((o) => o.isDefault);

  // ── Collapsed summary row ──────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="flex items-center justify-between px-4 py-2 rounded-lg border bg-muted/40 text-sm">
        <span className="font-medium text-muted-foreground">{initialLabel}</span>
        {optionType !== 'selection' ? (
          <Badge variant="secondary" className="text-xs">
            {optionType === 'string' ? 'Text input' : 'Number input'}
          </Badge>
        ) : defaultOption ? (
          <Badge variant="secondary" className="gap-1">
            <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
            {defaultOption.value}
          </Badge>
        ) : (
          <span className="text-muted-foreground italic text-xs">—</span>
        )}
      </div>
    );
  }

  // ── Full expandable panel ─────────────────────────────────────────────────
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}

          {editingLabelId === 'label' ? (
            <span
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <Input
                className="h-7 text-sm w-44"
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveLabel();
                  if (e.key === 'Escape') {
                    setEditingLabelId(null);
                    setLabelDraft(initialLabel);
                  }
                }}
                autoFocus
              />
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => void handleSaveLabel()}>
                <Check className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => {
                  setEditingLabelId(null);
                  setLabelDraft(initialLabel);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </span>
          ) : (
            <span className="font-semibold text-sm">{labelDraft}</span>
          )}
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {!expanded && optionType !== 'selection' && (
            <Badge variant="outline" className="text-xs mr-1">
              {optionType === 'string' ? 'Text input' : 'Number input'}
            </Badge>
          )}
          {defaultOption && !expanded && optionType === 'selection' && (
            <Badge variant="outline" className="text-xs gap-1 mr-1">
              <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
              {defaultOption.value}
            </Badge>
          )}

          {isPerItem && !isBigFive && (
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                'h-7 w-7',
                adderActive
                  ? 'text-emerald-600 hover:text-emerald-700'
                  : 'text-muted-foreground hover:text-emerald-600'
              )}
              title={adderActive ? 'Remove as price adder' : 'Mark as price adder'}
              onClick={() => void handleToggleAdder()}
            >
              <DollarSign className={cn('h-3.5 w-3.5', adderActive && 'stroke-[2.5]')} />
            </Button>
          )}

          {passToFrame !== undefined && (
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                'h-7 w-7',
                passToFrame.value
                  ? 'text-sky-600 hover:text-sky-700'
                  : 'text-muted-foreground/30 hover:text-sky-600'
              )}
              title="Pass value to frame"
              onClick={() => void passToFrame.onChange(!passToFrame.value)}
            >
              <ArrowRightFromLine className={cn('h-3.5 w-3.5', passToFrame.value && 'stroke-[2.5]')} />
            </Button>
          )}

          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title="Edit label"
            onClick={() => {
              setEditingLabelId('label');
              setExpanded(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>

          {onDeleteField && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive hover:text-destructive"
              title="Delete this field"
              onClick={onDeleteField}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Options list */}
      {expanded && (
        <div className="border-t px-4 py-3 space-y-1">
          {/* Option type selector */}
          <div className="flex items-center gap-3 pb-3 mb-1 border-b" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs font-medium text-muted-foreground shrink-0">Input type</span>
            <div className="flex items-center gap-1">
              {(['selection', 'string', 'integer'] as OptionType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => void handleChangeOptionType(t)}
                  className={cn(
                    'px-2.5 py-0.5 rounded text-xs font-medium transition-colors',
                    optionType === t
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  {t === 'selection' ? 'Selection' : t === 'string' ? 'Text' : 'Number'}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {optionType === 'selection'
                ? 'User picks from a predefined list'
                : optionType === 'string'
                ? 'User types free text in the wizard'
                : 'User enters a whole number in the wizard'}
            </span>
          </div>

          {/* Manufacturer aliases — sits above options */}
          <FieldAliasSection
            fieldDefinitionId={field.id}
            fieldLabel={labelDraft}
            dataSource={canonicalCode ? { canonicalCode } : 'global'}
          />

          {/* Options list — only for selection type */}
          {optionType === 'selection' ? (
            <>
              {loadingOptions && (
                <p className="text-xs text-muted-foreground animate-pulse py-2">Loading options…</p>
              )}

              {!loadingOptions && options.length === 0 && !addingNew && (
                <p className="text-xs text-muted-foreground italic py-1">No options yet. Add one below.</p>
              )}

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={options.map((o) => o.id)} strategy={verticalListSortingStrategy}>
                  {options.map((opt) => (
                    <SortableOptionRow
                      key={opt.id}
                      opt={opt}
                      isEditing={editingOptionId === opt.id}
                      optionDraft={optionDraft}
                      onDraftChange={setOptionDraft}
                      onStartEdit={() => {
                        setEditingOptionId(opt.id);
                        setOptionDraft(opt.value);
                      }}
                      onCancelEdit={() => setEditingOptionId(null)}
                      onSaveEdit={() => void handleSaveOptionEdit(opt.id)}
                      onDelete={() => void handleDeleteOption(opt.id)}
                      onToggleDefault={() => void handleToggleDefault(opt)}
                    />
                  ))}
                </SortableContext>
              </DndContext>

              {/* Add new option */}
              {addingNew ? (
                <div
                  className="flex items-center gap-2 pt-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Input
                    ref={newInputRef}
                    className="h-7 text-sm flex-1"
                    placeholder="New option value…"
                    value={newOptionValue}
                    onChange={(e) => setNewOptionValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddOption();
                      if (e.key === 'Escape') {
                        setAddingNew(false);
                        setNewOptionValue('');
                      }
                    }}
                    autoFocus
                  />
                  <Button size="sm" variant="default" className="h-7" onClick={() => void handleAddOption()}>
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => {
                      setAddingNew(false);
                      setNewOptionValue('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground gap-1 mt-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddingNew(true);
                    setTimeout(() => newInputRef.current?.focus(), 50);
                  }}
                >
                  <Plus className="h-3 w-3" />
                  Add option
                </Button>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground italic py-2">
              Values will be entered by the user when creating an estimate.
            </p>
          )}

          {/* Conditional sub-fields — shown for item-type and per-item modes */}
          {(canonicalCode || itemTypeSlug) && !disableNestedDependencies && (
            <FieldDependenciesSection
              parentField={field}
              dataSource={
                canonicalCode
                  ? { canonicalCode }
                  : { itemTypeSlug: itemTypeSlug! }
              }
              disableNestedDependencies={disableNestedDependencies}
            />
          )}
        </div>
      )}
    </div>
  );
}
