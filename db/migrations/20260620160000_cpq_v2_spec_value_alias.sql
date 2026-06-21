-- ============================================================================
-- Phase 1/2: governed value vocabulary for rule conditions.
-- ============================================================================
--
-- The pricing engine matches a price_rule by comparing rule_condition.value_1
-- to the value the builder writes for the same field_path (case-insensitive,
-- no '/' splitting). Price-book extraction has polluted many enum conditions
-- with descriptive labels ("FEMA 361"), combined tokens ("STK 14"), multi-value
-- operands ("F/DW/SPF/STK"), wrong-field values, and header junk ("Price").
--
-- `spec_value_alias` is the single source of truth that maps any raw extracted
-- value to the canonical token defined in opening_spec_field.allowed_values:
--   * status='alias'  -> recoverable; canonical_value holds the target token.
--                        target_operator='IN' means the raw was a multi-value
--                        operand and should become an IN list ('F|DW').
--   * status='reject' -> unrecoverable junk / wrong-field; canonical_value NULL.
--                        These rules are flagged for re-ingestion, never guessed.
--
-- This table is reused by:
--   * cpq_v2_clean_rule_condition_vocab (applies the aliases),
--   * the publish-time vocabulary validation (src/lib/pricing/vocab-validation.ts).
-- ----------------------------------------------------------------------------

create table if not exists public.spec_value_alias (
  id               uuid primary key default gen_random_uuid(),
  field_path       text not null,
  raw_value        text not null,
  canonical_value  text,
  target_operator  text not null default 'EQ' check (target_operator in ('EQ', 'IN')),
  status           text not null check (status in ('alias', 'reject')),
  notes            text,
  created_at       timestamptz not null default now(),
  unique (field_path, raw_value)
);

comment on table public.spec_value_alias is
  'Governed vocabulary: maps raw extracted rule_condition values to the canonical token in opening_spec_field.allowed_values (status=alias) or flags unrecoverable junk (status=reject).';

alter table public.spec_value_alias enable row level security;

drop policy if exists auth_read on public.spec_value_alias;
create policy auth_read on public.spec_value_alias for select using (true);

drop policy if exists admin_insert on public.spec_value_alias;
create policy admin_insert on public.spec_value_alias for insert with check (is_admin());

drop policy if exists admin_update on public.spec_value_alias;
create policy admin_update on public.spec_value_alias for update using (is_admin());

drop policy if exists admin_delete on public.spec_value_alias;
create policy admin_delete on public.spec_value_alias for delete using (is_admin());

-- ---- Recoverable aliases -------------------------------------------------
insert into public.spec_value_alias (field_path, raw_value, canonical_value, target_operator, status, notes) values
  -- Door series: Pioneer marketing labels -> family codes
  ('door.door_series_construction', 'Piosonic',   'STC', 'EQ', 'alias', 'Pioneer sound-rated marketing name'),
  ('door.door_series_construction', 'Piocane 50', 'W50', 'EQ', 'alias', 'Pioneer windstorm marketing name'),
  ('door.door_series_construction', 'Piocane 70', 'W70', 'EQ', 'alias', 'Pioneer windstorm marketing name'),
  ('door.door_series_construction', 'FEMA 361',   'FEMA','EQ', 'alias', 'storm-shelter label -> family code'),
  -- Frame series: labels + combined series/gauge + multi-value operands
  ('frame.frame_series', 'FEMA 361',     'FEMA',        'EQ', 'alias', 'storm-shelter label -> family code'),
  ('frame.frame_series', 'Piocane 50',   'F50',         'EQ', 'alias', 'Pioneer windstorm marketing name'),
  ('frame.frame_series', 'Piocane 70',   'F70',         'EQ', 'alias', 'Pioneer windstorm marketing name'),
  ('frame.frame_series', 'STK 14',       'STK',         'EQ', 'alias', 'gauge is carried by a separate frame_gauge condition'),
  ('frame.frame_series', 'STK 16',       'STK',         'EQ', 'alias', 'gauge is carried by a separate frame_gauge condition'),
  ('frame.frame_series', 'F/DW',         'F|DW',        'IN', 'alias', 'multi-series operand -> IN list'),
  ('frame.frame_series', 'F/DW/SPF/STK', 'F|DW|SPF|STK','IN', 'alias', 'multi-series operand -> IN list'),
  -- Frame gauge: "F Series 14" -> 14
  ('frame.frame_gauge', 'F Series 14', '14', 'EQ', 'alias', 'series prefix stripped from gauge'),
  ('frame.frame_gauge', 'F Series 16', '16', 'EQ', 'alias', 'series prefix stripped from gauge'),
  ('frame.frame_gauge', 'F Series 18', '18', 'EQ', 'alias', 'series prefix stripped from gauge'),
  -- Door gauge: "H or CH 14" / "LW or C 16" -> trailing gauge number
  ('door.door_gauge', 'H or CH 14', '14', 'EQ', 'alias', 'series prefix stripped from gauge'),
  ('door.door_gauge', 'H or CH 16', '16', 'EQ', 'alias', 'series prefix stripped from gauge'),
  ('door.door_gauge', 'H or CH 18', '18', 'EQ', 'alias', 'series prefix stripped from gauge'),
  ('door.door_gauge', 'LW or C 14', '14', 'EQ', 'alias', 'series prefix stripped from gauge'),
  ('door.door_gauge', 'LW or C 16', '16', 'EQ', 'alias', 'series prefix stripped from gauge'),
  ('door.door_gauge', 'LW or C 18', '18', 'EQ', 'alias', 'series prefix stripped from gauge'),
  -- Material casing -> canonical lower-case token
  ('door.door_material',  'Galvannealed', 'galvannealed', 'EQ', 'alias', 'case-normalize to canonical token'),
  ('frame.frame_material','Galvannealed', 'galvannealed', 'EQ', 'alias', 'case-normalize to canonical token')
