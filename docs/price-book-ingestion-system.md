# Price Book Ingestion and Spec-Driven Pricing

## Outcome

The pricing system is built around one canonical opening specification and
immutable manufacturer price-book revisions. A door, frame, or panel component
selects a manufacturer and an approved price-book document. The same normalized
spec can then be priced against Pioneer, CECO, De La Fontaine, or another
manufacturer without rewriting the opening in vendor-specific terminology.

Every priced estimate line retains:

- the selected manufacturer document;
- the matched canonical rule;
- the source table region and printed page;
- the calculation expression and matched conditions;
- explicit Included, No Charge, Not Applicable, and Contact Factory statuses.

## Canonical flow

1. Upload a source document.
2. Create an immutable draft `price_book_document`.
3. Catalog every printed pricing table or priced section.
4. Extract a small page window for each PDF table.
5. Preserve all nonblank raw cells, not only numeric prices.
6. Compile deterministic canonical rules and conditions.
7. Run QA and estimator review.
8. Publish the approved document.
9. Select a manufacturer per opening component.
10. Price the normalized spec and persist auditable estimate lines.

The AI helps locate and read printed tables. It does not decide final pricing
semantics by itself. Rule compilation, vocabulary normalization, status
handling, document selection, and estimate calculation are deterministic.

## Source-specific ingestion lanes

Every uploaded source is SHA-256 fingerprinted before processing. Known source
families attach a versioned ingestion profile that declares the required lane,
minimum catalog coverage, expected sections, and required base-rule entities.
The publication gate rejects a partial catalog, the wrong source lane, a page
count mismatch for a known PDF, or a normalized workbook that fails preflight.

### Steel doors, frames, panels, and manufacturer adders

Use the PDF lane for Pioneer, CECO, and De La Fontaine:

- catalog the complete book;
- record physical PDF page indices (cover = page 1), not section labels such as
  `R-2`, `D-4`, or `S-10`;
- extract each table from a bounded PDF page window;
- reconstruct vertically merged dimension cells (for example, one printed
  height spanning several width rows) into explicit row-level size conditions;
- retain exact source values such as `N/C`, `N/A`, `CF`, and `Included`;
- normalize dimensions, material, gauge, core, edge construction, wall
  construction, and assembly method;
- use vendor series only as a fallback when no safe canonical selector exists.

Each governed PDF profile also declares minimum priced-table counts by physical
page band. This prevents a catalog that happens to mention every section name
from passing while omitting most tables inside a long section. Enumeration is
allowed up to 500 tables. Catalog identity normalizes equivalent page hints such
as `14`, `p. 14`, and `PDF p. 14` before deduplication. Enumeration must reach a
no-new-table stopping point; for an exact governed source, a truncated no-new
response is accepted only after the independent category, section-anchor, and
physical-page-band profile checks already pass. Hitting the table cap,
exhausting rounds, or failing profile coverage blocks publication.

Exact-source profiles may also seed structural entries for small independently
priced blocks that vision cataloging tends to overlook beside a large matrix.
These seeds contain only the printed block title, physical page, category,
series, and table kind. Prices are still extracted from the bounded source PDF
window and remain subject to the same evidence, compiler, and QA gates.

Manufacturer identity comes from `price_book_document.manufacturer_id`, not from
embedding a vendor name in the opening spec.

### NGP lites, louvers, glass, glazing tape, and related accessories

NGP has dimensional matrices, per-foot pricing, option percentages, fabrication
charges, and assembly relationships. Its production ingestion lane remains the
normalized NGP workbook importer because it can model these relationships
deterministically.

The raw NGP PDF is source evidence and an onboarding input. Before publication,
convert it to the normalized workbook schema expected by `src/ngp.js`, then run
the NGP-specific compiler and QA checks.

When an NGP workbook is uploaded with the lites/louvers/glass category, the UI
routes it directly to this deterministic importer. It does not waste time
cataloging the workbook through the generic PDF/spreadsheet table detector.
After preflight and import, the operator gets a direct QA-gated Publish action.

### Hardware

Use `Hardware_Normalized_Ingestion_Master.xlsx` through the hardware workbook
importer. The importer recognizes its normalized sheet contract, validates it
before any catalog replacement, and then loads products, variant attributes,
price observations, prep crosswalk rows, and category-level linear rules.
Product identity, list prices, discounts, net costs, review status, and
conflicts remain separate from door/frame preparation charges.

For the supplied normalized master, preflight currently reports 301 products,
494 price observations, 1,228 attributes, and 22 prep-crosswalk rows. Only the
346 rows marked import-ready and free of conflicts become approved prices; the
remaining 148 stay visible for review instead of being silently accepted.

The hardware upload follows the same direct route. Its review screen shows every
price observation, defaults to the 148 unresolved rows, permits explicit
approve/reject decisions and net-cost correction, and only enables finalization
after no rows remain undecided.

Hardware devices and manufacturer preparation charges must never be merged into
one price:

- hardware catalog: actual hinge, lock, closer, exit device, seal, and accessory;
- door/frame book: machining, reinforcement, welding, anchor, packaging, and
  preparation charges.

## Canonical selector model

Rules should prefer these manufacturer-neutral selectors:

| Product | Canonical selectors |
| --- | --- |
| Door | core type, edge/seam construction, gauge, material, width, height, rating/performance |
| Frame | wall construction, frame type, assembly/welding, gauge, material, jamb depth, width, height |
| Panel | role, construction, core, edge, gauge, material, width, height |
| Lite/louver/glass | product model, cutout/visible size, material, rating, glass/tape inclusion |
| Hardware | category, manufacturer, model/SKU, function, finish, size, hand, voltage, rating |

A vendor series remains useful metadata and may be needed for exceptional rules,
but it should not be the only way a normal base product can match.

## Publication gate

A document should not become selectable in the estimate wizard until:

- all expected source sections are cataloged;
- every base table has source cells and at least one compiled base rule;
- semantic status cells compile to explicit status rules;
- dimensions and enum values pass governed-vocabulary validation;
- duplicate or overlapping base rules are resolved;
- required source pages are present;
- Contact Factory and manual-quote cases are explicit;
- representative golden openings reproduce reviewed prices;
- the document is `published` and `APPROVED`.

Recommended acceptance targets:

- 100% of reviewed base tables represented;
- 100% of nonblank monetary/status cells preserved as evidence;
- 0 silent zero-dollar fallbacks;
- 0 published rules with rejected vocabulary;
- 0 components priced from more than one manufacturer document;
- exact agreement on a reviewed sample of common and edge-case openings.

The source-profile gate is additive to estimator review. Passing structural
coverage proves that the expected source areas were processed; it does not
claim that every interpreted rule is commercially correct.

`BLOCK` findings (wrong source lane, failed normalized-workbook contract,
missing required manufacturer entities, or incomplete governed catalog
coverage) cannot be overridden. Ordinary `ERROR` findings can still use the
existing explicit estimator override when business policy allows it.

## Manufacturer selection and reproducibility

The builder lists only manufacturers with an approved published document for
the component type. Selecting a manufacturer pins the component to that
immutable document.

For a mixed opening, such as a CECO door and De La Fontaine frame:

- each component loads rules only from its pinned document;
- derived door/frame preparations inherit their owning component's document;
- each estimate line stores its own `price_book_id`;
- the opening snapshot and resolution revision store the component-to-document
  map;
- the estimate-level `price_book_id` remains null because no single document
  represents the whole opening.

## Onboarding sequence

1. Ingest and approve one representative standard door base table per steel
   manufacturer.
2. Validate the same canonical door spec against all available manufacturers.
3. Add door core/material/gauge/size adders and preparation tables.
4. Repeat for standard masonry and drywall frames.
5. Add panels and specialty assemblies.
6. Import the normalized NGP workbook for lites, louvers, glass, and tape.
7. Import and resolve the hardware master workbook's review/conflict rows.
8. Build golden opening fixtures covering:
   - single and pair openings;
   - masonry and drywall;
   - common core/edge/gauge combinations;
   - lites, louvers, glass, and glazing tape;
   - standard and special hardware preparations;
   - Included, N/C, N/A, Contact Factory, and oversize cases;
   - mixed-manufacturer openings.

The first connected acceptance fixture is already source-reviewed in
[`supplied-source-golden-cases.json`](./supplied-source-golden-cases.json): the
same 36 x 84, 18-gauge, honeycomb, lockseam, galvannealed door is priced from
Pioneer, CECO, and De La Fontaine. It deliberately records each manufacturer's
different included-preparation scope so a superficially similar base price
cannot hide missing or double-counted preparation charges.

The supplied-source fingerprints, page counts, and normalized workbook
preflight counts are recorded in
[`supplied-price-book-audit.md`](./supplied-price-book-audit.md), with a
machine-readable companion in
[`supplied-price-book-audit.json`](./supplied-price-book-audit.json). The
worker's `npm run audit:sources` command regenerates that report from the actual
source bytes before upload.

## Deployment prerequisites

Before connected ingestion can run:

1. Apply `db/migrations/20260621233000_price_book_ingestion_profiles.sql`.
2. Apply `db/migrations/20260622010000_price_book_source_verification.sql`.
3. Apply `db/migrations/20260622013000_archive_unverified_price_books.sql`.
4. Deploy the updated price-book worker with its Supabase service-role and
   Gemini credentials.
5. Upload each source through an authenticated admin session.
6. Process, review, and publish one immutable document revision per source.
7. Run golden opening fixtures against the published documents.

The connected application database audited on June 21, 2026 contained legacy
pre-change Pioneer, NGP, and hardware ingestion output. Those records are kept
as audit evidence but have `source_verified = false`; they are not eligible for
automatic manufacturer selection in the new estimator code. CECO and De La
Fontaine had not previously been uploaded.

## Legacy catalog cutover

Do not delete a previous catalog before its replacement passes the new
source-profile and golden-opening checks:

1. Upload the exact governed source as a new immutable revision.
2. Run its source-specific ingestion lane and complete review.
3. Run QA. Only the governed QA publication path sets
   `price_book_document.source_verified = true`.
4. Validate the source-reviewed golden cases against the connected pricing
   engine.
5. Publish the replacement with `supersedes_id` pointing to the prior document.
6. Retain the superseded source and rules for audit/rollback; archive or delete
   only under an explicit retention policy.

## Operational rule

Never edit a published document in place. Upload a new effective revision,
ingest and review it, publish it, and let new estimates select the new document.
Existing estimates continue to point to the exact revisions used when priced.
