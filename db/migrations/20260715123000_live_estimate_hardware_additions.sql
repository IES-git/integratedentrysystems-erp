-- Estimate hardware additions are immediately selectable in the opening being
-- built. They are approved catalog choices on creation; the absence of a price
-- still routes the selected variant to the existing manual-pricing workflow.

-- Promote records created by the short-lived review-staging workflow so users
-- can continue with additions they already made before this behavior changed.
UPDATE public.hardware_spec
   SET approval_state = 'approved'
 WHERE source_file = 'in-estimate'
   AND approval_state = 'needs_review';

UPDATE public.hardware_product
   SET approval_state = 'approved',
       taxonomy_notes = 'Created live from an estimate; manual pricing required until a price is supplied.'
 WHERE source_import_key LIKE 'EST-%'
   AND approval_state = 'needs_review';

UPDATE public.hardware_variant
   SET approval_state = 'approved',
       taxonomy_notes = 'Created live from an estimate; manual pricing required until a price is supplied.'
 WHERE source_offer_id LIKE 'EST-%-OFFER'
   AND approval_state = 'needs_review';

CREATE OR REPLACE FUNCTION public.stage_hardware_from_estimate(
  p_category TEXT,
  p_description TEXT,
  p_function TEXT DEFAULT NULL,
  p_finish TEXT DEFAULT NULL,
  p_size TEXT DEFAULT NULL,
  p_rating TEXT DEFAULT NULL,
  p_hand TEXT DEFAULT NULL,
  p_manufacturer_name TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_sku TEXT DEFAULT NULL,
  p_estimate_id UUID DEFAULT NULL,
  p_opening_id UUID DEFAULT NULL,
  p_hardware_spec_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_staging_id TEXT := 'EST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  v_spec_external_id TEXT;
  v_category TEXT;
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

  v_category := lower(regexp_replace(trim(p_category), '[^a-zA-Z0-9]+', '_', 'g'));

  IF p_hardware_spec_id IS NOT NULL THEN
    SELECT id, external_spec_id
      INTO v_spec_id, v_spec_external_id
      FROM public.hardware_spec
     WHERE id = p_hardware_spec_id
       AND category = v_category
       AND active = true
       AND approval_state = 'approved';

    IF v_spec_id IS NULL THEN
      RAISE EXCEPTION 'Selected hardware specification is not available for category %', v_category;
    END IF;
  ELSE
    INSERT INTO public.hardware_spec (
      external_spec_id, category, function, finish, size, rating,
      other_requirements, active, approval_state, source_file,
      source_metadata, updated_by
    ) VALUES (
      v_staging_id, v_category,
      nullif(trim(p_function), ''), nullif(trim(p_finish), ''),
      nullif(trim(p_size), ''), nullif(trim(p_rating), ''), trim(p_description),
      true, 'approved', 'in-estimate',
      jsonb_strip_nulls(jsonb_build_object(
        'estimate_id', p_estimate_id,
        'opening_id', p_opening_id,
        'submitted_description', trim(p_description),
        'submitted_hand', nullif(trim(p_hand), ''),
        'created_live', true,
        'submitted_by', v_user_id,
        'submitted_at', now()
      )),
      v_user_id
    )
    RETURNING id, external_spec_id INTO v_spec_id, v_spec_external_id;
  END IF;

  IF coalesce(nullif(trim(p_manufacturer_name), ''), nullif(trim(p_model), ''), nullif(trim(p_sku), '')) IS NOT NULL THEN
    INSERT INTO public.hardware_product (
      source_import_key, category, manufacturer_name, model, description,
      active, approval_state, taxonomy_notes, updated_by
    ) VALUES (
      v_staging_id, v_category,
      nullif(trim(p_manufacturer_name), ''), nullif(trim(p_model), ''), trim(p_description),
      true, 'approved',
      'Created live from an estimate; manual pricing required until a price is supplied.',
      v_user_id
    )
    RETURNING id INTO v_product_id;

    INSERT INTO public.hardware_variant (
      hardware_product_id, hardware_spec_id, source_offer_id, sku, function,
      finish, size, hand, rating, option_attributes, active, approval_state,
      taxonomy_notes, updated_by
    ) VALUES (
      v_product_id, v_spec_id, v_staging_id || '-OFFER', nullif(trim(p_sku), ''),
      nullif(trim(p_function), ''), nullif(trim(p_finish), ''), nullif(trim(p_size), ''),
      nullif(trim(p_hand), ''), nullif(trim(p_rating), ''),
      jsonb_strip_nulls(jsonb_build_object(
        'created_live_from_estimate', true,
        'estimate_id', p_estimate_id,
        'opening_id', p_opening_id,
        'selected_hardware_spec_id', v_spec_id,
        'selected_context', jsonb_strip_nulls(jsonb_build_object(
          'function', nullif(trim(p_function), ''),
          'finish', nullif(trim(p_finish), ''),
          'size', nullif(trim(p_size), ''),
          'hand', nullif(trim(p_hand), ''),
          'rating', nullif(trim(p_rating), '')
        ))
      )),
      true, 'approved',
      'Created live from an estimate; manual pricing required until a price is supplied.',
      v_user_id
    )
    RETURNING id INTO v_variant_id;
  END IF;

  RETURN jsonb_build_object(
    'spec_id', v_spec_id,
    'product_id', v_product_id,
    'variant_id', v_variant_id,
    'external_spec_id', v_spec_external_id,
    'approval_state', 'approved'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stage_hardware_from_estimate(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stage_hardware_from_estimate(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID
) TO authenticated;
