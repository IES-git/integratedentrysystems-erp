// CPQ v2 rule compiler (Phase 2.1, pipeline steps 4-6).
//
// Turns an extracted table's grid (raw evidence) into canonical pricing rules:
//   1. ensure a draft price_book_document for the book (publish target)
//   2. ensure a source_region for the table + persist raw_table_cell evidence
//   3. classify the table archetype
//   4. flatten headers + normalize tokens
//   5. compile each price cell/sentence -> price_rule (+ rule_condition)
//   6. compile narrative/notes -> dependency_rule
//
// Everything lands UNREVIEWED behind a pricing_change_proposals gate; nothing is
// auto-published. Re-running recompiles idempotently (clears the table's prior
// rules first).

import {
  classifyArchetype,
  categoryToEntityType,
  fieldPaths,
  flattenColumnHeader,
  parseSizeLabel,
  normalizeToken,
  parsePrice,
} from './normalize.js';

const CURRENCY = 'USD';

/**
 * Ensure the staging book has a linked draft price_book_document; create + link
 * one if missing. Returns the document id (the publish target all rules hang off).
 */
export async function ensureDraftDocument(sb, book) {
  if (book.price_book_document_id) return book.price_book_document_id;
  const { data: doc, error } = await sb
    .from('price_book_document')
    .insert({
      manufacturer_id: book.company_id ?? null,
      title: book.name,
      effective_date: book.effective_date ?? null,
      source_file_path: book.source_file_url ?? null,
      status: 'draft',
      review_status: 'UNREVIEWED',
      notes: `Auto-created from price_books ${book.id} during CPQ v2 ingestion.`,
    })
    .select('id')
    .single();
  if (error || !doc) throw new Error(`Failed to create draft price_book_document: ${error?.message}`);
  await sb.from('price_books').update({ price_book_document_id: doc.id }).eq('id', book.id);
  return doc.id;
}

/**
 * Ensure a source_region exists for this extraction (one table region) and that
 * the extraction is linked to it + the draft document. Returns the region id.
 */
async function ensureSourceRegion(sb, documentId, ext) {
  if (ext.source_region_id) {
    // Keep it pointed at the live document (defensive on re-link).
    await sb.from('source_region').update({ price_book_id: documentId }).eq('id', ext.source_region_id);
    return ext.source_region_id;
  }
  const { data: region, error } = await sb
    .from('source_region')
    .insert({
      price_book_id: documentId,
      region_type: 'table',
      table_title: ext.title ?? null,
      raw_text: ext.page_hint ?? null,
      extraction_confidence: null,
    })
    .select('id')
    .single();
  if (error || !region) throw new Error(`Failed to create source_region: ${error?.message}`);
  await sb.from('price_book_extractions')
    .update({ source_region_id: region.id, price_book_document_id: documentId })
    .eq('id', ext.id);
  return region.id;
}

/** Persist the extracted grid's priced cells as raw_table_cell evidence. */
async function writeRawCells(sb, documentId, regionId, grid) {
  await sb.from('raw_table_cell').delete().eq('source_region_id', regionId);
  const colLabels = grid?.columnLabels ?? [];
  const rowLabels = grid?.rowLabels ?? [];
  const cells = grid?.cells ?? [];
  if (cells.length === 0) return;
  const rows = cells.map((c) => ({
    source_region_id: regionId,
    price_book_id: documentId,
    row_index: c.row,
    col_index: c.col,
    row_headers: { label: rowLabels[c.row] ?? null },
    col_headers: { label: colLabels[c.col] ?? null },
    raw_value: c.price != null ? String(c.price) : null,
    normalized_value: c.price != null ? String(c.price) : null,
  }));
  // Chunk to keep payloads small.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('raw_table_cell').insert(rows.slice(i, i + 500));
    if (error) throw new Error(`raw_table_cell insert failed: ${error.message}`);
  }
}

/** Remove all canonical rows previously compiled from this table's region. */
async function clearPriorRules(sb, regionId) {
  // rule_condition / rule_action_parameter / included_scope / quantity_tier
  // cascade from price_rule. dependency_rule + price_table are deleted directly.
  await sb.from('price_rule').delete().eq('source_region_id', regionId);
  await sb.from('dependency_rule').delete().eq('source_region_id', regionId);
  await sb.from('price_table').delete().eq('source_region_id', regionId);
}

