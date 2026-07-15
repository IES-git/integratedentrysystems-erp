# Updated CPQ Implementation Roadmap

## Summary

This is the curated CPQ roadmap for the IES ERP app. The first implementation slice prioritizes a usable Paul/Mark estimating-to-quote loop: account access, customer/job setup, opening fixes, quote preview/print, and source-preserving quote detail.

The app remains the operational system for estimating, quote detail, catalog, BOM, kitting, and prep data. QuickBooks remains the accounting system of record.

## Delivery Status - July 13, 2026

Implemented in the application and covered by the current build/test suite:

- The P0 estimating-to-quote workflow, including job setup, architectural size display, independent door/frame specifications, ratings/transoms, manual-quote routing, and snapshot-preserving quote revisions.
- Separate lite/glass cutout, kit-order, visible-glass, and glass-type details in quote and operational outputs.
- Hardware catalog source/audit fields, multiplicative chain discounts, admin review states, and in-estimate staging into a reusable review queue.
- Quote display configuration v2, customer defaults, saved detail snapshots, and customer-safe PDFs.
- BOM, vendor CSV, kitting, customer approval links, and procurement/receiving/staging/fulfillment tracking from durable quote data.

Pending external verification or source data:

- Run the Paul password-reset/sign-in and complete demo-path acceptance test in the deployed environment.
- Import the requested row-868 hardware record after the original workbook/tab or expected part number is supplied. The only supplied workbook extending to physical row 868 has a blank row 868; the optimized source ends at row 349.

Remaining P3 scope:

- Full AI-assisted price-book ingestion automation.
- A complete vendor-specific template library.
- Operations analytics beyond the quote-to-fulfillment dashboard.
- QuickBooks handoff and reconciliation.

## P0 - Usable Quote Loop

### Access And Usability

- Verify Paul can reset password, sign in, and reach the app.
- Improve Help Guide readability in dark mode.
- Route manufacturers into the shared company detail/contact experience used by customers.
- Add billing/shipping copy controls so company addresses can be reused without retyping.
- Ensure estimate to quote to preview/print works from the demo path.

### Job Setup

- Add a `Job Setup` wizard step between `Customer` and `Openings`.
- Prompt for and require job name before opening creation.
- Extend estimates with:
  - job name
  - job location
  - job number
  - customer PO
  - quote date
  - shipping method
  - terms
  - delivery
  - ship-to source and address override
  - customer contact
  - customer rep name, phone, and email
  - internal notes
- Update estimates list/search to include job name, customer, PO/job number, quote status, and opening summary.

### Opening Builder

- Standardize size entry around `3070` input with `3-0 x 7-0` display.
- Decouple door gauge and frame gauge.
- Update material values.
- Alias Lockseam to brand-neutral `Invisible seam`.
- Improve handing groups and pair inference.
- Move ratings before lites/preps.
- Add transom and panel dimensions.
- Route unsupported stainless/custom/special cases to manual quote.

### Lites And Glass

- Store and display cutout size, kit ordered size, visible glass size, and glass type separately.
- Quote and order outputs must show cutout/kit size clearly.

### Hardware MVP

- Extend hardware catalog models for row-source fields, taxonomy cleanup, active/inactive state, approval state, updated-by, and last-updated tracking.
- Add/edit hardware catalog admin UI.
- Support add-on-the-fly hardware from estimating, with reusable or review-staged behavior.
- Ensure chain discounts such as `50/20` calculate multiplicatively.

### Quote Output

- Replace one-line quote collapse with saved quote detail snapshots sourced from `estimate_line`.
- Keep `estimate_line` as the authoritative source for customer quotes, internal detail, vendor exports, BOM, and kitting.
- Add QuoteDisplayConfig v2 options:
  - organization mode
  - detail level
  - customer template key
  - visible columns
  - validity days
  - disclaimer/header/footer options
  - customer defaults
- Customer PDF must hide cost, net, and gross margin.
- Saved quotes must reload with the same detail intact.

## P1 - Admin And Catalog Follow-Through

- Add robust hardware catalog add/edit/review screens.
- Normalize hardware taxonomy and keep inactive/review-staged items visible to admins.
- Add source-preserving catalog audit fields to catalog rows.
- Build reusable quote display templates and company quote defaults.
- Improve manufacturer-specific contact and vendor communication flows.

## P2 - Operations, BOM, And Vendor Outputs

- Generate BOM and vendor export detail from saved quote snapshots and `estimate_line`.
- Add kitting outputs for openings and hardware sets.
- Add quote acknowledgments and customer approval workflow.
- Add operations tracking for procurement, receiving, staging, and fulfillment.

## P3 - Later Scope

- AI price-book assistant and full price-book ingestion automation.
- Full vendor template library.
- Operations analytics and dashboards beyond quote-to-fulfillment tracking.
- QuickBooks handoff and reconciliation workflows.

## Public Interfaces And Data

- Add or extend TypeScript types for:
  - `EstimateJobInfo`
  - `QuoteDisplayConfigV2`
  - `QuoteLineSnapshot`
  - hardware catalog audit fields
  - company quote defaults
- Add database migrations for:
  - estimate job fields
  - quote detail snapshots
  - expanded company settings
  - hardware catalog audit/approval fields
- Keep legacy quotes and estimates readable. If quote detail snapshots are absent, fall back to current flat `quote_items` behavior.

## Acceptance Criteria

- Paul can reset password, sign in, and reach the app.
- Manufacturer contacts work like customer contacts.
- Billing/shipping copy controls persist the correct fields.
- Job name is prompted and required before opening creation.
- Estimates search by job name, customer, PO/job number, and opening mark.
- `3070` parses and displays correctly.
- Pair handing auto-complements.
- Door gauge no longer forces frame gauge.
- Manufacturer status/manual-quote paths work.
- Fire labels block invalid lites.
- Transom/overall frame dimensions render correctly.
- Row-868 hardware import appears in catalog.
- Chain discounts like `50/20` calculate multiplicatively.
- In-estimate added hardware becomes reusable or review-staged.
- Same estimate renders by opening and product group.
- Summary, rolled-up, per-item, and internal detail modes work.
- Customer PDF hides cost, net, and gross margin.
- Saved quote reloads with all detail intact.
- Existing estimates, openings, quotes, CPQ pricing, and legacy quote items still load.

## Assumptions

- The first implementation slice is the usable quote loop.
- The repo keeps one curated roadmap doc rather than a separate exact archive.
- AI price-book automation, the full vendor template library, deeper operations analytics, and QuickBooks handoff remain later phases.
