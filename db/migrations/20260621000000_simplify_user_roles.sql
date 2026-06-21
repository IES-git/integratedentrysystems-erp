-- Migration: Simplify user_role enum to admin/sales/ops
-- Removes: finance, hr
-- Verifies no active rows use removed values before proceeding

-- Safety check: fail fast if any user has a role that won't exist in the new enum
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users WHERE role IN ('finance', 'hr')
  ) THEN
    RAISE EXCEPTION 'Cannot migrate: users with role finance or hr still exist. Reassign them first.';
  END IF;
END;
$$;

-- Step 1: Create the new enum with only the three roles we want
CREATE TYPE user_role_v2 AS ENUM ('admin', 'sales', 'ops');

-- Step 2: Swap the column to use the new enum type
ALTER TABLE public.users
  ALTER COLUMN role TYPE user_role_v2
  USING role::text::user_role_v2;

-- Step 3: Drop the old enum
DROP TYPE user_role;

-- Step 4: Rename the new enum to the canonical name
ALTER TYPE user_role_v2 RENAME TO user_role;

-- Step 5: Update handle_new_user() trigger — default is already 'sales' which still exists
-- Recreate to ensure the function body references the updated type cleanly
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
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

-- Step 6: is_admin() stays unchanged (admin-only, no hr)
-- Recreate for clarity
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;
