-- Work Schedules Schema para sa Team Leaders
-- Supervisor lang ang puwede mag-manage ng schedules ng team leaders nila

CREATE TABLE IF NOT EXISTS work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday, 1=Monday, etc.
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN DEFAULT true,
  effective_date DATE, -- Optional: kung kelan magsisimula ang schedule
  expiry_date DATE, -- Optional: kung kelan mag-e-expire
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK (end_time > start_time) -- Ensure end time is after start time
);

-- Enable Row Level Security
ALTER TABLE work_schedules ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view their own schedules" ON work_schedules;
DROP POLICY IF EXISTS "Supervisors can view team leader schedules" ON work_schedules;
DROP POLICY IF EXISTS "Supervisors can manage team leader schedules" ON work_schedules;
DROP POLICY IF EXISTS "Service role can do everything on schedules" ON work_schedules;
DROP POLICY IF EXISTS "Consolidated SELECT policy for work schedules" ON work_schedules;

-- OPTIMIZED POLICIES (consolidated to avoid multiple permissive policies)
-- Consolidated SELECT policy for all roles (single permissive policy)
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

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_work_schedules_updated_at ON work_schedules;
CREATE TRIGGER update_work_schedules_updated_at
  BEFORE UPDATE ON work_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_work_schedules_user_id ON work_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_work_schedules_day_of_week ON work_schedules(day_of_week);
CREATE INDEX IF NOT EXISTS idx_work_schedules_active ON work_schedules(is_active);
CREATE INDEX IF NOT EXISTS idx_work_schedules_user_day ON work_schedules(user_id, day_of_week, is_active);

