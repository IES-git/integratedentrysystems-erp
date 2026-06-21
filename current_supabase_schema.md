# Current Supabase Schema

Last updated: 2026-06-21 (Auth overhaul: invite-only flow, role enum simplified to admin/sales/ops, active-user gate, role-based route guards; blocked_field_labels and item_type_base_fields policies migrated to use is_admin())

## Authentication Status

✅ **Supabase Authentication is LIVE — Invite-Only**
- Login page using `auth.signInWithPassword()` with active-user gate
- Invite-only: no public signup page; admins invite users via Edge Function (`invite-user`)
- Invited users set their password via `/accept-invite` on first login
- Password reset flow via `/forgot-password` → `/reset-password`
- AuthContext integrated with Supabase sessions
- Session persistence enabled
- Role-based route guards enforced at frontend (`RoleGuard`) and DB (RLS + `is_admin()`)

### Required Manual Configuration (Supabase Dashboard)

Go to: https://supabase.com/dashboard/project/osgxfggpqecspyvfrvqe/auth/url-configuration

1. **Site URL** — set to your production domain (e.g. `https://your-app.vercel.app`)
2. **Redirect URLs allowlist** — add all of the following:
   ```
   https://your-app.vercel.app/accept-invite
   https://your-app.vercel.app/reset-password
   http://localhost:5173/accept-invite
   http://localhost:5173/reset-password
   ```
3. **Edge Function secret** — set `SITE_URL` in the Supabase Edge Functions secrets to your production domain so invite emails link to the right URL:
   - Dashboard → Edge Functions → Manage secrets → add `SITE_URL=https://your-app.vercel.app`

## Storage Buckets

### estimate-files

Storage bucket for uploaded estimate files (PDFs and images).

**Configuration:**
- `id`: estimate-files
- `public`: false (private bucket)
- `file_size_limit`: 52428800 bytes (50MB)
- `allowed_mime_types`: application/pdf, image/jpeg, image/jpg, image/png, image/gif

**RLS Policies:**
- ✅ Row Level Security is ENABLED on storage.objects
- `Authenticated users can upload estimate files` - Any authenticated user can upload files (INSERT)
- `Authenticated users can read estimate files` - Any authenticated user can read files (SELECT)
- `Users can update their own estimate files` - Users can update metadata on files they own (UPDATE)
- `Users can delete own files, admins can delete any` - Users can delete files they own, admins can delete any file (DELETE)

## Enums

### user_role
```sql
CREATE TYPE user_role AS ENUM ('admin', 'sales', 'ops');
```
- `admin` — full access including user management
- `sales` — main nav only (estimates, quotes, customers, etc.)
- `ops` — main + admin nav except user management

## Tables

### public.field_definitions

The "learning" table that grows as Gemini discovers new field types during estimate processing.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `field_key` (TEXT, UNIQUE NOT NULL) - Unique identifier for field (e.g., 'gauge', 'hinge_prep')
- `field_label` (TEXT, NOT NULL) - Display label (e.g., "Gauge", "Hinge Prep")
- `value_type` (TEXT, NOT NULL) - Data type: 'string', 'number', 'bool', 'date', 'code'
- `option_type` (TEXT, NOT NULL, DEFAULT 'selection') - How this field is input in the wizard: 'selection' (dropdown from predefined options), 'string' (free-text), or 'integer' (numeric entry). CHECK constraint enforces these three values.
- `description` (TEXT) - AI-generated description of what this field represents
- `status` (TEXT, NOT NULL, DEFAULT 'pending_review') - 'approved' or 'pending_review'
- `usage_count` (INTEGER, DEFAULT 0) - How many times this field has been extracted
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - User-defined display order for "other" fields (drag-and-drop in Item Management)
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW()) - Last update timestamp

**Indexes:**
- `idx_field_definitions_field_key` on field_key
- `idx_field_definitions_status` on status

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read field definitions` - All authenticated users can SELECT
- `Admins can insert field definitions` - Only admins can INSERT new definitions
- `Admins can update field definitions` - Only admins can UPDATE (for approving/rejecting)
- `Admins can delete field definitions` - Only admins can DELETE (for removing rejected/unwanted fields)

**Triggers:**
- `set_field_definitions_updated_at` - Automatically updates updated_at timestamp

### public.blocked_field_labels

Stores field labels that the AI (Gemini Edge Function) should never extract or add to estimates. Populated automatically when a `pending_review` field definition is deleted from the Items management page.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `field_label` (TEXT, NOT NULL, UNIQUE on lower(field_label)) - The display label to block (e.g., "Gauge", "Hinge Prep")
- `field_key` (TEXT, NULLABLE) - The field_key from field_definitions if known
- `field_definition_id` (UUID, NULLABLE, FK → field_definitions.id ON DELETE SET NULL) - Reference to the source field definition
- `blocked_by_user_id` (UUID, NULLABLE, FK → auth.users.id ON DELETE SET NULL) - User who triggered the block
- `notes` (TEXT, NULLABLE) - Optional notes about why this field was blocked
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - When the block was created

**Indexes:**
- `idx_blocked_field_labels_label` UNIQUE on lower(field_label) - Prevents duplicate blocks
- `idx_blocked_field_labels_field_key` on field_key - Fast lookup by field key for the Edge Function

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read blocked field labels` - All authenticated users can SELECT
- `Admins can insert blocked field labels` - Only admins can INSERT
- `Admins can delete blocked field labels` - Only admins can DELETE (unblock)

**Usage:**
- The `process-estimate` Edge Function should query this table and exclude any matching labels from extraction output.
- When a `pending_review` field is deleted from the Items page, the app automatically inserts a row here.
- Users can remove entries from the blocked list (unblock) via the Items page UI.

### public.manufacturer_field_labels

Maps manufacturer-specific field terminology to master field definitions. Allows Gemini to normalize labels like "Width" → `opening_width` using manufacturer-specific aliases during extraction.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `field_definition_id` (UUID, NOT NULL, FK → field_definitions.id ON DELETE CASCADE) - The master field this alias maps to
- `manufacturer_id` (UUID, NULLABLE, FK → companies.id ON DELETE CASCADE) - The manufacturer this alias applies to; NULL means generic alias (no specific manufacturer)
- `manufacturer_field_label` (TEXT, NOT NULL) - The label as it appears in the manufacturer's document (e.g., "Width", "Ht")
- `status` (TEXT, NOT NULL, DEFAULT 'pending') - Approval status: `'pending'` or `'approved'`. New aliases start as pending (shown in yellow). Approved aliases shown in green.
- `notes` (TEXT) - Optional notes about this alias
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW()) - Last update timestamp

**Check Constraint:**
- `status IN ('pending', 'approved')`

**Unique Constraint:**
- `UNIQUE (field_definition_id, manufacturer_id, manufacturer_field_label)`

**Indexes:**
- `idx_manufacturer_field_labels_field_definition_id` on field_definition_id
- `idx_manufacturer_field_labels_manufacturer_id` on manufacturer_id

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read manufacturer field labels` - All authenticated users can SELECT
- `Authenticated users can insert manufacturer field labels` - All authenticated users can INSERT
- `Authenticated users can update manufacturer field labels` - All authenticated users can UPDATE
- `Authenticated users can delete manufacturer field labels` - All authenticated users can DELETE

**Triggers:**
- `set_manufacturer_field_labels_updated_at` - Automatically updates updated_at timestamp

### public.companies

Unified business entity table with a `company_type` discriminator.

- **`'customer'`** — Companies IES builds estimates and sells doors to. Shown in the Customers page and selectable in the estimate/quote wizard.
- **`'manufacturer'`** — Suppliers IES sources door, frame, and hardware product from. Shown in the Manufacturers page and selectable when building opening estimates/quotes to drive pricing.
- **`'both'`** — Companies that act in both roles (e.g. a distributor that also places orders). Appear in both customer and manufacturer selection lists.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `name` (TEXT, NOT NULL) - Company name
- `company_type` (TEXT, NOT NULL, DEFAULT 'customer') - Type of company: `'customer'`, `'manufacturer'`, or `'both'` (CHECK constraint)
- `billing_address` (TEXT) - Billing street address
- `billing_city` (TEXT) - Billing city
- `billing_state` (TEXT) - Billing state
- `billing_zip` (TEXT) - Billing ZIP code
- `shipping_address` (TEXT) - Shipping street address
- `shipping_city` (TEXT) - Shipping city
- `shipping_state` (TEXT) - Shipping state
- `shipping_zip` (TEXT) - Shipping ZIP code
- `notes` (TEXT) - Additional notes
- `active` (BOOLEAN, NOT NULL, DEFAULT true) - Whether company is active
- `settings` (JSONB, NOT NULL, DEFAULT `{"cost_multiplier": 1.0, "payment_terms": null, "default_template_id": null}`) - Company-level pricing/quote settings. Optional key `markup_overrides` (object) stores item-specific multiplier overrides, e.g. `{"hinges": 1.1, "frames": 1.3}`. Overrides take precedence over `cost_multiplier` for matching items; all other items fall back to `cost_multiplier`.
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Last update timestamp

**Indexes:**
- `idx_companies_name` on name
- `idx_companies_active` on active
- `idx_companies_company_type` on company_type

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read companies` - All authenticated users can SELECT
- `Authenticated users can insert companies` - All authenticated users can INSERT
- `Authenticated users can update companies` - All authenticated users can UPDATE
- `Authenticated users can delete companies` - All authenticated users can DELETE

**Triggers:**
- `set_companies_updated_at` - Automatically updates updated_at timestamp

### public.contacts

Contacts (people) belonging to a company.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `company_id` (UUID, NOT NULL) - FK to companies.id, CASCADE on delete
- `first_name` (TEXT, NOT NULL, DEFAULT '') - Contact first name
- `last_name` (TEXT, NOT NULL, DEFAULT '') - Contact last name
- `email` (TEXT) - Email address
- `phone` (TEXT) - Phone number
- `title` (TEXT) - Job title
- `is_primary` (BOOLEAN, NOT NULL, DEFAULT false) - Whether this is the primary contact
- `notes` (TEXT) - Additional notes
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Last update timestamp

**Constraints:**
- `contacts_company_email_unique` UNIQUE on `(company_id, email)` - prevents duplicate contacts per company

**Indexes:**
- `idx_contacts_company_id` on company_id
- `idx_contacts_email` on email

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read contacts` - All authenticated users can SELECT
- `Authenticated users can insert contacts` - All authenticated users can INSERT
- `Authenticated users can update contacts` - All authenticated users can UPDATE
- `Authenticated users can delete contacts` - All authenticated users can DELETE

**Triggers:**
- `set_contacts_updated_at` - Automatically updates updated_at timestamp

### public.estimates

Main estimate record from uploaded files.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `company_id` (UUID) - FK to companies.id, nullable, SET NULL on delete (assigned during wizard "Save Draft" flow)
- `uploaded_by_user_id` (UUID, NOT NULL) - FK to users.id
- `source` (TEXT, NOT NULL, DEFAULT 'upload') - Source of estimate
- `original_file_url` (TEXT, NOT NULL) - Supabase Storage path. Empty string `''` for `source = 'manual'` estimates (no file). TODO: make nullable.
- `original_file_name` (TEXT, NOT NULL) - Original filename. `'Manual Estimate'` for manual entries. TODO: make nullable.
- `file_type` (TEXT, NOT NULL) - 'pdf' or 'image' (CHECK constraint: `estimates_file_type_check`). Manual estimates use `'pdf'` as a placeholder. TODO: make nullable.
- `ocr_status` (TEXT, NOT NULL, DEFAULT 'pending') - 'pending', 'processing', 'done', 'error'
  - **Note:** Estimates with `ocr_status = 'done'` are ready to use as drafts for quotes
- `ocr_error` (TEXT) - Error message if OCR failed
- `extracted_customer_name` (TEXT) - AI-extracted customer name
- `extracted_customer_contact` (TEXT) - AI-extracted contact person
- `extracted_customer_email` (TEXT) - AI-extracted email
- `extracted_customer_phone` (TEXT) - AI-extracted phone
- `customer_confidence` (NUMERIC) - Confidence score for customer extraction
- `total_price` (NUMERIC, DEFAULT NULL) - Total estimate price extracted from document; updated by handleFinish with the engine grand total (including sell_adjustment_pct)
- `extracted_at` (TIMESTAMPTZ) - When extraction completed
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW()) - Last update timestamp
- `sell_adjustment_pct` (NUMERIC, NULLABLE) - Optional sell adjustment applied to the engine grand total on the Review step. Positive = markup %, negative = discount %. E.g. 10 = +10%.
- `estimate_notes` (TEXT, NULLABLE) - Free-text notes entered on the Review step before saving the estimate.

**Draft Flow:**
1. Upload: File uploaded to Supabase Storage, estimate record created with `ocr_status = 'pending'`
2. Processing: Edge Function invoked, status changes to `ocr_status = 'processing'`, then `done` when complete
3. Wizard: User reviews customer info and line items, then clicks "Save Draft"
   - **Company Assignment:** If user selects "Use Extracted Customer" and no matching company exists in the database, a new company record is automatically created in the `companies` table using the extracted data
   - Company options: Use extracted (auto-create if needed), select existing, or no company
4. List Page: Estimate appears in `/app/estimates` list (loaded from Supabase via `listEstimates()`)
5. Convert to Quote: User can convert estimate to customer/manufacturer quote from the list page

**Indexes:**
- `idx_estimates_company_id` on company_id
- `idx_estimates_uploaded_by_user_id` on uploaded_by_user_id
- `idx_estimates_ocr_status` on ocr_status
- `idx_estimates_created_at` on created_at DESC

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read estimates` - All authenticated users can SELECT
- `Users can insert their own estimates` - Users can INSERT with their own user_id
- `Users can update their own estimates` - Users can UPDATE their own estimates, admins can update all
- `Users can delete their own estimates, admins can delete any` - Users can DELETE their own estimates, admins can delete any estimate

**Triggers:**
- `set_estimates_updated_at` - Automatically updates updated_at timestamp

### public.estimate_openings

Groups of estimate items (doors/frames + hardware) within an estimate. Each opening has a name and a quantity multiplier.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `estimate_id` (UUID, NOT NULL) - FK to estimates.id, CASCADE on delete
- `name` (TEXT, NOT NULL, DEFAULT 'Opening 1') - Display name for the opening
- `quantity` (INTEGER, NOT NULL, DEFAULT 1) - How many times this opening repeats
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - Display order within the estimate
- `template_type` (ENUM `opening_template_type`, NULLABLE) - Template type for the opening; NULL means custom. Values: `single`, `pair`, `single_with_panel`, `pair_with_panel`
- `spec_snapshot` (JSONB, NULLABLE) - Full `OpeningDraft` JSON written by the spec builder on save. Enables faithful round-trip editing and re-pricing without lossy reconstruction from `item_fields`. NULL for legacy openings created before this column was added.
- `resolver_version` (INTEGER, NULLABLE, DEFAULT NULL) - Gating flag for the spec-driven resolver. NULL = legacy/unmigrated opening (legacy pricing authority); `>=1` = managed by the spec resolver at that `RESOLVER_VERSION` (new engine is the sole pricing authority). Added by `cpq_v2_spec_resolver`.
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW()) - Last update timestamp

**Indexes:**
- `idx_estimate_openings_estimate_id` on estimate_id

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read estimate openings` - Users can SELECT openings they own via estimate ownership check (or admins)
- `Users can insert openings for their own estimates` - Users can INSERT openings for their own estimates
- `Users can update openings for their own estimates` - Users can UPDATE openings they own (or admins)
- `Users can delete openings for their own estimates` - Users can DELETE openings they own (or admins)

**Triggers:**
- `set_estimate_openings_updated_at` - Automatically updates updated_at timestamp

---

### public.estimate_items

Line items extracted from estimates.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `estimate_id` (UUID, nullable) - FK to estimates.id, SET NULL on delete
- `item_label` (TEXT, NOT NULL) - Item description/label
- `canonical_code` (TEXT) - Standardized product code
- `quantity` (INTEGER, DEFAULT 1) - Item quantity
- `unit_price` (NUMERIC, DEFAULT NULL) - Unit price per item extracted from document
- `sort_order` (INTEGER, DEFAULT 0) - Display order
- `manufacturer_id` (UUID, nullable) - FK to companies.id, SET NULL on delete — the manufacturer associated with this line item
- `opening_id` (UUID, nullable) - FK to estimate_openings.id, SET NULL on delete — the opening this item belongs to
- `parent_item_id` (UUID, nullable) - FK to estimate_items.id, CASCADE on delete — for hardware items, points to the parent door or frame item
- `subcategory` (TEXT, nullable) - CHECK IN ('swing_it','close_it','latch_it','protect_it','mount_it') — hardware subcategory for display grouping; NULL for non-hardware items
- `item_type` (TEXT, nullable) - Top-level category tag matching a slug in `item_type_registry`; used by Item Fields to resolve which field definitions apply to this item. The original CHECK IN ('doors','frames','hardware') constraint has been dropped — app logic validates against `item_type_registry`.
- `price_source` (TEXT, nullable) - CHECK IN ('lookup','manual','ocr') — how the unit_price was populated: 'lookup' = matched from pricing tables, 'manual' = user typed an override on the Review step, 'ocr' = extracted from uploaded document
- `price_lookup_metadata` (JSONB, nullable) - Snapshot of the pricing resolution result; shape: `{ tableId, rowId, columnId, parentColumnId, adderCellIds: string[], vendorId, computedAt, status, warnings: string[] }`
- `is_manual_price_override` (BOOLEAN, NOT NULL, DEFAULT false) - True when the user manually edited the price on the Review step; Refresh Prices will skip this item
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp

**Indexes:**
- `idx_estimate_items_estimate_id` on estimate_id
- `idx_estimate_items_sort_order` on (estimate_id, sort_order)
- `idx_estimate_items_manufacturer_id` on manufacturer_id
- `idx_estimate_items_opening_id` on opening_id
- `idx_estimate_items_parent_item_id` on parent_item_id
- `idx_estimate_items_item_type` on item_type
- `idx_estimate_items_price_source` on price_source

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Users can read estimate items they own` - Users can SELECT items for accessible estimates, or standalone items where `estimate_id IS NULL` (manual catalog items)
- `Users can insert items for their own estimates` - Users can INSERT items for their own estimates; admins can also INSERT standalone items (`estimate_id IS NULL`) for the item catalog
- `Users can update items for their own estimates` - Users can UPDATE items for their own estimates
- `Users can delete items for their own estimates` - Users can DELETE items for their own estimates; admins can also DELETE standalone items (`estimate_id IS NULL`) for the item catalog

### public.item_fields

Individual field values for each line item.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `estimate_item_id` (UUID, NOT NULL) - FK to estimate_items.id, CASCADE on delete
- `field_definition_id` (UUID) - FK to field_definitions.id, nullable for new/unknown fields
- `field_key` (TEXT, NOT NULL) - Field identifier key
- `field_label` (TEXT, NOT NULL) - Display label
- `field_value` (TEXT, NOT NULL) - Extracted value
- `value_type` (TEXT, NOT NULL) - 'string', 'number', 'bool', 'date', 'code'
- `source_confidence` (NUMERIC) - AI confidence score
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW()) - Last update timestamp

