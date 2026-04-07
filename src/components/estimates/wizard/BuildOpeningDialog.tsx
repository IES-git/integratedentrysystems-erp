import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Loader2,
  DoorOpen,
  Square,
  Wrench,
  ChevronsUpDown,
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
  getItemTypeFields,
  getMostRecentFieldValuesForItem,
  getFieldValueOptions,
  recordFieldValueUsage,
  updateEstimateOpening,
  deleteEstimateItem,
} from '@/lib/estimates-api';
import {
  groupHardwareBySubcategory,
  HARDWARE_SUBCATEGORY_ORDER,
  HARDWARE_SUBCATEGORY_LABEL,
} from '@/lib/hardware-utils';
import type {
  ItemType,
  ItemCategory,
  EstimateOpening,
  EstimateOpeningWithItems,
  EstimateItemWithHardware,
  FieldValueType,
  FieldValueOption,
  ItemField,
  HardwareSubcategory,
} from '@/types';

const newLocalId = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

interface LocalField {
  localId: string;
  fieldKey: string;
  fieldLabel: string;
  fieldValue: string;
  valueType: FieldValueType;
  fieldDefinitionId?: string;
  isRequired: boolean;
}

interface LocalHardwareItem {
  localId: string;
  itemLabel: string;
  canonicalCode: string;
  subcategory: HardwareSubcategory | null;
  loadingFields: boolean;
  fields: LocalField[];
}

interface LocalTopLevelItem {
  localId: string;
  itemLabel: string;
  canonicalCode: string;
  category: 'doors' | 'frames';
  loadingFields: boolean;
  fields: LocalField[];
}

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
// ItemCatalogPicker — searchable combobox filtered by category
// ---------------------------------------------------------------------------

interface ItemCatalogPickerProps {
  itemTypes: ItemType[];
  loading: boolean;
  category: ItemCategory;
  placeholder?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: ItemType) => void;
  children: React.ReactNode;
}

function CatalogCommandItem({
  it,
  onSelect,
  onOpenChange,
}: {
  it: ItemType;
  onSelect: (item: ItemType) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <CommandItem
      key={it.canonicalCode}
      value={`${it.itemLabel} ${it.canonicalCode} ${it.series ?? ''} ${it.material ?? ''} ${it.subcategory ?? ''}`}
      onSelect={() => {
        onSelect(it);
        onOpenChange(false);
      }}
    >
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{it.itemLabel}</span>
          <Badge variant="secondary" className="font-mono text-[10px] shrink-0">
            {it.canonicalCode}
          </Badge>
        </div>
        {(it.usageCount > 0 || it.series || it.material) && (
          <span className="text-[11px] text-muted-foreground">
            {it.usageCount > 0 && `${it.usageCount} use${it.usageCount !== 1 ? 's' : ''}`}
            {it.series ? ` · ${it.series}` : ''}
            {it.material ? ` · ${it.material}` : ''}
          </span>
        )}
      </div>
    </CommandItem>
  );
}

