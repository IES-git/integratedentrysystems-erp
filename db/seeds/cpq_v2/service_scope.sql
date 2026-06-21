-- ============================================================================
-- Phase 3: default service scopes (install / freight / tax).
-- ============================================================================
--
-- Without any service_scope rows the engine emits no install/freight/tax lines,
-- so quotes are materials-only. These defaults make quotes complete; the rates
-- are PLACEHOLDERS flagged in `notes` and must be confirmed by ops/finance
-- before they are used on a real quote. The engine (priceServices, engine.ts)
-- reads rate for per_* / flat bases and percent for percent_of.
--
-- Idempotent: guarded by NOT EXISTS on (scope_type, name).
-- ----------------------------------------------------------------------------

insert into public.service_scope (scope_type, name, basis, rate, percent, reference_basis, notes)
select v.scope_type, v.name, v.basis, v.rate, v.percent, v.reference_basis, v.notes
from (values
  ('install', 'Field install labor', 'per_leaf',   95.00, null,  null,
   'DEFAULT placeholder: labor per leaf. Verify with ops before quoting.'),
  ('freight', 'Freight & delivery',  'percent_of', null,  6.00,  'sell_subtotal',
   'DEFAULT placeholder: 6% of sell subtotal. Verify per destination/lane.'),
  ('tax',     'Sales tax',           'percent_of', null,  0.00,  'taxable_subtotal',
   'DEFAULT placeholder: 0%. Set the sales-tax rate per project jurisdiction.')
) as v(scope_type, name, basis, rate, percent, reference_basis, notes)
where not exists (
  select 1 from public.service_scope s
  where s.scope_type = v.scope_type and s.name = v.name
);
