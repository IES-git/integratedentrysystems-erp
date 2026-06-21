-- ============================================================================
-- Normalize hardware product categories to the canonical dictionary.
-- ============================================================================
--
-- The hardware source uses abbreviated column-A categories ("trim", "thold",
-- "drip", "c_hinges", "surf bolt", ...) that don't match a CATEGORY_KEYWORD, so
-- they landed raw alongside the canonical taxonomy. Map them to the 14 canonical
-- codes in option_definition (entity_type='hardware', category='hardware_category')
-- so the catalog groups cleanly AND so hardware_set_item category matching works.
-- The worker's normCategory now applies the same map for future ingests.
--
-- Raw subcategory is preserved on hardware_product.subcategory (set at ingest).
-- ----------------------------------------------------------------------------

with cat_map(raw, canonical) as (values
  ('acc control', 'Access control'),
  ('c_hinges',    'Continuous hinges'),
  ('drip',        'Weather seals'),
  ('e_hinge',     'Electric hinges / EPT / loops'),
  ('h/m acc.',    'Protection/accessories'),
  ('hdw mull',    'Exit devices'),
  ('hinges',      'Butt hinges'),
  ('int pull',    'Exit trim / pulls'),
  ('shoe',        'Weather seals'),
  ('surf bolt',   'Inactive-leaf hardware'),
  ('thold',       'Thresholds'),
  ('trim',        'Exit trim / pulls')
)
update public.hardware_product hp
set category = m.canonical, updated_at = now()
from cat_map m
where lower(btrim(hp.category)) = m.raw
  and hp.category <> m.canonical;

-- Keep any linear rules' category label aligned (Thresholds/Weather seals).
with cat_map(raw, canonical) as (values
  ('drip', 'Weather seals'), ('shoe', 'Weather seals'), ('thold', 'Thresholds')
)
update public.linear_hardware_rule lr
set hardware_category = m.canonical, updated_at = now()
from cat_map m
where lower(btrim(lr.hardware_category)) = m.raw;
