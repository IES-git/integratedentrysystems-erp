import { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Loader2,
  ChevronDown,
  ArrowLeft,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  getItemTypeFields,
  getBaseFieldsForCategory,
  getDefaultValuesForFields,
  getHardwareFamilies,
  getFieldValueOptions,
} from '@/lib/estimates-api';
import { getPricedSpecValues } from '@/lib/pricing-api';
import { getResolvedDependencies, getItemTypeFieldDependencies } from '@/lib/item-fields-api';
import { mergeDependencies } from '@/lib/field-dependencies';
import { FieldRow, FieldsList, AddFieldForm } from './FieldEditors';
import { applyDoorValuesToFrame } from '@/lib/door-frame-sync';
import {
  HARDWARE_SUBCATEGORY_ORDER,
  HARDWARE_SUBCATEGORY_LABEL,
} from '@/lib/hardware-utils';
import { buildHardwareCode, buildHardwareLabel } from '@/lib/hardware-code-builder';
import { listManufacturersForCategory } from '@/lib/pricing-api';
import { LivePriceBadge } from './LivePriceBadge';
import { resolveSpecAcrossManufacturers, type ManufacturerPriceResult } from '@/lib/pricing-lookup';
import type {
  ItemType,
  ItemCategory,
  FieldValueType,
  HardwareSubcategory,
  HardwareCatalogItem,
  Company,
} from '@/types';
import type { LocalField } from './FieldEditors';

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
// Shared types — re-exported from FieldEditors for backward compat
// ---------------------------------------------------------------------------

