-- Complete the estimator-facing material and performance vocabulary. Specialty
-- materials/ratings remain selectable and route to manual/vendor quote when no
-- governed published price rule exists.

UPDATE public.opening_spec_field
SET allowed_values = 'CRS; Galvannealed; A40; A60; Stainless 304; Stainless 316; Aluminum; Fiberglass/FRP',
    updated_at = now()
WHERE field_id IN ('DOR-006', 'FRM-004', 'PNL-006');

UPDATE public.opening_spec_field
SET allowed_values = 'Mylar; metal; embossed',
    pricing_logic = 'Captures the label form without duplicating the separate frame riveted-label preparation/adder.',
    updated_at = now()
WHERE field_id = 'OPN-016';

UPDATE public.opening_spec_field
SET field_label = 'Wind / TDI design requirement',
    allowed_values = 'TDI; PSF; MPH; Florida approval number',
    updated_at = now()
WHERE field_id = 'OPN-017';

UPDATE public.opening_spec_field
SET field_label = 'STC rating',
    allowed_values = '35; 37; 42; 44; 45; 46; 48; 52',
    updated_at = now()
WHERE field_id = 'OPN-019';

UPDATE public.opening_spec_field
SET allowed_values = 'UL 752 Level I; UL 752 Level II; UL 752 Level III; UL 752 Level IV; UL 752 Level V; UL 752 Level VI; UL 752 Level VII; UL 752 Level VIII',
    updated_at = now()
WHERE field_id = 'OPN-021';

INSERT INTO public.opening_spec_field
  (field_id, entity, category, field_label, data_type, required_when, allowed_values, pricing_logic, pdf_pages, priced_by, sort_order)
VALUES
  ('OPN-027', 'opening', 'Performance', 'Forced-entry requirement', 'Text', 'Forced-entry opening',
   'Standard / test protocol / project criteria',
   'Routes forced-entry assemblies and hardware to the governed specialty or manual/custom workflow.',
   'Project specification', 'Manual/vendor quote', 26)
ON CONFLICT (field_id) DO UPDATE
SET field_label = excluded.field_label,
    allowed_values = excluded.allowed_values,
    pricing_logic = excluded.pricing_logic,
    updated_at = now();

INSERT INTO public.spec_field_mapping (field_id, field_path, value_type)
VALUES ('OPN-027', 'opening.forced_entry_requirement', 'TEXT')
ON CONFLICT (field_id) DO UPDATE
SET field_path = excluded.field_path,
    value_type = excluded.value_type;
