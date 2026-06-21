-- ============================================================================
-- Phase 6 cutover: retire the legacy grid pricing model.
-- ============================================================================
--
-- This migration is intentionally NOT applied automatically. It is the final
-- destructive step of the Pioneer spec-pricing overhaul and must only be run
-- once ALL of the preconditions below hold (see plan Phase 4 / Phase 6).
--
-- TARGET CUTOVER DATE: 2026-07-15 (review status one week prior).
--
-- Precondition status as of 2026-06-20:
--   1. [DONE] Price books ingested + published as `price_book_document`s with
--      APPROVED `price_rule`s: Pioneer Pricing Main (3,118), NGP (18,704),
--      Hardware (77). 21,738 rules APPROVED after the Phase 1 cleanup.
--   2. [DONE] Engine passes round-trip QA: Example Opening fixture + the QA
--      publication gate (now incl. the vocabulary check) are green
--      (src/test/pricing-engine.test.ts, src/test/qa-checks.test.ts).
--   3. [PENDING] The 3 existing estimates must be migrated into the engine
--      model via `migrateAllEstimates()` (src/lib/cpq/migrate-estimates.ts) and
--      verified in the auditable ReviewStep so `estimate_line` is populated.
--   4. [PENDING] Remove the legacy grid editors from the UI so nothing reads
--      these tables at runtime:
--        - BuildOpeningDialog.tsx + AddItemModal grid lookup
--        - NewOpeningPage grid path
--        - pricing-lookup.ts consumers (ReviewStep "Refresh Prices",
--          cpq/service.ts, live-pricing.ts legacy branch)
--      The unified SpecOpeningBuilder is already the primary OpeningsStep flow.
--
-- Apply with the Supabase migration tool once preconditions 3 & 4 are met, e.g.:
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
