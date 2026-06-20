-- ============================================================================
-- Phase 6 cutover: retire the legacy grid pricing model.
-- ============================================================================
--
-- This migration is intentionally NOT applied automatically. It is the final
-- destructive step of the Pioneer spec-pricing overhaul and must only be run
-- once ALL of the following preconditions hold (see plan Phase 6):
--
--   1. The Pioneer May-2025 price book is ingested and published as a
--      `price_book_document` with APPROVED `price_rule`s (today: 0 documents,
--      0 rules — DO NOT RUN YET).
--   2. The pricing engine passes round-trip QA on the Pioneer book
--      (Example Opening fixture + QA publication gate green).
--   3. The 3 existing estimates have been migrated/re-entered into the engine
--      model via `migrateAllEstimates()` (src/lib/cpq/migrate-estimates.ts) and
--      verified in the auditable ReviewStep.
--   4. The legacy grid editors are removed from the UI (NewOpeningPage grid path,
--      AddItemModal grid lookup, pricing-lookup.ts consumers) so nothing reads
--      these tables at runtime.
--
-- Apply with the Supabase migration tool once gated, e.g.:
--   apply_migration name=cpq_v2_retire_legacy_grid query=<contents of this file>
--
-- The new pipeline never WRITES these tables; they are read-only after the
-- Phase 2.0 bridge. Dropping them removes the last of the grid model.
-- ----------------------------------------------------------------------------

begin;

-- Child tables first (FKs reference pricing_tables / columns / rows).
drop table if exists public.pricing_adder_cells cascade;
drop table if exists public.pricing_cells cascade;
drop table if exists public.pricing_rows cascade;
drop table if exists public.pricing_columns cascade;
drop table if exists public.pricing_tables cascade;

commit;