**Indexes:**
- `idx_item_fields_estimate_item_id` on estimate_item_id
- `idx_item_fields_field_definition_id` on field_definition_id
- `idx_item_fields_field_key` on field_key

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Users can read item fields they own` - Users can SELECT fields for accessible items
- `Users can insert fields for their own items` - Users can INSERT fields for their own items
- `Users can update fields for their own items` - Users can UPDATE fields for their own items
- `Users can delete fields for their own items` - Users can DELETE fields for their own items

**Triggers:**
- `set_item_fields_updated_at` - Automatically updates updated_at timestamp

### public.users

User profile table that references Supabase Auth users.

**Columns:**
- `id` (UUID, PRIMARY KEY) - References auth.users.id, CASCADE on delete
- `email` (TEXT, NOT NULL) - User email address
- `first_name` (TEXT, NOT NULL) - User's first name
- `last_name` (TEXT, NOT NULL) - User's last name
- `job_title` (TEXT, NOT NULL) - User's job title
- `role` (user_role, NOT NULL) - User's role (admin, sales, ops, finance, hr)
- `active` (BOOLEAN, DEFAULT true) - Whether the user account is active
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Account creation timestamp
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW()) - Last update timestamp

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Users can read own profile` - Users can read their own profile data (`auth.uid() = id`)
- `Admins can read all profiles` - Users with admin role can read all profiles (uses `is_admin()` function)
- `Admins can update all profiles` - Users with admin role can update all profiles (uses `is_admin()` function)
- `Users can insert own profile` - Users can insert their own profile during signup (`auth.uid() = id`)

**Triggers:**
- `set_updated_at` - Automatically updates updated_at timestamp on row updates
- `on_auth_user_created` - Automatically creates user profile when auth user is created

## Functions

### public.is_admin()

Security definer function to check if the current user is an admin. Used by RLS policies to avoid infinite recursion.

```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;
```

### public.handle_updated_at()

Trigger function to automatically update the `updated_at` timestamp.

```sql
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

### public.rename_item_type(p_canonical_codes TEXT[], p_new_label TEXT, p_series TEXT DEFAULT NULL)

Global item-type rename RPC used by the Items Management page. Updates `item_label` in `estimate_items` and `quote_items`, `name` in `hardware_catalog`, and (when `p_series` is provided) the `field_value` for `field_key = 'series'` in `item_fields`, `series_value` in `pricing_tables`, and `value` in `field_value_options` (for series field definitions). This keeps the pricing page and estimate wizard dropdown in sync with any series rename. Uses `SECURITY DEFINER` to bypass per-user RLS so the rename applies to all estimates, not only those owned by the current user. `GRANT EXECUTE … TO authenticated` allows any logged-in user to call it.

```sql
CREATE OR REPLACE FUNCTION public.rename_item_type(
  p_canonical_codes text[],
  p_new_label       text,
  p_series          text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE estimate_items
  SET item_label = p_new_label
  WHERE canonical_code = ANY(p_canonical_codes);

  UPDATE quote_items
  SET item_label = p_new_label
  WHERE canonical_code = ANY(p_canonical_codes);

  UPDATE hardware_catalog
  SET name = p_new_label, updated_at = now()
  WHERE canonical_code = ANY(p_canonical_codes);

  IF p_series IS NOT NULL THEN
    UPDATE item_fields
    SET field_value = p_new_label
    WHERE field_key = 'series'
      AND estimate_item_id IN (
        SELECT id FROM estimate_items
        WHERE canonical_code = ANY(p_canonical_codes)
      );

    -- Keep pricing_tables.series_value in sync
    UPDATE pricing_tables
    SET series_value = p_new_label
    WHERE series_value = p_series;

    -- Keep field_value_options.value in sync for the series dropdown
    UPDATE field_value_options
    SET value = p_new_label
    WHERE value = p_series
      AND field_definition_id IN (
        SELECT id FROM field_definitions WHERE field_key = 'series'
      );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_item_type(text[], text, text) TO authenticated;
```

### public.upsert_field_value_option(p_field_definition_id UUID, p_value TEXT)

Helper RPC used by `recordFieldValueUsage()` in the API layer.  Inserts a new `field_value_options` row with `usage_count = 1` on first use, or increments `usage_count` on subsequent uses.  The JS API includes a manual fallback in case this RPC is not yet deployed.

```sql
CREATE OR REPLACE FUNCTION public.upsert_field_value_option(
  p_field_definition_id UUID,
  p_value TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO field_value_options (field_definition_id, value, usage_count)
  VALUES (p_field_definition_id, p_value, 1)
  ON CONFLICT (field_definition_id, value)
  DO UPDATE SET usage_count = field_value_options.usage_count + 1;
END;
$$;
```

### public.handle_new_user()

Trigger function to automatically create a user profile in `public.users` when a new auth user is created. Reads user metadata from `auth.users.raw_user_meta_data`.

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.users (id, email, first_name, last_name, job_title, role, active, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'job_title', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'sales')::public.user_role,
    true,
    NOW(),
    NOW()
  );
  RETURN NEW;
END;
$$;
```

### public.quotes

Quote records generated from estimates, supporting customer-facing and manufacturer-facing quote types.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `estimate_id` (UUID, NOT NULL) - FK to estimates.id, CASCADE on delete
- `company_id` (UUID, nullable) - FK to companies.id, SET NULL on delete
- `created_by_user_id` (UUID, NOT NULL) - FK to users.id, RESTRICT on delete
- `status` (TEXT, NOT NULL, DEFAULT 'draft') - 'draft' | 'sent' | 'approved' | 'rejected' | 'converted'
- `quote_type` (TEXT, NOT NULL) - 'customer' | 'manufacturer' | 'both'
- `markup_multiplier` (NUMERIC, NOT NULL, DEFAULT 1.0) - Snapshot of company cost_multiplier at time of creation
- `subtotal` (NUMERIC, NOT NULL, DEFAULT 0) - Sum of all line totals before any adjustments
- `total` (NUMERIC, NOT NULL, DEFAULT 0) - Final total after adjustments
- `currency` (TEXT, NOT NULL, DEFAULT 'USD') - ISO currency code
- `notes` (TEXT, nullable) - Quote notes / payment terms / special instructions
- `priced_as_of` (TIMESTAMPTZ, nullable) - Pins the catalog snapshot this quote was priced against, for reproducibility/audit (CPQ Phase 0). NULL for quotes created before this column existed.
- `sent_at` (TIMESTAMPTZ, nullable) - Timestamp of the first successful email delivery. NULL means never sent.
- `sent_to_email` (TEXT, nullable) - Primary recipient email address the quote was last sent to.
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Last update timestamp

**Indexes:**
- `idx_quotes_estimate_id` on estimate_id
- `idx_quotes_company_id` on company_id
- `idx_quotes_created_by_user_id` on created_by_user_id
- `idx_quotes_status` on status
- `idx_quotes_created_at` on created_at DESC

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read quotes` - All authenticated users can SELECT
- `Users can insert their own quotes` - Users can INSERT with their own user_id
- `Users can update their own quotes, admins can update all` - Users can UPDATE their own quotes, admins can update all
- `Users can delete their own quotes, admins can delete any` - Users can DELETE their own quotes, admins can delete any

**Triggers:**
- `set_quotes_updated_at` - Automatically updates updated_at timestamp

### public.quote_emails

Audit log of every email send attempt for a quote, including failures.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `quote_id` (UUID, NOT NULL) - FK to quotes.id, CASCADE on delete
- `recipient_email` (TEXT, NOT NULL) - Primary recipient address
- `cc_emails` (TEXT[], NOT NULL, DEFAULT '{}') - CC recipient addresses
- `subject` (TEXT, NOT NULL) - Email subject line
- `body` (TEXT, NOT NULL) - Email body (HTML or plain text)
- `sent_by_user_id` (UUID, NOT NULL) - FK to users.id, RESTRICT on delete
- `provider_message_id` (TEXT, nullable) - Message ID returned by Resend on success
- `status` (TEXT, NOT NULL) - 'sent' | 'failed'
- `error` (TEXT, nullable) - Error message if status = 'failed'
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Attempt timestamp

**Indexes:**
- `idx_quote_emails_quote_id` on quote_id
- `idx_quote_emails_created_at` on created_at DESC

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read quote emails` - All authenticated users can SELECT
- Inserts are performed by the `send-quote-email` edge function via service-role key (bypasses RLS)

---

### public.quote_items

Line items belonging to a quote, storing both original cost and marked-up price for dual-audience PDF generation.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `quote_id` (UUID, NOT NULL) - FK to quotes.id, CASCADE on delete
- `estimate_item_id` (UUID, nullable) - FK to estimate_items.id, SET NULL on delete
- `item_label` (TEXT, NOT NULL) - Item description/label
- `canonical_code` (TEXT, nullable) - Standardized product code / SKU
- `quantity` (INTEGER, NOT NULL, DEFAULT 1) - Item quantity
- `unit_cost` (NUMERIC, NOT NULL, DEFAULT 0) - Original cost from estimate (used in manufacturer PDF)
- `unit_price` (NUMERIC, NOT NULL, DEFAULT 0) - Marked-up price: unit_cost × markup_multiplier (used in customer PDF)
- `line_total` (NUMERIC, NOT NULL, DEFAULT 0) - quantity × unit_price
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - Display order
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Creation timestamp

**Indexes:**
- `idx_quote_items_quote_id` on quote_id
- `idx_quote_items_estimate_item_id` on estimate_item_id
- `idx_quote_items_sort_order` on (quote_id, sort_order)

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Users can read quote items they have access to` - SELECT allowed for authenticated users when the parent quote exists
- `Users can insert items for their own quotes` - INSERT allowed when the parent quote belongs to the current user
- `Users can update items for their own quotes` - UPDATE allowed for own quotes or admins
- `Users can delete items for their own quotes` - DELETE allowed for own quotes or admins

### public.templates

Quote document templates defining the format and audience for customer or manufacturer output.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `name` (TEXT, NOT NULL) - Template name
- `audience` (TEXT, NOT NULL) - `'customer'` or `'manufacturer'` (CHECK constraint)
- `description` (TEXT, NOT NULL, DEFAULT '') - Human-readable description
- `matching_rules_json` (TEXT, nullable) - JSON blob of AI matching hints/rules
- `created_by_user_id` (UUID, NOT NULL) - FK to users.id, RESTRICT on delete
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Last update timestamp

**Indexes:**
- `idx_templates_audience` on audience
- `idx_templates_created_by` on created_by_user_id
- `idx_templates_created_at` on created_at DESC

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read templates` - All authenticated users can SELECT
- `Authenticated users can insert templates` - INSERT allowed when created_by_user_id = auth.uid()
- `Users can update their own templates, admins can update all` - UPDATE for own templates or admins
- `Users can delete their own templates, admins can delete any` - DELETE for own templates or admins

**Triggers:**
- `set_templates_updated_at` - Automatically updates updated_at timestamp

**Seed data:** 3 starter templates seeded on creation — "Standard Customer Quote" (customer), "Detailed Manufacturer RFQ" (manufacturer), "Quick Estimate Summary" (customer)

---

### public.template_fields

Individual field configuration rows belonging to a template, controlling which fields appear in the PDF output and how they are labelled/grouped.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `template_id` (UUID, NOT NULL) - FK to templates.id, CASCADE on delete
- `field_key` (TEXT, NOT NULL) - Field identifier key (matches item_fields.field_key)
- `display_label_override` (TEXT, nullable) - Custom label override for PDF output
- `group_name` (TEXT, nullable) - Section/group heading in the PDF
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - Display order within the template
- `visibility` (TEXT, NOT NULL, DEFAULT 'show') - `'show'` or `'hide'` (CHECK constraint)
- `formatting_hint` (TEXT, nullable) - Optional formatting instructions for PDF renderer
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Creation timestamp

**Indexes:**
- `idx_template_fields_template_id` on template_id
- `idx_template_fields_sort_order` on (template_id, sort_order)

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read template fields` - All authenticated users can SELECT
- `Users can insert fields for their own templates` - INSERT when parent template belongs to auth.uid() or admin
- `Users can update fields for their own templates` - UPDATE when parent template belongs to auth.uid() or admin
- `Users can delete fields for their own templates` - DELETE when parent template belongs to auth.uid() or admin

---

### public.field_value_options

Tracks previously used values for each field definition, enabling smart dropdown suggestions ordered by usage frequency.

**Also seeded by price-book ingestion:** approving a base door/frame table seeds the `series` value plus `gauge` (doors) / `depth` (frames) options parsed from the column labels, and approving an adder/option table seeds that field's option values. This "normalizes" ingested price-book values into the builder's item fields so a user's selection (e.g. series `H`, gauge `18 Gauge`) resolves against the matching pricing table. See `seedBaseTableFieldOptions` / `ensureFieldOptions` in `src/lib/price-books-api.ts`. (Best-effort, idempotent.)

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `field_definition_id` (UUID, NOT NULL) - FK to field_definitions.id, CASCADE on delete
- `value` (TEXT, NOT NULL) - The stored field value
- `usage_count` (INTEGER, NOT NULL, DEFAULT 1) - How many times this value has been used
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - User-defined display order within a field (drag-and-drop)
- `is_default` (BOOLEAN, NOT NULL, DEFAULT false) - Whether this option is the default for the estimates wizard
- `code_token` (TEXT, NULL) - Abbreviation contributed to a hardware canonical_code when this option is selected (e.g. `'FM'`, `'SS'`, `'80'`). NULL for options that produce no token.
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp

**Constraints:**
- `field_value_options_field_definition_id_value_key` UNIQUE on `(field_definition_id, value)`
- `field_value_options_single_default_per_field` UNIQUE INDEX on `(field_definition_id) WHERE is_default = true` — enforces at most one default per field

**Indexes:**
- `idx_field_value_options_field_definition_id` on field_definition_id
- `idx_field_value_options_usage_count` on (field_definition_id, usage_count DESC)

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read field value options` - All authenticated users can SELECT
- `Authenticated users can insert field value options` - All authenticated users can INSERT
- `Authenticated users can update field value options` - All authenticated users can UPDATE
- `Authenticated users can delete field value options` - All authenticated users can DELETE

---

### public.item_type_fields

Junction table that explicitly associates field definitions with item types (identified by `canonical_code`) and stores a required flag. Used by the Item Management page to manage per-item-type field associations and by the estimate wizard to auto-insert required fields.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `canonical_code` (TEXT, NOT NULL) - The standardized item code (e.g., 'frames', 'hinges') — groups estimate items into item types
- `field_definition_id` (UUID, NOT NULL) - FK to field_definitions.id, CASCADE on delete
- `is_required` (BOOLEAN, NOT NULL, DEFAULT false) - Whether this field is required for this item type
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW()) - Last update timestamp

**Constraints:**
- `item_type_fields_canonical_code_field_definition_id_key` UNIQUE on `(canonical_code, field_definition_id)`

**Indexes:**
- `idx_item_type_fields_canonical_code` on canonical_code
- `idx_item_type_fields_field_definition_id` on field_definition_id

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read item type fields` - All authenticated users can SELECT
- `Authenticated users can insert item type fields` - All authenticated users can INSERT
- `Authenticated users can update item type fields` - All authenticated users can UPDATE
- `Authenticated users can delete item type fields` - All authenticated users can DELETE

**Triggers:**
- `set_item_type_fields_updated_at` - Automatically updates updated_at timestamp

---

---

### public.pricing_tables

One row per pricing series (e.g. "CH"). Category-scoped with a soft-link to `field_value_options` for traceability.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `category` (TEXT, NOT NULL) - CHECK IN ('doors','frames','hardware','lites_louvers_glass')
- `series_value` (TEXT, NOT NULL) - e.g. `'CH'` for doors (mirrors a value from `field_value_options`); for `lites_louvers_glass` tables this equals the item's `canonical_code` from `estimate_items`
- `kind` (TEXT, NOT NULL, DEFAULT 'base') - CHECK IN ('base','component','adder','option'). Role within the series: `base` = the size grid used for the base price (door/frame base-price lookup selects this); `component` = alternate base (e.g. frame heads & jambs sold as parts); `adder` = "(ADDERS)"/additional-preparation surcharges; `option` = kit/louver/glass elevations and other selectable upcharges. Adder/option tables feed `pricing_adder_cells`. Indexed `(category, series_value, kind)`.
- `selection_criteria` (JSONB, NOT NULL, DEFAULT `{}`) - Spec-driven base-table selection: `{ field_key: value | {"in":[...]} }` of the item spec values that route a configured item to this table for its manufacturer (doors: `edge_construction` + `core_construction`; frames: `frame_type` + `frame_fabrication`). The engine (`resolveBaseTable`) matches a configured item's fields against this scoped to category+vendor, so the same specs resolve to whatever each manufacturer calls the series; `series_value` becomes a derived display label. Empty `{}` falls back to `series_value` matching.
- `field_value_option_id` (UUID, NULLABLE, FK → field_value_options.id ON DELETE SET NULL) - Soft-link for traceability
- `name` (TEXT, NOT NULL) - Display name (defaults to the series value)
- `description` (TEXT, NULLABLE) - Optional description
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Constraints:**
- ~~UNIQUE `(category, series_value)`~~ — removed to allow multiple pricing tables per series (one per manufacturer)

**Indexes:**
- `idx_pricing_tables_category` on category
- `idx_pricing_tables_series_value` on series_value
- `idx_pricing_tables_field_value_option_id` on field_value_option_id

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read pricing tables` - All authenticated users can SELECT
- `Admins can insert pricing tables` - Only admins can INSERT
- `Admins can update pricing tables` - Only admins can UPDATE
- `Admins can delete pricing tables` - Only admins can DELETE

**Triggers:**
- `set_pricing_tables_updated_at` - Automatically updates updated_at timestamp via handle_updated_at()

---

### public.pricing_table_vendors

Junction table: many-to-many between `pricing_tables` and `companies` (manufacturers).

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `pricing_table_id` (UUID, NOT NULL, FK → pricing_tables.id ON DELETE CASCADE)
- `company_id` (UUID, NOT NULL, FK → companies.id ON DELETE CASCADE)
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Constraints:**
- UNIQUE `(pricing_table_id, company_id)`

**Indexes:**
- `idx_pricing_table_vendors_pricing_table_id` on pricing_table_id
- `idx_pricing_table_vendors_company_id` on company_id

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read pricing table vendors` - All authenticated users can SELECT
- `Admins can insert pricing table vendors` - Only admins can INSERT
- `Admins can delete pricing table vendors` - Only admins can DELETE

**Notes:** Vendor-eligibility (only manufacturers) is enforced at the UI/API layer by filtering `companies.company_type IN ('manufacturer','both')`.

---

### public.pricing_table_items

Junction table: many-to-many between `pricing_tables` and items (identified by `canonical_code`). Allows a single pricing table to be shared across multiple items of the same item type (e.g., one lites/louvers/glass price grid for several similar items).

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `pricing_table_id` (UUID, NOT NULL, FK → pricing_tables.id ON DELETE CASCADE)
- `canonical_code` (TEXT, NOT NULL) - The item's canonical code (matches `estimate_items.canonical_code`)
- `item_type` (TEXT, NOT NULL) - The item type slug (e.g. `lites_louvers_glass`), mirrors `estimate_items.item_type`
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - Display order in the tagged items list
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Constraints:**
- UNIQUE `(pricing_table_id, canonical_code)` — one item can only be tagged once per table

**Indexes:**
- `idx_pricing_table_items_table_id` on pricing_table_id
- `idx_pricing_table_items_canonical_code` on canonical_code

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read pricing table items` - All authenticated users can SELECT
- `Admins can insert pricing table items` - Only admins can INSERT
- `Admins can delete pricing table items` - Only admins can DELETE

**Migration:** `add_pricing_table_items` (applied 2026-05-14)

---

### public.pricing_columns

Column definitions for a pricing table (e.g. "18 Gauge / CRS"). Supports hierarchical columns via `parent_column_id` for frame pricing (gauge → depth sub-columns).

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `pricing_table_id` (UUID, NOT NULL, FK → pricing_tables.id ON DELETE CASCADE)
- `label` (TEXT, NOT NULL) - e.g. `'18 Gauge / CRS'`
- `criteria` (JSONB, NOT NULL, DEFAULT `{}`) - Column criteria shape: `Record<string, string | { type: 'in'; values: string[] }>`
- `parent_column_id` (UUID, NULLABLE, FK → pricing_columns.id ON DELETE CASCADE) - If set, this column is a sub-column (depth) under the given parent (gauge group)
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - Display order
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Indexes:**
- `idx_pricing_columns_table_sort` on (pricing_table_id, sort_order)
- `idx_pricing_columns_parent` on (parent_column_id)

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read pricing columns` - All authenticated users can SELECT
- `Admins can insert pricing columns` - Only admins can INSERT
- `Admins can update pricing columns` - Only admins can UPDATE
- `Admins can delete pricing columns` - Only admins can DELETE

**Triggers:**
- `set_pricing_columns_updated_at` - Automatically updates updated_at timestamp via handle_updated_at()

---

### public.pricing_rows

Row definitions for a pricing table (e.g. "2-0, 2-4 × 6'8"").

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `pricing_table_id` (UUID, NOT NULL, FK → pricing_tables.id ON DELETE CASCADE)
- `label` (TEXT, NOT NULL) - e.g. `'2-0, 2-4 × 6\'8"'`
- `width_criteria` (JSONB, NOT NULL, DEFAULT `{}`) - DimensionCriteria shape for width matching
- `height_criteria` (JSONB, NOT NULL, DEFAULT `{}`) - DimensionCriteria shape for height matching
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - Display order
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Criteria shape (DimensionCriteria):**
```ts
type DimensionCriteria =
  | { type: 'in'; values: number[] }
  | { type: 'between'; min: number; max: number }
  | { type: 'gte'; value: number }
  | { type: 'lte'; value: number };
```

**Indexes:**
- `idx_pricing_rows_table_sort` on (pricing_table_id, sort_order)

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read pricing rows` - All authenticated users can SELECT
- `Admins can insert pricing rows` - Only admins can INSERT
- `Admins can update pricing rows` - Only admins can UPDATE
- `Admins can delete pricing rows` - Only admins can DELETE

**Triggers:**
- `set_pricing_rows_updated_at` - Automatically updates updated_at timestamp via handle_updated_at()

---

### public.pricing_cells

Individual price values at the intersection of a row and column.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `pricing_row_id` (UUID, NOT NULL, FK → pricing_rows.id ON DELETE CASCADE)
- `pricing_column_id` (UUID, NOT NULL, FK → pricing_columns.id ON DELETE CASCADE)
- `price` (NUMERIC(12,2), NULLABLE) - NULL = blank cell
- `currency` (TEXT, NOT NULL, DEFAULT 'USD') - ISO currency code
- `notes` (TEXT, NULLABLE) - Optional cell notes
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Constraints:**
- UNIQUE `(pricing_row_id, pricing_column_id)`

**Indexes:**
- `idx_pricing_cells_row_id` on pricing_row_id
- `idx_pricing_cells_column_id` on pricing_column_id

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read pricing cells` - All authenticated users can SELECT
- `Admins can insert pricing cells` - Only admins can INSERT
- `Admins can update pricing cells` - Only admins can UPDATE
- `Admins can delete pricing cells` - Only admins can DELETE

**Triggers:**
- `set_pricing_cells_updated_at` - Automatically updates updated_at timestamp via handle_updated_at()

**Migration:** `create_pricing_tables` (applied 2026-04-29)

---

---

### public.item_type_field_overrides

Per-item-type overrides for a field definition. Uses a copy-on-write model — a door item starts with no override rows and inherits the global doors-wizard config; the first edit writes a row here, leaving the global config untouched.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `canonical_code` (TEXT, NOT NULL) - The item type (e.g., 'CH-door')
- `field_definition_id` (UUID, NOT NULL, FK → field_definitions.id ON DELETE CASCADE)
- `field_label_override` (TEXT, NULL) - Custom label for this item type only
- `is_required` (BOOLEAN, NOT NULL, DEFAULT false) - Whether field is required for this item
- `is_adder` (BOOLEAN, NOT NULL, DEFAULT false) - When true, field appears in the Adders tab of the Pricing editor
- `is_hidden` (BOOLEAN, NOT NULL, DEFAULT false) - Hides the field in the expanded item panel
- `sort_order` (INTEGER, NULL) - Per-item display order; NULL = inherit global sort_order
- `is_added_locally` (BOOLEAN, NOT NULL, DEFAULT false) - True if the field was added to this item only (not present in global defaults)
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Constraints:**
- UNIQUE `(canonical_code, field_definition_id)`

**Indexes:**
- `idx_item_type_field_overrides_canonical_code` on canonical_code
- `idx_item_type_field_overrides_field_definition_id` on field_definition_id
- `idx_item_type_field_overrides_is_adder` on canonical_code WHERE is_adder = true

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read item type field overrides` - All authenticated users can SELECT
- `Authenticated users can insert item type field overrides` - All authenticated users can INSERT
- `Authenticated users can update item type field overrides` - All authenticated users can UPDATE
- `Authenticated users can delete item type field overrides` - All authenticated users can DELETE

**Triggers:**
- `set_item_type_field_overrides_updated_at` - Automatically updates updated_at timestamp via handle_updated_at()

---

### public.item_type_field_value_options

Per-item-type option list. When **any** row exists for `(canonical_code, field_definition_id)`, that full set replaces the global `field_value_options` for this item (copy-on-write snapshot).

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `canonical_code` (TEXT, NOT NULL) - The item type
- `field_definition_id` (UUID, NOT NULL, FK → field_definitions.id ON DELETE CASCADE)
- `value` (TEXT, NOT NULL) - Option value string
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - Display order
- `is_default` (BOOLEAN, NOT NULL, DEFAULT false) - Whether this option is the default for estimates wizard
- `code_token` (TEXT, NULL) - Abbreviation contributed to a hardware canonical_code when this option is selected. NULL for options that produce no token.
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Constraints:**
- UNIQUE `(canonical_code, field_definition_id, value)`

**Indexes:**
- `idx_item_type_field_value_options_canonical_field` on (canonical_code, field_definition_id)

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read item type field value options` - All authenticated users can SELECT
- `Authenticated users can insert item type field value options` - All authenticated users can INSERT
- `Authenticated users can update item type field value options` - All authenticated users can UPDATE
- `Authenticated users can delete item type field value options` - All authenticated users can DELETE

---

### public.item_type_manufacturer_field_labels

Per-item-type alias overrides. Same shape as `manufacturer_field_labels` plus `canonical_code` and `is_removed` flag (allows an item to hide an inherited global alias).

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `canonical_code` (TEXT, NOT NULL) - The item type
- `field_definition_id` (UUID, NOT NULL, FK → field_definitions.id ON DELETE CASCADE)
- `manufacturer_id` (UUID, NULL, FK → companies.id ON DELETE CASCADE) - NULL = generic alias
- `manufacturer_field_label` (TEXT, NOT NULL) - Alias label text
- `status` (TEXT, NOT NULL, DEFAULT 'pending') - CHECK IN ('pending', 'approved')
- `is_removed` (BOOLEAN, NOT NULL, DEFAULT false) - True when this item has removed an inherited global alias
- `notes` (TEXT, NULL) - Optional notes
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Constraints:**
- UNIQUE `(canonical_code, field_definition_id, manufacturer_id, manufacturer_field_label)`

**Indexes:**
- `idx_item_type_mfl_canonical_field` on (canonical_code, field_definition_id)
- `idx_item_type_mfl_manufacturer_id` on manufacturer_id

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read item type manufacturer field labels` - All authenticated users can SELECT
- `Authenticated users can insert item type manufacturer field labels` - All authenticated users can INSERT
- `Authenticated users can update item type manufacturer field labels` - All authenticated users can UPDATE
- `Authenticated users can delete item type manufacturer field labels` - All authenticated users can DELETE

**Triggers:**
- `set_item_type_manufacturer_field_labels_updated_at` - Automatically updates updated_at timestamp via handle_updated_at()

---

### public.pricing_adder_cells

One price cell per `(pricing_table) × (item type) × (adder field) × (option value) × (vendor)`. Populated from the Adders tab in the Pricing editor for fields that have `is_adder = true` in `item_type_field_overrides`, AND from price-book ingestion: approving an adder/option extraction (`approveAdderExtraction` in `price-books-api.ts`) writes one row per option, attached to the series' BASE table (`pricing_table_id` = the kind='base' door/frame table). At pricing time `resolveAdders(baseTableId, canonicalCode, vendorId, fields)` adds a row's price when the item's `field_definition` value equals that row's `option_value`. Each option value for the field gets its own row so adder prices can vary by option.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `pricing_table_id` (UUID, NOT NULL, FK → pricing_tables.id ON DELETE CASCADE)
- `canonical_code` (TEXT, NOT NULL) - The item type that has this field as an adder
- `field_definition_id` (UUID, NOT NULL, FK → field_definitions.id ON DELETE CASCADE) - The adder field
- `option_value` (TEXT, NOT NULL, DEFAULT '') - The specific option value being priced (e.g. "18 Gauge")
- `company_id` (UUID, NOT NULL, FK → companies.id ON DELETE CASCADE) - The vendor/manufacturer
- `price` (NUMERIC(12,2), NULL) - NULL = blank/not set
- `currency` (TEXT, NOT NULL, DEFAULT 'USD') - ISO currency code
- `notes` (TEXT, NULL) - Optional cell notes
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Constraints:**
- UNIQUE `(pricing_table_id, canonical_code, field_definition_id, option_value, company_id)`

**Indexes:**
- `idx_pricing_adder_cells_table_id` on pricing_table_id
- `idx_pricing_adder_cells_canonical_code` on canonical_code
- `idx_pricing_adder_cells_field_definition_id` on field_definition_id
- `idx_pricing_adder_cells_company_id` on company_id

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read pricing adder cells` - All authenticated users can SELECT
- `Authenticated users can insert pricing adder cells` - All authenticated users can INSERT
- `Authenticated users can update pricing adder cells` - All authenticated users can UPDATE
- `Authenticated users can delete pricing adder cells` - All authenticated users can DELETE

**Triggers:**
- `set_pricing_adder_cells_updated_at` - Automatically updates updated_at timestamp via handle_updated_at()

**Migrations:**
- `add_item_type_field_overrides_and_adders` (applied 2026-05-01) - Initial table creation
- `add_option_value_to_pricing_adder_cells` (applied 2026-05-01) - Added `option_value` column and updated unique constraint to include it, enabling per-option pricing

---

### public.item_type_registry

Stores user-defined and system item types. Replaces hardcoded category enum for dynamic category support.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `name` (TEXT, NOT NULL) - Display name (e.g., "Doors")
- `slug` (TEXT, UNIQUE NOT NULL) - URL/code identifier (e.g., "doors")
- `icon` (TEXT, NULLABLE) - Lucide icon name
- `description` (TEXT, NULLABLE) - Human-readable description
- `sort_order` (INTEGER, DEFAULT 0) - Display order
- `is_system` (BOOLEAN, DEFAULT false) - True for the 3 built-in types (doors, frames, hardware)
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW())

**Indexes:**
- `idx_item_type_registry_slug` on slug
- `idx_item_type_registry_sort_order` on sort_order

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read item type registry` - All authenticated users can SELECT
- `Admins can insert item type registry` - Only admins can INSERT
- `Admins can update item type registry` - Only admins can UPDATE
- `Admins can delete item type registry` - Only admins can DELETE (non-system types only)

**Triggers:**
- `set_item_type_registry_updated_at` - Automatically updates updated_at timestamp via handle_updated_at()

**Seed data:** 3 system types seeded on creation — Doors (slug: doors), Frames (slug: frames), Hardware (slug: hardware)

**Migration:** `create_item_type_registry` (applied 2026-05-06)

---

### public.item_type_base_fields

Junction table defining which `field_definitions` are "base fields" for each item type. Replaces the hardcoded BIG_FIVE constant.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `item_type_slug` (TEXT, NOT NULL, FK → item_type_registry(slug) ON DELETE CASCADE) - The item type
- `field_definition_id` (UUID, NOT NULL, FK → field_definitions(id) ON DELETE CASCADE) - The field
- `sort_order` (INTEGER, DEFAULT 0) - Display order within the base fields section
- `pass_value_to_frame` (BOOLEAN, NOT NULL, DEFAULT false) - When true (doors slug only), the field's value is automatically copied to matching frame fields in the estimate wizard
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())

