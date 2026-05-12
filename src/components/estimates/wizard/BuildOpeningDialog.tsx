import { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Loader2,
  DoorOpen,
  Square,
  Wrench,
  LayoutPanelLeft,
  ChevronsUpDown,
  ChevronDown,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import {
  getItemTypes,
  createEstimateOpening,
  addEstimateItem,
  addItemField,
  getFieldValueOptions,
  recordFieldValueUsage,
  updateEstimateOpening,
  deleteEstimateItem,
} from '@/lib/estimates-api';
import { getPassToFrameFieldKeys } from '@/lib/item-fields-api';
import { evaluateDependency } from '@/lib/field-dependencies';
import { syncDoorFieldToFrames } from '@/lib/door-frame-sync';
import { groupHardwareBySubcategory } from '@/lib/hardware-utils';
import {
  AddItemModal,
  newLocalId,
  type LocalField,
  type LocalTopLevelItem,
  type LocalHardwareItem,
} from './AddItemModal';
import type {
  ItemType,
  EstimateOpening,
  EstimateOpeningWithItems,
  EstimateItemWithHardware,
  FieldValueOption,
  ItemField,
  HardwareSubcategory,
  DependencyOperator,
} from '@/types';

interface BuildOpeningDialogProps {
  estimateId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (opening: EstimateOpeningWithItems) => void;
  onUpdated?: (opening: EstimateOpeningWithItems) => void;
  openingCount?: number;
  editingOpening?: EstimateOpeningWithItems;
}

// ---------------------------------------------------------------------------
// AddFieldForm — minimal inline form for adding a custom field to an item
// ---------------------------------------------------------------------------

interface AddFieldFormProps {
  onAdd: (field: Omit<LocalField, 'localId'>) => void;
  onCancel: () => void;
}

function AddFieldForm({ onAdd, onCancel }: AddFieldFormProps) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    if (!key.trim() || !label.trim()) return;
    onAdd({
      fieldKey: key.toLowerCase().replace(/\s+/g, '_'),
      fieldLabel: label,
      fieldValue: value,
      valueType: 'string',
      isRequired: false,
    });
  };

  return (
    <div className="mt-2 rounded-md border border-dashed bg-muted/20 p-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[11px] text-muted-foreground">Key</Label>
          <Input
            placeholder="e.g. gauge"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="h-7 text-xs"
            autoFocus
          />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Label</Label>
          <Input
            placeholder="e.g. Gauge"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Value</Label>
          <Input
            placeholder="e.g. 16 GA"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') onCancel();
            }}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleSubmit}
          disabled={!key.trim() || !label.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldRow — single editable field with optional historical value combobox
// ---------------------------------------------------------------------------

interface FieldRowProps {
  field: LocalField;
  onUpdate: (value: string) => void;
  onDelete: () => void;
}

function FieldRow({ field, onUpdate, onDelete }: FieldRowProps) {
  const [options, setOptions] = useState<FieldValueOption[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  useEffect(() => {
    if (!field.fieldDefinitionId) return;
    getFieldValueOptions(field.fieldDefinitionId)
      .then(setOptions)
      .catch(console.error);
  }, [field.fieldDefinitionId]);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <div className="w-28 shrink-0">
        <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-0.5">
          {field.fieldLabel}
          {field.isRequired && (
            <span className="text-destructive font-bold" title="Required">
              *
            </span>
          )}
        </p>
        <p className="text-[10px] font-mono text-muted-foreground/60">
          {field.fieldKey}
        </p>
      </div>

      {options.length > 0 ? (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={popoverOpen}
              className="h-7 flex-1 justify-between text-xs font-normal"
            >
              <span className={cn(!field.fieldValue && 'text-muted-foreground')}>
                {field.fieldValue || (field.isRequired ? 'Required' : '—')}
              </span>
              <ChevronsUpDown className="h-3 w-3 ml-1 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-0" align="start" onWheel={(e) => e.stopPropagation()}>
            <Command>
              <CommandInput
                placeholder="Search or type…"
                className="h-8 text-xs"
                value={field.fieldValue}
                onValueChange={onUpdate}
              />
              <CommandList>
                <CommandEmpty className="py-1.5 text-center text-xs text-muted-foreground">
                  Press Enter to use this value
                </CommandEmpty>
                <CommandGroup>
                  {options.map((o) => (
                    <CommandItem
                      key={o.id}
                      value={o.value}
                      onSelect={(val) => {
                        onUpdate(val);
                        setPopoverOpen(false);
                      }}
                    >
                      {o.value}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <Input
          value={field.fieldValue}
          onChange={(e) => onUpdate(e.target.value)}
          className="h-7 text-xs flex-1"
          placeholder={field.isRequired ? 'Required' : '—'}
        />
      )}

      {!field.isRequired && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldsList — editable field list for a local item
// ---------------------------------------------------------------------------

interface FieldsListProps {
  fields: LocalField[];
  onUpdateField: (localId: string, value: string) => void;
  onDeleteField: (localId: string) => void;
}

function FieldsList({ fields, onUpdateField, onDeleteField }: FieldsListProps) {
  if (fields.length === 0) return null;

  // Separate top-level (parent) fields from conditional child fields
  const parentFields = fields.filter((f) => !f.conditionalParentDefId);
  const childrenByParentDefId = new Map<string, LocalField[]>();
  for (const f of fields) {
    if (!f.conditionalParentDefId) continue;
    const list = childrenByParentDefId.get(f.conditionalParentDefId) ?? [];
    list.push(f);
    childrenByParentDefId.set(f.conditionalParentDefId, list);
  }

  const rows: JSX.Element[] = [];
  for (const field of parentFields) {
    rows.push(
      <FieldRow
        key={field.localId}
        field={field}
        onUpdate={(val) => onUpdateField(field.localId, val)}
        onDelete={() => onDeleteField(field.localId)}
      />
    );
    if (!field.fieldDefinitionId) continue;
    const children = childrenByParentDefId.get(field.fieldDefinitionId) ?? [];
    for (const child of children) {
      if (
        child.conditionOperator === undefined ||
        child.conditionTriggerValues === undefined
      ) continue;
      if (!evaluateDependency(field.fieldValue || null, child.conditionOperator, child.conditionTriggerValues)) continue;
      rows.push(
        <div key={child.localId} className="pl-4 ml-1 border-l-2 border-primary/20 bg-muted/20">
          <FieldRow
            field={child}
            onUpdate={(val) => onUpdateField(child.localId, val)}
            onDelete={() => onDeleteField(child.localId)}
          />
        </div>
      );
    }
  }

  return (
    <div className="rounded-md border divide-y mt-2">
      {rows}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ItemCard — card for a top-level door or frame item (no hardware section)
// ---------------------------------------------------------------------------

interface ItemCardProps {
  item: LocalTopLevelItem;
  addFieldFormOpenForId: string | null;
  onDelete: (localId: string) => void;
  onUpdateField: (itemLocalId: string, fieldLocalId: string, value: string) => void;
  onDeleteField: (itemLocalId: string, fieldLocalId: string) => void;
  onAddField: (itemLocalId: string, field: Omit<LocalField, 'localId'>) => void;
  onToggleAddFieldForm: (itemLocalId: string | null) => void;
}

function ItemCard({
  item,
  addFieldFormOpenForId,
  onDelete,
  onUpdateField,
  onDeleteField,
  onAddField,
  onToggleAddFieldForm,
}: ItemCardProps) {
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{item.itemLabel}</span>
            <Badge variant="secondary" className="font-mono text-[10px] shrink-0">
              {item.canonicalCode}
            </Badge>
          </div>
        </div>

        {item.loadingFields && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(item.localId)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <FieldsList
          fields={item.fields}
          onUpdateField={(fid, val) => onUpdateField(item.localId, fid, val)}
          onDeleteField={(fid) => onDeleteField(item.localId, fid)}
        />

        {addFieldFormOpenForId === item.localId ? (
          <AddFieldForm
            onAdd={(field) => {
              onAddField(item.localId, field);
              onToggleAddFieldForm(null);
            }}
            onCancel={() => onToggleAddFieldForm(null)}
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs mt-1 text-muted-foreground"
            onClick={() => onToggleAddFieldForm(item.localId)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Field
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HardwareItemCard — card for a single hardware item in the opening-level section
// ---------------------------------------------------------------------------

interface HardwareItemCardProps {
  hw: LocalHardwareItem;
  addFieldFormOpenForId: string | null;
  onDelete: (localId: string) => void;
  onUpdateField: (hwLocalId: string, fieldLocalId: string, value: string) => void;
  onDeleteField: (hwLocalId: string, fieldLocalId: string) => void;
  onAddField: (hwLocalId: string, field: Omit<LocalField, 'localId'>) => void;
  onToggleAddFieldForm: (hwLocalId: string | null) => void;
}

function HardwareItemCard({
  hw,
  addFieldFormOpenForId,
  onDelete,
  onUpdateField,
  onDeleteField,
  onAddField,
  onToggleAddFieldForm,
}: HardwareItemCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="ml-0 rounded-md border bg-background">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium truncate">{hw.itemLabel}</span>
            <Badge variant="outline" className="font-mono text-[10px] shrink-0">
              {hw.canonicalCode}
            </Badge>
          </div>
        </div>
        {hw.loadingFields && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse fields' : 'Expand fields'}
        >
          <ChevronDown
            className={cn('h-3 w-3 transition-transform duration-150', expanded && 'rotate-180')}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(hw.localId)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {expanded && (
        <div className="border-t px-3 pb-2 pt-2">
          <FieldsList
            fields={hw.fields}
            onUpdateField={(fid, val) => onUpdateField(hw.localId, fid, val)}
            onDeleteField={(fid) => onDeleteField(hw.localId, fid)}
          />

          {addFieldFormOpenForId === hw.localId ? (
            <AddFieldForm
              onAdd={(field) => {
                onAddField(hw.localId, field);
                onToggleAddFieldForm(null);
              }}
              onCancel={() => onToggleAddFieldForm(null)}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] mt-1 text-muted-foreground"
              onClick={() => onToggleAddFieldForm(hw.localId)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Field
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BuildOpeningDialog
// ---------------------------------------------------------------------------

export function BuildOpeningDialog({
  estimateId,
  open,
  onOpenChange,
  onSaved,
  onUpdated,
  openingCount = 0,
  editingOpening,
}: BuildOpeningDialogProps) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [doorItems, setDoorItems] = useState<LocalTopLevelItem[]>([]);
  const [frameItems, setFrameItems] = useState<LocalTopLevelItem[]>([]);
  const [panelItems, setPanelItems] = useState<LocalTopLevelItem[]>([]);
  const [hardwareItems, setHardwareItems] = useState<LocalHardwareItem[]>([]);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [itemTypesLoading, setItemTypesLoading] = useState(false);
  const [doorModalOpen, setDoorModalOpen] = useState(false);
  const [frameModalOpen, setFrameModalOpen] = useState(false);
  const [panelModalOpen, setPanelModalOpen] = useState(false);
  const [hardwareModalOpen, setHardwareModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addFieldFormOpenForId, setAddFieldFormOpenForId] = useState<string | null>(null);
  const [addHwFieldFormOpenForId, setAddHwFieldFormOpenForId] = useState<string | null>(null);

  // Field keys from doors that should be mirrored to matching frame fields
  const [passToFrameKeys, setPassToFrameKeys] = useState<Set<string>>(new Set());

  // Load item types and reset state when dialog opens
  useEffect(() => {
    if (!open) return;

    if (editingOpening) {
      setName(editingOpening.name);
      setQuantity(editingOpening.quantity);
    } else {
      setName(`Opening ${openingCount + 1}`);
      setQuantity(1);
    }
    setDoorItems([]);
    setFrameItems([]);
    setPanelItems([]);
    setHardwareItems([]);
    setSaveError(null);
    setAddFieldFormOpenForId(null);
    setAddHwFieldFormOpenForId(null);
    setItemTypesLoading(true);
    getItemTypes()
      .then((types) => {
        setItemTypes(types);
        if (editingOpening) {
          populateFromExistingOpening(editingOpening, types);
        }
      })
      .catch((err) => console.error('Failed to load item types:', err))
      .finally(() => setItemTypesLoading(false));
    getPassToFrameFieldKeys()
      .then(setPassToFrameKeys)
      .catch((err) => console.error('Failed to load pass-to-frame keys:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openingCount, editingOpening?.id]);

  // Convert a saved opening's items back into local draft state for editing
  const populateFromExistingOpening = (
    opening: EstimateOpeningWithItems,
    types: ItemType[]
  ) => {
    const doors: LocalTopLevelItem[] = [];
    const frames: LocalTopLevelItem[] = [];
    const panels: LocalTopLevelItem[] = [];

    for (const item of opening.items) {
      const matchedType = types.find((t) => t.canonicalCode === item.canonicalCode);
      let category: 'doors' | 'frames' | 'panels' = 'doors';
      if (item.itemType === 'panels' || matchedType?.category === 'panels') {
        category = 'panels';
      } else if (item.itemType === 'frames' || matchedType?.category === 'frames') {
        category = 'frames';
      } else if (matchedType?.category !== 'doors' && item.itemType !== 'doors') {
        if (item.itemLabel.toLowerCase().includes('frame')) category = 'frames';
      }

      const existingFields = (item as unknown as { fields: ItemField[] }).fields ?? [];
      const fields: LocalField[] = existingFields.map((f) => ({
        localId: newLocalId(),
        fieldKey: f.fieldKey,
        fieldLabel: f.fieldLabel,
        fieldValue: f.fieldValue,
        valueType: f.valueType,
        fieldDefinitionId: f.fieldDefinitionId ?? undefined,
        isRequired: false,
      }));

      const localItem: LocalTopLevelItem = {
        localId: newLocalId(),
        itemLabel: item.itemLabel,
        canonicalCode: item.canonicalCode,
        category,
        loadingFields: false,
        fields,
      };

      if (category === 'doors') {
        doors.push(localItem);
      } else if (category === 'frames') {
        frames.push(localItem);
      } else {
        panels.push(localItem);
      }
    }

    setDoorItems(doors);
    setFrameItems(frames);
    setPanelItems(panels);

    // Collect all hardware: opening-level (new style) + nested under door/frame (legacy)
    const allHardware: LocalHardwareItem[] = [];

    for (const hw of opening.hardware ?? []) {
      const hwFields = (hw as unknown as { fields: ItemField[] }).fields ?? [];
      allHardware.push({
        localId: newLocalId(),
        itemLabel: hw.itemLabel,
        canonicalCode: hw.canonicalCode,
        subcategory: hw.subcategory ?? null,
        loadingFields: false,
        fields: hwFields.map((f) => ({
          localId: newLocalId(),
          fieldKey: f.fieldKey,
          fieldLabel: f.fieldLabel,
          fieldValue: f.fieldValue,
          valueType: f.valueType,
          fieldDefinitionId: f.fieldDefinitionId ?? undefined,
          isRequired: false,
        })),
      });
    }

    // Legacy: hardware nested under door/frame items
    for (const item of opening.items) {
      for (const hw of item.hardware) {
        const hwFields = (hw as unknown as { fields: ItemField[] }).fields ?? [];
        allHardware.push({
          localId: newLocalId(),
          itemLabel: hw.itemLabel,
          canonicalCode: hw.canonicalCode,
          subcategory: hw.subcategory ?? null,
          loadingFields: false,
          fields: hwFields.map((f) => ({
            localId: newLocalId(),
            fieldKey: f.fieldKey,
            fieldLabel: f.fieldLabel,
            fieldValue: f.fieldValue,
            valueType: f.valueType,
            fieldDefinitionId: f.fieldDefinitionId ?? undefined,
            isRequired: false,
          })),
        });
      }
    }

    setHardwareItems(allHardware);
  };

  // Items arrive fully built (with fields) from AddItemModal — just append them.
  const handleSelectDoor = (item: LocalTopLevelItem) => {
    setDoorItems((prev) => [...prev, item]);
  };

  const handleSelectFrame = (item: LocalTopLevelItem) => {
    setFrameItems((prev) => [...prev, item]);
  };

  const handleSelectPanel = (item: LocalTopLevelItem) => {
    setPanelItems((prev) => [...prev, item]);
  };

  const handleSelectHardware = (hw: LocalHardwareItem) => {
    setHardwareItems((prev) => [...prev, hw]);
  };

  const handleDeleteItem = (category: 'doors' | 'frames' | 'panels', localId: string) => {
    if (category === 'doors') {
      setDoorItems((prev) => prev.filter((i) => i.localId !== localId));
    } else if (category === 'frames') {
      setFrameItems((prev) => prev.filter((i) => i.localId !== localId));
    } else {
      setPanelItems((prev) => prev.filter((i) => i.localId !== localId));
    }
  };

  const handleDeleteHardware = (hwLocalId: string) => {
    setHardwareItems((prev) => prev.filter((h) => h.localId !== hwLocalId));
  };

  const updateItemInAll = (
    localId: string,
    updater: (item: LocalTopLevelItem) => LocalTopLevelItem
  ) => {
    setDoorItems((prev) =>
      prev.map((i) => (i.localId === localId ? updater(i) : i))
    );
    setFrameItems((prev) =>
      prev.map((i) => (i.localId === localId ? updater(i) : i))
    );
    setPanelItems((prev) =>
      prev.map((i) => (i.localId === localId ? updater(i) : i))
    );
  };

  const handleUpdateField = (itemLocalId: string, fieldLocalId: string, value: string) => {
    // Detect if this update is for a door item, and find the changed field key
    // before applying the update so we can sync to frames if needed.
    const doorItem = doorItems.find((i) => i.localId === itemLocalId);
    const changedFieldKey = doorItem?.fields.find((f) => f.localId === fieldLocalId)?.fieldKey;

    updateItemInAll(itemLocalId, (item) => {
      const descriptionCodeKey =
        item.category === 'doors'
          ? 'door_description_code'
          : item.category === 'frames'
          ? 'frame_description'
          : null;
      const changedField = item.fields.find((f) => f.localId === fieldLocalId);
      const isDescriptionCodeField =
        descriptionCodeKey !== null && changedField?.fieldKey === descriptionCodeKey;
      return {
        ...item,
        ...(isDescriptionCodeField && value ? { itemLabel: value } : {}),
        fields: item.fields.map((f) =>
          f.localId === fieldLocalId ? { ...f, fieldValue: value } : f
        ),
      };
    });

    // Mirror the value to matching frame fields when pass_value_to_frame is set
    if (doorItem && changedFieldKey && passToFrameKeys.has(changedFieldKey)) {
      setFrameItems((prev) => syncDoorFieldToFrames(prev, changedFieldKey, value));
    }
  };

  const handleDeleteField = (itemLocalId: string, fieldLocalId: string) => {
    updateItemInAll(itemLocalId, (item) => ({
      ...item,
      fields: item.fields.filter((f) => f.localId !== fieldLocalId),
    }));
  };

  const handleAddField = (itemLocalId: string, field: Omit<LocalField, 'localId'>) => {
    updateItemInAll(itemLocalId, (item) => ({
      ...item,
      fields: [...item.fields, { ...field, localId: newLocalId() }],
    }));
  };

  const handleUpdateHwField = (hwLocalId: string, fieldLocalId: string, value: string) => {
    setHardwareItems((prev) =>
      prev.map((h) =>
        h.localId === hwLocalId
          ? { ...h, fields: h.fields.map((f) => (f.localId === fieldLocalId ? { ...f, fieldValue: value } : f)) }
          : h
      )
    );
  };

  const handleDeleteHwField = (hwLocalId: string, fieldLocalId: string) => {
    setHardwareItems((prev) =>
      prev.map((h) =>
        h.localId === hwLocalId
          ? { ...h, fields: h.fields.filter((f) => f.localId !== fieldLocalId) }
          : h
      )
    );
  };

  const handleAddHwField = (hwLocalId: string, field: Omit<LocalField, 'localId'>) => {
    setHardwareItems((prev) =>
      prev.map((h) =>
        h.localId === hwLocalId
          ? { ...h, fields: [...h.fields, { ...field, localId: newLocalId() }] }
          : h
      )
    );
  };

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setSaveError(null);

    try {
      let openingData: EstimateOpening;

      if (editingOpening) {
        // Update name/quantity, then replace all items
        openingData = await updateEstimateOpening(editingOpening.id, {
          name: name.trim(),
          quantity,
        });

        // Delete opening-level hardware (new style)
        for (const hw of editingOpening.hardware ?? []) {
          await deleteEstimateItem(hw.id);
        }
        // Delete legacy nested hardware first (FK constraint), then top-level items
        for (const item of editingOpening.items) {
          for (const hw of item.hardware) {
            await deleteEstimateItem(hw.id);
          }
          await deleteEstimateItem(item.id);
        }
      } else {
        openingData = await createEstimateOpening(estimateId, name.trim(), quantity);
      }

      const saveLocalFields = async (
        itemId: string,
        fields: LocalField[]
      ): Promise<ItemField[]> => {
        const saved: ItemField[] = [];
        // Build a map of parent field def ID → current value for conditional evaluation
        const parentValueByDefId = new Map<string, string>();
        for (const f of fields) {
          if (f.fieldDefinitionId && !f.conditionalParentDefId) {
            parentValueByDefId.set(f.fieldDefinitionId, f.fieldValue);
          }
        }
        for (const field of fields) {
          if (!field.fieldKey.trim()) continue;
          // Skip conditional children whose trigger condition is not currently met
          if (field.conditionalParentDefId !== undefined) {
            const parentValue = parentValueByDefId.get(field.conditionalParentDefId) ?? null;
            if (!evaluateDependency(parentValue, field.conditionOperator!, field.conditionTriggerValues!)) {
              continue;
            }
          }
          const f = await addItemField(itemId, {
            fieldKey: field.fieldKey,
            fieldLabel: field.fieldLabel,
            fieldValue: field.fieldValue,
            valueType: field.valueType,
            fieldDefinitionId: field.fieldDefinitionId,
          });
          saved.push(f);
          if (field.fieldDefinitionId && field.fieldValue.trim()) {
            recordFieldValueUsage(field.fieldDefinitionId, field.fieldValue.trim()).catch(console.error);
          }
        }
        return saved;
      };

      // Save door, frame, and panel items (no hardware children)
      const allItems = [...doorItems, ...frameItems, ...panelItems];
      const itemsWithHardware: EstimateItemWithHardware[] = [];

      for (const localItem of allItems) {
        const created = await addEstimateItem(estimateId, {
          itemLabel: localItem.itemLabel,
          canonicalCode: localItem.canonicalCode,
          quantity: 1,
          sortOrder: itemsWithHardware.length,
          openingId: openingData.id,
          parentItemId: null,
          itemType: localItem.category,
        });
        await saveLocalFields(created.id, localItem.fields);
        itemsWithHardware.push({ ...created, hardware: [] });
      }

      // Save opening-level hardware items (parent_item_id = null, subcategory set)
      const savedHardware = [];
      for (let i = 0; i < hardwareItems.length; i++) {
        const hw = hardwareItems[i];
        const created = await addEstimateItem(estimateId, {
          itemLabel: hw.itemLabel,
          canonicalCode: hw.canonicalCode,
          quantity: 1,
          sortOrder: i,
          openingId: openingData.id,
          parentItemId: null,
          subcategory: hw.subcategory,
        });
        await saveLocalFields(created.id, hw.fields);
        savedHardware.push(created);
      }

      const result: EstimateOpeningWithItems = {
        ...openingData,
        items: itemsWithHardware,
        hardware: savedHardware,
      };

      if (editingOpening) {
        onUpdated?.(result);
      } else {
        onSaved(result);
      }
      onOpenChange(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to save opening.'
      );
    } finally {
      setSaving(false);
    }
  };

  const totalItems = doorItems.length + frameItems.length + panelItems.length;
  const canSave = name.trim().length > 0;

  // Group hardware by subcategory for display
  const hardwareGroups = groupHardwareBySubcategory(hardwareItems);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {editingOpening ? 'Edit Opening' : 'Build Opening'}
          </DialogTitle>
          <DialogDescription>
            {editingOpening
              ? 'Update the name, quantity, doors, frames, and hardware for this opening.'
              : 'Add doors and frames to this opening, then attach hardware to each.'}
          </DialogDescription>
        </DialogHeader>

        {/* Name + Quantity */}
        <div className="grid grid-cols-[1fr_100px] gap-3 mt-1">
          <div className="space-y-1.5">
            <Label htmlFor="opening-name">
              Opening Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="opening-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Entrance"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opening-qty">Quantity</Label>
            <Input
              id="opening-qty"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
            />
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          <div className="space-y-5 py-2">

            {/* ── Doors ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <DoorOpen className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Doors</span>
                {doorItems.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {doorItems.length}
                  </Badge>
                )}
              </div>

              {doorItems.map((item) => (
                <ItemCard
                  key={item.localId}
                  item={item}
                  addFieldFormOpenForId={addFieldFormOpenForId}
                  onDelete={(lid) => handleDeleteItem('doors', lid)}
                  onUpdateField={handleUpdateField}
                  onDeleteField={handleDeleteField}
                  onAddField={handleAddField}
                  onToggleAddFieldForm={setAddFieldFormOpenForId}
                />
              ))}

              <Button
                variant="outline"
                className="w-full border-dashed text-muted-foreground hover:text-foreground"
                onClick={() => setDoorModalOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Door
              </Button>
            </div>

            <Separator />

            {/* ── Frame ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Square className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Frame</span>
                {frameItems.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {frameItems.length}
                  </Badge>
                )}
              </div>

              {frameItems.map((item) => (
                <ItemCard
                  key={item.localId}
                  item={item}
                  addFieldFormOpenForId={addFieldFormOpenForId}
                  onDelete={(lid) => handleDeleteItem('frames', lid)}
                  onUpdateField={handleUpdateField}
                  onDeleteField={handleDeleteField}
                  onAddField={handleAddField}
                  onToggleAddFieldForm={setAddFieldFormOpenForId}
                />
              ))}

              <Button
                variant="outline"
                className="w-full border-dashed text-muted-foreground hover:text-foreground"
                onClick={() => setFrameModalOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Frame
              </Button>
            </div>

            {totalItems === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-center rounded-lg border border-dashed bg-muted/20">
                <AlertCircle className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">
                  Add at least one door or frame to this opening.
                </p>
              </div>
            )}

            <Separator />

            {/* ── Panels ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <LayoutPanelLeft className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Panels</span>
                {panelItems.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {panelItems.length}
                  </Badge>
                )}
              </div>

              {panelItems.map((item) => (
                <ItemCard
                  key={item.localId}
                  item={item}
                  addFieldFormOpenForId={addFieldFormOpenForId}
                  onDelete={(lid) => handleDeleteItem('panels', lid)}
                  onUpdateField={handleUpdateField}
                  onDeleteField={handleDeleteField}
                  onAddField={handleAddField}
                  onToggleAddFieldForm={setAddFieldFormOpenForId}
                />
              ))}

              <Button
                variant="outline"
                className="w-full border-dashed text-muted-foreground hover:text-foreground"
                onClick={() => setPanelModalOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Panel
              </Button>
            </div>

            <Separator />

            {/* ── Hardware (opening-level, grouped by subcategory) ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Hardware</span>
                {hardwareItems.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {hardwareItems.length}
                  </Badge>
                )}
              </div>

              {hardwareGroups.map((group) => (
                <div key={group.key} className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-0.5">
                    {group.label}
                  </p>
                  {group.items.map((hw) => (
                    <HardwareItemCard
                      key={hw.localId}
                      hw={hw}
                      addFieldFormOpenForId={addHwFieldFormOpenForId}
                      onDelete={handleDeleteHardware}
                      onUpdateField={handleUpdateHwField}
                      onDeleteField={handleDeleteHwField}
                      onAddField={handleAddHwField}
                      onToggleAddFieldForm={setAddHwFieldFormOpenForId}
                    />
                  ))}
                </div>
              ))}

              {hardwareItems.length === 0 && (
                <p className="text-xs text-muted-foreground italic px-0.5">
                  No hardware added yet.
                </p>
              )}

              <Button
                variant="outline"
                className="w-full border-dashed text-muted-foreground hover:text-foreground"
                onClick={() => setHardwareModalOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Hardware
              </Button>
            </div>

          </div>
        </div>

        {/* AddItemModals — nested inside this Dialog via Radix portal */}
        <AddItemModal
          category="doors"
          title="Add Door"
          itemTypes={itemTypes}
          itemTypesLoading={itemTypesLoading}
          open={doorModalOpen}
          onOpenChange={setDoorModalOpen}
          onSaveTopLevel={handleSelectDoor}
          onSaveHardware={() => {}}
        />
        <AddItemModal
          category="frames"
          title="Add Frame"
          itemTypes={itemTypes}
          itemTypesLoading={itemTypesLoading}
          open={frameModalOpen}
          onOpenChange={setFrameModalOpen}
          onSaveTopLevel={handleSelectFrame}
          onSaveHardware={() => {}}
          passToFrameKeys={passToFrameKeys}
          sourceDoor={doorItems[doorItems.length - 1]}
        />
        <AddItemModal
          category="panels"
          title="Add Panel"
          itemTypes={itemTypes}
          itemTypesLoading={itemTypesLoading}
          open={panelModalOpen}
          onOpenChange={setPanelModalOpen}
          onSaveTopLevel={handleSelectPanel}
          onSaveHardware={() => {}}
        />
        <AddItemModal
          category="hardware"
          title="Add Hardware"
          itemTypes={itemTypes}
          itemTypesLoading={itemTypesLoading}
          open={hardwareModalOpen}
          onOpenChange={setHardwareModalOpen}
          onSaveTopLevel={() => {}}
          onSaveHardware={handleSelectHardware}
        />

        {saveError && (
          <p className="text-sm text-destructive flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </p>
        )}

        <DialogFooter className="mt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editingOpening ? 'Update Opening' : 'Save Opening'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
