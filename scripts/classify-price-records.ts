/**
 * Pricing-authority classification report (Release 1, plan Phase 0).
 *
 * Classifies every Pioneer/NGP price record as one of:
 *   - executable     : a published, priced, reviewed rule the engine can run
 *   - manual_review  : contact-factory / external / low-confidence / unreviewed
 *   - unsupported    : not-applicable / blocked configurations
 *   - informational  : narrative / included / no-charge (no money line)
 *
 * Every record is traced back to its source_region (table title + page) so the
 * 50 golden openings can be reconciled against the workbook tables they came
 * from. Output is JSON on stdout plus a per-source-table summary.
 *
 * Run: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/classify-price-records.ts
 */

import { createClient } from '@supabase/supabase-js';

type Classification = 'executable' | 'manual_review' | 'unsupported' | 'informational';

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const EXECUTABLE_ACTIONS = new Set([
  'BASE_AMOUNT', 'FIXED_ADD', 'FIXED_ADD_X_QTY', 'RATE_X_QUANTITY',
  'PERCENT_OF', 'REFERENCE_PLUS_ADD', 'TIERED_ADD', 'WAIVER', 'OVERRIDE',
]);
const INFORMATIONAL_ACTIONS = new Set(['INCLUDED', 'NO_CHARGE']);
const UNSUPPORTED_ACTIONS = new Set(['NOT_APPLICABLE']);
const MANUAL_ACTIONS = new Set(['CONTACT_FACTORY', 'EXTERNAL_REQUIRED']);

const MIN_CONFIDENCE = 0.5;

interface RuleRow {
  id: string;
  action_type: string;
  amount: number | null;
  review_status: string;
  extraction_confidence: number | null;
  source_region_id: string | null;
}

function classify(r: RuleRow): Classification {
  if (MANUAL_ACTIONS.has(r.action_type)) return 'manual_review';
  if (UNSUPPORTED_ACTIONS.has(r.action_type)) return 'unsupported';
  if (INFORMATIONAL_ACTIONS.has(r.action_type)) return 'informational';
  if (EXECUTABLE_ACTIONS.has(r.action_type)) {
    if (r.review_status !== 'APPROVED') return 'manual_review';
    if (r.extraction_confidence != null && r.extraction_confidence < MIN_CONFIDENCE) return 'manual_review';
    const needsAmount = r.action_type === 'BASE_AMOUNT' || r.action_type === 'FIXED_ADD'
      || r.action_type === 'FIXED_ADD_X_QTY' || r.action_type === 'RATE_X_QUANTITY' || r.action_type === 'OVERRIDE';
    if (needsAmount && (r.amount == null || r.amount <= 0)) return 'manual_review';
    return 'executable';
  }
  return 'manual_review';
}

async function pageAll(): Promise<RuleRow[]> {
  const out: RuleRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('price_rule')
      .select('id, action_type, amount, review_status, extraction_confidence, source_region_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as RuleRow[]));
    if (data.length < PAGE) break;
  }
  return out;
}

async function main(): Promise<void> {
  const rules = await pageAll();

  const regions = new Map<string, { title: string | null; page: number | null }>();
  {
    const { data } = await sb.from('source_region').select('id, table_title, page_number');
    for (const r of data ?? []) regions.set(r.id as string, { title: (r.table_title as string) ?? null, page: (r.page_number as number) ?? null });
  }

  const byClass: Record<Classification, number> = { executable: 0, manual_review: 0, unsupported: 0, informational: 0 };
  const bySource = new Map<string, Record<Classification, number>>();
  const untraced: Record<Classification, number> = { executable: 0, manual_review: 0, unsupported: 0, informational: 0 };

  for (const r of rules) {
    const c = classify(r);
    byClass[c] += 1;
    if (!r.source_region_id) { untraced[c] += 1; continue; }
    const reg = regions.get(r.source_region_id);
    const keyName = reg ? `${reg.title ?? '(untitled)'} — p.${reg.page ?? '?'}` : `(missing region ${r.source_region_id})`;
    const bucket = bySource.get(keyName) ?? { executable: 0, manual_review: 0, unsupported: 0, informational: 0 };
    bucket[c] += 1;
    bySource.set(keyName, bucket);
  }

  const report = {
    totalRules: rules.length,
    byClassification: byClass,
    untracedToSource: untraced,
    sources: [...bySource.entries()]
      .map(([source, counts]) => ({ source, ...counts }))
      .sort((a, b) => b.manual_review - a.manual_review),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