**Constraints:**
- UNIQUE `(item_type_slug, field_definition_id)`

**Indexes:**
- `idx_item_type_base_fields_slug` on item_type_slug
- `idx_item_type_base_fields_field_definition_id` on field_definition_id
- `idx_item_type_base_fields_pass_to_frame` on item_type_slug WHERE pass_value_to_frame = true

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read item type base fields` - All authenticated users can SELECT
- `Admins can insert item type base fields` - Only admins can INSERT
- `Admins can update item type base fields` - Only admins can UPDATE (sort_order reordering)
- `Admins can delete item type base fields` - Only admins can DELETE

**Seed data:**
- Doors Big Five base fields seeded at sort_order 0–3: `series`, `gauge`, `opening_width`, `opening_height`
- Doors "other" fields seeded at sort_order 100–118 from legacy `item_type_fields` data (migration `seed_doors_other_fields_into_base_fields`): `closer`, `design`, `door_description_code`, `exit_device_height_code`, `exit_device_prep_type`, `glass_or_louver`, `handing`, `hinge_measurements`, `hinge_option`, `hinge_quantity`, `hinge_spacing_code`, `lock_description`, `lock_measurement_btm_to_cl`, `material`, `net_height`, `net_width`, `quantity`, `type_of_hinging`, `undercut_code`

**Migration:** `create_item_type_base_fields` (applied 2026-05-06)

---

### public.item_type_field_dependencies

Item-type-level defaults wiring a parent field to a conditional child field. When the parent field's value satisfies the operator/trigger_values predicate, the child field is shown.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `item_type_slug` (TEXT, NOT NULL, FK → item_type_registry(slug) ON DELETE CASCADE)
- `parent_field_definition_id` (UUID, NOT NULL, FK → field_definitions(id) ON DELETE CASCADE)
- `child_field_definition_id` (UUID, NOT NULL, FK → field_definitions(id) ON DELETE CASCADE)
- `operator` (TEXT, NOT NULL) - CHECK IN ('equals','not_equals','in','not_in','gt','lt','gte','lte','between')
- `trigger_values` (JSONB, NOT NULL) - Strings for equality ops; numbers for comparison ops; `[min,max]` for `between`
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - Display order among siblings
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Constraints:**
- `UNIQUE(item_type_slug, parent_field_definition_id, child_field_definition_id)`
- `CHECK(parent_field_definition_id <> child_field_definition_id)`

**Indexes:**
- `idx_itfd_item_type_parent` on (item_type_slug, parent_field_definition_id)
- `idx_itfd_child` on child_field_definition_id

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read item type field dependencies` - All authenticated users can SELECT
- `Admins can insert item type field dependencies` - Only admins can INSERT (via `is_admin()`)
- `Admins can update item type field dependencies` - Only admins can UPDATE (via `is_admin()`)
- `Admins can delete item type field dependencies` - Only admins can DELETE (via `is_admin()`)

**Triggers:**
- `set_item_type_field_dependencies_updated_at` - Automatically updates updated_at timestamp via handle_updated_at()

**Migration:** `add_item_type_field_dependencies` (applied 2026-05-11)

---

### public.item_type_field_dependency_overrides

Per-canonical-code (per-item) copy-on-write overrides for `item_type_field_dependencies`. NULL columns inherit the item-type default. `is_hidden=true` suppresses an inherited dependency; `is_added_locally=true` marks a dependency added only for this item.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `canonical_code` (TEXT, NOT NULL) - The specific item this override applies to
- `parent_field_definition_id` (UUID, NOT NULL, FK → field_definitions(id) ON DELETE CASCADE)
- `child_field_definition_id` (UUID, NOT NULL, FK → field_definitions(id) ON DELETE CASCADE)
- `operator` (TEXT, NULLABLE) - NULL = inherit from item-type default; CHECK IN ('equals',…) when set
- `trigger_values` (JSONB, NULLABLE) - NULL = inherit
- `sort_order` (INTEGER, NULLABLE) - NULL = inherit
- `is_hidden` (BOOLEAN, NOT NULL, DEFAULT false) - true = suppress this inherited dependency
- `is_added_locally` (BOOLEAN, NOT NULL, DEFAULT false) - true = this dependency is not in the item-type defaults
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Constraints:**
- `UNIQUE(canonical_code, parent_field_definition_id, child_field_definition_id)`

