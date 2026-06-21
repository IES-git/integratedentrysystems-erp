-- CPQ v2 — Normalize door core-upgrade option codes to the Pioneer per-series
-- nomenclature so the builder's Core-type picker prices on every base series.
--
-- The published book defines core options per series with distinct codes:
--   H : H (N/C)  · HP $53  · HT $231 · HR $985
--   CH: CH (N/C) · CHP $53 · CHT $231· CHR $985
--   LW: LW (N/C) · PS $53  · TS $231      (polystyrene/polyurethane between stiffeners)
--   C : C  (N/C) · PS $75  · TS $275      (polystyrene/polyurethane between stiffeners)
--   EH: EH (N/C) · EP $84
--
-- Ingestion keyed CH and C with descriptive phrases ("Polystyrene Core",
-- "Polyurethane Between Stiffeners", …) instead of the part-number codes, so the
-- core-upgrade adders only fired for H/LW. This re-keys CH→CHP/CHT/CHR and
-- C→PS/TS (matching the book + LW), and rejects a stray ungated EP $105 adder
-- that would double-count against the EH-gated EP $84. H and LW are already
-- correctly keyed (HP/HT/HR, PS/TS) and left untouched.

begin;

-- CH series: descriptive core phrases → CHP / CHT / CHR.
update public.rule_condition rc
set value_1 = m.code
from (values
  ('c9cbd833-1cdf-48c9-afb6-d1fc5aa7b950'::uuid, 'CHP'),
  ('78dcedb9-41f7-4737-8ddf-8cba2f9828de'::uuid, 'CHT'),
  ('1d95acc2-262b-47c6-a3c7-8f8a2143968e'::uuid, 'CHR')
) as m(rule_id, code)
where rc.price_rule_id = m.rule_id
  and rc.field_path = 'door.option_code';

update public.price_rule pr
set item_or_option_code = m.code, updated_at = now()
from (values
  ('c9cbd833-1cdf-48c9-afb6-d1fc5aa7b950'::uuid, 'CHP'),
  ('78dcedb9-41f7-4737-8ddf-8cba2f9828de'::uuid, 'CHT'),
  ('1d95acc2-262b-47c6-a3c7-8f8a2143968e'::uuid, 'CHR')
) as m(rule_id, code)
where pr.id = m.rule_id;

-- C series: "…Between Stiffeners" → PS / TS (same codes as LW; price differs by
-- the series condition: C is $75/$275, LW is $53/$231).
update public.rule_condition rc
set value_1 = m.code
from (values
  ('2264c91e-3535-43af-8c0f-7b43bfb33dc4'::uuid, 'PS'),
  ('e40a7b76-8b09-4ecc-bc41-fb141f5e0342'::uuid, 'TS')
) as m(rule_id, code)
where rc.price_rule_id = m.rule_id
  and rc.field_path = 'door.option_code';

update public.price_rule pr
set item_or_option_code = m.code, updated_at = now()
from (values
  ('2264c91e-3535-43af-8c0f-7b43bfb33dc4'::uuid, 'PS'),
  ('e40a7b76-8b09-4ecc-bc41-fb141f5e0342'::uuid, 'TS')
) as m(rule_id, code)
where pr.id = m.rule_id;

-- Stray ungated EP $105 adder (no series condition) would stack on top of the
-- correct EH-gated EP $84 whenever option_code=EP. Reject it.
update public.price_rule
set review_status = 'REJECTED', updated_at = now()
where id = '2e6cec70-226a-464e-844e-e9a69b676411';

commit;
