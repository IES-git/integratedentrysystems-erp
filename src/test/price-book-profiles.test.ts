import { describe, expect, it } from 'vitest';
import {
  buildProfileCatalogChecklist,
  evaluateCatalogProfileCoverage,
  getProfileCatalogSeeds,
  identifyPriceBookProfile,
} from '../../services/price-book-worker/src/profiles.js';

describe('governed price-book source profiles', () => {
  it('identifies the supplied books by exact SHA-256 fingerprint', () => {
    expect(identifyPriceBookProfile({
      sha256: 'ef32d45501233ff59e06311abc0dce91f310a439dd0015b61b2b13b482abcf27',
    })?.key).toBe('pioneer-steel-doors-frames');
    expect(identifyPriceBookProfile({
      sha256: 'e491ce09add14b4ccd193a146817a6929c07120821153a9ae7aaacd22d888101',
    })?.key).toBe('ceco-steel-doors-frames');
    expect(identifyPriceBookProfile({
      sha256: '7d17f56a7f907b473b8c7d9022a3a23e7dc5a54010bf8949c31e128f60a84802',
    })?.key).toBe('de-la-fontaine-steel-doors-frames');
    expect(identifyPriceBookProfile({
      sha256: '8e2a19c925d81ca9c4aa221fbf1b3a954e7a5f23131346e758b7a69f285522e5',
    })?.key).toBe('ngp-infill-2026');
  });

  it('flags incomplete catalogs instead of treating a partial index as done', () => {
    const profile = identifyPriceBookProfile({ fileName: 'Pioneer Pricing Guide.pdf' });
    const result = evaluateCatalogProfileCoverage(profile, [
      { title: 'Standard Doors', category: 'doors' },
      { title: 'Standard Frames', category: 'frames' },
    ]);
    expect(result.passed).toBe(false);
    expect(result.missingCategories).toContain('panels');
    expect(result.issues.join(' ')).toContain('at least');
  });

  it('injects expected categories and sections into the catalog prompt', () => {
    const profile = identifyPriceBookProfile({ fileName: 'Ceco price book.pdf' });
    const checklist = buildProfileCatalogChecklist(profile);
    expect(checklist).toContain('CECO Door');
    expect(checklist).toContain('doors, frames');
    expect(checklist).toContain('legion / lp series');
  });

  it('seeds small independently priced Pioneer option blocks on the golden page', () => {
    const profile = identifyPriceBookProfile({
      sha256: 'ef32d45501233ff59e06311abc0dce91f310a439dd0015b61b2b13b482abcf27',
    });
    const seeds = getProfileCatalogSeeds(profile);
    expect(seeds.map((seed) => seed.title)).toEqual(expect.arrayContaining([
      'H Series - Door Construction',
      'H Series - Material Type',
      'H Series - Door Thickness',
      'H Series - Seamless Edge',
      'H Series - Pair / Single / DE Pair',
    ]));
    expect(seeds.every((seed) => seed.page_hint === 'PDF p. 14')).toBe(true);
    expect(buildProfileCatalogChecklist(profile)).toContain('H Series - Material Type at PDF p. 14');
  });

  it('accepts source-specific series names as alternatives to generic section titles', () => {
    const profile = identifyPriceBookProfile({ fileName: 'Ceco price book.pdf' });
    const result = evaluateCatalogProfileCoverage(profile, [
      { title: 'Regent RI Series', category: 'doors' },
      { title: 'Legion LP Series', category: 'doors' },
      { title: 'Medallion MS Series', category: 'doors' },
      { title: 'SQ Series Masonry Frames', category: 'frames' },
      { title: 'DQ Series', description: 'Drywall units', category: 'frames' },
      { title: 'Slim Trim Vision Kits', category: 'doors' },
      { title: 'Louver Products', category: 'doors' },
      ...Array.from({ length: 23 }, (_, index) => ({
        title: `CECO door table ${index + 1}`,
        category: 'doors',
        page_hint: `PDF p. ${15 + (index % 23)}`,
      })),
      ...Array.from({ length: 21 }, (_, index) => ({
        title: `CECO prep table ${index + 1}`,
        category: 'doors',
        page_hint: `PDF p. ${38 + (index % 21)}`,
      })),
      ...Array.from({ length: 30 }, (_, index) => ({
        title: `CECO frame table ${index + 1}`,
        category: 'frames',
        page_hint: `PDF p. ${60 + (index % 30)}`,
      })),
      ...Array.from({ length: 17 }, (_, index) => ({
        title: `CECO component table ${index + 1}`,
        category: 'frames',
        page_hint: `PDF p. ${91 + (index % 17)}`,
      })),
      ...Array.from({ length: 31 }, (_, index) => ({
        title: `CECO specialty table ${index + 1}`,
        category: index % 2 === 0 ? 'doors' : 'frames',
        page_hint: `PDF p. ${108 + (index % 31)}`,
      })),
      ...Array.from({ length: 27 }, (_, index) => ({
        title: `CECO windstorm table ${index + 1}`,
        category: index % 2 === 0 ? 'doors' : 'frames',
        page_hint: `PDF p. ${140 + (index % 27)}`,
      })),
    ]);
    expect(result.passed).toBe(true);
    expect(result.missingAnchors).toEqual([]);
  });

  it('blocks a catalog that has section names but misses priced physical-page bands', () => {
    const profile = identifyPriceBookProfile({
      sha256: '7d17f56a7f907b473b8c7d9022a3a23e7dc5a54010bf8949c31e128f60a84802',
    });
    const result = evaluateCatalogProfileCoverage(profile, Array.from({ length: 60 }, (_, index) => ({
      title: [
        'HC Series Honeycomb Doors',
        'PS Series Polystyrene Doors',
        'SR Series Standard Frames',
        'DW Series Drywall Frames',
        'Custom Frame',
        'Vision Kit and Louvers',
        'Specialty Products Lead-Lined',
        'Door and Frame Parts',
      ][index % 8],
      category: index % 2 === 0 ? 'doors' : 'frames',
      page_hint: `PDF p. ${22 + (index % 18)}`,
    })));
    expect(result.passed).toBe(false);
    expect(result.missingPageBands.some((band) => band.label === 'frame series')).toBe(true);
  });
});
