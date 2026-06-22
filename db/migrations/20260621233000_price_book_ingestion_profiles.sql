-- Governed source identity + coverage metadata for repeatable price-book ingestion.

alter table public.price_books
  add column if not exists source_sha256 text,
  add column if not exists source_page_count integer,
  add column if not exists ingestion_profile_key text,
  add column if not exists ingestion_profile_version text,
  add column if not exists ingestion_coverage jsonb not null default '{}'::jsonb;

alter table public.price_books
  drop constraint if exists price_books_source_sha256_check;
alter table public.price_books
  add constraint price_books_source_sha256_check
  check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$');

create index if not exists price_books_source_sha256_idx
  on public.price_books (source_sha256);
create index if not exists price_books_ingestion_profile_idx
  on public.price_books (ingestion_profile_key, ingestion_profile_version);

alter table public.price_book_document
  add column if not exists ingestion_profile_key text,
  add column if not exists ingestion_profile_version text;

create index if not exists price_book_document_ingestion_profile_idx
  on public.price_book_document (ingestion_profile_key, ingestion_profile_version);

comment on column public.price_books.source_sha256 is
  'SHA-256 fingerprint of the exact uploaded source bytes; used to select a governed ingestion profile.';
comment on column public.price_books.ingestion_coverage is
  'Catalog-stage coverage report: required categories/sections, table count, and unresolved gaps.';
comment on column public.price_book_document.ingestion_profile_key is
  'Governed source profile used to ingest and validate this immutable document revision.';
