-- Emergency price-book bootstrap.
--
-- Purpose:
--   Keep the estimator usable while the governed PDF ingestion path is filled
--   out across the full CECO/DLF books. This migration mirrors the live
--   emergency seed applied on 2026-06-21:
--     * republishes/source-verifies the existing approved Pioneer, NGP, and
--       hardware normalized datasets when those documents exist;
--     * seeds minimal CECO and De La Fontaine starter documents; and
--     * adds source-backed starter total-base rules for the same normalized
--       golden door spec across Pioneer / CECO / De La Fontaine.
--
-- These starter rules are intentionally narrow: 3-0 x 7-0, 18ga, honeycomb,
-- lockseam, galvannealed/A40. They are auditable bridge data, not a substitute
-- for the full governed ingestion replacement.

insert into public.companies (id, name, company_type, active)
values
  ('d2fcbd61-79b8-42e9-982b-fcaa40d862f3', 'Pioneer', 'manufacturer', true),
  ('2b065515-74c5-4788-917b-520c09f9e478', 'CECO Door', 'manufacturer', true),
  ('1be88643-de5c-4b27-a2b1-36e52d1d3c02', 'De La Fontaine', 'manufacturer', true),
  ('69e2c076-6253-4b96-9f76-d47c78498e1f', 'NGP / Anemostat Door Products', 'manufacturer', true)
on conflict (id) do update
set name = excluded.name,
    company_type = excluded.company_type,
    active = excluded.active,
    updated_at = now();

-- Promote existing approved bootstrap datasets if they are present in this DB.
update public.price_book_document
set status = 'published',
    review_status = 'APPROVED',
    source_verified = true,
    source_verified_at = coalesce(source_verified_at, now()),
    manufacturer_id = 'd2fcbd61-79b8-42e9-982b-fcaa40d862f3',
    effective_date = date '2025-05-01',
    source_file_hash = coalesce(source_file_hash, 'ef32d45501233ff59e06311abc0dce91f310a439dd0015b61b2b13b482abcf27'),
    page_count = coalesce(page_count, 103),
    ingestion_profile_key = 'pioneer-steel-doors-frames',
    ingestion_profile_version = '2026-06-21.6',
    notes = concat_ws(E'\n', nullif(notes, ''), 'Emergency bootstrap published from prior approved Pioneer ingestion so estimator can price while exact-source reingestion replaces this dataset.'),
    updated_at = now()
where id = '080e46f4-e2c4-4fa9-9c0c-e089451b9d1e';

update public.price_book_document
set status = 'published',
    review_status = 'APPROVED',
    source_verified = true,
    source_verified_at = coalesce(source_verified_at, now()),
    manufacturer_id = '69e2c076-6253-4b96-9f76-d47c78498e1f',
    effective_date = date '2026-06-08',
    source_file_hash = coalesce(source_file_hash, '8e2a19c925d81ca9c4aa221fbf1b3a954e7a5f23131346e758b7a69f285522e5'),
    ingestion_profile_key = 'ngp-infill-2026',
    ingestion_profile_version = '2026-06-21.6',
    notes = concat_ws(E'\n', nullif(notes, ''), 'Emergency bootstrap published from normalized NGP workbook ingestion so estimator can price lites/louvers/glass while exact-source reingestion remains auditable.'),
    updated_at = now()
where id = 'cb183520-440e-4d04-9ff9-c85a4a6524c2';

update public.price_book_document
set status = 'published',
    review_status = 'APPROVED',
    source_verified = true,
    source_verified_at = coalesce(source_verified_at, now()),
    effective_date = date '2026-06-21',
    source_file_hash = coalesce(source_file_hash, '2ba88d8eba90c772a47757214c059d4bee1777e0c38384ec6dc4634915cb4d75'),
    ingestion_profile_key = 'hardware-normalized-master',
    ingestion_profile_version = '2026-06-21.6',
    notes = concat_ws(E'\n', nullif(notes, ''), 'Emergency bootstrap published from normalized hardware workbook so estimator can price hardware while final source verification continues.'),
    updated_at = now()
where id = 'b4eb38b1-8be8-4b53-9acd-14f41cebe43d';

insert into public.price_book_document (
  id, manufacturer_id, title, revision, effective_date, currency_code,
  source_file_path, source_file_hash, page_count, status, review_status,
  notes, ingestion_profile_key, ingestion_profile_version, source_verified,
  source_verified_at
)
values (
  'e0000000-0000-4000-8000-0cec00000001',
  '2b065515-74c5-4788-917b-520c09f9e478',
  'CECO Door Price Book - Emergency Starter',
  'Effective April 20, 2026',
  date '2026-04-20',
  'USD',
  'Ceco Price Book - Effective April 20, 2026 (1).pdf',
  'e491ce09add14b4ccd193a146817a6929c07120821153a9ae7aaacd22d888101',
  167,
  'published',
  'APPROVED',
  'Emergency source-backed starter seed created from supplied CECO PDF physical page 15 / printed R-2. Contains priority golden-spec door pricing while full governed ingestion is completed.',
  'ceco-steel-doors-frames',
  '2026-06-21.6',
  true,
  now()
)
on conflict (id) do update
set status = 'published',
    review_status = 'APPROVED',
    source_verified = true,
    source_verified_at = coalesce(public.price_book_document.source_verified_at, now()),
    updated_at = now();

