/**
 * Utilities for automatically creating and syncing "Lites / Louvers / Glass"
 * items in the estimate opening wizard.
 *
 * When a door item has glass_or_louver = "Yes Lite or Louver", a companion
 * lite item is auto-created in the opening. Its width and height fields are
 * locked to the values the user entered in the door's glass_or_louver_width
 * and glass_or_louver_height sub-fields.
 */

import { newLocalId } from './AddItemModal';
import type { LocalTopLevelItem, LocalField } from './AddItemModal';

// ---------------------------------------------------------------------------
// Constants — field keys and trigger value (must match field_definitions table)
// ---------------------------------------------------------------------------

export const GLASS_OR_LOUVER_FIELD_KEY = 'glass_or_louver';
export const GLASS_OR_LOUVER_TRIGGER_VALUE = 'Yes Lite or Louver';
export const GLASS_OR_LOUVER_WIDTH_KEY = 'glass_or_louver_width';
export const GLASS_OR_LOUVER_HEIGHT_KEY = 'glass_or_louver_height';

export const LITES_CANONICAL_CODE = 'lite';
export const LITES_ITEM_LABEL = 'Lites, Louvers, Glass';
export const LITES_ITEM_TYPE = 'lites_louvers_glass';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic localId for a lite item generated from a specific door. */
export function liteLocalIdForDoor(doorLocalId: string): string {
  return `lite-for-${doorLocalId}`;
}

/**
 * Returns true when the door item currently has the glass/louver trigger active.
 */
export function doorHasLite(door: LocalTopLevelItem): boolean {
  return (
    door.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_FIELD_KEY)?.fieldValue ===
    GLASS_OR_LOUVER_TRIGGER_VALUE
  );
}

/**
 * Builds a new lite LocalTopLevelItem from a door's glass/louver sub-fields.
 * Returns null if the door does not have "Yes Lite or Louver" selected.
 *
 * The returned item's width and height are locked to the door values so the
 * user cannot edit them independently.
 */
export function buildLiteItemFromDoor(door: LocalTopLevelItem): LocalTopLevelItem | null {
  if (!doorHasLite(door)) return null;

  const widthValue =
    door.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_WIDTH_KEY)?.fieldValue ?? '';
  const heightValue =
    door.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_HEIGHT_KEY)?.fieldValue ?? '';

  const fields: LocalField[] = [
    {
      localId: newLocalId(),
      fieldKey: 'width',
      fieldLabel: 'Width',
      fieldValue: widthValue,
      valueType: 'string',
      isRequired: false,
      isLocked: true,
    },
    {
      localId: newLocalId(),
      fieldKey: 'height',
      fieldLabel: 'Height',
      fieldValue: heightValue,
      valueType: 'string',
      isRequired: false,
      isLocked: true,
    },
  ];

  return {
    localId: liteLocalIdForDoor(door.localId),
    itemLabel: LITES_ITEM_LABEL,
    canonicalCode: LITES_CANONICAL_CODE,
    category: LITES_ITEM_TYPE,
    loadingFields: false,
    fields,
    manufacturerId: null, // Lites look up by canonical_code, no manufacturer needed
  };
}

/**
 * Syncs the locked width/height fields of a lite item from the door's
 * glass_or_louver_width and glass_or_louver_height values.
 */
export function syncLiteDimensionsFromDoor(
  lite: LocalTopLevelItem,
  door: LocalTopLevelItem
): LocalTopLevelItem {
  const widthValue =
    door.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_WIDTH_KEY)?.fieldValue ?? '';
  const heightValue =
    door.fields.find((f) => f.fieldKey === GLASS_OR_LOUVER_HEIGHT_KEY)?.fieldValue ?? '';

  return {
    ...lite,
    fields: lite.fields.map((f) => {
      if (f.fieldKey === 'width' && f.isLocked) return { ...f, fieldValue: widthValue };
      if (f.fieldKey === 'height' && f.isLocked) return { ...f, fieldValue: heightValue };
      return f;
    }),
  };
}
