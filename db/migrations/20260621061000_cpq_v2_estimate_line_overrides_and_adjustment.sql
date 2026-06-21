-- cpq_v2_estimate_line_overrides_and_adjustment
-- Adds per-line manual sell price override to estimate_line and an
-- estimate-level sell adjustment percentage + notes to estimates.

ALTER TABLE estimate_line
  ADD COLUMN IF NOT EXISTS manual_sell_price NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN estimate_line.manual_sell_price IS
  'User-entered sell price override. When set, display/totals use this instead of sell_price. '
  'Cleared on re-price unless the stable line signature (entity_type + charge_category + selected_option_code) matches.';
COMMENT ON COLUMN estimate_line.is_manual_override IS
  'True when manual_sell_price has been set by a user on the Review step.';

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS sell_adjustment_pct NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS estimate_notes TEXT DEFAULT NULL;

COMMENT ON COLUMN estimates.sell_adjustment_pct IS
  'Optional sell adjustment applied to the engine grand total '
  '(positive = markup, negative = discount). E.g. 10 = +10%, -5 = -5%.';
COMMENT ON COLUMN estimates.estimate_notes IS
  'Free-text notes entered on the Review step before saving the estimate.';
