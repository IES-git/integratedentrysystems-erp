-- Updated CPQ quote-loop foundation.
-- Additive and idempotent: job setup fields, quote detail snapshots,
-- company quote defaults, and hardware catalog review/audit fields.

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS job_name TEXT,
  ADD COLUMN IF NOT EXISTS job_location TEXT,
  ADD COLUMN IF NOT EXISTS job_number TEXT,
  ADD COLUMN IF NOT EXISTS customer_po TEXT,
  ADD COLUMN IF NOT EXISTS quote_date DATE,
  ADD COLUMN IF NOT EXISTS shipping_method TEXT,
  ADD COLUMN IF NOT EXISTS terms TEXT,
  ADD COLUMN IF NOT EXISTS delivery TEXT,
  ADD COLUMN IF NOT EXISTS ship_to_source TEXT DEFAULT 'customer_shipping',
  ADD COLUMN IF NOT EXISTS ship_to_address TEXT,
  ADD COLUMN IF NOT EXISTS ship_to_city TEXT,
  ADD COLUMN IF NOT EXISTS ship_to_state TEXT,
  ADD COLUMN IF NOT EXISTS ship_to_zip TEXT,
  ADD COLUMN IF NOT EXISTS customer_contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_rep_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_rep_phone TEXT,
  ADD COLUMN IF NOT EXISTS customer_rep_email TEXT,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'estimates_ship_to_source_check'
      AND conrelid = 'public.estimates'::regclass
  ) THEN
    ALTER TABLE public.estimates
      ADD CONSTRAINT estimates_ship_to_source_check
      CHECK (
        ship_to_source IS NULL
        OR ship_to_source IN ('customer_shipping', 'customer_billing', 'override', 'will_call')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.estimates.job_name IS 'Customer-facing job/project name used for quote setup and estimate search.';
COMMENT ON COLUMN public.estimates.ship_to_source IS 'Ship-to source for quote output: customer_shipping, customer_billing, override, or will_call.';
COMMENT ON COLUMN public.estimates.internal_notes IS 'Internal estimator notes for this estimate/job. Not shown on customer quote PDFs by default.';

CREATE INDEX IF NOT EXISTS idx_estimates_job_name
  ON public.estimates (lower(job_name));

CREATE INDEX IF NOT EXISTS idx_estimates_customer_po
  ON public.estimates (lower(customer_po));

CREATE INDEX IF NOT EXISTS idx_estimates_job_number
  ON public.estimates (lower(job_number));

CREATE INDEX IF NOT EXISTS idx_estimates_customer_contact_id
  ON public.estimates (customer_contact_id);

CREATE TABLE IF NOT EXISTS public.quote_line_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  quote_item_id UUID REFERENCES public.quote_items(id) ON DELETE SET NULL,
  estimate_id UUID REFERENCES public.estimates(id) ON DELETE SET NULL,
  estimate_line_id UUID REFERENCES public.estimate_line(id) ON DELETE SET NULL,
  estimate_item_id UUID REFERENCES public.estimate_items(id) ON DELETE SET NULL,
  opening_id UUID REFERENCES public.estimate_openings(id) ON DELETE SET NULL,
  component_id UUID REFERENCES public.estimate_items(id) ON DELETE SET NULL,
  source_table TEXT NOT NULL DEFAULT 'estimate_line',
  source_line_type TEXT,
  entity_type TEXT,
  charge_category TEXT,
  description TEXT,
  selected_option_code TEXT,
  quantity NUMERIC,
  unit_of_measure TEXT,
  unit_list_price NUMERIC,
  extended_list_price NUMERIC,
  discount_multiplier NUMERIC,
  extended_net_price NUMERIC,
  sell_price NUMERIC,
  manual_sell_price NUMERIC,
  unit_sell_price NUMERIC,
  line_total NUMERIC,
  price_status TEXT,
  review_status TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.quote_line_snapshots IS
  'Saved source-preserving quote detail. Captures estimate_line/legacy detail at quote-save time so PDFs, BOM, vendor exports, and kitting can reload exactly.';

CREATE INDEX IF NOT EXISTS idx_quote_line_snapshots_quote_id
  ON public.quote_line_snapshots (quote_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_quote_line_snapshots_estimate_line_id
  ON public.quote_line_snapshots (estimate_line_id);

CREATE INDEX IF NOT EXISTS idx_quote_line_snapshots_opening_id
  ON public.quote_line_snapshots (opening_id);

ALTER TABLE public.quote_line_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_line_snapshots_auth_all ON public.quote_line_snapshots;
CREATE POLICY quote_line_snapshots_auth_all
  ON public.quote_line_snapshots
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

UPDATE public.companies
SET settings =
  COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object(
    'quote_validity_days', COALESCE(settings->'quote_validity_days', '90'::jsonb),
    'default_quote_template_key', COALESCE(settings->'default_quote_template_key', 'null'::jsonb),
    'default_quote_detail_level', COALESCE(settings->'default_quote_detail_level', '"summary"'::jsonb),
    'default_quote_organization_mode', COALESCE(settings->'default_quote_organization_mode', '"by_opening"'::jsonb)
  )
WHERE settings IS NULL
  OR NOT (
    settings ? 'quote_validity_days'
    AND settings ? 'default_quote_template_key'
    AND settings ? 'default_quote_detail_level'
    AND settings ? 'default_quote_organization_mode'
  );

ALTER TABLE public.hardware_product
  ADD COLUMN IF NOT EXISTS approval_state TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS source_row_number INTEGER,
  ADD COLUMN IF NOT EXISTS taxonomy_notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;

ALTER TABLE public.hardware_variant
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_state TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS source_row_number INTEGER,
  ADD COLUMN IF NOT EXISTS taxonomy_notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;

ALTER TABLE public.hardware_price
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_state TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS discount_chain TEXT,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hardware_product_approval_state_check'
      AND conrelid = 'public.hardware_product'::regclass
  ) THEN
    ALTER TABLE public.hardware_product
      ADD CONSTRAINT hardware_product_approval_state_check
      CHECK (approval_state IN ('draft', 'needs_review', 'approved', 'inactive', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hardware_variant_approval_state_check'
      AND conrelid = 'public.hardware_variant'::regclass
  ) THEN
    ALTER TABLE public.hardware_variant
      ADD CONSTRAINT hardware_variant_approval_state_check
      CHECK (approval_state IN ('draft', 'needs_review', 'approved', 'inactive', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hardware_price_approval_state_check'
      AND conrelid = 'public.hardware_price'::regclass
  ) THEN
    ALTER TABLE public.hardware_price
      ADD CONSTRAINT hardware_price_approval_state_check
      CHECK (approval_state IN ('draft', 'needs_review', 'approved', 'inactive', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hardware_product_approval_state
  ON public.hardware_product (approval_state, active);

CREATE INDEX IF NOT EXISTS idx_hardware_variant_approval_state
  ON public.hardware_variant (approval_state, active);

CREATE INDEX IF NOT EXISTS idx_hardware_price_approval_state
  ON public.hardware_price (approval_state, active);
