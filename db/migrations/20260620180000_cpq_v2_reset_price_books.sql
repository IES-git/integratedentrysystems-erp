-- ============================================================================
-- DEV RESET: wipe all price-book / rule / catalog data for a clean re-ingest.
-- ============================================================================
--
-- One-off maintenance reset (development only, no production users). Clears every
-- ingestion-derived row so the price books can be re-uploaded and re-compiled
-- with the hardened size-code parser. Uses DELETE (not TRUNCATE) so declared FK
-- actions are honored: ON DELETE CASCADE removes children, ON DELETE SET NULL
-- PRESERVES the kept tables (product_family, estimates, estimate_line refs).
--
-- KEPT (seeded dictionary / governance / user data):
--   opening_spec_field, spec_field_mapping, option_definition, product_family,
--   hardware_prep_crosswalk, hardware_set_template, hardware_set_item,
--   spec_value_alias, service_scope, hardware_sell_rule,
--   companies, contacts, users, estimates, estimate_items, item_fields,
--   estimate_openings.
--
-- The 'price-book-files' storage bucket is emptied at the end.
-- ----------------------------------------------------------------------------

-- 1. Engine output (price-derived).
delete from public.estimate_line;
delete from public.manual_quote_queue;
delete from public.quote_hardware_line;

-- 2. Hardware catalog (independent of price_book_document; prep_crosswalk +
--    linear rule refs are ON DELETE SET NULL so the seeded crosswalk survives).
delete from public.hardware_compatibility_rule;
delete from public.linear_hardware_rule;
delete from public.hardware_attribute;
delete from public.hardware_price;
delete from public.hardware_variant;
delete from public.hardware_product;
delete from public.hardware_price_book;
delete from public.hardware_template;

-- 3. Legacy grid pricing model (deprecated).
delete from public.pricing_adder_cells;
delete from public.pricing_cells;
delete from public.pricing_rows;
delete from public.pricing_columns;
delete from public.pricing_table_items;
delete from public.pricing_tables;
delete from public.pricing_table_vendors;
delete from public.pricing_cell_history;
delete from public.pricing_exceptions;

-- 4. Rule layer + extractions + documents. Deleting price_book_document CASCADEs
--    to price_rule (+rule_condition, rule_action_parameter, included_scope,
--    quantity_tier), price_table (+ngp_price_table_map), source_region
--    (+raw_table_cell), qa_issue, dependency_rule, pricing_change_proposals, and
--    every ngp_* table; and SET NULLs product_family / estimates / estimate_line.
delete from public.external_scope_requirement;
delete from public.price_books;           -- CASCADE: price_book_extractions, change proposals
delete from public.price_book_document;   -- CASCADE: rules, tables, source, qa, ngp_*, deps

-- 5. Belt-and-suspenders: clear any rows whose parent FK was SET NULL (so nothing
--    ingestion-derived lingers). No-ops if the cascade already cleared them.
delete from public.price_book_extractions;
delete from public.pricing_change_proposals;
delete from public.qa_issue;
delete from public.price_rule;
delete from public.rule_condition;
delete from public.price_table;
delete from public.source_region;
delete from public.raw_table_cell;
delete from public.dependency_rule;
delete from public.ngp_product_attribute;
delete from public.ngp_product;
delete from public.ngp_kit_glass_capacity;
delete from public.ngp_glass_rating;
delete from public.ngp_size_rule;
delete from public.ngp_relationship;
delete from public.ngp_finish_code;
delete from public.ngp_option;
delete from public.ngp_commercial_policy;
delete from public.ngp_price_table_map;

-- 6. The 'price-book-files' storage bucket must be emptied via the Storage API
--    or the Supabase Dashboard (Storage → price-book-files → select all → delete);
--    direct DELETE on storage.objects is blocked by a guard trigger. Orphaned
--    source files are harmless (re-upload creates fresh objects) but can be
--    cleared for tidiness.
