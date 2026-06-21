import { describe, it, expect } from 'vitest';
// Pure compile-time vocabulary normalizer from the price-book worker.
import { aliasConds } from '../../services/price-book-worker/src/compile.js';

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