on conflict (field_path, raw_value) do nothing;

-- ---- Unrecoverable values (flag for re-ingestion, never guessed) ---------
insert into public.spec_value_alias (field_path, raw_value, canonical_value, target_operator, status, notes) values
  -- Door gauge polluted with series codes / headers / STC table dumps
  ('door.door_gauge', 'H',     null, 'EQ', 'reject', 'series code leaked into gauge field'),
  ('door.door_gauge', 'CH',    null, 'EQ', 'reject', 'series code leaked into gauge field'),
  ('door.door_gauge', 'C',     null, 'EQ', 'reject', 'series code leaked into gauge field'),
  ('door.door_gauge', 'LW',    null, 'EQ', 'reject', 'series code leaked into gauge field'),
  ('door.door_gauge', 'EH',    null, 'EQ', 'reject', 'series code leaked into gauge field'),
  ('door.door_gauge', 'Price', null, 'EQ', 'reject', 'column header captured as value'),
  ('door.door_gauge', 'Rating STC35 Range To 35 Door Type H16 Frame Type F16/ER Gasket Type A', null, 'EQ', 'reject', 'STC table row captured as gauge'),
  ('door.door_gauge', 'Rating STC37 Range 36-37 Door Type C18 Frame Type F14/ER Gasket Type A', null, 'EQ', 'reject', 'STC table row captured as gauge'),
  ('door.door_gauge', 'Rating STC45 Range 38-45 Door Type C16 Frame Type F14/ER Gasket Type A', null, 'EQ', 'reject', 'STC table row captured as gauge'),
  ('door.door_gauge', 'Rating STC46 Range 46 Door Type C16 Frame Type F14/CO Gasket Type B',    null, 'EQ', 'reject', 'STC table row captured as gauge'),
  ('door.door_gauge', 'Rating STC48 Range 47-48 Door Type SR16 Frame Type F14/CO Gasket Type B',null, 'EQ', 'reject', 'STC table row captured as gauge'),
  ('door.door_gauge', 'Rating STC52 Range 49-52 Door Type SR16 Frame Type F14/CO Gasket Type B',null, 'EQ', 'reject', 'STC table row captured as gauge'),
  -- Frame gauge polluted with jamb depths / headers
  ('frame.frame_gauge', 'To 6',  null, 'EQ', 'reject', 'column header captured as value'),
  ('frame.frame_gauge', '6 3/4', null, 'EQ', 'reject', 'jamb depth leaked into gauge field'),
  ('frame.frame_gauge', '8 3/4', null, 'EQ', 'reject', 'jamb depth leaked into gauge field'),
  ('frame.frame_gauge', 'Price', null, 'EQ', 'reject', 'column header captured as value'),
  -- Frame series unknown code
  ('frame.frame_series', 'CNN', null, 'EQ', 'reject', 'unknown series code; needs manual review'),
  -- Panel pollution
  ('panel.panel_construction_series', 'Panels', null, 'EQ', 'reject', 'section header captured as series'),
  ('panel.panel_gauge', '3-0', null, 'EQ', 'reject', 'nominal width leaked into gauge field'),
  ('panel.panel_gauge', '4-0', null, 'EQ', 'reject', 'nominal width leaked into gauge field')
on conflict (field_path, raw_value) do nothing;
