-- ============================================================================
-- Spec-driven Opening Builder (Release 1): versioned capability + resolution.
-- ============================================================================
--
-- Manufacturer series (DOR-002 / FRM-002) become resolution OUTPUTS. The
-- resolver eliminates families that cannot satisfy a requirement using
-- `product_family_capability` predicates, ranks the survivors with
-- `family_resolution_policy`, records every selected/derived option or prep in
-- `opening_component_option` (replacing the single door.option_code limitation),
-- and writes an immutable `opening_resolution_revision` per resolve.
--
-- `estimate_openings.resolver_version` gates the new spec engine vs the legacy
-- path: NULL = legacy/unmigrated; >=1 = resolver-managed (see RESOLVER_VERSION).
-- ----------------------------------------------------------------------------

-- 1. Versioned capability predicates: what each product family supports. -----
create table if not exists public.product_family_capability (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.product_family(id) on delete cascade,
  component_scope text not null check (component_scope in ('opening','door','frame','panel')),
  field           text not null,
  operator        text not null default 'EQ'
                    check (operator in ('EQ','NE','IN','NOT_IN','GT','GTE','LT','LTE','BETWEEN','EXISTS','MISSING')),
  value           text,
  value2          text,
  catalog_version text not null default 'R1',
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_pfc_family on public.product_family_capability(family_id);
create index if not exists idx_pfc_scope_ver on public.product_family_capability(component_scope, catalog_version);

comment on table public.product_family_capability is
  'Versioned predicates (field/operator/value) defining what each product_family supports. The resolver eliminates families whose predicates fail any requirement.';

-- 2. Ranking + display policy for compliant candidates. ----------------------
create table if not exists public.family_resolution_policy (
  id              uuid primary key default gen_random_uuid(),
  component_scope text not null check (component_scope in ('opening','door','frame','panel')),
  family_id       uuid references public.product_family(id) on delete cascade,
  rank            int not null default 100,
  auto_accept     boolean not null default true,
  display_label   text,
  catalog_version text not null default 'R1',
  created_at      timestamptz not null default now()
);
create index if not exists idx_frp_scope_ver on public.family_resolution_policy(component_scope, catalog_version);

comment on table public.family_resolution_policy is
  'Ranking + display policy for compliant resolution candidates. Lower rank is preferred; auto_accept allows a sole survivor to be accepted without estimator input.';

-- 3. Multiple selected/derived options or preps per component. ---------------
create table if not exists public.opening_component_option (
  id           uuid primary key default gen_random_uuid(),
  opening_id   uuid not null references public.estimate_openings(id) on delete cascade,
  component_id uuid references public.estimate_items(id) on delete set null,
  scope        text not null check (scope in ('opening','door','frame','panel')),
  kind         text not null check (kind in ('option','prep')),
  code         text not null,
  source       text not null default 'derived' check (source in ('derived','estimator','capability')),
  description  text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_oco_opening on public.opening_component_option(opening_id);
create index if not exists idx_oco_component on public.opening_component_option(component_id);

comment on table public.opening_component_option is
  'Selected/derived options and preps per opening component. Replaces the single door.option_code field so a component can carry many priced options/preps.';

-- 4. Immutable resolution revision (input spec, candidates, selection, config).
create table if not exists public.opening_resolution_revision (
  id                    uuid primary key default gen_random_uuid(),
  opening_id            uuid not null references public.estimate_openings(id) on delete cascade,
  estimate_id           uuid references public.estimates(id) on delete cascade,
  resolver_version      int not null,
  catalog_version       text,
  price_book_id         uuid references public.price_book_document(id),
  priced_as_of          date,
  input_spec            jsonb not null default '{}'::jsonb,
  candidates            jsonb not null default '[]'::jsonb,
  estimator_selection_id text,
  resolved_config       jsonb not null default '{}'::jsonb,
  created_by            uuid references public.users(id),
  created_at            timestamptz not null default now()
);
create index if not exists idx_orr_opening on public.opening_resolution_revision(opening_id, created_at desc);

comment on table public.opening_resolution_revision is
  'Immutable snapshot per resolve: input UserOpeningSpec, candidate set, estimator selection, derived ResolvedOpeningConfig, and pinned resolver/catalog/price-book versions. Repricing appends a new row; prior revisions are retained for audit.';

-- 5. Gating column: which openings are resolver-managed. ----------------------
alter table public.estimate_openings
  add column if not exists resolver_version int default null;
comment on column public.estimate_openings.resolver_version is
  'NULL = legacy/unmigrated opening (legacy pricing authority). >=1 = managed by the spec resolver at that RESOLVER_VERSION (new engine is the sole pricing authority).';

-- 6. Estimate-level price-book pinning (idempotent — may already exist). ------
alter table public.estimates add column if not exists price_book_id uuid references public.price_book_document(id);
alter table public.estimates add column if not exists priced_as_of date;
comment on column public.estimates.price_book_id is 'Pinned Pioneer price_book_document the estimate was priced against (deterministic reprice).';
comment on column public.estimates.priced_as_of is 'Effective date the estimate was priced as of (pins rule/price effective-date filtering).';

-- ---- RLS -------------------------------------------------------------------
alter table public.product_family_capability   enable row level security;
alter table public.family_resolution_policy    enable row level security;
alter table public.opening_component_option    enable row level security;
alter table public.opening_resolution_revision enable row level security;

-- Catalog tables: world-readable, admin-writable (mirror spec_value_alias).
drop policy if exists auth_read on public.product_family_capability;
create policy auth_read on public.product_family_capability for select using (true);
drop policy if exists admin_write on public.product_family_capability;
create policy admin_write on public.product_family_capability for all using (is_admin()) with check (is_admin());

drop policy if exists auth_read on public.family_resolution_policy;
create policy auth_read on public.family_resolution_policy for select using (true);
drop policy if exists admin_write on public.family_resolution_policy;
create policy admin_write on public.family_resolution_policy for all using (is_admin()) with check (is_admin());

-- Opening-scoped tables: any authenticated user (mirror estimate_line access).
drop policy if exists auth_all on public.opening_component_option;
create policy auth_all on public.opening_component_option for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists auth_all on public.opening_resolution_revision;
create policy auth_all on public.opening_resolution_revision for all using (auth.uid() is not null) with check (auth.uid() is not null);