async function insertPriceTable(sb, documentId, regionId, entityType, archetype, ext) {
  const { data, error } = await sb
    .from('price_table')
    .insert({
      price_book_id: documentId,
      entity_type: entityType,
      archetype,
      name: ext.title ?? 'Untitled table',
      section: ext.detected_series ?? null,
      precedence: 100,
      source_region_id: regionId,
    })
    .select('id')
    .single();
  if (error) throw new Error(`price_table insert failed: ${error.message}`);
  return data.id;
}

/** Insert one price_rule and return its id. */
async function insertRule(sb, rule) {
  const { data, error } = await sb.from('price_rule').insert(rule).select('id').single();
  if (error) throw new Error(`price_rule insert failed: ${error.message}`);
  return data.id;
}

/** Insert rule_condition rows for a rule (group 0 = AND). */
async function insertConditions(sb, priceRuleId, conditions) {
  if (conditions.length === 0) return;
  const rows = conditions.map((c) => ({
    price_rule_id: priceRuleId,
    condition_group: c.group ?? 0,
    field_id: c.fieldId ?? null,
    field_path: c.fieldPath ?? null,
    operator: c.operator,
    value_type: c.valueType ?? 'TEXT',
    value_1: c.value1 != null ? String(c.value1) : null,
    value_2: c.value2 != null ? String(c.value2) : null,
    unit: c.unit ?? null,
    inclusive_min: c.inclusiveMin ?? null,
    inclusive_max: c.inclusiveMax ?? null,
    normalized_value: c.normalizedValue ?? null,
    source_phrase: c.sourcePhrase ?? null,
    derived_flag: c.derived ?? false,
    null_behavior: c.nullBehavior ?? 'FAIL',
  }));
  const { error } = await sb.from('rule_condition').insert(rows);
  if (error) throw new Error(`rule_condition insert failed: ${error.message}`);
}

function baseRule(documentId, regionId, priceTableId, entityType, ext, overrides) {
  return {
    price_book_id: documentId,
    price_table_id: priceTableId,
    entity_type: entityType,
    price_status: 'PRICED',
    action_type: 'BASE_AMOUNT',
    currency_code: CURRENCY,
    priority: 100,
    stacking_behavior: 'STACK',
    source_region_id: regionId,
    extraction_confidence: null,
    review_status: 'UNREVIEWED',
    ...overrides,
  };
}

/** Conditions shared by every rule in a size/component matrix (series + column attr). */
function seriesCondition(paths, ext) {
  if (!ext.detected_series || !paths.series) return [];
  return [{ fieldPath: paths.series, operator: 'EQ', valueType: 'CODE', value1: ext.detected_series, sourcePhrase: `series ${ext.detected_series}` }];
}

function columnConditions(paths, colLabel) {
  const flat = flattenColumnHeader(colLabel);
  const out = [];
  if (flat.gauge && paths.gauge) out.push({ fieldPath: paths.gauge, operator: 'EQ', value1: flat.gauge, sourcePhrase: colLabel, normalizedValue: flat.gauge });
  if (flat.material && paths.material) out.push({ fieldPath: paths.material, operator: 'EQ', value1: flat.material, sourcePhrase: colLabel, normalizedValue: flat.material });
  if (flat.depth && paths.depth) out.push({ fieldPath: paths.depth, operator: 'EQ', value1: flat.depth, valueType: 'DIMENSION', unit: 'in', sourcePhrase: colLabel });
  // When no token parsed, keep the raw label as an EQ on the column's natural axis.
  if (out.length === 0 && flat.label && paths.gauge) {
    out.push({ fieldPath: paths.gauge, operator: 'EQ', value1: flat.label, sourcePhrase: colLabel });
  }
  return out;
}

