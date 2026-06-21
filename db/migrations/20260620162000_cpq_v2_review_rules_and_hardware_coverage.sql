-- ============================================================================
-- Phase 3: approve clean rules + surface hardware price gaps.
-- ============================================================================
--
-- A) The engine only loads APPROVED price_rules (loader.ts). 1,445 rules were
--    PRICED but left UNREVIEWED, so their configurations silently fail to
--    price. Auto-approve only the CLEAN ones: PRICED, citing a source region,
--    and with NO condition value flagged 'reject' in spec_value_alias. Rules
--    that still reference unrecoverable values stay UNREVIEWED and remain
--    tracked by the existing vocab_unrecoverable qa_issue (re-ingest, not guess).
--
-- B) Hardware variants with no APPROVED price route to manual quote with no
--    visibility. Flag each one as a hardware_missing_price qa_issue so the gap
--    is sourced (we never invent a price). Idempotent: clears prior open rows.
-- ----------------------------------------------------------------------------

-- A) approve clean unreviewed rules
update public.price_rule pr
set review_status = 'APPROVED',
    updated_at = now()
where pr.review_status = 'UNREVIEWED'
  and pr.price_status = 'PRICED'
  and pr.source_region_id is not null
  and not exists (
    select 1
    from public.rule_condition rc
    join public.spec_value_alias a
      on a.status = 'reject' and a.field_path = rc.field_path and btrim(rc.value_1) = a.raw_value
    where rc.price_rule_id = pr.id
  );

-- B) flag unpriced hardware variants
delete from public.qa_issue where check_name = 'hardware_missing_price' and status = 'open';

insert into public.qa_issue (price_book_id, check_name, severity, detail, status)
select '60a0c50d-0870-4d18-8871-e84bcd07e684'::uuid,
       'hardware_missing_price',
       'ERROR',
       'Variant ' || coalesce(hv.sku, hv.id::text) || ' (' || hp.category || ' / '
         || coalesce(hp.model, hp.description, 'unnamed') || ') has no approved price; selections route to manual quote.',
       'open'
from public.hardware_variant hv
join public.hardware_product hp on hp.id = hv.hardware_product_id
where not exists (
  select 1 from public.hardware_price p
  where p.hardware_variant_id = hv.id and p.review_status = 'APPROVED'
);
