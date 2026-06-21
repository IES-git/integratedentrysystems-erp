-- ============================================================================
-- Clean the freshly re-ingested vocabulary (Pioneer/NGP/Hardware re-ingest).
-- ============================================================================
--
-- The re-ingest ran a worker build that did NOT apply compile-time vocabulary
-- normalization, so series/gauge labels landed raw. This fixes the data in place
-- (no re-ingest needed) and seeds the new mappings so future ingests are clean:
--   A. new alias rows: STC## ratings leaked into door_gauge (reject); the
--      "Borrowed Lite" frame series -> F-BL (VERIFY).
--   B. strip the extractor's " Series" suffix on series fields ("F Series" -> "F")
--      whenever the stripped token is a canonical family code.
--   C. apply all status='alias' rewrites CASE-INSENSITIVELY (the prior cleanup was
--      case-sensitive, so UPPERCASE re-ingest values like PIOSONIC slipped through).
--   D. drop literal 'null' EQ conditions (blank-cell artifacts).
--   E. neutralize (REJECTED) any rule still holding a reject-status value, and flag
--      it for re-ingestion. REJECTED rules are excluded from pricing AND the QA gate.
-- ----------------------------------------------------------------------------

-- A. New governed-vocabulary entries.
insert into public.spec_value_alias (field_path, raw_value, canonical_value, target_operator, status, notes) values
  ('door.door_gauge', 'STC35', null, 'EQ', 'reject', 'STC sound rating leaked into gauge field'),
  ('door.door_gauge', 'STC37', null, 'EQ', 'reject', 'STC sound rating leaked into gauge field'),
  ('door.door_gauge', 'STC42', null, 'EQ', 'reject', 'STC sound rating leaked into gauge field'),
  ('door.door_gauge', 'STC44', null, 'EQ', 'reject', 'STC sound rating leaked into gauge field'),
  ('door.door_gauge', 'STC45', null, 'EQ', 'reject', 'STC sound rating leaked into gauge field'),
  ('door.door_gauge', 'STC46', null, 'EQ', 'reject', 'STC sound rating leaked into gauge field'),
  ('door.door_gauge', 'STC48', null, 'EQ', 'reject', 'STC sound rating leaked into gauge field'),
  ('door.door_gauge', 'STC52', null, 'EQ', 'reject', 'STC sound rating leaked into gauge field'),
  ('frame.frame_series', 'Borrowed Lite', 'F-BL', 'EQ', 'alias', 'VERIFY: borrowed-lite frame mapped to F-BL; confirm vs DWBL')
on conflict (field_path, raw_value) do nothing;

-- B. Strip the " Series" suffix where the remaining token is canonical.
update public.rule_condition rc
set source_phrase = coalesce(rc.source_phrase, rc.value_1),
    value_1 = btrim(regexp_replace(rc.value_1, '\s+series$', '', 'i')),
    normalized_value = lower(btrim(regexp_replace(rc.value_1, '\s+series$', '', 'i')))
from public.spec_field_mapping m
join public.opening_spec_field f on f.field_id = m.field_id
where m.field_path = rc.field_path
  and rc.field_path in ('door.door_series_construction', 'frame.frame_series')
  and rc.value_1 ~* '\s+series$'
  and lower(btrim(regexp_replace(rc.value_1, '\s+series$', '', 'i'))) = any (
    array(select lower(btrim(t)) from unnest(string_to_array(f.allowed_values, ';')) t where btrim(t) <> '')
  );

-- C. Apply recoverable aliases (case-insensitive). EQ rewrite + IN conversion.
update public.rule_condition rc
set source_phrase = coalesce(rc.source_phrase, rc.value_1),
    operator = case when a.target_operator = 'IN' then 'IN' else rc.operator end,
    value_1 = a.canonical_value,
    normalized_value = lower(a.canonical_value)
from public.spec_value_alias a
where a.status = 'alias'
  and a.field_path = rc.field_path
  and lower(btrim(rc.value_1)) = lower(btrim(a.raw_value));

-- D. Drop blank-cell 'null' equality conditions.
delete from public.rule_condition where operator = 'EQ' and value_1 = 'null';

-- E. Neutralize rules that still reference a reject-status value; flag once.
insert into public.qa_issue (price_book_id, price_rule_id, check_name, severity, detail, status)
select distinct pr.price_book_id, pr.id, 'vocab_reject_value', 'ERROR',
       'Condition ' || rc.field_path || ' value "' || rc.value_1 || '" rejected by governed vocabulary ('
         || coalesce(a.notes, 'no canonical mapping') || ') — rule demoted to REJECTED; re-ingest the source.',
       'open'
from public.rule_condition rc
join public.spec_value_alias a
  on a.status = 'reject' and a.field_path = rc.field_path and lower(btrim(rc.value_1)) = lower(btrim(a.raw_value))
join public.price_rule pr on pr.id = rc.price_rule_id
where pr.review_status <> 'REJECTED'
  and not exists (select 1 from public.qa_issue q where q.price_rule_id = pr.id and q.check_name = 'vocab_reject_value');

update public.price_rule pr
set review_status = 'REJECTED', updated_at = now()
where pr.review_status <> 'REJECTED'
  and exists (
    select 1 from public.rule_condition rc
    join public.spec_value_alias a
      on a.status = 'reject' and a.field_path = rc.field_path and lower(btrim(rc.value_1)) = lower(btrim(a.raw_value))
    where rc.price_rule_id = pr.id
  );

-- F. Triage the per-foot unit_basis warnings (perimeter-formula modeling gap).
update public.qa_issue
set status = 'resolved',
    detail = detail || ' [triaged: per-foot linear charge needs a perimeter quantity-formula model]',
    updated_at = now()
where check_name = 'unit_basis' and status = 'open';
