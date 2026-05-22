import type { HardwareSubcategory } from '@/types';

export const HARDWARE_SUBCATEGORY_ORDER: HardwareSubcategory[] = [
  'swing_it',
  'close_it',
  'latch_it',
  'protect_it',
  'mount_it',
];

export const HARDWARE_SUBCATEGORY_LABEL: Record<HardwareSubcategory, string> = {
  swing_it: 'Swing It',
  close_it: 'Close It',
  latch_it: 'Latch It',
  protect_it: 'Protect It',
  mount_it: 'Mount It',
};

export interface HardwareGroup<T> {
  key: HardwareSubcategory;
  label: string;
  items: T[];
}

/**
 * Groups hardware items by subcategory in canonical display order.
 * Items without a subcategory (null / undefined) are excluded from the output.
 */
export function groupHardwareBySubcategory<
  T extends { subcategory?: HardwareSubcategory | null },
>(items: T[]): HardwareGroup<T>[] {
  const buckets = new Map<HardwareSubcategory, T[]>();

  for (const item of items) {
    if (!item.subcategory) continue;
    const existing = buckets.get(item.subcategory) ?? [];
    existing.push(item);
    buckets.set(item.subcategory, existing);
  }

  const result: HardwareGroup<T>[] = [];

  for (const sub of HARDWARE_SUBCATEGORY_ORDER) {
    const group = buckets.get(sub);
    if (group?.length) {
      result.push({ key: sub, label: HARDWARE_SUBCATEGORY_LABEL[sub], items: group });
    }
  }

  return result;
}
