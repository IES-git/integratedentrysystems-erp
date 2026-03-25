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
  ChevronDown,
  ChevronUp,
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
} from '@/lib/estimates-api';
import type {
  ItemType,
  ItemCategory,
  EstimateOpeningWithItems,
  EstimateItemWithHardware,
  FieldValueType,
  FieldValueOption,
  ItemField,
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
  hardware: LocalHardwareItem[];
  hardwarePickerOpen: boolean;
  showHardware: boolean;
}

interface BuildOpeningDialogProps {
  estimateId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (opening: EstimateOpeningWithItems) => void;
  openingCount?: number;
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
            ) : (
              <>
                <CommandEmpty>No items found.</CommandEmpty>
                <CommandGroup>
                  {filtered.map((it) => (
                    <CommandItem
                      key={it.canonicalCode}
                      value={`${it.itemLabel} ${it.canonicalCode} ${it.series ?? ''} ${it.material ?? ''}`}
                      onSelect={() => {
                        onSelect(it);
                        onOpenChange(false);
                      }}
                    >
                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {it.itemLabel}
                          </span>
                          <Badge
                            variant="secondary"
                            className="font-mono text-[10px] shrink-0"
                          >
                            {it.canonicalCode}
                          </Badge>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {it.usageCount} use{it.usageCount !== 1 ? 's' : ''}
                          {it.series ? ` · ${it.series}` : ''}
                          {it.material ? ` · ${it.material}` : ''}
                        </span>
                      </div>
                    </CommandItem>
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
// ItemCard — card for a top-level door or frame item
// ---------------------------------------------------------------------------

interface ItemCardProps {
  item: LocalTopLevelItem;
  itemTypes: ItemType[];
  itemTypesLoading: boolean;
  addFieldFormOpenForId: string | null;
  addHwFieldFormOpenForId: string | null;
  onDelete: (localId: string) => void;
  onUpdateField: (itemLocalId: string, fieldLocalId: string, value: string) => void;
  onDeleteField: (itemLocalId: string, fieldLocalId: string) => void;
  onAddField: (itemLocalId: string, field: Omit<LocalField, 'localId'>) => void;
  onToggleAddFieldForm: (itemLocalId: string | null) => void;
  onToggleHardware: (itemLocalId: string) => void;
  onToggleHardwarePicker: (itemLocalId: string, open: boolean) => void;
  onSelectHardware: (parentLocalId: string, hwType: ItemType) => void;
  onDeleteHardware: (parentLocalId: string, hwLocalId: string) => void;
  onUpdateHwField: (
    parentLocalId: string,
    hwLocalId: string,
    fieldLocalId: string,
    value: string
  ) => void;
  onDeleteHwField: (
    parentLocalId: string,
    hwLocalId: string,
    fieldLocalId: string
  ) => void;
  onAddHwField: (
    parentLocalId: string,
    hwLocalId: string,
    field: Omit<LocalField, 'localId'>
  ) => void;
  onToggleAddHwFieldForm: (hwLocalId: string | null) => void;
}

function ItemCard({
  item,
  itemTypes,
  itemTypesLoading,
  addFieldFormOpenForId,
  addHwFieldFormOpenForId,
  onDelete,
  onUpdateField,
  onDeleteField,
  onAddField,
  onToggleAddFieldForm,
  onToggleHardware,
  onToggleHardwarePicker,
  onSelectHardware,
  onDeleteHardware,
  onUpdateHwField,
  onDeleteHwField,
  onAddHwField,
  onToggleAddHwFieldForm,
}: ItemCardProps) {
  return (
    <div className="rounded-lg border bg-background">
      {/* Item header */}
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

      {/* Fields */}
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

      {/* Hardware section */}
      <div className="border-t bg-muted/20 rounded-b-lg">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => onToggleHardware(item.localId)}
        >
          <Wrench className="h-3.5 w-3.5" />
          <span className="font-medium">
            Hardware
            {item.hardware.length > 0 && (
              <span className="ml-1 text-muted-foreground">
                ({item.hardware.length})
              </span>
            )}
          </span>
          {item.showHardware ? (
            <ChevronUp className="h-3.5 w-3.5 ml-auto" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 ml-auto" />
          )}
        </button>

        {item.showHardware && (
          <div className="px-3 pb-3 space-y-2">
            {item.hardware.map((hw) => (
              <div
                key={hw.localId}
                className="ml-4 rounded-md border bg-background"
              >
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
                    onClick={() => onDeleteHardware(item.localId, hw.localId)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>

                <div className="px-3 pb-2">
                  <FieldsList
                    fields={hw.fields}
                    onUpdateField={(fid, val) =>
                      onUpdateHwField(item.localId, hw.localId, fid, val)
                    }
                    onDeleteField={(fid) =>
                      onDeleteHwField(item.localId, hw.localId, fid)
                    }
                  />

                  {addHwFieldFormOpenForId === hw.localId ? (
                    <AddFieldForm
                      onAdd={(field) => {
                        onAddHwField(item.localId, hw.localId, field);
                        onToggleAddHwFieldForm(null);
                      }}
                      onCancel={() => onToggleAddHwFieldForm(null)}
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] mt-1 text-muted-foreground"
                      onClick={() => onToggleAddHwFieldForm(hw.localId)}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Field
                    </Button>
                  )}
                </div>
              </div>
            ))}

            <ItemCatalogPicker
              itemTypes={itemTypes}
              loading={itemTypesLoading}
              category="hardware"
              placeholder="Search hardware…"
              open={item.hardwarePickerOpen}
              onOpenChange={(o) => onToggleHardwarePicker(item.localId, o)}
              onSelect={(hwType) => onSelectHardware(item.localId, hwType)}
            >
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs w-full ml-4 border-dashed"
              >
                <Plus className="h-3 w-3 mr-1.5" />
                Add Hardware
                <ChevronsUpDown className="h-3 w-3 ml-auto opacity-50" />
              </Button>
            </ItemCatalogPicker>
          </div>
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
  openingCount = 0,
}: BuildOpeningDialogProps) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [doorItems, setDoorItems] = useState<LocalTopLevelItem[]>([]);
  const [frameItems, setFrameItems] = useState<LocalTopLevelItem[]>([]);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [itemTypesLoading, setItemTypesLoading] = useState(false);
  const [doorPickerOpen, setDoorPickerOpen] = useState(false);
  const [framePickerOpen, setFramePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addFieldFormOpenForId, setAddFieldFormOpenForId] = useState<string | null>(null);
  const [addHwFieldFormOpenForId, setAddHwFieldFormOpenForId] = useState<string | null>(null);

  // Load item types and reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    setName(`Opening ${openingCount + 1}`);
    setQuantity(1);
    setDoorItems([]);
    setFrameItems([]);
    setSaveError(null);
    setAddFieldFormOpenForId(null);
    setAddHwFieldFormOpenForId(null);
    setItemTypesLoading(true);
    getItemTypes()
      .then(setItemTypes)
      .catch((err) => console.error('Failed to load item types:', err))
      .finally(() => setItemTypesLoading(false));
  }, [open, openingCount]);

  // Build a LocalTopLevelItem from a selected ItemType and auto-inject required fields
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
        hardware: [],
        hardwarePickerOpen: false,
        showHardware: false,
      };

      // Kick off all fields load and recent values in parallel — we update state asynchronously
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

  const buildLocalHardware = useCallback(
    async (hwType: ItemType, parentLocalId: string) => {
      const hwLocalId = newLocalId();
      const hw: LocalHardwareItem = {
        localId: hwLocalId,
        itemLabel: hwType.itemLabel,
        canonicalCode: hwType.canonicalCode,
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

          const updater = (prev: LocalTopLevelItem[]) =>
            prev.map((item) =>
              item.localId === parentLocalId
                ? {
                    ...item,
                    hardware: item.hardware.map((h) =>
                      h.localId === hwLocalId
                        ? { ...h, fields, loadingFields: false }
                        : h
                    ),
                  }
                : item
            );
          setDoorItems(updater);
          setFrameItems(updater);
        })
        .catch(() => {
          const updater = (prev: LocalTopLevelItem[]) =>
            prev.map((item) =>
              item.localId === parentLocalId
                ? {
                    ...item,
                    hardware: item.hardware.map((h) =>
                      h.localId === hwLocalId ? { ...h, loadingFields: false } : h
                    ),
                  }
                : item
            );
          setDoorItems(updater);
          setFrameItems(updater);
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

  const handleSelectHardware = async (parentLocalId: string, hwType: ItemType) => {
    const hw = await buildLocalHardware(hwType, parentLocalId);
    const updater = (prev: LocalTopLevelItem[]) =>
      prev.map((item) =>
        item.localId === parentLocalId
          ? {
              ...item,
              hardware: [...item.hardware, hw],
              showHardware: true,
              hardwarePickerOpen: false,
            }
          : item
      );
    setDoorItems(updater);
    setFrameItems(updater);
  };

  const handleDeleteItem = (category: 'doors' | 'frames', localId: string) => {
    if (category === 'doors') {
      setDoorItems((prev) => prev.filter((i) => i.localId !== localId));
    } else {
      setFrameItems((prev) => prev.filter((i) => i.localId !== localId));
    }
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

  const handleToggleHardware = (itemLocalId: string) => {
    updateItemInBoth(itemLocalId, (item) => ({
      ...item,
      showHardware: !item.showHardware,
    }));
  };

  const handleToggleHardwarePicker = (itemLocalId: string, pickerOpen: boolean) => {
    updateItemInBoth(itemLocalId, (item) => ({
      ...item,
      hardwarePickerOpen: pickerOpen,
    }));
  };

  const handleDeleteHardware = (parentLocalId: string, hwLocalId: string) => {
    updateItemInBoth(parentLocalId, (item) => ({
      ...item,
      hardware: item.hardware.filter((h) => h.localId !== hwLocalId),
    }));
  };

  const handleUpdateHwField = (
    parentLocalId: string,
    hwLocalId: string,
    fieldLocalId: string,
    value: string
  ) => {
    updateItemInBoth(parentLocalId, (item) => ({
      ...item,
      hardware: item.hardware.map((h) =>
        h.localId === hwLocalId
          ? {
              ...h,
              fields: h.fields.map((f) =>
                f.localId === fieldLocalId ? { ...f, fieldValue: value } : f
              ),
            }
          : h
      ),
    }));
  };

  const handleDeleteHwField = (
    parentLocalId: string,
    hwLocalId: string,
    fieldLocalId: string
  ) => {
    updateItemInBoth(parentLocalId, (item) => ({
      ...item,
      hardware: item.hardware.map((h) =>
        h.localId === hwLocalId
          ? { ...h, fields: h.fields.filter((f) => f.localId !== fieldLocalId) }
          : h
      ),
    }));
  };

  const handleAddHwField = (
    parentLocalId: string,
    hwLocalId: string,
    field: Omit<LocalField, 'localId'>
  ) => {
    updateItemInBoth(parentLocalId, (item) => ({
      ...item,
      hardware: item.hardware.map((h) =>
        h.localId === hwLocalId
          ? { ...h, fields: [...h.fields, { ...field, localId: newLocalId() }] }
          : h
      ),
    }));
  };

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setSaveError(null);

    try {
      const opening = await createEstimateOpening(estimateId, name.trim(), quantity);

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

      const allItems = [...doorItems, ...frameItems];
      const itemsWithHardware: EstimateItemWithHardware[] = [];

      for (const localItem of allItems) {
        const created = await addEstimateItem(estimateId, {
          itemLabel: localItem.itemLabel,
          canonicalCode: localItem.canonicalCode,
          quantity: 1,
          sortOrder: itemsWithHardware.length,
          openingId: opening.id,
          parentItemId: null,
        });

        await saveLocalFields(created.id, localItem.fields);

        const hardware = [];
        for (const hw of localItem.hardware) {
          const createdHw = await addEstimateItem(estimateId, {
            itemLabel: hw.itemLabel,
            canonicalCode: hw.canonicalCode,
            quantity: 1,
            sortOrder: hardware.length,
            openingId: opening.id,
            parentItemId: created.id,
          });
          await saveLocalFields(createdHw.id, hw.fields);
          hardware.push({ ...createdHw, hardware: [] });
        }

        itemsWithHardware.push({ ...created, hardware });
      }

      onSaved({ ...opening, items: itemsWithHardware });
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

  const sharedItemCardProps = {
    itemTypes,
    itemTypesLoading,
    addFieldFormOpenForId,
    addHwFieldFormOpenForId,
    onUpdateField: handleUpdateField,
    onDeleteField: handleDeleteField,
    onAddField: handleAddField,
    onToggleAddFieldForm: setAddFieldFormOpenForId,
    onToggleHardware: handleToggleHardware,
    onToggleHardwarePicker: handleToggleHardwarePicker,
    onSelectHardware: handleSelectHardware,
    onDeleteHardware: handleDeleteHardware,
    onUpdateHwField: handleUpdateHwField,
    onDeleteHwField: handleDeleteHwField,
    onAddHwField: handleAddHwField,
    onToggleAddHwFieldForm: setAddHwFieldFormOpenForId,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Build Opening</DialogTitle>
          <DialogDescription>
            Add doors and frames to this opening, then attach hardware to each.
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
            {/* Doors */}
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
                  onDelete={(lid) => handleDeleteItem('doors', lid)}
                  {...sharedItemCardProps}
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

            {/* Frame */}
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
                  onDelete={(lid) => handleDeleteItem('frames', lid)}
                  {...sharedItemCardProps}
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
            Save Opening
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
