import { describe, it, expect } from 'vitest';
// Pure compile-time vocabulary normalizer from the price-book worker.
import { adderSemanticConditions, aliasConds } from '../../services/price-book-worker/src/compile.js';
import {
  fieldPaths,
  inferCanonicalSelectors,
  interpretGridCell,
  normalizeToken,
  parsePageHint,
} from '../../services/price-book-worker/src/normalize.js';
import { parsePageRange } from '../../services/price-book-worker/src/pdf.js';
import { buildGridPrompt } from '../../services/price-book-worker/src/gemini.js';

type Alias = { canonical: string | null; targetOperator: string; status: 'alias' | 'reject' };
function vocab(entries: Array<[string, string, Alias]>): Map<string, Alias> {
  const m = new Map<string, Alias>();
  for (const [fieldPath, raw, a] of entries) m.set(`${fieldPath}\u0000${raw.trim().toLowerCase()}`, a);
  return m;
}

describe('ingestion vocabulary normalization (aliasConds)', () => {
  const aliases = vocab([
    ['door.door_series_construction', 'FEMA 361', { canonical: 'FEMA', targetOperator: 'EQ', status: 'alias' }],
    ['frame.frame_series', 'F/DW', { canonical: 'F|DW', targetOperator: 'IN', status: 'alias' }],
    ['door.door_gauge', 'H or CH 18', { canonical: null, targetOperator: 'EQ', status: 'reject' }],
    ['door.door_material', 'Galvannealed', { canonical: 'galvannealed', targetOperator: 'EQ', status: 'alias' }],
  ]);

  it('rewrites a label alias to its canonical token', () => {
    const res = aliasConds([{ fieldPath: 'door.door_series_construction', operator: 'EQ', value1: 'FEMA 361' }], aliases);
    expect(res.rejected).toBe(false);
    expect(res.conds[0].value1).toBe('FEMA');
    expect(res.conds[0].normalizedValue).toBe('fema');
  });

  it('converts a multi-value alias to an IN list', () => {
    const res = aliasConds([{ fieldPath: 'frame.frame_series', operator: 'EQ', value1: 'F/DW' }], aliases);
    expect(res.conds[0].operator).toBe('IN');
    expect(res.conds[0].value1).toBe('F|DW');
  });

  it('case-normalizes a material token', () => {
    const res = aliasConds([{ fieldPath: 'door.door_material', operator: 'EQ', value1: 'Galvannealed' }], aliases);
    expect(res.conds[0].value1).toBe('galvannealed');
  });

  it('rejects the whole rule when any condition is a reject value', () => {
    const res = aliasConds([
      { fieldPath: 'door.door_series_construction', operator: 'EQ', value1: 'FEMA 361' },
      { fieldPath: 'door.door_gauge', operator: 'EQ', value1: 'H or CH 18' },
    ], aliases);
    expect(res.rejected).toBe(true);
    expect(res.conds).toHaveLength(0);
  });

  it('passes through unknown values and dimension conditions untouched', () => {
    const input = [
      { fieldPath: 'door.door_series_construction', operator: 'EQ', value1: 'CH' },
      { fieldPath: 'door.nominal_door_width', operator: 'LTE', value1: 36, valueType: 'DIMENSION' },
    ];
    const res = aliasConds(input, aliases);
    expect(res.rejected).toBe(false);
    expect(res.conds).toEqual(input);
  });

  it('is a no-op when the alias map is empty', () => {
    const input = [{ fieldPath: 'door.door_series_construction', operator: 'EQ', value1: 'FEMA 361' }];
    expect(aliasConds(input, new Map()).conds).toEqual(input);
  });
});

describe('adder semantic condition inference', () => {
  it('turns Pioneer material-type adder rows into canonical material conditions', () => {
    const conds = adderSemanticConditions(
      'door',
      fieldPaths('door'),
      { title: 'H Series - Material Type' },
      { rowLabels: ['G Galvannealed Material'] },
      0,
      'G Galvannealed Material',
      'G',
    );

    const aliases = vocab([
      ['door.door_material', 'Galvannealed', { canonical: 'galvannealed', targetOperator: 'EQ', status: 'alias' }],
    ]);
    expect(aliasConds(conds, aliases).conds).toEqual([
      expect.objectContaining({
        fieldPath: 'door.door_material',
        value1: 'galvannealed',
        normalizedValue: 'galvannealed',
      }),
    ]);
  });

  it('uses the row option value for core adders instead of the title-implied base core', () => {
    const identity = inferCanonicalSelectors('door', {
      title: 'H Series - Door Construction',
      detected_series: 'H Series',
    });
    const semantic = adderSemanticConditions(
      'door',
      fieldPaths('door'),
      { title: 'H Series - Door Construction', detected_series: 'H Series' },
      { rowLabels: ['HP Polystyrene Core'] },
      0,
      'HP Polystyrene Core',
      'HP',
    );

    expect(identity).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: 'door.core_type', value1: 'Honeycomb' }),
    ]));
    expect(semantic).toEqual([
      expect.objectContaining({ fieldPath: 'door.core_type', value1: 'polystyrene' }),
    ]);
  });
});

