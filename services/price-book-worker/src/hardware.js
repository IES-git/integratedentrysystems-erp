// Phase 2b — Hardware catalog source-specific parser.
//
// Hardware.xlsx is NOT a Pioneer rule book; it is a ~497-row cost/catalog dump
// whose VISIBLE HEADERS DO NOT MATCH actual usage and whose bottom block is a
// taxonomy, not data. So we drive parsing off the integration workbook's
// authoritative Source Column Map (fixed column LETTERS, not headers) rather
// than the Pioneer rule compiler.
//
// Source Column Map (authoritative meanings):
//   A=category  B=family/brand abbr  C=quote qty/notes  D=internal group
//   E=primary description  F-M=category-specific attributes (K=finish)
//   N/O=proposed sell (only ~18 rows)  Q=vendor  R=vendor part #
//   S=discount/cost multiplier  T=list  U=net  V=extended net
//   W-Z=GM (recompute, DO NOT import)  AA-AC=dates/notes/urls
//   Rows 500-519 = quote notes/spec conflicts -> dependency rules (not products)
//   Rows 521-577 = taxonomy block -> taxonomy only (never products)
//
// Pipeline: classify each row -> normalize vendor/finish/category -> recompute
// canonical net (list x multiplier), queue ~18% that don't reconcile within 1%
// -> build hardware_product / hardware_variant / hardware_attribute (EAV) /
// hardware_price in a hardware_price_book revision (alternates = variants, not
// duplicates) -> TABLE vs CALC (linear_hardware_rule for weatherstrip/sweeps/
// thresholds/kick plates). Everything lands UNREVIEWED behind proposals.

import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { ensureDraftDocument } from './compile.js';
import { identifyPriceBookProfile } from './profiles.js';

const BUCKET = 'price-book-files';

const C = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12, N: 13, O: 14, Q: 16, R: 17, S: 18, T: 19, U: 20, V: 21, AA: 26, AB: 27, AC: 28 };

// Vendor abbreviation -> canonical manufacturer name.
const VENDOR_ALIASES = {
  phi: 'Precision', precision: 'Precision',
  vd: 'Von Duprin', vonduprin: 'Von Duprin',
  lcn: 'LCN', sar: 'Sargent', sargent: 'Sargent',
  dor: 'Dorma', dorma: 'Dorma', dormakaba: 'Dorma',
  ngp: 'NGP', abh: 'ABH', dj: 'Don-Jo', donjo: 'Don-Jo',
  rw: 'Rockwood', rockwood: 'Rockwood',
  dh: 'Design Hardware', best: 'BEST', seclock: 'SecLock',
  sch: 'Schlage', schlage: 'Schlage', cor: 'Corbin Russwin', yale: 'Yale',
  pem: 'Pemko', pemko: 'Pemko', zero: 'Zero International',
};

// Common BHMA finish normalization (US code -> 6xx number).
const FINISH_ALIASES = {
  us3: '605', us4: '606', us10: '612', us10b: '613', us15: '619',
  us26: '625', us26d: '626', us28: '628', us32: '629', us32d: '630',
  usp: '600', prime: '600', primecoat: '600', aluminum: '628', alum: '628',
};

// Canonical hardware categories (matches the seeded controlled dictionary).
const CATEGORY_KEYWORDS = [
  ['Continuous hinges', /continuous hinge|geared hinge|conh/i],
  ['Electric hinges / EPT / loops', /electric hinge|\bept\b|power transfer|elec.*loop|electrified hinge/i],
  ['Butt hinges', /\bhinge\b|butt hinge|\bbb\b\d/i],
  ['Closers and arms', /closer|door control|\barm\b/i],
  ['Exit devices', /exit device|panic|rim device|vertical rod|mortise exit|\bcvr\b|\bsvr\b/i],
  ['Exit trim / pulls', /exit trim|device trim|night latch|dummy trim/i],
  // NOTE: avoid a bare /\block\b/ here — it greedily swallowed "MAG LOCK"
  // (access control) and "...LATCH PROTECTOR : CYLINDRICAL LOCK". Match real
  // locking devices by their specific device words instead.
  ['Cylindrical/mortise locks and deadbolts', /lockset|cylindrical lock|cylindrical lever|mortise lock|deadbolt|deadlock|multilatch|key.?in.?lever/i],
  ['Inactive-leaf hardware', /flush bolt|auto bolt|coordinator|astragal|inactive leaf|\bfb\b|\bafb\b/i],
  ['Lite kits and louvers', /lite kit|louver|vision kit|glass kit/i],
  ['Weather seals', /weather|gasket|seal|sweep|smoke seal|astragal seal|perimeter/i],
  ['Thresholds', /threshold|saddle/i],
  ['Protection/accessories', /kick plate|armor plate|mop plate|protection|protector|latch protector|push plate|pull plate|\bstop\b|holder|silencer|viewer/i],
  ['Keying', /keying|key blank|core\b|sfic|key cylinder|master key/i],
  ['Access control', /access control|reader|maglock|mag lock|electric strike|\bestk\b|power supply|controller|rex\b|credential/i],
];

