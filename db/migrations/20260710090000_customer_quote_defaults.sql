-- Align customer quote defaults with the approved CPQ presentation rule:
-- hollow metal and hardware grouped by product, with rolled-up pricing.
-- The previous defaults were introduced before any company UI exposed these
-- choices, so existing default-valued rows can be safely advanced.

UPDATE public.companies
SET settings = COALESCE(settings, '{}'::jsonb)
  || jsonb_build_object(
    'default_quote_organization_mode', 'by_product_group',
    'default_quote_detail_level', 'rolled_up',
    'quote_validity_days', COALESCE(settings->'quote_validity_days', '90'::jsonb)
  )
WHERE COALESCE(settings->>'default_quote_organization_mode', 'by_opening') = 'by_opening'
  AND COALESCE(settings->>'default_quote_detail_level', 'summary') = 'summary';