export type { LocalField } from './FieldEditors';

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

  // Availability filtering: map of fieldKey → set of priced values
  const [pricedValuesByKey, setPricedValuesByKey] = useState<Map<string, Set<string>> | undefined>(undefined);

  // Spec-first manufacturer comparison
  const [mfrResults, setMfrResults] = useState<ManufacturerPriceResult[]>([]);
  const [mfrLoading, setMfrLoading] = useState(false);

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
      setPricedValuesByKey(undefined);
      setMfrResults([]);
      setMfrLoading(false);
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

    // Load manufacturers for doors/frames. Spec-driven: list every vendor with a
    // base table in this category (not keyed by series) — the user picks the
    // manufacturer and the engine resolves the series from the configured specs.
    if (category === 'doors' || category === 'frames') {
      const pricingCategory = category as 'doors' | 'frames';
      setManufacturersLoading(true);
      listManufacturersForCategory(pricingCategory)
        .then((mfrs) => {
          setManufacturers(mfrs);
          // Auto-select if only one manufacturer
          if (mfrs.length === 1) setSelectedManufacturerId(mfrs[0].id);
        })
        .catch(console.error)
        .finally(() => setManufacturersLoading(false));

      // Load availability data for spec fields so dropdowns can show
      // which values are actually priced by at least one manufacturer.
      const specKeys = pricingCategory === 'doors'
        ? ['edge_construction', 'core_construction', 'gauge', 'material']
        : ['frame_type', 'frame_fabrication', 'gauge', 'depth'];
      Promise.all(specKeys.map((k) => getPricedSpecValues(k, pricingCategory).then((vals) => [k, new Set(vals)] as const)))
        .then((pairs) => setPricedValuesByKey(new Map(pairs)))
        .catch(() => setPricedValuesByKey(undefined));
    } else {
      setPricedValuesByKey(undefined);
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

      // Build a dep map so we can stamp conditional metadata onto base fields too.
      // (Without this, a field that IS a conditional child AND is listed as a base
      // field would always show — the dep metadata is only on the extra-fields pass.)
      const depByChildFieldDefId = new Map(resolvedDeps.map((d) => [d.childField.id, d]));

      const fields: LocalField[] = validFields.map((rf) => {
        const prefill = preFillMap.get(rf.fieldDefinition!.fieldKey);
        const dep = rf.fieldDefinitionId ? depByChildFieldDefId.get(rf.fieldDefinitionId) : undefined;
        return {
          localId: newLocalId(),
          fieldKey: rf.fieldDefinition!.fieldKey,
          fieldLabel: rf.fieldDefinition!.fieldLabel,
          fieldValue: prefill?.value ?? defaultValues[rf.fieldDefinition!.fieldKey] ?? '',
          valueType: rf.fieldDefinition!.valueType,
          fieldDefinitionId: rf.fieldDefinitionId,
          isRequired: rf.isRequired,
          isLocked: prefill?.locked ?? false,
          // Attach conditional metadata when this base field is also a dep child
          ...(dep
            ? {
                conditionalParentDefId: dep.parentFieldDefinitionId,
                conditionOperator: dep.operator,
                conditionTriggerValues: dep.triggerValues,
              }
            : {}),
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

      // Append conditional child fields not already included as base fields
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

          // applyDoorValuesToFrame only updates fields that already exist on the
          // frame. opening_width / opening_height are door-specific fields that
          // don't appear on frame catalog items, but the pricing engine needs them
          // to match a pricing row. Inject them as locked fields when the source
          // door has values for them.
          const doorWidth = sourceDoor.fields.find((f) => f.fieldKey === 'opening_width')?.fieldValue ?? '';
          const doorHeight = sourceDoor.fields.find((f) => f.fieldKey === 'opening_height')?.fieldValue ?? '';
          const dimInjects: typeof item.fields = [];
          if (doorWidth && !item.fields.some((f) => f.fieldKey === 'opening_width')) {
            dimInjects.push({ localId: newLocalId(), fieldKey: 'opening_width', fieldLabel: 'Nominal Width', fieldValue: doorWidth, valueType: 'string', isRequired: false, isLocked: true });
          }
          if (doorHeight && !item.fields.some((f) => f.fieldKey === 'opening_height')) {
            dimInjects.push({ localId: newLocalId(), fieldKey: 'opening_height', fieldLabel: 'Nominal Height', fieldValue: doorHeight, valueType: 'string', isRequired: false, isLocked: true });
          }
          if (dimInjects.length > 0) {
            item = { ...item, fields: [...dimInjects, ...item.fields] };
          }
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
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <DialogTitle className="truncate">{configureTitleText}</DialogTitle>
                    {/* Live price badge for doors/frames */}
                    {(category === 'doors' || category === 'frames') && localItem && (
                      <LivePriceBadge
                        category={category}
                        canonicalCode={localItem.canonicalCode}
                        itemLabel={localItem.itemLabel}
                        manufacturerId={selectedManufacturerId}
                        fields={localItem.fields.map((f) => ({ fieldKey: f.fieldKey, fieldValue: f.fieldValue, fieldLabel: f.fieldLabel }))}
                      />
                    )}
                  </div>
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
                  {/* Spec-first manufacturer comparison — shown for doors and frames */}
                  {(category === 'doors' || category === 'frames') && (
                    <div className="mb-3 space-y-2">
                      {/* Show comparison panel if results are loaded */}
                      {mfrResults.length > 0 ? (
                        <div className="rounded-md border bg-muted/10 divide-y">
                          <div className="px-3 py-1.5 flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                              Available manufacturers ({mfrResults.filter((r) => r.result.status === 'matched').length} priced)
                            </p>
                            <button
                              type="button"
                              className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                              onClick={() => { setMfrResults([]); setSelectedManufacturerId(null); }}
                            >
                              Clear
                            </button>
                          </div>
                          {mfrResults.map((r) => {
                            const isSelected = selectedManufacturerId === r.manufacturerId;
                            const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
                            return (
                              <button
                                key={r.manufacturerId}
                                type="button"
                                onClick={() => setSelectedManufacturerId(r.manufacturerId)}
                                className={cn(
                                  'w-full px-3 py-2 text-left text-xs flex items-center gap-3 transition-colors',
                                  isSelected ? 'bg-primary/10 font-medium' : 'hover:bg-muted/30',
                                )}
                              >
                                <div className="flex-1 min-w-0">
                                  <span className="font-medium block truncate">{r.manufacturerName}</span>
                                  <span className="text-[10px] text-muted-foreground">{r.seriesValue}</span>
                                </div>
                                {r.result.status === 'matched' && r.result.totalUnitPrice != null ? (
                                  <span className="text-green-700 font-semibold shrink-0">{fmt(r.result.totalUnitPrice)}</span>
                                ) : (
                                  <span className="text-muted-foreground/50 text-[10px] shrink-0">{r.result.status.replace(/_/g, ' ')}</span>
                                )}
                                {isSelected && <span className="text-primary text-[10px] shrink-0">✓</span>}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-md border bg-muted/20 px-3 py-2 flex items-center gap-3">
                          <p className="text-[11px] font-medium text-muted-foreground w-28 shrink-0">
                            Manufacturer
                          </p>
                          {selectedManufacturerId ? (
                            <div className="flex items-center gap-2 flex-1">
                              <span className="text-xs">{manufacturers.find((m) => m.id === selectedManufacturerId)?.name ?? 'Selected'}</span>
                              <button type="button" onClick={() => setSelectedManufacturerId(null)} className="text-[10px] text-muted-foreground hover:text-foreground underline">change</button>
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs flex-1"
                              disabled={mfrLoading || !localItem}
                              onClick={async () => {
                                if (!localItem || (category !== 'doors' && category !== 'frames')) return;
                                const fMap = Object.fromEntries(localItem.fields.map((f) => [f.fieldKey, f.fieldValue]));
                                const widthRaw = fMap['opening_width'] ?? null;
                                const heightRaw = fMap['opening_height'] ?? null;
                                setMfrLoading(true);
                                try {
                                  const results = await resolveSpecAcrossManufacturers(
                                    category as 'doors' | 'frames',
                                    fMap,
                                    { widthRaw, heightRaw },
                                  );
                                  setMfrResults(results);
                                  // Auto-select if only one matched
                                  const matched = results.filter((r) => r.result.status === 'matched');
                                  if (matched.length === 1) setSelectedManufacturerId(matched[0].manufacturerId);
                                } catch {
                                  // Fall back to list
                                  setMfrResults([]);
                                } finally {
                                  setMfrLoading(false);
                                }
                              }}
                            >
                              {mfrLoading ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Finding…</> : 'Find matching manufacturers'}
                            </Button>
                          )}
                        </div>
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
                    pricedValuesByKey={pricedValuesByKey}
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
