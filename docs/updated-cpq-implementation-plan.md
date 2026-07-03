# Updated CPQ Implementation Roadmap

## Summary

This is the curated CPQ roadmap for the IES ERP app. The first implementation slice prioritizes a usable Paul/Mark estimating-to-quote loop: account access, customer/job setup, opening fixes, quote preview/print, and source-preserving quote detail.

The app remains the operational system for estimating, quote detail, catalog, BOM, kitting, and prep data. QuickBooks remains the accounting system of record.

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
- Operations dashboards beyond quote-to-order prep.
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
- AI price-book assistant, full vendor template library, acknowledgments, operations tracking, and QuickBooks handoff remain later phases.
