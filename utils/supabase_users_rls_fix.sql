-- ============================================================================
-- USERS TABLE RLS FIX FOR ADMIN REGISTRATION
-- Run this once in Supabase SQL Editor
-- ============================================================================

-- Ensure RLS is enabled
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert their own profile row
DROP POLICY IF EXISTS "users_insert_own_profile" ON public.users;
CREATE POLICY "users_insert_own_profile"
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (auth_id = (select auth.uid()));

-- Allow authenticated users to update only their own profile row
DROP POLICY IF EXISTS "users_update_own_profile" ON public.users;
CREATE POLICY "users_update_own_profile"
ON public.users
FOR UPDATE
TO authenticated
USING (auth_id = (select auth.uid()))
WITH CHECK (auth_id = (select auth.uid()));

-- Existing select policy can stay as-is; this adds missing INSERT/UPDATE permissions.
-- ============================================================================
