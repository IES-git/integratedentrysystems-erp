/**
 * Governed ingestion profiles for known source families.
 *
 * Profiles do not contain prices. They define expected source identity and
 * catalog coverage so an incomplete AI table index cannot quietly publish.
 */
export const PRICE_BOOK_PROFILES = [
  {
    key: 'pioneer-steel-doors-frames',
    version: '2026-06-21.4',
    manufacturer: 'Pioneer Industries',
    aliases: ['pioneer', 'aadg'],
    ingestionLane: 'pdf_rule_compiler',
    knownSources: [{
      sha256: 'ef32d45501233ff59e06311abc0dce91f310a439dd0015b61b2b13b482abcf27',
      fileName: 'Pioneer Pricing and Estimating Guide_2025 (4).pdf',
      effectiveDate: '2025-05-01',
      pageCount: 103,
      fileType: 'pdf',
      role: 'production_input',
    }],
    minimumCatalogTables: 32,
    requiredCategories: ['doors', 'frames', 'panels'],
    requiredRuleEntities: ['door', 'frame', 'panel'],
    requiredPageBands: [
      { label: 'door pricing and options', start: 14, end: 40, minimumTables: 12 },
      { label: 'frame pricing and options', start: 44, end: 74, minimumTables: 12 },
      { label: 'stick material', start: 79, end: 86, minimumTables: 3 },
      { label: 'special assemblies', start: 88, end: 101, minimumTables: 5 },
    ],
    sectionAnchors: [
      ['h series', 'standard doors'],
      ['panels', 'panel'],
      ['f series', 'standard frames'],
      ['dw series', 'drywall frames', 'drywall'],
      ['borrowed lites', 'borrowed lite'],
      ['additional preparations', 'door preparations', 'frame preparations'],
    ],
  },
  {
    key: 'ceco-steel-doors-frames',
    version: '2026-06-21.4',
    manufacturer: 'CECO Door',
    aliases: ['ceco', 'ceco door'],
    ingestionLane: 'pdf_rule_compiler',
    knownSources: [{
      sha256: 'e491ce09add14b4ccd193a146817a6929c07120821153a9ae7aaacd22d888101',
      fileName: 'Ceco Price Book - Effective April 20, 2026 (1).pdf',
      effectiveDate: '2026-04-20',
      pageCount: 167,
      fileType: 'pdf',
      role: 'production_input',
    }],
    minimumCatalogTables: 90,
    requiredCategories: ['doors', 'frames'],
    requiredRuleEntities: ['door', 'frame'],
    requiredPageBands: [
      { label: 'door families', start: 15, end: 37, minimumTables: 15 },
      { label: 'accessories and preparations', start: 38, end: 58, minimumTables: 15 },
      { label: 'standard and drywall frames', start: 60, end: 89, minimumTables: 20 },
      { label: 'components and parts', start: 91, end: 107, minimumTables: 12 },
      { label: 'specialty products', start: 108, end: 138, minimumTables: 15 },
      { label: 'windstorm and StormPro', start: 140, end: 166, minimumTables: 20 },
    ],
    sectionAnchors: [
      ['regent', 'ri series'],
      ['legion', 'lp series'],
      ['medallion', 'ms series'],
      ['standard frames', 'sq series', 'masonry frames'],
      ['drywall frames', 'dq series'],
      ['lite kits', 'slim trim', 'vision kits'],
      ['louvers', 'louver'],
    ],
  },
  {
    key: 'de-la-fontaine-steel-doors-frames',
    version: '2026-06-21.4',
    manufacturer: 'De La Fontaine',
    aliases: ['de la fontaine', 'delafontaine'],
    ingestionLane: 'pdf_rule_compiler',
    knownSources: [{
      sha256: '7d17f56a7f907b473b8c7d9022a3a23e7dc5a54010bf8949c31e128f60a84802',
      fileName: 'Price-Book-2023-rev3.1.pdf',
      effectiveDate: '2023-09-01',
      pageCount: 146,
      fileType: 'pdf',
      role: 'production_input',
    }],
    minimumCatalogTables: 52,
    requiredCategories: ['doors', 'frames'],
    requiredRuleEntities: ['door', 'frame'],
    requiredPageBands: [
      { label: 'door series', start: 22, end: 39, minimumTables: 9 },
      { label: 'frame series', start: 44, end: 79, minimumTables: 18 },
      { label: 'custom frame elevations', start: 84, end: 101, minimumTables: 8 },
      { label: 'door and frame options', start: 106, end: 120, minimumTables: 8 },
      { label: 'specialty products', start: 124, end: 135, minimumTables: 6 },
      { label: 'door and frame parts', start: 140, end: 145, minimumTables: 3 },
    ],
    sectionAnchors: [
      ['hc series', 'honeycomb doors'],
      ['ps series', 'polystyrene doors'],
      ['sr series', 'standard frames'],
      ['dw series', 'drywall frames'],
      ['custom frame', 'custom frames'],
      ['vision kit', 'lite kit', 'louvers'],
      ['specialty products', 'lead-lined', 'bullet resistant'],
      ['door and frame parts', 'parts'],
    ],
  },
  {
    key: 'ngp-infill-2026',
    version: '2026-06-21.4',
    manufacturer: 'NGP / Anemostat Door Products',
    aliases: ['ngp', 'anemostat'],
    ingestionLane: 'ngp_normalized_workbook',
    knownSources: [
      {
        sha256: '9ddb400c994d7416c04a488ae2be3bd29214f4ace40f9233bfe464e78ec2d2f7',
        fileName: 'ngp-prices.pdf',
        effectiveDate: '2026-06-08',
        pageCount: 88,
        fileType: 'pdf',
        role: 'source_evidence',
      },
      {
        sha256: '8e2a19c925d81ca9c4aa221fbf1b3a954e7a5f23131346e758b7a69f285522e5',
        fileName: 'NGP_Glass_Lite_Louver_Normalized_Catalog_with_2026_Prices.xlsx',
        effectiveDate: '2026-06-08',
        pageCount: null,
        fileType: 'xlsx',
        role: 'production_input',
      },
    ],
    minimumCatalogTables: 20,
    requiredCategories: ['lites_louvers_glass'],
    requiredRuleEntities: ['lite_kit', 'louver', 'glass', 'glazing_tape'],
    requiredPageBands: [],
    sectionAnchors: [
      ['lite kits', 'vision kits'],
      ['louvers', 'louver'],
      ['glass', 'glazing'],
      ['glazing tape', 'tape'],
    ],
  },
  {
    key: 'hardware-normalized-master',
    version: '2026-06-21.4',
    manufacturer: 'Mixed hardware suppliers',
    aliases: ['hardware normalized ingestion master'],
    ingestionLane: 'hardware_normalized_workbook',
    knownSources: [{
      sha256: '2ba88d8eba90c772a47757214c059d4bee1777e0c38384ec6dc4634915cb4d75',
      fileName: 'Hardware_Normalized_Ingestion_Master.xlsx',
      effectiveDate: null,
      pageCount: null,
      fileType: 'xlsx',
      role: 'production_input',
    }],
    minimumCatalogTables: 0,
    requiredCategories: ['hardware'],
    requiredRuleEntities: [],
    requiredPageBands: [],
    sectionAnchors: [],
  },
];