function sizeConditions(paths, rowLabel) {
  const { width, height } = parseSizeLabel(rowLabel);
  const out = [];
  if (width != null && paths.width) {
    out.push({ fieldPath: paths.width, operator: 'LTE', valueType: 'DIMENSION', value1: width, unit: 'in', inclusiveMax: true, sourcePhrase: rowLabel });
  }
  if (height != null && paths.height) {
    out.push({ fieldPath: paths.height, operator: 'LTE', valueType: 'DIMENSION', value1: height, unit: 'in', inclusiveMax: true, sourcePhrase: rowLabel });
  }
  // No parseable dimension: keep the label as an EQ so the rule is still addressable.
  if (out.length === 0 && rowLabel && paths.width) {
    out.push({ fieldPath: paths.width, operator: 'EQ', value1: String(rowLabel), sourcePhrase: rowLabel });
  }
  return out;
}

/** Compile a size/component matrix: one BASE_AMOUNT rule per priced cell. */
async function compileMatrix(sb, ctx, archetype) {
  const { documentId, regionId, priceTableId, entityType, ext, grid, paths } = ctx;
  const colLabels = grid.columnLabels ?? [];
  const rowLabels = grid.rowLabels ?? [];
  let count = 0;
  for (const cell of grid.cells ?? []) {
    const price = parsePrice(cell.price);
    if (price == null) continue;
    const colLabel = colLabels[cell.col] ?? '';
    const rowLabel = rowLabels[cell.row] ?? '';
    const ruleId = await insertRule(sb, baseRule(documentId, regionId, priceTableId, entityType, ext, {
      action_type: 'BASE_AMOUNT',
      charge_category: archetype === 'component_matrix' ? 'component' : 'base',
      amount: price,
      raw_value_text: `${rowLabel} | ${colLabel} = ${price}`,
    }));
    await insertConditions(sb, ruleId, [
      ...seriesCondition(paths, ext),
      ...columnConditions(paths, colLabel),
      ...sizeConditions(paths, rowLabel),
    ]);
    count++;
  }
  return count;
}

/** Compile an option/adder list: one FIXED_ADD (or status/percent/per-foot) rule per row. */
async function compileAdderList(sb, ctx) {
  const { documentId, regionId, priceTableId, entityType, ext, grid } = ctx;
  const rowLabels = grid.rowLabels ?? [];
  const colLabels = grid.columnLabels ?? [];
  // Map a price to each row (first numeric cell on that row).
  const priceByRow = new Map();
  for (const c of grid.cells ?? []) {
    if (!priceByRow.has(c.row)) priceByRow.set(c.row, parsePrice(c.price));
  }
  let count = 0;
  for (let r = 0; r < rowLabels.length; r++) {
    const label = String(rowLabels[r] ?? '').trim();
    if (!label) continue;
    const code = extractOptionCode(label);
    const token = normalizeToken(label) ?? normalizeToken(colLabels[0]);
    const price = priceByRow.get(r) ?? null;

    let action = 'FIXED_ADD';
    let status = 'PRICED';
    let amount = price;
    let percentage = null;
    let uom = null;

    if (token?.kind === 'status') { status = token.status; action = statusToAction(token.status); amount = null; }
    else if (token?.kind === 'percent') { action = 'PERCENT_OF'; percentage = token.percentage; amount = null; }
    else if (token?.kind === 'per_foot') { action = 'RATE_X_QUANTITY'; uom = 'FT'; amount = price ?? token.amount; }
    else if (token?.kind === 'next_larger') { action = 'REFERENCE_PLUS_ADD'; amount = price; }
    else if (price == null) { continue; } // no price and no recognized token -> skip noise row

    const ruleId = await insertRule(sb, baseRule(documentId, regionId, priceTableId, entityType, ext, {
      action_type: action,
      price_status: status,
      charge_category: 'option',
      item_or_option_code: code,
      amount,
      percentage,
      unit_of_measure: uom,
      raw_value_text: `${label}${price != null ? ` = ${price}` : ''}`,
    }));
    await insertConditions(sb, ruleId, [
      ...seriesCondition(ctx.paths, ext),
      { fieldPath: `${entityType}.option_code`, operator: 'EQ', valueType: 'CODE', value1: code, sourcePhrase: label, nullBehavior: 'IGNORE' },
    ]);
    count++;
  }
  return count;
}

