-- ============================================================================
-- Phase 1: remove blank-cell "null" equality conditions.
-- ============================================================================
--
-- 505 rule_condition rows test `field EQ 'null'` (the literal string), an
-- artifact of blank source cells during extraction. The builder never emits the
-- string "null", so each such condition can never match and silently kills the
-- whole rule (including BASE_AMOUNT rules -> unreachable base prices).
--
-- Removing a meaningless equality is strictly an improvement: the rule then
-- matches on its remaining real conditions. Any resulting identical-signature
-- overlaps are handled by cpq_v2_assign_exclusive_groups (runs next).
--
-- An INFO qa_issue is logged per affected rule for traceability before deletion.
-- ----------------------------------------------------------------------------

insert into public.qa_issue (price_book_id, price_rule_id, check_name, severity, detail, status)
select distinct pr.price_book_id,
       pr.id,
       'condition_blank_artifact',
       'INFO',
       'Removed blank-cell condition (' || rc.field_path || " EQ 'null'); rule now matches on its remaining conditions.",
       'resolved'
from public.rule_condition rc
join public.price_rule pr on pr.id = rc.price_rule_id
where rc.operator = 'EQ' and rc.value_1 = 'null'
  and not exists (
    select 1 from public.qa_issue q
    where q.price_rule_id = pr.id and q.check_name = 'condition_blank_artifact'
  );

delete from public.rule_condition
where operator = 'EQ' and value_1 = 'null';
