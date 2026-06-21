// Deterministic helpers for the CPQ v2 rule-compilation pipeline (Phase 2.1):
// table-archetype classifier, header flattener, token normalizer, and the
// dimension parser that turns door-industry size labels into inch ranges.
//
// These are pure functions (no Gemini, no DB) so rule compilation is
// reproducible and auditable. The rule compiler in compile.js consumes them.

/** Canonical price-table archetypes (mirrors src/types/cpq.ts PriceTableArchetype). */
export const ARCHETYPES = [
  'base_matrix',
  'component_matrix',
  'code_adder_list',
  'elevation',
  'size_oversize',
  'per_foot',
  'fabrication',
  'install_kit',
  'anchor',
  'quantity_tier',
  'percentage',
  'next_larger',
  'included_nc_na',
  'contact_factory',
  'specialty_assembly',
  'narrative',
];

const NUM = '[0-9]+(?:\\.[0-9]+)?';

/**
 * Normalize a single source token / phrase into a structured pricing intent.
 * Recognizes the Pioneer "Tokens and Phrases" vocabulary. Returns null when the
 * text is just a plain number or unrecognized (caller treats as a price/label).
 *
 * @param {string|number|null|undefined} raw
 * @returns {{ kind: string, [k:string]: unknown } | null}
 */
export function normalizeToken(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const t = text.toLowerCase().replace(/\s+/g, ' ');

  // First-class price statuses (never silent zeros).
  if (/^(n\/?c|no charge)$/.test(t)) return { kind: 'status', status: 'NO_CHARGE' };
  if (/^(incl(?:uded|\.)?|inc)$/.test(t)) return { kind: 'status', status: 'INCLUDED' };
  if (/^(n\/?a|not applicable)$/.test(t)) return { kind: 'status', status: 'NOT_APPLICABLE' };
  if (/^(cf|c\/f|contact factory|consult factory|call factory|by factory)$/.test(t)) {
    return { kind: 'status', status: 'CONTACT_FACTORY' };
  }

  // Percentage adders: "Add 50%", "+100%", "200% of base".
  const pct = t.match(new RegExp(`(?:add\\s*)?(${NUM})\\s*%`));
  if (pct) return { kind: 'percent', percentage: Number(pct[1]) };

  // Next-larger-size reference.
  if (/next larger size|use next larger|price as next/.test(t)) return { kind: 'next_larger' };

  // Quantity waiver: "waived at 10", "no charge over 25", "setup waived qty 5".
  const waive = t.match(new RegExp(`waiv\\w*.*?(${NUM})|(?:over|qty)\\s*(${NUM}).*waiv`));
  if (waive) return { kind: 'waiver', qty: Number(waive[1] ?? waive[2]) };

  // Per-foot / linear basis.
  if (/per foot|per ft|\/\s*ft|per lineal|per lin|lf\b|linear/.test(t)) {
    const amt = t.match(new RegExp(`(${NUM})`));
    return { kind: 'per_foot', amount: amt ? Number(amt[1]) : null };
  }
  if (/per (?:each|ea)\b|\bea\b|each\b/.test(t)) {
    const amt = t.match(new RegExp(`(${NUM})`));
    return { kind: 'each', amount: amt ? Number(amt[1]) : null };
  }

  // Explicit fixed add: "Add 12.50", "+12.50".
  const add = t.match(new RegExp(`^(?:add|\\+)\\s*\\$?(${NUM})$`));
  if (add) return { kind: 'add', amount: Number(add[1]) };

  // Template / hand required flags (selection metadata).
  if (/template required|template req/.test(t)) return { kind: 'flag', flag: 'template_required' };
  if (/hand(?:ing)? required|hand req/.test(t)) return { kind: 'flag', flag: 'hand_required' };

  // Dependency phrasing inside a note.
  if (/\brequires?\b|\bmust (?:have|include)\b/.test(t)) return { kind: 'dependency', relationship: 'REQUIRES' };
  if (/\bexclud\w+\b|\bnot (?:allowed|available) with\b|\bcannot\b/.test(t)) return { kind: 'dependency', relationship: 'EXCLUDES' };
  if (/\bonly\b.*\bwith\b|\bonly (?:available|for)\b/.test(t)) return { kind: 'dependency', relationship: 'REQUIRES' };

  // Pure number?
  if (new RegExp(`^\\$?${NUM}$`).test(t)) return { kind: 'number', amount: Number(t.replace(/[^0-9.]/g, '')) };

  return null;
}

/** Strip a price out of arbitrary text ("$12.50 / ea" -> 12.5). null if none. */
export function parsePrice(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  const m = String(raw).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return isFinite(n) ? n : null;
}

