/**
 * Customer-facing pricing is intentionally kept in $10 increments.
 *
 * The business rule is two-stage: round to the nearest whole dollar first,
 * then round that whole-dollar value to the nearest ten dollars.
 */
export function roundPriceToNearestTen(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('Price must be a finite number.');
  }

  const wholeDollars = Math.round(value);
  const rounded = Math.round(wholeDollars / 10) * 10;

  // Avoid returning -0, which can produce confusing currency output.
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function roundOptionalPriceToNearestTen(
  value: number | null | undefined,
): number | null {
  return value === null || value === undefined
    ? null
    : roundPriceToNearestTen(value);
}
