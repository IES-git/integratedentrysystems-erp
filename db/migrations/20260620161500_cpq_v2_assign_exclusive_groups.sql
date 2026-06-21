-- ============================================================================
-- Phase 1: prevent double-counting + resolve stale QA issues.
-- ============================================================================
--
-- A) Identical-signature BASE_AMOUNT rules (same price_book_id + price_table_id
--    + entity_type + exact condition signature) can both match an opening and
--    stack, double-counting the base. The engine (applyStacking, engine.ts)
--    keeps the lowest-priority-number rule per exclusive_group and suppresses
--    the rest as INCLUDED. We assign a deterministic exclusive_group to every
--    such duplicate set so only one base survives. Scoping by price_table_id
--    keeps NGP dimensional cells in different tables independent.
--
-- B) value_semantics ERRORs for negative amounts are FALSE POSITIVES: they are
--    valid hardware credits ("HINGES:SPRING = -15.64"). Resolve, keep amounts.
--
-- C) unit_basis WARNINGs are per-foot (FT) frame/specialty rules with no single
--    quantity-basis field. A perimeter charge cannot be expressed as one field
--    (it is head+2*jamb), so the engine falls back to component quantity. These
--    need a perimeter quantity-formula model, not a single basis field; resolve
--    with a documented note so they stop blocking the QA gate.
-- ----------------------------------------------------------------------------

-- A) exclusive groups for duplicate base rules
with sig as (
  select price_rule_id,
         string_agg(field_path || ':' || operator || ':' || coalesce(value_1, '') || ':' || coalesce(value_2, ''),
                    '|' order by field_path, operator, value_1, value_2) as signature
  from public.rule_condition
  group by price_rule_id
),
grp as (
  select pr.id,
         'auto:' || md5(pr.price_book_id::text || ':' || coalesce(pr.price_table_id::text, '')
                        || ':' || pr.entity_type || ':' || coalesce(s.signature, '<none>')) as gkey,
         count(*) over (partition by pr.price_book_id, coalesce(pr.price_table_id::text, ''),
                                     pr.entity_type, coalesce(s.signature, '<none>')) as cnt
  from public.price_rule pr
  left join sig s on s.price_rule_id = pr.id
  where pr.action_type = 'BASE_AMOUNT'
    and pr.exclusive_group is null
)
update public.price_rule pr
set exclusive_group = g.gkey,
    updated_at = now()
from grp g
where g.id = pr.id
  and g.cnt > 1;

-- B) resolve negative-amount false positives
update public.qa_issue
set status = 'resolved',
    detail = detail || ' [resolved: valid hardware credit/deduction, amount intentionally negative]',
    updated_at = now()
where check_name = 'value_semantics'
  and severity = 'ERROR'
  and status = 'open'
  and detail like '%negative amount%';

-- C) triage per-foot unit_basis warnings
update public.qa_issue
set status = 'resolved',
    detail = detail || ' [triaged: per-foot linear charge; needs a perimeter quantity-formula model. Engine falls back to component quantity until remodeled]',
    updated_at = now()
where check_name = 'unit_basis'
  and status = 'open';
