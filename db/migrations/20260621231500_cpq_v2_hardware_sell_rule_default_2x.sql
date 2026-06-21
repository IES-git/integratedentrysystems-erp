-- Replace the placeholder global hardware sell rule (markup x1.0 -> 0% GM) with a
-- single global net x2.0 (~50% GM) starting point. Tunable per-category later by
-- inserting higher-priority hardware_sell_rule rows with a non-null `category`.
delete from hardware_sell_rule;
insert into hardware_sell_rule (name, cost_basis, markup_multiplier, gm_target_pct, rounding, customer_class, company_id, category, priority) values
  ('Standard 2x markup', 'net', 2.0, NULL, NULL, NULL, NULL, NULL, 1);
