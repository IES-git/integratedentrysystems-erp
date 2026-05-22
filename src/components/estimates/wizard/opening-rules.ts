/**
 * Shared rule utilities for the estimate opening wizards.
 * Used by both TemplateOpeningDialog and BuildOpeningDialog.
 */

/**
 * Parses a dimension string into a numeric inch value.
 *
 * Handles formats:
 *   - Feet-inch notation:  "3'-0\"", "6'-8\"", "7'-4\""
 *   - Plain inches (string or number): "80", "96"
 *   - Decimal inches: "80.5"
 *
 * Returns null if the value cannot be parsed.
 */
export function parseDimensionToInches(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined || val === '') return null;
  const str = String(val).trim();
  if (!str) return null;

  // Feet-inch notation: X'-Y" or X'Y" (with optional quote chars)
  const feetInchMatch = str.match(/^(\d+)'\s*-?\s*(\d+(?:\.\d+)?)["\s]?$/);
  if (feetInchMatch) {
    const feet = parseFloat(feetInchMatch[1]);
    const inches = parseFloat(feetInchMatch[2]);
    return feet * 12 + inches;
  }

  // Plain numeric or decimal string
  const plain = parseFloat(str);
  if (!isNaN(plain)) return plain;

  return null;
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
