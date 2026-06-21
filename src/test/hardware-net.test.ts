import { describe, it, expect } from 'vitest';
import { resolveHardwareNet, MAX_PLAUSIBLE_HARDWARE_NET, requiresDoorFramePrep, matchCrosswalk } from '@/lib/pricing';
import type { HardwarePrepCrosswalk } from '@/types';

const cw = (hardwareCategory: string, doorPrepCode: string | null, framePrepCode: string | null): HardwarePrepCrosswalk => ({
  id: hardwareCategory, hardwareCategory, hardwareProductId: null, hardwareVariantId: null,
  doorPrepCode, framePrepCode, templateId: null, handRequired: false, locationRequired: false,
  additionalRequiredFields: null, quantityBasis: null, pricingBehavior: null, notes: null,
  createdAt: '', updatedAt: '',
});

describe('matchCrosswalk', () => {
  // The seeded crosswalk is keyed by descriptive names, not canonical slugs.
  const rows = [
    cw('Butt hinge 4-1/2 standard weight', '450--', '450--'),
    cw('Cylindrical lock', 'CYL / L / T', '478/234 or special strike'),
    cw('Closer', 'STD', 'REG'),
  ];

  it('resolves canonical category slugs to descriptive crosswalk rows', () => {
    expect(matchCrosswalk('butt_hinges', rows)?.doorPrepCode).toBe('450--');
    expect(matchCrosswalk('cylindrical_mortise_locks_and_deadbolts', rows)?.framePrepCode).toBe('478/234 or special strike');
  });

  it('prefers an exact slug match when the crosswalk is re-keyed to slugs', () => {
    const slugRows = [cw('butt_hinges', 'EXACT', 'EXACT'), ...rows];
    expect(matchCrosswalk('butt_hinges', slugRows)?.doorPrepCode).toBe('EXACT');
  });

  it('prefers a variant-id match over a category match', () => {
    const withVariant: HardwarePrepCrosswalk = { ...cw('anything', 'V', 'V'), hardwareVariantId: 'v-123' };
    expect(matchCrosswalk('butt_hinges', [...rows, withVariant], { variantId: 'v-123' })?.doorPrepCode).toBe('V');
  });
});

const price = (netCost: number | null, listPrice: number | null = null, discountMultiplier: number | null = null) => ({
  netCost,
  listPrice,
  discountMultiplier,
});

describe('resolveHardwareNet', () => {
  it('uses a valid stored net', () => {
    expect(resolveHardwareNet(price(34.56))).toBe(34.56);
  });

  it('rejects a negative net (the -$230k lock bug) and falls back to nothing usable', () => {
    // 3201 corruption: net = list × list with a negative list.
    expect(resolveHardwareNet(price(-230544.02, -480.15, 480.15))).toBeNull();
  });

  it('rejects an absurdly large net (net = list²) and falls back to bare list', () => {
    // 47H7D15M630: net 820836 is list 906 squared; recover the plausible list.
    expect(resolveHardwareNet(price(820836, 906, 906))).toBe(906);
  });

  it('rejects a zero net (zero-multiplier maglock) and falls back to list', () => {
    expect(resolveHardwareNet(price(0, 120, 0))).toBe(120);
  });

  it('computes list × discount when net is missing', () => {
    expect(resolveHardwareNet(price(null, 138.25, 0.25))).toBe(34.56);
  });

  it('returns null when nothing is trustworthy', () => {
    expect(resolveHardwareNet(price(null, null, null))).toBeNull();
    expect(resolveHardwareNet(null)).toBeNull();
    expect(resolveHardwareNet(price(-5, -5, null))).toBeNull();
  });

  it('treats values above the plausibility ceiling as unusable', () => {
    expect(resolveHardwareNet(price(MAX_PLAUSIBLE_HARDWARE_NET + 1))).toBeNull();
    expect(resolveHardwareNet(price(MAX_PLAUSIBLE_HARDWARE_NET))).toBe(MAX_PLAUSIBLE_HARDWARE_NET);
  });
});

describe('requiresDoorFramePrep', () => {
  it('flags machined hardware as needing a prep', () => {
    expect(requiresDoorFramePrep('cylindrical_mortise_locks_and_deadbolts')).toBe(true);
    expect(requiresDoorFramePrep('butt_hinges')).toBe(true);
    expect(requiresDoorFramePrep('exit_devices')).toBe(true);
  });

  it('treats surface-mounted hardware as needing no prep', () => {
    expect(requiresDoorFramePrep('closers_and_arms')).toBe(false);
    expect(requiresDoorFramePrep('protection_accessories')).toBe(false);
    expect(requiresDoorFramePrep('weather_seals')).toBe(false);
    expect(requiresDoorFramePrep('thresholds')).toBe(false);
  });
});
