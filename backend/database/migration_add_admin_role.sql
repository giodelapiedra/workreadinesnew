-- Migration to add 'admin' role to users table constraint
-- Run this in Supabase SQL Editor

BEGIN;

-- Step 1: Drop the existing constraint
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

-- Step 2: Add the new constraint with 'admin' role included
ALTER TABLE public.users 
  ADD CONSTRAINT users_role_check 
  CHECK (role IN ('worker', 'supervisor', 'whs_control_center', 'executive', 'clinician', 'team_leader', 'admin'));

-- Step 3: Verify the constraint was created correctly
SELECT 
  conname, 
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conrelid = 'public.users'::regclass 
  AND contype = 'c' 
  AND conname = 'users_role_check';

COMMIT;

-- After running, verify with:
-- SELECT DISTINCT role FROM users;
-- The constraint should now allow 'admin' as a valid role