function ItemCatalogPicker({
  itemTypes,
  loading,
  category,
  placeholder = 'Search items…',
  open,
  onOpenChange,
  onSelect,
  children,
}: ItemCatalogPickerProps) {
  const filtered = itemTypes.filter((it) => it.category === category);

  const hardwareGroups =
    category === 'hardware'
      ? HARDWARE_SUBCATEGORY_ORDER.map((sub) => ({
          key: sub,
          label: HARDWARE_SUBCATEGORY_LABEL[sub],
          items: filtered.filter((it) => it.subcategory === sub),
        })).filter((g) => g.items.length > 0)
      : [];

  const discoveredHardware =
    category === 'hardware' ? filtered.filter((it) => !it.subcategory) : [];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={placeholder} className="h-9" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : category === 'hardware' ? (
              <>
                <CommandEmpty>No hardware found.</CommandEmpty>
                {hardwareGroups.map((group) => (
                  <CommandGroup key={group.key} heading={group.label}>
                    {group.items.map((it) => (
                      <CatalogCommandItem
                        key={it.canonicalCode}
                        it={it}
                        onSelect={onSelect}
                        onOpenChange={onOpenChange}
                      />
                    ))}
                  </CommandGroup>
                ))}
                {discoveredHardware.length > 0 && (
                  <CommandGroup heading="Discovered">
                    {discoveredHardware.map((it) => (
                      <CatalogCommandItem
                        key={it.canonicalCode}
                        it={it}
                        onSelect={onSelect}
                        onOpenChange={onOpenChange}
                      />
                    ))}
                  </CommandGroup>
                )}
              </>
            ) : (
              <>
                <CommandEmpty>No items found.</CommandEmpty>
                <CommandGroup>
                  {filtered.map((it) => (
                    <CatalogCommandItem
                      key={it.canonicalCode}
                      it={it}
                      onSelect={onSelect}
                      onOpenChange={onOpenChange}
                    />
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
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

  return (
    <div className="rounded-md border divide-y mt-2">
      {fields.map((field) => (
        <FieldRow
          key={field.localId}
          field={field}
          onUpdate={(val) => onUpdateField(field.localId, val)}
          onDelete={() => onDeleteField(field.localId)}
        />
      ))}
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
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(hw.localId)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="px-3 pb-2">
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
  const [hardwareItems, setHardwareItems] = useState<LocalHardwareItem[]>([]);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [itemTypesLoading, setItemTypesLoading] = useState(false);
  const [doorPickerOpen, setDoorPickerOpen] = useState(false);
  const [framePickerOpen, setFramePickerOpen] = useState(false);
  const [hardwarePickerOpen, setHardwarePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addFieldFormOpenForId, setAddFieldFormOpenForId] = useState<string | null>(null);
  const [addHwFieldFormOpenForId, setAddHwFieldFormOpenForId] = useState<string | null>(null);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openingCount, editingOpening?.id]);

  // Convert a saved opening's items back into local draft state for editing
  const populateFromExistingOpening = (
    opening: EstimateOpeningWithItems,
    types: ItemType[]
  ) => {
    const doors: LocalTopLevelItem[] = [];
    const frames: LocalTopLevelItem[] = [];

    for (const item of opening.items) {
      const matchedType = types.find((t) => t.canonicalCode === item.canonicalCode);
      let category: 'doors' | 'frames' = 'doors';
      if (matchedType?.category === 'frames') {
        category = 'frames';
      } else if (matchedType?.category !== 'doors') {
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
      } else {
        frames.push(localItem);
      }
    }

    setDoorItems(doors);
    setFrameItems(frames);

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

  // Build a LocalTopLevelItem from a selected ItemType
  const buildLocalItem = useCallback(
    async (itemType: ItemType, category: 'doors' | 'frames'): Promise<LocalTopLevelItem> => {
      const localId = newLocalId();
      const item: LocalTopLevelItem = {
        localId,
        itemLabel: itemType.itemLabel,
        canonicalCode: itemType.canonicalCode,
        category,
        loadingFields: true,
        fields: [],
      };

      Promise.all([
        getItemTypeFields(itemType.canonicalCodes ?? [itemType.canonicalCode]),
        getMostRecentFieldValuesForItem(itemType.canonicalCodes ?? [itemType.canonicalCode]),
      ])
        .then(([allFields, recentValues]) => {
          const fields: LocalField[] = allFields
            .filter((rf) => rf.fieldDefinition)
            .map((rf) => ({
              localId: newLocalId(),
              fieldKey: rf.fieldDefinition!.fieldKey,
              fieldLabel: rf.fieldDefinition!.fieldLabel,
              fieldValue: recentValues[rf.fieldDefinition!.fieldKey] ?? '',
              valueType: rf.fieldDefinition!.valueType,
              fieldDefinitionId: rf.fieldDefinitionId,
              isRequired: rf.isRequired,
            }));

          const descriptionCodeKey =
            category === 'doors' ? 'door_description_code' : 'frame_description';
          const descriptionField = fields.find((f) => f.fieldKey === descriptionCodeKey);
          const derivedLabel = descriptionField?.fieldValue || undefined;

          const updater = (prev: LocalTopLevelItem[]) =>
            prev.map((i) =>
              i.localId === localId
                ? {
                    ...i,
                    fields,
                    loadingFields: false,
                    ...(derivedLabel ? { itemLabel: derivedLabel } : {}),
                  }
                : i
            );

          if (category === 'doors') {
            setDoorItems(updater);
          } else {
            setFrameItems(updater);
          }
        })
        .catch(() => {
          const updater = (prev: LocalTopLevelItem[]) =>
            prev.map((i) =>
              i.localId === localId ? { ...i, loadingFields: false } : i
            );
          if (category === 'doors') setDoorItems(updater);
          else setFrameItems(updater);
        });

      return item;
    },
    []
  );

  // Build a LocalHardwareItem from a selected ItemType
  const buildLocalHardware = useCallback(
    async (hwType: ItemType): Promise<LocalHardwareItem> => {
      const hwLocalId = newLocalId();
      const hw: LocalHardwareItem = {
        localId: hwLocalId,
        itemLabel: hwType.itemLabel,
        canonicalCode: hwType.canonicalCode,
        subcategory: (hwType.subcategory as HardwareSubcategory) ?? null,
        loadingFields: true,
        fields: [],
      };

      Promise.all([
        getItemTypeFields(hwType.canonicalCode),
        getMostRecentFieldValuesForItem([hwType.canonicalCode]),
      ])
        .then(([allFields, recentValues]) => {
          const fields: LocalField[] = allFields
            .filter((rf) => rf.fieldDefinition)
            .map((rf) => ({
              localId: newLocalId(),
              fieldKey: rf.fieldDefinition!.fieldKey,
              fieldLabel: rf.fieldDefinition!.fieldLabel,
              fieldValue: recentValues[rf.fieldDefinition!.fieldKey] ?? '',
              valueType: rf.fieldDefinition!.valueType,
              fieldDefinitionId: rf.fieldDefinitionId,
              isRequired: rf.isRequired,
            }));

          setHardwareItems((prev) =>
            prev.map((h) => (h.localId === hwLocalId ? { ...h, fields, loadingFields: false } : h))
          );
        })
        .catch(() => {
          setHardwareItems((prev) =>
            prev.map((h) => (h.localId === hwLocalId ? { ...h, loadingFields: false } : h))
          );
        });

      return hw;
    },
    []
  );

  const handleSelectDoor = async (itemType: ItemType) => {
    const item = await buildLocalItem(itemType, 'doors');
    setDoorItems((prev) => [...prev, item]);
  };

  const handleSelectFrame = async (itemType: ItemType) => {
    const item = await buildLocalItem(itemType, 'frames');
    setFrameItems((prev) => [...prev, item]);
  };

  const handleSelectHardware = async (hwType: ItemType) => {
    const hw = await buildLocalHardware(hwType);
    setHardwareItems((prev) => [...prev, hw]);
  };

  const handleDeleteItem = (category: 'doors' | 'frames', localId: string) => {
    if (category === 'doors') {
      setDoorItems((prev) => prev.filter((i) => i.localId !== localId));
    } else {
      setFrameItems((prev) => prev.filter((i) => i.localId !== localId));
    }
  };

  const handleDeleteHardware = (hwLocalId: string) => {
    setHardwareItems((prev) => prev.filter((h) => h.localId !== hwLocalId));
  };

  const updateItemInBoth = (
    localId: string,
    updater: (item: LocalTopLevelItem) => LocalTopLevelItem
  ) => {
    setDoorItems((prev) =>
      prev.map((i) => (i.localId === localId ? updater(i) : i))
    );
    setFrameItems((prev) =>
      prev.map((i) => (i.localId === localId ? updater(i) : i))
    );
  };

  const handleUpdateField = (itemLocalId: string, fieldLocalId: string, value: string) => {
    updateItemInBoth(itemLocalId, (item) => {
      const descriptionCodeKey =
        item.category === 'doors' ? 'door_description_code' : 'frame_description';
      const changedField = item.fields.find((f) => f.localId === fieldLocalId);
      const isDescriptionCodeField = changedField?.fieldKey === descriptionCodeKey;
      return {
        ...item,
        ...(isDescriptionCodeField && value ? { itemLabel: value } : {}),
        fields: item.fields.map((f) =>
          f.localId === fieldLocalId ? { ...f, fieldValue: value } : f
        ),
      };
    });
  };

  const handleDeleteField = (itemLocalId: string, fieldLocalId: string) => {
    updateItemInBoth(itemLocalId, (item) => ({
      ...item,
      fields: item.fields.filter((f) => f.localId !== fieldLocalId),
    }));
  };

  const handleAddField = (itemLocalId: string, field: Omit<LocalField, 'localId'>) => {
    updateItemInBoth(itemLocalId, (item) => ({
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
        for (const field of fields) {
          if (!field.fieldKey.trim()) continue;
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

      // Save door and frame items (no hardware children)
      const allItems = [...doorItems, ...frameItems];
      const itemsWithHardware: EstimateItemWithHardware[] = [];

      for (const localItem of allItems) {
        const created = await addEstimateItem(estimateId, {
          itemLabel: localItem.itemLabel,
          canonicalCode: localItem.canonicalCode,
          quantity: 1,
          sortOrder: itemsWithHardware.length,
          openingId: openingData.id,
          parentItemId: null,
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

  const totalItems = doorItems.length + frameItems.length;
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

              <ItemCatalogPicker
                itemTypes={itemTypes}
                loading={itemTypesLoading}
                category="doors"
                placeholder="Search doors…"
                open={doorPickerOpen}
                onOpenChange={setDoorPickerOpen}
                onSelect={handleSelectDoor}
              >
                <Button
                  variant="outline"
                  className="w-full border-dashed text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Door
                  <ChevronsUpDown className="h-4 w-4 ml-auto opacity-50" />
                </Button>
              </ItemCatalogPicker>
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

              <ItemCatalogPicker
                itemTypes={itemTypes}
                loading={itemTypesLoading}
                category="frames"
                placeholder="Search frames…"
                open={framePickerOpen}
                onOpenChange={setFramePickerOpen}
                onSelect={handleSelectFrame}
              >
                <Button
                  variant="outline"
                  className="w-full border-dashed text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Frame
                  <ChevronsUpDown className="h-4 w-4 ml-auto opacity-50" />
                </Button>
              </ItemCatalogPicker>
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

              <ItemCatalogPicker
                itemTypes={itemTypes}
                loading={itemTypesLoading}
                category="hardware"
                placeholder="Search hardware…"
                open={hardwarePickerOpen}
                onOpenChange={setHardwarePickerOpen}
                onSelect={handleSelectHardware}
              >
                <Button
                  variant="outline"
                  className="w-full border-dashed text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Hardware
                  <ChevronsUpDown className="h-4 w-4 ml-auto opacity-50" />
                </Button>
              </ItemCatalogPicker>
            </div>

          </div>
        </div>

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
