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

/**
 * Preserve one non-blank source cell without forcing it to be numeric.
 *
 * Price books use semantic tokens such as N/C, INCLUDED, N/A, and CF in the
 * same cells that otherwise contain prices. Dropping those cells turns an
 * explicit manufacturer rule into a silent gap. This helper keeps the exact
 * source text and only assigns `price` when the cell is genuinely numeric.
 *
 * @param {unknown} raw
 * @param {unknown} [explicitPrice]
 * @returns {{ rawValue: string, price: number|null } | null}
 */
export function interpretGridCell(raw, explicitPrice = null) {
  const source = raw ?? explicitPrice;
  if (source == null) return null;
  const rawValue = String(source).trim();
  if (!rawValue) return null;

  // Semantic tokens are first-class and must not be parsed as money.
  const token = normalizeToken(rawValue);
  if (token && token.kind !== 'number') return { rawValue, price: null };

  if (typeof explicitPrice === 'number' && Number.isFinite(explicitPrice)) {
    return { rawValue, price: explicitPrice };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { rawValue, price: raw };
  }

  // Strict money/number cell only. Avoid turning labels such as "Size 36" or
  // "Add 25%" into a price.
  const compact = rawValue.replace(/\s+/g, '');
  if (!/^\(?\$?-?\d[\d,]*(?:\.\d+)?\)?$/.test(compact)) {
    return { rawValue, price: null };
  }
  const negative = compact.startsWith('(') && compact.endsWith(')');
  const parsed = Number(compact.replace(/[,$()]/g, ''));
  return Number.isFinite(parsed)
    ? { rawValue, price: negative ? -parsed : parsed }
    : { rawValue, price: null };
}

/**
 * Parse the first printed PDF page number from an extractor page hint.
 * Spreadsheet hints intentionally return null.
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parsePageHint(raw) {
  const text = String(raw ?? '').trim();
  if (!text || /\bsheet\b/i.test(text)) return null;
  const explicit = text.match(/\b(?:p{1,2}\.?|pages?)\s*#?\s*(\d{1,4})\b/i);
  if (explicit) return Number(explicit[1]);
  if (/^\s*\d{1,4}(?:\s*[-–—]\s*\d{1,4})?\s*$/.test(text)) {
    return Number(text.match(/\d{1,4}/)?.[0] ?? NaN) || null;
  }
  return null;
}

/**
 * Infer manufacturer-neutral selectors from a table title/description/series.
 *
 * The selected immutable price-book document already supplies manufacturer
 * identity. Base rules should match canonical construction specs rather than
 * require vendor-specific series codes in the opening schema.
 *
 * @param {string} entityType
 * @param {{ title?: string|null, description?: string|null, detected_series?: string|null, series?: string|null }} meta
 * @returns {{ fieldPath:string, operator:string, valueType:string, value1:string, normalizedValue:string, sourcePhrase:string }[]}
 */
