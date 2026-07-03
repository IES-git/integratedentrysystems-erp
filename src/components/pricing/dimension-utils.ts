import type { DimensionCriteria, DimensionCriteriaLeaf } from '@/types';

/** Parse plain-inch mixed fractions such as `5 3/4"`, `1-3/4"` or `6 5/8`. */
function parseMixedInches(raw: string): number | null {
  const s = raw.replace(/"/g, '').trim();
  const mixed = s.match(/^(\d+(?:\.\d+)?)\s*[- ]\s*(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = parseFloat(mixed[1]);
    const num = parseInt(mixed[2], 10);
    const den = parseInt(mixed[3], 10);
    if (den > 0) return whole + (num / den);
  }
  const fraction = s.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const num = parseInt(fraction[1], 10);
    const den = parseInt(fraction[2], 10);
    if (den > 0) return num / den;
  }
  return null;
}

/**
 * Parse a dimension that is intentionally expressed in plain inches, not
 * compact door-nominal notation. Use this for jamb depths, door thicknesses,
 * glass thicknesses, and NGP cutout dimensions.
 *
 * Examples:
 *   "1-3/4" → 1.75
 *   "1 3/4" → 1.75
 *   "1/4\"" → 0.25
 *   "5 3/4" → 5.75
 *   "24" → 24
 *   "2-0" → 24
 */
export function parsePlainInches(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;

  const mixed = parseMixedInches(s);
  if (mixed != null && mixed > 0) return mixed;

  const feetHyphen = s.match(/^(\d+)-(\d{1,2})$/);
  if (feetHyphen) {
    const feet = parseInt(feetHyphen[1], 10);
    const inches = parseInt(feetHyphen[2], 10);
    if (inches < 12) return feet * 12 + inches;
  }

  const feetApostrophe = s.match(/^(\d+)'\s*-?\s*(?:(\d+(?:\.\d+)?)\s*"?)?$/);
  if (feetApostrophe) {
    const feet = parseInt(feetApostrophe[1], 10);
    const inches = feetApostrophe[2] ? parseFloat(feetApostrophe[2]) : 0;
    if (inches < 12) return feet * 12 + inches;
  }

  const numeric = s.replace(/"/g, '').trim();
  if (/^\d+(?:\.\d+)?$/.test(numeric)) return parseFloat(numeric);

  return null;
}

/**
 * Parse a human-readable dimension string into a whole-inch number.
 *
 * Accepted formats:
 *   "2-0"    → 24   feet-hyphen-inches (door-width notation)
 *   "2-4"    → 28
 *   "6'8\""  → 80   feet-apostrophe / inch-quote notation
 *   "7'0\""  → 84
 *   "6'"     → 72   feet only
 *   "80"     → 80   plain integer inches
 *
 * Returns null when the string cannot be parsed.
 */
export function parseDimension(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  const mixed = parseMixedInches(s);
  if (mixed != null) return mixed;

  // feet-apostrophe-inches-quote: 6'8" or 6' 8"
  const feetApostrophe = s.match(/^(\d+)'\s*(?:(\d+)")?$/);
  if (feetApostrophe) {
    const feet = parseInt(feetApostrophe[1], 10);
    const inches = feetApostrophe[2] ? parseInt(feetApostrophe[2], 10) : 0;
    return feet * 12 + inches;
  }

  // feet-hyphen-inches: 2-0, 2-4, 3-0
  const feetHyphen = s.match(/^(\d+)-(\d{1,2})$/);
  if (feetHyphen) {
    const feet = parseInt(feetHyphen[1], 10);
    const inches = parseInt(feetHyphen[2], 10);
    return feet * 12 + inches;
  }

  // plain integer (inches)
  if (/^\d+$/.test(s)) {
    return parseInt(s, 10);
  }

  return null;
}

/**
 * THE canonical door-industry dimension parser. Every surface that interprets
 * a user-entered or book-extracted door/frame/lite dimension (builder
 * validation, lite sync, pricing lookup) MUST use this single function so a
 * value like "36" means the same thing everywhere.
 *
 * Handles all formats found in the field wizard and pricing tables:
 *
 * 1. Compact nominal  (stored in item_fields by the wizard)
 *    "36"  → 3 ft 6 in  = 42"    "68"  → 6 ft 8 in  = 80"
 *    "30"  → 3 ft 0 in  = 36"    "210" → 2 ft 10 in = 34"
 *    Rule: first 1 char = feet, remaining 1–2 chars = inches (must be 0–11)
 *
 * 2. Feet-hyphen-inches  (pricing table labels / user manual entry)
 *    "2-0" → 24"   "3-6" → 42"   "2-10" → 34"
 *
 * 3. Feet-apostrophe(-quote)  (user manual entry)
 *    "6'8\"" → 80"   "7'0\"" → 84"   "3'-0\"" → 36"   "6'" → 72"
 *
 * 4. Plain number inches  (fallback / OCR extracted; decimals allowed)
 *    "80" → 80"  "80.5" → 80.5"
 *    (NOTE: if the string also matches compact nominal it is parsed as
 *    nominal first — "80" = 8'0" = 96". In practice users enter "68" not
 *    "80" for 6'8" doors, so this is safe.)
 *
 * Returns null when the string cannot be parsed.
 */
export function parseDoorDimension(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // --- 2. feet-hyphen-inches: "2-0", "3-6", "2-10" ---
  const hyphen = s.match(/^(\d+)-(\d{1,2})$/);
  if (hyphen) {
    const ft = parseInt(hyphen[1], 10);
    const inch = parseInt(hyphen[2], 10);
    if (inch < 12) return ft * 12 + inch;
  }

  // --- 3. feet-apostrophe forms: "6'8\"", "7'0\"", "3'-0\"", "6' 8", "6'" ---
  const apos = s.match(/^(\d+)'\s*-?\s*(?:(\d+(?:\.\d+)?)\s*"?)?$/);
  if (apos) {
    const ft = parseInt(apos[1], 10);
    const inch = apos[2] ? parseFloat(apos[2]) : 0;
    if (inch < 12) return ft * 12 + inch;
  }

  // Plain-inch mixed fractions: frame jamb depths and door thicknesses such as
  // "5 3/4", "6 5/8", "1 3/4". These are NOT feet/inches dimensions.
  const mixed = parseMixedInches(s);
  if (mixed != null) return mixed;

  // --- 1. compact nominal: "36" → 3 ft 6 in = 42", "68" → 6 ft 8 in = 80" ---
  // Only matches 2–3 digit all-numeric strings.
  if (/^\d{2,3}$/.test(s)) {
    const feet = parseInt(s.charAt(0), 10);
    const inches = parseInt(s.slice(1), 10);
    // Valid only when the inch component is 0–11 (genuine feet-inches notation)
    if (inches >= 0 && inches < 12) {
      return feet * 12 + inches;
    }
    // If inches >= 12 (e.g. "99"), fall through to plain number
  }

  // --- 4. plain number (1-digit, 4+ digit, decimal, or nominal-invalid) ---
  if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);

  return null;
}

/**
 * Format a whole-inch number back to door-industry notation.
 *
 * < 36 inches (3 feet) → feet-hyphen notation: 24 → "2-0", 28 → "2-4"
 * ≥ 36 inches          → feet-quote notation:  80 → "6'8\"", 84 → "7'0\""
 */
export function formatDimension(inches: number): string {
  const feet = Math.floor(inches / 12);
  const rem = inches % 12;

  if (inches < 36) {
    return `${feet}-${rem}`;
  }
  return `${feet}'${rem}"`;
}

/**
 * Format inches using feet-hyphen notation unconditionally (door-width style).
 * e.g. 24 → "2-0", 30 → "2-6"
 */
export function formatDimensionHyphen(inches: number): string {
  const feet = Math.floor(inches / 12);
  const rem = inches % 12;
  return `${feet}-${rem}`;
}

/**
 * Format whole inches as compact nominal door/frame notation.
 *
 * Examples:
 *   36" -> "30"
 *   42" -> "36"
 *   84" -> "70"
 *   34" -> "210"
 */
export function formatCompactNominalDimension(inches: number): string {
  const feet = Math.floor(inches / 12);
  const rem = inches % 12;
  return `${feet}${String(rem).padStart(rem >= 10 ? 2 : 1, '0')}`;
}

/** Parses any supported door dimension and returns compact nominal notation. */
export function normalizeCompactNominalDimension(raw: string | number | null | undefined): string | null {
  const inches = parseDoorDimension(raw);
  if (inches == null || !Number.isInteger(inches) || inches <= 0) return null;
  return formatCompactNominalDimension(inches);
}

/**
 * Format inches using feet-quote notation unconditionally (door-height style).
 * e.g. 80 → "6'8\"", 84 → "7'0\""
 */
export function formatDimensionQuote(inches: number): string {
  const feet = Math.floor(inches / 12);
  const rem = inches % 12;
  return `${feet}'${rem}"`;
}

/**
 * Parse a plain number string (no feet/inches conversion).
 * Accepts integers and decimals: "30", "32.5", etc.
 */
export function parsePlain(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * Format a plain number back to a string (no feet/inches conversion).
 */
export function formatPlain(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function describeLeafWith(c: DimensionCriteriaLeaf, fmt: (n: number) => string): string {
  switch (c.type) {
    case 'in':
      return c.values.map(fmt).join(', ');
    case 'between':
      return `${fmt(c.min)} – ${fmt(c.max)}`;
    case 'gte':
      return `≥ ${fmt(c.value)}`;
    case 'gt':
      return `> ${fmt(c.value)}`;
    case 'lte':
      return `≤ ${fmt(c.value)}`;
  }
}

function describeLeaf(c: DimensionCriteriaLeaf): string {
  return describeLeafWith(c, formatDimension);
}

function matchLeaf(c: DimensionCriteriaLeaf, inches: number): boolean {
  switch (c.type) {
    case 'in':
      return c.values.includes(inches);
    case 'between':
      return inches >= c.min && inches <= c.max;
    case 'gte':
      return inches >= c.value;
    case 'gt':
      return inches > c.value;
    case 'lte':
      return inches <= c.value;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a human-readable summary of a DimensionCriteria value using a custom number formatter.
 * Use this when you don't want feet/inches notation (e.g. for plain-number width criteria).
 */
export function describeDimensionCriteriaWith(
  criteria: DimensionCriteria,
  fmt: (n: number) => string,
): string {
  if (criteria.type === 'raw') return criteria.label;
  if (criteria.type === 'or') {
    return criteria.conditions.map((c) => describeLeafWith(c, fmt)).join(' OR ');
  }
  return describeLeafWith(criteria as DimensionCriteriaLeaf, fmt);
}

/**
 * Return a human-readable summary of a DimensionCriteria value.
 *
 * Examples:
 *   { type: 'in', values: [24, 28] }                   → "2-0, 2-4"
 *   { type: 'between', min: 80, max: 84 }               → "6'8\" – 7'0\""
 *   { type: 'gte', value: 80 }                          → "≥ 6'8\""
 *   { type: 'gt', value: 80 }                           → "> 6'8\""
 *   { type: 'lte', value: 84 }                          → "≤ 7'0\""
 *   { type: 'or', conditions: [...] }                   → "2-0, 2-4 OR 2-6, 2-8"
 */
export function describeDimensionCriteria(criteria: DimensionCriteria): string {
  if (criteria.type === 'raw') return criteria.label;
  if (criteria.type === 'or') {
    return criteria.conditions.map(describeLeaf).join(' OR ');
  }
  return describeLeaf(criteria);
}

/**
 * Test whether a given inch value satisfies the criteria.
 * For 'or' criteria, returns true if any condition matches.
 */
export function dimensionMatches(criteria: DimensionCriteria, inches: number): boolean {
  if (criteria.type === 'raw') return false;
  if (criteria.type === 'or') {
    return criteria.conditions.some((c) => matchLeaf(c, inches));
  }
  return matchLeaf(criteria, inches);
}