/** Compile a per-foot / linear table: RATE_X_QUANTITY rules priced per foot. */
async function compilePerFoot(sb, ctx) {
  const { documentId, regionId, priceTableId, entityType, ext, grid } = ctx;
  const rowLabels = grid.rowLabels ?? [];
  const priceByRow = new Map();
  for (const c of grid.cells ?? []) if (!priceByRow.has(c.row)) priceByRow.set(c.row, parsePrice(c.price));
  let count = 0;
  for (let r = 0; r < rowLabels.length; r++) {
    const label = String(rowLabels[r] ?? '').trim();
    const price = priceByRow.get(r);
    if (!label || price == null) continue;
    const code = extractOptionCode(label);
    const ruleId = await insertRule(sb, baseRule(documentId, regionId, priceTableId, entityType, ext, {
      action_type: 'RATE_X_QUANTITY',
      charge_category: 'linear',
      item_or_option_code: code,
      amount: price,
      unit_of_measure: 'FT',
      raw_value_text: `${label} = ${price}/ft`,
    }));
    await insertConditions(sb, ruleId, [
      { fieldPath: `${entityType}.option_code`, operator: 'EQ', valueType: 'CODE', value1: code, sourcePhrase: label, nullBehavior: 'IGNORE' },
    ]);
    count++;
  }
  return count;
}

/** Compile a narrative/notes table into dependency_rule rows. */
async function compileNarrative(sb, ctx) {
  const { documentId, regionId, ext, grid } = ctx;
  const lines = [...(grid.rowLabels ?? []), ...(grid.warnings ?? [])].map((l) => String(l).trim()).filter(Boolean);
  let count = 0;
  for (const line of lines) {
    const token = normalizeToken(line);
    if (token?.kind !== 'dependency') continue;
    const { error } = await sb.from('dependency_rule').insert({
      price_book_id: documentId,
      trigger_conditions: { source: ext.title ?? null, note: line },
      relationship_type: token.relationship,
      target_type: 'spec_field',
      severity: 'WARNING',
      auto_apply_allowed: false,
      message_template: line,
      source_region_id: regionId,
      priority: 100,
      review_status: 'UNREVIEWED',
    });
    if (error) throw new Error(`dependency_rule insert failed: ${error.message}`);
    count++;
  }
  return count;
}

/** Compile a whole-table status (included / NC / NA / CF). */
async function compileStatusTable(sb, ctx, status) {
  const { documentId, regionId, priceTableId, entityType, ext } = ctx;
  const ruleId = await insertRule(sb, baseRule(documentId, regionId, priceTableId, entityType, ext, {
    action_type: statusToAction(status),
    price_status: status,
    charge_category: 'status',
    amount: null,
    raw_value_text: ext.title ?? status,
  }));
  await insertConditions(sb, ruleId, seriesCondition(ctx.paths, ext));
  return 1;
}

function statusToAction(status) {
  switch (status) {
    case 'NO_CHARGE': return 'NO_CHARGE';
    case 'INCLUDED': return 'INCLUDED';
    case 'NOT_APPLICABLE': return 'NOT_APPLICABLE';
    case 'CONTACT_FACTORY': return 'CONTACT_FACTORY';
    default: return 'BASE_AMOUNT';
  }
}

/** Pull a leading option/prep code token from a row label ("CYL - Cylindrical lock prep" -> "CYL"). */
function extractOptionCode(label) {
  const s = String(label ?? '').trim();
  const m = s.match(/^([A-Z0-9][A-Z0-9/\-+.]{0,15})\b/);
  return m ? m[1] : s.slice(0, 32);
}

/**
 * STEP 4-6 — Compile ONE extracted table into canonical rules. Requires the
 * table's grid to already be extracted. Idempotent (recompiles cleanly).
 * Records archetype + compiled_rule_count on the extraction and upserts a
 * pricing_change_proposals row (proposal_type 'price_rule' or 'dependency_rule').
 */
