-- ============================================================================
-- Phase 1.1: stop spurious base-rule double-counting.
-- ============================================================================
--
-- Live validation surfaced multiple "base" lines stacking on one component:
--   * Door: correct base $828 (CH 18ga CRS 3-0x7-0) + two phantom rows
--     ($83 "2070 | LW or C 18", $69 "2070 | H or CH 18") — different size/series.
--   * Frame: correct base $41 + a phantom $98 from an unconditional empty rule.
--
-- Root causes:
--   A. Combined series+gauge tokens ("H or CH 18") were aliased to plain gauge
--      in cpq_v2_clean_rule_condition_vocab, and the meaningless series='null'
--      guard was removed in cpq_v2_drop_literal_null_conditions. Jointly this
--      turned ~36 previously-dead door size-rows live. Originals are preserved
--      in source_phrase, so we restore them and reclassify the aliases to reject.
--   B. Size codes ("2070" = 2'0"x7'0", "240" = 2" face + 4-0 width, "4545100")
--      were stored as width/height bounds, so "width <= 2070" is always true and
--      the row over-matches every size. (216 BASE rules.)
--   C. Unconditional empty BASE rules (" | = 98", no conditions) match every
--      component. (4 frame rules.)
--
-- B & C are mis-extractions: demote to REJECTED (engine loads only APPROVED) and
-- flag for re-ingestion. The correctly-extracted rows (proper inch bounds + full
-- series/gauge/material conditions) are untouched and keep pricing.
-- ----------------------------------------------------------------------------

-- A) Revert the combined series+gauge gauge tokens to their original value so
--    the affected door rows go dead again (they are mis-parsed size rows).
update public.rule_condition
set value_1 = source_phrase,
    normalized_value = lower(source_phrase)
where field_path = 'door.door_gauge'
  and source_phrase in ('H or CH 14', 'H or CH 16', 'H or CH 18', 'LW or C 14', 'LW or C 16', 'LW or C 18');

update public.spec_value_alias
set status = 'reject',
    canonical_value = null,
    notes = coalesce(notes || ' ', '') || '[reverted 2026-06-20: combined series+gauge token on mis-parsed size rows; reject pending re-ingestion]'
where field_path = 'door.door_gauge'
  and raw_value in ('H or CH 14', 'H or CH 16', 'H or CH 18', 'LW or C 14', 'LW or C 16', 'LW or C 18')
  and status = 'alias';

-- C) Neutralize unconditional empty BASE rules.
insert into public.qa_issue (price_book_id, price_rule_id, check_name, severity, detail, status)
select pr.price_book_id, pr.id, 'base_rule_unconditional', 'ERROR',
       'BASE rule ' || pr.id || ' (amount ' || pr.amount || ', raw "' || coalesce(pr.raw_value_text, '') ||
       '") has no conditions and matched every component — demoted to REJECTED; re-ingest with proper conditions.',
       'open'
from public.price_rule pr
where pr.action_type = 'BASE_AMOUNT'
  and pr.review_status = 'APPROVED'
  and not exists (select 1 from public.rule_condition rc where rc.price_rule_id = pr.id)
  and not exists (select 1 from public.qa_issue q where q.price_rule_id = pr.id and q.check_name = 'base_rule_unconditional');

update public.price_rule pr
set review_status = 'REJECTED', updated_at = now()
where pr.action_type = 'BASE_AMOUNT'
  and pr.review_status = 'APPROVED'
  and not exists (select 1 from public.rule_condition rc where rc.price_rule_id = pr.id);

-- B) Neutralize size-code-bound BASE rules (width/height bound >= 200 inches is
--    physically impossible and indicates a concatenated size code).
insert into public.qa_issue (price_book_id, price_rule_id, check_name, severity, detail, status)
select distinct pr.price_book_id, pr.id, 'base_rule_size_code_bound', 'ERROR',
       'BASE rule ' || pr.id || ' (amount ' || pr.amount || ', raw "' || coalesce(pr.raw_value_text, '') ||
       '") has a size-code parsed as a dimension bound (>=200in) and over-matches all sizes — demoted to REJECTED; re-ingest the size grid.',
       'open'
from public.price_rule pr
join public.rule_condition rc on rc.price_rule_id = pr.id
where pr.action_type = 'BASE_AMOUNT'
  and pr.review_status = 'APPROVED'
  and rc.field_path in ('door.nominal_door_width', 'frame.nominal_frame_width', 'door.nominal_door_height', 'frame.nominal_frame_height')
  and rc.operator in ('LTE', 'LT', 'GTE', 'GT', 'BETWEEN')
  and ((rc.value_1 ~ '^[0-9]+$' and rc.value_1::numeric >= 200) or (rc.value_2 ~ '^[0-9]+$' and rc.value_2::numeric >= 200))
  and not exists (select 1 from public.qa_issue q where q.price_rule_id = pr.id and q.check_name = 'base_rule_size_code_bound');

update public.price_rule pr
set review_status = 'REJECTED', updated_at = now()
where pr.action_type = 'BASE_AMOUNT'
  and pr.review_status = 'APPROVED'
  and exists (
    select 1 from public.rule_condition rc
    where rc.price_rule_id = pr.id
      and rc.field_path in ('door.nominal_door_width', 'frame.nominal_frame_width', 'door.nominal_door_height', 'frame.nominal_frame_height')
      and rc.operator in ('LTE', 'LT', 'GTE', 'GT', 'BETWEEN')
      and ((rc.value_1 ~ '^[0-9]+$' and rc.value_1::numeric >= 200) or (rc.value_2 ~ '^[0-9]+$' and rc.value_2::numeric >= 200))
  );
