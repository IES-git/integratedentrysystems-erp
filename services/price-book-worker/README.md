# Price Book Worker

Long-running price-book ingestion for the IES ERP, hosted on **Render** so the
Gemini passes over large (50–100+ page) price books are not killed by the
Supabase Edge Function wall-clock limit.

It does the same work as the `ingest-price-book` and `extract-price-book-table`
Edge Functions, against the same Supabase tables:

- `POST /catalog { priceBookId }` — lists every pricing table in the book and
  inserts a placeholder `price_book_extractions` row + pending
  `pricing_change_proposals` row per table. Returns `202` immediately and runs
  in the background; the app polls `price_books.ocr_status`. Equivalent
  physical-page labels (`14`, `p. 14`, `PDF p. 14`) are canonicalized before
  table deduplication so repeated Gemini catalog rounds cannot create duplicate
  extraction rows for the same printed table. Governed exact-source profiles
  can also seed known small priced blocks (location and classification only,
  never prices) so option tables beside a dominant matrix cannot be silently
  omitted from extraction.
- `POST /extract { extractionId }` — extracts one table's full grid and fills
  the extraction row. For PDFs, the worker uploads only a small page window
  around the cataloged table hint (with offset padding), rather than asking the
  model to re-read the entire book. Synchronous.
- `POST /extract-all { priceBookId }` — extracts all pending tables in the
  background with bounded concurrency.
- `POST /compile { extractionId }` / `POST /compile-all { priceBookId }` —
  compile extracted evidence into canonical price and dependency rules,
  including deterministic propagation of vertically merged Height cells across
  every Width row in the printed span.
- `POST /ingest-hardware { priceBookId }` — deterministic normalized/raw
  hardware workbook ingestion. The normalized master is preflighted before the
  shared hardware catalog is replaced.
- `POST /ingest-ngp-catalog { priceBookId }` — deterministic normalized NGP
  workbook ingestion with sheet, identifier, table-reference, source-page, and
  base-rule completeness checks.
- `GET /health` — liveness probe.

Known sources are SHA-256 fingerprinted and assigned versioned ingestion
profiles. Profile coverage is stored on `price_books` and enforced again by the
application's QA publication gate.

## Audit source files before upload

Run the same PDF/workbook validation used by ingestion without touching the
database:

```bash
npm run audit:sources -- --output ../../docs/supplied-price-book-audit.json \
  /path/to/pioneer.pdf \
  /path/to/ceco.pdf \
  /path/to/de-la-fontaine.pdf \
  /path/to/ngp-prices.pdf \
  /path/to/Hardware_Normalized_Ingestion_Master.xlsx \
  /path/to/NGP_Glass_Lite_Louver_Normalized_Catalog_with_2026_Prices.xlsx
```

The report records hashes, physical PDF page counts, profile/lane selection,
and normalized workbook preflight counts. The command exits non-zero on a
corrupt/incomplete source or a wrong production lane.

All write endpoints require a valid Supabase **user access token** in the
`Authorization: Bearer <token>` header (verified via Supabase Auth). DB/storage
work uses the service-role key.

## Deploy to Render

1. Push this repo to GitHub.
2. In Render: **New + → Blueprint**, select the repo. Render reads
   `services/price-book-worker/render.yaml`.
3. Set these env vars (Render dashboard → the service → Environment):
   - `SUPABASE_URL` — e.g. `https://osgxfggpqecspyvfrvqe.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API → service_role
   - `SUPABASE_ANON_KEY` — Supabase → Project Settings → API → anon/publishable
   - `GEMINI_API_KEY` — Google AI Studio key (same one the Edge Functions used)
   - `ALLOWED_ORIGINS` — your app origin(s), comma-separated (e.g.
     `https://your-app.com,http://localhost:8080`), or `*`
4. Deploy. Note the service URL, e.g. `https://price-book-worker.onrender.com`.

## Point the frontend at the worker

In the Vite app's `.env`:

```
VITE_PRICE_BOOK_WORKER_URL=https://price-book-worker.onrender.com
```

When set, the app calls this worker for cataloging and grid extraction. When
unset, it falls back to the Supabase Edge Functions.

> Render's free/Starter web services sleep when idle and cold-start on the next
> request — the first call after idle may take ~30–60s extra. Use a paid
> instance or a periodic `/health` ping if that matters.

## Local development

```bash
cp .env.example .env   # fill in values
npm install
npm run dev            # http://localhost:8080
```