export function inferCanonicalSelectors(entityType, meta = {}) {
  const title = String(meta.title ?? '');
  const description = String(meta.description ?? '');
  const seriesRaw = String(meta.detected_series ?? meta.series ?? '').replace(/\s+series$/i, '').trim();
  const series = seriesRaw.toUpperCase();
  const titleHay = title.toLowerCase();
  const descriptionHay = description.toLowerCase();
  const hay = `${titleHay} ${descriptionHay}`;
  const sourcePhrase = [title, seriesRaw].filter(Boolean).join(' | ');
  const out = [];
  const add = (fieldPath, value1, operator = 'EQ') => {
    if (out.some((c) => c.fieldPath === fieldPath)) return;
    out.push({
      fieldPath,
      operator,
      valueType: 'CODE',
      value1,
      normalizedValue: value1.toLowerCase(),
      sourcePhrase,
    });
  };

  if (entityType === 'door') {
    let core = null;
    if (/temperature[- ]?rise|\btemp(?:erature)?\s*rise\b/.test(titleHay)) core = 'temperature rise';
    else if (/polyurethane/.test(titleHay)) core = 'polyurethane';
    else if (/polystyrene|foam core/.test(titleHay)) core = 'polystyrene';
    else if (/steel[- ]?stiffen/.test(titleHay)) core = 'steel stiffened';
    else if (/fiberglass/.test(titleHay)) core = 'fiberglass';
    else if (/honeycomb|glued core/.test(titleHay)) core = 'Honeycomb';
    else if (/^(HP|HPF|CHP|EP|EPF)$/.test(series)) core = 'polystyrene';
    else if (/^(HT|HTF|CHT)$/.test(series)) core = 'polyurethane';
    else if (/^(HR|HRF|CHR)$/.test(series)) core = 'temperature rise';
    else if (/^(LW|LWF|C)$/.test(series)) core = 'steel stiffened';
    else if (/^(H|HF|CH|EH|EHF)$/.test(series)) core = 'Honeycomb';
    else if (/^(RI|HC|HCSS)$/.test(series)) core = 'Honeycomb';
    else if (/^(LP|PS|PSSS)$/.test(series)) core = 'polystyrene';
    else if (/^(PU|PUSS)$/.test(series)) core = 'polyurethane';
    else if (/^(MS|ST|STSS)$/.test(series)) core = 'steel stiffened';
    else if (/^TR$/.test(series)) core = 'temperature rise';
    else if (/temperature[- ]?rise|\btemp(?:erature)?\s*rise\b/.test(descriptionHay)) core = 'temperature rise';
    else if (/polyurethane/.test(descriptionHay)) core = 'polyurethane';
    else if (/polystyrene|foam core/.test(descriptionHay)) core = 'polystyrene';
    else if (/steel[- ]?stiffen/.test(descriptionHay)) core = 'steel stiffened';
    else if (/fiberglass/.test(descriptionHay)) core = 'fiberglass';
    else if (/honeycomb|glued core/.test(descriptionHay)) core = 'Honeycomb';

    let edge = null;
    if (/continuous(?:ly)?[- ]?weld|continuous throat weld/.test(titleHay)) {
      edge = 'continuous weld';
    } else if (/seamless|tack[- ]?and[- ]?fill|tack[- ]?fill/.test(titleHay)) {
      edge = 'seamless tack-and-fill';
    } else if (/emboss/.test(titleHay)) {
      edge = 'embossed';
    } else if (/lock[- ]?seam/.test(titleHay)) {
      edge = 'Lockseam';
    } else if (/^(CH|CHP|CHT|CHR|C)$/.test(series)) {
      edge = 'continuous weld';
    } else if (/^(EH|EHF|EP|EPF)$/.test(series)) {
      edge = 'embossed';
    } else if (/^(HF|HPF|HTF|HRF|LWF)$/.test(series)) {
      edge = 'seamless tack-and-fill';
    } else if (/^(H|HP|HT|HR|LW)$/.test(series)) {
      edge = 'Lockseam';
    } else if (/^(RI|LP|MS|HC|HCSS|PS|PSSS|PU|PUSS|ST|STSS|TR)$/.test(series)) {
      edge = 'Lockseam';
    } else if (/continuous(?:ly)?[- ]?weld|continuous throat weld/.test(descriptionHay)) {
      edge = 'continuous weld';
    } else if (/seamless|tack[- ]?and[- ]?fill|tack[- ]?fill/.test(descriptionHay)) {
      edge = 'seamless tack-and-fill';
    } else if (/emboss/.test(descriptionHay)) {
      edge = 'embossed';
    } else if (/lock[- ]?seam/.test(descriptionHay)) {
      edge = 'Lockseam';
    }

    if (core) add('door.core_type', core);
    if (edge) add('door.edge_seam_construction', edge);
  }

  if (entityType === 'frame') {
    if (/drywall|steel stud|wood stud/.test(hay)) {
      add('opening.wall_construction', 'steel stud|wood stud|drywall', 'IN');
    } else if (/masonry|mason(?:ry)? wall/.test(hay)) {
      add('opening.wall_construction', 'masonry');
    } else if (/^(F|SR|SQ|SU)$/.test(series)) {
      add('opening.wall_construction', 'masonry');
    } else if (/^(DW|DR|DQ|DU|BQ|BU|BR)$/.test(series)) {
      add('opening.wall_construction', 'steel stud|wood stud|drywall', 'IN');
    }

    if (/\bknock[- ]?down\b|\bkd\b/.test(hay)) add('frame.assembly_welding', 'KD');
    else if (/continuous throat weld|\bcw\b/.test(hay)) add('frame.assembly_welding', 'CW continuous throat weld');
    else if (/face[- ]?weld|\bfw\b/.test(hay)) add('frame.assembly_welding', 'FW setup and face weld');
  }

  return out;
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

  const parseListedDimension = (raw, max) => {
    const values = String(raw ?? '')
      .split(/[,/&]/)
      .map((part) => plausible(feetInchesToInches(part.trim()), max))
      .filter((value) => value != null);
    return values.length > 0 ? Math.max(...values) : null;
  };

  // Explicit width x height.
  if (/[x×]/i.test(s)) {
    const parts = s.split(/\s*[x×]\s*/i);
    return {
      width: parseListedDimension(parts[0], MAX_NOMINAL_WIDTH_IN),
      height: parseListedDimension(parts[1], MAX_NOMINAL_HEIGHT_IN),
    };
  }

  // Extracted door grids commonly serialize the width choices and height as
  // separate pipe-delimited row headers:
  //   "2-6, 2-8, 2-10, 3-0 | 7' 0\""
  // Treat the widest listed width as the inclusive width bound and the largest
  // listed height as the inclusive height bound. Without this branch the old
  // parser consumed only the final width and silently dropped the height.
  if (s.includes('|')) {
    const parts = s.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const width = parseListedDimension(parts[0], MAX_NOMINAL_WIDTH_IN);
      const height = parseListedDimension(parts[1], MAX_NOMINAL_HEIGHT_IN);
      if (width != null || height != null) return { width, height };
    }
  }

  // Compact concatenated size code (no separator): "2070" -> 24 x 84.
  const compact = decodeCompactSizeCode(s);
  if (compact) return compact;

  // Single feet-inches dimension ("3-0", "20-0", "2-0, 2-4").
  if (/\d\s*[-'’]\s*\d/.test(s)) {
    return { width: parseListedDimension(s, MAX_NOMINAL_WIDTH_IN), height: null };
  }

  // Not a recognizable dimension (bare number, 3/5-digit shortcut, junk).
  return { width: null, height: null };
}

