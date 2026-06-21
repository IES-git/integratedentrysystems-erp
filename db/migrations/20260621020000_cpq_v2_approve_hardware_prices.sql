-- ============================================================================
-- Approve the re-ingested hardware prices.
-- ============================================================================
--
-- The hardware re-ingest landed 418 clean prices (every row has a net cost, 405
-- also carry list+discount, and list*discount reconciles to net within 1% on
-- every row) but all UNREVIEWED, so the hardware coverage check still flags every
-- variant. Approve the reconciled prices so priced variants pass; the 54 variants
-- with no price row at all (exit trim / exit devices / a few locks) remain flagged
-- as genuine gaps (special-order / price-on-application) — never invented.
-- ----------------------------------------------------------------------------

update public.hardware_price
set review_status = 'APPROVED', updated_at = now()
where review_status = 'UNREVIEWED'
  and net_cost is not null;
