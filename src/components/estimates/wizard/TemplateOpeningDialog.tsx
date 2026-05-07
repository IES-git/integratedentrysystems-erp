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
  LayoutTemplate,
  Search,
  ChevronDown,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import {
  HARDWARE_SUBCATEGORY_ORDER,
  HARDWARE_SUBCATEGORY_LABEL,
} from '@/lib/hardware-utils';
import type {
  ItemType,
  ItemCategory,
  EstimateOpeningWithItems,
  FieldValueType,
  FieldValueOption,
  ItemField,
  HardwareSubcategory,
  OpeningTemplateType,
} from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEMPLATE_LABELS: Record<OpeningTemplateType, string> = {
  single: 'Single',
  pair: 'Pair',
  single_with_panel: 'Single w/ Panel',
  pair_with_panel: 'Pair w/ Panel',
};

const ALL_TEMPLATE_TYPES: OpeningTemplateType[] = [
  'single',
  'pair',
  'single_with_panel',
  'pair_with_panel',
];

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TemplateOpeningDialogProps {
  estimateId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (opening: EstimateOpeningWithItems) => void;
  openingCount?: number;
  initialTemplateType: OpeningTemplateType;
}

// ---------------------------------------------------------------------------
// ItemCatalogPicker
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
// FieldRow
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
            <span className="text-destructive font-bold" title="Required">*</span>
          )}
        </p>
        <p className="text-[10px] font-mono text-muted-foreground/60">{field.fieldKey}</p>
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
// FieldsList
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
// AddFieldForm
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
// ItemSlotCard — a selected door/frame item with fields and a clear button
// ---------------------------------------------------------------------------

interface ItemSlotCardProps {
  item: LocalTopLevelItem;
  slotLabel: string;
  addFieldFormOpenForId: string | null;
  onClear: () => void;
  onUpdateField: (itemLocalId: string, fieldLocalId: string, value: string) => void;
  onDeleteField: (itemLocalId: string, fieldLocalId: string) => void;
  onAddField: (itemLocalId: string, field: Omit<LocalField, 'localId'>) => void;
  onToggleAddFieldForm: (itemLocalId: string | null) => void;
}