**Indexes:**
- `idx_itfdo_canonical_parent` on (canonical_code, parent_field_definition_id)
- `idx_itfdo_child` on child_field_definition_id

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read item type field dependency overrides` - All authenticated users can SELECT
- `Authenticated users can insert item type field dependency overrides` - All authenticated users can INSERT
- `Authenticated users can update item type field dependency overrides` - All authenticated users can UPDATE
- `Authenticated users can delete item type field dependency overrides` - All authenticated users can DELETE

**Triggers:**
- `set_item_type_field_dependency_overrides_updated_at` - Automatically updates updated_at timestamp via handle_updated_at()

**Migration:** `add_item_type_field_dependencies` (applied 2026-05-11)

---

## Migrations Applied

1. `create_users_table_with_rls` - Initial users table creation with RLS policies
2. `fix_handle_updated_at_search_path` - Security fix for handle_updated_at function
3. `create_user_profile_trigger` - Automatic user profile creation trigger
4. `fix_user_profile_trigger_schema` - Fixed trigger to use schema-qualified type names
5. `fix_rls_infinite_recursion` - Fixed infinite recursion in admin RLS policies using security definer function
6. `create_field_definitions_table` - Field definitions "learning" table with RLS policies
7. `create_customers_table` - Customers table with RLS policies
8. `create_estimates_table` - Estimates table with file upload tracking and RLS policies
9. `create_estimate_items_table` - Estimate line items table with RLS policies
10. `create_item_fields_table` - Individual field values for items with RLS policies
11. `create_estimate_files_bucket_only` - Storage bucket for estimate files (PDFs and images)
12. `add_field_definitions_delete_policy` - Added DELETE RLS policy for admins on field_definitions table
13. `add_estimates_delete_policy` - Added DELETE RLS policy for estimates table (users can delete their own, admins can delete any)
14. `update_storage_delete_policy_for_admins` - Updated storage DELETE policy to allow admins to delete any estimate file
15. `add_pricing_columns` - Added total_price to estimates and unit_price to estimate_items for pricing feature
16. `replace_customers_with_companies_and_contacts` - Dropped customers table, created companies + contacts tables, renamed estimates.customer_id to company_id with updated FK
17. `create_quotes_and_quote_items_tables` - Created quotes and quote_items tables with RLS policies mirroring the estimates pattern
18. `create_templates_and_template_fields_tables` - Created templates and template_fields tables with RLS; seeded 3 starter templates
19. `add_company_type_and_manufacturer_id` - Added `company_type` column (TEXT CHECK 'customer'|'manufacturer'|'both') to companies; added `manufacturer_id` FK column to estimate_items referencing companies
20. `create_field_value_options_table` - Created field_value_options table for tracking historical field values per field_definition with usage counts and RLS policies
21. `create_upsert_field_value_option_rpc` - Created `upsert_field_value_option(p_field_definition_id, p_value)` RPC function used by the API layer to atomically increment usage counts
22. `create_item_type_fields_table` - Created `item_type_fields` junction table linking canonical_code (item types) to field_definitions with is_required flag; indexes, updated_at trigger, and full authenticated RLS policies
23. `create_estimate_openings_table` - Created `estimate_openings` table for grouping estimate items into named openings with a quantity multiplier; indexes, updated_at trigger, and RLS policies scoped via estimate ownership
24. `add_opening_id_to_estimate_items` - Added `opening_id` FK column (nullable, SET NULL on delete) to `estimate_items` referencing `estimate_openings`; index on opening_id
25. `add_parent_item_id_to_estimate_items` - Added `parent_item_id` FK column (nullable, CASCADE on delete) to `estimate_items` self-referencing for hardware child items under a door or frame; index on parent_item_id
26. `create_manufacturer_field_labels_table` - Created `manufacturer_field_labels` table mapping manufacturer-specific field terminology (e.g., "Width" for CECO) to master `field_definitions`; FK to `field_definitions` (CASCADE) and nullable FK to `companies`; unique on `(field_definition_id, manufacturer_id, manufacturer_field_label)`; indexes, updated_at trigger, and full authenticated RLS policies
27. `add_subcategory_to_estimate_items` - Added `subcategory` TEXT column (nullable, CHECK IN swing_it/close_it/latch_it/protect_it) to `estimate_items` for hardware display grouping; backfilled existing hardware rows via join to `hardware_catalog` by `canonical_code`
28. `add_template_type_to_estimate_openings` - Created `opening_template_type` enum (single, pair, single_with_panel, pair_with_panel) and added nullable `template_type` column to `estimate_openings`; NULL indicates a custom (manual) opening
29. `create_pricing_tables` - Created `pricing_tables`, `pricing_table_vendors`, `pricing_columns`, `pricing_rows`, and `pricing_cells` tables for the door pricing management feature; full RLS (read = authenticated, write = admins via `is_admin()`), `updated_at` triggers via `handle_updated_at()`, and indexes on all FK and sort-order columns
30. `add_item_type_field_overrides_and_adders` - Created `item_type_field_overrides`, `item_type_field_value_options`, `item_type_manufacturer_field_labels`, and `pricing_adder_cells` tables for per-item field customization and pricing adders; full authenticated CRUD RLS, `updated_at` triggers, and indexes on all FK and filter columns
31. `add_option_value_to_pricing_adder_cells` - Added `option_value TEXT NOT NULL DEFAULT ''` to `pricing_adder_cells` and updated the unique constraint from `(pricing_table_id, canonical_code, field_definition_id, company_id)` to `(pricing_table_id, canonical_code, field_definition_id, option_value, company_id)` to support per-option adder pricing
32. `create_item_type_registry` - Created `item_type_registry` table for dynamic item type management; seeded 3 system types (doors, frames, hardware); full RLS (read = authenticated, write = admins), updated_at trigger, indexes on slug and sort_order
33. `create_item_type_base_fields` - Created `item_type_base_fields` junction table linking `item_type_registry` slugs to `field_definitions`; seeded doors base fields from BIG_FIVE keys; full RLS (read = authenticated, write/delete = admins), indexes on slug and field_definition_id
34. `seed_doors_other_fields_into_base_fields` - Seeded 19 non-Big-Five door fields (closer, design, door_description_code, exit_device_height_code, exit_device_prep_type, glass_or_louver, handing, hinge_measurements, hinge_option, hinge_quantity, hinge_spacing_code, lock_description, lock_measurement_btm_to_cl, material, net_height, net_width, quantity, type_of_hinging, undercut_code) into `item_type_base_fields` at sort_order 100–118 so all door items inherit them automatically
34. `relax_estimate_items_item_type_check` - Dropped `estimate_items_item_type_check` CHECK constraint from `estimate_items.item_type`; app logic now validates against `item_type_registry` slug values
35. `add_update_policy_item_type_base_fields` - Added UPDATE RLS policy for admins on `item_type_base_fields` so `reorderItemTypeBaseFields` (sort_order updates) can persist; previously the table had SELECT/INSERT/DELETE policies but no UPDATE policy, causing silent no-ops on drag-to-reorder
36. `add_item_type_field_dependencies` - Created `item_type_field_dependencies` (item-type-level defaults) and `item_type_field_dependency_overrides` (per-canonical-code copy-on-write) tables for conditional sub-field support; RLS mirroring `item_type_base_fields` (read = authenticated, write = admins) for the defaults table and full authenticated CRUD for overrides; `updated_at` triggers via `handle_updated_at()`; composite unique constraints and indexes on (item_type_slug/canonical_code, parent_id) and child_id
37. `add_pass_value_to_frame_to_item_type_base_fields` - Added `pass_value_to_frame BOOLEAN NOT NULL DEFAULT false` column to `item_type_base_fields`; added partial index `idx_item_type_base_fields_pass_to_frame` on `item_type_slug` where `pass_value_to_frame = true` for efficient lookup of door→frame sync fields in the estimate wizard
38. `add_hardware_progressive_disclosure_columns` - Added `is_family`, `is_legacy`, `code_prefix`, `code_field_keys`, `label_template` to `hardware_catalog`; added `code_token TEXT NULL` to `field_value_options` and `item_type_field_value_options`; backfilled `is_legacy = true` on all 66 existing leaf rows
39. `seed_swing_it_hardware_families` - Seeded `hardware-hinge` and `hardware-cont-hinge` entries in `item_type_registry`; inserted HINGE and CONT-HINGE family rows in `hardware_catalog` (`is_family=true`); upserted 8 field_definitions (hinge_type, hinge_material, hinge_size, hinge_pin, hinge_gauge, material, mount, length) with `status='approved'`; seeded all field_value_options with `code_token` values; wired `item_type_base_fields` for both family slugs; added `hinge_gauge` depends-on-`hinge_type IN (Mechanical, Electrified)` rule to `item_type_field_dependencies`
40. `seed_close_latch_protect_hardware_families` - Seeded 6 new configurable hardware families for the remaining three subcategories: CloseIt — `CLOSER` (hardware-closer, fields: closer_mount/closer_material/closer_arm_type); LatchIt — `DEADBOLT` (hardware-deadbolt, deadbolt_function), `LOCKSET` (hardware-lockset, lockset_type), `PANIC` (hardware-panic, panic_type); ProtectIt — `WEATHERSTRIP` (hardware-weatherstrip, weatherstrip_type), `THRESHOLD` (hardware-threshold, threshold_type). Inserted all 6 `item_type_registry` slugs, 6 `hardware_catalog` family rows, 8 new `field_definitions` (all approved), field_value_options with code_token values (HM/DM, CI/ALUM, CUSH/HOS/HOSP/FL/PA, KOS/KBS, CYLI/MORT, RIM/MORT/SVR/CVR, ADHES/KERF/SCREW/ALUM, FLAT/PANIC/NOTCH), and `item_type_base_fields` wiring for all 6 family slugs
41. `add_lites_louvers_glass_to_pricing_category` - Updated `pricing_tables_category_check` CHECK constraint on `pricing_tables.category` to include `'lites_louvers_glass'` alongside existing `'doors'`, `'frames'`, `'hardware'` values; enables Lites, Louvers & Glass pricing tables with the new simple height × width grid editor
42. `add_pricing_table_items` - Created `pricing_table_items` junction table for many-to-many linking between `pricing_tables` and items (by `canonical_code`); allows a single pricing table to be shared across multiple items of the same item type; full RLS (read = authenticated, write = admins via `is_admin()`); indexes on `pricing_table_id` and `canonical_code`; UNIQUE constraint on `(pricing_table_id, canonical_code)`
43. `add_parent_column_id_to_pricing_columns` - Added `parent_column_id UUID NULLABLE FK → pricing_columns.id ON DELETE CASCADE` to `pricing_columns` to support hierarchical two-level column headers for frame pricing (gauge group → depth sub-columns); added `idx_pricing_columns_parent` index on `parent_column_id`
44. `extend_subcategory_check_constraints` - Updated CHECK constraints on `hardware_catalog.subcategory` and `estimate_items.subcategory` to include `'mount_it'` alongside existing values for the new Mount It hardware category
45. `seed_anchor_hardware_family` - Seeded ANCHOR family row in `hardware_catalog` (`subcategory='mount_it'`, `is_family=true`, `code_prefix='ANCHOR'`, `label_template='Anchor - {anchor_type}'`)
46. `add_door_role_field_definition` - Added `door_role` field definition (`value_type='string'`) to `field_definitions` for tagging active/inactive doors in pair openings at save time
47. `add_pricing_metadata_to_estimate_items` - Added `price_source TEXT CHECK ('lookup'|'manual'|'ocr')`, `price_lookup_metadata JSONB`, and `is_manual_price_override BOOLEAN DEFAULT false` columns to `estimate_items` for the pricing integration feature; index on `price_source`
48. `add_pricing_proposals_and_cell_history` - CPQ Phase 0. Created `pricing_change_proposals` (universal propose-only approval queue; read/insert authenticated, update/delete admins; updated_at trigger) and `pricing_cell_history` (append-only price audit with effective dating; read/insert authenticated, no update/delete). Added `priced_as_of TIMESTAMPTZ` to `quotes` to pin the catalog snapshot a quote was priced against.
49. `add_price_books_ingestion` - CPQ Phase 1. Created `price-book-files` storage bucket (+ RLS), `price_books` and `price_book_extractions` tables for vendor price-book ingestion (full authenticated RLS, updated_at triggers, indexes). Added `price_book_id` FK column to `pricing_change_proposals` linking ingestion proposals to their source book.
50. `add_pricing_exceptions` - CPQ Phase 2. Created `pricing_exceptions` table (failed-lookup queue with agent suggestions; full authenticated RLS, updated_at trigger, partial unique index for one open exception per item).
51. `add_compatibility_rules` - CPQ Phase 3. Created `compatibility_rules` (read authenticated, write admins) and `compatibility_rule_overrides` (full authenticated CRUD) tables for the configuration/compatibility rule engine; updated_at triggers; indexes on scope/active.
52. `add_price_book_extraction_table_fields` - Multi-table price-book ingestion. Added `title`, `kind`, and `sort_order` columns to `price_book_extractions` so each detected table in a book is its own extraction row (with index on `(price_book_id, sort_order)`).
53. `add_price_book_gemini_file_and_grid_extracted` - Decoupled ingestion (catalog + per-table grid). Added `gemini_file_uri` / `gemini_file_name` to `price_books` (Gemini Files API reference reused across per-table extraction) and `grid_extracted BOOLEAN DEFAULT false` to `price_book_extractions`.
54. `add_page_hint_to_price_book_extractions` - Exhaustive cataloging. Added `page_hint TEXT` to `price_book_extractions` so the catalog pass records where each table lives and the per-table grid extraction can target the correct page/table (fixes wrong/merged grids).
55. `add_spreadsheet_meta_to_price_book_extractions` - SheetJS XLSX/CSV support. Added `spreadsheet_meta JSONB` to `price_book_extractions` to store sheet index, header/data row offsets, price column indices, and label column index so XLSX/CSV tables can be extracted deterministically without Gemini reading any numbers.
56. `add_pricing_table_id_to_price_book_extractions` - Update-vs-create traceability. Added `pricing_table_id UUID FK → pricing_tables(id) ON DELETE SET NULL` so each approved extraction is linked to the pricing table it created/updated. Enables fingerprint-based re-upload dedup.
57. `add_versioning_to_pricing_tables` - Book-level versioning. Added `effective_from TIMESTAMPTZ DEFAULT NOW()` to `pricing_tables` (stamped on every update so price history is time-addressable). Added `supersedes_price_book_id UUID FK → price_books(id) ON DELETE SET NULL` and `effective_date DATE` to `price_books` so a re-upload can declare the date its prices take effect and which prior book it replaces.
55. `add_extract_all_progress_to_price_books` - Background "extract all grids" job. Added `extract_status` / `extract_total` / `extract_done` / `extract_failed` / `extract_error` to `price_books` so the Render worker's `/extract-all` background job can report progress and the frontend can poll instead of holding the browser open. (Catalog round cap also raised 8→10 in the worker.)
56. `add_kind_to_pricing_tables` - CPQ pricing remediation Phase 0. Added `kind TEXT NOT NULL DEFAULT 'base'` (CHECK base|component|adder|option) to `pricing_tables` + index `(category, series_value, kind)`. Backfilled existing rows from name heuristics. Door/frame base-price lookup now selects `kind='base'` (deterministic, no arbitrary pick); adder/option tables feed `pricing_adder_cells`.
57. `spec_driven_series_resolution` - Spec-driven, manufacturer-aware series resolution. Added `pricing_tables.selection_criteria JSONB DEFAULT '{}'`. Renamed the thermal-fill field `core` -> `core_fill` (field_definitions + item_fields; no code refs). Created discriminator field_definitions `edge_construction` (Lockseam/Continuous Weld) and `core_construction` (Glued/Steel Stiffened/Embossed Panel) with option sets, added as door base fields. Engine now resolves the base table by matching a configured item's spec fields against `selection_criteria` scoped to category+manufacturer (series_value fallback retained). The 5 approved Pioneer base tables (H/CH/C/LW + F) were backfilled with their selection_criteria; the builder's manufacturer picker now lists vendors by category (`listManufacturersForCategory`) so users configure specs + pick a manufacturer and the price resolves without choosing a series.

> CPQ v2 (Pioneer spec-pricing overhaul) migrations are catalogued in the **CPQ v2 — Spec-Driven Pricing Model** section below (Phase 0 list + per-phase notes), not in this legacy numbered list.

58. `cpq_v2_add_entity_type_to_estimate_line` - Phase 5. Added `estimate_line.entity_type TEXT` so the auditable quote groups persisted lines into Pioneer/hardware layers.
59. `cpq_v2_add_charge_category_to_estimate_line` - Phase 5. Added `estimate_line.charge_category TEXT` for layer grouping + hardware rollups; written by `persistEngineResult`.
60. `cpq_v2_deprecate_legacy_grid_tables` - Phase 6 cutover prep. Marked `pricing_tables`/`pricing_columns`/`pricing_rows`/`pricing_cells`/`pricing_adder_cells` deprecated/read-only via table comments. The destructive drop (`db/migrations/retire_legacy_grid.sql`) is gated on Pioneer ingestion + round-trip QA and is NOT yet applied.
61. `ngp_infill_entity_types_and_catalog` - NGP infill integration. Extended `price_rule.entity_type` and `price_table.entity_type` CHECKs to allow `lite_kit`, `louver`, `glass`, `glazing_tape`. Created the NGP catalog + compatibility tables (`ngp_product`, `ngp_product_attribute`, `ngp_kit_glass_capacity`, `ngp_glass_rating`, `ngp_size_rule`, `ngp_relationship`, `ngp_finish_code`, `ngp_option`, `ngp_commercial_policy`, `ngp_price_table_map`); each NGP source = one `price_book_document`, with dimensional matrices + option/direct/multiplier rules compiled into `price_table`/`price_rule`/`rule_condition`/`included_scope`.
62. `ngp_infill_rls_policies` - Enabled RLS on all `ngp_*` tables with the standard pattern: `auth_read` (SELECT USING true) + `admin_insert/update/delete` gated on `is_admin()`.
63. `ngp_price_table_map_scope_columns` - Added `included_scope`, `glass_model`, `tape_model`, `entity_type` to `ngp_price_table_map` so the infill resolver can pick assembly-vs-component pricing per model + glass.
64. `ngp_opening_cutout` - Created `opening_cutout` (NGP infill selections per opening) with authenticated RLS (`auth_all`). Persists the beginner-facing cutout choices (type/size/kit/glass/tape/finish/options) so a built opening round-trips on edit; the resolved priced lines live in `estimate_line`.

## Edge Functions

### ingest-price-book

CPQ Phase 1b — **STEP 1 (catalog)**. Decoupled from grid extraction so large books never exceed the Edge Function wall-clock limit. `verify_jwt: false`.

**Request:** POST `{ "priceBookId": "uuid" }`

**Flow:** sets `ocr_status='processing'`, clears any prior extractions/pending proposals (re-ingest support) → uploads the file ONCE to the Gemini Files API and stores `gemini_file_uri`/`gemini_file_name` on `price_books` (CSV uses inline text) → **multi-round** catalog enumeration: repeatedly asks Gemini for tables NOT already listed (TOC-guided, exclude-list driven) until it reports nothing new or stops truncating, salvaging tables from truncated JSON, so EVERY table/section in the book is captured (every door series + its header/glass/lite add tables, every frame series, hardware lists, and all option/adder/surcharge tables) → inserts ONE placeholder `price_book_extractions` row per table (`grid_extracted=false`, empty grid, with `page_hint`) + ONE pending `pricing_change_proposals` row per table → sets `ocr_status='done'` (with a soft `ocr_error` warning if enumeration may have been cut off). If ZERO tables are found it sets `ocr_status='error'` (no more silent single-table fallback). Never writes pricing_tables. XLSX rejected (export CSV/PDF). Capped at 200 tables / 8 catalog rounds. **Runs on the Render `price-book-worker` when `VITE_PRICE_BOOK_WORKER_URL` is set (no wall-clock limit); Edge Function is the fallback.**

**Response:** `{ success, priceBookId, tableCount, extractionsCreated }`

### extract-price-book-table

CPQ Phase 1b — **STEP 2 (grid)**. `verify_jwt: false`.

**Request:** POST `{ "extractionId": "uuid" }`

**Flow:** loads the extraction + its `price_books` row → reuses the stored `gemini_file_uri` (re-uploads from storage and updates the row if the reference expired; CSV re-reads text) → **one** Gemini call extracts the full grid for THAT table only, **targeted by the extraction's `page_hint`** so it pulls the right table/page and doesn't merge neighbors (`column_labels, row_labels, cells[], column_field_hints, warnings`; truncated responses attempt partial cell recovery) → updates the extraction's `grid` + `grid_extracted=true` and refreshes the linked proposal's counts. The review UI fires these per table or via "Extract all grids". **Runs on the Render `price-book-worker` when `VITE_PRICE_BOOK_WORKER_URL` is set; Edge Function is the fallback.**

**Worker `/extract-all` (background bulk extraction):** for large books, "Extract all grids" calls the Render worker's `POST /extract-all { priceBookId }`, which returns 202 immediately and then extracts EVERY pending (`status='pending' AND grid_extracted=false`) table with bounded concurrency (default 4). Progress is written to `price_books.extract_status`/`extract_total`/`extract_done`/`extract_failed` after each table; the frontend polls these (it does NOT need to stay open — the job runs server-side). Per-table failures are counted and left un-extracted (retry individually or re-run; re-running only picks up what's still pending). Without a worker the UI falls back to a client-driven bounded-concurrency loop.

**Response:** `{ success, extractionId, rowCount, colCount, cellCount, warnings }`

**Required Secrets:** `GEMINI_API_KEY`, plus auto-provided `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

### process-estimate

Serverless Edge Function that processes uploaded estimate files using Gemini 3 Flash with Agentic Vision (code execution).

