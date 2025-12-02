/**
 * Migration: Add Incident Approval Workflow
 * 
 * Purpose: Add approval workflow for worker-submitted incidents
 * - Team Leader must approve before exception is created
 * - Tracks approval status, approver, and rejection reasons
 * 
 * Date: 2025-11-28
 */

-- Add approval workflow columns to incidents table
ALTER TABLE incidents 
ADD COLUMN IF NOT EXISTS approval_status VARCHAR(50) DEFAULT 'pending_approval',
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Add check constraint for valid approval statuses
ALTER TABLE incidents 
DROP CONSTRAINT IF EXISTS incidents_approval_status_check;

ALTER TABLE incidents 
ADD CONSTRAINT incidents_approval_status_check 
CHECK (approval_status IN ('pending_approval', 'approved', 'rejected', 'auto_approved'));

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_incidents_approval_status 
ON incidents(approval_status);

CREATE INDEX IF NOT EXISTS idx_incidents_team_pending 
ON incidents(team_id, approval_status) 
WHERE approval_status = 'pending_approval';

CREATE INDEX IF NOT EXISTS idx_incidents_approved_by 
ON incidents(approved_by) 
WHERE approved_by IS NOT NULL;

-- Update existing incidents to 'auto_approved' status
-- These are incidents created before approval workflow was implemented
UPDATE incidents 
SET approval_status = 'auto_approved' 
WHERE approval_status IS NULL OR approval_status = 'pending_approval';

-- Add comment to table
COMMENT ON COLUMN incidents.approval_status IS 'Approval workflow status: pending_approval, approved, rejected, auto_approved';
COMMENT ON COLUMN incidents.approved_by IS 'User ID who approved or rejected the incident (typically Team Leader)';
COMMENT ON COLUMN incidents.approved_at IS 'Timestamp when incident was approved or rejected';
COMMENT ON COLUMN incidents.rejection_reason IS 'Reason provided when incident is rejected';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Incident approval workflow migration completed successfully';
  RAISE NOTICE '   - Added approval_status, approved_by, approved_at, rejection_reason columns';
  RAISE NOTICE '   - Created indexes for efficient querying';
  RAISE NOTICE '   - Updated existing incidents to auto_approved status';
END $$;

