import { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Loader2,
  DoorOpen,
  Square,
  Wrench,
  LayoutPanelLeft,
  ChevronDown,
  AlertCircle,
  GlassWater,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { cn } from '@/lib/utils';
import {
  getItemTypes,
  createEstimateOpening,
  addEstimateItem,
  addItemField,
  recordFieldValueUsage,
  updateEstimateOpening,
  deleteEstimateItem,
} from '@/lib/estimates-api';
import { getPassToFrameFieldKeys } from '@/lib/item-fields-api';
import { evaluateDependency } from '@/lib/field-dependencies';
import { evaluateOpeningCompatibility } from '@/lib/compatibility-engine';
import { listCompatibilityRules } from '@/lib/compatibility-rules-api';

import { syncDoorFieldToFrames } from '@/lib/door-frame-sync';
import { groupHardwareBySubcategory } from '@/lib/hardware-utils';
import { resolveAndPersistItemPrice } from '@/lib/pricing-lookup';
import { LivePriceBadge } from './LivePriceBadge';
import { parseDimensionToInches, calcHingeQty } from './opening-rules';
import {
  AddItemModal,
  newLocalId,
  type LocalTopLevelItem,
  type LocalHardwareItem,
} from './AddItemModal';
import { FieldRow, FieldsList, AddFieldForm, type LocalField } from './FieldEditors';
import {
  GLASS_OR_LOUVER_FIELD_KEY,
  GLASS_OR_LOUVER_TRIGGER_VALUE,
  GLASS_OR_LOUVER_WIDTH_KEY,
  GLASS_OR_LOUVER_HEIGHT_KEY,
  LITES_ITEM_TYPE,
  liteLocalIdForDoor,
  syncLiteDimensionsFromDoor,
} from './lite-glass-utils';
import type {
  ItemType,
  EstimateOpening,
  EstimateOpeningWithItems,
  EstimateItemWithHardware,
  ItemField,
  HardwareSubcategory,
  CompatibilityRule,
  CompatibilityViolation,
} from '@/types';

interface BuildOpeningDialogProps {
  /** Existing estimate ID, if already created. Provide this OR resolveEstimateId. */
  estimateId: string | null;
  /**
   * Async callback that creates (or returns) the estimate ID.
   * Called inside handleSave so the estimate record is only written when the
   * user actually commits an opening, not when they merely open the dialog.
   */
  resolveEstimateId?: () => Promise<string | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (opening: EstimateOpeningWithItems) => void;
  onUpdated?: (opening: EstimateOpeningWithItems) => void;
  openingCount?: number;
  editingOpening?: EstimateOpeningWithItems;
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
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(item.localId)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <FieldsList
          fields={item.fields}
          canonicalCode={item.canonicalCode}
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
            canonicalCode={hw.canonicalCode}
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
  resolveEstimateId,
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
  const [liteItems, setLiteItems] = useState<LocalTopLevelItem[]>([]);
  const [hardwareItems, setHardwareItems] = useState<LocalHardwareItem[]>([]);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [itemTypesLoading, setItemTypesLoading] = useState(false);
  const [doorModalOpen, setDoorModalOpen] = useState(false);
  const [frameModalOpen, setFrameModalOpen] = useState(false);
  const [panelModalOpen, setPanelModalOpen] = useState(false);
  const [liteModalOpen, setLiteModalOpen] = useState(false);
  const [hardwareModalOpen, setHardwareModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addFieldFormOpenForId, setAddFieldFormOpenForId] = useState<string | null>(null);
  const [addHwFieldFormOpenForId, setAddHwFieldFormOpenForId] = useState<string | null>(null);

  // Field keys from doors that should be mirrored to matching frame fields
  const [passToFrameKeys, setPassToFrameKeys] = useState<Set<string>>(new Set());

  // Live compatibility rules + violations (debounced)
  const [compatRules, setCompatRules] = useState<CompatibilityRule[]>([]);
  const [liveViolations, setLiveViolations] = useState<CompatibilityViolation[]>([]);

  // Door and frame use different field keys for handing — map them explicitly.
  // Door stores it as 'handing'; frame stores it as 'hand'.
  const DOOR_HANDING_KEY = 'handing';
  const FRAME_HANDING_KEY = 'hand';

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
    setLiteItems([]);
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
    listCompatibilityRules(true)
      .then(setCompatRules)
      .catch(() => { /* non-fatal */ });
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
    const lites: LocalTopLevelItem[] = [];

    for (const item of opening.items) {
      const matchedType = types.find((t) => t.canonicalCode === item.canonicalCode);

      // Lites / Louvers / Glass are their own category
      if (item.itemType === LITES_ITEM_TYPE || matchedType?.category === LITES_ITEM_TYPE) {
        const existingFields = (item as unknown as { fields: ItemField[] }).fields ?? [];
        const fields: LocalField[] = existingFields.map((f) => ({
          localId: newLocalId(),
          fieldKey: f.fieldKey,
          fieldLabel: f.fieldLabel,
          fieldValue: f.fieldValue,
          valueType: f.valueType,
          fieldDefinitionId: f.fieldDefinitionId ?? undefined,
          isRequired: false,
          // Lock width and height on lites — they are always driven by the door
          isLocked: f.fieldKey === 'width' || f.fieldKey === 'height',
        }));
        lites.push({
          localId: newLocalId(),
          itemLabel: item.itemLabel,
          canonicalCode: item.canonicalCode,
          category: LITES_ITEM_TYPE,
          loadingFields: false,
          fields,
          manufacturerId: item.manufacturerId ?? null,
        });
        continue;
      }

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
        manufacturerId: item.manufacturerId ?? null,
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
    setLiteItems(lites);

    // Collect all hardware: opening-level (new style) + nested under door/frame (legacy)
    const allHardware: LocalHardwareItem[] = [];

    for (const hw of opening.hardware ?? []) {
      const hwFields = (hw as unknown as { fields: ItemField[] }).fields ?? [];
      allHardware.push({
        localId: newLocalId(),
        itemLabel: hw.itemLabel,
        canonicalCode: hw.canonicalCode,
        subcategory: hw.subcategory ?? null,
        quantity: hw.quantity ?? 1,
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
          quantity: hw.quantity ?? 1,
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

  // Live compatibility: re-evaluate whenever any item's fields change (debounced 400ms).
  useEffect(() => {
    if (compatRules.length === 0) return;
    const allItems = [...doorItems, ...frameItems, ...panelItems, ...liteItems];
    if (allItems.length === 0) { setLiveViolations([]); return; }

    const t = setTimeout(() => {
      // Build synthetic items + fieldsByItem map from local draft state
      const items = allItems.map((item) => ({
        id: item.localId,
        canonicalCode: item.canonicalCode,
        itemLabel: item.itemLabel,
        itemType: item.category as string,
        // Minimal required fields for the engine
        estimateId: null, quantity: 1, unitPrice: null, sortOrder: 0,
        manufacturerId: item.manufacturerId, subcategory: null,
        isManualPriceOverride: false, createdAt: '',
      }));
      const fieldsByItem = new Map(allItems.map((item) => [
        item.localId,
        item.fields.map((f) => ({
          id: f.localId,
          estimateItemId: item.localId,
          fieldDefinitionId: f.fieldDefinitionId ?? null,
          fieldKey: f.fieldKey,
          fieldLabel: f.fieldLabel,
          fieldValue: f.fieldValue,
          valueType: f.valueType,
          sourceConfidence: null,
          createdAt: '', updatedAt: '',
        } as ItemField)),
      ]));
      const violations = evaluateOpeningCompatibility(compatRules, { items, fieldsByItem });
      setLiveViolations(violations);
    }, 400);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compatRules, doorItems, frameItems, panelItems, liteItems]);

  // Items arrive fully built (with fields) from AddItemModal — just append them.
  const handleSelectDoor = (item: LocalTopLevelItem) => {
    setDoorItems((prev) => [...prev, item]);
  };

  const handleSelectFrame = (item: LocalTopLevelItem) => {
    // The active door is always index 0 — either the single door or the active
    // leaf on a pair. Pre-fill the frame's 'hand' field from that door's 'handing'.
    const activeDoor = doorItems[0] ?? null;
    const handingValue = activeDoor?.fields.find((f) => f.fieldKey === DOOR_HANDING_KEY)?.fieldValue ?? '';

    if (handingValue) {
      const hasHandField = item.fields.some((f) => f.fieldKey === FRAME_HANDING_KEY);
      const updatedItem: LocalTopLevelItem = hasHandField
        ? {
            ...item,
            fields: item.fields.map((f) =>
              f.fieldKey === FRAME_HANDING_KEY ? { ...f, fieldValue: handingValue } : f
            ),
          }
        : item;
      setFrameItems((prev) => [...prev, updatedItem]);
    } else {
      setFrameItems((prev) => [...prev, item]);
    }
  };

  const handleSelectPanel = (item: LocalTopLevelItem) => {
    setPanelItems((prev) => [...prev, item]);
  };

  const handleSelectLite = (item: LocalTopLevelItem) => {
    // Apply locked width/height from the first door that has "Yes Lite or Louver"
    const sourceDoor = doorItems.find((d) =>
      d.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_FIELD_KEY)?.fieldValue ===
        GLASS_OR_LOUVER_TRIGGER_VALUE
    );

    if (!sourceDoor) {
      setLiteItems((prev) => [...prev, item]);
      return;
    }

    const widthValue =
      sourceDoor.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_WIDTH_KEY)?.fieldValue ?? '';
    const heightValue =
      sourceDoor.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_HEIGHT_KEY)?.fieldValue ?? '';

    // Override width/height fields with door's glass dimensions and lock them
    let processedItem: LocalTopLevelItem = {
      ...item,
      fields: item.fields.map((f) => {
        if (f.fieldKey === 'width') return { ...f, fieldValue: widthValue, isLocked: true };
        if (f.fieldKey === 'height') return { ...f, fieldValue: heightValue, isLocked: true };
        return f;
      }),
    };

    // If width/height weren't already in the item's fields, add them at the front
    const hasWidth = processedItem.fields.some((f) => f.fieldKey === 'width');
    const hasHeight = processedItem.fields.some((f) => f.fieldKey === 'height');
    const extraFields: LocalField[] = [];
    if (!hasWidth && widthValue) {
      extraFields.push({ localId: newLocalId(), fieldKey: 'width', fieldLabel: 'Width', fieldValue: widthValue, valueType: 'string', isRequired: false, isLocked: true });
    }
    if (!hasHeight && heightValue) {
      extraFields.push({ localId: newLocalId(), fieldKey: 'height', fieldLabel: 'Height', fieldValue: heightValue, valueType: 'string', isRequired: false, isLocked: true });
    }
    if (extraFields.length > 0) {
      processedItem = { ...processedItem, fields: [...extraFields, ...processedItem.fields] };
    }

    setLiteItems((prev) => [...prev, processedItem]);
  };

  const handleSelectHardware = (hw: LocalHardwareItem) => {
    const isHinge = hw.canonicalCode.startsWith('HINGE') || hw.canonicalCode.startsWith('CONT-HINGE');
    const isAnchor = hw.canonicalCode.startsWith('ANCHOR');
    if (isHinge || isAnchor) {
      const isPair = doorItems.length >= 2;
      const heightIn = parseDimensionToInches(
        doorItems[0]?.fields.find((f) => f.fieldKey === 'opening_height')?.fieldValue
      );
      const autoQty = calcHingeQty(heightIn, isPair);
      setHardwareItems((prev) => [...prev, { ...hw, quantity: autoQty }]);
    } else {
      setHardwareItems((prev) => [...prev, hw]);
    }
  };

  const handleUpdateHwQuantity = (hwLocalId: string, qty: number) => {
    setHardwareItems((prev) =>
      prev.map((h) => (h.localId === hwLocalId ? { ...h, quantity: qty } : h))
    );
  };

  const handleDeleteItem = (category: 'doors' | 'frames' | 'panels' | 'lites_louvers_glass', localId: string) => {
    if (category === 'doors') {
      setDoorItems((prev) => prev.filter((i) => i.localId !== localId));
      // Remove any auto-generated lite item linked to this door
      setLiteItems((prev) => prev.filter((l) => l.localId !== liteLocalIdForDoor(localId)));
    } else if (category === 'frames') {
      setFrameItems((prev) => prev.filter((i) => i.localId !== localId));
    } else if (category === 'lites_louvers_glass') {
      setLiteItems((prev) => prev.filter((i) => i.localId !== localId));
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
    // before applying the update so we can sync to frames and lites if needed.
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

    // Sync handing from the active door to all frames.
    // Door uses field key 'handing'; frame uses 'hand' — handle the mapping here.
    // Only the active door drives the frame: index 0 for single, index 0 (active
    // leaf) for a pair.
    if (doorItem && changedFieldKey === DOOR_HANDING_KEY) {
      const isActiveDoor = doorItems[0]?.localId === doorItem.localId;
      if (isActiveDoor) {
        setFrameItems((prev) =>
          prev.map((frame) => ({
            ...frame,
            fields: frame.fields.map((f) =>
              f.fieldKey === FRAME_HANDING_KEY ? { ...f, fieldValue: value } : f
            ),
          }))
        );
      }
    }

    // When a door's glass dimensions change, sync the locked width/height on any
    // lite items that were added with locked dimensions from this door.
    if (
      doorItem &&
      (changedFieldKey === GLASS_OR_LOUVER_WIDTH_KEY ||
        changedFieldKey === GLASS_OR_LOUVER_HEIGHT_KEY)
    ) {
      const updatedDoor: LocalTopLevelItem = {
        ...doorItem,
        fields: doorItem.fields.map((f) =>
          f.localId === fieldLocalId ? { ...f, fieldValue: value } : f
        ),
      };
      setLiteItems((prev) =>
        prev.map((l) => syncLiteDimensionsFromDoor(l, updatedDoor))
      );
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
  // Lite item field handlers
  // ---------------------------------------------------------------------------

  const handleUpdateLiteField = (liteLocalId: string, fieldLocalId: string, value: string) => {
    setLiteItems((prev) =>
      prev.map((l) =>
        l.localId === liteLocalId
          ? { ...l, fields: l.fields.map((f) => (f.localId === fieldLocalId ? { ...f, fieldValue: value } : f)) }
          : l
      )
    );
  };

  const handleDeleteLiteField = (liteLocalId: string, fieldLocalId: string) => {
    setLiteItems((prev) =>
      prev.map((l) =>
        l.localId === liteLocalId
          ? { ...l, fields: l.fields.filter((f) => f.localId !== fieldLocalId) }
          : l
      )
    );
  };

  const handleAddLiteField = (liteLocalId: string, field: Omit<LocalField, 'localId'>) => {
    setLiteItems((prev) =>
      prev.map((l) =>
        l.localId === liteLocalId
          ? { ...l, fields: [...l.fields, { ...field, localId: newLocalId() }] }
          : l
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
      // Resolve estimate ID — create the estimate record only now, on first save.
      const eid = estimateId ?? (resolveEstimateId ? await resolveEstimateId() : null);
      if (!eid) {
        setSaveError('Unable to create estimate. Please try again.');
        return;
      }

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
        openingData = await createEstimateOpening(eid, name.trim(), quantity);
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

      // Inject door_role fields for pair openings (2+ door items)
      const isPair = doorItems.length >= 2;
      const doorsWithRole: Array<{ item: LocalTopLevelItem; fieldsToSave: LocalField[] }> =
        doorItems.map((door, idx) => ({
          item: door,
          fieldsToSave: isPair
            ? [
                ...door.fields.filter((f) => f.fieldKey !== 'door_role'),
                {
                  localId: newLocalId(),
                  fieldKey: 'door_role',
                  fieldLabel: 'Door Role',
                  fieldValue: idx === 0 ? 'active' : 'inactive',
                  valueType: 'string' as const,
                  isRequired: false,
                  isLocked: true,
                },
              ]
            : door.fields,
        }));

      // Save door, frame, panel, and lite items (no hardware children)
      const itemsWithHardware: EstimateItemWithHardware[] = [];
      const allItemsToSave: Array<{ item: LocalTopLevelItem; fieldsToSave: LocalField[] }> = [
        ...doorsWithRole,
        ...frameItems.map((item) => ({ item, fieldsToSave: item.fields })),
        ...panelItems.map((item) => ({ item, fieldsToSave: item.fields })),
        ...liteItems.map((item) => ({ item, fieldsToSave: item.fields })),
      ];

      for (const { item: localItem, fieldsToSave } of allItemsToSave) {
        const created = await addEstimateItem(eid, {
          itemLabel: localItem.itemLabel,
          canonicalCode: localItem.canonicalCode,
          quantity: 1,
          sortOrder: itemsWithHardware.length,
          openingId: openingData.id,
          parentItemId: null,
          itemType: localItem.category,
          manufacturerId: localItem.manufacturerId ?? null,
        });
        const savedFields = await saveLocalFields(created.id, fieldsToSave);
        // Await pricing lookup so price is persisted before the dialog closes.
        // Wrapped in try/catch so a lookup failure never blocks the save.
        try {
          await resolveAndPersistItemPrice(created.id, { ...created, manufacturerId: localItem.manufacturerId ?? null }, savedFields);
        } catch { /* pricing errors never block save */ }
        itemsWithHardware.push({ ...created, hardware: [] });
      }

      // Save opening-level hardware items (parent_item_id = null, subcategory set)
      const savedHardware = [];
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
          itemType: hw.subcategory ? `hardware-${hw.canonicalCode.split('-')[0].toLowerCase()}` : 'hardware',
        });
        const hwFields = await saveLocalFields(created.id, hw.fields);
        // Resolve hardware price on save (best-effort, never blocks)
        try {
          await resolveAndPersistItemPrice(created.id, { ...created, manufacturerId: null }, hwFields);
        } catch { /* pricing errors never block save */ }
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

  // True when at least one door in this opening has "Yes Lite or Louver" selected
  const anyDoorNeedsLite = doorItems.some(
    (d) =>
      d.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_FIELD_KEY)?.fieldValue ===
      GLASS_OR_LOUVER_TRIGGER_VALUE
  );

  // Compute pre-fill fields for the lite modal from the first door with glass/louver
  const litePrefillFields = (() => {
    const sourceDoor = doorItems.find((d) =>
      d.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_FIELD_KEY)?.fieldValue ===
        GLASS_OR_LOUVER_TRIGGER_VALUE
    );
    if (!sourceDoor) return undefined;
    const w = sourceDoor.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_WIDTH_KEY)?.fieldValue ?? '';
    const h = sourceDoor.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_HEIGHT_KEY)?.fieldValue ?? '';
    return [
      { fieldKey: 'width', fieldLabel: 'Width', value: w, locked: true },
      { fieldKey: 'height', fieldLabel: 'Height', value: h, locked: true },
    ];
  })();
  // Frame dimension validation
  const firstDoor = doorItems[0] ?? null;
  const firstFrame = frameItems[0] ?? null;
  const isPairOpening = doorItems.length >= 2;
  const doorWidthIn = parseDimensionToInches(
    firstDoor?.fields.find((f) => f.fieldKey === 'opening_width')?.fieldValue
  );
  const doorHeightIn = parseDimensionToInches(
    firstDoor?.fields.find((f) => f.fieldKey === 'opening_height')?.fieldValue
  );
  const frameWidthIn = parseDimensionToInches(
    firstFrame?.fields.find((f) => f.fieldKey === 'opening_width')?.fieldValue
  );
  const frameHeightIn = parseDimensionToInches(
    firstFrame?.fields.find((f) => f.fieldKey === 'opening_height')?.fieldValue
  );
  const doorWidthTotal = doorWidthIn != null ? (isPairOpening ? doorWidthIn * 2 : doorWidthIn) : null;
  const frameWidthTooSmall =
    frameWidthIn != null && doorWidthTotal != null && frameWidthIn < doorWidthTotal;
  const frameHeightTooShort =
    frameHeightIn != null && doorHeightIn != null && frameHeightIn < doorHeightIn;

  // Missing required fields across doors + frames + panels + lites
  const allTopLevelItems = [...doorItems, ...frameItems, ...panelItems, ...liteItems];
  const missingRequiredFields = allTopLevelItems.some((item) =>
    item.fields.some((f) => f.isRequired && !f.fieldValue.trim())
  );

  // When any door needs a lite, at least one lite must be present
  const liteRequired = anyDoorNeedsLite && liteItems.length === 0;

  const hasBlockingViolations = liveViolations.some((v) => v.severity === 'error');

  const canSave =
    name.trim().length > 0 &&
    !frameWidthTooSmall &&
    !frameHeightTooShort &&
    !missingRequiredFields &&
    !liteRequired &&
    !hasBlockingViolations;

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

            {/* ── Lites / Louvers / Glass — appears right after Doors when glass trigger is active ── */}
            {anyDoorNeedsLite && (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-900/10 p-3">
                <div className="flex items-center gap-2">
                  <GlassWater className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    Lites / Louvers / Glass
                  </span>
                  {liteItems.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {liteItems.length}
                    </Badge>
                  )}
                  <span className={cn(
                    'text-xs ml-auto',
                    liteRequired
                      ? 'text-destructive font-medium'
                      : 'text-amber-600/80 dark:text-amber-400/80',
                  )}>
                    {liteRequired ? 'Required — add a lite to save' : 'Required — door has "Yes Lite or Louver"'}
                  </span>
                </div>

                {liteItems.map((item) => (
                  <ItemCard
                    key={item.localId}
                    item={item}
                    addFieldFormOpenForId={addFieldFormOpenForId}
                    onDelete={(lid) => handleDeleteItem('lites_louvers_glass', lid)}
                    onUpdateField={handleUpdateLiteField}
                    onDeleteField={handleDeleteLiteField}
                    onAddField={handleAddLiteField}
                    onToggleAddFieldForm={setAddFieldFormOpenForId}
                  />
                ))}

                <Button
                  variant="outline"
                  className="w-full border-dashed border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-900 dark:border-amber-700/50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                  onClick={() => setLiteModalOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Select Lite / Louver / Glass Item
                </Button>
              </div>
            )}

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

              {/* Frame dimension warnings */}
              {frameWidthTooSmall && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Frame width ({frameWidthIn}&quot;) is narrower than the door{isPairOpening ? 's' : ''} ({doorWidthTotal}&quot; total). Please adjust.
                </div>
              )}
              {frameHeightTooShort && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Frame height ({frameHeightIn}&quot;) is too short for the door height ({doorHeightIn}&quot;). Please adjust.
                </div>
              )}

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
                      onUpdateQuantity={handleUpdateHwQuantity}
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
          sourceDoor={doorItems[0] ?? null}
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
          category="lites_louvers_glass"
          title="Select Lite / Louver / Glass"
          itemTypes={itemTypes}
          itemTypesLoading={itemTypesLoading}
          open={liteModalOpen}
          onOpenChange={setLiteModalOpen}
          onSaveTopLevel={handleSelectLite}
          onSaveHardware={() => {}}
          preFillFields={litePrefillFields}
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

        {/* Live compatibility violations */}
        {liveViolations.length > 0 && (
          <div className="space-y-1">
            {liveViolations.filter((v) => v.severity === 'error').map((v, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span><strong>{v.itemLabel}:</strong> {v.message}</span>
              </div>
            ))}
            {liveViolations.filter((v) => v.severity === 'warning').map((v, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span><strong>{v.itemLabel}:</strong> {v.message}</span>
              </div>
            ))}
          </div>
        )}

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
