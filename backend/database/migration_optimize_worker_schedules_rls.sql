-- Migration to optimize RLS policies for worker_schedules table
-- Fixes: Multiple permissive policies issue for SELECT operations
-- Run this in Supabase SQL Editor

BEGIN;

-- Drop all existing policies
DROP POLICY IF EXISTS "Team leaders can view worker schedules in their team" ON worker_schedules;
DROP POLICY IF EXISTS "Team leaders can manage worker schedules in their team" ON worker_schedules;
DROP POLICY IF EXISTS "Workers can view their own schedules" ON worker_schedules;
DROP POLICY IF EXISTS "Supervisors can view worker schedules in their teams" ON worker_schedules;
DROP POLICY IF EXISTS "Service role can do everything on worker schedules" ON worker_schedules;

-- OPTIMIZED POLICIES
-- Consolidated SELECT policy for all roles (single permissive policy)
-- This reduces evaluation overhead by combining all SELECT conditions into one policy

CREATE POLICY "Consolidated SELECT policy for worker schedules"
  ON worker_schedules FOR SELECT
  USING (
    -- Workers can view their own schedules
    auth.uid() = worker_id
    OR
    -- Team leaders can view schedules in their team
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = worker_schedules.team_id
      AND teams.team_leader_id = auth.uid()
    )
    OR
    -- Supervisors can view schedules in their teams
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = worker_schedules.team_id
      AND teams.supervisor_id = auth.uid()
    )
  );

-- Team leaders can INSERT/UPDATE/DELETE schedules in their team
-- Separated from SELECT to avoid overlap
CREATE POLICY "Team leaders can manage worker schedules in their team"
  ON worker_schedules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = worker_schedules.team_id
      AND teams.team_leader_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = worker_schedules.team_id
      AND teams.team_leader_id = auth.uid()
    )
  );

-- Note: Service role bypasses RLS by default in Supabase, so no separate policy needed
-- If your setup requires explicit service_role policy, uncomment below:
-- CREATE POLICY "Service role can do everything on worker schedules"
--   ON worker_schedules FOR ALL
--   USING (auth.role() = 'service_role');

COMMIT;

-- Verify policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'worker_schedules'
ORDER BY policyname;

