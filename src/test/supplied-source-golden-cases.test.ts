import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface GoldenCase {
  id: string;
  manufacturer: string;
  physicalPage: number;
  expected: {
    baseAmount: number;
    adders: { amount: number }[];
    listTotal: number;
  };
}

const fixturePath = path.resolve(process.cwd(), 'docs/supplied-source-golden-cases.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
  normalizedSpec: Record<string, unknown>;
  cases: GoldenCase[];
};

describe('supplied-source connected golden cases', () => {
  it('covers the same normalized door spec across all three steel manufacturers', () => {
    expect(fixture.normalizedSpec).toMatchObject({
      entityType: 'door',
      widthIn: 36,
      heightIn: 84,
      gauge: 18,
      coreType: 'Honeycomb',
      edgeSeamConstruction: 'Lockseam',
      material: 'Galvannealed',
    });
    expect(new Set(fixture.cases.map((item) => item.manufacturer))).toEqual(new Set([
      'Pioneer Industries',
      'CECO Door',
      'De La Fontaine',
    ]));
  });

  it('keeps each reviewed source total arithmetically auditable', () => {
    for (const item of fixture.cases) {
      expect(item.physicalPage).toBeGreaterThan(0);
      expect(item.expected.baseAmount + item.expected.adders.reduce((sum, adder) => sum + adder.amount, 0))
        .toBe(item.expected.listTotal);
    }
  });
});
