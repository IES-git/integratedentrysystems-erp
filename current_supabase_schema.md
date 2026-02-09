# Current Supabase Schema

Last updated: 2026-02-09 (Draft Saving Flow Fixed)

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

### public.customers

Customer information table for estimates.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `name` (TEXT, NOT NULL) - Customer name
- `contact_person` (TEXT) - Contact person name
- `email` (TEXT) - Email address
- `phone` (TEXT) - Phone number
- `address` (TEXT) - Street address
- `city` (TEXT) - City
- `state` (TEXT) - State
- `zip` (TEXT) - ZIP code
- `notes` (TEXT) - Additional notes
- `active` (BOOLEAN, DEFAULT true) - Whether customer is active
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW()) - Last update timestamp

**Indexes:**
- `idx_customers_name` on name
- `idx_customers_email` on email

**RLS Policies:**
- ✅ Row Level Security is ENABLED
- `Authenticated users can read customers` - All authenticated users can SELECT
- `Authenticated users can insert customers` - All authenticated users can INSERT
- `Authenticated users can update customers` - All authenticated users can UPDATE

**Triggers:**
- `set_customers_updated_at` - Automatically updates updated_at timestamp

### public.estimates

Main estimate record from uploaded files.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `customer_id` (UUID) - FK to customers.id, nullable (assigned during wizard "Save Draft" flow)
- `uploaded_by_user_id` (UUID, NOT NULL) - FK to users.id
- `source` (TEXT, NOT NULL, DEFAULT 'upload') - Source of estimate
- `original_file_url` (TEXT, NOT NULL) - Supabase Storage path
- `original_file_name` (TEXT, NOT NULL) - Original filename
- `file_type` (TEXT, NOT NULL) - 'pdf' or 'image'
- `ocr_status` (TEXT, NOT NULL, DEFAULT 'pending') - 'pending', 'processing', 'done', 'error'
  - **Note:** Estimates with `ocr_status = 'done'` are ready to use as drafts for quotes
- `ocr_error` (TEXT) - Error message if OCR failed
- `extracted_customer_name` (TEXT) - AI-extracted customer name
- `extracted_customer_contact` (TEXT) - AI-extracted contact person
- `extracted_customer_email` (TEXT) - AI-extracted email
- `extracted_customer_phone` (TEXT) - AI-extracted phone
- `customer_confidence` (NUMERIC) - Confidence score for customer extraction
- `extracted_at` (TIMESTAMPTZ) - When extraction completed
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp
- `updated_at` (TIMESTAMPTZ, DEFAULT NOW()) - Last update timestamp

**Draft Flow:**
1. Upload: File uploaded to Supabase Storage, estimate record created with `ocr_status = 'pending'`
2. Processing: Edge Function invoked, status changes to `ocr_status = 'processing'`, then `done` when complete
3. Wizard: User reviews customer info and line items, then clicks "Save Draft"
   - **Customer Creation:** If user selects "Use Extracted Customer" and no matching customer exists in the database, a new customer record is automatically created in the `customers` table using the extracted data
   - Customer options: Use extracted (auto-create if needed), select existing, or no customer
4. List Page: Estimate appears in `/app/estimates` list (loaded from Supabase via `listEstimates()`)
5. Convert to Quote: User can convert estimate to customer/manufacturer quote from the list page

**Indexes:**
- `idx_estimates_customer_id` on customer_id
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

### public.estimate_items

Line items extracted from estimates.

**Columns:**
- `id` (UUID, PRIMARY KEY) - Default gen_random_uuid()
- `estimate_id` (UUID, NOT NULL) - FK to estimates.id, CASCADE on delete
- `item_label` (TEXT, NOT NULL) - Item description/label
- `canonical_code` (TEXT) - Standardized product code
- `quantity` (INTEGER, DEFAULT 1) - Item quantity
- `sort_order` (INTEGER, DEFAULT 0) - Display order
- `created_at` (TIMESTAMPTZ, DEFAULT NOW()) - Creation timestamp

**Indexes:**
- `idx_estimate_items_estimate_id` on estimate_id
- `idx_estimate_items_sort_order` on (estimate_id, sort_order)

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

## Edge Functions

### process-estimate

Serverless Edge Function that processes uploaded estimate files using Gemini 3 Flash with Agentic Vision (code execution).

**Configuration:**
- `slug`: process-estimate
- `verify_jwt`: false (JWT verification disabled - function uses service role key internally)
- `status`: ACTIVE
- `version`: 2 (updated 2026-02-09 to fix 401 authentication errors)

**Request:**
- Method: POST
- Body: `{ "estimateId": "uuid" }`
- Authorization: Handled by frontend Supabase client session

**Flow:**
1. Reads the estimate record from `estimates` table
2. Updates `ocr_status` to `processing`
3. Downloads the file from `estimate-files` storage bucket
4. Queries all `field_definitions` (approved ones sent to Gemini as known fields)
5. Calls Gemini 3 Flash (`gemini-3-flash-preview`) with:
   - File as inline base64 data
   - Code execution tool enabled (Agentic Vision for zooming/inspecting)
   - Structured JSON output via `responseJsonSchema`
   - Extraction prompt with known field definitions
6. Inserts extracted `estimate_items` and `item_fields` rows
7. Creates new `field_definitions` with `status = 'pending_review'` for discovered fields
8. Updates estimate with `ocr_status = 'done'`, extracted customer info, and `extracted_at` timestamp
9. On error: sets `ocr_status = 'error'` and `ocr_error` message

**Response:**
```json
{ "success": true, "estimateId": "uuid", "itemCount": 5, "newFieldsDiscovered": 3 }
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

## Estimate Management

**API Functions** (in `src/lib/estimates-api.ts`):
- `uploadEstimateFile(file, userId)` - Upload file to Supabase Storage and create estimate record
- `processEstimate(estimateId)` - Invoke Edge Function to extract data using Gemini
- `getEstimate(id)` - Fetch a single estimate by ID
- `getEstimateWithItems(id)` - Fetch estimate with items and fields
- `listEstimates()` - List all estimates (most recent first)
- `updateEstimate(id, updates)` - Update estimate fields (customer, extracted data, etc.)
- `deleteEstimate(id)` - Delete estimate, its items/fields, and the file from storage
- `getEstimateFileUrl(filePath)` - Generate temporary signed URL for file preview

**Access:** Admin users only (enforced by sidebar visibility and Supabase RLS policies)

## Security Status

✅ RLS enabled on all public tables
✅ Function search paths properly configured

**Known Advisories (non-critical):**
- ⚠️ `customers` table has permissive INSERT/UPDATE RLS policies (allows all authenticated users). This is intentional for the current phase but should be tightened later.
- ⚠️ Leaked password protection is disabled in Supabase Auth settings. Consider enabling via the Supabase Dashboard.