describe('price-book cell preservation', () => {
  it('keeps numeric prices and exact source text', () => {
    expect(interpretGridCell('$1,209')).toEqual({ rawValue: '$1,209', price: 1209 });
    expect(interpretGridCell(733)).toEqual({ rawValue: '733', price: 733 });
  });

  it('keeps semantic price-book tokens without inventing zero', () => {
    for (const raw of ['N/C', 'N/A', 'CF', 'Included']) {
      const cell = interpretGridCell(raw);
      expect(cell).toEqual({ rawValue: raw, price: null });
      expect(normalizeToken(cell?.rawValue)?.kind).toBe('status');
    }
  });

  it('does not reinterpret labels or percentages as money', () => {
    expect(interpretGridCell('Size 36')).toEqual({ rawValue: 'Size 36', price: null });
    expect(interpretGridCell('Add 25%')).toEqual({ rawValue: 'Add 25%', price: null });
    expect(interpretGridCell('')).toBeNull();
  });
});

describe('manufacturer-neutral extraction normalization', () => {
  it('parses printed PDF page hints without treating spreadsheet rows as pages', () => {
    expect(parsePageHint('p. 12')).toBe(12);
    expect(parsePageHint('pp. 44-45')).toBe(44);
    expect(parsePageHint('pages 7–8')).toBe(7);
    expect(parsePageHint("Sheet 'Doors', row 3")).toBeNull();
    expect(parsePageRange('pp. 44-46')).toEqual({ start: 44, end: 46 });
    expect(parsePageRange('PDF pp. 59-61 (printed S-1 to S-3)')).toEqual({ start: 59, end: 61 });
    expect(parsePageRange("Sheet 'Doors', row 3")).toBeNull();
  });

  it('explains source-vs-local numbering when extracting a cropped PDF window', () => {
    const prompt = buildGridPrompt(
      'Regent RI Series',
      'doors',
      'RI',
      'size_grid',
      'PDF p. 15',
      '',
      null,
      [],
      { start: 13, end: 17 },
    );
    expect(prompt).toContain('SOURCE physical pages 13-17');
    expect(prompt).toContain('local viewer numbering restarts at 1');
  });

  it('normalizes door descriptions into canonical construction selectors', () => {
    expect(inferCanonicalSelectors('door', {
      title: 'Legion Polystyrene Foam Core — Lock Seam Edge',
      detected_series: 'LP',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: 'door.core_type', value1: 'polystyrene' }),
      expect.objectContaining({ fieldPath: 'door.edge_seam_construction', value1: 'Lockseam' }),
    ]));

    expect(inferCanonicalSelectors('door', {
      title: 'Continuous welded glued core doors',
      detected_series: 'CH',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: 'door.core_type', value1: 'Honeycomb' }),
      expect.objectContaining({ fieldPath: 'door.edge_seam_construction', value1: 'continuous weld' }),
    ]));

    expect(inferCanonicalSelectors('door', {
      title: 'Embossed panel doors',
      detected_series: 'EHF',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: 'door.edge_seam_construction', value1: 'embossed' }),
    ]));

    expect(inferCanonicalSelectors('door', {
      title: 'PS Series Doors',
      detected_series: 'PS',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: 'door.core_type', value1: 'polystyrene' }),
      expect.objectContaining({ fieldPath: 'door.edge_seam_construction', value1: 'Lockseam' }),
    ]));

    expect(inferCanonicalSelectors('door', {
      title: 'Medallion Doors',
      detected_series: 'MS',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: 'door.core_type', value1: 'steel stiffened' }),
      expect.objectContaining({ fieldPath: 'door.edge_seam_construction', value1: 'Lockseam' }),
    ]));
  });

  it('normalizes frame context into opening construction selectors', () => {
    expect(inferCanonicalSelectors('frame', {
      title: 'Drywall knock-down frame units',
      detected_series: 'DW',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: 'opening.wall_construction',
        operator: 'IN',
        value1: 'steel stud|wood stud|drywall',
      }),
      expect.objectContaining({ fieldPath: 'frame.assembly_welding', value1: 'KD' }),
    ]));

    expect(inferCanonicalSelectors('frame', {
      title: 'SR Series Standard Frame',
      detected_series: 'SR',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: 'opening.wall_construction', value1: 'masonry' }),
    ]));
  });
});
