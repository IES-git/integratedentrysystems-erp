-- Individual hardware dropdown values are not completed specifications.
-- Store them independently so "Add New" under Finish remains a Finish option
-- (and likewise for Function, Size, Hand, and Rating).

CREATE TABLE IF NOT EXISTS public.hardware_option_value (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  axis TEXT NOT NULL CHECK (axis IN ('function', 'finish', 'size', 'hand', 'rating')),
  value TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hardware_option_value_lookup
  ON public.hardware_option_value (category, axis, active);

ALTER TABLE public.hardware_option_value ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hardware_option_value_auth_read ON public.hardware_option_value;
CREATE POLICY hardware_option_value_auth_read
  ON public.hardware_option_value FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS hardware_option_value_admin_insert ON public.hardware_option_value;
CREATE POLICY hardware_option_value_admin_insert
  ON public.hardware_option_value FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS hardware_option_value_admin_update ON public.hardware_option_value;
CREATE POLICY hardware_option_value_admin_update
  ON public.hardware_option_value FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS hardware_option_value_admin_delete ON public.hardware_option_value;
CREATE POLICY hardware_option_value_admin_delete
  ON public.hardware_option_value FOR DELETE
  USING (public.is_admin());

-- Recover axis values that were briefly stored as partial hardware specs.
INSERT INTO public.hardware_option_value (category, axis, value, context, source_metadata, created_by)
SELECT category, 'finish', finish,
       jsonb_strip_nulls(jsonb_build_object(
         'function', function, 'size', size,
         'hand', source_metadata ->> 'submitted_hand', 'rating', rating
       )),
       source_metadata, updated_by
  FROM public.hardware_spec spec
 WHERE source_file = 'in-estimate'
   AND other_requirements ILIKE 'Estimator-added finish option%'
   AND nullif(trim(finish), '') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.hardware_variant v WHERE v.hardware_spec_id = spec.id);

INSERT INTO public.hardware_option_value (category, axis, value, context, source_metadata, created_by)
SELECT category, 'function', function,
       jsonb_strip_nulls(jsonb_build_object(
         'finish', finish, 'size', size,
         'hand', source_metadata ->> 'submitted_hand', 'rating', rating
       )),
       source_metadata, updated_by
  FROM public.hardware_spec spec
 WHERE source_file = 'in-estimate'
   AND other_requirements ILIKE 'Estimator-added function option%'
   AND nullif(trim(function), '') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.hardware_variant v WHERE v.hardware_spec_id = spec.id);

INSERT INTO public.hardware_option_value (category, axis, value, context, source_metadata, created_by)
SELECT category, 'size', size,
       jsonb_strip_nulls(jsonb_build_object(
         'function', function, 'finish', finish,
         'hand', source_metadata ->> 'submitted_hand', 'rating', rating
       )),
       source_metadata, updated_by
  FROM public.hardware_spec spec
 WHERE source_file = 'in-estimate'
   AND other_requirements ILIKE 'Estimator-added size option%'
   AND nullif(trim(size), '') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.hardware_variant v WHERE v.hardware_spec_id = spec.id);

INSERT INTO public.hardware_option_value (category, axis, value, context, source_metadata, created_by)
SELECT category, 'rating', rating,
       jsonb_strip_nulls(jsonb_build_object(
         'function', function, 'finish', finish, 'size', size,
         'hand', source_metadata ->> 'submitted_hand'
       )),
       source_metadata, updated_by
  FROM public.hardware_spec spec
 WHERE source_file = 'in-estimate'
   AND other_requirements ILIKE 'Estimator-added rating option%'
   AND nullif(trim(rating), '') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.hardware_variant v WHERE v.hardware_spec_id = spec.id);

INSERT INTO public.hardware_option_value (category, axis, value, context, source_metadata, created_by)
SELECT category, 'hand', source_metadata ->> 'submitted_hand',
       jsonb_strip_nulls(jsonb_build_object(
         'function', function, 'finish', finish, 'size', size, 'rating', rating
       )),
       source_metadata, updated_by
  FROM public.hardware_spec spec
 WHERE source_file = 'in-estimate'
   AND other_requirements ILIKE 'Estimator-added hand option%'
   AND nullif(trim(source_metadata ->> 'submitted_hand'), '') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.hardware_variant v WHERE v.hardware_spec_id = spec.id);

-- The recovered partial records must no longer appear as specifications.
UPDATE public.hardware_spec spec
   SET active = false,
       approval_state = 'inactive'
 WHERE source_file = 'in-estimate'
   AND (
     other_requirements ILIKE 'Estimator-added finish option%'
     OR other_requirements ILIKE 'Estimator-added function option%'
     OR other_requirements ILIKE 'Estimator-added size option%'
     OR other_requirements ILIKE 'Estimator-added hand option%'
     OR other_requirements ILIKE 'Estimator-added rating option%'
   )
   AND NOT EXISTS (SELECT 1 FROM public.hardware_variant v WHERE v.hardware_spec_id = spec.id);

CREATE OR REPLACE FUNCTION public.add_hardware_option_from_estimate(
  p_category TEXT,
  p_axis TEXT,
  p_value TEXT,
  p_context JSONB DEFAULT '{}'::jsonb,
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
  v_category TEXT;
  v_axis TEXT := lower(trim(p_axis));
  v_value TEXT := trim(p_value);
  v_context JSONB;
  v_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF nullif(trim(p_category), '') IS NULL THEN
    RAISE EXCEPTION 'Hardware category is required';
  END IF;
  IF v_axis NOT IN ('function', 'finish', 'size', 'hand', 'rating') THEN
    RAISE EXCEPTION 'Unsupported hardware option axis: %', p_axis;
  END IF;
  IF nullif(v_value, '') IS NULL THEN
    RAISE EXCEPTION 'Hardware option value is required';
  END IF;

  v_category := lower(regexp_replace(trim(p_category), '[^a-zA-Z0-9]+', '_', 'g'));
  v_context := jsonb_strip_nulls(coalesce(p_context, '{}'::jsonb)) - v_axis;

  SELECT id INTO v_id
    FROM public.hardware_option_value
   WHERE category = v_category
     AND axis = v_axis
     AND lower(value) = lower(v_value)
     AND context = v_context
   ORDER BY created_at
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.hardware_option_value (
      category, axis, value, context, source_metadata, active, created_by
    ) VALUES (
      v_category, v_axis, v_value, v_context,
      jsonb_strip_nulls(jsonb_build_object(
        'estimate_id', p_estimate_id,
        'opening_id', p_opening_id,
        'created_live', true,
        'submitted_by', v_user_id,
        'submitted_at', now()
      )),
      true, v_user_id
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.hardware_option_value SET active = true WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'category', v_category,
    'axis', v_axis,
    'value', v_value,
    'context', v_context
  );
END;
$$;

REVOKE ALL ON FUNCTION public.add_hardware_option_from_estimate(
  TEXT, TEXT, TEXT, JSONB, UUID, UUID
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_hardware_option_from_estimate(
  TEXT, TEXT, TEXT, JSONB, UUID, UUID
) TO authenticated;
