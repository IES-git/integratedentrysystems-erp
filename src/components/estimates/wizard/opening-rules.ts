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

/** Door height threshold (in inches) above which 4 hinges are required. 7'4" = 88". */
export const HINGE_HEIGHT_THRESHOLD_IN = 88;

/**
 * Calculates the recommended number of hinges based on door height and pair status.
 *
 * Rules:
 *   - Height > 88" (7'4"): 4 hinges per door
 *   - Height ≤ 88"       : 3 hinges per door
 *   - Pair opening multiplies by 2
 */
export function calcHingeQty(heightIn: number | null, isPair: boolean): number {
  const perDoor = heightIn != null && heightIn > HINGE_HEIGHT_THRESHOLD_IN ? 4 : 3;
  return isPair ? perDoor * 2 : perDoor;
}
