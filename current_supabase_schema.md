# Current Supabase Schema

Last updated: 2026-04-07 (hardware_catalog table with RLS, indexes, updated_at trigger, and seeded items for swing_it / close_it / latch_it / protect_it subcategories)

## Authentication Status

✅ **Supabase Authentication is LIVE**
- Login page using `auth.signInWithPassword()`
- Signup page with automatic profile creation
- AuthContext integrated with Supabase sessions
- Session persistence enabled

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
CREATE TYPE user_role AS ENUM ('admin', 'sales', 'ops', 'finance', 'hr');
```

## Tables

### public.field_definitions

The "learning" table that grows as Gemini discovers new field types during estimate processing.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `field_key` (TEXT, UNIQUE NOT NULL) - Unique identifier for field (e.g., 'gauge', 'hinge_prep')
- `field_label` (TEXT, NOT NULL) - Display label (e.g., "Gauge", "Hinge Prep")
- `value_type` (TEXT, NOT NULL) - Data type: 'string', 'number', 'bool', 'date', 'code'
- `description` (TEXT) - AI-generated description of what this field represents
- `status` (TEXT, NOT NULL, DEFAULT 'pending_review') - 'approved' or 'pending_review'
- `usage_count` (INTEGER, DEFAULT 0) - How many times this field has been extracted
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

Business entity table replacing the old flat `customers` table.

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
- `total_price` (NUMERIC, DEFAULT NULL) - Total estimate price extracted from document
- `extracted_at` (TIMESTAMPTZ) - When extraction completed
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW()) - Last update timestamp

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
- `subcategory` (TEXT, nullable) - CHECK IN ('swing_it','close_it','latch_it','protect_it') — hardware subcategory for display grouping; NULL for non-hardware items
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp

**Indexes:**
- `idx_estimate_items_estimate_id` on estimate_id
- `idx_estimate_items_sort_order` on (estimate_id, sort_order)
- `idx_estimate_items_manufacturer_id` on manufacturer_id
- `idx_estimate_items_opening_id` on opening_id
- `idx_estimate_items_parent_item_id` on parent_item_id

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Users can read estimate items they own` - Users can SELECT items for accessible estimates
- `Users can insert items for their own estimates` - Users can INSERT items for their own estimates
- `Users can update items for their own estimates` - Users can UPDATE items for their own estimates
- `Users can delete items for their own estimates` - Users can DELETE items for their own estimates

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

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `field_definition_id` (UUID, NOT NULL) - FK to field_definitions.id, CASCADE on delete
- `value` (TEXT, NOT NULL) - The stored field value
- `usage_count` (INTEGER, NOT NULL, DEFAULT 1) - How many times this value has been used
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp

**Constraints:**
- `field_value_options_field_definition_id_value_key` UNIQUE on `(field_definition_id, value)`

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

## Edge Functions

### process-estimate

Serverless Edge Function that processes uploaded estimate files using Gemini 3 Flash with Agentic Vision (code execution).

**Configuration:**
- `slug`: process-estimate
- `verify_jwt`: false (JWT verification disabled - function uses service role key internally)
- `status`: ACTIVE
- `version`: 21 (updated 2026-03-24 — three-pass extraction: added manufacturer alias hints in Pass 2 and Pass 3 for AI-based opening grouping)

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

### public.hardware_catalog

Pre-defined hardware catalog seeded from the DOOR_FRAME SHORTCUT_LOOKUP spreadsheet, organized into four subcategories used by the Items page and estimate wizard.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `name` (TEXT, NOT NULL) - Display name of the hardware item
- `canonical_code` (TEXT, NOT NULL, UNIQUE) - Unique item code (e.g., 'HINGE-MECH-SS-45X45-NRP-134')
- `subcategory` (TEXT, NOT NULL) - CHECK IN ('swing_it','close_it','latch_it','protect_it')
- `description` (TEXT) - Optional description of the item
- `active` (BOOLEAN, NOT NULL, DEFAULT true) - Whether the item appears in pickers
- `sort_order` (INTEGER, NOT NULL, DEFAULT 0) - Display ordering within subcategory
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

**Seed data (66 rows total):**
- **swing_it** (25 rows): Mechanical SS hinges (4.5×4.5 and 5×4.5 NRP .134"/.180"), Spring SS 4.5×4.5", Electrified SS variants, Continuous Aluminum and SS 630 Full Mortise/Half Mortise/Full Surface × 80"/84"/96"
- **close_it** (21 rows): Header Mount and Door Mount closers × Cast Iron/Aluminum × Cushioned/Hold Open Stop/Hold Open Spring/Fusible Link/Parallel Arm; plus Slide Track Hold Open
- **latch_it** (11 rows): Active — Deadbolt KOS/KBS, Lockset Cylindrical/Mortise, Panic Bar Rim/Mortise/SVR/CVR; Inactive (active=false) — Surface Bolt, Flush Bolt, Surface Vertical Rod
- **protect_it** (9 rows): Weatherstrip Adhesive/Kerf/Screw-On/Aluminum, Threshold Flat/Panic/Notched, Drip Cap, Door Sweep

**Migration:** `create_hardware_catalog_table` (applied 2026-04-07)

## Security Status

✅ RLS enabled on all public tables
✅ Function search paths properly configured

**Known Advisories (non-critical):**
- ⚠️ `companies` and `contacts` tables have permissive INSERT/UPDATE/DELETE RLS policies (allows all authenticated users). This is intentional for the current phase but should be tightened later.
- ⚠️ Leaked password protection is disabled in Supabase Auth settings. Consider enabling via the Supabase Dashboard.
