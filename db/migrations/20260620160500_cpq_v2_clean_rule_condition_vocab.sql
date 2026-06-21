-- ============================================================================
-- Phase 1: clean polluted rule_condition values using spec_value_alias.
-- ============================================================================
--
-- Applies the governed vocabulary:
--   * alias / EQ  -> rewrite value_1 to the canonical token (preserve original
--                    in source_phrase, set normalized_value).
--   * alias / IN  -> same, plus switch operator to IN so the matcher splits the
--                    '|'-joined token list.
--   * reject      -> leave the value untouched but raise a qa_issue ERROR so the
--                    affected rules are re-ingested rather than silently guessed.
--
-- Idempotent: once value_1 is canonical it no longer matches raw_value; qa_issue
-- inserts are guarded by NOT EXISTS.
-- ----------------------------------------------------------------------------

-- 1. Recoverable EQ aliases.
update public.rule_condition rc
set source_phrase   = coalesce(rc.source_phrase, rc.value_1),
    value_1         = a.canonical_value,
    normalized_value = lower(a.canonical_value)
from public.spec_value_alias a
where a.status = 'alias'
  and a.target_operator = 'EQ'
  and rc.field_path = a.field_path
  and btrim(rc.value_1) = a.raw_value;

-- 2. Recoverable multi-value operands -> IN lists.
update public.rule_condition rc
set source_phrase   = coalesce(rc.source_phrase, rc.value_1),
    operator        = 'IN',
    value_1         = a.canonical_value,
    normalized_value = lower(a.canonical_value)
from public.spec_value_alias a
where a.status = 'alias'
  and a.target_operator = 'IN'
  and rc.field_path = a.field_path
  and btrim(rc.value_1) = a.raw_value;

-- 3. Flag unrecoverable values for re-ingestion (one ERROR per affected rule).
insert into public.qa_issue (price_book_id, price_rule_id, check_name, severity, detail, status)
select pr.price_book_id,
       pr.id,
       'vocab_unrecoverable',
       'ERROR',
       'Condition ' || rc.field_path || ' has unrecoverable value "' || rc.value_1
         || '" (' || coalesce(a.notes, 'no canonical mapping') || '). Re-ingest the source region.',
       'open'
from public.rule_condition rc
join public.spec_value_alias a
  on a.status = 'reject'
 and a.field_path = rc.field_path
 and btrim(rc.value_1) = a.raw_value
join public.price_rule pr on pr.id = rc.price_rule_id
where not exists (
  select 1 from public.qa_issue q
  where q.price_rule_id = pr.id and q.check_name = 'vocab_unrecoverable'
);
