import { describe, expect, it } from 'vitest';
import {
  buildCustomerDisplayRows,
  createDefaultAudienceDisplayConfig,
  getBlock,
  getLineDisplayKey,
  hasHiddenDisplayLines,
  normalizeAudienceDisplayConfig,
} from '@/lib/quote-display';
import type { QuoteItem } from '@/types';

function quoteItem(overrides: Partial<QuoteItem>): QuoteItem {
  return {
    id: 'quote-item-1',
    quoteId: 'quote-1',
    estimateItemId: 'estimate-item-1',
    displayKey: 'estimate-item:estimate-item-1',
    itemLabel: 'Door and frame package',
    canonicalCode: 'HM-DOOR',
    quantity: 1,
    unitCost: 100,
    unitPrice: 150,
    lineTotal: 150,
    sortOrder: 0,
    createdAt: '2026-06-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('quote display helpers', () => {
  it('groups customer lines into quote-friendly categories by default', () => {
    const config = createDefaultAudienceDisplayConfig('customer');
    const rows = buildCustomerDisplayRows(
      [
        quoteItem({ itemLabel: '18ga steel door slab', lineTotal: 500 }),
        quoteItem({
          id: 'quote-item-2',
          estimateItemId: 'estimate-item-2',
          displayKey: 'estimate-item:estimate-item-2',
          itemLabel: 'Hinge and closer hardware set',
          canonicalCode: 'HW-SET',
          lineTotal: 250,
        }),
      ],
      config,
    );

    expect(rows.map((row) => row.label)).toEqual([
      'Doors and door preparation',
      'Hardware package',
    ]);
    expect(rows.map((row) => row.lineTotal)).toEqual([500, 250]);
  });

  it('classifies plural hardware source lines as hardware package', () => {
    const config = createDefaultAudienceDisplayConfig('customer');
    const rows = buildCustomerDisplayRows(
      [
        quoteItem({
          itemLabel: 'butt hinges (49)',
          canonicalCode: '49',
          quantity: 3,
          unitPrice: 15.93,
          lineTotal: 47.79,
        }),
        quoteItem({
          id: 'quote-item-2',
          estimateItemId: 'estimate-item-2',
          displayKey: 'estimate-item:estimate-item-2',
          itemLabel: 'cylindrical mortise locks and deadbolts',
          canonicalCode: null,
          quantity: 1,
          unitPrice: 0,
          lineTotal: 0,
        }),
      ],
      config,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Hardware package');
    expect(rows[0].sourceItemCount).toBe(2);
    expect(rows[0].lineTotal).toBe(47.79);
  });

  it('applies line labels and hidden flags without changing source items', () => {
    const config = {
      ...createDefaultAudienceDisplayConfig('customer'),
      groupCustomerLineItems: false,
      blocks: createDefaultAudienceDisplayConfig('customer').blocks.map((block) =>
        block.id === 'lineItems' ? { ...block, detailLevel: 'standard' as const } : block,
      ),
      lineOverrides: [
        {
          displayKey: 'estimate-item:estimate-item-1',
          label: 'Opening package',
        },
        {
          displayKey: 'estimate-item:estimate-item-2',
          hidden: true,
        },
      ],
    };
    const items = [
      quoteItem({ lineTotal: 150 }),
      quoteItem({
        id: 'quote-item-2',
        estimateItemId: 'estimate-item-2',
        displayKey: 'estimate-item:estimate-item-2',
        itemLabel: 'Internal cost detail',
        lineTotal: 50,
      }),
    ];

    const rows = buildCustomerDisplayRows(items, config);

    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Opening package');
    expect(hasHiddenDisplayLines(items, config)).toBe(true);
    expect(items.reduce((sum, item) => sum + item.lineTotal, 0)).toBe(200);
  });

  it('normalizes partial template configs with required blocks', () => {
    const config = normalizeAudienceDisplayConfig(
      {
        blocks: [{ id: 'totals', title: 'Investment', enabled: true, sortOrder: 1, detailLevel: 'summary' }],
      },
      'customer',
    );

    expect(getBlock(config, 'totals').title).toBe('Investment');
    expect(getBlock(config, 'lineItems').enabled).toBe(true);
    expect(getBlock(config, 'custom').enabled).toBe(false);
  });

  it('falls back to stable display keys', () => {
    expect(
      getLineDisplayKey(
        quoteItem({
          displayKey: null,
          estimateItemId: 'abc',
        }),
      ),
    ).toBe('estimate-item:abc');
  });
});
