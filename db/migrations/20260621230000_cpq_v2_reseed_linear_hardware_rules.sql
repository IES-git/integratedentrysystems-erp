-- Consolidate linear_hardware_rule into clean, explicit per-category rules.
-- The prior 59 per-variant rows were orphaned (variant links SET NULL by the
-- hardware reseed). The engine prices linear accessories per SELECTED variant's
-- approved per-foot net (hardware_price, uom='FT'); these rules only supply the
-- length basis + explicit waste, and make isLinearCategory() true so the engine
-- routes weather seals / thresholds through the per-foot path (not per-each).
delete from linear_hardware_rule;
insert into linear_hardware_rule (hardware_category, length_basis, cut_increment, waste_pct, minimum_length, per_foot_price, hardware_variant_id) values
  ('weather_seals','head_plus_jambs',NULL,10,NULL,NULL,NULL),
  ('thresholds','width',NULL,0,NULL,NULL,NULL);
