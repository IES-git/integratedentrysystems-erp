-- CPQ v2 — Re-key hardware catalog categories to slug identity.
--
-- The hardware category *identity* used across the system is the snake_case slug
-- (`butt_hinges`, `cylindrical_mortise_locks_and_deadbolts`, …): the builder `HW`
-- constants, the `hardware_set_item` templates, the engine selection key, and the
-- MISSING_PRICE messages all use it. A prior normalization set
-- `hardware_product.category` to readable title-case ("Butt hinges", …), which
-- broke `loadVariantsForCategory()` (an exact match on the slug) — so the builder
-- showed "No catalog variants" for every auto-suggested category and every
-- required hardware line blocked as MISSING_PRICE.
--
-- This re-keys the catalog category (and the linear-rule category) to the slug so
-- the exact-match join succeeds again. The readable label is derived in the UI
-- (`loadHardwareCategories` title-cases the slug). The slug is deterministic and
-- collision-free across the 14 catalog categories. The granular
-- `hardware_prep_crosswalk.hardware_category` vocabulary is intentionally left
-- alone (the engine fuzzy-matches it).

begin;

update public.hardware_product
set category = trim(both '_' from regexp_replace(lower(category), '[^a-z0-9]+', '_', 'g')),
    updated_at = now()
where category is not null
  and category <> trim(both '_' from regexp_replace(lower(category), '[^a-z0-9]+', '_', 'g'));

update public.linear_hardware_rule
set hardware_category = trim(both '_' from regexp_replace(lower(hardware_category), '[^a-z0-9]+', '_', 'g')),
    updated_at = now()
where hardware_category is not null
  and hardware_category <> trim(both '_' from regexp_replace(lower(hardware_category), '[^a-z0-9]+', '_', 'g'));

commit;
