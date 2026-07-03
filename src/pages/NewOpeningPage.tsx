/**
 * @deprecated LEGACY grid opening page — superseded by SpecOpeningBuilder.
 * Scheduled for removal at the Phase 6 cutover (TARGET 2026-07-15); see
 * db/migrations/retire_legacy_grid.sql. Do not add new features here.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Trash2,
  Loader2,
  DoorOpen,
  Square,
  Wrench,
  ChevronsUpDown,
  ChevronDown,
  AlertCircle,
  LayoutTemplate,
  LayoutPanelLeft,
  ArrowLeft,
  Search,
  GlassWater,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  getItemTypes,
  createEstimateOpening,
  createManualEstimate,
  addEstimateItem,
  addItemField,
  getItemTypeFields,
  getFieldValueOptions,
  getMostRecentFieldValuesForItem,
  recordFieldValueUsage,
  getHardwareLeafItems,
} from '@/lib/estimates-api';
import { supabase } from '@/lib/supabase';
import { getPassToFrameFieldKeys, getResolvedDependencies } from '@/lib/item-fields-api';
import { evaluateDependency } from '@/lib/field-dependencies';
import { resolveFrameFieldKey } from '@/lib/door-frame-sync';
import { resolveAndPersistItemPrice } from '@/lib/pricing-lookup';
import {
  HARDWARE_SUBCATEGORY_ORDER,
  HARDWARE_SUBCATEGORY_LABEL,
} from '@/lib/hardware-utils';
import { AddItemModal, newLocalId, type LocalField, type LocalTopLevelItem, type LocalHardwareItem, type PreFillField } from '@/components/estimates/wizard/AddItemModal';
import { LivePriceBadge } from '@/components/estimates/wizard/LivePriceBadge';
import { getOppositeHanding, parseDimensionToInches, calcHingeQty } from '@/components/estimates/wizard/opening-rules';
import {
  GLASS_OR_LOUVER_FIELD_KEY,
  GLASS_OR_LOUVER_TRIGGER_VALUE,
  GLASS_OR_LOUVER_WIDTH_KEY,
  GLASS_OR_LOUVER_HEIGHT_KEY,
  LITES_ITEM_TYPE,
} from '@/components/estimates/wizard/lite-glass-utils';
import type {
  ItemType,
  FieldValueOption,
  ItemField,
  HardwareSubcategory,
  HardwareCatalogItem,
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
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!field.fieldDefinitionId) return;
    getFieldValueOptions(field.fieldDefinitionId)
      .then(setOptions)
      .catch(console.error);
  }, [field.fieldDefinitionId]);

  const handleOpenChange = (open: boolean) => {
    setPopoverOpen(open);
    if (open) setSearchQuery('');
  };

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

      {field.isLocked ? (
        <div className="h-7 flex-1 flex items-center gap-1.5 rounded border bg-muted/30 px-2">
          <Lock className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground">{field.fieldValue || '—'}</span>
        </div>
      ) : options.length > 0 ? (
        <Popover open={popoverOpen} onOpenChange={handleOpenChange}>
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
                value={searchQuery}
                onValueChange={(val) => {
                  setSearchQuery(val);
                  onUpdate(val);
                }}
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

      {!field.isRequired && !field.isLocked && (
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
// ItemSlotCard
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
            <LivePriceBadge
              category={item.category}
              canonicalCode={item.canonicalCode}
              itemLabel={item.itemLabel}
              manufacturerId={item.manufacturerId ?? null}
              fields={item.fields.map((f) => ({ fieldKey: f.fieldKey, fieldValue: f.fieldValue, fieldLabel: f.fieldLabel }))}
            />
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
  onUpdateQuantity: (hwLocalId: string, quantity: number) => void;
}

function HardwareItemCard({
  hw,
  addFieldFormOpenForId,
  onDelete,
  onUpdateField,
  onDeleteField,
  onAddField,
  onToggleAddFieldForm,
  onUpdateQuantity,
}: HardwareItemCardProps) {
  const [expanded, setExpanded] = useState(false);

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
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground">Qty</span>
          <Input
            type="number"
            min={1}
            value={hw.quantity}
            onChange={(e) => onUpdateQuantity(hw.localId, parseInt(e.target.value) || 1)}
            className="h-6 w-14 text-xs px-1.5"
          />
        </div>
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
// HardwareLeafPickerDialog — 2-level picker: Sub-type → End Items
// ---------------------------------------------------------------------------

/** Human-readable labels for canonical code sub-type tokens. */
const SUBTYPE_LABELS: Record<string, string> = {
  // Swing It — Hinge types
  MECH: 'Mechanical',
  SPRING: 'Spring',
  ELEC: 'Electrified',
  // Swing It — Continuous Hinge materials
  ALUM: 'Aluminum',
  SS630: 'Stainless Steel',
  // Close It — Closer mount types
  HM: 'Header Mount',
  DM: 'Door Mount',
  SLIDE: 'Slide Track',
  // Latch It — Deadbolt types
  KOS: 'Key-Operated Strike',
  KBS: 'Key-Bypass Strike',
  // Latch It — Lockset types
  CYLI: 'Cylindrical',
  MORT: 'Mortise',
  // Latch It — Panic types
  RIM: 'Rim',
  SVR: 'Severe Duty Rim',
  CVR: 'Concealed Vertical Rod',
  // Protect It — Weatherstrip
  ADHES: 'Adhesive',
  KERF: 'Kerf',
  SCREW: 'Screw-On',
  // Protect It — Threshold
  FLAT: 'Flat',
  PANIC: 'Panic',
  NOTCH: 'Notched',
};