**Configuration:**
- `slug`: process-estimate
- `verify_jwt`: false (JWT verification disabled - function uses service role key internally)
- `status`: ACTIVE
- `version`: 24 (updated 2026-06-04 — large-file support: files >7 MB are uploaded via the Gemini Files API and referenced by URI across all passes, enabling PDFs up to the 50 MB bucket cap; inline base64 retained for small files. Prior: three-pass extraction with manufacturer alias hints + AI opening grouping)

**Request:**
- Method: POST
- Body: `{ "estimateId": "uuid" }`
- Authorization: Handled by frontend Supabase client session

**Three-Pass Architecture:**

The function uses a three-pass strategy to extract all items with full field coverage and automatically group them into openings within the 150-second edge function timeout:

- **Pass 1** (one call, `maxOutputTokens: 8192`): Identifies all line items — label, code, quantity, unit price, manufacturer only. Fast (~10s).
- **Pass 2** (parallel calls, `maxOutputTokens: 12288` each): Splits items into batches of 10, runs all batches in parallel via `Promise.all`. Each batch extracts all spec fields for its 10 items. Includes **manufacturer alias hints** — aliases from `manufacturer_field_labels` are injected into the prompt so Gemini normalizes non-standard labels (e.g., "W" → `opening_width`) to the master field key. Runs concurrently (~70–90s for the slowest batch).
- **Pass 3** (text-only call, `maxOutputTokens: 4096`, ~5s): Groups the merged item list into physical openings. Gemini receives all items categorized as `[door]`, `[frame]`, or `[hardware]` along with their dimension fields, and returns an opening grouping (door labels + frame labels + hardware labels per opening). Pass 3 failure is non-fatal — if it fails, extraction continues without opening assignments.
- **Merge**: Pass 1 item metadata is merged with Pass 2 field arrays matched by item label (case-insensitive).
- Both PDF passes include **partial JSON recovery** — if a batch response is truncated, completed item objects are salvaged from the partial JSON.

**Flow:**
1. Reads the estimate record from `estimates` table
2. Updates `ocr_status` to `processing`
3. Downloads the file from `estimate-files` storage bucket
4. Queries `field_definitions` and `manufacturer_field_labels` (with company joins) in parallel
5. **Pass 1**: Gemini identifies all line items (labels, codes, quantities, prices, manufacturers)
6. **Pass 2**: Parallel Gemini calls extract all spec fields for each batch of 10 items, using manufacturer alias hints to normalize terminology
7. **Pass 3**: Text-only Gemini call groups doors/frames/hardware into physical openings
8. Merges pass results into full `ExtractedItem[]` list
9. **Batched DB inserts**:
   - Manufacturers resolved in parallel via cache
   - All new `field_definitions` batch-upserted in one call (on conflict: `field_key`)
   - All `estimate_items` batch-inserted in a single call
   - All `item_fields` batch-inserted in chunks of 200 rows
   - `estimate_openings` records created from Pass 3 groupings
   - `estimate_items.opening_id` and `parent_item_id` updated in batch via `.in()` queries
10. Updates estimate with `ocr_status = 'done'`, extracted customer info, `total_price`, and `extracted_at` timestamp
11. On error: sets `ocr_status = 'error'` and `ocr_error` message

**Timing (37-item document):** ~120–145s total — within the 150s limit.
- Pass 1: ~10s
- Pass 2 (4 parallel batches): ~90s
- Pass 3 (text-only, opening grouping): ~5s
- Batch DB inserts (items + fields + openings): ~10s

**Response:**
```json
{ "success": true, "estimateId": "uuid", "itemCount": 5, "newFieldsDiscovered": 3, "openingsCreated": 2 }
```

**Required Secrets:**
- `GEMINI_API_KEY` - Google Gemini API key (must be set via Supabase Dashboard or CLI)
- `SUPABASE_URL` - Auto-provided
- `SUPABASE_SERVICE_ROLE_KEY` - Auto-provided
- `SUPABASE_ANON_KEY` - Auto-provided

## Admin UI

### Field Definitions Management (`/app/admin/field-definitions`)

Admin page for managing AI-discovered field definitions used in estimate extraction.

**Features:**
- View all field definitions with summary cards (total, pending review, approved counts)
- Tab-based filtering: All / Pending Review / Approved
- Search by field key, label, or description
- Approve pending fields (individual or bulk "Approve All")
- Move approved fields back to pending review
- Edit field label, value type, and description
- Delete unwanted field definitions (with confirmation dialog)

**API Functions** (in `src/lib/estimates-api.ts`):
- `getFieldDefinitions(status?)` - List field definitions, optionally filtered by status
- `updateFieldDefinitionStatus(id, status)` - Approve or reject a field definition
- `updateFieldDefinition(id, updates)` - Update label, description, or value type
- `deleteFieldDefinition(id)` - Permanently remove a field definition
- `createOrApproveFieldDefinition({ fieldKey, fieldLabel, valueType? })` - Upsert a field definition by `field_key`; inserts with `status='approved'` on first use or updates existing row to approved. Called from the line-items wizard when the user saves a manually-created field.
- `getFieldDefinitionsForItemType(itemLabel?, canonicalCode?)` - Returns approved field definitions previously used on items matching the given label or code, ordered by `usage_count DESC`. Powers the "Suggested for [item type]" group in the Add Field combobox.
- `getFieldValueOptions(fieldDefinitionId)` - Returns historically-used values for a field definition, ordered by `usage_count DESC`. Used to populate value-history dropdowns in the line-items wizard.
- `recordFieldValueUsage(fieldDefinitionId, value)` - Upserts `field_value_options` (insert with `usage_count=1` or increment). Called whenever a field value is saved in the wizard.

## Estimate Management

**API Functions** (in `src/lib/estimates-api.ts`):
- `uploadEstimateFile(file, userId)` - Upload file to Supabase Storage and create estimate record
- `processEstimate(estimateId)` - Invoke Edge Function to extract data using Gemini
- `getEstimate(id)` - Fetch a single estimate by ID
- `getEstimateWithItems(id)` - Fetch estimate with items and fields
- `getEstimatesWithItems()` - List all estimates with their line items (`id`, `canonical_code`, `item_label`). Used by the estimates list page for search-by-item-code and the Items column.
- `listEstimates()` - List all estimates (most recent first)
- `updateEstimate(id, updates)` - Update estimate fields (customer, extracted data, etc.)
- `deleteEstimate(id)` - Delete estimate, its items/fields, and the file from storage
- `getEstimateFileUrl(filePath)` - Generate temporary signed URL for file preview

**Access:** Admin users only (enforced by sidebar visibility and Supabase RLS policies)

## Item Registry & Manual Item API

### Item Type Registry (`src/lib/item-fields-api.ts`)

API functions for managing the `item_type_registry` and `item_type_base_fields` tables:

- `getItemTypeRegistry()` — Returns all rows from `item_type_registry` ordered by `sort_order`, then `name`. Used by `CategoryDashboard` and `CreateItemDialog`.
- `createItemType({ name, slug, icon?, description? })` — Inserts a new non-system item type into `item_type_registry`. Returns the created `ItemTypeRegistryEntry`.
- `deleteItemType(slug)` — Deletes a non-system item type. Guards against `is_system = true` types; throws if the type is a system type or doesn't exist.
- `getItemTypeBaseFields(slug)` — Returns all `item_type_base_fields` rows for the given slug, joined with `field_definitions`, ordered by `sort_order`. Used by `CategoryFieldsWizard` and `CreateItemDialog`.
- `addItemTypeBaseField(slug, fieldDefinitionId)` — Appends a field definition as a base field for the given item type slug. Auto-assigns `sort_order = max + 1`. Returns the new `ItemTypeBaseField` row with joined `field_definitions`.
- `removeItemTypeBaseField(slug, fieldDefinitionId)` — Removes a base field association for the given slug and field_definition_id pair.

### Category Field Definitions & Manual Item Creation (`src/lib/estimates-api.ts`)

- `getCategoryFieldDefinitions(slug)` — Parameterized replacement for `getDoorFieldDefinitions`. Returns all `field_definitions` linked via `item_type_fields` to any `estimate_items` with `item_type = slug`, excluding base fields for that slug (loaded from `item_type_base_fields`). Falls back to legacy BIG_FIVE exclusion for `'doors'` if no base fields are seeded.
- `getDoorFieldDefinitions()` — Thin wrapper: calls `getCategoryFieldDefinitions('doors')`. Kept for backward compatibility.
- `createManualItem({ itemLabel, canonicalCode, itemTypeSlug, fieldValues })` — Inserts a new `estimate_items` row (`estimate_id = null`, `item_type = itemTypeSlug`) and one `item_fields` row per entry in `fieldValues`. Returns the created `EstimateItem`. Used by `CreateItemDialog` to add catalog items without tying them to an estimate.

### TypeScript Types (`src/types/index.ts`)

New types added for dynamic item type support:

- `ItemTypeRegistryEntry` — `{ id, name, slug, icon, description, sortOrder, isSystem, createdAt, updatedAt }`
- `ItemTypeBaseField` — `{ id, itemTypeSlug, fieldDefinitionId, sortOrder, passValueToFrame, createdAt, fieldDefinition? }`
- `ItemCategory` — broadened from `'doors' | 'frames' | 'hardware'` to `string` to allow any registered slug

### public.hardware_catalog

Pre-defined hardware catalog seeded from the DOOR_FRAME SHORTCUT_LOOKUP spreadsheet, organized into four subcategories used by the Items page and estimate wizard.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `name` (TEXT, NOT NULL) - Display name of the hardware item
- `canonical_code` (TEXT, NOT NULL, UNIQUE) - Unique item code (e.g., 'HINGE-MECH-SS-45X45-NRP-134') for leaf rows; family identifier (e.g., 'HINGE', 'CONT-HINGE') for family rows
- `subcategory` (TEXT, NOT NULL) - CHECK IN ('swing_it','close_it','latch_it','protect_it','mount_it')
- `description` (TEXT) - Optional description of the item
- `active` (BOOLEAN, NOT NULL, DEFAULT true) - Whether the item appears in pickers
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - Display ordering within subcategory
- `is_family` (BOOLEAN, NOT NULL, DEFAULT false) - True for new configurable family rows; false for legacy leaf rows
- `is_legacy` (BOOLEAN, NOT NULL, DEFAULT false) - True on all 66 original leaf rows (backfilled); false on family rows
- `code_prefix` (TEXT, NULL) - Required when is_family=true. Top-level prefix for the assembled canonical_code (e.g. 'HINGE', 'CONT-HINGE')
- `code_field_keys` (JSONB, NULL) - Ordered list of field_definitions.field_key values whose selected option tokens build the rest of the code (e.g. `["hinge_type","hinge_material","hinge_size","hinge_pin","hinge_gauge"]`)
- `label_template` (TEXT, NULL) - Optional human-readable template for the item label (e.g. `'Hinge - {hinge_type} {material}'`). Falls back to name
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Indexes:**
- `idx_hardware_catalog_subcategory` on subcategory
- `idx_hardware_catalog_active` on active
- `idx_hardware_catalog_sort_order` on (subcategory, active, sort_order)

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read hardware catalog` - All authenticated users can SELECT
- `Admins can insert hardware catalog items` - Only admins can INSERT
- `Admins can update hardware catalog items` - Only admins can UPDATE
- `Admins can delete hardware catalog items` - Only admins can DELETE

**Triggers:**
- `set_hardware_catalog_updated_at` - Automatically updates updated_at timestamp via handle_updated_at()

**Seed data (66 legacy rows + 2 family rows):**
- **swing_it legacy (25 rows):** Mechanical SS hinges (4.5×4.5 and 5×4.5 NRP .134"/.180"), Spring SS 4.5×4.5", Electrified SS variants, Continuous Aluminum and SS 630 Full Mortise/Half Mortise/Full Surface × 80"/84"/96"
- **close_it legacy (21 rows):** Header Mount and Door Mount closers × Cast Iron/Aluminum × Cushioned/Hold Open Stop/Hold Open Spring/Fusible Link/Parallel Arm; plus Slide Track Hold Open
- **latch_it legacy (11 rows):** Active — Deadbolt KOS/KBS, Lockset Cylindrical/Mortise, Panic Bar Rim/Mortise/SVR/CVR; Inactive (active=false) — Surface Bolt, Flush Bolt, Surface Vertical Rod
- **protect_it legacy (9 rows):** Weatherstrip Adhesive/Kerf/Screw-On/Aluminum, Threshold Flat/Panic/Notched, Drip Cap, Door Sweep
- **swing_it family rows (Phase 1):**
  - `HINGE` — `code_prefix='HINGE'`, `code_field_keys=["hinge_type","hinge_material","hinge_size","hinge_pin","hinge_gauge"]`, item_type_slug=`hardware-hinge`
  - `CONT-HINGE` — `code_prefix='CONT-HINGE'`, `code_field_keys=["material","mount","length"]`, item_type_slug=`hardware-cont-hinge`
- **close_it family rows (Phase 2):**
  - `CLOSER` — `code_prefix='CLOSER'`, `code_field_keys=["closer_mount","closer_material","closer_arm_type"]`, item_type_slug=`hardware-closer`; options: Header Mount (HM), Door Mount (DM) × Cast Iron (CI), Aluminum (ALUM) × Cushioned Arm (CUSH), Hold Open Stop Arm (HOS), Hold Open Spring Arm (HOSP), Fusible Link Arm (FL), Parallel Arm (PA)
- **latch_it family rows (Phase 2):**
  - `DEADBOLT` — `code_prefix='DEADBOLT'`, `code_field_keys=["deadbolt_function"]`, item_type_slug=`hardware-deadbolt`; options: Key On Side (KOS), Key Both Sides (KBS)
  - `LOCKSET` — `code_prefix='LOCKSET'`, `code_field_keys=["lockset_type"]`, item_type_slug=`hardware-lockset`; options: Cylindrical (CYLI), Mortise (MORT)
  - `PANIC` — `code_prefix='PANIC'`, `code_field_keys=["panic_type"]`, item_type_slug=`hardware-panic`; options: Rim (RIM), Mortise (MORT), SVR (SVR), CVR (CVR)
- **protect_it family rows (Phase 2):**
  - `WEATHERSTRIP` — `code_prefix='WSTRIP'`, `code_field_keys=["weatherstrip_type"]`, item_type_slug=`hardware-weatherstrip`; options: Adhesive (ADHES), Kerf (KERF), Screw-On (SCREW), Aluminum (ALUM)
  - `THRESHOLD` — `code_prefix='THRESH'`, `code_field_keys=["threshold_type"]`, item_type_slug=`hardware-threshold`; options: Flat (FLAT), Panic (PANIC), Notched (NOTCH)

**Migration:** `create_hardware_catalog_table` (applied 2026-04-07)
**Migration:** `add_hardware_progressive_disclosure_columns` (applied 2026-05-12) — added `is_family`, `is_legacy`, `code_prefix`, `code_field_keys`, `label_template`; backfilled `is_legacy=true` on all 66 existing rows
**Migration:** `seed_swing_it_hardware_families` (applied 2026-05-12) — seeded HINGE and CONT-HINGE family rows; field_definitions (hinge_type, hinge_material, hinge_size, hinge_pin, hinge_gauge, mount, length) with code_token options; item_type_registry slugs `hardware-hinge` / `hardware-cont-hinge`; item_type_base_fields wiring; gauge-depends-on-type dependency
**Migration:** `seed_close_latch_protect_hardware_families` (applied 2026-05-12) — seeded 6 new family rows for CloseIt/LatchIt/ProtectIt (CLOSER, DEADBOLT, LOCKSET, PANIC, WEATHERSTRIP, THRESHOLD); 8 new field_definitions; all field_value_options with code_tokens; item_type_registry slugs; item_type_base_fields wiring

---

## CPQ Tables (Phase 0 — propose-only approval queue + versioning)

### public.pricing_change_proposals

Universal propose-only queue. Price-book ingestion and the exception agent never write to `pricing_tables`/`pricing_cells` directly — proposed changes land here with `status='pending'` and are applied only after a human approves them.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `proposal_type` (TEXT, NOT NULL) - CHECK IN ('cell','column','row','adder','table','spec','price_rule','dependency_rule','option','product_family','hardware_product','hardware_price'). The latter six are CPQ v2 rule/catalog/hardware proposals (Phase 2.0 bridge).
- `target_table_id` (UUID, NULLABLE, FK → pricing_tables.id ON DELETE CASCADE)
- `price_book_document_id` (UUID, NULLABLE, FK → price_book_document.id ON DELETE CASCADE) - CPQ v2 (Phase 2.0): the draft/published document version this proposal compiles rules into. Index `pricing_change_proposals_price_book_document_id_idx`.
- `target_ids` (JSONB, NOT NULL, DEFAULT `{}`) - Identifiers needed to locate/create the target (rowId, columnId, canonicalCode, etc.)
- `payload` (JSONB, NOT NULL, DEFAULT `{}`) - Proposed value(s); shape depends on `proposal_type`
- `source` (TEXT, NOT NULL, DEFAULT 'manual') - CHECK IN ('ingestion','exception_agent','manual')
- `confidence` (NUMERIC, NULLABLE) - Agent confidence 0–1
- `explanation` (TEXT, NULLABLE) - Plain-English rationale
- `status` (TEXT, NOT NULL, DEFAULT 'pending') - CHECK IN ('pending','approved','rejected','applied')
- `created_by` (UUID, NULLABLE, FK → auth.users.id ON DELETE SET NULL)
- `reviewed_by` (UUID, NULLABLE, FK → auth.users.id ON DELETE SET NULL)
- `reviewed_at` (TIMESTAMPTZ, NULLABLE)
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Indexes:** on `status`, `source`, `target_table_id`, `created_at DESC`

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read pricing change proposals` - SELECT
- `Authenticated users can insert pricing change proposals` - INSERT (agent via service role, users for manual)
- `Admins can update pricing change proposals` - UPDATE via `is_admin()` (approve/reject)
- `Admins can delete pricing change proposals` - DELETE via `is_admin()`

**Triggers:** `set_pricing_change_proposals_updated_at` via handle_updated_at()

### public.pricing_cell_history

Append-only audit of every price written to a `pricing_cells` row, with effective dating for reproducibility. The current price has `effective_to IS NULL`. Written by the versioned cell writer in `pricing-api.ts`.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `pricing_cell_id` (UUID, NOT NULL, FK → pricing_cells.id ON DELETE CASCADE)
- `price` (NUMERIC(12,2), NULLABLE) - NULL = cell was cleared
- `currency` (TEXT, NOT NULL, DEFAULT 'USD')
- `effective_from` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- `effective_to` (TIMESTAMPTZ, NULLABLE) - NULL = currently effective
- `source` (TEXT, NOT NULL, DEFAULT 'manual') - CHECK IN ('ingestion','exception_agent','manual','import')
- `proposal_id` (UUID, NULLABLE, FK → pricing_change_proposals.id ON DELETE SET NULL)
- `changed_by` (UUID, NULLABLE, FK → auth.users.id ON DELETE SET NULL)
- `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Indexes:** on `pricing_cell_id`, partial on `pricing_cell_id WHERE effective_to IS NULL`, `proposal_id`

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read pricing cell history` - SELECT
- `Authenticated users can insert pricing cell history` - INSERT
- Append-only: no UPDATE/DELETE policies

---

## CPQ Tables (Phase 1 — vendor price-book ingestion)

### Storage bucket: price-book-files

