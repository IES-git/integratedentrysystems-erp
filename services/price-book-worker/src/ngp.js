// NGP infill catalog importer (glass / lite kits / louvers / tape).
//
// Unlike a Pioneer PDF price book, the NGP source is an ALREADY-NORMALIZED
// workbook with typed sheets (Products, Kit Glass Capacity, Glass Ratings,
// Size Rules, Relationships, Price Tables, Base/Direct/Option Price Rules,
// Commercial Policies). So this is a deterministic importer (no Gemini): it
// reads the known sheet/column schema and writes:
//   - the NGP catalog + compatibility tables (ngp_*) for the builder's
//     auto-filter / auto-select / validate intelligence, and
//   - the dimensional matrices + option/direct/multiplier rules into the shared
//     price_book_document / price_table / price_rule / rule_condition engine so
//     pricing reuses the existing rule path (entity_type lite_kit/louver/glass/
//     glazing_tape).
//
// One NGP workbook = one price_book_document. Re-running is idempotent: it clears
// the document's prior NGP rows/rules first. Everything lands UNREVIEWED behind a
// pricing_change_proposals gate (review -> approve -> publish, same as Pioneer).

import * as XLSX from 'xlsx';
import { ensureDraftDocument } from './compile.js';

const BUCKET = 'price-book-files';
const CURRENCY = 'USD';

// ---- small cell helpers ----
function clean(v) {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'number' ? v : String(v).trim();
  return s === '' ? null : s;
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function bool(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (['true', 't', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'f', 'no', 'n', '0'].includes(s)) return false;
  return null;
}

/**
 * Reads a worksheet into an array of row objects keyed by the header row.
 * Header detection: the first row whose first cell equals `firstCol`
 * (case-insensitive). The first few rows are a human title/description block.
 */
function readSheet(wb, name, firstCol) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    const c0 = String((aoa[i] ?? [])[0] ?? '').trim().toLowerCase();
    if (c0 === firstCol.toLowerCase()) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return [];
  const headers = (aoa[headerIdx] ?? []).map((h) => String(h ?? '').trim());
  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const raw = aoa[i] ?? [];
    if (!raw.some((v) => v !== null && v !== undefined && String(v).trim() !== '')) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = raw[c] ?? null;
    rows.push(obj);
  }
  return rows;
}

/** Map an NGP price-table entity_type -> our RuleEntityType + a charge category. */
function tableEntity(ngpEntityType) {
  switch (String(ngpEntityType ?? '').toUpperCase()) {
    case 'LITE_KIT': return { entity: 'lite_kit', charge: 'lite_kit' };
    case 'ASSEMBLY': return { entity: 'lite_kit', charge: 'lite_kit_assembly' };
    case 'LOUVER': return { entity: 'louver', charge: 'louver' };
    case 'GLASS': return { entity: 'glass', charge: 'glass' };
    case 'LOUVER_ACCESSORY': return { entity: 'louver', charge: 'louver_accessory' };
    case 'LITE_KIT_ACCESSORY': return { entity: 'lite_kit', charge: 'lite_kit_accessory' };
    default: return { entity: 'lite_kit', charge: 'lite_kit' };
  }
}

/** Entity for a direct/glass/tape rule, inferred from the model string. */
function modelEntity(model) {
  const m = String(model ?? '').toUpperCase();
  if (/L-GT|GLAZING TAPE/.test(m)) return { entity: 'glazing_tape', charge: 'glazing_tape' };
  if (/LOUVER|L-700|L-A700|FDLS|FLDL|PLSL|L-VRSG|L-1800/.test(m)) return { entity: 'louver', charge: 'louver' };
  if (/GLASS|PYRAN|FIRELITE|PROTECT|POLYCARB|TEMPERED|LAMINATED|NGP-WS|20T|X-RAY/.test(m)) return { entity: 'glass', charge: 'glass' };
  return { entity: 'lite_kit', charge: 'lite_kit' };
}