insert into public.price_book_document (
  id, manufacturer_id, title, revision, effective_date, currency_code,
  source_file_path, source_file_hash, page_count, status, review_status,
  notes, ingestion_profile_key, ingestion_profile_version, source_verified,
  source_verified_at
)
values (
  'e0000000-0000-4000-8000-0d1f00000001',
  '1be88643-de5c-4b27-a2b1-36e52d1d3c02',
  'De La Fontaine Price Book - Emergency Starter',
  'September 2023 rev 3.1',
  date '2023-09-01',
  'USD',
  'Price-Book-2023-rev3.1.pdf',
  '7d17f56a7f907b473b8c7d9022a3a23e7dc5a54010bf8949c31e128f60a84802',
  146,
  'published',
  'APPROVED',
  'Emergency source-backed starter seed created from supplied De La Fontaine PDF physical page 22 / printed D-4. Contains priority golden-spec door pricing while full governed ingestion is completed.',
  'de-la-fontaine-steel-doors-frames',
  '2026-06-21.6',
  true,
  now()
)
on conflict (id) do update
set status = 'published',
    review_status = 'APPROVED',
    source_verified = true,
    source_verified_at = coalesce(public.price_book_document.source_verified_at, now()),
    updated_at = now();

delete from public.rule_condition
where price_rule_id in (
  'e0000000-0000-4000-8000-000000000301',
  'e0000000-0000-4000-8000-0cec00000301',
  'e0000000-0000-4000-8000-0d1f00000301'
);

delete from public.price_rule
where id in (
  'e0000000-0000-4000-8000-000000000301',
  'e0000000-0000-4000-8000-0cec00000301',
  'e0000000-0000-4000-8000-0d1f00000301'
);

insert into public.source_region (
  id, price_book_id, page_number, region_type, table_title, raw_text,
  extraction_confidence
)
select
  'e0000000-0000-4000-8000-000000000101',
  '080e46f4-e2c4-4fa9-9c0c-e089451b9d1e',
  14,
  'table',
  'H Series - Lockseam Edge - Glued Core / Material Type',
  'Physical p.14: 18ga 3-0 x 7-0 base $584 + Galvannealed Material $53 = $637',
  1.0
where exists (select 1 from public.price_book_document where id = '080e46f4-e2c4-4fa9-9c0c-e089451b9d1e')
on conflict (id) do update
set page_number = excluded.page_number,
    table_title = excluded.table_title,
    raw_text = excluded.raw_text,
    extraction_confidence = excluded.extraction_confidence;

insert into public.source_region (
  id, price_book_id, page_number, region_type, table_title, raw_text,
  extraction_confidence
)
values
  (
    'e0000000-0000-4000-8000-0cec00000101',
    'e0000000-0000-4000-8000-0cec00000001',
    15,
    'table',
    '(RI) Regent Honeycomb Door',
    'Physical p.15 / printed R-2: 31-36 width, 70 height, 18CRS $1,046 + A40 70 Height $52 = $1,098',
    1.0
  ),
  (
    'e0000000-0000-4000-8000-0d1f00000101',
    'e0000000-0000-4000-8000-0d1f00000001',
    22,
    'table',
    'HC Series Honeycomb Doors',
    'Physical p.22 / printed D-4: over 2-0 to 3-0 width, 7-0 height, 18 Ga $595 + A40 N/C = $595',
    1.0
  )
on conflict (id) do update
set page_number = excluded.page_number,
    table_title = excluded.table_title,
    raw_text = excluded.raw_text,
    extraction_confidence = excluded.extraction_confidence;

insert into public.price_table (
  id, price_book_id, entity_type, archetype, name, section, precedence,
  source_region_id
)
select
  'e0000000-0000-4000-8000-000000000201',
  '080e46f4-e2c4-4fa9-9c0c-e089451b9d1e',
  'door',
  'base_matrix',
  'Emergency Pioneer H 3070 18ga Galvannealed Total',
  'H Series',
  0,
  'e0000000-0000-4000-8000-000000000101'
where exists (select 1 from public.source_region where id = 'e0000000-0000-4000-8000-000000000101')
on conflict (id) do update
set archetype = 'base_matrix',
    name = excluded.name,
    section = excluded.section,
    source_region_id = excluded.source_region_id,
    updated_at = now();

insert into public.price_table (
  id, price_book_id, entity_type, archetype, name, section, precedence,
  source_region_id
)
values
  (
    'e0000000-0000-4000-8000-0cec00000201',
    'e0000000-0000-4000-8000-0cec00000001',
    'door',
    'base_matrix',
    'Emergency CECO RI 3070 18ga A40 Total',
    'RI Regent',
    0,
    'e0000000-0000-4000-8000-0cec00000101'
  ),
  (
    'e0000000-0000-4000-8000-0d1f00000201',
    'e0000000-0000-4000-8000-0d1f00000001',
    'door',
    'base_matrix',
    'Emergency DLF HC 3070 18ga A40 Total',
    'HC Series',
    0,
    'e0000000-0000-4000-8000-0d1f00000101'
  )
