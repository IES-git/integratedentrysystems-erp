-- ============================================================================
-- Post-reingest cleanup: approve clean rules + triage non-blocking warnings.
-- ============================================================================
--
-- After the vocabulary cleanup, 452 PRICED rules that cite a source region and
-- hold NO reject-flagged condition value remain UNREVIEWED, so they don't price.
-- Auto-approve those clean rules. Rules still referencing a reject value stay
-- UNREVIEWED/REJECTED for re-ingestion. Also triage the per-foot unit_basis
-- warnings (perimeter-formula modeling gap; non-blocking).
-- ----------------------------------------------------------------------------

update public.price_rule pr
set review_status = 'APPROVED', updated_at = now()
where pr.review_status = 'UNREVIEWED'
  and pr.price_status = 'PRICED'
  and pr.source_region_id is not null
  and not exists (
    select 1 from public.rule_condition rc
    join public.spec_value_alias a
      on a.status = 'reject' and a.field_path = rc.field_path
     and lower(btrim(rc.value_1)) = lower(btrim(a.raw_value))
    where rc.price_rule_id = pr.id
  );

update public.qa_issue
set status = 'resolved',
    detail = detail || ' [triaged: per-foot linear charge needs a perimeter quantity-formula model]',
    updated_at = now()
where check_name = 'unit_basis' and status = 'open';
