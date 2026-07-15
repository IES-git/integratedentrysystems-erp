import { describe, expect, it } from 'vitest';
import {
  roundOptionalPriceToNearestTen,
  roundPriceToNearestTen,
} from '@/lib/pricing-rounding';

describe('customer-facing price rounding', () => {
  it('rounds to a whole dollar and then to the nearest ten dollars', () => {
    expect(roundPriceToNearestTen(867.93)).toBe(870);
    expect(roundPriceToNearestTen(862.12)).toBe(860);
    expect(roundPriceToNearestTen(870)).toBe(870);
  });

  it('honors the whole-dollar step at the five-dollar boundary', () => {
    expect(roundPriceToNearestTen(864.49)).toBe(860);
    expect(roundPriceToNearestTen(864.5)).toBe(870);
    expect(roundPriceToNearestTen(874.49)).toBe(870);
    expect(roundPriceToNearestTen(874.5)).toBe(880);
  });

  it('preserves optional missing prices', () => {
    expect(roundOptionalPriceToNearestTen(null)).toBeNull();
    expect(roundOptionalPriceToNearestTen(undefined)).toBeNull();
    expect(roundOptionalPriceToNearestTen(867.93)).toBe(870);
  });

  it('rejects non-finite prices', () => {
    expect(() => roundPriceToNearestTen(Number.NaN)).toThrow(RangeError);
    expect(() => roundPriceToNearestTen(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