function ItemSlotCard({
  item,
  slotLabel,
  addFieldFormOpenForId,
  onClear,
  onUpdateField,
  onDeleteField,
  onAddField,
  onToggleAddFieldForm,
}: ItemSlotCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
            {slotLabel}
          </p>
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
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse fields' : 'Expand fields'}
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform duration-150', expanded && 'rotate-180')}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onClear}
          title="Remove"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {expanded && (
        <div className="border-t px-3 pb-2 pt-2">
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HardwareItemCard
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
    <div className="rounded-md border bg-background">
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
// HardwareTabs — tabbed hardware picker by subcategory
// ---------------------------------------------------------------------------

const ALL_HW_TABS: Array<{ key: HardwareSubcategory | 'other'; label: string }> = [
  ...HARDWARE_SUBCATEGORY_ORDER.map((sub) => ({ key: sub as HardwareSubcategory | 'other', label: HARDWARE_SUBCATEGORY_LABEL[sub] })),
  { key: 'other', label: 'Other' },
];

interface HardwareTabsProps {
  itemTypes: ItemType[];
  loading: boolean;
  hardwareItems: LocalHardwareItem[];
  activeTab: HardwareSubcategory | 'other';
  onActiveTabChange: (tab: HardwareSubcategory | 'other') => void;
  hwSearchQuery: Record<string, string>;
  onHwSearchQueryChange: (state: Record<string, string>) => void;
  addHwFieldFormOpenForId: string | null;
  onDeleteHardware: (localId: string) => void;
  onUpdateHwField: (hwLocalId: string, fieldLocalId: string, value: string) => void;
  onDeleteHwField: (hwLocalId: string, fieldLocalId: string) => void;
  onAddHwField: (hwLocalId: string, field: Omit<LocalField, 'localId'>) => void;
  onToggleAddHwFieldForm: (hwLocalId: string | null) => void;
  onSelectHardware: (hwType: ItemType) => void;
}

function HardwareTabs({
  itemTypes,
  loading,
  hardwareItems,
  activeTab,
  onActiveTabChange,
  hwSearchQuery,
  onHwSearchQueryChange,
  addHwFieldFormOpenForId,
  onDeleteHardware,
  onUpdateHwField,
  onDeleteHwField,
  onAddHwField,
  onToggleAddHwFieldForm,
  onSelectHardware,
}: HardwareTabsProps) {
  const allHardware = itemTypes.filter((it) => it.category === 'hardware');

  const getTabItems = (tabKey: HardwareSubcategory | 'other') =>
    hardwareItems.filter((hw) =>
      tabKey === 'other' ? !hw.subcategory : hw.subcategory === tabKey
    );

  const getCatalogItems = (tabKey: HardwareSubcategory | 'other') =>
    allHardware.filter((it) =>
      tabKey === 'other' ? !it.subcategory : it.subcategory === tabKey
    );

  const getTabCount = (tabKey: HardwareSubcategory | 'other') =>
    getTabItems(tabKey).length;

  // Only show tabs that have catalog items available OR already have selected items
  const visibleTabs = ALL_HW_TABS.filter(
    (t) => getCatalogItems(t.key).length > 0 || getTabCount(t.key) > 0
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => onActiveTabChange(v as HardwareSubcategory | 'other')}
    >
      <TabsList className="w-full h-auto flex-wrap gap-1 bg-muted/50 p-1">
        {visibleTabs.map((tab) => {
          const count = getTabCount(tab.key);
          return (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="flex-1 text-xs data-[state=active]:shadow-sm"
            >
              {tab.label}
              {count > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-4 min-w-4 px-1 text-[10px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  {count}
                </Badge>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {visibleTabs.map((tab) => {
        const tabItems = getTabItems(tab.key);
        const catalogItems = getCatalogItems(tab.key);
        const searchQuery = hwSearchQuery[tab.key] ?? '';
        const filteredCatalog = searchQuery.trim()
          ? catalogItems.filter((it) =>
              `${it.itemLabel} ${it.canonicalCode} ${it.series ?? ''} ${it.material ?? ''}`
                .toLowerCase()
                .includes(searchQuery.toLowerCase())
            )
          : catalogItems;

        return (
          <TabsContent key={tab.key} value={tab.key} className="mt-3 space-y-2">
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder={`Search ${tab.label}…`}
                value={searchQuery}
                onChange={(e) =>
                  onHwSearchQueryChange({ ...hwSearchQuery, [tab.key]: e.target.value })
                }
                className="w-full h-8 pl-8 pr-3 text-xs rounded-md border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Catalog grid — items to pick from */}
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : filteredCatalog.length === 0 ? (
              <p className="text-xs text-muted-foreground italic text-center py-3">
                {searchQuery ? 'No items match your search.' : `No ${tab.label} items available.`}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-1 max-h-36 overflow-y-auto rounded-md border bg-muted/20 p-1">
                {filteredCatalog.map((it) => {
                  const alreadySelected = hardwareItems.some(
                    (hw) => hw.canonicalCode === it.canonicalCode
                  );
                  return (
                    <button
                      key={it.canonicalCode}
                      type="button"
                      onClick={() => {
                        if (!alreadySelected) onSelectHardware(it);
                      }}
                      disabled={alreadySelected}
                      className={cn(
                        'flex items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors',
                        alreadySelected
                          ? 'opacity-50 cursor-default bg-primary/5'
                          : 'hover:bg-background hover:shadow-sm cursor-pointer'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-medium truncate block">{it.itemLabel}</span>
                        {(it.series || it.material) && (
                          <span className="text-[10px] text-muted-foreground">
                            {[it.series, it.material].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                      <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                        {it.canonicalCode}
                      </Badge>
                      {alreadySelected && (
                        <span className="text-[10px] text-primary font-medium shrink-0">Added</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Selected hardware for this tab */}
            {tabItems.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Selected ({tabItems.length})
                </p>
                {tabItems.map((hw) => (
                  <HardwareItemCard
                    key={hw.localId}
                    hw={hw}
                    addFieldFormOpenForId={addHwFieldFormOpenForId}
                    onDelete={onDeleteHardware}
                    onUpdateField={onUpdateHwField}
                    onDeleteField={onDeleteHwField}
                    onAddField={onAddHwField}
                    onToggleAddFieldForm={onToggleAddHwFieldForm}
                  />
                ))}
              </div>
            )}

            {tabItems.length === 0 && !loading && filteredCatalog.length > 0 && (
              <p className="text-xs text-muted-foreground italic text-center py-1">
                Click an item above to add it.
              </p>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// TemplateOpeningDialog
// ---------------------------------------------------------------------------

export function TemplateOpeningDialog({
  estimateId,
  open,
  onOpenChange,
  onSaved,
  openingCount = 0,
  initialTemplateType,
}: TemplateOpeningDialogProps) {
  const [templateType, setTemplateType] = useState<OpeningTemplateType>(initialTemplateType);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);

  // Door slots: slot1 = "Door" (single) or "Active Door" (pair), slot2 = "Inactive Door" (pair only)
  const [doorSlot1, setDoorSlot1] = useState<LocalTopLevelItem | null>(null);
  const [doorSlot2, setDoorSlot2] = useState<LocalTopLevelItem | null>(null);
  const [frameSlot, setFrameSlot] = useState<LocalTopLevelItem | null>(null);
  const [hardwareItems, setHardwareItems] = useState<LocalHardwareItem[]>([]);

  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [itemTypesLoading, setItemTypesLoading] = useState(false);

  const [door1PickerOpen, setDoor1PickerOpen] = useState(false);
  const [door2PickerOpen, setDoor2PickerOpen] = useState(false);
  const [framePickerOpen, setFramePickerOpen] = useState(false);
  const [activeHwTab, setActiveHwTab] = useState<HardwareSubcategory | 'other'>('swing_it');
  const [hwSearchQuery, setHwSearchQuery] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addFieldFormOpenForId, setAddFieldFormOpenForId] = useState<string | null>(null);
  const [addHwFieldFormOpenForId, setAddHwFieldFormOpenForId] = useState<string | null>(null);

  const isPair = templateType === 'pair' || templateType === 'pair_with_panel';

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    setTemplateType(initialTemplateType);
    setName(`Opening ${openingCount + 1}`);
    setQuantity(1);
    setDoorSlot1(null);
    setDoorSlot2(null);
    setFrameSlot(null);
    setHardwareItems([]);
    setSaveError(null);
    setAddFieldFormOpenForId(null);
    setAddHwFieldFormOpenForId(null);
    setItemTypesLoading(true);
    getItemTypes()
      .then(setItemTypes)
      .catch((err) => console.error('Failed to load item types:', err))
      .finally(() => setItemTypesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openingCount]);

  // When switching from pair to single, clear the inactive door slot
  useEffect(() => {
    if (templateType === 'single' || templateType === 'single_with_panel') {
      setDoorSlot2(null);
    }
  }, [templateType]);

  // ---------------------------------------------------------------------------
  // Build helpers
  // ---------------------------------------------------------------------------

  const buildLocalItem = useCallback(
    async (
      itemType: ItemType,
      category: 'doors' | 'frames',
      setter: React.Dispatch<React.SetStateAction<LocalTopLevelItem | null>>
    ): Promise<LocalTopLevelItem> => {
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

          setter((prev) =>
            prev?.localId === localId
              ? {
                  ...prev,
                  fields,
                  loadingFields: false,
                  ...(derivedLabel ? { itemLabel: derivedLabel } : {}),
                }
              : prev
          );
        })
        .catch(() => {
          setter((prev) =>
            prev?.localId === localId ? { ...prev, loadingFields: false } : prev
          );
        });

      return item;
    },
    []
  );

  const buildLocalHardware = useCallback(async (hwType: ItemType): Promise<LocalHardwareItem> => {
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
  }, []);

  // ---------------------------------------------------------------------------
  // Slot updaters (shared for slot1 / slot2 / frame)
  // ---------------------------------------------------------------------------

  const makeSlotFieldUpdater = (
    setter: React.Dispatch<React.SetStateAction<LocalTopLevelItem | null>>
  ) => ({
    updateField: (itemLocalId: string, fieldLocalId: string, value: string) => {
      setter((prev) => {
        if (!prev || prev.localId !== itemLocalId) return prev;
        const descriptionCodeKey =
          prev.category === 'doors' ? 'door_description_code' : 'frame_description';
        const changedField = prev.fields.find((f) => f.localId === fieldLocalId);
        const isDesc = changedField?.fieldKey === descriptionCodeKey;
        return {
          ...prev,
          ...(isDesc && value ? { itemLabel: value } : {}),
          fields: prev.fields.map((f) =>
            f.localId === fieldLocalId ? { ...f, fieldValue: value } : f
          ),
        };
      });
    },
    deleteField: (itemLocalId: string, fieldLocalId: string) => {
      setter((prev) =>
        prev?.localId === itemLocalId
          ? { ...prev, fields: prev.fields.filter((f) => f.localId !== fieldLocalId) }
          : prev
      );
    },
    addField: (itemLocalId: string, field: Omit<LocalField, 'localId'>) => {
      setter((prev) =>
        prev?.localId === itemLocalId
          ? { ...prev, fields: [...prev.fields, { ...field, localId: newLocalId() }] }
          : prev
      );
    },
  });

  const slot1Ops = makeSlotFieldUpdater(setDoorSlot1);
  const slot2Ops = makeSlotFieldUpdater(setDoorSlot2);
  const frameOps = makeSlotFieldUpdater(setFrameSlot);

  // ---------------------------------------------------------------------------
  // Hardware handlers
  // ---------------------------------------------------------------------------

  const handleSelectHardware = async (hwType: ItemType) => {
    const hw = await buildLocalHardware(hwType);
    setHardwareItems((prev) => [...prev, hw]);
  };

  const handleDeleteHardware = (hwLocalId: string) => {
    setHardwareItems((prev) => prev.filter((h) => h.localId !== hwLocalId));
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
      const openingData = await createEstimateOpening(estimateId, name.trim(), quantity, templateType);

      const saveLocalFields = async (itemId: string, fields: LocalField[]) => {
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

      // Collect top-level items in order
      const topLevelItems: LocalTopLevelItem[] = [
        ...(doorSlot1 ? [doorSlot1] : []),
        ...(doorSlot2 ? [doorSlot2] : []),
        ...(frameSlot ? [frameSlot] : []),
      ];

      const itemsWithHardware = [];
      for (let i = 0; i < topLevelItems.length; i++) {
        const localItem = topLevelItems[i];
        const created = await addEstimateItem(estimateId, {
          itemLabel: localItem.itemLabel,
          canonicalCode: localItem.canonicalCode,
          quantity: 1,
          sortOrder: i,
          openingId: openingData.id,
          parentItemId: null,
        });
        await saveLocalFields(created.id, localItem.fields);
        itemsWithHardware.push({ ...created, hardware: [] });
      }

      // Save hardware
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

      onSaved({ ...openingData, items: itemsWithHardware, hardware: savedHardware });
      onOpenChange(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save opening.');
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    name.trim().length > 0 &&
    doorSlot1 !== null &&
    frameSlot !== null &&
    (!isPair || doorSlot2 !== null);

  const slot1Label = isPair ? 'Active Door' : 'Door';
  const slot2Label = 'Inactive Door';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            <LayoutTemplate className="h-5 w-5 text-primary" />
            New Opening
          </DialogTitle>
          <DialogDescription>
            Configure the opening type and select the required doors and frame.
          </DialogDescription>
        </DialogHeader>

        {/* Template type selector + Name + Quantity */}
        <div className="space-y-3 mt-1">
          <div className="space-y-1.5">
            <Label>Opening Type</Label>
            <Select
              value={templateType}
              onValueChange={(v) => setTemplateType(v as OpeningTemplateType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_TEMPLATE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TEMPLATE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-[1fr_100px] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-opening-name">
                Opening Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tpl-opening-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Main Entrance"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-opening-qty">Quantity</Label>
              <Input
                id="tpl-opening-qty"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              />
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          <div className="space-y-5 py-2">

            {/* ── Door(s) ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <DoorOpen className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">
                  {isPair ? 'Doors' : 'Door'}
                </span>
                {isPair && (
                  <Badge variant="outline" className="text-xs font-normal">
                    Active + Inactive required
                  </Badge>
                )}
              </div>

              {/* Door slot 1 */}
              {doorSlot1 ? (
                <ItemSlotCard
                  item={doorSlot1}
                  slotLabel={slot1Label}
                  addFieldFormOpenForId={addFieldFormOpenForId}
                  onClear={() => setDoorSlot1(null)}
                  onUpdateField={slot1Ops.updateField}
                  onDeleteField={slot1Ops.deleteField}
                  onAddField={slot1Ops.addField}
                  onToggleAddFieldForm={setAddFieldFormOpenForId}
                />
              ) : (
                <ItemCatalogPicker
                  itemTypes={itemTypes}
                  loading={itemTypesLoading}
                  category="doors"
                  placeholder="Search doors…"
                  open={door1PickerOpen}
                  onOpenChange={setDoor1PickerOpen}
                  onSelect={async (it) => {
                    const item = await buildLocalItem(it, 'doors', setDoorSlot1);
                    setDoorSlot1(item);
                  }}
                >
                  <Button
                    variant="outline"
                    className="w-full border-dashed text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Select {slot1Label}
                    <ChevronsUpDown className="h-4 w-4 ml-auto opacity-50" />
                  </Button>
                </ItemCatalogPicker>
              )}

              {/* Door slot 2 (pair only) */}
              {isPair && (
                doorSlot2 ? (
                  <ItemSlotCard
                    item={doorSlot2}
                    slotLabel={slot2Label}
                    addFieldFormOpenForId={addFieldFormOpenForId}
                    onClear={() => setDoorSlot2(null)}
                    onUpdateField={slot2Ops.updateField}
                    onDeleteField={slot2Ops.deleteField}
                    onAddField={slot2Ops.addField}
                    onToggleAddFieldForm={setAddFieldFormOpenForId}
                  />
                ) : (
                  <ItemCatalogPicker
                    itemTypes={itemTypes}
                    loading={itemTypesLoading}
                    category="doors"
                    placeholder="Search doors…"
                    open={door2PickerOpen}
                    onOpenChange={setDoor2PickerOpen}
                    onSelect={async (it) => {
                      const item = await buildLocalItem(it, 'doors', setDoorSlot2);
                      setDoorSlot2(item);
                    }}
                  >
                    <Button
                      variant="outline"
                      className="w-full border-dashed text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Select {slot2Label}
                      <ChevronsUpDown className="h-4 w-4 ml-auto opacity-50" />
                    </Button>
                  </ItemCatalogPicker>
                )
              )}
            </div>

            <Separator />

            {/* ── Frame ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Square className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Frame</span>
              </div>

              {frameSlot ? (
                <ItemSlotCard
                  item={frameSlot}
                  slotLabel="Frame"
                  addFieldFormOpenForId={addFieldFormOpenForId}
                  onClear={() => setFrameSlot(null)}
                  onUpdateField={frameOps.updateField}
                  onDeleteField={frameOps.deleteField}
                  onAddField={frameOps.addField}
                  onToggleAddFieldForm={setAddFieldFormOpenForId}
                />
              ) : (
                <ItemCatalogPicker
                  itemTypes={itemTypes}
                  loading={itemTypesLoading}
                  category="frames"
                  placeholder="Search frames…"
                  open={framePickerOpen}
                  onOpenChange={setFramePickerOpen}
                  onSelect={async (it) => {
                    const item = await buildLocalItem(it, 'frames', setFrameSlot);
                    setFrameSlot(item);
                  }}
                >
                  <Button
                    variant="outline"
                    className="w-full border-dashed text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Select Frame
                    <ChevronsUpDown className="h-4 w-4 ml-auto opacity-50" />
                  </Button>
                </ItemCatalogPicker>
              )}
            </div>

            {/* Validation hint */}
            {(!doorSlot1 || !frameSlot || (isPair && !doorSlot2)) && (
              <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  {isPair
                    ? 'Select an active door, inactive door, and a frame to continue.'
                    : 'Select a door and a frame to continue.'}
                </p>
              </div>
            )}

            <Separator />

            {/* ── Hardware (tabbed by category) ── */}
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

              <HardwareTabs
                itemTypes={itemTypes}
                loading={itemTypesLoading}
                hardwareItems={hardwareItems}
                activeTab={activeHwTab}
                onActiveTabChange={setActiveHwTab}
                hwSearchQuery={hwSearchQuery}
                onHwSearchQueryChange={setHwSearchQuery}
                addHwFieldFormOpenForId={addHwFieldFormOpenForId}
                onDeleteHardware={handleDeleteHardware}
                onUpdateHwField={handleUpdateHwField}
                onDeleteHwField={handleDeleteHwField}
                onAddHwField={handleAddHwField}
                onToggleAddHwFieldForm={setAddHwFieldFormOpenForId}
                onSelectHardware={handleSelectHardware}
              />
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
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
