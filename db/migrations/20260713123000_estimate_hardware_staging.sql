-- Allow estimators to capture missing hardware without bypassing catalog review.
-- The RPC always creates needs_review records; only the existing admin review
-- policies/workflows can publish them into the selectable catalog.

CREATE OR REPLACE FUNCTION public.stage_hardware_from_estimate(
  p_category TEXT,
  p_description TEXT,
  p_function TEXT DEFAULT NULL,
  p_finish TEXT DEFAULT NULL,
  p_size TEXT DEFAULT NULL,
  p_rating TEXT DEFAULT NULL,
  p_manufacturer_name TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_sku TEXT DEFAULT NULL,
  p_estimate_id UUID DEFAULT NULL,
  p_opening_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_external_id TEXT := 'EST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  v_spec_id UUID;
  v_product_id UUID;
  v_variant_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF nullif(trim(p_category), '') IS NULL THEN
    RAISE EXCEPTION 'Hardware category is required';
  END IF;
  IF nullif(trim(p_description), '') IS NULL THEN
    RAISE EXCEPTION 'Hardware description is required';
  END IF;

  INSERT INTO public.hardware_spec (
    external_spec_id, category, function, finish, size, rating,
    other_requirements, active, approval_state, source_file,
    source_metadata, updated_by
  ) VALUES (
    v_external_id, lower(regexp_replace(trim(p_category), '[^a-zA-Z0-9]+', '_', 'g')),
    nullif(trim(p_function), ''), nullif(trim(p_finish), ''),
    nullif(trim(p_size), ''), nullif(trim(p_rating), ''), trim(p_description),
    true, 'needs_review', 'in-estimate',
    jsonb_strip_nulls(jsonb_build_object(
      'estimate_id', p_estimate_id,
      'opening_id', p_opening_id,
      'submitted_description', trim(p_description),
      'submitted_by', v_user_id,
      'submitted_at', now()
    )),
    v_user_id
  )
  RETURNING id INTO v_spec_id;

  -- When the estimator knows an offer, retain it as review-staged product and
  -- variant data. It remains invisible to estimating until an admin approves it.
  IF coalesce(nullif(trim(p_manufacturer_name), ''), nullif(trim(p_model), ''), nullif(trim(p_sku), '')) IS NOT NULL THEN
    INSERT INTO public.hardware_product (
      source_import_key, category, manufacturer_name, model, description,
      active, approval_state, taxonomy_notes, updated_by
    ) VALUES (
      v_external_id,
      lower(regexp_replace(trim(p_category), '[^a-zA-Z0-9]+', '_', 'g')),
      nullif(trim(p_manufacturer_name), ''), nullif(trim(p_model), ''), trim(p_description),
      true, 'needs_review', 'Staged from estimate; review taxonomy and vendor identity.', v_user_id
    )
    RETURNING id INTO v_product_id;

    INSERT INTO public.hardware_variant (
      hardware_product_id, hardware_spec_id, source_offer_id, sku, function,
      finish, size, rating, active, approval_state, taxonomy_notes, updated_by
    ) VALUES (
      v_product_id, v_spec_id, v_external_id || '-OFFER', nullif(trim(p_sku), ''),
      nullif(trim(p_function), ''), nullif(trim(p_finish), ''), nullif(trim(p_size), ''),
      nullif(trim(p_rating), ''), true, 'needs_review',
      'Staged from estimate; price and source verification required.', v_user_id
    )
    RETURNING id INTO v_variant_id;
  END IF;

  RETURN jsonb_build_object(
    'spec_id', v_spec_id,
    'product_id', v_product_id,
    'variant_id', v_variant_id,
    'external_spec_id', v_external_id,
    'approval_state', 'needs_review'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stage_hardware_from_estimate(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stage_hardware_from_estimate(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated;

