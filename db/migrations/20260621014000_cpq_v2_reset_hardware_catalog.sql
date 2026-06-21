-- ============================================================================
-- DEV RESET: hardware catalog only (duplicated / double-sourced re-ingest).
-- ============================================================================
--
-- The hardware catalog was ingested more than once from two differently-
-- formatted sources: 944 variants but only ~616 unique (~328 duplicates), mixed
-- category vocabularies (clean + raw abbreviations), all 836 prices UNREVIEWED,
-- and 3 hardware price_book_documents (2 "Hardware" + "Hardware Pricing").
--
-- Wipe the hardware catalog + its documents so it can be re-ingested ONCE via the
-- dedicated "Ingest hardware" importer. Pioneer + NGP are untouched. Seeded
-- config (hardware_prep_crosswalk, hardware_set_template/_item, hardware_sell_rule)
-- is preserved (their variant/product refs are ON DELETE SET NULL).
-- ----------------------------------------------------------------------------

-- 1. Hardware price_book_documents (CASCADE removes their price_rule /
--    rule_condition / price_table / source_region / raw_table_cell / qa_issue).
delete from public.price_book_document
where id in (
  'bceb65a3-9be8-49b5-a233-f0341390c8da',  -- Hardware (published)
  '8dc8142b-2eba-4369-ab5b-71b04a8ac15c',  -- Hardware (draft)
  '2b3c9f94-59d7-4ba8-8422-4cba1820f676'   -- Hardware Pricing (published)
);

-- 2. Uploaded hardware book records + extractions (CASCADE).
delete from public.price_books where category = 'hardware';

-- 3. Hardware catalog tables. Deleting hardware_product CASCADEs to
--    hardware_variant -> hardware_attribute + hardware_price.
delete from public.hardware_compatibility_rule;
delete from public.linear_hardware_rule;
delete from public.hardware_product;
delete from public.hardware_price_book;
delete from public.hardware_template;

-- 4. Clear the (now stale) hardware coverage QA findings.
delete from public.qa_issue where check_name in ('hardware_missing_price', 'net_reconciliation');
