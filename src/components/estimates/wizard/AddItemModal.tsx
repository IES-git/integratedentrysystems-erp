import { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  ArrowLeft,
  Search,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  getItemTypeFields,
  getBaseFieldsForCategory,
  getDefaultValuesForFields,
  getItemFieldValueOptionsForWizard,
  getHardwareFamilies,
  getFieldValueOptions,
} from '@/lib/estimates-api';
import { getResolvedDependencies, getItemTypeFieldDependencies } from '@/lib/item-fields-api';
import { evaluateDependency, mergeDependencies } from '@/lib/field-dependencies';
import { applyDoorValuesToFrame } from '@/lib/door-frame-sync';
import {
  HARDWARE_SUBCATEGORY_ORDER,
  HARDWARE_SUBCATEGORY_LABEL,
} from '@/lib/hardware-utils';
import { buildHardwareCode, buildHardwareLabel } from '@/lib/hardware-code-builder';
import { listManufacturersForSeries } from '@/lib/pricing-api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  ItemType,
  ItemCategory,
  FieldValueType,
  FieldValueOption,
  HardwareSubcategory,
  DependencyOperator,
  HardwareCatalogItem,
  Company,
} from '@/types';

// ---------------------------------------------------------------------------
// Subcategory display metadata (used by the tile-picker step)
// ---------------------------------------------------------------------------

const SUBCATEGORY_ICON: Record<HardwareSubcategory, string> = {
  swing_it: '🔩',
  close_it: '🔐',
  latch_it: '🔑',
  protect_it: '🛡️',
  mount_it: '⚓',
};

const SUBCATEGORY_DESC: Record<HardwareSubcategory, string> = {
  swing_it: 'Hinges & pivots',
  close_it: 'Door closers',
  latch_it: 'Locks & latches',
  protect_it: 'Door protection',
  mount_it: 'Anchors',
};

// ---------------------------------------------------------------------------
// Shared types — exported so parent components can type their local state
// ---------------------------------------------------------------------------

export interface LocalField {
  localId: string;
  fieldKey: string;
  fieldLabel: string;
  fieldValue: string;
  valueType: FieldValueType;
  fieldDefinitionId?: string;
  isRequired: boolean;
  conditionalParentDefId?: string;
  conditionOperator?: DependencyOperator;
  conditionTriggerValues?: (string | number)[];
  /** When true, the field value is locked and cannot be edited by the user. */
  isLocked?: boolean;
}

export interface LocalHardwareItem {
  localId: string;
  itemLabel: string;
  canonicalCode: string;
  subcategory: HardwareSubcategory | null;
  quantity: number;
  loadingFields: boolean;
  fields: LocalField[];
}

export interface LocalTopLevelItem {
  localId: string;
  itemLabel: string;
  canonicalCode: string;
  category: 'doors' | 'frames' | 'panels' | 'lites_louvers_glass';
  loadingFields: boolean;
  fields: LocalField[];
  /** The manufacturer selected for this item — used for pricing lookup. */
  manufacturerId: string | null;
}

export const newLocalId = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------------------------------------------------------------------------
// Internal: FieldRow
// ---------------------------------------------------------------------------

interface FieldRowProps {
  field: LocalField;
  canonicalCode: string;
  onUpdate: (value: string) => void;
  onDelete: () => void;
}

function FieldRow({ field, canonicalCode, onUpdate, onDelete }: FieldRowProps) {
  const [options, setOptions] = useState<FieldValueOption[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!field.fieldDefinitionId) return;
    getItemFieldValueOptionsForWizard(canonicalCode, field.fieldDefinitionId)
      .then(setOptions)
      .catch(console.error);
  }, [canonicalCode, field.fieldDefinitionId]);

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
            <span className="text-destructive font-bold" title="Required">
              *
            </span>
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
              {field.fieldValue ? (
                <span>{field.fieldValue}</span>
              ) : (
                <span className="text-muted-foreground/60 text-[10px]">Select an option</span>
              )}
              <ChevronDown className="h-3 w-3 ml-1 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="p-0"
            style={{ width: 'var(--radix-popover-trigger-width)' }}
            align="start"
            onWheel={(e) => e.stopPropagation()}
          >
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
// Internal: FieldsList
// ---------------------------------------------------------------------------