const GAUGE_RE = /\b(7|10|11|12|14|16|18|20|22|24)\s*(?:ga|gauge|gage)\b/i;
const MATERIAL_RE = /\b(crs|cold rolled|galv(?:annealed|anized)?|a60|g60|g90|stainless|ss|304|316|alum(?:inum)?)\b/i;
const DEPTH_RE = /\b(\d+(?:\s+\d\/\d)?(?:\.\d+)?)\s*(?:"|in\b|inch)/i;

/**
 * Header flattener: pull discrete attribute tokens out of a (possibly combined)
 * column label like "18 Gauge / CRS" or "5 3/4\" Galv". Returns a normalized
 * descriptor used to build the column's rule_condition.
 *
 * @param {string} label
 * @returns {{ label: string, gauge: string|null, material: string|null, depth: string|null }}
 */
export function flattenColumnHeader(label) {
  const s = String(label ?? '').trim();
  const gauge = s.match(GAUGE_RE);
  const material = s.match(MATERIAL_RE);
  const depth = s.match(DEPTH_RE);
  return {
    label: s,
    gauge: gauge ? gauge[1] : null,
    material: material ? normalizeMaterial(material[1]) : null,
    depth: depth ? depth[1].trim() : null,
  };
}

function normalizeMaterial(m) {
  const t = m.toLowerCase();
  if (/crs|cold rolled/.test(t)) return 'CRS';
  if (/galv|a60|g60|g90/.test(t)) return 'Galvannealed';
  if (/stainless|ss|304|316/.test(t)) return 'Stainless';
  if (/alum/.test(t)) return 'Aluminum';
  return m.toUpperCase();
}

// Plausible nominal maxima (inches). A parsed dimension larger than these is a
// mis-parsed concatenated size code (e.g. "2070" -> 2070", "240" -> 240"), NOT a
// real opening; we treat those as unparseable so the compiler skips the row
// rather than emitting an always-true / single-axis bound that over-matches.
export const MAX_NOMINAL_WIDTH_IN = 120; // 10 ft (generous for pairs/multi-leaf)
export const MAX_NOMINAL_HEIGHT_IN = 144; // 12 ft

/** Return n only when it is a positive, plausible dimension; else null. */
function plausible(n, max) {
  return n != null && Number.isFinite(n) && n > 0 && n <= max ? n : null;
}

/**
 * Decode a compact concatenated size code with NO separator, e.g. "2070" =
 * 2'0" x 7'0" (24 x 84) or "2868" = 2'8" x 6'8" (32 x 80). The Pioneer door
 * grids list these as 4-digit WWHH codes where each pair is feet+inches.
 *
 * @param {string} s a trimmed token
 * @returns {{ width: number, height: number } | null}
 */
export function decodeCompactSizeCode(s) {
  if (!/^\d{4}$/.test(s)) return null;
  const width = plausible(Number(s[0]) * 12 + Number(s[1]), MAX_NOMINAL_WIDTH_IN);
  const height = plausible(Number(s[2]) * 12 + Number(s[3]), MAX_NOMINAL_HEIGHT_IN);
  if (width == null || height == null) return null;
  return { width, height };
}

/**
 * Parse a door-industry size label into nominal width/height inches.
 * Handles "3-0 x 7-0", "3'0\" x 7'0\"", "2-0, 2-4 x 6-8" (takes the last/widest
 * width before the height), compact codes ("2070" => 24 x 84), and single
 * feet-inches labels ("3-0" => 36"). Returns nulls for anything that does not
 * resolve to a plausible dimension (bare numbers, 3-digit shortcut codes, junk)
 * so the compiler can skip the row instead of inventing an always-true bound.
 *
 * @param {string} label
 * @returns {{ width: number|null, height: number|null }}
 */
export function parseSizeLabel(label) {
  const s = String(label ?? '').trim();
  if (!s) return { width: null, height: null };

  // Explicit width x height.
  if (/[x×]/i.test(s)) {
    const parts = s.split(/\s*[x×]\s*/i);
    const lastWidth = (parts[0] ?? '').split(/[,/]/).map((p) => p.trim()).filter(Boolean).pop() ?? parts[0];
    return {
      width: plausible(feetInchesToInches(lastWidth), MAX_NOMINAL_WIDTH_IN),
      height: parts[1] ? plausible(feetInchesToInches(parts[1]), MAX_NOMINAL_HEIGHT_IN) : null,
    };
  }

  // Compact concatenated size code (no separator): "2070" -> 24 x 84.
  const compact = decodeCompactSizeCode(s);
  if (compact) return compact;

  // Single feet-inches dimension ("3-0", "20-0", "2-0, 2-4").
  if (/\d\s*[-'’]\s*\d/.test(s)) {
    const lastWidth = s.split(/[,/]/).map((p) => p.trim()).filter(Boolean).pop() ?? s;
    return { width: plausible(feetInchesToInches(lastWidth), MAX_NOMINAL_WIDTH_IN), height: null };
  }

  // Not a recognizable dimension (bare number, 3/5-digit shortcut, junk).
  return { width: null, height: null };
}

/** "3-0" / "3'0\"" / "3' 0\"" -> inches. Bare numbers are returned as-is (the
 *  caller clamps via `plausible`); use `parseSizeLabel` for size labels. */
export function feetInchesToInches(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // feet-dash-inches or feet'inches"
  const fi = s.match(/^(\d+)\s*[-'’]\s*(\d{1,2})/);
  if (fi) return Number(fi[1]) * 12 + Number(fi[2]);
  // bare inches (>= 12 assume inches, else assume feet only)
  const n = Number(s.replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || s === '') return null;
  return n;
}

/**
 * Classify a table's archetype from its title, kind, detected category, and the
 * shape of its extracted grid. Deterministic; the rule compiler branches on the
 * result. Falls back to base_matrix for unrecognized priced grids and narrative
 * for tables with no numeric cells.
 *
 * @param {{ title?: string, kind?: string, detectedCategory?: string }} meta
 * @param {{ columnLabels?: string[], rowLabels?: string[], cells?: unknown[] }} grid
 * @returns {string} one of ARCHETYPES
 */
export function classifyArchetype(meta, grid) {
  const title = (meta?.title ?? '').toLowerCase();
  const kind = (meta?.kind ?? '').toLowerCase();
  const cells = grid?.cells ?? [];
  const rowLabels = grid?.rowLabels ?? [];
  const colLabels = grid?.columnLabels ?? [];
  const hay = `${title} ${kind}`;

  // No prices at all -> narrative / notes table.
  if (cells.length === 0) return 'narrative';

  if (/contact factory|consult factory/.test(hay)) return 'contact_factory';
  if (/oversize|over size|over-size/.test(hay)) return 'size_oversize';
  if (/anchor/.test(hay)) return 'anchor';
  if (/install|installation kit|kit\b/.test(hay)) return 'install_kit';
  if (/elevation|lite cut|glass cut|vision/.test(hay)) return 'elevation';
  if (/fabricat|machin|prep(?:aration)?\b|cutout|reinforc/.test(hay)) return 'fabrication';
  if (/per foot|per ft|linear|weatherstrip|sweep|threshold|gasket/.test(hay)) return 'per_foot';
  if (/\b%|percent|percentage/.test(hay)) return 'percentage';
  if (/quantity|qty break|setup|waiv/.test(hay)) return 'quantity_tier';
  if (/specialty|fema|stc|sbr|assembly/.test(hay)) return 'specialty_assembly';

  // Component/KD frames sold as heads & jambs.
  if (kind === 'component' || /\bkd\b|knock[- ]?down|head\s*&?\s*jamb|sticks?/.test(hay)) return 'component_matrix';

  // Option / adder lists: a single price column keyed by code/option rows.
  const oneColumn = colLabels.length <= 1;
  if (kind === 'adder' || kind === 'flat_list' || /option|adder|surcharge|add(?:er)?s?\b/.test(hay) || oneColumn) {
    return 'code_adder_list';
  }

  // Size grid: row labels look like dimensions and there are multiple columns.
  const looksLikeSizes = rowLabels.some((l) => /\d\s*[-'’]\s*\d/.test(String(l)) || /[x×]/i.test(String(l)));
  if (looksLikeSizes) return 'base_matrix';

  return 'base_matrix';
}

/** Map a price-book category to the canonical price_rule.entity_type. */
export function categoryToEntityType(category) {
  switch (category) {
    case 'doors': return 'door';
    case 'frames': return 'frame';
    case 'panels': return 'panel';
    case 'hardware': return 'hardware';
    case 'lites_louvers_glass': return 'specialty';
    default: return 'specialty';
  }
}

/** The spec field_path conventions used by rule_condition (matches spec_field_mapping). */
export function fieldPaths(entityType) {
  switch (entityType) {
    case 'door':
      return { series: 'door.door_series_construction', gauge: 'door.door_gauge', material: 'door.door_material', width: 'door.nominal_door_width', height: 'door.nominal_door_height', depth: null };
    case 'frame':
      return { series: 'frame.frame_series', gauge: 'frame.frame_gauge', material: 'frame.frame_material', width: 'frame.nominal_frame_width', height: 'frame.nominal_frame_height', depth: 'frame.jamb_depth' };
    case 'panel':
      return { series: 'panel.panel_construction_series', gauge: 'panel.panel_gauge', material: 'panel.panel_material', width: 'panel.panel_width', height: 'panel.panel_height', depth: null };
    default:
      return { series: 'opening.nominal_opening_width', gauge: null, material: null, width: 'opening.nominal_opening_width', height: 'opening.nominal_opening_height', depth: null };
  }
}
