-- CPQ continuation slice: compact builder vocabulary, A40/A60 material aliases,
-- and persisted NGP cutout display details.

update public.opening_spec_field
set allowed_values = 'CRS; Galvannealed; A40; A60',
    updated_at = now()
where field_id in ('DOR-006', 'FRM-004');

update public.opening_spec_field
set allowed_values = 'RH; LH; RHR; LHR; NH',
    updated_at = now()
where field_id = 'DOR-012';

-- Frame handing has additional frame-specific pair values. Keep them, but put
-- the common single-leaf choices in the estimator-facing order.
update public.opening_spec_field
set allowed_values = 'RH; LH; RHR; LHR; NH; RHA; LHA; DA',
    updated_at = now()
where field_id = 'FRM-014';

insert into public.spec_value_alias
  (field_path, raw_value, canonical_value, target_operator, status, notes)
values
  ('door.door_material', 'A40', 'galvannealed', 'EQ', 'alias', 'A40 galvannealed material prices through the current Galvannealed rules until A40-specific rules exist.'),
  ('door.door_material', 'A60', 'galvannealed', 'EQ', 'alias', 'A60 galvannealed material prices through the current Galvannealed rules until A60-specific rules exist.'),
  ('frame.frame_material', 'A40', 'galvannealed', 'EQ', 'alias', 'A40 galvannealed material prices through the current Galvannealed rules until A40-specific rules exist.'),
  ('frame.frame_material', 'A60', 'galvannealed', 'EQ', 'alias', 'A60 galvannealed material prices through the current Galvannealed rules until A60-specific rules exist.')
on conflict (field_path, raw_value) do update
set canonical_value = excluded.canonical_value,
    target_operator = excluded.target_operator,
    status = excluded.status,
    notes = excluded.notes;

alter table if exists public.opening_cutout
  add column if not exists order_width_in numeric,
  add column if not exists order_height_in numeric,
  add column if not exists visible_width_in numeric,
  add column if not exists visible_height_in numeric,
  add column if not exists glass_type text;

comment on column public.opening_cutout.order_width_in is
  'Resolved kit/louver order width in inches, preserved for quote/order output.';
comment on column public.opening_cutout.order_height_in is
  'Resolved kit/louver order height in inches, preserved for quote/order output.';
comment on column public.opening_cutout.visible_width_in is
  'Resolved visible/exposed glass width in inches, preserved separately from cutout and order size.';
comment on column public.opening_cutout.visible_height_in is
  'Resolved visible/exposed glass height in inches, preserved separately from cutout and order size.';
comment on column public.opening_cutout.glass_type is
  'Resolved glass model/type displayed on quotes and order detail.';