interface FieldsListProps {
  fields: LocalField[];
  canonicalCode: string;
  onUpdateField: (localId: string, value: string) => void;
  onDeleteField: (localId: string) => void;
}

function FieldsList({ fields, canonicalCode, onUpdateField, onDeleteField }: FieldsListProps) {
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
        canonicalCode={canonicalCode}
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
      )
        continue;
      if (
        !evaluateDependency(
          field.fieldValue || null,
          child.conditionOperator,
          child.conditionTriggerValues
        )
      )
        continue;
      rows.push(
        <div
          key={child.localId}
          className="pl-4 ml-1 border-l-2 border-primary/20 bg-muted/20"
        >
          <FieldRow
            field={child}
            canonicalCode={canonicalCode}
            onUpdate={(val) => onUpdateField(child.localId, val)}
            onDelete={() => onDeleteField(child.localId)}
          />
        </div>
      );
    }
  }

  return <div className="rounded-md border divide-y">{rows}</div>;
}

// ---------------------------------------------------------------------------
// Internal: AddFieldForm
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
    <div className="mt-3 rounded-md border border-dashed bg-muted/20 p-3 space-y-2">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        Add Custom Field
      </p>
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
// AddItemModal
// ---------------------------------------------------------------------------

/** Describes a field that should be pre-filled and optionally locked when any item is selected. */
export interface PreFillField {
  fieldKey: string;
  fieldLabel: string;
  value: string;
  locked: boolean;
}

export interface AddItemModalProps {
  /** Category of items to browse and configure. */
  category: ItemCategory;
  /** Dialog title shown on Step 1, e.g. "Select Active Door". */
  title: string;
  itemTypes: ItemType[];
  itemTypesLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when saving a door or frame item. */
  onSaveTopLevel: (item: LocalTopLevelItem) => void;
  /** Called when saving a hardware item. */
  onSaveHardware: (item: LocalHardwareItem) => void;
  /** Field keys whose values should be mirrored from door → frame on selection. */
  passToFrameKeys?: Set<string>;
  /** The most-recently-added door item; used to pre-fill matching frame fields. */
  sourceDoor?: LocalTopLevelItem | null;
  /**
   * Fields to pre-fill (and optionally lock) in the configure step.
   * When a field key matches a field on the selected item, its value is set and
   * optionally made read-only. If the field doesn't exist on the item, it is added.
   * Used to inject door glass/louver dimensions into lite items.
   */
  preFillFields?: PreFillField[];
  /**
   * When provided, the hardware modal skips the subcategory and family steps and
   * jumps directly to the configure step for this family's canonical code.
   * Used when the caller already knows which family the user wants to configure.
   */
  initialFamilyCode?: string;
}

/**
 * Step union:
 * - Doors/frames: 'select' → 'configure'
 * - Hardware:     'subcategory' → 'family' → 'configure'
 */
type Step = 'select' | 'subcategory' | 'family' | 'configure';

