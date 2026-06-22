import { describe, it, expect } from 'vitest';
// The price-book worker is a separate ESM service; its dimension parser is pure,
// so we test it here in the app's runner to guard ingestion accuracy.
import {
  parseSizeLabel,
  decodeCompactSizeCode,
  MAX_NOMINAL_WIDTH_IN,
  parseFrameOpeningRow,
  classifyArchetype,
} from '../../services/price-book-worker/src/normalize.js';

describe('ingestion size-label parsing', () => {
  it('parses explicit width x height feet-inches', () => {
    expect(parseSizeLabel('3-0 x 7-0')).toEqual({ width: 36, height: 84 });
    expect(parseSizeLabel("3'0\" x 7'0\"")).toEqual({ width: 36, height: 84 });
  });

  it('takes the largest listed width for multi-size rows', () => {
    expect(parseSizeLabel('2-0, 2-4, 3-0 x 6-8')).toEqual({ width: 36, height: 80 });
    expect(parseSizeLabel('3-0, 2-4, 2-8 x 6-8')).toEqual({ width: 36, height: 80 });
  });

  it('parses pipe-delimited width lists and height from extracted door grids', () => {
    expect(parseSizeLabel("2-6, 2-8, 2-10, 3-0 | 7' 0\""))
      .toEqual({ width: 36, height: 84 });
    expect(parseSizeLabel("2-6, 2-8, | 7' 2\""))
      .toEqual({ width: 32, height: 86 });
    expect(parseSizeLabel("2-10, 3-0 | 7' 10\""))
      .toEqual({ width: 36, height: 94 });
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

describe('frame complete-opening row parsing', () => {
  it('parses the F-series format (height SINGLE/PAIR OPENING widths)', () => {
    expect(parseFrameOpeningRow('7-0 SINGLE OPENING (3S) 2-6, 2-8, 2-10, 3-0 | 16 GAGE MATERIAL 6 3/4"'))
      .toEqual({ heightIn: 84, openingType: '3S' });
    expect(parseFrameOpeningRow('6-8 PAIR OPENING (3P) 4-0 | 16 GAGE MATERIAL 4 3/4"'))
      .toEqual({ heightIn: 80, openingType: '3P' });
  });

  it('parses the DW-series pipe-delimited format', () => {
    expect(parseFrameOpeningRow('6-8 | PAIR OPENING (3P) | 6-8, 7-0, 7-4, 7-8, 8-0 | 18 GAGE MATERIAL | 6 5/8"'))
      .toEqual({ heightIn: 80, openingType: '3P' });
  });

  it('uses the larger height for a combined "7-10 & 8-0" row', () => {
    expect(parseFrameOpeningRow('7-10 & 8-0 | SINGLE OPENING (3S) | 2-0, 2-4 | 14 GAGE MATERIAL | 5-1/2"'))
      .toEqual({ heightIn: 96, openingType: '3S' });
  });

  it('returns nulls for component/head/jamb rows (not complete openings)', () => {
    expect(parseFrameOpeningRow('2" Single (H) 2-6, 2-8, 2-10, 3-0 | 16 GAGE MATERIAL 6 3/4"'))
      .toEqual({ heightIn: null, openingType: null });
    expect(parseFrameOpeningRow('Strike (SJ) 6-8 | 16 GAGE MATERIAL 6 3/4"'))
      .toEqual({ heightIn: null, openingType: null });
  });
});

describe('frame table archetype classification', () => {
  const grid = { cells: [{}], rowLabels: ['7-0 SINGLE OPENING (3S) 3-0'], columnLabels: ['16 GAGE 6 3/4"', 'x', 'y'] };
  it('keeps complete frame unit tables as a base matrix', () => {
    expect(classifyArchetype({ title: 'F Series - Complete 3 Sided Frame Units', detectedCategory: 'frames' }, grid)).toBe('base_matrix');
  });
  it('demotes component/heads-&-jambs, mullion, sill and stick-jamb tables off the base matrix', () => {
    for (const title of [
      'F Series - Component Parts / Heads & Jambs',
      'DW Series - Component Parts / Headers & Jambs',
      'Stick Material 16 Gage - Intermediate Mullions',
      'Stick Material 16 Gage - Sill Components',
      'Stick Material 14 Gage - Stick Jambs',
    ]) {
      expect(classifyArchetype({ title, detectedCategory: 'frames' }, grid)).not.toBe('base_matrix');
    }
  });
});
