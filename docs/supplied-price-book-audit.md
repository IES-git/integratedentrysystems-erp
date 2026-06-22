# Supplied Price Book Source Audit

Audited June 21, 2026.

## Governed PDF sources

| Source | Profile | Effective | Pages | SHA-256 | Production lane |
| --- | --- | --- | ---: | --- | --- |
| Pioneer Pricing and Estimating Guide 2025 | `pioneer-steel-doors-frames` | 2025-05-01 | 103 | `ef32d45501233ff59e06311abc0dce91f310a439dd0015b61b2b13b482abcf27` | PDF catalog, page-window extraction, deterministic rule compilation |
| CECO Price Book | `ceco-steel-doors-frames` | 2026-04-20 | 167 | `e491ce09add14b4ccd193a146817a6929c07120821153a9ae7aaacd22d888101` | PDF catalog, page-window extraction, deterministic rule compilation |
| De La Fontaine Price Book rev. 3.1 | `de-la-fontaine-steel-doors-frames` | 2023-09-01 | 146 | `7d17f56a7f907b473b8c7d9022a3a23e7dc5a54010bf8949c31e128f60a84802` | PDF catalog, page-window extraction, deterministic rule compilation |
| NGP prices | `ngp-infill-2026` | 2026-06-08 | 88 | `9ddb400c994d7416c04a488ae2be3bd29214f4ace40f9233bfe464e78ec2d2f7` | Source evidence; production pricing uses the normalized NGP workbook |

The known PDF page counts are publication invariants. A matching source hash
with a different recorded page count blocks publication.

## Normalized hardware master

Source fingerprint:
`2ba88d8eba90c772a47757214c059d4bee1777e0c38384ec6dc4634915cb4d75`

Deterministic preflight:

| Check | Count |
| --- | ---: |
| Products / variants | 301 |
| Price observations | 494 |
| Approved import-ready prices | 346 |
| Review prices | 148 |
| Attributes | 1,228 |
| Prep crosswalk rows | 22 |
| Workbook QA issue rows | 291 |

The importer uses the workbook's `Ingestion View.import_ready` decision. It
does not infer approval from a price merely being present.

## Normalized NGP catalog

Source fingerprint:
`8e2a19c925d81ca9c4aa221fbf1b3a954e7a5f23131346e758b7a69f285522e5`

Deterministic preflight:

| Check | Count |
| --- | ---: |
| Worksheets | 22 |
| Products | 83 |
| Product attributes | 118 |
| Kit/glass capacity rows | 114 |
| Glass ratings | 17 |
| Price tables | 33 |
| Base matrix rules | 15,695 |
| Direct rules | 131 |
| Option rules | 18 |
| Total pricing rules | 15,844 |
| Missing source pages | 0 |

The workbook currently has one non-blocking warning: two mapped models do not
appear in the `Products` sheet. Missing required sheets, duplicate identifiers,
unresolved price-table references, missing source pages, or incomplete base
rules block ingestion.

## Canonical source interpretations verified

- Pioneer H/CH/EH families map to honeycomb construction, with lockseam,
  continuous-weld, or embossed edge construction as printed.
- CECO RI, LP, and MS families map to honeycomb, polystyrene, and
  steel-stiffened cores.
- De La Fontaine HC, PS, PU, ST, and TR families map to honeycomb,
  polystyrene, polyurethane, steel-stiffened, and temperature-rise cores.
- Pioneer F and De La Fontaine SR frame families map to masonry construction.
- Pioneer/De La Fontaine DW and related drywall series map to
  steel-stud/wood-stud/drywall construction.

These mappings create manufacturer-neutral rule selectors. Manufacturer
identity remains pinned by the immutable price-book document selected for each
opening component.

## Re-run the audit

The machine-readable result is
[`supplied-price-book-audit.json`](./supplied-price-book-audit.json). Recreate
it from the actual source files with:

```bash
cd services/price-book-worker
npm run audit:sources -- --output ../../docs/supplied-price-book-audit.json \
  /path/to/pioneer.pdf \
  /path/to/ceco.pdf \
  /path/to/de-la-fontaine.pdf \
  /path/to/ngp-prices.pdf \
  /path/to/Hardware_Normalized_Ingestion_Master.xlsx \
  /path/to/NGP_Glass_Lite_Louver_Normalized_Catalog_with_2026_Prices.xlsx
```

The command exits non-zero if a PDF is unreadable or has the wrong page count,
if a normalized workbook fails its sheet/data contract, or if a production
input is being routed through the wrong ingestion lane.
