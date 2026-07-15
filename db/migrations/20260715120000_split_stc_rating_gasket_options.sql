-- Replace the legacy slash-delimited STC/gasket shorthand with explicit enum
-- values so every rating and gasket type is rendered as its own dropdown item.

UPDATE public.opening_spec_field
SET field_label = 'STC rating and gasket type',
    allowed_values = 'STC35; STC37; STC42; STC44; STC45; STC46; STC48; STC52; gasket A; gasket B',
    pricing_logic = 'Each STC rating and gasket type is stored as an explicit selectable value.',
    updated_at = now()
WHERE field_id = 'OPN-019';
