import { describe, expect, it } from 'vitest';
import { parsePlainInches } from '@/components/pricing/dimension-utils';

describe('parsePlainInches', () => {
  it('parses fractional inch thicknesses without treating them as nominal door sizes', () => {
    expect(parsePlainInches('1-3/4')).toBe(1.75);
    expect(parsePlainInches('1 3/4')).toBe(1.75);
    expect(parsePlainInches('1/4"')).toBe(0.25);
    expect(parsePlainInches('5 3/4')).toBe(5.75);
  });

  it('keeps plain inches plain while accepting feet-hyphen shorthand', () => {
    expect(parsePlainInches('24')).toBe(24);
    expect(parsePlainInches('24.5')).toBe(24.5);
    expect(parsePlainInches('2-0')).toBe(24);
  });
});