/** Sorted unique numeric ascending. */
function sortedUnique(values) {
  return [...new Set(values.filter((v) => v != null))].sort((a, b) => a - b);
}

async function chunkedInsert(sb, table, rows, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + chunk));
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

/**
 * Insert a batch of price_rule rows and their conditions efficiently.
 * `entries` = [{ rule, conditions: [...] }]. Inserts rules in chunks (with
 * .select('id') to recover ids in input order), then bulk-inserts conditions.
 */
async function insertRulesWithConditions(sb, entries, chunk = 400) {
  let inserted = 0;
  for (let i = 0; i < entries.length; i += chunk) {
    const slice = entries.slice(i, i + chunk);
    const { data, error } = await sb.from('price_rule').insert(slice.map((e) => e.rule)).select('id');
    if (error) throw new Error(`price_rule insert failed: ${error.message}`);
    const condRows = [];
    for (let j = 0; j < slice.length; j++) {
      const ruleId = data[j].id;
      for (const c of slice[j].conditions) condRows.push({ ...c, price_rule_id: ruleId });
    }
    await chunkedInsert(sb, 'rule_condition', condRows);
    inserted += slice.length;
  }
  return inserted;
}

function cond(fieldPath, operator, value1, opts = {}) {
  return {
    condition_group: 0,
    field_id: null,
    field_path: fieldPath,
    operator,
    value_type: opts.valueType ?? 'TEXT',
    value_1: value1 != null ? String(value1) : null,
    value_2: opts.value2 != null ? String(opts.value2) : null,
    unit: opts.unit ?? null,
    inclusive_min: opts.inclusiveMin ?? null,
    inclusive_max: opts.inclusiveMax ?? null,
    normalized_value: null,
    source_phrase: opts.sourcePhrase ?? null,
    derived_flag: false,
    null_behavior: 'FAIL',
  };
}

function ruleBase(documentId, priceTableId, entity, overrides) {
  return {
    price_book_id: documentId,
    price_table_id: priceTableId,
    entity_type: entity,
    charge_category: null,
    price_status: 'PRICED',
    action_type: 'BASE_AMOUNT',
    amount: null,
    currency_code: CURRENCY,
    priority: 100,
    stacking_behavior: 'STACK',
    review_status: 'UNREVIEWED',
    ...overrides,
  };
}

/** Clear all NGP rows + compiled rules previously imported for this document. */
async function clearPrior(sb, documentId) {
  // price_rule cascades rule_condition/included_scope; ngp_option FKs price_rule
  // (SET NULL) so clear ngp_option first to avoid orphan references lingering.
  for (const t of ['ngp_product', 'ngp_kit_glass_capacity', 'ngp_glass_rating', 'ngp_size_rule',
    'ngp_relationship', 'ngp_finish_code', 'ngp_option', 'ngp_commercial_policy', 'ngp_price_table_map']) {
    await sb.from(t).delete().eq('price_book_document_id', documentId);
  }
  await sb.from('price_rule').delete().eq('price_book_id', documentId);
  await sb.from('price_table').delete().eq('price_book_id', documentId);
}

/**
 * Ingest an NGP normalized catalog workbook (uploaded as a price_books row).
 * Returns counts. Idempotent per document.
 */
