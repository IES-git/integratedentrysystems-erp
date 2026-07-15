import { describe, expect, it } from 'vitest';
import {
  formatArchitecturalSize,
  formatCompactNominalDimension,
  normalizeArchitecturalDimension,
  normalizeCompactNominalDimension,
  parseDoorDimension,
  parsePlainInches,
} from '@/components/pricing/dimension-utils';

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

describe('compact nominal dimensions', () => {
  it('formats nominal inches as compact width/height codes', () => {
    expect(formatCompactNominalDimension(36)).toBe('30');
    expect(formatCompactNominalDimension(84)).toBe('70');
    expect(formatCompactNominalDimension(42)).toBe('36');
    expect(formatCompactNominalDimension(34)).toBe('210');
  });

  it('normalizes 3070 and legacy feet-hyphen values to compact segments', () => {
    expect(normalizeCompactNominalDimension('30')).toBe('30');
    expect(normalizeCompactNominalDimension('70')).toBe('70');
    expect(normalizeCompactNominalDimension('3-0')).toBe('30');
    expect(normalizeCompactNominalDimension('7-0')).toBe('70');
  });

  it('parses compact nominal dimensions as door sizes', () => {
    expect(parseDoorDimension('30')).toBe(36);
    expect(parseDoorDimension('70')).toBe(84);
    expect(parseDoorDimension('3-0')).toBe(36);
    expect(parseDoorDimension('7-0')).toBe(84);
  });

  it('renders compact nominal dimensions in architectural display notation', () => {
    expect(normalizeArchitecturalDimension('30')).toBe('3-0');
    expect(normalizeArchitecturalDimension('70')).toBe('7-0');
    expect(normalizeArchitecturalDimension('210')).toBe('2-10');
    expect(formatArchitecturalSize('30', '70')).toBe('3-0 x 7-0');
  });
});