/**
 * Parse a "Complete … Frame Unit" row label into the door HEIGHT and opening
 * TYPE the row prices, e.g.:
 *   "7-0 SINGLE OPENING (3S) 2-6, 2-8, 2-10, 3-0 | 16 GAGE …"  -> { heightIn:84, openingType:'3S' }
 *   "6-8 | PAIR OPENING (3P) | 6-8, 7-0, … | 18 GAGE …"        -> { heightIn:80, openingType:'3P' }
 *   "7-10 & 8-0 | SINGLE OPENING (3S) | 2-0, 2-4 | …"          -> { heightIn:96, openingType:'3S' }
 * The leading token is the door height (a combined "7-10 & 8-0" row uses the
 * larger height as the LTE bound). Returns nulls when the row is not a complete
 * opening row (so component/option rows are unaffected).
 *
 * @param {string} label
 * @returns {{ heightIn: number|null, openingType: '3S'|'3P'|null }}
 */
export function parseFrameOpeningRow(label) {
  const s = String(label ?? '').trim();
  const m = s.match(/^\s*([0-9]+\s*[-'’]\s*[0-9]+(?:\s*&\s*[0-9]+\s*[-'’]\s*[0-9]+)?)\s*\|?\s*(single|pair)\s+opening/i);
  if (!m) return { heightIn: null, openingType: null };
  const heights = m[1].split('&').map((t) => feetInchesToInches(t.trim())).filter((n) => n != null);
  const heightIn = heights.length ? plausible(Math.max(...heights), MAX_NOMINAL_HEIGHT_IN) : null;
  const openingType = /single/i.test(m[2]) ? '3S' : '3P';
  return { heightIn, openingType };
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

  // Frame COMPONENT/PART tables (heads & jambs, mullions, sill components, stick
  // jambs) are NOT complete frames. They must never compile as a base/size matrix
  // (their part prices — e.g. a $44 head — would otherwise compete as a full-frame
  // base price). Route them to the adder list so they price as options, never base.
  // "Complete … Frame Units" tables do NOT match these patterns and stay base.
  if (/component part|heads?\s*&?\s*jambs?|headers?\s*&?\s*jambs?|mullion|sill component|stick jamb/.test(hay)) {
    return 'code_adder_list';
  }

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
      return { series: 'door.door_series_construction', core: 'door.core_type', edge: 'door.edge_seam_construction', gauge: 'door.door_gauge', material: 'door.door_material', width: 'door.nominal_door_width', height: 'door.nominal_door_height', depth: null };
    case 'frame':
      return { series: 'frame.frame_series', gauge: 'frame.frame_gauge', material: 'frame.frame_material', width: 'frame.nominal_frame_width', height: 'frame.nominal_frame_height', depth: 'frame.jamb_depth', type: 'frame.frame_type', wall: 'opening.wall_construction', assembly: 'frame.assembly_welding' };
    case 'panel':
      return { series: 'panel.panel_construction_series', gauge: 'panel.panel_gauge', material: 'panel.panel_material', width: 'panel.panel_width', height: 'panel.panel_height', depth: null };
    default:
      return { series: 'opening.nominal_opening_width', gauge: null, material: null, width: 'opening.nominal_opening_width', height: 'opening.nominal_opening_height', depth: null };
  }
}
