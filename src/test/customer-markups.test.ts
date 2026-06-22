import { describe, expect, it } from 'vitest';
import {
  categoryMarkupKey,
  getMarkupOverrideMatch,
  itemMarkupKey,
  subcategoryMarkupKey,
} from '@/lib/customer-markups';

describe('customer markup override matching', () => {
  it('matches category overrides against item_type', () => {
    const match = getMarkupOverrideMatch(
      { [categoryMarkupKey('door')]: 1.35 },
      { itemLabel: 'Door', canonicalCode: 'D-1', itemType: 'doors' },
    );

    expect(match).toEqual({
      key: 'category:door',
      value: 1.35,
      type: 'category',
    });
  });

  it('keeps legacy plural category override keys working', () => {
    const match = getMarkupOverrideMatch(
      { [categoryMarkupKey('doors')]: 1.35 },
      { itemLabel: 'Door', canonicalCode: 'D-1', itemType: 'door' },
    );

    expect(match?.key).toBe('category:doors');
    expect(match?.value).toBe(1.35);
  });

  it('matches engine charge categories as subcategory overrides', () => {
    const match = getMarkupOverrideMatch(
      { [subcategoryMarkupKey('hardware', 'butt_hinges')]: 1.55 },
      {
        itemLabel: 'Butt hinges',
        canonicalCode: 'BB1279',
        itemType: 'hardware',
        chargeCategory: 'butt_hinges',
      },
    );

    expect(match?.key).toBe('subcategory:hardware:butt_hinges');
    expect(match?.value).toBe(1.55);
  });

  it('matches NGP category overrides from engine entity types', () => {
    const match = getMarkupOverrideMatch(
      { [categoryMarkupKey('lite_kit')]: 1.42 },
      { itemLabel: 'Lite kit base', canonicalCode: 'L-FRA100', itemType: 'lite_kit' },
    );

    expect(match?.key).toBe('category:lite_kit');
    expect(match?.value).toBe(1.42);
  });

  it('matches hardware subcategory overrides before hardware category overrides', () => {
    const match = getMarkupOverrideMatch(
      {
        [categoryMarkupKey('hardware')]: 1.2,
        [subcategoryMarkupKey('hardware', 'swing_it')]: 1.5,
      },
      {
        itemLabel: 'Hinge',
        canonicalCode: 'HINGE-1',
        itemType: 'hardware-hinge',
        subcategory: 'swing_it',
      },
    );

    expect(match?.key).toBe('subcategory:hardware:swing_it');
    expect(match?.value).toBe(1.5);
  });

  it('matches item overrides before subcategory and category overrides', () => {
    const match = getMarkupOverrideMatch(
      {
        [categoryMarkupKey('hardware')]: 1.2,
        [subcategoryMarkupKey('hardware', 'swing_it')]: 1.4,
        [itemMarkupKey('HINGE-1')]: 1.8,
      },
      {
        itemLabel: 'Hinge',
        canonicalCode: 'HINGE-1',
        itemType: 'hardware',
        subcategory: 'swing_it',
      },
    );

    expect(match?.key).toBe('item:HINGE-1');
    expect(match?.value).toBe(1.8);
  });

  it('keeps legacy exact label and code matches working', () => {
    const byCode = getMarkupOverrideMatch(
      { 'HINGE-1': 1.6 },
      { itemLabel: 'Hinge', canonicalCode: 'HINGE-1', itemType: 'hardware' },
    );
    const byLabel = getMarkupOverrideMatch(
      { hinge: 1.7 },
      { itemLabel: 'Hinge', canonicalCode: 'HINGE-2', itemType: 'hardware' },
    );

    expect(byCode?.value).toBe(1.6);
    expect(byCode?.type).toBe('legacy');
    expect(byLabel?.value).toBe(1.7);
    expect(byLabel?.type).toBe('legacy');
  });

  it('falls back to legacy labels for rows without item_type', () => {
    const doorMatch = getMarkupOverrideMatch(
      { [categoryMarkupKey('doors')]: 1.25 },
      { itemLabel: 'Steel Door', canonicalCode: 'D-LEGACY' },
    );
    const hardwareMatch = getMarkupOverrideMatch(
      { [categoryMarkupKey('hardware')]: 1.45 },
      { itemLabel: 'Door Closer', canonicalCode: 'CLOSER-LEGACY' },
    );

    expect(doorMatch?.type).toBe('category');
    expect(doorMatch?.value).toBe(1.25);
    expect(hardwareMatch?.type).toBe('category');
    expect(hardwareMatch?.value).toBe(1.45);
  });
});