export function AddItemModal({
  category,
  title,
  itemTypes,
  itemTypesLoading,
  open,
  onOpenChange,
  onSaveTopLevel,
  onSaveHardware,
  passToFrameKeys,
  sourceDoor,
  preFillFields,
  initialFamilyCode,
}: AddItemModalProps) {
  const isHardware = category === 'hardware';

  // Step state — hardware starts at 'subcategory', doors/frames at 'select'
  const [step, setStep] = useState<Step>(isHardware ? 'subcategory' : 'select');
  const [search, setSearch] = useState('');

  // Doors / frames state
  const [selectedItemType, setSelectedItemType] = useState<ItemType | null>(null);
  const [localItem, setLocalItem] = useState<LocalTopLevelItem | null>(null);

  // Hardware (legacy + family) state
  const [localHw, setLocalHw] = useState<LocalHardwareItem | null>(null);

  // Hardware progressive-disclosure state
  const [selectedSubcategory, setSelectedSubcategory] = useState<HardwareSubcategory | null>(null);
  const [selectedFamily, setSelectedFamily] = useState<HardwareCatalogItem | null>(null);
  const [hardwareFamilies, setHardwareFamilies] = useState<HardwareCatalogItem[]>([]);
  const [hardwareFamiliesLoading, setHardwareFamiliesLoading] = useState(false);
  /** Options keyed by fieldDefinitionId — used by the code builder. */
  const [hwFieldOptions, setHwFieldOptions] = useState<Map<string, FieldValueOption[]>>(
    new Map()
  );

  const [loadingFields, setLoadingFields] = useState(false);
  const [addFieldFormOpen, setAddFieldFormOpen] = useState(false);

  // Manufacturer state (doors/frames only)
  const [manufacturers, setManufacturers] = useState<Company[]>([]);
  const [manufacturersLoading, setManufacturersLoading] = useState(false);
  const [selectedManufacturerId, setSelectedManufacturerId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load hardware families once when the dialog opens
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open || !isHardware) return;
    setHardwareFamiliesLoading(true);
    getHardwareFamilies()
      .then(setHardwareFamilies)
      .catch(console.error)
      .finally(() => setHardwareFamiliesLoading(false));
  }, [open, isHardware]);

  // ---------------------------------------------------------------------------
  // Auto-select an initial family when initialFamilyCode is provided.
  // Runs once families finish loading; immediately calls handleSelectFamily to
  // skip subcategory + family steps and land directly on the configure step.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open || !isHardware || !initialFamilyCode) return;
    if (hardwareFamiliesLoading || hardwareFamilies.length === 0) return;
    // Only auto-advance if we haven't already left the subcategory step
    if (step !== 'subcategory') return;
    const family = hardwareFamilies.find((f) => f.canonicalCode === initialFamilyCode);
    if (family) {
      void handleSelectFamily(family);
    }
  // handleSelectFamily is intentionally omitted from deps — it is defined inside
  // the component and is not memoized, but calling it here is a one-shot action
  // controlled by the stable `open + initialFamilyCode + hardwareFamilies` values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isHardware, initialFamilyCode, hardwareFamiliesLoading, hardwareFamilies, step]);

  // ---------------------------------------------------------------------------
  // Reset all state when the dialog closes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!open) {
      setStep(isHardware ? 'subcategory' : 'select');
      setSearch('');
      setSelectedItemType(null);
      setLocalItem(null);
      setLocalHw(null);
      setLoadingFields(false);
      setAddFieldFormOpen(false);
      setSelectedSubcategory(null);
      setSelectedFamily(null);
      setHwFieldOptions(new Map());
      setManufacturers([]);
      setManufacturersLoading(false);
      setSelectedManufacturerId(null);
    }
  }, [open, isHardware]);

  // ---------------------------------------------------------------------------
  // Derived values for the hardware progressive-disclosure flow
  // ---------------------------------------------------------------------------

  const familiesForSubcategory = useMemo(
    () => hardwareFamilies.filter((f) => f.subcategory === selectedSubcategory),
    [hardwareFamilies, selectedSubcategory]
  );

  /** Live canonical code built from the selected family + current field values. */
  const liveHardwareCode = useMemo(() => {
    if (!selectedFamily?.isFamily || !localHw) return localHw?.canonicalCode ?? '';
    return buildHardwareCode(selectedFamily, localHw.fields, hwFieldOptions);
  }, [selectedFamily, localHw, hwFieldOptions]);

  /** Live item label built from the family label template + current field values. */
  const liveHardwareLabel = useMemo(() => {
    if (!selectedFamily?.isFamily || !localHw) return localHw?.itemLabel ?? '';
    return buildHardwareLabel(selectedFamily, localHw.fields) || localHw.itemLabel;
  }, [selectedFamily, localHw]);

  // ---------------------------------------------------------------------------
  // Step 1 helpers — filtered catalog (doors / frames only)
  // ---------------------------------------------------------------------------

  const allInCategory = itemTypes.filter((it) => it.category === category);

  const filteredItems = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return allInCategory;
    return allInCategory.filter((it) =>
      `${it.itemLabel} ${it.canonicalCode} ${it.series ?? ''} ${it.material ?? ''} ${it.subcategory ?? ''}`
        .toLowerCase()
        .includes(q)
    );
  })();

  // ---------------------------------------------------------------------------
  // Handler: select a subcategory tile (hardware only)
  // ---------------------------------------------------------------------------

  const handleSelectSubcategory = (sub: HardwareSubcategory) => {
    setSelectedSubcategory(sub);
    setStep('family');
  };

  // ---------------------------------------------------------------------------
  // Handler: select a hardware family → load its fields
  // ---------------------------------------------------------------------------

  const handleSelectFamily = async (family: HardwareCatalogItem) => {
    setSelectedFamily(family);
    setStep('configure');
    setLoadingFields(true);

    try {
      // The item_type_registry and item_type_base_fields use the slug format
      // "hardware-{lowercase-canonical-code}" (e.g. "hardware-hinge", "hardware-cont-hinge").
      const registrySlug = `hardware-${family.canonicalCode.toLowerCase()}`;

      const [allFields, typeRules] = await Promise.all([
        getBaseFieldsForCategory(registrySlug, family.canonicalCode),
        getItemTypeFieldDependencies(registrySlug),
      ]);

      const resolvedDeps = mergeDependencies(typeRules, []);
      const validFields = allFields.filter((rf) => rf.fieldDefinition);

      // Family configure fields always start empty so the user makes explicit
      // selections and sees the canonical code build up as they go.
      // (No getDefaultValuesForFields call — we intentionally skip the
      //  first-option fallback that would pre-fill everything.)
      const fields: LocalField[] = validFields.map((rf) => {
        const fieldKey = rf.fieldDefinition!.fieldKey;
        const depRule = resolvedDeps.find((dep) => dep.childField.fieldKey === fieldKey);
        return {
          localId: newLocalId(),
          fieldKey,
          fieldLabel: rf.fieldDefinition!.fieldLabel,
          fieldValue: '',
          valueType: rf.fieldDefinition!.valueType,
          fieldDefinitionId: rf.fieldDefinitionId,
          isRequired: rf.isRequired,
          ...(depRule
            ? {
                conditionalParentDefId: depRule.parentFieldDefinitionId,
                conditionOperator: depRule.operator,
                conditionTriggerValues: depRule.triggerValues,
              }
            : {}),
        };
      });

      // Append any conditional child fields not already covered by base fields
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

      // Fetch options for all fields upfront so the code builder can resolve tokens
      const defIds = fields.filter((f) => f.fieldDefinitionId).map((f) => f.fieldDefinitionId!);
      const optionPairs = await Promise.all(
        defIds.map((id) => getFieldValueOptions(id).then((opts) => [id, opts] as const))
      );
      setHwFieldOptions(new Map(optionPairs));

      setLocalHw({
        localId: newLocalId(),
        itemLabel: family.name,
        canonicalCode: family.canonicalCode,
        subcategory: family.subcategory,
        quantity: 1,
        loadingFields: false,
        fields,
      });
    } catch (err) {
      console.error('Failed to load family fields:', err);
    } finally {
      setLoadingFields(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Handler: select a door/frame item → load its fields (existing flow)
  // ---------------------------------------------------------------------------

  const handleSelectItem = async (itemType: ItemType) => {
    setSelectedItemType(itemType);
    setStep('configure');
    setLoadingFields(true);
    setSelectedManufacturerId(null);

    // Load manufacturers for doors/frames based on the series
    if (category === 'doors' || category === 'frames') {
      const pricingCategory = category as 'doors' | 'frames';
      const seriesValue = itemType.series ?? itemType.itemLabel;
      setManufacturersLoading(true);
      listManufacturersForSeries(pricingCategory, seriesValue)
        .then((mfrs) => {
          setManufacturers(mfrs);
          // Auto-select if only one manufacturer
          if (mfrs.length === 1) setSelectedManufacturerId(mfrs[0].id);
        })
        .catch(console.error)
        .finally(() => setManufacturersLoading(false));
    }

    try {
      const fieldsPromise =
        category === 'hardware'
          ? getItemTypeFields(itemType.canonicalCode)
          : getBaseFieldsForCategory(category, itemType.canonicalCode);

      const [allFields, resolvedDeps] = await Promise.all([
        fieldsPromise,
        getResolvedDependencies(itemType.canonicalCode),
      ]);

      const validFields = allFields.filter((rf) => rf.fieldDefinition);

      const fieldKeyById: Record<string, string> = {};
      for (const rf of validFields) {
        if (rf.fieldDefinitionId && rf.fieldDefinition) {
          fieldKeyById[rf.fieldDefinitionId] = rf.fieldDefinition.fieldKey;
        }
      }

      // Only pre-fill a field when the user has explicitly starred an option
      // for this specific item on the Items page. Recent-usage values and
      // global defaults are intentionally ignored so dropdowns start blank.
      const defaultValues = await getDefaultValuesForFields(
        Object.keys(fieldKeyById),
        itemType.canonicalCode,
        fieldKeyById
      );

      // Build a lookup map for any pre-fill fields (e.g. glass dimensions for lites)
      const preFillMap = new Map((preFillFields ?? []).map((p) => [p.fieldKey, p]));

      const fields: LocalField[] = validFields.map((rf) => {
        const prefill = preFillMap.get(rf.fieldDefinition!.fieldKey);
        return {
          localId: newLocalId(),
          fieldKey: rf.fieldDefinition!.fieldKey,
          fieldLabel: rf.fieldDefinition!.fieldLabel,
          fieldValue: prefill?.value ?? defaultValues[rf.fieldDefinition!.fieldKey] ?? '',
          valueType: rf.fieldDefinition!.valueType,
          fieldDefinitionId: rf.fieldDefinitionId,
          isRequired: rf.isRequired,
          isLocked: prefill?.locked ?? false,
        };
      });

      // Add any pre-fill fields that were not present on the item
      const existingFieldKeys = new Set(fields.map((f) => f.fieldKey));
      for (const prefill of preFillFields ?? []) {
        if (!existingFieldKeys.has(prefill.fieldKey)) {
          fields.unshift({
            localId: newLocalId(),
            fieldKey: prefill.fieldKey,
            fieldLabel: prefill.fieldLabel,
            fieldValue: prefill.value,
            valueType: 'string',
            isRequired: false,
            isLocked: prefill.locked,
          });
          existingFieldKeys.add(prefill.fieldKey);
        }
      }

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

      if (category === 'hardware') {
        setLocalHw({
          localId: newLocalId(),
          itemLabel: itemType.itemLabel,
          canonicalCode: itemType.canonicalCode,
          subcategory: (itemType.subcategory as HardwareSubcategory) ?? null,
          quantity: 1,
          loadingFields: false,
          fields,
        });
      } else {
        const cat = category as 'doors' | 'frames' | 'panels';
        let itemLabel = itemType.itemLabel;

        if (cat === 'doors' || cat === 'frames') {
          const descKey = cat === 'doors' ? 'door_description_code' : 'frame_description';
          const descField = fields.find((f) => f.fieldKey === descKey);
          if (descField?.fieldValue) itemLabel = descField.fieldValue;
        }

        let item: LocalTopLevelItem = {
          localId: newLocalId(),
          itemLabel,
          canonicalCode: itemType.canonicalCode,
          category: cat,
          loadingFields: false,
          fields,
          manufacturerId: selectedManufacturerId,
        };

        if (cat === 'frames' && sourceDoor && passToFrameKeys && passToFrameKeys.size > 0) {
          item = applyDoorValuesToFrame(item, sourceDoor, passToFrameKeys);
        }

        setLocalItem(item);
      }
    } catch (err) {
      console.error('Failed to load item fields:', err);
    } finally {
      setLoadingFields(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Step 2 field handlers
  // ---------------------------------------------------------------------------

  const handleUpdateField = (fieldLocalId: string, value: string) => {
    if (category === 'hardware') {
      setLocalHw((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          fields: prev.fields.map((f) =>
            f.localId === fieldLocalId ? { ...f, fieldValue: value } : f
          ),
        };
      });
    } else {
      setLocalItem((prev) => {
        if (!prev) return prev;
        const descKey =
          prev.category === 'doors'
            ? 'door_description_code'
            : prev.category === 'frames'
            ? 'frame_description'
            : null;
        const changedField = prev.fields.find((f) => f.localId === fieldLocalId);
        const isDesc = descKey !== null && changedField?.fieldKey === descKey;
        return {
          ...prev,
          ...(isDesc && value ? { itemLabel: value } : {}),
          fields: prev.fields.map((f) =>
            f.localId === fieldLocalId ? { ...f, fieldValue: value } : f
          ),
        };
      });
    }
  };

  const handleDeleteField = (fieldLocalId: string) => {
    if (category === 'hardware') {
      setLocalHw((prev) =>
        prev ? { ...prev, fields: prev.fields.filter((f) => f.localId !== fieldLocalId) } : prev
      );
    } else {
      setLocalItem((prev) =>
        prev ? { ...prev, fields: prev.fields.filter((f) => f.localId !== fieldLocalId) } : prev
      );
    }
  };

  const handleAddField = (field: Omit<LocalField, 'localId'>) => {
    const withId: LocalField = { ...field, localId: newLocalId() };
    if (category === 'hardware') {
      setLocalHw((prev) => (prev ? { ...prev, fields: [...prev.fields, withId] } : prev));
    } else {
      setLocalItem((prev) => (prev ? { ...prev, fields: [...prev.fields, withId] } : prev));
    }
    setAddFieldFormOpen(false);
  };

  // ---------------------------------------------------------------------------
  // Back navigation
  // ---------------------------------------------------------------------------

  const goBack = () => {
    if (step === 'configure') {
      if (isHardware) {
        setStep('family');
      } else {
        setStep('select');
        setLocalItem(null);
        setSelectedItemType(null);
      }
      setLocalHw(null);
      setHwFieldOptions(new Map());
      setAddFieldFormOpen(false);
      setSelectedFamily(null);
    } else if (step === 'family') {
      setStep('subcategory');
      setSelectedSubcategory(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = () => {
    if (category === 'hardware' && localHw) {
      // For family items, stamp the assembled code + label before handing off
      const hwToSave =
        selectedFamily?.isFamily
          ? {
              ...localHw,
              canonicalCode: liveHardwareCode || localHw.canonicalCode,
              itemLabel: liveHardwareLabel || localHw.itemLabel,
            }
          : localHw;
      onSaveHardware(hwToSave);
    } else if (localItem) {
      onSaveTopLevel({ ...localItem, manufacturerId: selectedManufacturerId });
    }
    onOpenChange(false);
  };

  const currentFields =
    category === 'hardware' ? (localHw?.fields ?? []) : (localItem?.fields ?? []);
  const canSave = category === 'hardware' ? !!localHw : !!localItem;

  // Configure-step header values depend on whether we're in the family flow or legacy flow
  const configureBadge =
    isHardware && selectedFamily?.isFamily
      ? liveHardwareCode
      : selectedItemType?.canonicalCode ?? selectedFamily?.canonicalCode ?? '';

  const configureTitleText = loadingFields
    ? 'Loading fields…'
    : isHardware && selectedFamily?.isFamily
    ? liveHardwareLabel || selectedFamily?.name || 'Configure Item'
    : (category === 'hardware' ? localHw?.itemLabel : localItem?.itemLabel) ??
      selectedItemType?.itemLabel ??
      'Configure Item';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">

        {/* ── Hardware Step 1: Subcategory tiles ── */}
        {step === 'subcategory' && (
          <>
            <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
              <DialogTitle>Select Hardware Category</DialogTitle>
              <DialogDescription>
                Choose the type of hardware you want to add.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <div className="grid grid-cols-2 gap-3">
                {HARDWARE_SUBCATEGORY_ORDER.map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => handleSelectSubcategory(sub)}
                    className="flex flex-col items-center gap-2 rounded-lg border-2 border-transparent bg-muted/50 px-4 py-5 hover:border-primary hover:bg-accent transition-colors text-center"
                  >
                    <span className="text-2xl" role="img" aria-label={HARDWARE_SUBCATEGORY_LABEL[sub]}>
                      {SUBCATEGORY_ICON[sub]}
                    </span>
                    <span className="font-semibold text-sm">{HARDWARE_SUBCATEGORY_LABEL[sub]}</span>
                    <span className="text-[11px] text-muted-foreground">{SUBCATEGORY_DESC[sub]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t px-6 py-4 shrink-0 flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* ── Hardware Step 2: Family list ── */}
        {step === 'family' && (
          <>
            <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b">
              <div className="flex items-start gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 mt-0.5 shrink-0"
                  onClick={goBack}
                  title="Back to category selection"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <DialogTitle>
                    {selectedSubcategory
                      ? HARDWARE_SUBCATEGORY_LABEL[selectedSubcategory]
                      : 'Select Family'}
                  </DialogTitle>
                  <DialogDescription>
                    Choose a hardware family to configure.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              {hardwareFamiliesLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : familiesForSubcategory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No families available for this category yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {familiesForSubcategory.map((family) => (
                    <button
                      key={family.id}
                      type="button"
                      onClick={() => handleSelectFamily(family)}
                      className="w-full flex items-center gap-2 rounded-md border px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-medium block truncate">{family.name}</span>
                        {family.description && (
                          <span className="text-[11px] text-muted-foreground truncate block">
                            {family.description}
                          </span>
                        )}
                      </div>
                      <Badge variant="secondary" className="font-mono text-[10px] shrink-0">
                        {family.codePrefix ?? family.canonicalCode}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t px-6 py-4 shrink-0 flex justify-between">
              <Button variant="outline" onClick={goBack}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* ── Doors/Frames Step 1: Select item ── */}
        {step === 'select' && (
          <>
            <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                Search and select an item from the catalog.
              </DialogDescription>
            </DialogHeader>

            {/* Search */}
            <div className="px-6 pb-3 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  autoFocus
                  placeholder={`Search ${category}…`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Catalog list */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-2">
              {itemTypesLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {search ? 'No items match your search.' : 'No items available.'}
                </p>
              ) : (
                <div className="space-y-1">
                  {filteredItems.map((it) => (
                    <CatalogRow key={it.canonicalCode} item={it} onSelect={handleSelectItem} />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t px-6 py-4 shrink-0 flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* ── Step (last): Configure fields ── */}
        {step === 'configure' && (
          <>
            <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b">
              <div className="flex items-start gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 mt-0.5 shrink-0"
                  onClick={goBack}
                  title="Back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                  <DialogTitle className="truncate">{configureTitleText}</DialogTitle>
                  {(selectedItemType || selectedFamily) && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {configureBadge}
                      </Badge>
                      <button
                        type="button"
                        onClick={goBack}
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      >
                        Change item
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </DialogHeader>

            {/* Fields */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              {loadingFields ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* Manufacturer picker — shown for doors and frames only */}
                  {(category === 'doors' || category === 'frames') && (
                    <div className="mb-3 rounded-md border bg-muted/20 px-3 py-2 flex items-center gap-3">
                      <p className="text-[11px] font-medium text-muted-foreground w-28 shrink-0">
                        Manufacturer
                      </p>
                      {manufacturersLoading ? (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading…
                        </div>
                      ) : manufacturers.length === 0 ? (
                        <p className="text-xs text-muted-foreground/60 italic">No pricing tables set up yet</p>
                      ) : (
                        <Select
                          value={selectedManufacturerId ?? ''}
                          onValueChange={(val) => setSelectedManufacturerId(val || null)}
                        >
                          <SelectTrigger className="h-7 text-xs flex-1">
                            <SelectValue placeholder="Select manufacturer…" />
                          </SelectTrigger>
                          <SelectContent>
                            {manufacturers.map((m) => (
                              <SelectItem key={m.id} value={m.id} className="text-xs">
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}

                  {currentFields.length === 0 && !addFieldFormOpen && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No fields defined for this item. You can add custom fields below.
                    </p>
                  )}

                  <FieldsList
                    fields={currentFields}
                    canonicalCode={
                      selectedItemType?.canonicalCode ??
                      selectedFamily?.canonicalCode ??
                      ''
                    }
                    onUpdateField={handleUpdateField}
                    onDeleteField={handleDeleteField}
                  />

                  {addFieldFormOpen ? (
                    <AddFieldForm
                      onAdd={handleAddField}
                      onCancel={() => setAddFieldFormOpen(false)}
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs mt-2 text-muted-foreground"
                      onClick={() => setAddFieldFormOpen(true)}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Field
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="border-t px-6 py-4 shrink-0 flex justify-between items-center">
              <Button variant="outline" onClick={goBack}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={handleSave} disabled={!canSave || loadingFields}>
                Save Item
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CatalogRow — single item row in the doors/frames Step 1 list
// ---------------------------------------------------------------------------

function CatalogRow({
  item,
  onSelect,
}: {
  item: ItemType;
  onSelect: (item: ItemType) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="w-full rounded-md border px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors"
    >
      <span className="font-medium block truncate">{item.itemLabel}</span>
    </button>
  );
}
