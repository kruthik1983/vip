-- ============================================================================
-- USERS TABLE RLS SUPPORT FOR ORG_ADMIN AUTH FLOW
-- Run this once in Supabase SQL Editor
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- insert own profile
DROP POLICY IF EXISTS "users_insert_own_profile" ON public.users;
CREATE POLICY "users_insert_own_profile"
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (auth_id = (select auth.uid()));

-- update own profile
DROP POLICY IF EXISTS "users_update_own_profile" ON public.users;
CREATE POLICY "users_update_own_profile"
ON public.users
FOR UPDATE
TO authenticated
USING (auth_id = (select auth.uid()))
WITH CHECK (auth_id = (select auth.uid()));

-- optional self-read policy if missing in your DB (safe fallback)
DROP POLICY IF EXISTS "users_select_own_profile" ON public.users;
CREATE POLICY "users_select_own_profile"
ON public.users
FOR SELECT
TO authenticated
USING (auth_id = (select auth.uid()));

-- ============================================================================
-- END
-- ============================================================================