// Exact raw-category (column A) abbreviations the source uses -> canonical
// dictionary code. Matched on the raw category ONLY (not the description) so a
// generic word like "trim" never greedily recategorizes a lock/closer row.
const RAW_CATEGORY_ALIASES = {
  'trim': 'Exit trim / pulls',
  'int pull': 'Exit trim / pulls',
  'hinges': 'Butt hinges',
  'c_hinges': 'Continuous hinges',
  'e_hinge': 'Electric hinges / EPT / loops',
  'surf bolt': 'Inactive-leaf hardware',
  'hdw mull': 'Exit devices',
  'h/m acc.': 'Protection/accessories',
  'acc control': 'Access control',
  'drip': 'Weather seals',
  'shoe': 'Weather seals',
  'thold': 'Thresholds',
};

// Categories priced by length/area (CALC) -> linear_hardware_rule.
const LINEAR_CATEGORIES = new Set(['Weather seals', 'Thresholds']);

// Per-category attribute label maps for columns F..M (K is always finish).
const ATTR_MAPS = {
  'Butt hinges': ['size', 'weight', 'bearing', 'material', 'corner_radius', 'finish', 'quantity', 'rating'],
  'Continuous hinges': ['series', 'length', 'mounting', 'material', 'clearance', 'finish', 'hand', 'rating'],
  'Closers and arms': ['series', 'arm_type', 'hold_open', 'mounting', 'handedness', 'finish', 'size', 'rating'],
  'Cylindrical/mortise locks and deadbolts': ['lock_type', 'function', 'backset', 'trim', 'cylinder_core', 'finish', 'keyway', 'grade'],
  'Exit devices': ['device_type', 'length', 'dogging', 'electrification', 'rating', 'finish', 'hand', 'trim'],
  'Exit trim / pulls': ['device_series', 'function', 'cylinder', 'lever_style', 'hand', 'finish', 'material', 'notes'],
  'Thresholds': ['profile', 'width', 'height', 'ada', 'length', 'finish', 'undercut', 'stop_notch'],
  'Weather seals': ['profile', 'material', 'mounting', 'length', 'rating', 'finish', 'color', 'notes'],
  'Access control': ['device_type', 'voltage', 'current', 'fail_mode', 'monitoring', 'finish', 'protocol', 'enclosure'],
  'Protection/accessories': ['width', 'height', 'gauge', 'material', 'mounting', 'finish', 'cylinder_holes', 'notes'],
};
const DEFAULT_ATTRS = ['attr_f', 'attr_g', 'attr_h', 'attr_i', 'attr_j', 'finish', 'attr_l', 'attr_m'];