Private bucket for uploaded vendor price books. `file_size_limit` 50MB; allowed mime types: PDF, JPEG/JPG/PNG/GIF, XLSX, XLS, CSV. RLS on storage.objects scoped to `bucket_id = 'price-book-files'`: authenticated upload/read, update own, delete own or admin.

### public.price_books

One row per uploaded vendor price book (manufacturer price list).

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `company_id` (UUID, NULLABLE, FK → companies.id ON DELETE SET NULL) - The manufacturer this book belongs to
- `name` (TEXT, NOT NULL)
- `category` (TEXT, NULLABLE) - CHECK IN ('doors','frames','hardware','lites_louvers_glass','panels')
- `source_file_url` (TEXT, NOT NULL, DEFAULT '') - Storage path in price-book-files
- `original_file_name` (TEXT, NOT NULL, DEFAULT '')
- `file_type` (TEXT, NOT NULL, DEFAULT 'pdf') - CHECK IN ('pdf','image','xlsx','csv')
- `ocr_status` (TEXT, NOT NULL, DEFAULT 'pending') - CHECK IN ('pending','processing','done','error')
- `ocr_error` (TEXT, NULLABLE)
- `uploaded_by_user_id` (UUID, NULLABLE, FK → auth.users.id ON DELETE SET NULL)
- `extracted_at` (TIMESTAMPTZ, NULLABLE)
- `gemini_file_uri` (TEXT, NULLABLE) - Gemini Files API URI for the uploaded book; set by the catalog step and reused by per-table grid extraction.
- `gemini_file_name` (TEXT, NULLABLE) - Gemini Files API resource name (e.g. `files/abc`).
- `extract_status` (TEXT, NULLABLE) - Background "extract all grids" job state: null (never run) | 'processing' | 'done' | 'error'. Set by the worker `/extract-all` job; the frontend polls it.
- `extract_total` (INTEGER, NOT NULL, DEFAULT 0) - Tables targeted by the most recent extract-all run.
- `extract_done` (INTEGER, NOT NULL, DEFAULT 0) - Tables successfully extracted so far in the current/last extract-all run.
- `extract_failed` (INTEGER, NOT NULL, DEFAULT 0) - Tables that errored in the current/last extract-all run (retryable individually or by re-running).
- `extract_error` (TEXT, NULLABLE) - Fatal error message if the extract-all job itself failed.
- `price_book_document_id` (UUID, NULLABLE, FK → price_book_document.id ON DELETE SET NULL) - CPQ v2 (Phase 2.0): the immutable published `price_book_document` version this staging book links to. A draft document is created when ingestion begins; publishing flips its `status` to `published`. Index `price_books_price_book_document_id_idx`.
- `created_at` / `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Indexes:** on `company_id`, `ocr_status`, `created_at DESC`, `price_book_document_id`

**RLS Policies:** ✅ enabled. Read/insert/update authenticated; delete own or admin. Trigger `set_price_books_updated_at`.

### public.price_book_extractions

Staging row holding the agent's normalized grid for ONE table within a price book, before a human maps + approves it. A single book produces MANY of these — one per detected table (each door series, frame series, header table, glass/lite table, hardware list, and option/adder table).

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `price_book_id` (UUID, NOT NULL, FK → price_books.id ON DELETE CASCADE)
- `status` (TEXT, NOT NULL, DEFAULT 'pending') - CHECK IN ('pending','mapped','compiled','approved','discarded'). CPQ v2 adds `compiled`: the rule compiler emitted `price_rule`/`dependency_rule` rows from this table's evidence and they await human approval.
- `title` (TEXT, NULLABLE) - The table heading as printed in the book
- `kind` (TEXT, NULLABLE) - 'size_grid' | 'flat_list' | 'adder'
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - Document order
- `page_hint` (TEXT, NULLABLE) - Page/location hint from the catalog pass (e.g. "p. 12"). Passed into per-table grid extraction to target the correct table on the correct page.
- `grid_extracted` (BOOLEAN, NOT NULL, DEFAULT false) - The catalog step inserts placeholder rows with false; flips true once the per-table grid extraction fills the grid.
- `detected_category` (TEXT, NULLABLE)
- `detected_series` (TEXT, NULLABLE)
- `detected_vendor_name` (TEXT, NULLABLE)
- `grid` (JSONB, NOT NULL, DEFAULT `{}`) - `{ columnLabels, rowLabels, cells[], columnFieldHints }`
- `warnings` (JSONB, NOT NULL, DEFAULT `[]`)
- `spreadsheet_meta` (JSONB, NULLABLE) - Set for XLSX/CSV tables. `{ sheetIndex, headerRow, dataStartRow, dataEndRow, priceColIndices[], labelColIndex }` allows deterministic SheetJS re-extraction without re-sending numbers to Gemini.
- `pricing_table_id` (UUID, NULLABLE, FK → pricing_tables.id ON DELETE SET NULL) - Legacy grid path: set when the extraction approved into a `pricing_tables` grid. NOT written by the CPQ v2 rule pipeline.
- `archetype` (TEXT, NULLABLE) - CPQ v2 (Phase 2.0): the table-archetype classifier's result (`base_matrix`, `component_matrix`, `code_adder_list`, `elevation`, `size_oversize`, `per_foot`, `fabrication`, `install_kit`, `anchor`, `quantity_tier`, `percentage`, `next_larger`, `included_nc_na`, `contact_factory`, `specialty_assembly`, `narrative`). Drives how the rule compiler interprets the grid.
- `source_region_id` (UUID, NULLABLE, FK → source_region.id ON DELETE SET NULL) - CPQ v2: the raw-evidence `source_region` this extraction produced (`raw_table_cell` rows hang off it). Index `price_book_extractions_source_region_id_idx`.
- `price_book_document_id` (UUID, NULLABLE, FK → price_book_document.id ON DELETE SET NULL) - CPQ v2: the document version this extraction compiles rules into. Index `price_book_extractions_price_book_document_id_idx`.
- `compiled_rule_count` (INTEGER, NOT NULL, DEFAULT 0) - CPQ v2: how many `price_rule`/`dependency_rule` rows the compiler emitted for this table.
- `created_at` / `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Indexes:** on `price_book_id`, `status`, `(price_book_id, sort_order)`, `source_region_id`, `price_book_document_id`

**RLS Policies:** ✅ enabled. Full authenticated CRUD. Trigger `set_price_book_extractions_updated_at`.

### pricing_change_proposals.price_book_id (added)

- `price_book_id` (UUID, NULLABLE, FK → price_books.id ON DELETE CASCADE) - Links ingestion proposals to their source price book. Index `idx_pricing_change_proposals_price_book_id`.

---

## CPQ Tables (Phase 2 — pricing exception agent)

### public.pricing_exceptions

A failed pricing lookup queued for human review. Created by `refreshEstimatePricing` when an item resolves to a non-`matched`, non-`category_unsupported` status. The exception agent (`explainPricingException` in `gemini-api.ts`) proposes a closest-match suggestion; a human approves it (writes the price) or dismisses it.

**Columns:**
- `id` (UUID, PRIMARY KEY)
- `estimate_item_id` (UUID, NULLABLE, FK → estimate_items.id ON DELETE CASCADE)
- `estimate_id` (UUID, NULLABLE, FK → estimates.id ON DELETE CASCADE)
- `item_label` (TEXT, NOT NULL, DEFAULT '')
- `lookup_status` (TEXT, NOT NULL) - the failing PriceLookupStatus (no_table/no_row/no_column/no_cell/no_vendor)
- `context` (JSONB, NOT NULL, DEFAULT `{}`) - `{ itemType, manufacturerId, fields[], warning, tableId, availableRows[], availableColumns[] }`
- `suggestion` (JSONB, NULLABLE) - agent suggestion `{ kind, suggestedRowId, suggestedColumnId, suggestedPrice, reason }`
- `explanation` (TEXT, NULLABLE)
- `resolution_status` (TEXT, NOT NULL, DEFAULT 'pending') - CHECK IN ('pending','approved','rejected','resolved')
- `resolved_by` (UUID, NULLABLE, FK → auth.users.id ON DELETE SET NULL)
- `resolved_at` (TIMESTAMPTZ, NULLABLE)
- `created_at` / `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Indexes:** on `estimate_item_id`, `estimate_id`, `resolution_status`; partial UNIQUE on `estimate_item_id WHERE resolution_status='pending'` (at most one open exception per item).

**RLS Policies:** ✅ enabled. Full authenticated CRUD. Trigger `set_pricing_exceptions_updated_at`.

**Note:** The pricing engine (`pricing-lookup.ts`) now also prices `hardware` (flat per-item list via `pricing_table_items`/series), `panels`, and `lites_louvers_glass` (label-based width×height), retiring `category_unsupported` for these categories.

---

## CPQ Tables (Phase 3 — compatibility / configuration rule engine)

Separate from price rules: these validate that a configured opening is buildable.

### public.compatibility_rules

**Columns:**
- `id` (UUID, PRIMARY KEY)
- `name` (TEXT, NOT NULL)
- `scope_type` (TEXT, NOT NULL, DEFAULT 'item_type') - CHECK IN ('item_type','canonical_code')
- `scope_value` (TEXT, NOT NULL) - the item_type slug or canonical_code the rule applies to
- `predicate` (JSONB, NOT NULL, DEFAULT `{}`) - `{ when?: {fieldKey,operator,values}, require: {fieldKey,operator,values} }`; operator IN equals/not_equals/in/not_in/gt/lt/gte/lte/between
- `severity` (TEXT, NOT NULL, DEFAULT 'error') - CHECK IN ('error','warning')
- `message` (TEXT, NOT NULL)
- `active` (BOOLEAN, NOT NULL, DEFAULT true)
- `created_by` (UUID, NULLABLE, FK → auth.users.id ON DELETE SET NULL)
- `created_at` / `updated_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())

**Indexes:** on `(scope_type, scope_value)`, `active`

**RLS Policies:** ✅ enabled. Read authenticated; insert/update/delete admins (`is_admin()`). Trigger `set_compatibility_rules_updated_at`.

### public.compatibility_rule_overrides

Per-canonical-code copy-on-write overrides (NULL columns inherit the rule; `is_disabled=true` suppresses the rule for that item). Mirrors the `item_type_field_dependency_overrides` pattern.

**Columns:** `id`, `rule_id` (FK → compatibility_rules ON DELETE CASCADE), `canonical_code`, `is_disabled` (BOOL DEFAULT false), `predicate` (JSONB NULL), `severity` (NULL), `message` (NULL), `created_at`/`updated_at`. UNIQUE `(rule_id, canonical_code)`.

**RLS Policies:** ✅ enabled. Full authenticated CRUD. Trigger `set_compatibility_rule_overrides_updated_at`.

The engine (`src/lib/compatibility-engine.ts`) evaluates active rules against an opening's merged field map and is run in the wizard Review step (errors block Save, warnings inform) and by the CPQ service before quoting.

---

## CPQ v2 — Spec-Driven Pricing & Hardware Integration (Overhaul Phase 0)

Greenfield rule-based pricing model from the Pioneer Spec Field Dictionary, Pioneer Ingestion & Pricing Schema, and the Hardware Data Integration workbook. These canonical tables coexist with the legacy grid model (`pricing_tables`/`pricing_cells`/...) until cutover, after which the legacy grid tables and `src/lib/pricing-lookup.ts` are retired. TypeScript types live in `src/types/cpq.ts` (re-exported from `src/types/index.ts`).

**Conventions:** all tables have RLS enabled. Catalog/rule tables use *authenticated read, admin write* (`is_admin()`); estimate-derived tables use *full authenticated CRUD* (mirrors the relaxed standalone `estimate_items` policies — flagged `rls_policy_always_true` by the advisor, accepted for the current phase). Mutable tables have a `set_<table>_updated_at` trigger via `handle_updated_at()`.

### Helper functions (internal)
- `public._cpq_set_updated_at(p_table text)` — attaches the standard updated_at trigger.
- `public._cpq_rls_admin_write(p_table text)` — enables RLS + policies `auth_read` (SELECT authenticated), `admin_insert`/`admin_update`/`admin_delete` (`is_admin()`).
- `public._cpq_rls_auth_write(p_table text)` — enables RLS + full authenticated CRUD policies (`auth_read`/`auth_insert`/`auth_update`/`auth_delete`).
- All three are `SET search_path = public, pg_temp`.

### Raw evidence layer
- **public.price_book_document** — one record per imported price-book revision. Cols: `id`, `manufacturer_id`→companies, `title`, `revision`, `effective_date`, `expiry_date`, `currency_code` (DEFAULT 'USD'), `source_file_path`, `source_file_hash`, `page_count`, `supersedes_id`→self, `status` CHECK('draft','published','superseded','archived'), `review_status` CHECK('UNREVIEWED','APPROVED','REJECTED','NEEDS_REVIEW'), `notes`, `created_by`→users, timestamps. (Folds in the legacy `price_books` concept.)
- **public.source_region** — provenance per page/table/note/cell. Cols: `id`, `price_book_id`→price_book_document CASCADE, `page_number`, `region_type` CHECK('page','table','note','cell','image'), `bbox` JSONB, `table_title`, `raw_text`, `extraction_confidence`, `created_at`.
- **public.raw_table_cell** — raw extracted cell + hierarchical headers. Cols: `id`, `source_region_id` CASCADE, `price_book_id` CASCADE, `row_index`, `col_index`, `row_headers`/`col_headers` JSONB, `raw_value`, `normalized_value`, `created_at`.

### Canonical catalog layer
- **public.product_family** — door/frame/panel/stick/specialty families (H, CH, F, DW, ...). Cols: `id`, `price_book_id` (NULL), `entity_type` CHECK('door','frame','panel','stick','specialty'), `family_code`, `name`, `default_attributes` JSONB, `description`, timestamps. Index `(entity_type, family_code)`.
- **public.option_definition** — controlled vocabulary for option/prep/anchor/install codes. Cols: `id`, `entity_type` CHECK('opening','door','frame','panel','stick','special_frame','hardware'), `category`, `feature_number`, `code`, `description`, `template_required`, `hand_required`, `pdf_pages`, `notes`, timestamps. Index `(entity_type, code)`.
- **public.price_table** — one per logical printed pricing table. Cols: `id`, `price_book_id` CASCADE, `entity_type` CHECK('door','frame','panel','stick','specialty','hardware','lite_kit','louver','glass','glazing_tape'), `archetype` CHECK(16 archetypes: base_matrix, component_matrix, code_adder_list, elevation, size_oversize, per_foot, fabrication, install_kit, anchor, quantity_tier, percentage, next_larger, included_nc_na, contact_factory, specialty_assembly, narrative), `name`, `section`, `basis`, `unit`, `precedence`, `source_region_id`, timestamps.

