-- A published document is eligible for automatic pricing only after the
-- governed source/profile QA gate verifies the exact source revision.

alter table public.price_book_document
  add column if not exists source_verified boolean not null default false,
  add column if not exists source_verified_at timestamptz;

create index if not exists price_book_document_active_verified_idx
  on public.price_book_document (status, source_verified, effective_date desc);

comment on column public.price_book_document.source_verified is
  'True only after exact-source identity, ingestion coverage, normalized rule/entity, and QA checks pass.';
comment on column public.price_book_document.source_verified_at is
  'Timestamp when the governed publication gate last verified this immutable document revision.';
