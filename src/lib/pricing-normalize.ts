/**
 * Gauge / depth / spec-field normalization for pricing.
 *
 * Manufacturer price books spell the same gauge and frame-depth many ways
 * ("18", "18 GA", "18 Gauge", "18 GAGE MATERIAL | 4 3/4\"…", "18 Gauge CRS",
 * "18 Gauge GALV"). These helpers reduce any of those to a canonical value so
 * the runtime lookup matches reliably regardless of how the table was labeled
 * or how the item field was stored.
 *
 * `normalizeSpecValue` extends this to the spec-field keys used in
 * selection_criteria (edge_construction, core_construction, frame_type,
 * frame_fabrication) so ingest-written values and wizard-entered values
 * compare equal regardless of case or common abbreviations.
 */

/** Parse a single gauge value to its integer (e.g. "18 Gauge CRS" -> 18). */
export function normalizeGauge(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw);
  // "<n> ga|gauge|gage"
  const labeled = s.match(/\b(\d{1,2})\s*(?:ga|gauge|gage)\b/i);
  if (labeled) {
    const n = parseInt(labeled[1], 10);
    if (n >= 8 && n <= 30) return n;
  }
  // bare 2-digit gauge ("18")
  const bare = s.trim().match(/^(\d{2})$/);
  if (bare) {
    const n = parseInt(bare[1], 10);
    if (n >= 8 && n <= 30) return n;
  }
  return null;
}

/** Every distinct gauge mentioned in a column label. */
export function extractGaugeTokens(label: string | null | undefined): number[] {
  if (!label) return [];
  const out = new Set<number>();
  const re = /\b(\d{1,2})\s*(?:ga|gauge|gage)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(label)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 8 && n <= 30) out.add(n);
  }
  return [...out];
}

/** Parse a frame depth to decimal inches ("4 3/4\"" -> 4.75, "6" -> 6). */
export function normalizeDepth(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[""″]/g, '').trim();
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/); // mixed: 4 3/4
  if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10);
  m = s.match(/^(\d+)\/(\d+)$/); // fraction: 3/4
  if (m) return parseInt(m[1], 10) / parseInt(m[2], 10);
  m = s.match(/^(\d+(?:\.\d+)?)$/); // decimal/integer: 6 or 5.75
  if (m) return parseFloat(m[1]);
  return null;
}

/**
 * Every distinct depth mentioned in a column label. Frame columns often encode
 * gauge AND depth in one label ("16 GAGE MATERIAL | 4 3/4\", 5 3/4\", 6\""), so
 * we read depths from the segment AFTER a "|" when present to avoid mistaking
 * the leading gauge number for a depth.
 */
export function extractDepthTokens(label: string | null | undefined): number[] {
  if (!label) return [];
  const segment = label.includes('|') ? label.split('|').slice(1).join('|') : label;
  const out = new Set<number>();
  const re = /(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*[""″]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    const v = normalizeDepth(m[1]);
    if (v != null) out.add(v);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Spec-field value normalization
// ---------------------------------------------------------------------------

/**
 * Canonical forms for commonly aliased spec-field values.
 * Maps every known alias → canonical value.
 * Add new entries here as new manufacturers are ingested.
 */
const SPEC_ALIASES: Record<string, Record<string, string>> = {
  edge_construction: {
    'cw': 'Continuous Weld',
    'continuous weld': 'Continuous Weld',
    'cont weld': 'Continuous Weld',
    'cont. weld': 'Continuous Weld',
    'lockseam': 'Lockseam',
    'lock seam': 'Lockseam',
  },
  core_construction: {
    'embossed': 'Embossed Panel',
    'embossed panel': 'Embossed Panel',
    'stiffened': 'Steel Stiffened',
    'steel stiffened': 'Steel Stiffened',
    'steel-stiffened': 'Steel Stiffened',
    'glued': 'Glued',
    'glued polystyrene': 'Glued',
    'honeycomb': 'Honeycomb',
    'kraft honeycomb': 'Honeycomb',
    'polyurethane': 'Polyurethane',
    'temperature rise': 'Temperature Rise',
  },
  frame_type: {
    'dw': 'Drywall',
    'drywall': 'Drywall',
    'masonry': 'Masonry',
    'cmu': 'Masonry',
    'hollow metal': 'Masonry',
    'kerf': 'Kerf',
  },
  frame_fabrication: {
    'kd': 'KD',
    'knock down': 'KD',
    'knockdown': 'KD',
    'welded': 'Welded-full',
    'welded full': 'Welded-full',
    'welded-full': 'Welded-full',
    'full welded': 'Welded-full',
  },
};

/**
 * Normalizes a spec-field value to its canonical form for a given field key.
 * Returns the canonical value when an alias is found; otherwise returns the
 * trimmed input unchanged so new values pass through cleanly.
 *
 * Example: normalizeSpecValue('edge_construction', 'cw') → 'Continuous Weld'
 */
export function normalizeSpecValue(fieldKey: string, raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s) return null;
  const table = SPEC_ALIASES[fieldKey];
  if (table) {
    const alias = table[s.toLowerCase()];
    if (alias) return alias;
  }
  return s;
}