/**
 * Extracts the sub-type token from a leaf item's canonical code.
 * e.g. 'HINGE-MECH-SS-45X45' with prefix 'HINGE' → 'MECH'
 * e.g. 'CONT-HINGE-SS630-FM-80' with prefix 'CONT-HINGE' → 'SS630'
 */
function getHwSubtype(canonicalCode: string, codePrefix: string): string {
  if (!canonicalCode.startsWith(codePrefix + '-')) return '';
  const remainder = canonicalCode.slice(codePrefix.length + 1);
  return remainder.split('-')[0] ?? '';
}

interface HardwareLeafPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  familyName: string;
  codePrefix: string;
  items: HardwareCatalogItem[];
  loading: boolean;
  onSelect: (item: HardwareCatalogItem) => void;
}

function HardwareLeafPickerDialog({
  open,
  onOpenChange,
  familyName,
  codePrefix,
  items,
  loading,
  onSelect,
}: HardwareLeafPickerDialogProps) {
  const [selectedSubtype, setSelectedSubtype] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Reset when dialog opens/closes or items change
  useEffect(() => {
    if (!open) {
      setSelectedSubtype(null);
      setSearch('');
    }
  }, [open]);

  // Group items by sub-type
  const subtypeGroups = useMemo(() => {
    const groups = new Map<string, HardwareCatalogItem[]>();
    for (const item of items) {
      const sub = getHwSubtype(item.canonicalCode, codePrefix);
      const key = sub || '_other';
      const existing = groups.get(key) ?? [];
      existing.push(item);
      groups.set(key, existing);
    }
    return groups;
  }, [items, codePrefix]);

  // Show sub-type step only when multiple sub-types exist AND at least one has > 1 item
  const showSubtypeStep =
    subtypeGroups.size > 1 &&
    [...subtypeGroups.values()].some((group) => group.length > 1);

  const activeItems = selectedSubtype
    ? (subtypeGroups.get(selectedSubtype) ?? [])
    : showSubtypeStep
    ? []
    : items;

  const filteredItems = search.trim()
    ? activeItems.filter(
        (it) =>
          it.name.toLowerCase().includes(search.toLowerCase()) ||
          it.canonicalCode.toLowerCase().includes(search.toLowerCase())
      )
    : activeItems;

  const subtypeLabel = (token: string) =>
    SUBTYPE_LABELS[token] ?? token;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg flex items-center gap-2">
            {selectedSubtype && (
              <button
                type="button"
                onClick={() => { setSelectedSubtype(null); setSearch(''); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {familyName}
            {selectedSubtype && (
              <span className="text-muted-foreground font-normal">
                — {subtypeLabel(selectedSubtype)}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !selectedSubtype && showSubtypeStep ? (
          /* Sub-type selection step */
          <div className="space-y-1.5 py-1">
            {[...subtypeGroups.entries()].map(([token, groupItems]) => (
              <button
                key={token}
                type="button"
                onClick={() => setSelectedSubtype(token)}
                className="w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left hover:bg-muted transition-colors"
              >
                <div>
                  <p className="font-medium text-sm">{subtypeLabel(token)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {groupItems.length} option{groupItems.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground -rotate-90" />
              </button>
            ))}
          </div>
        ) : (
          /* End-item selection step */
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search items…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
                autoFocus={!showSubtypeStep}
              />
            </div>
            <ScrollArea className="h-[300px] -mx-1 px-1">
              {filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                  <p className="text-sm">
                    {search ? 'No items match your search.' : 'No items in this category.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredItems.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => { onSelect(it); onOpenChange(false); }}
                      className="w-full flex items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{it.name}</p>
                        {it.description && (
                          <p className="text-xs text-muted-foreground truncate">{it.description}</p>
                        )}
                      </div>
                      <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                        {it.canonicalCode}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Hardware catalog filter — derived from active door's field selections
// ---------------------------------------------------------------------------

/**
 * Returns a filtered list of hardware catalog items for a given subcategory,
 * based on relevant door field values (e.g. type_of_hinging drives swing_it).
 * When no relevant door field is set, all items pass through unfiltered.
 */
function filterHardwareCatalogByDoor(
  catalogItems: ItemType[],
  subcategory: HardwareSubcategory,
  doorFields: LocalField[]
): ItemType[] {
  const val = (key: string) =>
    (doorFields.find((f) => f.fieldKey === key)?.fieldValue ?? '').toLowerCase();

  switch (subcategory) {
    case 'swing_it': {
      const hinging = val('type_of_hinging');
      if (!hinging) return catalogItems;
      if (hinging.includes('continuous')) {
        // Only show continuous hinge families
        return catalogItems.filter((it) =>
          it.canonicalCode.toLowerCase().includes('cont')
        );
      } else {
        // Hide continuous hinge, show standard hinges
        return catalogItems.filter(
          (it) => !it.canonicalCode.toLowerCase().includes('cont')
        );
      }
    }

    case 'latch_it': {
      const lock = val('lock_description');
      const exitPrep = val('exit_device_prep_type');
      if (!lock && !exitPrep) return catalogItems;

      const allowed = new Set<string>();
      if (lock.includes('deadbolt')) allowed.add('deadbolt');
      if (lock.includes('mortise') || lock.includes('lockset') || lock.includes('cylindrical')) {
        allowed.add('lockset');
      }
      if (
        exitPrep.includes('exit device') ||
        lock.includes('panic') ||
        lock.includes('exit device')
      ) {
        allowed.add('panic');
      }
      if (allowed.size === 0) return catalogItems;
      return catalogItems.filter((it) =>
        [...allowed].some((a) => it.canonicalCode.toLowerCase().includes(a))
      );
    }

    case 'close_it': {
      // Closer reinforcement or prep fields could drive this; no hard filter for now
      return catalogItems;
    }

    default:
      return catalogItems;
  }
}

// ---------------------------------------------------------------------------
// HardwareTabs
// ---------------------------------------------------------------------------

const ALL_HW_TABS: Array<{ key: HardwareSubcategory; label: string }> = HARDWARE_SUBCATEGORY_ORDER.map(
  (sub) => ({ key: sub, label: HARDWARE_SUBCATEGORY_LABEL[sub] })
);

interface HardwareTabsProps {
  itemTypes: ItemType[];
  loading: boolean;
  hardwareItems: LocalHardwareItem[];
  activeTab: HardwareSubcategory;
  onActiveTabChange: (tab: HardwareSubcategory) => void;
  hwSearchQuery: Record<string, string>;
  onHwSearchQueryChange: (state: Record<string, string>) => void;
  addHwFieldFormOpenForId: string | null;
  onDeleteHardware: (localId: string) => void;
  onUpdateHwField: (hwLocalId: string, fieldLocalId: string, value: string) => void;
  onDeleteHwField: (hwLocalId: string, fieldLocalId: string) => void;
  onAddHwField: (hwLocalId: string, field: Omit<LocalField, 'localId'>) => void;
  onToggleAddHwFieldForm: (hwLocalId: string | null) => void;
  onSelectHardware: (hwType: ItemType) => void;
  onUpdateHwQuantity: (hwLocalId: string, quantity: number) => void;
  /** Active door's fields — used to filter catalog options per subcategory. */
  doorFields: LocalField[];
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
  onUpdateHwQuantity,
  doorFields,
}: HardwareTabsProps) {
  const allHardware = itemTypes.filter((it) => it.category === 'hardware');

  const getTabItems = (tabKey: HardwareSubcategory) =>
    hardwareItems.filter((hw) => hw.subcategory === tabKey);

  const getCatalogItems = (tabKey: HardwareSubcategory) => {
    // Only show family-level entries (the top-level category tiles).
    // Leaf/legacy items are browsed through the HardwareLeafPickerDialog.
    const raw = allHardware.filter(
      (it) => it.subcategory === tabKey && it.isFamily === true
    );
    return filterHardwareCatalogByDoor(raw, tabKey, doorFields);
  };

  const getTabCount = (tabKey: HardwareSubcategory) =>
    getTabItems(tabKey).length;

  const visibleTabs = ALL_HW_TABS.filter(
    (t) => getCatalogItems(t.key).length > 0 || getTabCount(t.key) > 0
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => onActiveTabChange(v as HardwareSubcategory)}
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

            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : filteredCatalog.length === 0 ? (
              <p className="text-xs text-muted-foreground italic text-center py-3">
                {searchQuery ? 'No items match your search.' : `No ${tab.label} items available.`}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-1 max-h-48 overflow-y-auto rounded-md border bg-muted/20 p-1">
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
                    onUpdateQuantity={onUpdateHwQuantity}
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
// NewOpeningPage
// ---------------------------------------------------------------------------

export default function NewOpeningPage() {
  // estimateId can come from the URL path (existing estimate) or be absent (brand-new estimate).
  // When absent, the estimate is created lazily inside handleSave.
  const { estimateId: estimateIdParam } = useParams<{ estimateId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const estimateId = estimateIdParam ?? null;

  const initialTemplateType = (searchParams.get('type') ?? 'single') as OpeningTemplateType;
  const openingCount = parseInt(searchParams.get('count') ?? '0', 10);

  const backUrl = estimateId
    ? `/app/estimates/create?id=${estimateId}&step=2`
    : '/app/estimates/create?step=2';

  const [templateType, setTemplateType] = useState<OpeningTemplateType>(initialTemplateType);
  const [name, setName] = useState(`Opening ${openingCount + 1}`);
  const [quantity, setQuantity] = useState(1);

  const [doorSlot1, setDoorSlot1] = useState<LocalTopLevelItem | null>(null);
  const [doorSlot2, setDoorSlot2] = useState<LocalTopLevelItem | null>(null);
  const [frameSlot, setFrameSlot] = useState<LocalTopLevelItem | null>(null);
  const [panelSlot, setPanelSlot] = useState<LocalTopLevelItem | null>(null);
  const [hardwareItems, setHardwareItems] = useState<LocalHardwareItem[]>([]);
  // Lite items — one per door slot, set after user picks from the lites catalog
  const [liteSlot1, setLiteSlot1] = useState<LocalTopLevelItem | null>(null);
  const [liteSlot2, setLiteSlot2] = useState<LocalTopLevelItem | null>(null);

  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [itemTypesLoading, setItemTypesLoading] = useState(true);

  const [door1ModalOpen, setDoor1ModalOpen] = useState(false);
  const [door2ModalOpen, setDoor2ModalOpen] = useState(false);
  const [frameModalOpen, setFrameModalOpen] = useState(false);
  const [panelModalOpen, setPanelModalOpen] = useState(false);
  const [liteModal1Open, setLiteModal1Open] = useState(false);
  const [liteModal2Open, setLiteModal2Open] = useState(false);
  const [hardwareModalOpen, setHardwareModalOpen] = useState(false);
  const [pendingFamilyCode, setPendingFamilyCode] = useState<string | undefined>(undefined);
  const [activeHwTab, setActiveHwTab] = useState<HardwareSubcategory>('swing_it');

  // Leaf item picker state — shown when user clicks a hardware family in the catalog
  const [leafPickerOpen, setLeafPickerOpen] = useState(false);
  const [leafPickerLoading, setLeafPickerLoading] = useState(false);
  const [leafItems, setLeafItems] = useState<HardwareCatalogItem[]>([]);
  const [leafPickerFamily, setLeafPickerFamily] = useState<{ label: string; codePrefix: string; subcategory: HardwareSubcategory } | null>(null);
  const [hwSearchQuery, setHwSearchQuery] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addFieldFormOpenForId, setAddFieldFormOpenForId] = useState<string | null>(null);
  const [addHwFieldFormOpenForId, setAddHwFieldFormOpenForId] = useState<string | null>(null);

  const [passToFrameKeys, setPassToFrameKeys] = useState<Set<string>>(new Set());

  const isPair = templateType === 'pair' || templateType === 'pair_with_panel';
  const hasPanel = templateType === 'single_with_panel' || templateType === 'pair_with_panel';

  // True when any selected door has "Yes Lite or Louver" active
  const doorSlot1NeedsLite =
    doorSlot1?.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_FIELD_KEY)?.fieldValue ===
    GLASS_OR_LOUVER_TRIGGER_VALUE;
  const doorSlot2NeedsLite =
    doorSlot2?.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_FIELD_KEY)?.fieldValue ===
    GLASS_OR_LOUVER_TRIGGER_VALUE;
  const anyDoorNeedsLite = doorSlot1NeedsLite || doorSlot2NeedsLite;

  // Compute locked pre-fill fields (width/height) from each door separately
  const buildLitePrefillFields = (door: LocalTopLevelItem | null) => {
    if (!door) return undefined;
    const w = door.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_WIDTH_KEY)?.fieldValue ?? '';
    const h = door.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_HEIGHT_KEY)?.fieldValue ?? '';
    return [
      { fieldKey: 'width', fieldLabel: 'Width', value: w, locked: true },
      { fieldKey: 'height', fieldLabel: 'Height', value: h, locked: true },
    ];
  };
  const litePrefillFields1 = doorSlot1NeedsLite ? buildLitePrefillFields(doorSlot1) : undefined;
  const litePrefillFields2 = doorSlot2NeedsLite ? buildLitePrefillFields(doorSlot2) : undefined;

  // Pre-fill the inactive door from the active door when building a pair.
  // Fields that are mirrored (same value): Nominal Width, Nominal Height, Hinge Size, Type of Hinging.
  // Handing is automatically set to the opposite (LH↔RH, LHR↔RHR).
  const door2PreFillFields: PreFillField[] | undefined = (() => {
    if (!isPair || !doorSlot1) return undefined;
    const fieldVal = (key: string) =>
      doorSlot1.fields.find((f) => f.fieldKey === key)?.fieldValue ?? '';
    const fieldLbl = (key: string) =>
      doorSlot1.fields.find((f) => f.fieldKey === key)?.fieldLabel ?? '';

    const prefills: PreFillField[] = [];

    // Handing — force opposite
    const handing = fieldVal('handing');
    if (handing) {
      prefills.push({
        fieldKey: 'handing',
        fieldLabel: fieldLbl('handing') || 'Handing',
        value: getOppositeHanding(handing),
        locked: false,
      });
    }

    // Nominal Width + Height — same size doors
    for (const key of ['opening_width', 'opening_height'] as const) {
      const val = fieldVal(key);
      if (val) {
        prefills.push({
          fieldKey: key,
          fieldLabel: fieldLbl(key) || (key === 'opening_width' ? 'Nominal Width' : 'Nominal Height'),
          value: val,
          locked: false,
        });
      }
    }

    // Hinge specs — same hinge size and hinging type
    for (const key of ['hinge_size', 'type_of_hinging'] as const) {
      const val = fieldVal(key);
      if (val) {
        prefills.push({
          fieldKey: key,
          fieldLabel: fieldLbl(key) || (key === 'hinge_size' ? 'Hinge Size' : 'Type of Hinging'),
          value: val,
          locked: false,
        });
      }
    }

    return prefills.length > 0 ? prefills : undefined;
  })();

  useEffect(() => {
    setItemTypesLoading(true);
    getItemTypes()
      .then(setItemTypes)
      .catch((err) => console.error('Failed to load item types:', err))
      .finally(() => setItemTypesLoading(false));
    getPassToFrameFieldKeys()
      .then(setPassToFrameKeys)
      .catch((err) => console.error('Failed to load pass-to-frame keys:', err));
  }, []);

  useEffect(() => {
    if (templateType === 'single' || templateType === 'single_with_panel') {
      setDoorSlot2(null);
      setLiteSlot2(null);
    }
    if (templateType === 'single' || templateType === 'pair') {
      setPanelSlot(null);
    }
  }, [templateType]);

  // ---------------------------------------------------------------------------
  // Slot updaters
  // ---------------------------------------------------------------------------

  const makeSlotFieldUpdater = (
    setter: React.Dispatch<React.SetStateAction<LocalTopLevelItem | null>>
  ) => ({
    updateField: (itemLocalId: string, fieldLocalId: string, value: string) => {
      setter((prev) => {
        if (!prev || prev.localId !== itemLocalId) return prev;
        const descriptionCodeKey =
          prev.category === 'doors'
            ? 'door_description_code'
            : prev.category === 'frames'
            ? 'frame_description'
            : null;
        const changedField = prev.fields.find((f) => f.localId === fieldLocalId);
        const isDesc = descriptionCodeKey !== null && changedField?.fieldKey === descriptionCodeKey;
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
  const panelOps = makeSlotFieldUpdater(setPanelSlot);
  const liteOps1 = makeSlotFieldUpdater(setLiteSlot1);
  const liteOps2 = makeSlotFieldUpdater(setLiteSlot2);

  const applyDoorDimensions = (item: LocalTopLevelItem, sourceDoor: LocalTopLevelItem): LocalTopLevelItem => {
    const w = sourceDoor.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_WIDTH_KEY)?.fieldValue ?? '';
    const h = sourceDoor.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_HEIGHT_KEY)?.fieldValue ?? '';
    const processed: LocalTopLevelItem = {
      ...item,
      fields: item.fields.map((f) => {
        if (f.fieldKey === 'width') return { ...f, fieldValue: w, isLocked: true };
        if (f.fieldKey === 'height') return { ...f, fieldValue: h, isLocked: true };
        return f;
      }),
    };
    const hasWidth = processed.fields.some((f) => f.fieldKey === 'width');
    const hasHeight = processed.fields.some((f) => f.fieldKey === 'height');
    const extra: LocalField[] = [];
    if (!hasWidth && w) extra.push({ localId: newLocalId(), fieldKey: 'width', fieldLabel: 'Width', fieldValue: w, valueType: 'string', isRequired: false, isLocked: true });
    if (!hasHeight && h) extra.push({ localId: newLocalId(), fieldKey: 'height', fieldLabel: 'Height', fieldValue: h, valueType: 'string', isRequired: false, isLocked: true });
    return extra.length > 0 ? { ...processed, fields: [...extra, ...processed.fields] } : processed;
  };

  const handleSelectLite1 = (item: LocalTopLevelItem) => {
    setLiteSlot1(doorSlot1 ? applyDoorDimensions(item, doorSlot1) : item);
  };

  const handleSelectLite2 = (item: LocalTopLevelItem) => {
    setLiteSlot2(doorSlot2 ? applyDoorDimensions(item, doorSlot2) : item);
  };

  const handleSlot1UpdateField = (itemLocalId: string, fieldLocalId: string, value: string) => {
    slot1Ops.updateField(itemLocalId, fieldLocalId, value);
    const changedFieldKey = doorSlot1?.fields.find((f) => f.localId === fieldLocalId)?.fieldKey;
    if (changedFieldKey && passToFrameKeys.has(changedFieldKey)) {
      const frameFieldKey = resolveFrameFieldKey(changedFieldKey);
      setFrameSlot((prev) => {
        if (!prev) return prev;
        const hasField = prev.fields.some((f) => f.fieldKey === frameFieldKey);
        if (!hasField) return prev;
        return {
          ...prev,
          fields: prev.fields.map((f) =>
            f.fieldKey === frameFieldKey ? { ...f, fieldValue: value } : f
          ),
        };
      });
    }
    // Sync lite slot 1 when glass/louver toggles off
    if (changedFieldKey === GLASS_OR_LOUVER_FIELD_KEY && value !== GLASS_OR_LOUVER_TRIGGER_VALUE) {
      setLiteSlot1(null);
    }
    // Sync locked dimensions if glass dimensions change while a lite is selected
    if (
      liteSlot1 &&
      (changedFieldKey === GLASS_OR_LOUVER_WIDTH_KEY || changedFieldKey === GLASS_OR_LOUVER_HEIGHT_KEY)
    ) {
      const isWidth = changedFieldKey === GLASS_OR_LOUVER_WIDTH_KEY;
      setLiteSlot1((prev) =>
        prev
          ? {
              ...prev,
              fields: prev.fields.map((f) => {
                if (isWidth && f.fieldKey === 'width' && f.isLocked) return { ...f, fieldValue: value };
                if (!isWidth && f.fieldKey === 'height' && f.isLocked) return { ...f, fieldValue: value };
                return f;
              }),
            }
          : prev
      );
    }
  };

  const handleSlot2UpdateField = (itemLocalId: string, fieldLocalId: string, value: string) => {
    slot2Ops.updateField(itemLocalId, fieldLocalId, value);
    const changedFieldKey = doorSlot2?.fields.find((f) => f.localId === fieldLocalId)?.fieldKey;
    if (changedFieldKey && passToFrameKeys.has(changedFieldKey)) {
      const frameFieldKey = resolveFrameFieldKey(changedFieldKey);
      setFrameSlot((prev) => {
        if (!prev) return prev;
        const hasField = prev.fields.some((f) => f.fieldKey === frameFieldKey);
        if (!hasField) return prev;
        return {
          ...prev,
          fields: prev.fields.map((f) =>
            f.fieldKey === frameFieldKey ? { ...f, fieldValue: value } : f
          ),
        };
      });
    }
    // Sync lite slot 2 when glass/louver toggles off
    if (changedFieldKey === GLASS_OR_LOUVER_FIELD_KEY && value !== GLASS_OR_LOUVER_TRIGGER_VALUE) {
      setLiteSlot2(null);
    }
    if (
      liteSlot2 &&
      (changedFieldKey === GLASS_OR_LOUVER_WIDTH_KEY || changedFieldKey === GLASS_OR_LOUVER_HEIGHT_KEY)
    ) {
      const isWidth = changedFieldKey === GLASS_OR_LOUVER_WIDTH_KEY;
      setLiteSlot2((prev) =>
        prev
          ? {
              ...prev,
              fields: prev.fields.map((f) => {
                if (isWidth && f.fieldKey === 'width' && f.isLocked) return { ...f, fieldValue: value };
                if (!isWidth && f.fieldKey === 'height' && f.isLocked) return { ...f, fieldValue: value };
                return f;
              }),
            }
          : prev
      );
    }
  };

  // ---------------------------------------------------------------------------
  // Hardware handlers — HardwareTabs builds items via API (not modal)
  // ---------------------------------------------------------------------------

  const buildLocalHardware = useCallback(async (hwType: ItemType): Promise<LocalHardwareItem> => {
    const hwLocalId = newLocalId();
    const hw: LocalHardwareItem = {
      localId: hwLocalId,
      itemLabel: hwType.itemLabel,
      canonicalCode: hwType.canonicalCode,
      subcategory: (hwType.subcategory as HardwareSubcategory) ?? null,
      quantity: 1,
      loadingFields: true,
      fields: [],
    };

    Promise.all([
      getItemTypeFields(hwType.canonicalCode),
      getMostRecentFieldValuesForItem([hwType.canonicalCode]),
      getResolvedDependencies(hwType.canonicalCode),
    ])
      .then(([allFields, recentValues, resolvedDeps]) => {
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

        const existingFieldKeys = new Set(fields.map((f) => f.fieldKey));
        for (const dep of resolvedDeps) {
          if (existingFieldKeys.has(dep.childField.fieldKey)) continue;
          fields.push({
            localId: newLocalId(),
            fieldKey: dep.childField.fieldKey,
            fieldLabel: dep.childField.fieldLabel,
            fieldValue: '',
            valueType: dep.childField.valueType,
            fieldDefinitionId: dep.childField.id,
            isRequired: false,
            conditionalParentDefId: dep.parentFieldDefinitionId,
            conditionOperator: dep.operator,
            conditionTriggerValues: dep.triggerValues,
          });
          existingFieldKeys.add(dep.childField.fieldKey);
        }

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

  const handleSelectHardware = async (hwType: ItemType) => {
    if (hwType.isFamily) {
      // Use the hardware catalog code_prefix (e.g. 'WSTRIP' for the WEATHERSTRIP family,
      // 'CONT-HINGE' for CONT-HINGE) to find leaf items. Falls back to canonicalCode.
      const codePrefix = hwType.hwCodePrefix ?? hwType.canonicalCode;
      setLeafPickerFamily({
        label: hwType.itemLabel,
        codePrefix,
        subcategory: (hwType.subcategory as HardwareSubcategory) ?? 'swing_it',
      });
      setLeafPickerLoading(true);
      setLeafPickerOpen(true);
      setLeafItems([]);
      try {
        const items = await getHardwareLeafItems(codePrefix);
        setLeafItems(items);
      } catch (err) {
        console.error('Failed to load hardware leaf items:', err);
      } finally {
        setLeafPickerLoading(false);
      }
      return;
    }
    const hw = await buildLocalHardware(hwType);
    setHardwareItems((prev) => [...prev, hw]);
  };

  const handleLeafItemSelect = (item: HardwareCatalogItem) => {
    // Auto-compute hinge/anchor quantity from door height
    const isHinge =
      item.canonicalCode.startsWith('HINGE') || item.canonicalCode.startsWith('CONT-HINGE');
    const isAnchor = item.canonicalCode.startsWith('ANCHOR');
    let quantity = 1;
    if (isHinge || isAnchor) {
      const heightIn = parseDimensionToInches(
        doorSlot1?.fields.find((f) => f.fieldKey === 'opening_height')?.fieldValue
      );
      quantity = calcHingeQty(heightIn, isPair);
    }

    const hw: LocalHardwareItem = {
      localId: newLocalId(),
      itemLabel: item.name,
      canonicalCode: item.canonicalCode,
      subcategory: item.subcategory ?? leafPickerFamily?.subcategory ?? null,
      quantity,
      loadingFields: false,
      fields: [],
    };
    setHardwareItems((prev) => [...prev, hw]);
  };

  const handleUpdateHwQuantity = (hwLocalId: string, qty: number) => {
    setHardwareItems((prev) =>
      prev.map((h) => (h.localId === hwLocalId ? { ...h, quantity: qty } : h))
    );
  };

  const handleHardwareModalOpenChange = (open: boolean) => {
    setHardwareModalOpen(open);
    if (!open) setPendingFamilyCode(undefined);
  };

  const handleSaveHardwareFromModal = (hw: LocalHardwareItem) => {
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
      // Lazily create the estimate on first save so that navigating away without
      // saving leaves no orphan record in the database.
      let eid = estimateId;
      if (!eid) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { navigate('/login'); return; }
        const { estimateId: newId } = await createManualEstimate(user.id);
        eid = newId;
      }

      const openingData = await createEstimateOpening(eid, name.trim(), quantity, templateType);

      const saveLocalFields = async (itemId: string, fields: LocalField[]) => {
        const saved: ItemField[] = [];
        const parentValueByDefId = new Map<string, string>();
        for (const f of fields) {
          if (f.fieldDefinitionId && !f.conditionalParentDefId) {
            parentValueByDefId.set(f.fieldDefinitionId, f.fieldValue);
          }
        }
        for (const field of fields) {
          if (!field.fieldKey.trim()) continue;
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

      const topLevelItems: LocalTopLevelItem[] = [
        ...(doorSlot1 ? [doorSlot1] : []),
        ...(doorSlot2 ? [doorSlot2] : []),
        ...(frameSlot ? [frameSlot] : []),
        ...(panelSlot ? [panelSlot] : []),
        ...(liteSlot1 ? [liteSlot1] : []),
        ...(liteSlot2 ? [liteSlot2] : []),
      ];

      for (let i = 0; i < topLevelItems.length; i++) {
        const localItem = topLevelItems[i];
        const created = await addEstimateItem(eid, {
          itemLabel: localItem.itemLabel,
          canonicalCode: localItem.canonicalCode,
          quantity: 1,
          sortOrder: i,
          openingId: openingData.id,
          parentItemId: null,
          itemType: localItem.category,
          manufacturerId: localItem.manufacturerId ?? null,
        });
        const savedFields = await saveLocalFields(created.id, localItem.fields);
        // Await pricing lookup so price is persisted before navigating back.
        // Wrapped in try/catch so a lookup failure never blocks the save.
        try {
          await resolveAndPersistItemPrice(created.id, { ...created, manufacturerId: localItem.manufacturerId ?? null }, savedFields);
        } catch { /* pricing errors never block save */ }
      }

      for (let i = 0; i < hardwareItems.length; i++) {
        const hw = hardwareItems[i];
        const created = await addEstimateItem(eid, {
          itemLabel: hw.itemLabel,
          canonicalCode: hw.canonicalCode,
          quantity: hw.quantity ?? 1,
          sortOrder: i,
          openingId: openingData.id,
          parentItemId: null,
          subcategory: hw.subcategory,
        });
        await saveLocalFields(created.id, hw.fields);
      }

      // Navigate back to the wizard with the (possibly newly created) estimate ID.
      navigate(`/app/estimates/create?id=${eid}&step=2`);
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
    (!isPair || doorSlot2 !== null) &&
    (!hasPanel || panelSlot !== null);

  const slot1Label = isPair ? 'Active Door' : 'Door';
  const slot2Label = 'Inactive Door';


  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-6 lg:p-8 max-w-2xl mx-auto">

          {/* Header */}
          <div className="mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(backUrl)}
              className="mb-4 -ml-2"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Openings
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-primary/10">
                <LayoutTemplate className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
              <div>
                <h1 className="font-display text-xl sm:text-2xl lg:text-3xl tracking-wide">
                  New Opening
                </h1>
                <p className="text-sm text-muted-foreground">
                  Configure the opening type and select the required doors and frame.
                </p>
              </div>
            </div>
          </div>

          {/* Template type + Name + Quantity */}
          <div className="space-y-4 mb-6">
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
          </div>

          {/* Doors */}
          <div className="space-y-3 mb-6">
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

            {doorSlot1 ? (
              <ItemSlotCard
                item={doorSlot1}
                slotLabel={slot1Label}
                addFieldFormOpenForId={addFieldFormOpenForId}
                onClear={() => setDoorSlot1(null)}
                onUpdateField={handleSlot1UpdateField}
                onDeleteField={slot1Ops.deleteField}
                onAddField={slot1Ops.addField}
                onToggleAddFieldForm={setAddFieldFormOpenForId}
              />
            ) : (
              <Button
                variant="outline"
                className="w-full border-dashed text-muted-foreground hover:text-foreground"
                onClick={() => setDoor1ModalOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Select {slot1Label}
              </Button>
            )}

            {isPair && (
              doorSlot2 ? (
                <ItemSlotCard
                  item={doorSlot2}
                  slotLabel={slot2Label}
                  addFieldFormOpenForId={addFieldFormOpenForId}
                  onClear={() => setDoorSlot2(null)}
                  onUpdateField={handleSlot2UpdateField}
                  onDeleteField={slot2Ops.deleteField}
                  onAddField={slot2Ops.addField}
                  onToggleAddFieldForm={setAddFieldFormOpenForId}
                />
              ) : (
                <Button
                  variant="outline"
                  className="w-full border-dashed text-muted-foreground hover:text-foreground"
                  onClick={() => setDoor2ModalOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Select {slot2Label}
                </Button>
              )
            )}
          </div>

          {/* Lites / Louvers / Glass — one section per door that has "Yes Lite or Louver" */}
          {doorSlot1NeedsLite && (
            <div className="space-y-3 mb-6 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-900/10 p-3">
              <div className="flex items-center gap-2">
                <GlassWater className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Lites / Louvers / Glass{isPair ? ' — Active Door' : ''}
                </span>
                {liteSlot1 && <Badge variant="secondary" className="text-xs">Selected</Badge>}
                <span className="text-xs text-amber-600/80 dark:text-amber-400/80 ml-auto">
                  Required — door has "Yes Lite or Louver"
                </span>
              </div>
              {liteSlot1 ? (
                <ItemSlotCard
                  item={liteSlot1}
                  slotLabel={isPair ? 'Lite — Active Door' : 'Lite / Louver / Glass'}
                  addFieldFormOpenForId={addFieldFormOpenForId}
                  onClear={() => setLiteSlot1(null)}
                  onUpdateField={liteOps1.updateField}
                  onDeleteField={liteOps1.deleteField}
                  onAddField={liteOps1.addField}
                  onToggleAddFieldForm={setAddFieldFormOpenForId}
                />
              ) : (
                <Button
                  variant="outline"
                  className="w-full border-dashed border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:border-amber-700/50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                  onClick={() => setLiteModal1Open(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Select Lite / Louver / Glass Item
                </Button>
              )}
            </div>
          )}

          {doorSlot2NeedsLite && (
            <div className="space-y-3 mb-6 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-900/10 p-3">
              <div className="flex items-center gap-2">
                <GlassWater className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Lites / Louvers / Glass — Inactive Door
                </span>
                {liteSlot2 && <Badge variant="secondary" className="text-xs">Selected</Badge>}
                <span className="text-xs text-amber-600/80 dark:text-amber-400/80 ml-auto">
                  Required — door has "Yes Lite or Louver"
                </span>
              </div>
              {liteSlot2 ? (
                <ItemSlotCard
                  item={liteSlot2}
                  slotLabel="Lite — Inactive Door"
                  addFieldFormOpenForId={addFieldFormOpenForId}
                  onClear={() => setLiteSlot2(null)}
                  onUpdateField={liteOps2.updateField}
                  onDeleteField={liteOps2.deleteField}
                  onAddField={liteOps2.addField}
                  onToggleAddFieldForm={setAddFieldFormOpenForId}
                />
              ) : (
                <Button
                  variant="outline"
                  className="w-full border-dashed border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:border-amber-700/50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                  onClick={() => setLiteModal2Open(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Select Lite / Louver / Glass Item
                </Button>
              )}
            </div>
          )}

          <Separator className="mb-6" />

          {/* Frame */}
          <div className="space-y-3 mb-6">
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
              <Button
                variant="outline"
                className="w-full border-dashed text-muted-foreground hover:text-foreground"
                onClick={() => setFrameModalOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Select Frame
              </Button>
            )}
          </div>

          {/* Panel — shown only for _with_panel template types */}
          {hasPanel && (
            <>
              <Separator className="mb-6" />

              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-2">
                  <LayoutPanelLeft className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Panel</span>
                </div>

                {panelSlot ? (
                  <ItemSlotCard
                    item={panelSlot}
                    slotLabel="Panel"
                    addFieldFormOpenForId={addFieldFormOpenForId}
                    onClear={() => setPanelSlot(null)}
                    onUpdateField={panelOps.updateField}
                    onDeleteField={panelOps.deleteField}
                    onAddField={panelOps.addField}
                    onToggleAddFieldForm={setAddFieldFormOpenForId}
                  />
                ) : (
                  <Button
                    variant="outline"
                    className="w-full border-dashed text-muted-foreground hover:text-foreground"
                    onClick={() => setPanelModalOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Select Panel
                  </Button>
                )}
              </div>
            </>
          )}

          {/* Validation hint */}
          {(!doorSlot1 || !frameSlot || (isPair && !doorSlot2) || (hasPanel && !panelSlot)) && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-3 mb-6">
              <AlertCircle className="h-4 w-4 text-muted-foreground/50 shrink-0" />
              <p className="text-sm text-muted-foreground">
                {isPair && hasPanel
                  ? 'Select an active door, inactive door, a frame, and a panel to continue.'
                  : isPair
                  ? 'Select an active door, inactive door, and a frame to continue.'
                  : hasPanel
                  ? 'Select a door, a frame, and a panel to continue.'
                  : 'Select a door and a frame to continue.'}
              </p>
            </div>
          )}

          <Separator className="mb-6" />

          {/* Hardware */}
          <div className="space-y-3 mb-8">
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
              onUpdateHwQuantity={handleUpdateHwQuantity}
              doorFields={doorSlot1?.fields ?? doorSlot2?.fields ?? []}
            />
          </div>

          {/* Save error */}
          {saveError && (
            <div className="flex items-center gap-1.5 mb-4 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {saveError}
            </div>
          )}

          {/* Footer actions */}
          <div className="flex justify-between items-center pt-6 border-t">
            <Button variant="outline" onClick={() => navigate(backUrl)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave || saving} size="lg">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Opening
            </Button>
          </div>

        </div>
      </div>

      {/* Hardware leaf item picker — shown when user clicks a family in the catalog */}
      <HardwareLeafPickerDialog
        open={leafPickerOpen}
        onOpenChange={setLeafPickerOpen}
        familyName={leafPickerFamily?.label ?? ''}
        codePrefix={leafPickerFamily?.codePrefix ?? ''}
        items={leafItems}
        loading={leafPickerLoading}
        onSelect={handleLeafItemSelect}
      />

      {/* AddItemModals */}
      <AddItemModal
        category="doors"
        title={`Select ${slot1Label}`}
        itemTypes={itemTypes}
        itemTypesLoading={itemTypesLoading}
        open={door1ModalOpen}
        onOpenChange={setDoor1ModalOpen}
        onSaveTopLevel={setDoorSlot1}
        onSaveHardware={() => {}}
      />
      {isPair && (
        <AddItemModal
          category="doors"
          title={`Select ${slot2Label}`}
          itemTypes={itemTypes}
          itemTypesLoading={itemTypesLoading}
          open={door2ModalOpen}
          onOpenChange={setDoor2ModalOpen}
          onSaveTopLevel={setDoorSlot2}
          onSaveHardware={() => {}}
          preFillFields={door2PreFillFields}
        />
      )}
      <AddItemModal
        category="frames"
        title="Select Frame"
        itemTypes={itemTypes}
        itemTypesLoading={itemTypesLoading}
        open={frameModalOpen}
        onOpenChange={setFrameModalOpen}
        onSaveTopLevel={setFrameSlot}
        onSaveHardware={() => {}}
        passToFrameKeys={passToFrameKeys}
        sourceDoor={doorSlot1 ?? doorSlot2}
      />
      <AddItemModal
        category="panels"
        title="Select Panel"
        itemTypes={itemTypes}
        itemTypesLoading={itemTypesLoading}
        open={panelModalOpen}
        onOpenChange={setPanelModalOpen}
        onSaveTopLevel={setPanelSlot}
        onSaveHardware={() => {}}
      />
      <AddItemModal
        category="lites_louvers_glass"
        title={isPair ? 'Select Lite — Active Door' : 'Select Lite / Louver / Glass'}
        itemTypes={itemTypes}
        itemTypesLoading={itemTypesLoading}
        open={liteModal1Open}
        onOpenChange={setLiteModal1Open}
        onSaveTopLevel={handleSelectLite1}
        onSaveHardware={() => {}}
        preFillFields={litePrefillFields1}
      />
      {isPair && (
        <AddItemModal
          category="lites_louvers_glass"
          title="Select Lite — Inactive Door"
          itemTypes={itemTypes}
          itemTypesLoading={itemTypesLoading}
          open={liteModal2Open}
          onOpenChange={setLiteModal2Open}
          onSaveTopLevel={handleSelectLite2}
          onSaveHardware={() => {}}
          preFillFields={litePrefillFields2}
        />
      )}
      <AddItemModal
        category="hardware"
        title="Add Hardware"
        itemTypes={itemTypes}
        itemTypesLoading={itemTypesLoading}
        open={hardwareModalOpen}
        onOpenChange={handleHardwareModalOpenChange}
        onSaveTopLevel={() => {}}
        onSaveHardware={handleSaveHardwareFromModal}
        initialFamilyCode={pendingFamilyCode}
      />
    </div>
  );
}
