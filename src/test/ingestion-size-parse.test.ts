import { describe, it, expect } from 'vitest';
// The price-book worker is a separate ESM service; its dimension parser is pure,
// so we test it here in the app's runner to guard ingestion accuracy.
import {
  parseSizeLabel,
  decodeCompactSizeCode,
  MAX_NOMINAL_WIDTH_IN,
} from '../../services/price-book-worker/src/normalize.js';

describe('ingestion size-label parsing', () => {
  it('parses explicit width x height feet-inches', () => {
    expect(parseSizeLabel('3-0 x 7-0')).toEqual({ width: 36, height: 84 });
    expect(parseSizeLabel("3'0\" x 7'0\"")).toEqual({ width: 36, height: 84 });
  });

  it('takes the largest listed width for multi-size rows', () => {
    expect(parseSizeLabel('2-0, 2-4, 3-0 x 6-8')).toEqual({ width: 36, height: 80 });
  });

  it('decodes compact concatenated size codes (the 2070 bug)', () => {
    expect(parseSizeLabel('2070')).toEqual({ width: 24, height: 84 }); // 2-0 x 7-0
    expect(parseSizeLabel('3080')).toEqual({ width: 36, height: 96 }); // 3-0 x 8-0
    expect(parseSizeLabel('2868')).toEqual({ width: 32, height: 80 }); // 2-8 x 6-8
    expect(decodeCompactSizeCode('2070')).toEqual({ width: 24, height: 84 });
  });

  it('parses a single feet-inches width', () => {
    expect(parseSizeLabel('3-0')).toEqual({ width: 36, height: null });
  });

  it('rejects implausible / mis-parsed codes instead of inventing a bound', () => {
    // 3-digit frame shortcut "240" (2" face + 4-0) — not a real 240in opening.
    expect(parseSizeLabel('240')).toEqual({ width: null, height: null });
    // bare 4-digit that is not a valid WWHH stays unparseable via clamp paths.
    expect(parseSizeLabel('Price')).toEqual({ width: null, height: null });
    expect(parseSizeLabel('')).toEqual({ width: null, height: null });
    // a feet-inches value beyond the plausible max is clamped to null.
    expect(parseSizeLabel('20-0')).toEqual({ width: null, height: null });
    expect(MAX_NOMINAL_WIDTH_IN).toBe(120);
  });

  it('decodeCompactSizeCode only accepts 4-digit codes', () => {
    expect(decodeCompactSizeCode('207')).toBeNull();
    expect(decodeCompactSizeCode('20700')).toBeNull();
    expect(decodeCompactSizeCode('abcd')).toBeNull();
  });
});