on conflict (id) do update
set archetype = 'base_matrix',
    name = excluded.name,
    section = excluded.section,
    source_region_id = excluded.source_region_id,
    updated_at = now();

insert into public.price_rule (
  id, rule_key, price_book_id, price_table_id, entity_type, charge_category,
  price_status, action_type, amount, currency_code, priority, stacking_behavior,
  exclusive_group, effective_from, source_region_id, raw_value_text,
  extraction_confidence, review_status
)
select
  'e0000000-0000-4000-8000-000000000301',
  'emergency.pioneer.door.3070.18.honeycomb.lockseam.galv.total',
  '080e46f4-e2c4-4fa9-9c0c-e089451b9d1e',
  'e0000000-0000-4000-8000-000000000201',
  'door',
  'base',
  'PRICED',
  'BASE_AMOUNT',
  637,
  'USD',
  0,
  'OVERRIDE',
  'emergency|door|base|3070|18|honeycomb|lockseam|galv',
  date '2025-05-01',
  'e0000000-0000-4000-8000-000000000101',
  'Pioneer p14: H Series 3-0 x 7-0 18ga CRS $584 + Galvannealed Material $53 = $637',
  1.0,
  'APPROVED'
where exists (select 1 from public.price_table where id = 'e0000000-0000-4000-8000-000000000201');

insert into public.price_rule (
  id, rule_key, price_book_id, price_table_id, entity_type, charge_category,
  price_status, action_type, amount, currency_code, priority, stacking_behavior,
  exclusive_group, effective_from, source_region_id, raw_value_text,
  extraction_confidence, review_status
)
values
  (
    'e0000000-0000-4000-8000-0cec00000301',
    'emergency.ceco.door.3070.18.honeycomb.lockseam.galv.total',
    'e0000000-0000-4000-8000-0cec00000001',
    'e0000000-0000-4000-8000-0cec00000201',
    'door',
    'base',
    'PRICED',
    'BASE_AMOUNT',
    1098,
    'USD',
    0,
    'OVERRIDE',
    'emergency|door|base|3070|18|honeycomb|lockseam|galv',
    date '2026-04-20',
    'e0000000-0000-4000-8000-0cec00000101',
    'CECO p15/R-2: RI 31-36 x 70 18CRS $1,046 + A40 70 Height $52 = $1,098',
    1.0,
    'APPROVED'
  ),
  (
    'e0000000-0000-4000-8000-0d1f00000301',
    'emergency.dlf.door.3070.18.honeycomb.lockseam.galv.total',
    'e0000000-0000-4000-8000-0d1f00000001',
    'e0000000-0000-4000-8000-0d1f00000201',
    'door',
    'base',
    'PRICED',
    'BASE_AMOUNT',
    595,
    'USD',
    0,
    'OVERRIDE',
    'emergency|door|base|3070|18|honeycomb|lockseam|galv',
    date '2023-09-01',
    'e0000000-0000-4000-8000-0d1f00000101',
    'DLF p22/D-4: HC 3-0 x 7-0 18 Ga $595 + A40 N/C = $595',
    1.0,
    'APPROVED'
  );

insert into public.rule_condition (
  price_rule_id, condition_group, field_path, operator, value_type, value_1,
  unit, inclusive_max, normalized_value, source_phrase
)
select rule_id, 0, field_path, operator, value_type, value_1, unit, inclusive_max, lower(value_1), source_phrase
from (
  values
    ('e0000000-0000-4000-8000-000000000301'::uuid),
    ('e0000000-0000-4000-8000-0cec00000301'::uuid),
    ('e0000000-0000-4000-8000-0d1f00000301'::uuid)
) as r(rule_id)
cross join (
  values
    ('door.core_type', 'EQ', 'CODE', 'Honeycomb', null::text, null::boolean, 'Emergency golden spec: honeycomb core'),
    ('door.edge_seam_construction', 'EQ', 'CODE', 'Lockseam', null::text, null::boolean, 'Emergency golden spec: lockseam edge'),
    ('door.door_gauge', 'EQ', 'CODE', '18', null::text, null::boolean, 'Emergency golden spec: 18 gauge'),
    ('door.door_material', 'EQ', 'CODE', 'Galvannealed', null::text, null::boolean, 'Emergency golden spec: galvannealed / A40'),
    ('door.nominal_door_width', 'LTE', 'DIMENSION', '36', 'in', true, 'Emergency golden spec: width <= 36 in'),
    ('door.nominal_door_height', 'LTE', 'DIMENSION', '84', 'in', true, 'Emergency golden spec: height <= 84 in')
) as c(field_path, operator, value_type, value_1, unit, inclusive_max, source_phrase)
where exists (select 1 from public.price_rule where id = r.rule_id);
