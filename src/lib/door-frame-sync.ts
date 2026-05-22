/**
 * Helpers for syncing door field values to matching frame fields
 * in the estimate opening wizards.
 */

interface SyncableField {
  fieldKey: string;
  fieldValue: string;
}

interface SyncableItem {
  fields: SyncableField[];
}

/**
 * Maps door field_keys to their corresponding frame field_keys when the two sides
 * use different names for the same logical field.
 *
 * Why this exists: the door catalog and frame catalog were built with slightly
 * different field_key values for some shared fields. For example, the door uses
 * "label" for Fire Label while the frame uses "fire_label", and the door uses
 * "handing" while the frame uses "hand". Without this map the sync code would do
 * a direct key comparison and silently skip those fields.
 */
export const DOOR_TO_FRAME_KEY_ALIASES: Record<string, string> = {
  label: 'fire_label',
  handing: 'hand',
};

/**
 * Given a door field_key, returns the field_key that should be matched on the
 * frame side. Falls back to the original key when no alias is defined.
 */
export function resolveFrameFieldKey(doorFieldKey: string): string {
  return DOOR_TO_FRAME_KEY_ALIASES[doorFieldKey] ?? doorFieldKey;
}

/**
 * Returns an updated copy of `frames` where every frame that has a field
 * matching the (possibly aliased) frame key has that field's value replaced
 * with `value`. Frames without the field are returned unchanged.
 */
export function syncDoorFieldToFrames<T extends SyncableItem>(
  frames: T[],
  doorFieldKey: string,
  value: string
): T[] {
  const frameFieldKey = resolveFrameFieldKey(doorFieldKey);
  return frames.map((frame) => {
    const hasField = frame.fields.some((f) => f.fieldKey === frameFieldKey);
    if (!hasField) return frame;
    return {
      ...frame,
      fields: frame.fields.map((f) =>
        f.fieldKey === frameFieldKey ? { ...f, fieldValue: value } : f
      ),
    };
  });
}

/**
 * Applies pass-to-frame field values from a source door item to a single
 * frame item. Only fields that already exist on the frame are updated.
 * Handles cases where the door and frame use different field_key values for
 * the same logical field via DOOR_TO_FRAME_KEY_ALIASES.
 */
export function applyDoorValuesToFrame<T extends SyncableItem>(
  frame: T,
  doorItem: SyncableItem,
  passToFrameKeys: Set<string>
): T {
  if (passToFrameKeys.size === 0) return frame;

  // Build a map of frameFieldKey → doorFieldKey for every key in passToFrameKeys,
  // resolving aliases so we can match against actual frame field keys.
  const frameKeyToDoorKey = new Map<string, string>();
  for (const doorKey of passToFrameKeys) {
    frameKeyToDoorKey.set(resolveFrameFieldKey(doorKey), doorKey);
  }

  const hasAny = frame.fields.some((f) => frameKeyToDoorKey.has(f.fieldKey));
  if (!hasAny) return frame;

  return {
    ...frame,
    fields: frame.fields.map((f) => {
      const doorKey = frameKeyToDoorKey.get(f.fieldKey);
      if (doorKey === undefined) return f;
      const doorField = doorItem.fields.find((df) => df.fieldKey === doorKey);
      return doorField ? { ...f, fieldValue: doorField.fieldValue } : f;
    }),
  };
}