### NGP infill catalog layer (glass / lite kits / louvers / tape)
One NGP source workbook = one `price_book_document`. Dimensional matrices + option/direct/multiplier rules are compiled into the shared `price_table`/`price_rule`/`rule_condition`/`included_scope` engine (entity_type `lite_kit`/`louver`/`glass`/`glazing_tape`); the compatibility/intelligence layer lives in these `ngp_*` tables. All have RLS `auth_read` + admin-only writes.
- **public.ngp_product** — selectable NGP glass/kit/louver/tape/accessory SKUs. Cols: `id`, `price_book_document_id` CASCADE, `product_id` (e.g. 'NGP-L-FRA100'), `manufacturer`, `category`, `subcategory`, `model`, `model_aliases`, `product_name`, `material`, `standard_finish`, `door_thickness_min_in`/`door_thickness_max_in`, `glass_thickness_min_in`/`glass_thickness_max_in`, `fire_rating_max`, `preferred_price_uom`, `glass_scope` (SEPARATE_REQUIRED/BUNDLED/NOT_APPLICABLE), `active`, `source_page`, `notes`, `created_at`. UNIQUE `(price_book_document_id, product_id)`.
- **public.ngp_product_attribute** — typed EAV attributes. Cols: `id`, `ngp_product_id` CASCADE, `attribute_name`, `value_text`, `value_number`, `unit`, `data_type`, `source_page`, `created_at`.
- **public.ngp_kit_glass_capacity** — primary join `kit_model + door_thickness + glass_thickness -> required_tape_model`. Cols: `id`, `price_book_document_id` CASCADE, `capacity_id`, `kit_model`, `door_thickness_in`, `glass_thickness_in`, `required_tape_model`, `profile_group`, `allowed`, `source_page`, `created_at`.
- **public.ngp_glass_rating** — fire-glass visible-area/dimension limits. Cols: `id`, `price_book_document_id` CASCADE, `rating_id`, `glass_model`, `fire_minutes`, `application`, `max_visible_area_sq_in`, `max_visible_width_in`, `max_visible_height_in`, `source_page`, `created_at`.
- **public.ngp_size_rule** — order/cutout/cut-glass/exposed-glass/split-core rules. Cols: `id`, `price_book_document_id` CASCADE, `size_rule_id`, `model_or_family`, `output_field`, `operator`, `value`, `unit`, `input_basis`, `source_page`, `created_at`.
- **public.ngp_relationship** — kit/glass/tape/louver inclusion + exclusivity rules (BUNDLES_GLASS, REQUIRES, MUTUALLY_EXCLUSIVE_SAME_CUTOUT, APPROVED_FIRE_GLAZING_TAPE, ...). Cols: `id`, `price_book_document_id` CASCADE, `relationship_id`, `source_model`, `target_model`, `relationship_type`, `rule`, `inclusion_scope`, `confidence`, `source_page`, `created_at`.
- **public.ngp_finish_code** — powder-coat finish codes. Cols: `id`, `price_book_document_id` CASCADE, `finish_code`, `finish_name`, `availability`, `notes`, `created_at`.
- **public.ngp_option** — selectable options/adders (links to the compiled adder `price_rule`). Cols: `id`, `price_book_document_id` CASCADE, `option_id`, `applies_to`, `option_code`, `option_name`, `option_type`, `requirements`, `exclusions`, `pricing_status`, `price_rule_id`→price_rule SET NULL, `source_page`, `created_at`.
- **public.ngp_commercial_policy** — order-level freight/minimum/oversize/surcharge policies. Cols: `id`, `price_book_document_id` CASCADE, `policy_id`, `policy_type`, `description`, `basis`, `amount_or_threshold`, `unit`, `condition`, `source_page`, `created_at`.
- **public.ngp_price_table_map** — maps an NGP model (+ multiplier variants) to its compiled `price_table`. Cols: `id`, `price_book_document_id` CASCADE, `map_id`, `ngp_price_table_id` (NGP's own id, e.g. 'PT-LK-STANDARD'), `price_table_id`→price_table CASCADE, `model`, `relationship` (BASE/ALIAS/BASE_MULTIPLIER), `multiplier`, `condition`, `included_scope`, `glass_model`, `tape_model`, `entity_type`, `source_page`, `created_at`. The scope/glass columns let the infill resolver choose assembly (kit+glass+tape) vs component pricing.
- **public.opening_cutout** — persisted NGP infill selections per opening (so a build round-trips on edit). Cols: `id`, `opening_id`→estimate_openings CASCADE, `estimate_id`, `door_ref`, `infill_type` (NONE/LITE/LOUVER), `cutout_width`, `cutout_height`, `door_thickness_in`, `fire_rating_minutes`, `kit_model`, `louver_model`, `glass_model`, `tape_model`, `glass_thickness_in`, `finish_code`, `option_codes` JSONB, `prefer_assembly`, `sort_order`, `created_at`. RLS `auth_all` (authenticated CRUD). The resolved priced lines live in `estimate_line` (entity_type lite_kit/glass/glazing_tape/louver).

### Spec dictionary
- **public.opening_spec_field** — the 172-field master schema. Cols: `id`, `field_id` UNIQUE (e.g. 'OPN-001','DOR-002'), `entity` CHECK('opening','door','frame','panel','special_frame','hardware'), `category`, `field_label`, `data_type`, `required_when`, `allowed_values`, `pricing_logic`, `pdf_pages`, `priced_by`, `sort_order`, timestamps.
- **public.spec_field_mapping** — maps a spec field to a machine `field_path` used by `rule_condition`. Cols: `id`, `field_id`→opening_spec_field(field_id) CASCADE, `field_path`, `value_type` CHECK('TEXT','NUMBER','DIMENSION','BOOLEAN','CODE','DATE'), `notes`, `created_at`. UNIQUE `(field_id, field_path)`.

### Pricing rule layer
- **public.price_rule** — one canonical price action (per "Price Rule Columns" tab). Cols include: `id`, `rule_key` UNIQUE, `price_book_id` CASCADE, `price_table_id`, `entity_type` CHECK('door','frame','panel','stick','specialty','prep','anchor','packaging','hardware','lite_kit','louver','glass','glazing_tape'), `charge_category`, `item_or_option_code`, `price_status` CHECK('PRICED','NO_CHARGE','INCLUDED','NOT_APPLICABLE','CONTACT_FACTORY'), `action_type` CHECK(14: BASE_AMOUNT, FIXED_ADD, FIXED_ADD_X_QTY, RATE_X_QUANTITY, PERCENT_OF, REFERENCE_PLUS_ADD, TIERED_ADD, WAIVER, OVERRIDE, NO_CHARGE, INCLUDED, NOT_APPLICABLE, CONTACT_FACTORY, EXTERNAL_REQUIRED), `amount`, `currency_code`, `unit_of_measure`, `quantity_basis_field`, `base_quantity_included`, `minimum_charge`, `maximum_charge`, `reference_rule_id`→self, `percentage`, `fixed_add_after_reference`, `rounding_method` CHECK, `rounding_increment`, `priority`, `stacking_behavior` CHECK('STACK','OVERRIDE','EXCLUSIVE_GROUP','SUPPRESS_IF_INCLUDED'), `exclusive_group`, `effective_from`/`effective_to`, `source_region_id`, `raw_value_text`, `extraction_confidence`, `review_status`, timestamps.
- **public.rule_condition** — one selector predicate per row (per "Rule Condition Columns" tab). Cols: `id`, `price_rule_id` CASCADE, `condition_group`, `field_id`, `field_path`, `operator` CHECK('EQ','NE','IN','NOT_IN','GT','GTE','LT','LTE','BETWEEN','EXISTS','MISSING'), `value_type`, `value_1`, `value_2`, `unit`, `inclusive_min`, `inclusive_max`, `normalized_value`, `source_phrase`, `derived_flag`, `null_behavior` CHECK('FAIL','DEFAULT','IGNORE','MANUAL_REVIEW'), `created_at`.
- **public.rule_action_parameter** — params for non-fixed actions. Cols: `id`, `price_rule_id` CASCADE, `param_key`, `param_value`, `reference_rule_id`, `created_at`.
- **public.included_scope** — features bundled by a base/assembly rule (prevents double counting). Cols: `id`, `price_rule_id` CASCADE, `included_feature`, `included_option_code`, `suppresses_charge_category`, `notes`, `created_at`.
- **public.quantity_tier** — quantity-dependent price/waiver tiers. Cols: `id`, `price_rule_id` CASCADE, `quantity_field`, `min_qty`, `max_qty`, `amount`, `status`, `is_setup_charge`, `created_at`.
- **public.dependency_rule** — machine-testable requirement/exclusion (per "Dependency Schema" tab). Cols: `id`, `rule_key` UNIQUE, `price_book_id` CASCADE, `trigger_conditions` JSONB, `relationship_type` CHECK('REQUIRES','EXCLUDES','AUTO_ADD','SUPPRESSES','DEFAULTS','WARNS','REQUESTS_INPUT'), `target_type` CHECK('spec_field','option_code','price_rule','external_item','manual_quote'), `target_id_or_value`, `severity` CHECK('INFO','WARNING','ERROR','BLOCK_PRICING','BLOCK_ORDER'), `auto_apply_allowed`, `message_template`, `price_effect`, `source_region_id`, `priority`, `review_status`, timestamps.
- **public.external_scope_requirement** — required item not priced by this book. Cols: `id`, `price_rule_id` (NULL), `category`, `required_attributes` JSONB, `description`, `created_at`.

### Estimate layer
- **public.estimate_line** — auditable price build-up (per "Estimate Output" tab). Cols: `id`, `estimate_id` CASCADE, `opening_id` CASCADE, `component_id`→estimate_items, `entity_type` (Phase 5: door/frame/panel/specialty/prep/hardware/anchor/packaging — drives the auditable-quote layer grouping), `line_type` CHECK('BASE','ADDER','INCLUDED','EXTERNAL','MANUAL_QUOTE','WARNING'), `price_rule_id`, `charge_category` (Phase 5: base/option/prep code/hardware category/keying/access_control/service scope — drives layer grouping + hardware rollups), `description`, `selected_option_code`, `quantity`, `unit_of_measure`, `unit_list_price`, `extended_list_price`, `discount_multiplier`, `extended_net_price`, `sell_price`, `gross_margin`, `gross_margin_pct`, `price_status` CHECK('PRICED','INCLUDED','NO_CHARGE','CONTACT_FACTORY','EXTERNAL_PENDING','INVALID'), `calculation_expression`, `matched_conditions` JSONB, `included_or_suppressed_by`, `source_page`, `source_region_id`, `price_book_id`, `confidence`, `review_status`, `exception_message`, `sort_order`, `created_at`, `manual_sell_price` NUMERIC (user override on Review step, supersedes sell_price in totals), `is_manual_override` BOOLEAN DEFAULT false (true when manual_sell_price is set). (Full authenticated CRUD.) Read into the auditable quote via `loadEstimateLinesByOpening` → `buildAuditableQuoteFromEstimateLines` (`src/lib/cpq/auditable-quote.ts`); completeness gated by `validateQuoteCompleteness` (`src/lib/cpq/completeness.ts`).
- **public.manual_quote_queue** — CF/low-confidence/unresolved/invalid combos. Cols: `id`, `estimate_id` CASCADE, `opening_id`, `component_id`, `price_rule_id`, `reason` CHECK('CONTACT_FACTORY','LOW_CONFIDENCE','UNRESOLVED_REFERENCE','INVALID_COMBINATION','MISSING_PRICE'), `requested_inputs`, `status` CHECK('open','in_progress','resolved','cancelled'), `resolution_note`, timestamps. (Full authenticated CRUD.)
- **public.qa_issue** — extraction/pricing validation issues (publication gate). Cols: `id`, `price_book_id` CASCADE, `price_rule_id`, `source_region_id`, `check_name`, `severity` CHECK('INFO','WARNING','ERROR','BLOCK'), `detail`, `status` CHECK('open','resolved','waived'), timestamps.

### Hardware catalog (from the Hardware Data Integration workbook — 16-table schema)
- **public.hardware_product** — generic product model. Cols: `id`, `category`, `subcategory`, `manufacturer_id`→companies, `manufacturer_name`, `product_family`, `model`, `description`, `active`, `source_row_ref`, `source_confidence`, timestamps.
- **public.hardware_variant** — purchasable/configurable variant. Cols: `id`, `hardware_product_id` CASCADE, `sku`, `function`, `finish`, `size`, `hand`, `voltage`, `rating`, `material`, `option_attributes` JSONB, timestamps.
- **public.hardware_attribute** — typed EAV attribute on a product/variant. Cols: `id`, `hardware_product_id` CASCADE, `hardware_variant_id` CASCADE, `attr_name`, `attr_value`, `attr_unit`, `source_text`, `created_at`.
- **public.hardware_price_book** — vendor/supplier price source revision. Cols: `id`, `supplier_id`→companies, `supplier_name`, `title`, `effective_date`, `expiry_date`, `currency_code`, `source_file`, `review_status`, timestamps.
- **public.hardware_price** — one price for one variant from one source (cost model). Cols: `id`, `hardware_variant_id` CASCADE, `hardware_price_book_id`, `list_price`, `discount_multiplier`, `net_cost` (= list × discount), `uom` (DEFAULT 'EACH'), `effective_from`/`effective_to`, `minimum_quantity`, `source_row_ref`, `review_status`, timestamps.
- **public.hardware_sell_rule** — markup/customer sell rule (sell is computed, never hardcoded). Cols: `id`, `name`, `cost_basis` CHECK('net','list'), `markup_multiplier`, `gm_target_pct`, `rounding`, `customer_class`, `company_id`→companies, `category`, `effective_from`/`effective_to`, `priority`, timestamps.
- **public.hardware_compatibility_rule** — product/category compatibility. Cols: `id`, `subject_type` CHECK('product','variant','category'), `subject_ref`, `relationship_type` CHECK('REQUIRES','EXCLUDES','ALLOWS'), `target_type`, `target_ref`, `allowed_ratings`, `allowed_sizes`, `allowed_functions`, `notes`, timestamps.
- **public.hardware_prep_crosswalk** — THE bridge: hardware → Pioneer door/frame preps. Cols: `id`, `hardware_category`, `hardware_product_id`, `hardware_variant_id`, `door_prep_code`, `frame_prep_code`, `template_id`, `hand_required`, `location_required`, `additional_required_fields`, `quantity_basis`, `pricing_behavior`, `notes`, timestamps.
- **public.hardware_template** — manufacturer prep template. Cols: `id`, `manufacturer_id`, `manufacturer_name`, `model_series`, `template_number`, `revision`, `document_link`, `dimensions` JSONB, timestamps.
- **public.hardware_set_template** — reusable hardware set per opening type. Cols: `id`, `name`, `use_case`, `fire_rated`, `access_controlled`, `rated_flags` JSONB, `selection_conditions` JSONB, timestamps.
- **public.hardware_set_item** — one category/quantity-formula within a set. Cols: `id`, `hardware_set_template_id` CASCADE, `category`, `quantity_formula`, `required`, `position`, `compatible_variants` JSONB, `created_at`.
- **public.linear_hardware_rule** — length-driven weather/threshold/accessory pricing. Cols: `id`, `hardware_category`, `length_basis` CHECK('width','height','perimeter','head_plus_jambs','custom'), `cut_increment`, `waste_pct`, `minimum_length`, `per_foot_price`, `hardware_variant_id`, timestamps.
- **public.service_scope** — install/labor/wiring/glazing/freight/tax price sources. Cols: `id`, `scope_type` CHECK('install','labor','wiring','glazing','freight','packaging','tax','commissioning','field_work'), `name`, `basis` CHECK('per_opening','per_leaf','per_unit','percent_of','flat','per_hour'), `rate`, `percent`, `reference_basis`, `notes`, timestamps.

### Hardware estimate-scoped (full authenticated CRUD)
- **public.keying_schedule** — project-level keying system. Cols: `id`, `estimate_id` CASCADE, `format`, `keyway`, `master_key_hierarchy` JSONB, `construction_core_strategy`, `notes`, timestamps.
- **public.access_control_bundle** — door access-control BOM. Cols: `id`, `opening_id` CASCADE, `estimate_id` CASCADE, `reader`, `lock_strike`, `power_transfer`, `power_supply`, `dps`, `panel_io`, `cable_requirements`, `components` JSONB, `notes`, timestamps.
- **public.opening_hardware_item** — selected hardware for one opening. Cols: `id`, `opening_id` CASCADE, `estimate_id` CASCADE, `component_id`→estimate_items, `hardware_variant_id`, `category`, `quantity`, `selected_finish`, `selected_function`, `selected_hand`, `source`, timestamps.
- **public.quote_hardware_line** — resolved commercial hardware line. Cols: `id`, `opening_hardware_item_id` CASCADE, `estimate_id` CASCADE, `list_price`, `net_cost`, `sell_price`, `quantity`, `extension`, `gross_margin`, `gross_margin_pct`, `source`, `prep_links` JSONB, `status` CHECK('PRICED','EXTERNAL_PENDING','MANUAL_QUOTE','INVALID'), `created_at`.

### Extended existing tables
- **public.estimates** — added `price_book_id`→price_book_document (version pin) and `priced_as_of` TIMESTAMPTZ.
- **public.estimate_openings** — added `configuration_type` CHECK('single','pair','double_egress','communicating','dutch','borrowed_lite','sidelite_transom','storefront','specialty'), `leaf_count` INTEGER, `opening_config` JSONB (OPN-* selectors).
- **public.estimate_items** — added `product_family_id`→product_family and `spec_data` JSONB (resolved spec snapshot).

### Migrations applied (Phase 0)
`cpq_v2_rls_helpers`, `cpq_v2_raw_and_catalog_tables`, `cpq_v2_spec_dictionary`, `cpq_v2_rule_layer`, `cpq_v2_estimate_layer`, `cpq_v2_hardware_catalog`, `cpq_v2_hardware_estimate_scoped`, `cpq_v2_extend_estimate_tables`, `cpq_v2_helpers_search_path`.

### Seed data (Phase 1)
Seeded from the Pioneer Spec Field Dictionary + Hardware Data Integration workbooks (SQL committed in `db/seeds/cpq_v2/`):
- `opening_spec_field` — 172 master spec fields (OPN/DOR/FRM/PNL/CNN/HWR).
- `spec_field_mapping` — 172 machine `field_path`s (e.g. `DOR-002 -> door.door_series_construction`).
- `option_definition` — ~472 controlled codes: door (~196), frame (~219), panel (~29) option/prep/anchor codes + 14 `entity_type='hardware'` `category='hardware_category'` taxonomy rows.
- `product_family` — 38 door/frame series (H, CH, F, DW, specialty, ...).
- `hardware_prep_crosswalk` — 21 hardware→door/frame prep mappings (the integration bridge).
- `hardware_set_template`/`hardware_set_item` — 2 starter sets (Exterior fire-rated single; Interior pair).

Migrations: `cpq_v2_seed_product_family`, `cpq_v2_seed_hardware_prep_crosswalk`, `cpq_v2_seed_hardware_category_dict`, `cpq_v2_seed_opening_spec_field_opn_dor`, `cpq_v2_seed_opening_spec_field_frm_hwr`, `cpq_v2_seed_spec_field_mapping`, `cpq_v2_seed_option_definition_door`, `cpq_v2_seed_option_definition_frame`, `cpq_v2_seed_option_definition_panel`, `cpq_v2_seed_hardware_set_templates`.

Known follow-ups (Phase 1 polish): a few `option_definition` rows contain descriptive phrases or fraction-split noise from multi-code source cells (e.g. undercut `5/8`); harmless for vocabulary and can be cleaned later. Manufacturer alias map is deferred to Phase 2b (parser/normalizer concern).

### Staging/extraction bridge (Phase 2.0)
Wires the existing ingestion staging onto the canonical rule model without touching the legacy grid tables. Migration `cpq_v2_staging_extraction_bridge`:
- **public.price_books** — added `price_book_document_id`→price_book_document (ON DELETE SET NULL). A draft document is created when ingestion begins; publishing flips its `status` to `published`. Indexed.
- **public.price_book_extractions** — added `archetype` (classifier result), `source_region_id`→source_region (raw evidence), `price_book_document_id`→price_book_document, `compiled_rule_count` (rules emitted). `status` CHECK extended with `compiled`. Indexed on the two new FKs.
- **public.pricing_change_proposals** — `proposal_type` CHECK extended with `price_rule`, `dependency_rule`, `option`, `product_family`, `hardware_product`, `hardware_price`; added `price_book_document_id`→price_book_document (ON DELETE CASCADE). Indexed.
- Legacy `pricing_tables`/`pricing_cells`/`pricing_adder_cells` are NOT written by the new pipeline (read-only until Phase 6 retirement).

### Output, QA & cutover (Phase 5 / Phase 6)
Phase 5 (auditable output + QA gate):
- **public.estimate_line** gained `entity_type` + `charge_category` (migrations `cpq_v2_add_entity_type_to_estimate_line`, `cpq_v2_add_charge_category_to_estimate_line`) so the persisted lines group into the auditable quote layers (Pioneer base/adders/preps · hardware · linear · keying · access control · services). The engine (`persistEngineResult`) writes both.
- Auditable quote model + completeness validation + prep↔device reconciliation are pure libs (`src/lib/cpq/auditable-quote.ts`, `src/lib/cpq/completeness.ts`), rendered by `AuditableQuote.tsx` in both the live builder review and the wizard ReviewStep. The wizard "Save & Finish" is gated on completeness blockers (missing prices/templates, incompatible ratings, CF, unresolved scope) with an explicit acknowledge-override.
- **QA publication gate** (`src/lib/cpq/qa-checks.ts`): `runAndPersistQaChecks(documentId)` writes findings to **public.qa_issue** (source completeness, value semantics, unit basis, rule overlap, hardware net reconciliation, dependency coverage); `publishPriceBookDocumentWithQa` blocks publish on ERROR/BLOCK findings unless overridden. Wired into `RuleReviewPanel`'s Publish action.
- The **Example Opening** (`src/lib/cpq/example-opening.ts`) is the end-to-end round-trip fixture (3-0×7-0 exterior fire-rated single: cyl lock, closer, butt hinges, threshold, gasketing, DPS).

Phase 6 (cutover, GATED — not yet executed; preconditions: Pioneer book ingested + round-trip QA green + estimates migrated + grid editors removed):
- Legacy grid tables marked deprecated/read-only via comments (migration `cpq_v2_deprecate_legacy_grid_tables`).
- The destructive drop lives in `db/migrations/retire_legacy_grid.sql` (drops `pricing_adder_cells`, `pricing_cells`, `pricing_rows`, `pricing_columns`, `pricing_tables`) — run only once the preconditions hold.
- Existing estimates are re-entered into the engine model via `migrateAllEstimates()` (`src/lib/cpq/migrate-estimates.ts`), which reconstructs a NormalizedOpeningSpec per opening and persists `estimate_line` (explicit exceptions where no published rule exists yet).

### Pricing data remediation (CPQ Phase 1–4, 2026-06-20)

Remediation of price-book data gaps and the builder↔rules value disconnect. Migrations: `cpq_v2_spec_value_alias`, `cpq_v2_clean_rule_condition_vocab`, `cpq_v2_drop_literal_null_conditions`, `cpq_v2_assign_exclusive_groups`, `cpq_v2_seed_service_scope`, `cpq_v2_review_rules_and_hardware_coverage`, `cpq_v2_qa_issue_summary_view`.

- **public.spec_value_alias** (NEW) — governed vocabulary. Maps raw extracted `rule_condition` values to the canonical token in `opening_spec_field.allowed_values`. Consumed at **compile time** by the price-book worker (`services/price-book-worker/src/compile.js` `loadValueAliases`/`aliasConds`) so freshly ingested rules emit canonical enum values (and reject-flagged junk skips the rule), and at **publish time** by the QA vocabulary gate.
  - Columns: `id` (uuid PK), `field_path` (text), `raw_value` (text), `canonical_value` (text, NULL for rejects), `target_operator` (text CHECK `EQ`|`IN`, default `EQ`), `status` (text CHECK `alias`|`reject`), `notes` (text), `created_at`. UNIQUE(`field_path`, `raw_value`).
  - RLS: `auth_read` (using true); `admin_insert`/`admin_update`/`admin_delete` via `is_admin()`.
  - Seed (`db/seeds`/migration): recoverable aliases (e.g. `FEMA 361`→`FEMA`, `Piocane 50`→`F50`/`W50`, `STK 14`→`STK`, `F/DW`→IN `F|DW`, `Galvannealed`→`galvannealed`) and rejects (series codes / jamb depths / STC table dumps / headers leaked into gauge fields).
- **public.qa_issue_summary** (NEW view) — aggregates `qa_issue` by `price_book_title`, `price_book_id`, `check_name`, `severity`, `status` with `issue_count` + `last_seen`. Powers the Price Book QA dashboard (`/app/pricing/qa`).
- **public.rule_condition** (data only) — applied aliases to `value_1` (preserving original in `source_phrase`, setting `normalized_value`), converted multi-value EQ operands to `IN`, and deleted 505 meaningless `EQ 'null'` blank-cell conditions.
- **public.price_rule** (data only) — assigned `exclusive_group` (`auto:<md5>`) to identical-signature duplicate `BASE_AMOUNT` rules (scoped by book+table+entity+signature) so the engine cannot double-count; auto-approved 1,284 clean `UNREVIEWED` rules (PRICED + cite source + no reject-flagged condition). 161 rules referencing unrecoverable values stay `UNREVIEWED`.
- **public.service_scope** (seed) — default `install` (per_leaf), `freight` (percent_of), `tax` (percent_of) rows with PLACEHOLDER rates flagged in `notes` for ops/finance review, so quotes are no longer materials-only.
- **public.qa_issue** (data) — new `check_name`s: `vocab_unrecoverable` (ERROR, reject-flagged conditions), `condition_blank_artifact` (INFO, resolved), `hardware_missing_price` (ERROR, 48 variants with no approved price). The QA gate (`src/lib/cpq/qa-checks.ts`) added `evaluateVocabularyQa` (→`vocab_out_of_vocabulary`/`vocab_alias_pending`) and `evaluateHardwareCoverage` (→`hardware_missing_price`), both wired into `runQaChecks`.

Audit queries live in `db/audits/rule_condition_vocab_audit.sql`.

#### Spurious base-rule fix (2026-06-20, migration `cpq_v2_fix_spurious_base_rules`)
Live validation showed multiple "base" lines stacking on one component (e.g. a door priced at $828 + phantom $83 + $69; a frame at $41 + phantom $98). Root causes and fixes (all `price_rule` data, demoted to `review_status='REJECTED'` so the engine — which loads only APPROVED — skips them, and flagged in `qa_issue` for re-ingestion):
- **Unconditional empty BASE rules** (4 frame: amounts 39/98/108/156, raw `" | = X"`, no conditions) matched every frame → REJECTED; `qa_issue.check_name='base_rule_unconditional'`.
- **Size-code-as-dimension-bound BASE rules** (216 door+frame): a size code like `2070` (2'0"×7'0") or `240` (2" face + 4-0 width) stored as `nominal_*_width/height` bound ≥200in, making the bound always-true → REJECTED; `qa_issue.check_name='base_rule_size_code_bound'`.
- **Regression revert:** the combined series+gauge `door.door_gauge` aliases (`H or CH 18`, `LW or C 16`, …) from `cpq_v2_clean_rule_condition_vocab` had activated ~36 mis-parsed door size-rows once the `series='null'` guards were dropped. Their `rule_condition.value_1` is restored from `source_phrase` and those `spec_value_alias` rows reclassified `alias`→`reject`.

UI: `AuditableQuote` now shows each line's matched spec (`matchedConditions`) and warns when one `componentId` matches more than one BASE price (`src/lib/cpq/auditable-quote.ts` `duplicateBaseWarning`).

#### Dev price-book reset (2026-06-20, migration `cpq_v2_reset_price_books`)
All ingestion-derived data was wiped for a clean re-ingest with the hardened size-code parser (no production users yet). **Emptied:** `price_books`, `price_book_extractions`, `price_book_document` (→ cascade `price_rule`/`rule_condition`/`rule_action_parameter`/`included_scope`/`quantity_tier`/`price_table`/`source_region`/`raw_table_cell`/`qa_issue`/`dependency_rule`/`pricing_change_proposals`/all `ngp_*`), the hardware catalog (`hardware_product`/`hardware_variant`/`hardware_attribute`/`hardware_price`/`hardware_price_book`/`linear_hardware_rule`/`hardware_compatibility_rule`), the legacy `pricing_*` grid, and engine output (`estimate_line`/`manual_quote_queue`/`quote_hardware_line`). **Preserved:** the seeded dictionary/governance (`opening_spec_field`, `spec_field_mapping`, `option_definition`, `product_family`, `hardware_prep_crosswalk`, `hardware_set_template`/`_item`, `spec_value_alias`, `service_scope`, `hardware_sell_rule`) and all user/test data (`companies`, `estimates`, `estimate_items`, `estimate_openings`). The `price-book-files` storage bucket must be emptied separately via the Storage API/Dashboard (direct `storage.objects` DELETE is blocked).

#### Publish NGP catalog (2026-06-21, migration `cpq_v2_publish_ngp_catalog`)
Data-only status fix (no schema change). Two `price_book_document`s titled "NGP" existed: an older partial ingest (`adfdd074…`, `published`, 0 catalog products, 5 price tables, 147 `option` rules) and a complete re-ingest (`cb183520…`, `draft`, 83 `ngp_product` rows, 50 price tables, ~18k lite_kit/louver/glass/glazing_tape/option rules). The builder's `resolveActiveNgpDocument()` requires a *published* document carrying `ngp_product` rows, so the opening builder reported "No published NGP catalog found" even though the data existed. The migration sets `cb183520` → `status='published'`, `review_status='APPROVED'`, `supersedes_id = adfdd074`, and sets `adfdd074` → `status='superseded'` (fully superseded by `cb183520`; reversible). No data deleted.

#### Door core-upgrade selector + per-series normalization (2026-06-21)
Polystyrene/polyurethane/temperature-rise are not ingested as base door series — they are published as `FIXED_ADD` core-upgrade adders keyed on `door.option_code` and gated on the base series. The published book defines core options **per series**, so the codes and prices differ:

| Series | Base core (N/C) | Upgrades (`option_code` → adder) |
|---|---|---|
| H | Honeycomb | HP +$53 · HT +$231 · HR +$985 |
| CH | Honeycomb | CHP +$53 · CHT +$231 · CHR +$985 |
| LW | Steel-stiffened | PS +$53 · TS +$231 (between stiffeners) |
| C | Steel-stiffened | PS +$75 · TS +$275 (between stiffeners) |
| EH | Honeycomb | EP +$84 |

Migration `cpq_v2_normalize_core_upgrade_codes` re-keyed the CH adders (descriptive phrases → `CHP`/`CHT`/`CHR`) and C adders (`…Between Stiffeners` → `PS`/`TS`) to the Pioneer per-series nomenclature, and rejected a stray ungated `EP` $105 adder that would double-count against the EH-gated `EP` $84. H and LW were already correctly keyed.

Builder side (`builder-logic.ts` + `opening-spec.ts`): the **Core type** field (`DOR-003`) is an essential, selectable picker driven by `SERIES_CORE_UPGRADES`; `allowedEnumOptions` offers each series' base core + its priced upgrades, and `coreUpgradeOptionCode(series, core)` bridges the choice into `door.option_code` so the upgrade prices as **series base + adder**. Base cores (honeycomb / steel-stiffened) and series without published upgrades emit no `option_code`.

#### Hardware category slug identity (2026-06-21, migration `cpq_v2_hardware_category_slugs`)
The hardware category *identity* is the snake_case slug (`butt_hinges`, `cylindrical_mortise_locks_and_deadbolts`, …) used by the builder `HW` constants, the `hardware_set_item` templates, the engine selection key, and the MISSING_PRICE messages. A prior normalization had set `hardware_product.category` to readable title-case ("Butt hinges", …), which broke `loadVariantsForCategory()` (an exact match on the slug) — so the builder showed "No catalog variants — route to manual quote" for every auto-suggested category and every required hardware line blocked as MISSING_PRICE. This re-keys `hardware_product.category` and `linear_hardware_rule.hardware_category` to the slug (deterministic, collision-free across the 14 categories); the readable label is derived in the UI (`loadHardwareCategories` title-cases the slug). The granular `hardware_prep_crosswalk.hardware_category` vocabulary is left alone (engine fuzzy-matches it). The worker (`services/price-book-worker/src/hardware.js`) now slugs the category at the `hardware_product` / `linear_hardware_rule` write boundary (`slugifyCategory`) while keeping internal title-case logic, so re-ingests stay consistent.

#### Seamless build-to-review flow (2026-06-21, migrations `cpq_v2_opening_spec_snapshot`, `cpq_v2_estimate_line_overrides_and_adjustment`)

**Migration `cpq_v2_opening_spec_snapshot`** — added `estimate_openings.spec_snapshot JSONB NULL`. Written by `saveOpeningDraft` in `src/lib/cpq/opening-persist.ts` with the full `OpeningDraft` JSON on every spec builder save. Enables faithful round-trip editing (`loadOpeningDraft` → `SpecOpeningBuilder`) and re-pricing (`repriceSpecOpening`) without lossy reconstruction from item_fields.

**Migration `cpq_v2_estimate_line_overrides_and_adjustment`** — added:
- `estimate_line.manual_sell_price NUMERIC NULL` — user-entered sell price override for one engine line. When set, display and totals use this instead of `sell_price`.
- `estimate_line.is_manual_override BOOLEAN DEFAULT false` — true when `manual_sell_price` has been set by a user on the Review step.
- `estimates.sell_adjustment_pct NUMERIC NULL` — optional estimate-level markup/discount applied to the engine grand total on the Review step (positive = markup %, negative = discount %).
- `estimates.estimate_notes TEXT NULL` — free-text notes entered on the Review step.

#### Hardware reseed from normalized master (2026-06-21, migration `cpq_v2_reseed_hardware_from_master`)
Reseeded the entire hardware catalog + prep crosswalk from `public/Hardware_Normalized_Ingestion_Master.xlsx` (the cleaned/normalized hardware workbook). **Replaced:** `hardware_product` (301 rows), `hardware_variant` (301, one per consolidated product identity), `hardware_price` (494 source observations — 382 `APPROVED` where the row is READY with a validated net, the rest `NEEDS_REVIEW` for conflicts/missing/negative nets so nothing silently becomes $0), `hardware_price_book` (one row, `source_file='Hardware_Normalized_Ingestion_Master.xlsx'`), and `hardware_prep_crosswalk` (18 rows). The full reseed SQL lives in `db/migrations/20260621212904_cpq_v2_reseed_hardware_from_master.sql` (delete + insert, idempotent/re-runnable). `opening_hardware_item.hardware_variant_id` and `linear_hardware_rule.hardware_variant_id` on the prior catalog were `SET NULL` by FK (expected for a dev reseed).

- **Category mapping** — the workbook taxonomy (`hinges`/`locks`/`closers_and_holders`/…) is remapped onto the app's governed `hardware_product.category` slugs (`butt_hinges`, `continuous_hinges`, `electric_hinges_ept_loops`, `closers_and_arms`, `cylindrical_mortise_locks_and_deadbolts`, `exit_devices`, `exit_trim_pulls`, `inactive_leaf_hardware`, `protection_accessories`, `thresholds`, `weather_seals`, `keying`, `lite_kits_and_louvers`, `access_control`, plus `unclassified`). The workbook's `subcategory_id` is preserved verbatim in `hardware_product.subcategory` (e.g. `deadbolt`, `cylindrical_lock`, `overhead_holder_stop`, `surface_closer`).
- **Subcategory-keyed prep crosswalk** — `hardware_prep_crosswalk.hardware_category` now holds the **subcategory** token (`deadbolt`→`CDL`/`234N`, `cylindrical_lock`→`CYL`/`478`, `overhead_holder_stop`→`SOH`/`SOHS`, …). Rows with no machined prep (`gasketing`, `threshold`, `lite_kit`) carry NULL codes so they emit no prep.
- **Engine change (code, not schema)** — `loadVariantsWithPrices` now also selects `hardware_product.subcategory` (`VariantWithPrice.subcategory`); `matchCrosswalk` resolves by `variantId → productId → subcategory slug → category slug → fuzzy`; `derivePrepRequirements` takes a `variantId → subcategory` map and lets a matched crosswalk row emit its codes even when the parent category is surface-mounted (so an overhead holder in `closers_and_arms` still gets `SOH`/`SOHS`). This is what makes the deadbolt-vs-lock and holder-vs-closer distinction actually price.

#### Linear hardware rules consolidated (2026-06-21, migration `cpq_v2_reseed_linear_hardware_rules`)
Replaced the 59 orphaned per-variant `linear_hardware_rule` rows (their `hardware_variant_id` links were `SET NULL` by the catalog reseed) with **2 clean, explicit per-category rules**: `weather_seals` (`length_basis='head_plus_jambs'`, `waste_pct=10`) and `thresholds` (`length_basis='width'`, `waste_pct=0`). The engine prices linear accessories per the SELECTED variant's approved per-foot net (`hardware_price`, `uom='FT'`); these rules only supply the length basis + explicit, auditable waste and make `isLinearCategory()` route weather seals / thresholds through the per-foot path. SQL: `db/migrations/20260621230000_cpq_v2_reseed_linear_hardware_rules.sql`.

#### Hardware sell rule default markup (2026-06-21, migration `cpq_v2_hardware_sell_rule_default_2x`)
Replaced the placeholder global `hardware_sell_rule` (markup ×1.0 → sell=net → 0% GM on every quote) with a single global **net × 2.0 (~50% GM)** rule ("Standard 2x markup", `cost_basis='net'`, `priority=1`). The Hardware Normalized Ingestion Master workbook carries no reliable sell signal (only 17 of 494 price rows have both net and a source sell, and those ratios are per-foot-vs-full-length noise), so markup is a business-policy default rather than workbook-derived. Tune later by inserting higher-priority rows with a non-null `category` (and/or `customer_class`/`company_id`); `computeSell` picks the lowest `priority` match. SQL: `db/migrations/20260621231500_cpq_v2_hardware_sell_rule_default_2x.sql`.

---

## Spec-driven Opening Builder (Release 1)

Added by migration `cpq_v2_spec_resolver` + seed `product_family_capability.sql`. Manufacturer series (DOR-002 / FRM-002) are resolution outputs, not user inputs. See `RESOLVER_VERSION` in `src/types/cpq.ts` and the resolver in `src/lib/cpq/resolver.ts`.

### public.product_family_capability

Versioned predicates defining what each product family supports. The resolver eliminates families whose predicates fail any requirement.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `family_id` (UUID, NOT NULL) - FK to product_family.id, CASCADE on delete
- `component_scope` (TEXT, NOT NULL) - CHECK IN ('opening','door','frame','panel')
- `field` (TEXT, NOT NULL) - machine field_path the predicate tests (e.g. `opening.wall_construction`)
- `operator` (TEXT, NOT NULL, DEFAULT 'EQ') - CHECK IN ('EQ','NE','IN','NOT_IN','GT','GTE','LT','LTE','BETWEEN','EXISTS','MISSING')
- `value` (TEXT, NULLABLE) - operand (pipe-delimited for IN/NOT_IN)
- `value2` (TEXT, NULLABLE) - upper bound for BETWEEN
- `catalog_version` (TEXT, NOT NULL, DEFAULT 'R1')
- `notes` (TEXT, NULLABLE)
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())

