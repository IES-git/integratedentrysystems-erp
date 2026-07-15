-- Preserve the actual procurement manufacturer on every priced estimate line.
-- A structural price_book_id is not a valid proxy for hardware manufacturer:
-- one opening can contain doors/frames from one manufacturer and hardware from
-- several unrelated manufacturers.

ALTER TABLE public.estimate_line
  ADD COLUMN IF NOT EXISTS manufacturer_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manufacturer_name TEXT;

COMMENT ON COLUMN public.estimate_line.manufacturer_id IS
  'Company that should receive this line on a manufacturer RFQ. For hardware this comes from hardware_product, not the structural price book.';
COMMENT ON COLUMN public.estimate_line.manufacturer_name IS
  'Catalog manufacturer name/code retained for RFQ routing when no canonical company link exists yet.';

CREATE INDEX IF NOT EXISTS idx_estimate_line_manufacturer_id
  ON public.estimate_line (manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_hardware_product_manufacturer_name_normalized
  ON public.hardware_product (upper(trim(manufacturer_name)))
  WHERE manufacturer_name IS NOT NULL;

-- Safely link catalog rows whose manufacturer text already exactly matches an
-- active manufacturer company. Abbreviations such as PHG remain name-routable
-- and can be linked later without blocking RFQ separation.
UPDATE public.hardware_product AS hp
SET manufacturer_id = company.id,
    updated_at = now()
FROM public.companies AS company
WHERE hp.manufacturer_id IS NULL
  AND hp.manufacturer_name IS NOT NULL
  AND company.active = true
  AND company.company_type IN ('manufacturer', 'both')
  AND upper(trim(company.name)) = upper(trim(hp.manufacturer_name));

-- Recover manufacturer identity for existing estimates from their selected
-- hardware SKU. This makes in-progress estimates routable without forcing an
-- edit/reprice solely to repair the old CECO inheritance bug.
WITH sku_manufacturer AS (
  SELECT DISTINCT ON (upper(trim(variant.sku)))
    upper(trim(variant.sku)) AS sku_key,
    product.manufacturer_id,
    nullif(trim(product.manufacturer_name), '') AS manufacturer_name
  FROM public.hardware_variant AS variant
  JOIN public.hardware_product AS product ON product.id = variant.hardware_product_id
  WHERE variant.sku IS NOT NULL
    AND trim(variant.sku) <> ''
    AND variant.active = true
    AND product.active = true
  ORDER BY
    upper(trim(variant.sku)),
    (product.approval_state = 'approved') DESC,
    (variant.approval_state = 'approved') DESC,
    (product.manufacturer_id IS NOT NULL) DESC,
    product.updated_at DESC
)
UPDATE public.estimate_line AS line
SET manufacturer_id = coalesce(line.manufacturer_id, sku.manufacturer_id),
    manufacturer_name = coalesce(nullif(trim(line.manufacturer_name), ''), sku.manufacturer_name)
FROM sku_manufacturer AS sku
WHERE line.entity_type = 'hardware'
  AND line.selected_option_code IS NOT NULL
  AND upper(trim(line.selected_option_code)) = sku.sku_key
  AND (line.manufacturer_id IS NULL OR nullif(trim(line.manufacturer_name), '') IS NULL);
