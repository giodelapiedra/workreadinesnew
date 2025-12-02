/**
 * Migration: Add Incident Approval Notification Types
 * 
 * Purpose: Update notifications.type CHECK constraint to include new types:
 * - incident_approval_needed: Team Leader receives when worker submits incident
 * - incident_approved: Worker receives when Team Leader approves
 * - incident_rejected: Worker receives when Team Leader rejects
 * 
 * Date: 2025-11-28
 */

-- Drop existing check constraint
ALTER TABLE notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

-- Add updated check constraint with ALL notification types (existing + new)
ALTER TABLE notifications 
ADD CONSTRAINT notifications_type_check 
CHECK (
  (type)::text = ANY (
    ARRAY[
      'incident_assigned'::character varying,
      'case_updated'::character varying,
      'case_closed'::character varying,
      'system'::character varying,
      'worker_not_fit_to_work'::character varying,
      'case_assigned_to_clinician'::character varying,
      'incident_approval_needed'::character varying,   -- NEW: Team Leader notification
      'incident_approved'::character varying,           -- NEW: Worker approval notification
      'incident_rejected'::character varying            -- NEW: Worker rejection notification
    ]::text[]
  )
);

-- Update comments
COMMENT ON COLUMN notifications.type IS 'Type of notification: incident_assigned, case_updated, case_closed, system, worker_not_fit_to_work, case_assigned_to_clinician, incident_approval_needed, incident_approved, incident_rejected';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Incident notification types migration completed';
  RAISE NOTICE '   - Added incident_approval_needed type for Team Leader notifications';
  RAISE NOTICE '   - Added incident_approved type for worker approval notifications';
  RAISE NOTICE '   - Added incident_rejected type for worker rejection notifications';
  RAISE NOTICE '   - Total notification types: 9';
END $$;
