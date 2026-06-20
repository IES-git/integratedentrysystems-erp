/**
 * Shared rule utilities for the estimate opening wizards.
 */

import { parseDoorDimension } from '@/components/pricing/dimension-utils';

/**
 * Parses a dimension string into a numeric inch value.
 *
 * Delegates to the canonical `parseDoorDimension` so builder validation and
 * the pricing lookup agree on what a value like "36" means (door-industry
 * nominal: 3 ft 6 in = 42"). See dimension-utils for the full format list.
 *
 * Returns null if the value cannot be parsed.
 */
export function parseDimensionToInches(val: string | number | null | undefined): number | null {
  return parseDoorDimension(val);
}

/**
 * Handing opposites for pair openings.
 * NH (non-handed) stays NH.
 */
const OPPOSITE_HANDING: Record<string, string> = {
  LH: 'RH',
  RH: 'LH',
  LHR: 'RHR',
  RHR: 'LHR',
  NH: 'NH',
};

/**
 * Returns the opposite handing for a pair door.
 * If the handing is not in the map, returns the original value unchanged.
 */
export function getOppositeHanding(handing: string): string {
  return OPPOSITE_HANDING[handing] ?? handing;
}

/**
 * Hinges per leaf by door height, per NFPA 80 / ANSI-BHMA A156.1:
 *   - up to 60"            : 2 hinges
 *   - over 60" up to 90"   : 3 hinges
 *   - over 90" up to 120"  : 4 hinges
 *   - over 120"            : +1 hinge for each additional 30" (or fraction)
 *
 * When the height is unknown we assume a standard commercial leaf (3 hinges),
 * which is the practical minimum for steel doors.
 */
export function hingesPerLeaf(heightIn: number | null): number {
  if (heightIn == null) return 3;
  if (heightIn <= 60) return 2;
  // 2 hinges through 60", then one more per 30" (or fraction) of height above 60".
  return 2 + Math.ceil((heightIn - 60) / 30);
}

/**
 * Total hinge count for an opening: hinges per leaf × leaves.
 * `isPair` doubles the per-leaf count for two-leaf openings.
 */
export function calcHingeQty(heightIn: number | null, isPair: boolean): number {
  const perLeaf = hingesPerLeaf(heightIn);
  return isPair ? perLeaf * 2 : perLeaf;
}
