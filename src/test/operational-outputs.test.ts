import { describe, expect, it } from 'vitest';
import {
  buildKittingRows,
  buildOperationalOutputRows,
  groupOperationalRowsByManufacturer,
  isManufacturerProcurementRow,
  operationalOutputFilename,
  operationalRowsToCsv,
} from '@/lib/operational-outputs';
import type { QuoteContextSnapshot, QuoteLineSnapshot } from '@/types';

const context: QuoteContextSnapshot = {
  version: 1,
  capturedAt: '2026-07-10T00:00:00Z',
  job: { jobName: 'Courthouse', jobNumber: 'IES-42' },
  company: null,
  contact: null,
  openingNames: { o1: '101' },
};

function snapshot(partial: Partial<QuoteLineSnapshot> = {}): QuoteLineSnapshot {
  return {
    id: 's1', quoteId: 'q1', quoteItemId: null, estimateId: 'e1', estimateLineId: 'l1',
    estimateItemId: null, openingId: 'o1', openingName: '101', componentId: null,
    sourceTable: 'estimate_line', sourceLineType: 'HARDWARE', entityType: 'hardware',
    chargeCategory: 'locks', description: 'Mortise lock', selectedOptionCode: 'L9070',
    manufacturerId: null, manufacturerName: 'Schlage', partNumber: 'L9070-626', quantity: 2,
    unitOfMeasure: 'EA', unitListPrice: 500, extendedListPrice: 1000, discountMultiplier: 0.4,
    extendedNetPrice: 400, sellPrice: 300, manualSellPrice: null, unitSellPrice: 300,
    lineTotal: 600, priceStatus: 'PRICED', reviewStatus: 'APPROVED', sortOrder: 0,
    snapshotJson: {
      grossMargin: 200,
      grossMarginPct: 33.33,
      openingOrderData: { frameOrderCallout: '101 | SINGLE | DOD 3070' },
    },
    createdAt: '',
    ...partial,
  };
}

describe('operational quote outputs', () => {
  it('builds purchasing-ready rows from immutable quote snapshots', () => {
    const [row] = buildOperationalOutputRows([snapshot()], context);
    expect(row.partNumber).toBe('L9070-626');
    expect(row.unitNet).toBe(200);
    expect(row.suggestedPo).toBe('IES-42_SCHLAGE');
    expect(row.frameOrderCallout).toContain('DOD 3070');
  });

  it('keeps only hardware-related rows in the kitting view', () => {
    const rows = buildOperationalOutputRows([
      snapshot(),
      snapshot({ id: 's2', entityType: 'door', chargeCategory: 'base', description: 'Door' }),
    ], context);
    expect(buildKittingRows(rows)).toHaveLength(1);
  });

  it('renders escaped CSV using vendor working presets', () => {
    const rows = buildOperationalOutputRows([snapshot({ description: 'Lock, mortise' })], context);
    const csv = operationalRowsToCsv(rows, 'pioneer');
    expect(csv).toContain('Order Callout');
    expect(csv).toContain('"Lock, mortise"');
    expect(operationalOutputFilename('vendor', context, 'de_la_fontaine')).toBe('IES-42-vendor-de-la-fontaine.csv');
  });

  it('keeps cutout, ordered kit, visible glass, and glass type distinct', () => {
    const [row] = buildOperationalOutputRows([snapshot({
      entityType: 'lite_kit',
      chargeCategory: 'lite_kit',
      snapshotJson: {
        matchedConditions: {
          'infill.cutout_width_in': 10,
          'infill.cutout_height_in': 20,
          'infill.order_width_in': 12,
          'infill.order_height_in': 22,
          'infill.visible_width_in': 8,
          'infill.visible_height_in': 18,
          'infill.glass_type': 'FireLite NT',
        },
      },
    })], context);
    expect(row.cutoutSize).toBe('10" x 20"');
    expect(row.kitOrderSize).toBe('12" x 22"');
    expect(row.visibleGlassSize).toBe('8" x 18"');
    expect(row.glassType).toBe('FireLite NT');
    expect(operationalRowsToCsv([row], 'internal')).toContain('Kit Ordered Size');
  });

  it('splits manufacturer output and preserves technical specifications', () => {
    const rows = buildOperationalOutputRows([
      snapshot({ manufacturerId: 'schlage', manufacturerName: 'Schlage', snapshotJson: { fields: [{ key: 'finish', label: 'Finish', value: '626' }] } }),
      snapshot({ id: 's2', manufacturerId: 'ceco', manufacturerName: 'CECO', description: 'Steel door' }),
    ], context);
    const groups = groupOperationalRowsByManufacturer(rows);
    expect(groups.map((group) => group.manufacturerName)).toEqual(['CECO', 'Schlage']);
    expect(groups[1].rows[0].specificationSummary).toContain('Finish: 626');
  });

  it('can retain included no-charge prep scope for manufacturer documents', () => {
    const included = snapshot({ priceStatus: 'INCLUDED', entityType: 'prep', description: 'Mortise lock prep included in base' });
    expect(buildOperationalOutputRows([included], context)).toHaveLength(0);
    expect(buildOperationalOutputRows([included], context, { includeIncluded: true })).toHaveLength(1);
  });

  it('keeps internal freight, tax, and installation charges off manufacturer RFQs', () => {
    const rows = buildOperationalOutputRows([
      snapshot(),
      snapshot({ id: 'freight', estimateLineId: 'freight', entityType: 'service', chargeCategory: 'freight', description: 'Freight' }),
      snapshot({ id: 'labor', estimateLineId: 'labor', entityType: 'service', chargeCategory: 'installation', description: 'Field install labor' }),
    ], context);
    expect(rows.filter(isManufacturerProcurementRow).map((row) => row.description)).toEqual(['Mortise lock']);
  });
});
