-- ============================================================================
-- Rule-condition vocabulary audit (Phase 1 - correctness)
-- ============================================================================
--
-- The pricing engine (src/lib/pricing/conditions.ts) matches a price_rule by
-- comparing rule_condition.value_1/value_2 to the value the builder writes for
-- the same field_path. The match is case-insensitive (lower+trim) but EQ does
-- NOT split on '/', so any label-polluted, wrong-field, or multi-value operand
-- silently fails to match -> the opening gets an INVALID line / manual quote.
--
-- These read-only queries enumerate that pollution per field_path so it can be
-- quantified before/after the cleanup migration
-- (cpq_v2_clean_rule_condition_vocab). They are safe to run any time.
--
-- The canonical vocabulary lives in opening_spec_field.allowed_values (a
-- "; "-separated list) joined through spec_field_mapping.field_path.
-- ----------------------------------------------------------------------------

-- 1. Out-of-vocabulary EQ/NE/IN values for every enum-typed spec field.
--    Anything returned here is a value the builder can never emit, so the rule
--    is effectively dead (or, for IN lists, partially dead).
with enum_field as (
  select m.field_path,
         f.field_id,
         f.allowed_values,
         -- normalized canonical token set for the field
         array(
           select lower(btrim(t))
           from unnest(string_to_array(f.allowed_values, ';')) as t
           where btrim(t) <> ''
         ) as canon
  from spec_field_mapping m
  join opening_spec_field f on f.field_id = m.field_id
  where f.data_type = 'Enum'
)
select rc.field_path,
       rc.value_1,
       count(distinct rc.price_rule_id) as affected_rules
from rule_condition rc
join enum_field e on e.field_path = rc.field_path
where rc.operator in ('EQ', 'NE', 'IN', 'NOT_IN')
  and rc.value_1 is not null
  and lower(btrim(rc.value_1)) <> all (e.canon)
  -- IN/NOT_IN may carry a legit pipe/comma list; only flag when NO token matches
  and not exists (
    select 1
    from unnest(string_to_array(rc.value_1, '|') || string_to_array(rc.value_1, ',')) tok
    where lower(btrim(tok)) = any (e.canon)
  )
group by rc.field_path, rc.value_1
order by rc.field_path, affected_rules desc;

-- 2. Multi-value EQ operands (should be IN). EQ never splits on '/', so an
--    operand like 'F/DW/SPF/STK' can only ever match a literal slash string.
select field_path, value_1, count(distinct price_rule_id) as affected_rules
from rule_condition
where operator = 'EQ'
  and value_1 ~ '[/]'
group by field_path, value_1
order by field_path, affected_rules desc;

-- 3. Coverage summary: distinct rule values vs canonical per enum field.
with enum_field as (
  select m.field_path, f.allowed_values,
         array(select lower(btrim(t)) from unnest(string_to_array(f.allowed_values, ';')) t where btrim(t) <> '') as canon
  from spec_field_mapping m
  join opening_spec_field f on f.field_id = m.field_id
  where f.data_type = 'Enum'
)
select e.field_path,
       count(distinct rc.value_1) as distinct_rule_values,
       count(distinct rc.value_1) filter (where lower(btrim(rc.value_1)) = any (e.canon)) as in_vocabulary,
       count(distinct rc.value_1) filter (where lower(btrim(rc.value_1)) <> all (e.canon)) as out_of_vocabulary
from enum_field e
left join rule_condition rc
  on rc.field_path = e.field_path and rc.operator in ('EQ','NE','IN','NOT_IN') and rc.value_1 is not null
group by e.field_path
order by out_of_vocabulary desc, e.field_path;

-- 4. Overlapping BASE rules sharing identical condition signatures with no
--    exclusive_group (double-count risk). Mirrors the qa_issue rule_overlap check.
select pr.entity_type,
       string_agg(distinct pr.charge_category, ',') as charge_categories,
       sig.signature,
       count(*) as rule_count
from price_rule pr
join (
  select price_rule_id,
         string_agg(field_path || ':' || operator || ':' || coalesce(value_1,'') || ':' || coalesce(value_2,''),
                    '|' order by field_path, operator, value_1) as signature
  from rule_condition
  group by price_rule_id
) sig on sig.price_rule_id = pr.id
where pr.action_type = 'BASE_AMOUNT'
  and pr.exclusive_group is null
group by pr.entity_type, sig.signature
having count(*) > 1
order by rule_count desc;