function cell(row, idx) {
  const v = row?.[idx];
  if (v === null || v === undefined) return null;
  const s = typeof v === 'number' ? v : String(v).trim();
  return s === '' ? null : s;
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}
function normVendor(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().replace(/[^a-z]/g, '');
  return VENDOR_ALIASES[key] ?? String(raw).trim();
}
function normFinish(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
  return FINISH_ALIASES[key] ?? String(raw).trim();
}
// Stored category identity is the snake_case slug (matches the builder `HW`
// constants, `hardware_set_item` templates, and the engine selection key). The
// internal `category` stays title-case for ATTR_MAPS / LINEAR_CATEGORIES logic.
function slugifyCategory(category) {
  return String(category ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normCategory(rawCat, description) {
  // 1. Exact raw-category alias (abbreviations like "trim", "thold", "drip").
  const rawKey = String(rawCat ?? '').trim().toLowerCase();
  if (RAW_CATEGORY_ALIASES[rawKey]) return RAW_CATEGORY_ALIASES[rawKey];
  // 2. Keyword match on the raw category + description.
  const hay = `${rawCat ?? ''} ${description ?? ''}`;
  for (const [canonical, re] of CATEGORY_KEYWORDS) {
    if (re.test(hay)) return canonical;
  }
  return rawCat ? String(rawCat).trim() : 'Protection/accessories';
}

/**
 * Classify a worksheet row by its absolute (1-based) row number and contents.
 * Only 'product' rows enter the catalog; 'note' rows (incl. 500-519) become
 * dependency rules; 'taxonomy' (incl. 521-577) and 'summary'/'blank' are skipped.
 */
function classifyRow(row, absRow) {
  const desc = cell(row, C.E);
  const cat = cell(row, C.A);
  const list = num(cell(row, C.T));
  const net = num(cell(row, C.U));
  const vendor = cell(row, C.Q);
  const noteText = cell(row, C.C);

  const nonEmpty = (row ?? []).some((v) => v !== null && v !== undefined && String(v).trim() !== '');
  if (!nonEmpty) return { kind: 'blank' };

  // Authoritative row-range carve-outs from the integration workbook.
  if (absRow >= 521 && absRow <= 577) return { kind: 'taxonomy' };
  if (absRow >= 500 && absRow <= 519) return { kind: 'note', text: desc ?? noteText ?? cat };

  // Summary / subtotal rows: total-ish text or only an extended-net figure.
  if (desc && /\b(total|subtotal|sum|grand total)\b/i.test(desc)) return { kind: 'summary' };
  if (!desc && !list && !net && !vendor && num(cell(row, C.V)) != null) return { kind: 'summary' };

  // A product needs a description and some commercial anchor (price or vendor).
  if (desc && (list != null || net != null || vendor)) return { kind: 'product' };

  // Text-only rows with conflict/spec language are notes.
  if ((desc || noteText) && /requires|exclude|only|must|conflict|verify|note:/i.test(`${desc ?? ''} ${noteText ?? ''}`)) {
    return { kind: 'note', text: desc ?? noteText };
  }
  return { kind: 'blank' };
}

/** Build the EAV attribute list for a product row given its canonical category. */
function buildAttributes(category, row) {
  const labels = ATTR_MAPS[category] ?? DEFAULT_ATTRS;
  const cols = [C.F, C.G, C.H, C.I, C.J, C.K, C.L, C.M];
  const out = [];
  for (let i = 0; i < cols.length; i++) {
    const raw = cell(row, cols[i]);
    if (raw == null) continue;
    const name = labels[i] ?? DEFAULT_ATTRS[i];
    const value = name === 'finish' ? normFinish(raw) : String(raw);
    out.push({ name, value, source: String(raw) });
  }
  return out;
}

function attrLookup(attrs, name) {
  return attrs.find((a) => a.name === name)?.value ?? null;
}

/** Stable product grouping key: internal group (col D) wins; else cat+mfr+desc head. */
function productKey(category, manufacturer, internalGroup, description) {
  if (internalGroup) return `D:${internalGroup}`;
  const head = String(description ?? '').toLowerCase().split(/\s+/).slice(0, 4).join(' ');
  return `${category}|${manufacturer ?? ''}|${head}`;
}

/** Read one normalized-master sheet using the first row containing `keyHeader`. */
function readNormalizedSheet(wb, sheetName, keyHeader) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
  const headerIndex = aoa.findIndex((row) =>
    (row ?? []).some((value) => String(value ?? '').trim() === keyHeader));
  if (headerIndex < 0) return [];
  const headers = (aoa[headerIndex] ?? []).map((value) => String(value ?? '').trim());
  return aoa.slice(headerIndex + 1).flatMap((row) => {
    const out = {};
    let nonBlank = false;
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      if (!key) continue;
      const value = row?.[i] ?? null;
      out[key] = value;
      if (value !== null && value !== undefined && String(value).trim() !== '') nonBlank = true;
    }
    return nonBlank ? [out] : [];
  });
}

/** True for Hardware_Normalized_Ingestion_Master.xlsx, not the old raw dump. */
export function isNormalizedHardwareWorkbook(wb) {
  const required = ['Product Master', 'Price Records', 'Ingestion View', 'Product Attributes', 'Prep Crosswalk'];
  return required.every((name) => wb.SheetNames.includes(name));
}

function normalizedText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && text.toLowerCase() !== 'unknown' ? text : null;
}

function normalizedBool(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(text)) return true;
  if (['false', 'no', 'n', '0'].includes(text)) return false;
  return null;
}

function normalizedConfidence(value) {
  switch (String(value ?? '').trim().toUpperCase()) {
    case 'HIGH': return 0.95;
    case 'MEDIUM': return 0.75;
    case 'SOURCE': return 0.7;
    case 'LOW': return 0.4;
    default: return 0.6;
  }
}

function normalizedUom(value) {
  const text = String(value ?? 'EA').trim().toUpperCase();
  if (text === 'EA' || text === 'EACH') return 'EACH';
  if (text === 'LF' || text === 'FT' || text === 'FOOT') return 'FT';
  return text || 'EACH';
}

