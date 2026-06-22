-- Adds a presentation/display layer for generated quote documents.
-- Pricing stays on quotes/quote_items; this JSON only controls what is shown.

ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS display_config_json TEXT;

COMMENT ON COLUMN public.templates.display_config_json IS
  'JSON configuration for quote document blocks, detail levels, copy, and default line display behavior.';

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS display_config_json TEXT;

COMMENT ON COLUMN public.quotes.display_config_json IS
  'Per-quote copy of the template display configuration. Does not affect pricing.';

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS display_key TEXT;

COMMENT ON COLUMN public.quote_items.display_key IS
  'Stable presentation key used by quote display overrides. Distinct from the quote_items primary key.';

CREATE INDEX IF NOT EXISTS idx_quote_items_display_key
  ON public.quote_items (quote_id, display_key);