function haystack(input) {
  return [input.fileName, input.vendorName, input.title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match exact source hash first, then conservative manufacturer/file aliases. */
export function identifyPriceBookProfile(input) {
  const hash = String(input.sha256 ?? '').trim().toLowerCase();
  if (hash) {
    const exact = PRICE_BOOK_PROFILES.find((profile) =>
      profile.knownSources.some((source) => source.sha256 === hash));
    if (exact) return exact;
  }
  const text = haystack(input);
  if (!text) return null;
  return PRICE_BOOK_PROFILES.find((profile) =>
    profile.aliases.some((alias) => text.includes(alias))) ?? null;
}

export function getPriceBookProfile(key) {
  return PRICE_BOOK_PROFILES.find((profile) => profile.key === key) ?? null;
}

function anchorTerms(anchor) {
  return Array.isArray(anchor) ? anchor : [anchor];
}

function anchorLabel(anchor) {
  return anchorTerms(anchor).join(' / ');
}

function physicalPageFromHint(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const preferred = text.match(/\b(?:physical|pdf)\s*(?:page|p\.?)?\s*#?\s*(\d{1,4})\b/i);
  if (preferred) return Number(preferred[1]);
  const explicit = text.match(/\b(?:p{1,2}\.?|pages?)\s*#?\s*(\d{1,4})\b/i);
  if (explicit) return Number(explicit[1]);
  if (/^\s*\d{1,4}(?:\s*[-–—]\s*\d{1,4})?\s*$/.test(text)) {
    return Number(text.match(/\d{1,4}/)?.[0] ?? NaN) || null;
  }
  return null;
}

export function buildProfileCatalogChecklist(profile) {
  if (!profile) return '';
  const categories = profile.requiredCategories.join(', ');
  const anchors = profile.sectionAnchors.map(anchorLabel).join('; ');
  const pageBands = profile.requiredPageBands.map((band) =>
    `${band.label}: physical PDF pages ${band.start}-${band.end}, at least ${band.minimumTables} priced tables/sections`).join('; ');
  return [
    `KNOWN SOURCE PROFILE: ${profile.manufacturer} (${profile.key}, ${profile.version}).`,
    `Expected ingestion lane: ${profile.ingestionLane}.`,
    `Required catalog categories: ${categories || 'none'}.`,
    anchors ? `Expected sections/anchors (wording may vary): ${anchors}.` : '',
    pageBands ? `Required physical-page coverage: ${pageBands}.` : '',
    profile.minimumCatalogTables > 0
      ? `Do not stop before finding at least ${profile.minimumCatalogTables} distinct priced tables unless the source truly contains fewer.`
      : '',
  ].filter(Boolean).join('\n');
}

/**
 * Catalog-stage coverage report. Publication performs a second rule/entity gate.
 */
export function evaluateCatalogProfileCoverage(profile, tables) {
  if (!profile) {
    return {
      passed: true,
      profileKey: null,
      profileVersion: null,
      tableCount: tables.length,
      categoryCounts: {},
      missingCategories: [],
      missingAnchors: [],
      pageBandCounts: {},
      missingPageBands: [],
      unlocatedTableCount: 0,
      issues: [],
    };
  }
  const categoryCounts = {};
  const text = tables.map((table) =>
    `${table.title ?? ''} ${table.description ?? ''} ${table.series ?? ''}`.toLowerCase()).join('\n');
  for (const table of tables) {
    const category = table.category ?? 'other';
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  }
  const missingCategories = profile.requiredCategories.filter((category) => !categoryCounts[category]);
  const missingAnchors = profile.sectionAnchors
    .filter((anchor) => !anchorTerms(anchor).some((term) => text.includes(term)))
    .map(anchorLabel);
  const tablePages = tables.map((table) => physicalPageFromHint(table.page_hint));
  const unlocatedTableCount = tablePages.filter((page) => page == null).length;
  const pageBandCounts = {};
  const missingPageBands = [];
  for (const band of profile.requiredPageBands) {
    const count = tablePages.filter((page) => page != null && page >= band.start && page <= band.end).length;
    pageBandCounts[band.label] = count;
    if (count < band.minimumTables) {
      missingPageBands.push({
        label: band.label,
        start: band.start,
        end: band.end,
        expected: band.minimumTables,
        actual: count,
      });
    }
  }
  const issues = [];
  if (tables.length < profile.minimumCatalogTables) {
    issues.push(`Catalog has ${tables.length} tables; profile expects at least ${profile.minimumCatalogTables}.`);
  }
  if (missingCategories.length > 0) {
    issues.push(`Missing required categories: ${missingCategories.join(', ')}.`);
  }
  if (missingAnchors.length > 0) {
    issues.push(`Expected section anchors not found: ${missingAnchors.join(', ')}.`);
  }
  if (missingPageBands.length > 0) {
    issues.push(`Physical-page coverage incomplete: ${missingPageBands.map((band) =>
      `${band.label} pages ${band.start}-${band.end} has ${band.actual}/${band.expected} tables`).join('; ')}.`);
  }
  if (tables.length > 0 && unlocatedTableCount > Math.max(2, Math.floor(tables.length * 0.05))) {
    issues.push(`${unlocatedTableCount} catalog entries lack a parseable physical PDF page hint.`);
  }
  return {
    passed: issues.length === 0,
    profileKey: profile.key,
    profileVersion: profile.version,
    ingestionLane: profile.ingestionLane,
    tableCount: tables.length,
    categoryCounts,
    missingCategories,
    missingAnchors,
    pageBandCounts,
    missingPageBands,
    unlocatedTableCount,
    issues,
  };
}
