-- Prevent pre-governance catalog output from being selected by older deployed
-- clients that do not yet filter on price_book_document.source_verified.
--
-- This is intentionally reversible and non-destructive: rules, source regions,
-- staging rows, and Storage objects remain available for audit and rollback.

update public.price_book_document
set
  status = 'archived',
  notes = concat_ws(
    E'\n',
    nullif(notes, ''),
    'Archived during governed price-book cutover: this document was published before exact-source verification and must be re-ingested before automatic pricing.'
  ),
  updated_at = now()
where status = 'published'
  and source_verified = false
  and ingestion_profile_key is null;

comment on column public.price_book_document.source_verified is
  'True only after exact-source identity, ingestion coverage, normalized rule/entity, and QA checks pass. Unverified legacy published documents were archived during the 2026-06 governed cutover.';
