-- Store transom/DOD/overall-frame dimensions as distinct governed spec values.
-- Overall height is intentionally not calculated from generic assumptions;
-- manufacturer-specific frame face/bar deductions require confirmed inputs.

INSERT INTO public.opening_spec_field
  (field_id, entity, category, field_label, data_type, required_when, allowed_values, pricing_logic, pdf_pages, priced_by, sort_order)
VALUES
  ('OPN-028','opening','Transom','Transom infill type','Enum','Sidelite/transom configuration','None; Panel; Glass','Controls panel/glass transom scope and required order dimensions.','24-25, 71-73','Project/order data',27),
  ('OPN-029','opening','Transom','Transom scope','Text','Transom selected','Single; Pair','Derived from leaf count; used in frame and vendor callouts.','24-25, 71-73','Project/order data',28),
  ('OPN-030','opening','Transom','Door opening dimension (DOD) width','Dimension','Transom selected','Controlled door-industry notation','Defaults from nominal opening width but remains independently overridable.','24-25, 71-73','Project/order data',29),
  ('OPN-031','opening','Transom','Door opening dimension (DOD) height','Dimension','Transom selected','Controlled door-industry notation','Defaults from nominal opening height but remains independently overridable.','24-25, 71-73','Project/order data',30),
  ('OPN-032','opening','Transom','Transom panel / glass width','Dimension','Transom selected','Controlled door-industry notation','Kept separate from visible glass and overall frame dimensions.','24-25, 71-73','Project/order data',31),
  ('OPN-033','opening','Transom','Transom panel / glass height','Dimension','Transom selected','Controlled door-industry notation','Authoritative ordered transom size; no manufacturer deduction is assumed.','24-25, 71-73','Project/order data',32),
  ('OPN-034','opening','Transom','Overall frame width','Dimension','Transom selected','Controlled door-industry notation','Defaults from nominal opening width and can be overridden for custom units.','71-73','Project/order data',33),
  ('OPN-035','opening','Transom','Overall frame height','Dimension','Transom selected','Controlled door-industry notation','Explicit input because bar, face, and manufacturer deductions vary.','71-73','Project/order data',34),
  ('OPN-036','opening','Transom','Generated frame / order callout','Text','Transom selected','Generated','Combines mark, single/pair scope, DOD, transom type/size, and overall frame size.','71-73','Project/order data',35)
ON CONFLICT (field_id) DO UPDATE
SET field_label = excluded.field_label,
    data_type = excluded.data_type,
    required_when = excluded.required_when,
    allowed_values = excluded.allowed_values,
    pricing_logic = excluded.pricing_logic,
    priced_by = excluded.priced_by,
    sort_order = excluded.sort_order,
    updated_at = now();

INSERT INTO public.spec_field_mapping (field_id, field_path, value_type)
VALUES
  ('OPN-028','opening.transom_infill_type','TEXT'),
  ('OPN-029','opening.transom_scope','TEXT'),
  ('OPN-030','opening.door_opening_dimension_width','DIMENSION'),
  ('OPN-031','opening.door_opening_dimension_height','DIMENSION'),
  ('OPN-032','opening.transom_width','DIMENSION'),
  ('OPN-033','opening.transom_height','DIMENSION'),
  ('OPN-034','opening.overall_frame_width','DIMENSION'),
  ('OPN-035','opening.overall_frame_height','DIMENSION'),
  ('OPN-036','opening.frame_order_callout','TEXT')
ON CONFLICT (field_id) DO UPDATE
SET field_path = excluded.field_path,
    value_type = excluded.value_type;
