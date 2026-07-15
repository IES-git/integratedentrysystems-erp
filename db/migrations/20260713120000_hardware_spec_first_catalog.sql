-- Hardware catalog: vendor-neutral specifications with vendor offers selected last.
-- Additive/idempotent: existing hardware products, variants, prices, and opening
-- selections remain valid while optimized imports can link many offers to one spec.

CREATE TABLE IF NOT EXISTS public.hardware_spec (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_spec_id TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  product_subtype TEXT,
  application TEXT,
  function TEXT,
  keying TEXT,
  size TEXT,
  rating TEXT,
  duty_grade TEXT,
  mounting_arm TEXT,
  thickness_weight TEXT,
  material TEXT,
  finish TEXT,
  electrical TEXT,
  other_requirements TEXT,
  match_confidence TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  approval_state TEXT NOT NULL DEFAULT 'needs_review',
  source_file TEXT,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hardware_spec_approval_state_check
    CHECK (approval_state IN ('draft', 'needs_review', 'approved', 'inactive', 'rejected'))
);

COMMENT ON TABLE public.hardware_spec IS
  'Vendor-neutral hardware requirement. Estimators select this specification before choosing a linked manufacturer/vendor offer.';
COMMENT ON COLUMN public.hardware_spec.external_spec_id IS
  'Stable source/import identifier such as SPEC-2F127E570436.';

ALTER TABLE public.hardware_variant
  ADD COLUMN IF NOT EXISTS hardware_spec_id UUID REFERENCES public.hardware_spec(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_offer_id TEXT;

ALTER TABLE public.hardware_product
  ADD COLUMN IF NOT EXISTS source_import_key TEXT;

ALTER TABLE public.hardware_price_book
  ADD COLUMN IF NOT EXISTS source_import_id TEXT;

ALTER TABLE public.hardware_price
  ADD COLUMN IF NOT EXISTS source_price_id TEXT;

ALTER TABLE public.opening_hardware_item
  ADD COLUMN IF NOT EXISTS hardware_spec_id UUID REFERENCES public.hardware_spec(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hardware_variant_source_offer_id
  ON public.hardware_variant (source_offer_id)
  WHERE source_offer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hardware_product_source_import_key
  ON public.hardware_product (source_import_key)
  WHERE source_import_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hardware_price_book_source_import_id
  ON public.hardware_price_book (source_import_id)
  WHERE source_import_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hardware_price_source_price_id
  ON public.hardware_price (source_price_id)
  WHERE source_price_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hardware_spec_selection
  ON public.hardware_spec (category, approval_state, active);

CREATE INDEX IF NOT EXISTS idx_hardware_variant_spec
  ON public.hardware_variant (hardware_spec_id, approval_state, active);

CREATE INDEX IF NOT EXISTS idx_opening_hardware_item_spec
  ON public.opening_hardware_item (hardware_spec_id);

ALTER TABLE public.hardware_spec ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hardware_spec_auth_read ON public.hardware_spec;
CREATE POLICY hardware_spec_auth_read
  ON public.hardware_spec FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS hardware_spec_admin_insert ON public.hardware_spec;
CREATE POLICY hardware_spec_admin_insert
  ON public.hardware_spec FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS hardware_spec_admin_update ON public.hardware_spec;
CREATE POLICY hardware_spec_admin_update
  ON public.hardware_spec FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS hardware_spec_admin_delete ON public.hardware_spec;
CREATE POLICY hardware_spec_admin_delete
  ON public.hardware_spec FOR DELETE
  USING (public.is_admin());

DROP TRIGGER IF EXISTS set_hardware_spec_updated_at ON public.hardware_spec;
CREATE TRIGGER set_hardware_spec_updated_at
  BEFORE UPDATE ON public.hardware_spec
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