export async function runIngestNgp(sb, priceBookId) {
  const { data: book, error: bookErr } = await sb.from('price_books').select('*').eq('id', priceBookId).single();
  if (bookErr || !book) throw new Error('Price book not found');
  if (book.file_type !== 'xlsx' && book.file_type !== 'csv') {
    throw new Error('NGP ingestion expects the normalized XLSX catalog.');
  }

  await sb.from('price_books').update({ extract_status: 'processing', extract_error: null }).eq('id', priceBookId);

  const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(book.source_file_url);
  if (dlErr || !blob) throw new Error('File download failed: ' + (dlErr?.message || 'no data'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const wb = XLSX.read(bytes, { type: 'buffer', raw: false, cellDates: false });

  const documentId = await ensureDraftDocument(sb, book);
  await clearPrior(sb, documentId);

  const counts = {
    products: 0, attributes: 0, capacity: 0, ratings: 0, sizeRules: 0, relationships: 0,
    finishCodes: 0, options: 0, policies: 0, priceTables: 0, matrixRules: 0, directRules: 0,
    optionRules: 0, tableMaps: 0,
  };

  // ---------- 1. Catalog sheets ----------
  const products = readSheet(wb, 'Products', 'product_id');
  const productIdByCode = new Map(); // ngp product_id -> ngp_product.id
  for (const p of products) {
    const productCode = clean(p.product_id);
    if (!productCode) continue;
    const { data, error } = await sb.from('ngp_product').insert({
      price_book_document_id: documentId,
      product_id: productCode,
      manufacturer: clean(p.manufacturer),
      category: clean(p.category) ?? 'LITE_KIT',
      subcategory: clean(p.subcategory),
      model: clean(p.model),
      model_aliases: clean(p.model_aliases),
      product_name: clean(p.product_name),
      material: clean(p.material),
      standard_finish: clean(p.standard_finish),
      door_thickness_min_in: num(p.door_thickness_min_in),
      door_thickness_max_in: num(p.door_thickness_max_in),
      glass_thickness_min_in: num(p.glass_thickness_min_in),
      glass_thickness_max_in: num(p.glass_thickness_max_in),
      fire_rating_max: num(p.fire_rating_max_min),
      preferred_price_uom: clean(p.preferred_price_uom),
      glass_scope: clean(p.glass_scope),
      active: bool(p.active) ?? true,
      source_page: clean(p.source_page),
      notes: clean(p.notes),
    }).select('id').single();
    if (error) throw new Error(`ngp_product insert failed (${productCode}): ${error.message}`);
    productIdByCode.set(productCode, data.id);
    counts.products++;
  }

  const attrs = readSheet(wb, 'Product Attributes', 'attribute_id');
  const attrRows = [];
  for (const a of attrs) {
    const pid = productIdByCode.get(clean(a.product_id));
    if (!pid) continue;
    attrRows.push({
      ngp_product_id: pid,
      attribute_name: clean(a.attribute_name) ?? 'attr',
      value_text: clean(a.value_text),
      value_number: num(a.value_number),
      unit: clean(a.unit),
      data_type: clean(a.data_type),
      source_page: clean(a.source_page),
    });
  }
  await chunkedInsert(sb, 'ngp_product_attribute', attrRows);
  counts.attributes = attrRows.length;

  const capacity = readSheet(wb, 'Kit Glass Capacity', 'capacity_id');
  const capRows = capacity.map((c) => ({
    price_book_document_id: documentId,
    capacity_id: clean(c.capacity_id),
    kit_model: clean(c.kit_model) ?? '',
    door_thickness_in: num(c.door_thickness_in),
    glass_thickness_in: num(c.glass_thickness_in),
    required_tape_model: clean(c.required_tape_model),
    profile_group: clean(c.profile_group),
    allowed: bool(c.allowed) ?? true,
    source_page: clean(c.source_page),
  })).filter((r) => r.kit_model);
  await chunkedInsert(sb, 'ngp_kit_glass_capacity', capRows);
  counts.capacity = capRows.length;

  const ratings = readSheet(wb, 'Glass Ratings', 'rating_id');
  const ratingRows = ratings.map((r) => ({
    price_book_document_id: documentId,
    rating_id: clean(r.rating_id),
    glass_model: clean(r.glass_model) ?? '',
    fire_minutes: clean(r.fire_minutes),
    application: clean(r.application),
    max_visible_area_sq_in: num(r.max_visible_area_sq_in),
    max_visible_width_in: num(r.max_visible_width_in),
    max_visible_height_in: num(r.max_visible_height_in),
    source_page: clean(r.source_page),
  })).filter((r) => r.glass_model);
  await chunkedInsert(sb, 'ngp_glass_rating', ratingRows);
  counts.ratings = ratingRows.length;

  const sizeRules = readSheet(wb, 'Size Rules', 'size_rule_id');
  const sizeRows = sizeRules.map((s) => ({
    price_book_document_id: documentId,
    size_rule_id: clean(s.size_rule_id),
    model_or_family: clean(s.model_or_family) ?? '',
    output_field: clean(s.output_field) ?? '',
    operator: clean(s.operator),
    value: num(s.value),
    unit: clean(s.unit),
    input_basis: clean(s.input_basis),
    source_page: clean(s.source_page),
  })).filter((r) => r.model_or_family && r.output_field);
  await chunkedInsert(sb, 'ngp_size_rule', sizeRows);
  counts.sizeRules = sizeRows.length;

  const rels = readSheet(wb, 'Relationships', 'relationship_id');
  const relRows = rels.map((r) => ({
    price_book_document_id: documentId,
    relationship_id: clean(r.relationship_id),
    source_model: clean(r.source_model),
    target_model: clean(r.target_model),
    relationship_type: clean(r.relationship_type) ?? 'RELATED',
    rule: clean(r.rule),
    inclusion_scope: clean(r.inclusion_scope),
    confidence: clean(r.confidence),
    source_page: clean(r.source_page),
  }));
  await chunkedInsert(sb, 'ngp_relationship', relRows);
  counts.relationships = relRows.length;

  const finishes = readSheet(wb, 'Finish Codes', 'finish_code');
  const finishRows = finishes.map((f) => ({
    price_book_document_id: documentId,
    finish_code: clean(f.finish_code) ?? '',
    finish_name: clean(f.finish_name),
    availability: clean(f.availability),
    notes: clean(f.notes),
  })).filter((r) => r.finish_code);
  await chunkedInsert(sb, 'ngp_finish_code', finishRows);
  counts.finishCodes = finishRows.length;

  const policies = readSheet(wb, 'Commercial Policies', 'policy_id');
  const policyRows = policies.map((p) => ({
    price_book_document_id: documentId,
    policy_id: clean(p.policy_id),
    policy_type: clean(p.policy_type) ?? 'POLICY',
    description: clean(p.description),
    basis: clean(p.basis),
    amount_or_threshold: num(p.amount_or_threshold),
    unit: clean(p.unit),
    condition: clean(p.condition),
    source_page: clean(p.source_page),
  })).filter((r) => r.policy_id);
  await chunkedInsert(sb, 'ngp_commercial_policy', policyRows);
  counts.policies = policyRows.length;

  // ---------- 2. Price tables + base matrices ----------
  const priceTables = readSheet(wb, 'Price Tables', 'price_table_id');
  const ptMeta = new Map(); // ngpTableId -> { entity, charge, title, includedScope }
  for (const t of priceTables) {
    const id = clean(t.price_table_id);
    if (!id) continue;
    const te = tableEntity(t.entity_type);
    ptMeta.set(id, {
      entity: te.entity,
      charge: te.charge,
      title: clean(t.title) ?? id,
      includedScope: clean(t.included_scope),
      glassModel: clean(t.glass_model),
      tapeModel: clean(t.tape_model),
    });
  }

  // Group base price cells by ngp price_table_id.
  const baseCells = readSheet(wb, 'Base Price Rules', 'price_rule_id');
  const cellsByTable = new Map();
  for (const c of baseCells) {
    const tid = clean(c.price_table_id);
    const w = num(c.order_width_in);
    const h = num(c.order_height_in);
    const price = num(c.list_price);
    if (!tid || w == null || h == null || price == null) continue;
    if (!cellsByTable.has(tid)) cellsByTable.set(tid, []);
    cellsByTable.get(tid).push({ w, h, price, uom: clean(c.uom) ?? 'EA', status: clean(c.price_status) ?? 'PRICED' });
  }

  // Compile one price_table + matrix rules per ngp table (multiplier 1).
  // compiledIdByTable: ngpTableId -> compiled price_table.id
  const compiledIdByTable = new Map();
  for (const [tid, cells] of cellsByTable) {
    const meta = ptMeta.get(tid) ?? { entity: 'lite_kit', charge: 'lite_kit', title: tid };
    const compiledId = await compileMatrix(sb, documentId, tid, meta, cells, 1);
    compiledIdByTable.set(tid, compiledId);
    counts.priceTables++;
    counts.matrixRules += cells.length;
  }

  // ---------- 3. Price table map (incl. BASE_MULTIPLIER variants) ----------
  const maps = readSheet(wb, 'Price Table Map', 'map_id');
  const mapRows = [];
  for (const m of maps) {
    const ngpTableId = clean(m.price_table_id);
    const model = clean(m.model);
    if (!ngpTableId || !model) continue;
    const rel = clean(m.relationship) ?? 'BASE';
    const mult = num(m.multiplier) ?? 1;
    let resolvedCompiledId = compiledIdByTable.get(ngpTableId) ?? null;

    if (rel.toUpperCase() === 'BASE_MULTIPLIER' && mult !== 1) {
      // Pre-multiply: clone the base table's cells into a NEW compiled table for
      // this model (deterministic; no runtime reference chains).
      const cells = cellsByTable.get(ngpTableId);
      const meta = ptMeta.get(ngpTableId) ?? { entity: 'lite_kit', charge: 'lite_kit', title: ngpTableId };
      if (cells && cells.length) {
        resolvedCompiledId = await compileMatrix(sb, documentId, `${ngpTableId}::${model}`,
          { ...meta, title: `${meta.title} — ${model} (×${mult})` }, cells, mult);
        counts.priceTables++;
        counts.matrixRules += cells.length;
      }
    }

    const meta = ptMeta.get(ngpTableId);
    mapRows.push({
      price_book_document_id: documentId,
      map_id: clean(m.map_id),
      ngp_price_table_id: ngpTableId,
      price_table_id: resolvedCompiledId,
      model,
      relationship: rel,
      multiplier: mult,
      condition: clean(m.condition),
      source_page: clean(m.source_page),
      included_scope: meta?.includedScope ?? null,
      glass_model: meta?.glassModel ?? null,
      tape_model: meta?.tapeModel ?? null,
      entity_type: meta?.entity ?? null,
    });
  }
  await chunkedInsert(sb, 'ngp_price_table_map', mapRows);
  counts.tableMaps = mapRows.length;

  // ---------- 4. Direct price rules (tape, round glass, polycarbonate, quick ship) ----------
  const directs = readSheet(wb, 'Direct Price Rules', 'direct_rule_id');
  const directEntries = [];
  for (const d of directs) {
    const ruleId = clean(d.direct_rule_id);
    const model = clean(d.model);
    if (!ruleId || !model) continue;
    const me = modelEntity(model);
    const action = String(clean(d.action) ?? 'FIXED_LIST').toUpperCase();
    const list = num(d.list_price);
    const w = num(d.width_in);
    const h = num(d.height_in);
    const status = clean(d.price_status) ?? 'PRICED';

    const conditions = [];
    // Tape rules match on the resolved tape model; everything else is opt-in via
    // an explicit direct_rule_code selector so it never interferes with matrices.
    if (me.entity === 'glazing_tape') {
      conditions.push(cond('infill.tape_model', 'EQ', model, { valueType: 'TEXT' }));
    } else {
      conditions.push(cond('infill.direct_rule_code', 'EQ', ruleId, { valueType: 'TEXT' }));
      if (w != null) conditions.push(cond('infill.order_width_in', 'EQ', w, { valueType: 'NUMBER' }));
      if (h != null) conditions.push(cond('infill.order_height_in', 'EQ', h, { valueType: 'NUMBER' }));
    }

    const isCf = status.toUpperCase() === 'CONTACT_FACTORY' || action === 'CONTACT_FACTORY';
    directEntries.push({
      rule: ruleBase(documentId, null, me.entity, {
        charge_category: me.charge,
        item_or_option_code: model,
        rule_key: `NGP-DIRECT:${ruleId}`,
        action_type: isCf ? 'CONTACT_FACTORY' : 'BASE_AMOUNT',
        price_status: isCf ? 'CONTACT_FACTORY' : 'PRICED',
        amount: isCf ? null : list,
        unit_of_measure: clean(d.uom) ?? 'EA',
        raw_value_text: clean(d.notes),
      }),
      conditions,
    });
  }
  counts.directRules = await insertRulesWithConditions(sb, directEntries);

  // ---------- 5. Option price rules (adders/multipliers) + ngp_option link ----------
  // Option adders are computed by the engine's NGP options pass (which has the
  // component base in hand), so their price_rule carries an `infill.option_apply`
  // selector that never matches a component in the generic flow.
  const optionRules = readSheet(wb, 'Option Price Rules', 'option_rule_id');
  const optionRuleIdByCode = new Map(); // option_code -> price_rule.id
  for (const o of optionRules) {
    const oid = clean(o.option_rule_id);
    const code = clean(o.option_code);
    if (!oid) continue;
    const action = String(clean(o.action) ?? '').toUpperCase();
    const amount = num(o.amount);
    const status = clean(o.price_status) ?? 'PRICED';
    const isCf = status.toUpperCase() === 'CONTACT_FACTORY' || action === 'CONTACT_FACTORY';

    // Map the NGP option action onto our action_type + amount/percentage.
    let actionType = 'FIXED_ADD';
    let amt = amount;
    let percentage = null;
    let qtyBasis = null;
    if (action.startsWith('PERCENT')) { actionType = 'PERCENT_OF'; percentage = (amount ?? 0) * 100; amt = null; }
    else if (action === 'RATE_X_AREA') { actionType = 'RATE_X_QUANTITY'; qtyBasis = 'infill.area_sqft'; }
    else if (action === 'RATE_X_PERIMETER') { actionType = 'RATE_X_QUANTITY'; qtyBasis = 'infill.perimeter_in'; }
    else if (action === 'FIXED_ADD_X_QTY') { actionType = 'FIXED_ADD_X_QTY'; qtyBasis = 'infill.option_qty'; }
    else if (action === 'FIXED_ADD' || action === 'FIXED_LIST') { actionType = 'FIXED_ADD'; }

    const { data, error } = await sb.from('price_rule').insert(ruleBase(documentId, null, 'lite_kit', {
      charge_category: `option:${code ?? oid}`,
      item_or_option_code: code,
      rule_key: `NGP-OPT:${oid}`,
      action_type: isCf ? 'CONTACT_FACTORY' : actionType,
      price_status: isCf ? 'CONTACT_FACTORY' : 'PRICED',
      amount: isCf ? null : amt,
      percentage,
      quantity_basis_field: qtyBasis,
      unit_of_measure: clean(o.uom),
      raw_value_text: clean(o.condition) ?? clean(o.notes),
    })).select('id').single();
    if (error) throw new Error(`option price_rule insert failed (${oid}): ${error.message}`);
    // Selector that never matches a component (keeps it out of the generic flow).
    await sb.from('rule_condition').insert({ price_rule_id: data.id, condition_group: 0,
      field_path: 'infill.option_apply', operator: 'EQ', value_type: 'TEXT', value_1: code ?? oid, null_behavior: 'FAIL' });
    if (code) optionRuleIdByCode.set(code, data.id);
    counts.optionRules++;
  }

  // ---------- 6. Options catalog (ngp_option) linked to the compiled adder rule ----------
  const optionCatalog = readSheet(wb, 'Options Adders', 'option_id');
  const optRows = optionCatalog.map((o) => ({
    price_book_document_id: documentId,
    option_id: clean(o.option_id),
    applies_to: clean(o.applies_to),
    option_code: clean(o.option_code),
    option_name: clean(o.option_name),
    option_type: clean(o.option_type),
    requirements: clean(o.requirements),
    exclusions: clean(o.exclusions),
    pricing_status: clean(o.pricing_status),
    price_rule_id: optionRuleIdByCode.get(clean(o.option_code)) ?? null,
    source_page: clean(o.source_page),
  })).filter((r) => r.option_id);
  await chunkedInsert(sb, 'ngp_option', optRows);
  counts.options = optRows.length;

  // ---------- 7. Review proposal + status ----------
  await sb.from('pricing_change_proposals').insert({
    proposal_type: 'price_rule', source: 'ingestion', price_book_id: priceBookId, price_book_document_id: documentId,
    target_ids: { ngpDocumentId: documentId },
    payload: counts,
    confidence: 0.95,
    explanation: `NGP infill catalog ingested: ${counts.products} products, ${counts.priceTables} price tables, ${counts.matrixRules} matrix rules, ${counts.directRules} direct rules, ${counts.optionRules} option rules, ${counts.capacity} kit/glass capacity rows, ${counts.ratings} glass ratings. Review and approve to publish.`,
    status: 'pending',
  });

  await sb.from('price_books').update({
    extract_status: 'done', extracted_at: new Date().toISOString(),
    extract_total: counts.matrixRules + counts.directRules + counts.optionRules,
    extract_done: counts.matrixRules + counts.directRules + counts.optionRules, extract_failed: 0,
  }).eq('id', priceBookId);

  console.log(`[ngp] ${priceBookId} (doc ${documentId}):`, JSON.stringify(counts));
  return { priceBookDocumentId: documentId, ...counts };
}

/**
 * Compile a dimensional matrix into a price_table + one BASE_AMOUNT price_rule
 * per cell. Each cell matches via a width BAND + height BAND so the engine's
 * BETWEEN naturally implements "next largest size" rounding. Optional multiplier
 * pre-multiplies every price (used for stainless/security variants).
 */
async function compileMatrix(sb, documentId, ngpTableId, meta, cells, multiplier) {
  const { data: pt, error: ptErr } = await sb.from('price_table').insert({
    price_book_id: documentId,
    entity_type: meta.entity,
    archetype: 'base_matrix',
    name: meta.title,
    section: ngpTableId,
    precedence: 100,
  }).select('id').single();
  if (ptErr) throw new Error(`price_table insert failed (${ngpTableId}): ${ptErr.message}`);
  const compiledId = pt.id;

  const widths = sortedUnique(cells.map((c) => c.w));
  const heights = sortedUnique(cells.map((c) => c.h));
  const prevW = new Map(widths.map((w, i) => [w, i === 0 ? 0 : widths[i - 1]]));
  const prevH = new Map(heights.map((h, i) => [h, i === 0 ? 0 : heights[i - 1]]));

  const entries = cells.map((c) => {
    const wLo = prevW.get(c.w);
    const hLo = prevH.get(c.h);
    const price = Math.round(c.price * multiplier * 100) / 100;
    return {
      rule: ruleBase(documentId, compiledId, meta.entity, {
        charge_category: meta.charge,
        action_type: 'BASE_AMOUNT',
        amount: price,
        unit_of_measure: c.uom,
        exclusive_group: `ngp:${compiledId}`,
        rule_key: `NGP:${compiledId}:${c.w}x${c.h}`,
        raw_value_text: `${c.w}x${c.h} = ${price}`,
      }),
      conditions: [
        cond('infill.price_table_id', 'EQ', compiledId, { valueType: 'TEXT' }),
        cond('infill.order_width_in', 'BETWEEN', wLo, { valueType: 'NUMBER', value2: c.w, inclusiveMin: false, inclusiveMax: true }),
        cond('infill.order_height_in', 'BETWEEN', hLo, { valueType: 'NUMBER', value2: c.h, inclusiveMin: false, inclusiveMax: true }),
      ],
    };
  });
  await insertRulesWithConditions(sb, entries);
  return compiledId;
}
