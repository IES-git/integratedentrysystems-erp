import type { DimensionCriteria, DimensionCriteriaLeaf } from '@/types';

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
