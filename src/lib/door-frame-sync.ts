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
 * Returns an updated copy of `frames` where every frame that has a field
 * matching `fieldKey` has that field's value replaced with `value`.
 * Frames without the field are returned unchanged.
 */
export function syncDoorFieldToFrames<T extends SyncableItem>(
  frames: T[],
  fieldKey: string,
  value: string
): T[] {
  return frames.map((frame) => {
    const hasField = frame.fields.some((f) => f.fieldKey === fieldKey);
    if (!hasField) return frame;
    return {
      ...frame,
      fields: frame.fields.map((f) =>
        f.fieldKey === fieldKey ? { ...f, fieldValue: value } : f
      ),
    };
  });
}

/**
 * Applies pass-to-frame field values from a source door item to a single
 * frame item. Only fields that already exist on the frame are updated.
 */
export function applyDoorValuesToFrame<T extends SyncableItem>(
  frame: T,
  doorItem: SyncableItem,
  passToFrameKeys: Set<string>
): T {
  if (passToFrameKeys.size === 0) return frame;
  const hasAny = frame.fields.some((f) => passToFrameKeys.has(f.fieldKey));
  if (!hasAny) return frame;
  return {
    ...frame,
    fields: frame.fields.map((f) => {
      if (!passToFrameKeys.has(f.fieldKey)) return f;
      const doorField = doorItem.fields.find((df) => df.fieldKey === f.fieldKey);
      return doorField ? { ...f, fieldValue: doorField.fieldValue } : f;
    }),
  };
}
