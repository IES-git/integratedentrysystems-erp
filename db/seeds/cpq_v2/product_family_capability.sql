-- ============================================================================
-- Release 1 capability + resolution-policy seed.
-- Ported from the implicit rules in src/lib/cpq/builder-logic.ts:
--   SPECIALTY_SERIES, SPECIALTY_DOOR_TO_FRAME, WALL_TO_FRAME_SERIES.
-- A family is eligible for a requirement set iff ALL its capability predicates
-- match. Standard families assert the specialty requirement fields are MISSING;
-- specialty families assert their specialty field EXISTS (Release 1 then routes
-- specialty requirements to manual quote until their rule packs are validated).
-- Idempotent: clears the R1 catalog version, then re-seeds.
-- ----------------------------------------------------------------------------

delete from public.product_family_capability where catalog_version = 'R1';
delete from public.family_resolution_policy   where catalog_version = 'R1';

-- ---- Standard door families: not for any specialty requirement -------------
insert into public.product_family_capability (family_id, component_scope, field, operator, value, catalog_version, notes)
select pf.id, 'door', f.field, 'MISSING', null, 'R1', 'standard door — specialty requirement not supported'
from public.product_family pf
cross join (values
  ('opening.windstorm_design_pressure_requirement'),
  ('opening.storm_shelter_fema_requirement'),
  ('opening.stc_rating_and_gasket_type'),
  ('opening.blast_resistance_requirement'),
  ('opening.bullet_resistance_level')
) as f(field)
where pf.entity_type = 'door'
  and pf.family_code in ('H','HF','HP','HPF','HT','HTF','HR','HRF','CH','CHP','CHT','CHR','LW','LWF','C','EH','EHF','EP','EPF');

-- ---- Specialty door families: require their specialty field ----------------
insert into public.product_family_capability (family_id, component_scope, field, operator, value, catalog_version, notes)
select pf.id, 'door', s.field, 'EXISTS', null, 'R1', 'specialty door — requires this performance requirement'
from public.product_family pf
join (values
  ('W50','opening.windstorm_design_pressure_requirement'),
  ('W70','opening.windstorm_design_pressure_requirement'),
  ('FEMA','opening.storm_shelter_fema_requirement'),
  ('STC','opening.stc_rating_and_gasket_type'),
  ('SBR','opening.blast_resistance_requirement'),
  ('BR752','opening.bullet_resistance_level')
) as s(code, field) on s.code = pf.family_code
where pf.entity_type = 'door';

-- ---- Standard frame families: eligible by wall construction ----------------
insert into public.product_family_capability (family_id, component_scope, field, operator, value, catalog_version, notes)
select pf.id, 'frame', 'opening.wall_construction', 'IN', w.walls, 'R1', 'frame series eligible for these wall constructions'
from public.product_family pf
join (values
  ('F',    'masonry'),
  ('F-BL', 'masonry'),
  ('DW',   'steel stud|wood stud|drywall'),
  ('DWBL', 'steel stud|wood stud|drywall'),
  ('WF',   'steel stud|wood stud|existing opening'),
  ('SPF',  'steel stud|existing opening'),
  ('STK',  'steel stud|existing opening')
) as w(code, walls) on w.code = pf.family_code
where pf.entity_type = 'frame';

-- ---- Specialty frame families: paired to a specialty door requirement ------
insert into public.product_family_capability (family_id, component_scope, field, operator, value, catalog_version, notes)
select pf.id, 'frame', s.field, 'EXISTS', null, 'R1', 'specialty frame — requires this performance requirement'
from public.product_family pf
join (values
  ('F50','opening.windstorm_design_pressure_requirement'),
  ('F70','opening.windstorm_design_pressure_requirement'),
  ('FEMA','opening.storm_shelter_fema_requirement'),
  ('FST','opening.stc_rating_and_gasket_type'),
  ('SBR','opening.blast_resistance_requirement'),
  ('BR752','opening.bullet_resistance_level')
) as s(code, field) on s.code = pf.family_code
where pf.entity_type = 'frame';

-- ---- Resolution ranking: prefer the simplest standard construction ---------
-- Lower rank wins when several families comply. Honeycomb glued-core lockseam
-- (H) is the default; seamless / upgraded cores rank slightly higher; specialty
-- families rank last (and Release 1 routes them to manual quote).
insert into public.family_resolution_policy (component_scope, family_id, rank, auto_accept, display_label, catalog_version)
select 'door', pf.id, r.rank, true, r.label, 'R1'
from public.product_family pf
join (values
  ('H',  10, 'Honeycomb core, lockseam'),
  ('HF', 12, 'Honeycomb core, seamless edge'),
  ('HP', 20, 'Polystyrene core, lockseam'),
  ('HT', 22, 'Polyurethane core, lockseam'),
  ('HR', 24, 'Temperature-rise core, lockseam'),
  ('CH', 30, 'Continuous-weld seamless'),
  ('LW', 40, 'Steel-stiffened, lockseam'),
  ('C',  42, 'Steel-stiffened, continuous weld'),
  ('EH', 50, 'Embossed'),
  ('W50', 90, 'Windstorm (specialty)'),
  ('W70', 90, 'Windstorm (specialty)'),
  ('FEMA', 90, 'FEMA storm shelter (specialty)'),
  ('STC', 90, 'Sound-rated (specialty)'),
  ('SBR', 95, 'Blast/bullet-resistant (specialty)'),
  ('BR752', 95, 'Bullet-resistant (specialty)')
) as r(code, rank, label) on r.code = pf.family_code
where pf.entity_type = 'door';

insert into public.family_resolution_policy (component_scope, family_id, rank, auto_accept, display_label, catalog_version)
select 'frame', pf.id, r.rank, true, r.label, 'R1'
from public.product_family pf
join (values
  ('F',  10, 'Masonry face-welded frame'),
  ('F-BL', 14, 'Masonry borrowed-lite frame'),
  ('DW', 20, 'Drywall/stud knock-down frame'),
  ('DWBL', 24, 'Drywall borrowed-lite frame'),
  ('WF', 30, 'UniSeal wrap frame'),
  ('SPF', 34, 'Split frame'),
  ('STK', 38, 'Stick frame'),
  ('F50', 90, 'Windstorm frame (specialty)'),
  ('F70', 90, 'Windstorm frame (specialty)'),
  ('FEMA', 90, 'FEMA frame (specialty)'),
  ('FST', 90, 'Sound frame (specialty)'),
  ('SBR', 95, 'Blast/bullet frame (specialty)'),
  ('BR752', 95, 'Bullet frame (specialty)')
) as r(code, rank, label) on r.code = pf.family_code
where pf.entity_type = 'frame';
