-- CPQ v2 — Publish the complete NGP catalog and supersede the obsolete partial doc.
--
-- Context: two price_book_documents titled "NGP" exist:
--   * adfdd074-f984-440b-8b52-ae358b15cbf9 (published) — OLDER partial ingest:
--       0 ngp_product catalog rows, 5 price_tables, 147 'option' specialty rules.
--   * cb183520-440e-4d04-9ff9-c85a4a6524c2 (draft) — COMPLETE re-ingest:
--       83 ngp_product rows, 50 price_tables, ~18k rules (lite_kit/louver/glass/
--       glazing_tape/option adders + commercial policies).
--
-- The builder's resolveActiveNgpDocument() requires a *published* document that
-- has ngp_product rows. The only doc with products was still in draft, so the
-- opening builder reported "No published NGP catalog found" even though NGP
-- pricing data exists. This publishes the complete doc and supersedes the older
-- partial one (which cb183520 fully replaces). Reversible: flip statuses back.

begin;

-- Publish the complete NGP re-ingest and record lineage over the partial doc.
update public.price_book_document
set status = 'published',
    review_status = 'APPROVED',
    supersedes_id = 'adfdd074-f984-440b-8b52-ae358b15cbf9',
    updated_at = now()
where id = 'cb183520-440e-4d04-9ff9-c85a4a6524c2';

-- Retire the obsolete partial NGP doc so it drops out of the published set.
update public.price_book_document
set status = 'superseded',
    updated_at = now()
where id = 'adfdd074-f984-440b-8b52-ae358b15cbf9';

commit;