export async function runCompileTable(sb, extractionId) {
  const { data: ext, error: extErr } = await sb.from('price_book_extractions').select('*').eq('id', extractionId).single();
  if (extErr || !ext) throw new Error('Extraction not found');
  if (!ext.grid_extracted) throw new Error('Grid has not been extracted yet — extract this table before compiling.');
  const { data: book, error: bookErr } = await sb.from('price_books').select('*').eq('id', ext.price_book_id).single();
  if (bookErr || !book) throw new Error('Price book not found');

  const documentId = await ensureDraftDocument(sb, book);
  const regionId = await ensureSourceRegion(sb, documentId, ext);

  const grid = ext.grid ?? { columnLabels: [], rowLabels: [], cells: [], warnings: [] };
  grid.warnings = ext.warnings ?? [];
  await writeRawCells(sb, documentId, regionId, grid);
  await clearPriorRules(sb, regionId);

  const category = ext.detected_category ?? book.category ?? null;
  const entityType = categoryToEntityType(category);
  const paths = fieldPaths(entityType);
  const archetype = classifyArchetype(
    { title: ext.title, kind: ext.kind, detectedCategory: category },
    grid,
  );
  const priceTableId = await insertPriceTable(sb, documentId, regionId, entityType, archetype, ext);

  const ctx = { documentId, regionId, priceTableId, entityType, ext, grid, paths };

  let count = 0;
  let proposalType = 'price_rule';
  switch (archetype) {
    case 'base_matrix':
    case 'size_oversize':
    case 'elevation':
    case 'specialty_assembly':
      count = await compileMatrix(sb, ctx, 'base_matrix');
      break;
    case 'component_matrix':
      count = await compileMatrix(sb, ctx, 'component_matrix');
      break;
    case 'code_adder_list':
    case 'fabrication':
    case 'install_kit':
    case 'anchor':
    case 'quantity_tier':
      count = await compileAdderList(sb, ctx);
      break;
    case 'per_foot':
      count = await compilePerFoot(sb, ctx);
      break;
    case 'percentage':
      count = await compileAdderList(sb, ctx);
      break;
    case 'contact_factory':
      count = await compileStatusTable(sb, ctx, 'CONTACT_FACTORY');
      break;
    case 'included_nc_na':
      count = await compileStatusTable(sb, ctx, 'INCLUDED');
      break;
    case 'narrative':
      count = await compileNarrative(sb, ctx);
      proposalType = 'dependency_rule';
      break;
    default: {
      // Exhaustive guard: any unhandled archetype falls back to matrix compilation.
      count = await compileMatrix(sb, ctx, 'base_matrix');
      break;
    }
  }

  await sb.from('price_book_extractions').update({
    status: 'compiled',
    archetype,
    compiled_rule_count: count,
  }).eq('id', extractionId);

  // Upsert the review proposal for this table.
  const { data: props } = await sb.from('pricing_change_proposals').select('id')
    .eq('price_book_id', book.id).contains('target_ids', { extractionId }).limit(1);
  const payload = {
    extractionId, archetype, ruleCount: count, entityType,
    title: ext.title, detectedSeries: ext.detected_series, detectedCategory: category,
    sourceRegionId: regionId,
  };
  const explanation = `"${ext.title}" -> ${count} ${proposalType === 'dependency_rule' ? 'dependency rule(s)' : 'price rule(s)'} (${archetype}). Review + approve to publish.`;
  if (props && props[0]) {
    await sb.from('pricing_change_proposals').update({
      proposal_type: proposalType, price_book_document_id: documentId,
      payload, confidence: count > 0 ? 0.8 : 0.3, explanation, status: 'pending',
    }).eq('id', props[0].id);
  } else {
    await sb.from('pricing_change_proposals').insert({
      proposal_type: proposalType, source: 'ingestion', price_book_id: book.id, price_book_document_id: documentId,
      target_ids: { extractionId }, payload, confidence: count > 0 ? 0.8 : 0.3, explanation, status: 'pending',
    });
  }

  return { extractionId, archetype, ruleCount: count };
}

/** Compile EVERY extracted-but-not-yet-compiled table for a book (sequential). */
export async function runCompileAll(sb, priceBookId) {
  const { data: rows, error } = await sb
    .from('price_book_extractions')
    .select('id')
    .eq('price_book_id', priceBookId)
    .eq('grid_extracted', true)
    .neq('status', 'approved')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  const ids = (rows || []).map((r) => r.id);
  let done = 0; let failed = 0; let totalRules = 0;
  for (const id of ids) {
    try {
      const r = await runCompileTable(sb, id);
      totalRules += r.ruleCount;
      done++;
    } catch (e) {
      failed++;
      console.error(`[compile-all] table ${id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`[compile-all] ${priceBookId}: ${done} ok, ${failed} failed, ${totalRules} rules`);
  return { total: ids.length, done, failed, totalRules };
}
