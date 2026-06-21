-- cpq_v2_opening_spec_snapshot
-- Adds a JSONB column to estimate_openings that stores the full OpeningDraft
-- written by the spec builder on save. Enables faithful round-trip editing and
-- re-pricing without the lossy reconstruction from item_fields.

ALTER TABLE estimate_openings
  ADD COLUMN IF NOT EXISTS spec_snapshot JSONB DEFAULT NULL;

COMMENT ON COLUMN estimate_openings.spec_snapshot IS
  'Full OpeningDraft JSON snapshot written by the spec builder on save. '
  'Enables faithful round-trip editing and re-pricing without lossy reconstruction from item_fields.';
