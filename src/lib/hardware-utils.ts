import type { HardwareSubcategory } from '@/types';

export const HARDWARE_SUBCATEGORY_ORDER: HardwareSubcategory[] = [
  'swing_it',
  'close_it',
  'latch_it',
  'protect_it',
];

export const HARDWARE_SUBCATEGORY_LABEL: Record<HardwareSubcategory, string> = {
  swing_it: 'Swing It',
  close_it: 'Close It',
  latch_it: 'Latch It',
  protect_it: 'Protect It',
};

export interface HardwareGroup<T> {
  key: HardwareSubcategory | 'other';
  label: string;
  items: T[];
}

/**
 * Groups hardware items by subcategory in canonical display order.
 * Items without a subcategory (null / undefined) land in the "Other Hardware" bucket.
 */
export function groupHardwareBySubcategory<
  T extends { subcategory?: HardwareSubcategory | null },
>(items: T[]): HardwareGroup<T>[] {
  const buckets = new Map<HardwareSubcategory | 'other', T[]>();

  for (const item of items) {
    const key: HardwareSubcategory | 'other' = item.subcategory ?? 'other';
    const existing = buckets.get(key) ?? [];
    existing.push(item);
    buckets.set(key, existing);
  }

  const result: HardwareGroup<T>[] = [];

  for (const sub of HARDWARE_SUBCATEGORY_ORDER) {
    const group = buckets.get(sub);
    if (group?.length) {
      result.push({ key: sub, label: HARDWARE_SUBCATEGORY_LABEL[sub], items: group });
    }
  }

  const other = buckets.get('other');
  if (other?.length) {
    result.push({ key: 'other', label: 'Other Hardware', items: other });
  }

  return result;
}
