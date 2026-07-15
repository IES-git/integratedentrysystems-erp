-- Follow-up from Supabase advisors for the new hardware_spec table.

CREATE INDEX IF NOT EXISTS idx_hardware_spec_updated_by
  ON public.hardware_spec (updated_by)
  WHERE updated_by IS NOT NULL;

DROP POLICY IF EXISTS hardware_spec_auth_read ON public.hardware_spec;
CREATE POLICY hardware_spec_auth_read
  ON public.hardware_spec FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);