function positiveNumber(value) {
  const parsed = num(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

export function normalizedPriceReviewStatus(product, price, importReady = null) {
  const ready = String(product?.import_status ?? '').trim().toUpperCase() === 'READY';
  const priced = String(price?.price_status ?? '').trim().toUpperCase() === 'PRICED';
  const conflict = normalizedBool(price?.conflict_flag) === true;
  const net = positiveNumber(price?.recommended_net_unit) ?? positiveNumber(price?.computed_net_unit);
  const approvedByWorkbook = importReady == null
    ? ready && priced && !conflict
    : importReady === true && !conflict;
  return approvedByWorkbook && net != null ? 'APPROVED' : 'NEEDS_REVIEW';
}

/** Pure preflight summary used by tests and operator tooling before DB writes. */
export function summarizeNormalizedHardwareWorkbook(wb) {
  if (!isNormalizedHardwareWorkbook(wb)) {
    return { valid: false, errors: ['Required normalized hardware sheets are missing.'] };
  }
  const products = readNormalizedSheet(wb, 'Product Master', 'product_id');
  const prices = readNormalizedSheet(wb, 'Price Records', 'price_id');
  const ingestionRows = readNormalizedSheet(wb, 'Ingestion View', 'import_ready');
  const attributes = readNormalizedSheet(wb, 'Product Attributes', 'attribute_id');
  const prepCrosswalk = readNormalizedSheet(wb, 'Prep Crosswalk', 'subcategory_id');
  const qaRows = readNormalizedSheet(wb, 'QA Issues', 'issue_id');
  const productById = new Map(products.map((row) => [normalizedText(row.product_id), row]));
  const importReadyByPriceId = new Map(
    ingestionRows.map((row) => [normalizedText(row.price_id), normalizedBool(row.import_ready) === true]),
  );
  let approvedPrices = 0;
  let reviewPrices = 0;
  for (const price of prices) {
    const status = normalizedPriceReviewStatus(
      productById.get(normalizedText(price.product_id)),
      price,
      importReadyByPriceId.get(normalizedText(price.price_id)) ?? false,
    );
    if (status === 'APPROVED') approvedPrices++;
    else reviewPrices++;
  }
  const errors = [];
  if (products.length === 0) errors.push('Product Master contains no product rows.');
  if (prices.length === 0) errors.push('Price Records contains no price rows.');
  if (prepCrosswalk.length === 0) errors.push('Prep Crosswalk contains no mapping rows.');
  return {
    valid: errors.length === 0,
    errors,
    products: products.length,
    prices: prices.length,
    approvedPrices,
    reviewPrices,
    attributes: attributes.length,
    prepCrosswalk: prepCrosswalk.length,
    workbookQaIssues: qaRows.length,
  };
}

async function insertChunks(sb, table, rows, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

/**
 * Deterministic importer for Hardware_Normalized_Ingestion_Master.xlsx.
 *
 * The workbook is an authoritative full catalog snapshot, so importing it
 * replaces the prior shared hardware catalog. READY/PRICED rows become approved
 * prices; REVIEW, UNPRICED, conflicts, and non-positive prices remain explicit
 * NEEDS_REVIEW rows and never silently become zero.
 */
async function runIngestNormalizedHardware(sb, book, wb) {
  const products = readNormalizedSheet(wb, 'Product Master', 'product_id');
  const prices = readNormalizedSheet(wb, 'Price Records', 'price_id');
  const ingestionRows = readNormalizedSheet(wb, 'Ingestion View', 'import_ready');
  const attributes = readNormalizedSheet(wb, 'Product Attributes', 'attribute_id');
  const prepCrosswalk = readNormalizedSheet(wb, 'Prep Crosswalk', 'subcategory_id');
  const qaRows = readNormalizedSheet(wb, 'QA Issues', 'issue_id');

  if (products.length === 0 || prices.length === 0) {
    throw new Error('Normalized hardware workbook is missing Product Master or Price Records data.');
  }

  const documentId = await ensureDraftDocument(sb, book);

  // Full-master replacement. FKs on estimate/linear rows are SET NULL by the
  // schema, matching the existing normalized-master reseed migration.
  await sb.from('linear_hardware_rule').delete().not('id', 'is', null);
  await sb.from('hardware_product').delete().not('id', 'is', null);
  await sb.from('hardware_price_book').delete().not('id', 'is', null);
  await sb.from('hardware_prep_crosswalk').delete().not('id', 'is', null);

  const { data: hpb, error: hpbErr } = await sb.from('hardware_price_book').insert({
    supplier_id: book.company_id ?? null,
    supplier_name: 'Mixed (normalized)',
    title: book.name || 'Hardware Normalized Ingestion Master',
    effective_date: book.effective_date ?? null,
    source_file: book.original_file_name ?? book.source_file_url,
    review_status: 'UNREVIEWED',
  }).select('id').single();
  if (hpbErr || !hpb) throw new Error(`hardware_price_book insert failed: ${hpbErr?.message}`);

  const productBySourceId = new Map();
  const productRowBySourceId = new Map();
  const variantBySourceId = new Map();
  const importReadyByPriceId = new Map(
    ingestionRows.map((row) => [normalizedText(row.price_id), normalizedBool(row.import_ready) === true]),
  );
  const counts = {
    products: 0,
    variants: 0,
    attributes: 0,
    prices: 0,
    approvedPrices: 0,
    reviewPrices: 0,
    prepCrosswalk: 0,
    linearRules: 0,
    workbookQaIssues: qaRows.length,
  };

  for (const product of products) {
    const sourceId = normalizedText(product.product_id);
    if (!sourceId) continue;
    const { data: inserted, error } = await sb.from('hardware_product').insert({
      category: normalizedText(product.category_id) ?? 'unclassified',
      subcategory: normalizedText(product.subcategory_id),
      manufacturer_id: null,
      manufacturer_name: normalizedText(product.manufacturer_or_brand),
      product_family: normalizedText(product.category_name),
      model: normalizedText(product.part_number) ??
        normalizedText(product.manufacturer_number) ??
        normalizedText(product.customer_part_number),
      description: normalizedText(product.description) ?? sourceId,
      active: true,
      source_row_ref: sourceId,
      source_confidence: normalizedConfidence(product.data_confidence),
    }).select('id').single();
    if (error || !inserted) throw new Error(`hardware_product insert failed (${sourceId}): ${error?.message}`);
    productBySourceId.set(sourceId, inserted.id);
    productRowBySourceId.set(sourceId, product);
    counts.products++;

    const ratingParts = [
      normalizedText(product.rating_text),
      normalizedBool(product.fire_rated) ? 'Fire rated' : null,
      normalizedBool(product.wind_rated) ? 'Wind rated' : null,
    ].filter(Boolean);
    const { data: variant, error: variantError } = await sb.from('hardware_variant').insert({
      hardware_product_id: inserted.id,
      sku: normalizedText(product.part_number) ??
        normalizedText(product.manufacturer_number) ??
        normalizedText(product.customer_part_number),
      function: normalizedText(product.function),
      finish: normalizedText(product.finish_code) ?? normalizedText(product.finish_description),
      size: normalizedText(product.size_text),
      hand: normalizedText(product.handing),
      voltage: normalizedText(product.voltage),
      rating: ratingParts.length > 0 ? [...new Set(ratingParts)].join('; ') : null,
      material: normalizedText(product.material),
      option_attributes: {
        normalized_product_id: sourceId,
        import_status: normalizedText(product.import_status),
        width_in: num(product.width_in),
        height_in: num(product.height_in),
        duty_grade: normalizedText(product.duty_grade),
        default_price_basis: normalizedText(product.default_price_basis),
        pioneer_door_prep_family: normalizedText(product.pioneer_door_prep_family),
        pioneer_frame_prep_family: normalizedText(product.pioneer_frame_prep_family),
        template_required: normalizedText(product.template_required),
        canonical_key: normalizedText(product.canonical_key),
      },
    }).select('id').single();
    if (variantError || !variant) throw new Error(`hardware_variant insert failed (${sourceId}): ${variantError?.message}`);
    variantBySourceId.set(sourceId, variant.id);
    counts.variants++;
  }

  const attributeRows = [];
  for (const attribute of attributes) {
    const sourceId = normalizedText(attribute.product_id);
    const productId = sourceId ? productBySourceId.get(sourceId) : null;
    const variantId = sourceId ? variantBySourceId.get(sourceId) : null;
    const name = normalizedText(attribute.attribute_name);
    const value = normalizedText(attribute.attribute_value);
    if (!productId || !name || value == null) continue;
    attributeRows.push({
      hardware_product_id: productId,
      hardware_variant_id: variantId ?? null,
      attr_name: name,
      attr_value: value,
      attr_unit: normalizedText(attribute.unit),
      source_text: `Hardware normalized master row ${attribute.source_row ?? ''}`.trim(),
    });
  }
  await insertChunks(sb, 'hardware_attribute', attributeRows);
  counts.attributes = attributeRows.length;

  const priceRows = [];
  for (const price of prices) {
    const sourceId = normalizedText(price.product_id);
    const variantId = sourceId ? variantBySourceId.get(sourceId) : null;
    if (!variantId) continue;
    const product = productRowBySourceId.get(sourceId);
    const reviewStatus = normalizedPriceReviewStatus(
      product,
      price,
      importReadyByPriceId.get(normalizedText(price.price_id)) ?? false,
    );
    const net = positiveNumber(price.recommended_net_unit) ?? positiveNumber(price.computed_net_unit);
    priceRows.push({
      hardware_variant_id: variantId,
      hardware_price_book_id: hpb.id,
      list_price: num(price.list_unit_price),
      discount_multiplier: num(price.discount_multiplier),
      net_cost: net,
      uom: normalizedUom(price.uom),
      effective_from: book.effective_date ?? null,
      minimum_quantity: positiveNumber(price.price_quantity),
      source_row_ref: normalizedText(price.price_id) ?? normalizedText(price.source_row),
      review_status: reviewStatus,
    });
    if (reviewStatus === 'APPROVED') counts.approvedPrices++;
    else counts.reviewPrices++;
  }
  await insertChunks(sb, 'hardware_price', priceRows);
  counts.prices = priceRows.length;

  const crosswalkRows = prepCrosswalk.flatMap((row) => {
    const subcategory = normalizedText(row.subcategory_id);
    if (!subcategory) return [];
    const noPrep = (value) => {
      const text = normalizedText(value);
      return text && !/^(none|n\/?a|not applicable)$/i.test(text) ? text : null;
    };
    return [{
      hardware_category: subcategory,
      door_prep_code: noPrep(row.door_prep),
      frame_prep_code: noPrep(row.frame_prep),
      additional_required_fields: normalizedText(row.validation_rule),
      pricing_behavior: normalizedText(row.pricing_behavior),
      notes: normalizedText(row.selection_cue),
    }];
  });
  await insertChunks(sb, 'hardware_prep_crosswalk', crosswalkRows);
  counts.prepCrosswalk = crosswalkRows.length;

  const { error: linearError } = await sb.from('linear_hardware_rule').insert([
    {
      hardware_category: 'weather_seals',
      length_basis: 'head_plus_jambs',
      cut_increment: null,
      waste_pct: 10,
      minimum_length: null,
      per_foot_price: null,
      hardware_variant_id: null,
    },
    {
      hardware_category: 'thresholds',
      length_basis: 'width',
      cut_increment: null,
      waste_pct: 0,
      minimum_length: null,
      per_foot_price: null,
      hardware_variant_id: null,
    },
  ]);
  if (linearError) throw new Error(`linear_hardware_rule insert failed: ${linearError.message}`);
  counts.linearRules = 2;

  await sb.from('pricing_change_proposals').insert({
    proposal_type: 'hardware_product',
    source: 'ingestion',
    price_book_id: book.id,
    price_book_document_id: documentId,
    target_ids: { hardwarePriceBookId: hpb.id, normalizedMaster: true },
    payload: { ...counts, hardwarePriceBookId: hpb.id },
    confidence: 0.98,
    explanation: `Normalized hardware master ingested: ${counts.products} products/variants, ${counts.prices} price observations (${counts.approvedPrices} approved, ${counts.reviewPrices} review), ${counts.attributes} attributes, and ${counts.prepCrosswalk} prep crosswalk rows. Workbook QA queue contains ${counts.workbookQaIssues} issue rows.`,
    status: 'pending',
  });

  await sb.from('price_books').update({
    ocr_status: 'done',
    ocr_error: null,
    extract_status: 'done',
    extracted_at: new Date().toISOString(),
    extract_total: counts.products + counts.prices,
    extract_done: counts.products + counts.prices,
    extract_failed: counts.reviewPrices,
  }).eq('id', book.id);

  console.log(`[hardware-normalized] ${book.id}:`, JSON.stringify(counts));
  return { hardwarePriceBookId: hpb.id, priceBookDocumentId: documentId, normalizedMaster: true, ...counts };
}

/**
 * Ingest a hardware catalog workbook (uploaded as a price_books row) into the
 * canonical hardware tables. Returns ingestion counts. Idempotent per book:
 * re-running creates a NEW hardware_price_book revision (versions are immutable).
 */
export async function runIngestHardware(sb, priceBookId) {
  const { data: book, error: bookErr } = await sb.from('price_books').select('*').eq('id', priceBookId).single();
  if (bookErr || !book) throw new Error('Price book not found');
  if (book.file_type !== 'xlsx' && book.file_type !== 'csv') {
    throw new Error('Hardware ingestion expects an XLSX/CSV catalog (Hardware.xlsx).');
  }

  await sb.from('price_books').update({ extract_status: 'processing', extract_error: null }).eq('id', priceBookId);

  // Download + parse the FIRST/largest sheet as raw array-of-arrays so absolute
  // row numbers are preserved (we key carve-outs off them).
  const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(book.source_file_url);
  if (dlErr || !blob) throw new Error('File download failed: ' + (dlErr?.message || 'no data'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const wb = book.file_type === 'csv'
    ? XLSX.read(new TextDecoder('utf-8', { fatal: false }).decode(bytes), { type: 'string', raw: false })
    : XLSX.read(bytes, { type: 'buffer', raw: false, cellDates: true });
  if (isNormalizedHardwareWorkbook(wb)) {
    const preflight = summarizeNormalizedHardwareWorkbook(wb);
    if (!preflight.valid) {
      throw new Error(`Normalized hardware workbook preflight failed: ${preflight.errors.join(' ')}`);
    }
    const profile = identifyPriceBookProfile({
      sha256: sourceSha256,
      fileName: book.original_file_name,
      title: book.name,
    });
    Object.assign(book, {
      source_sha256: sourceSha256,
      source_page_count: null,
      ingestion_profile_key: profile?.key ?? null,
      ingestion_profile_version: profile?.version ?? null,
      ingestion_coverage: { passed: true, ...preflight },
    });
    await sb.from('price_books').update({
      source_sha256: sourceSha256,
      source_page_count: null,
      ingestion_profile_key: profile?.key ?? null,
      ingestion_profile_version: profile?.version ?? null,
      ingestion_coverage: { passed: true, ...preflight },
    }).eq('id', priceBookId);
    return runIngestNormalizedHardware(sb, book, wb);
  }
  await sb.from('price_books').update({ source_sha256: sourceSha256 }).eq('id', priceBookId);
  // Choose the sheet with the most rows (the catalog).
  let sheetName = wb.SheetNames[0];
  let aoa = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, blankrows: true });
    if (rows.length > aoa.length) { aoa = rows; sheetName = name; }
  }
  if (aoa.length === 0) throw new Error('Could not read any rows from the hardware workbook.');

  // Detect the header row (first row where col T or U is the literal price header,
  // else assume row 1). Data starts the row after.
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const joined = (aoa[i] ?? []).map((c) => String(c ?? '').toLowerCase()).join(' ');
    if (/list|net|description|category|vendor/.test(joined)) { headerRowIdx = i; break; }
  }
  const dataStart = headerRowIdx + 1;

  // Create the hardware price-book revision (immutable snapshot) + a draft
  // document for the dependency notes (rows 500-519).
  const { data: hpb, error: hpbErr } = await sb.from('hardware_price_book').insert({
    supplier_id: book.company_id ?? null,
    supplier_name: book.name,
    title: `${book.name} (${new Date().toISOString().slice(0, 10)})`,
    effective_date: book.effective_date ?? null,
    source_file: book.original_file_name ?? book.source_file_url,
    review_status: 'UNREVIEWED',
  }).select('id').single();
  if (hpbErr || !hpb) throw new Error(`hardware_price_book insert failed: ${hpbErr?.message}`);
  const priceBookRevisionId = hpb.id;

  const documentId = await ensureDraftDocument(sb, book);
  const { data: region } = await sb.from('source_region').insert({
    price_book_id: documentId, region_type: 'note', table_title: `${book.name} — hardware notes`,
  }).select('id').single();
  const regionId = region?.id ?? null;

  const productCache = new Map(); // productKey -> hardware_product.id
  const counts = { products: 0, variants: 0, prices: 0, linearRules: 0, notes: 0, mismatches: 0, skipped: 0, taxonomy: 0 };
  const mismatches = [];

  for (let i = dataStart; i < aoa.length; i++) {
    const absRow = i + 1; // 1-based spreadsheet row
    const row = aoa[i] ?? [];
    const cls = classifyRow(row, absRow);

    if (cls.kind === 'taxonomy') { counts.taxonomy++; continue; }
    if (cls.kind === 'blank' || cls.kind === 'summary') { counts.skipped++; continue; }

    if (cls.kind === 'note') {
      if (!cls.text) { counts.skipped++; continue; }
      await sb.from('dependency_rule').insert({
        price_book_id: documentId,
        trigger_conditions: { source: 'Hardware.xlsx', row: absRow },
        relationship_type: /exclude|cannot|not (allowed|available)/i.test(cls.text) ? 'EXCLUDES' : /requires|must/i.test(cls.text) ? 'REQUIRES' : 'WARNS',
        target_type: 'manual_quote',
        severity: 'WARNING',
        auto_apply_allowed: false,
        message_template: cls.text,
        source_region_id: regionId,
        priority: 100,
        review_status: 'UNREVIEWED',
      });
      counts.notes++;
      continue;
    }

    // ---- product row ----
    const description = cell(row, C.E);
    const rawCat = cell(row, C.A);
    const category = normCategory(rawCat, description);
    const brandAbbr = cell(row, C.B);
    const internalGroup = cell(row, C.D);
    const vendor = normVendor(cell(row, C.Q));
    const manufacturer = vendor ?? normVendor(brandAbbr) ?? null;
    const partNo = cell(row, C.R);
    const attrs = buildAttributes(category, row);

    const rawList = num(cell(row, C.T));
    const rawMultiplier = num(cell(row, C.S));
    const sourceNet = num(cell(row, C.U));
    // A net cost (or list) for a single piece of door hardware is positive and
    // not six-figures. Catalog rows occasionally drop a dollar value (the list
    // price, or an unrelated number) into the discount-multiplier column, which
    // makes list × m explode into list², negatives, or absurd costs.
    const MAX_NET = 100000;
    const sane = (n) => n != null && isFinite(n) && n > 0 && n <= MAX_NET;
    const list = sane(rawList) ? rawList : null;
    // A discount/cost multiplier must be a sane fraction (0 < m <= 3). Anything
    // larger is not a multiplier — ignore it rather than multiply by it.
    const multiplier = rawMultiplier != null && rawMultiplier > 0 && rawMultiplier <= 3 ? rawMultiplier : null;
    // Prefer list × sane-multiplier, then the row's own net, then bare list.
    // Keep only a positive, in-bounds result; otherwise leave net null + flag.
    const computed = list != null && multiplier != null ? Math.round(list * multiplier * 100) / 100 : null;
    const recomputedNet = [computed, sourceNet, list].find(sane) ?? null;
    // Net reconciliation: queue rows we couldn't trust (no usable net, the row's
    // own net disagrees >1%, or the multiplier was out of band and ignored).
    let netReconciled = true;
    if (recomputedNet == null) {
      netReconciled = false;
    } else if (sane(sourceNet) && Math.abs(recomputedNet - sourceNet) / sourceNet > 0.01) {
      netReconciled = false;
    } else if (rawMultiplier != null && multiplier == null) {
      netReconciled = false;
    }

    // Product (group alternate brands/models as variants, not duplicates).
    const key = productKey(category, manufacturer, internalGroup, description);
    let productId = productCache.get(key);
    if (!productId) {
      const { data: prod, error: prodErr } = await sb.from('hardware_product').insert({
        category: slugifyCategory(category),
        subcategory: rawCat ?? null,
        manufacturer_id: book.company_id ?? null,
        manufacturer_name: manufacturer,
        product_family: brandAbbr ?? null,
        model: internalGroup ?? (description ? description.split(/\s+/).slice(0, 3).join(' ') : null),
        description,
        active: true,
        source_row_ref: `${sheetName}!${absRow}`,
        source_confidence: netReconciled ? 0.8 : 0.4,
      }).select('id').single();
      if (prodErr) throw new Error(`hardware_product insert failed (row ${absRow}): ${prodErr.message}`);
      productId = prod.id;
      productCache.set(key, productId);
      counts.products++;
    }

    // Variant (this row's specific brand/finish/size/function combination).
    const { data: variant, error: varErr } = await sb.from('hardware_variant').insert({
      hardware_product_id: productId,
      sku: partNo,
      function: attrLookup(attrs, 'function') ?? attrLookup(attrs, 'lock_type') ?? attrLookup(attrs, 'device_type'),
      finish: attrLookup(attrs, 'finish'),
      size: attrLookup(attrs, 'size') ?? attrLookup(attrs, 'length'),
      hand: attrLookup(attrs, 'hand') ?? attrLookup(attrs, 'handedness'),
      voltage: attrLookup(attrs, 'voltage') ?? attrLookup(attrs, 'electrification'),
      rating: attrLookup(attrs, 'rating'),
      material: attrLookup(attrs, 'material'),
      option_attributes: { brand: brandAbbr ?? null, raw_category: rawCat ?? null, source_row: absRow },
    }).select('id').single();
    if (varErr) throw new Error(`hardware_variant insert failed (row ${absRow}): ${varErr.message}`);
    counts.variants++;

    // EAV attributes.
    if (attrs.length > 0) {
      await sb.from('hardware_attribute').insert(attrs.map((a) => ({
        hardware_variant_id: variant.id,
        attr_name: a.name,
        attr_value: a.value,
        source_text: a.source,
      })));
    }

    const isLinear = LINEAR_CATEGORIES.has(category);

    // Price snapshot (canonical net = list x multiplier; GM never imported).
    if (list != null || recomputedNet != null) {
      await sb.from('hardware_price').insert({
        hardware_variant_id: variant.id,
        hardware_price_book_id: priceBookRevisionId,
        list_price: list,
        discount_multiplier: multiplier,
        net_cost: recomputedNet,
        uom: isLinear ? 'FT' : 'EA',
        effective_from: book.effective_date ?? null,
        source_row_ref: `${sheetName}!${absRow}`,
        review_status: 'UNREVIEWED',
      });
      counts.prices++;
    }

    // CALC families -> linear rule (per-foot from net), keyed to this variant.
    if (isLinear && recomputedNet != null) {
      await sb.from('linear_hardware_rule').insert({
        hardware_category: slugifyCategory(category),
        length_basis: category === 'Thresholds' ? 'width' : 'perimeter',
        cut_increment: 1,
        waste_pct: 10,
        minimum_length: category === 'Thresholds' ? null : 1,
        per_foot_price: recomputedNet,
        hardware_variant_id: variant.id,
      });
      counts.linearRules++;
    }

    if (!netReconciled) {
      counts.mismatches++;
      mismatches.push({ row: absRow, description, list, multiplier, sourceNet, recomputedNet });
    }
  }

  // Proposals (human-review gate): one summary + one per net mismatch.
  await sb.from('pricing_change_proposals').insert({
    proposal_type: 'hardware_product', source: 'ingestion', price_book_id: priceBookId, price_book_document_id: documentId,
    target_ids: { hardwarePriceBookId: priceBookRevisionId },
    payload: { ...counts, hardwarePriceBookId: priceBookRevisionId },
    confidence: 0.8,
    explanation: `Hardware catalog ingested: ${counts.products} products, ${counts.variants} variants, ${counts.prices} prices, ${counts.linearRules} linear rules, ${counts.notes} notes. ${counts.mismatches} net mismatch(es) queued for review.`,
    status: 'pending',
  });
  for (const m of mismatches.slice(0, 200)) {
    await sb.from('pricing_change_proposals').insert({
      proposal_type: 'hardware_price', source: 'ingestion', price_book_id: priceBookId, price_book_document_id: documentId,
      target_ids: { hardwarePriceBookId: priceBookRevisionId, row: m.row },
      payload: m,
      confidence: 0.3,
      explanation: `Row ${m.row} "${m.description ?? ''}": list ${m.list} × ${m.multiplier} = ${m.recomputedNet}, but source net = ${m.sourceNet} (>1% off). Verify multiplier/list/net.`,
      status: 'pending',
    });
  }

  // Report through extract_* only (the hardware path does not use the grid
  // catalog/extract flow, so leave ocr_status alone to avoid surfacing the
  // legacy grid-review button).
  await sb.from('price_books').update({
    ocr_status: 'done', ocr_error: null,
    extract_status: 'done', extracted_at: new Date().toISOString(),
    extract_total: counts.products + counts.variants, extract_done: counts.variants, extract_failed: counts.mismatches,
  }).eq('id', priceBookId);

  console.log(`[hardware] ${priceBookId}:`, JSON.stringify(counts));
  return { hardwarePriceBookId: priceBookRevisionId, ...counts };
}
