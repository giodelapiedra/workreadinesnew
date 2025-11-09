-- Migration to optimize RLS policies for work_schedules table
-- Fixes: Multiple permissive policies issue for SELECT operations
-- This table stores recurring schedules for team leaders (by day of week)
-- Run this in Supabase SQL Editor

BEGIN;

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can view their own schedules" ON work_schedules;
DROP POLICY IF EXISTS "Supervisors can view team leader schedules" ON work_schedules;
DROP POLICY IF EXISTS "Supervisors can manage team leader schedules" ON work_schedules;
DROP POLICY IF EXISTS "Service role can do everything on schedules" ON work_schedules;

-- OPTIMIZED POLICIES
-- Consolidated SELECT policy for all roles (single permissive policy)
-- This reduces evaluation overhead by combining all SELECT conditions into one policy

CREATE POLICY "Consolidated SELECT policy for work schedules"
  ON work_schedules FOR SELECT
  USING (
    -- Users (team leaders) can view their own schedules
    auth.uid() = user_id
    OR
    -- Supervisors can view schedules of their team leaders
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.supervisor_id = auth.uid()
      AND teams.team_leader_id = work_schedules.user_id
    )
  );

-- Supervisors can INSERT/UPDATE/DELETE schedules of their team leaders
-- Separated from SELECT to avoid overlap
CREATE POLICY "Supervisors can manage team leader schedules"
  ON work_schedules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.supervisor_id = auth.uid()
      AND teams.team_leader_id = work_schedules.user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.supervisor_id = auth.uid()
      AND teams.team_leader_id = work_schedules.user_id
    )
  );

-- Note: Service role bypasses RLS by default in Supabase, so no separate policy needed
-- If your setup requires explicit service_role policy, uncomment below:
-- CREATE POLICY "Service role can do everything on schedules"
--   ON work_schedules FOR ALL
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
WHERE tablename = 'work_schedules'
ORDER BY policyname;