**Indexes:** `idx_pfc_family` on family_id; `idx_pfc_scope_ver` on (component_scope, catalog_version)

**RLS:** ENABLED — `auth_read` (SELECT to all), `admin_write` (ALL via is_admin()).

---

### public.family_resolution_policy

Ranking + display policy for compliant resolution candidates. Lower `rank` is preferred; `auto_accept` lets a sole survivor be accepted without estimator input.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `component_scope` (TEXT, NOT NULL) - CHECK IN ('opening','door','frame','panel')
- `family_id` (UUID, NULLABLE) - FK to product_family.id, CASCADE on delete
- `rank` (INTEGER, NOT NULL, DEFAULT 100)
- `auto_accept` (BOOLEAN, NOT NULL, DEFAULT true)
- `display_label` (TEXT, NULLABLE)
- `catalog_version` (TEXT, NOT NULL, DEFAULT 'R1')
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())

**Indexes:** `idx_frp_scope_ver` on (component_scope, catalog_version)

**RLS:** ENABLED — `auth_read` (SELECT to all), `admin_write` (ALL via is_admin()).

---

### public.opening_component_option

Selected/derived options and preps per opening component. Replaces the single `door.option_code` field so a component can carry many priced options/preps.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `opening_id` (UUID, NOT NULL) - FK to estimate_openings.id, CASCADE on delete
- `component_id` (UUID, NULLABLE) - FK to estimate_items.id, SET NULL on delete
- `scope` (TEXT, NOT NULL) - CHECK IN ('opening','door','frame','panel')
- `kind` (TEXT, NOT NULL) - CHECK IN ('option','prep')
- `code` (TEXT, NOT NULL)
- `source` (TEXT, NOT NULL, DEFAULT 'derived') - CHECK IN ('derived','estimator','capability')
- `description` (TEXT, NULLABLE)
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())

**Indexes:** `idx_oco_opening` on opening_id; `idx_oco_component` on component_id

**RLS:** ENABLED — `auth_all` (ALL for authenticated users).

---

### public.opening_resolution_revision

Immutable snapshot per resolve: input `UserOpeningSpec`, candidate set, estimator selection, derived `ResolvedOpeningConfig`, and pinned resolver/catalog/price-book versions. Repricing appends a new row; prior revisions are retained for audit.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `opening_id` (UUID, NOT NULL) - FK to estimate_openings.id, CASCADE on delete
- `estimate_id` (UUID, NULLABLE) - FK to estimates.id, CASCADE on delete
- `resolver_version` (INTEGER, NOT NULL)
- `catalog_version` (TEXT, NULLABLE)
- `price_book_id` (UUID, NULLABLE) - FK to price_book_document.id
- `priced_as_of` (DATE, NULLABLE)
- `input_spec` (JSONB, NOT NULL, DEFAULT '{}')
- `candidates` (JSONB, NOT NULL, DEFAULT '[]')
- `estimator_selection_id` (TEXT, NULLABLE)
- `resolved_config` (JSONB, NOT NULL, DEFAULT '{}')
- `created_by` (UUID, NULLABLE) - FK to users.id
- `created_at` (TIMESTAMPTZ, DEFAULT NOW())

**Indexes:** `idx_orr_opening` on (opening_id, created_at desc)

**RLS:** ENABLED — `auth_all` (ALL for authenticated users).

---

### public.estimates (price-book pinning additions)

`cpq_v2_spec_resolver` ensures these deterministic-reprice columns exist (idempotent `ADD COLUMN IF NOT EXISTS`):
- `price_book_id` (UUID, NULLABLE) - FK to price_book_document.id — pinned Pioneer document the estimate was priced against.
- `priced_as_of` (DATE, NULLABLE) - effective date the estimate was priced as of.

---

## Security Status

✅ RLS enabled on all public tables
✅ Function search paths properly configured

**Known Advisories (non-critical):**
- ⚠️ `companies` and `contacts` tables have permissive INSERT/UPDATE/DELETE RLS policies (allows all authenticated users). This is intentional for the current phase but should be tightened later.
- ⚠️ Leaked password protection is disabled in Supabase Auth settings. Consider enabling via the Supabase Dashboard.
