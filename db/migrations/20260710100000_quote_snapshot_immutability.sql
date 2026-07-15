-- Preserve the customer/job context and vendor-facing identity used when a
-- quote is saved. These values must not drift when the source estimate,
-- opening, company, or contact is edited later.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS context_snapshot JSONB;

ALTER TABLE public.quote_line_snapshots
  ADD COLUMN IF NOT EXISTS opening_name TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manufacturer_name TEXT,
  ADD COLUMN IF NOT EXISTS part_number TEXT;

COMMENT ON COLUMN public.quotes.context_snapshot IS
  'Immutable versioned job/company/contact/opening context captured when the quote is saved.';
COMMENT ON COLUMN public.quote_line_snapshots.opening_name IS
  'Opening mark/name captured at quote-save time; never reloaded from the mutable estimate.';
COMMENT ON COLUMN public.quote_line_snapshots.manufacturer_name IS
  'Manufacturer display name captured at quote-save time for vendor/BOM exports.';
COMMENT ON COLUMN public.quote_line_snapshots.part_number IS
  'Vendor/manufacturer part or option number captured at quote-save time.';

CREATE INDEX IF NOT EXISTS idx_quote_line_snapshots_manufacturer_id
  ON public.quote_line_snapshots (manufacturer_id);
