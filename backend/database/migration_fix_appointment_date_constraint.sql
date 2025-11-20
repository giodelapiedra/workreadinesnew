-- Migration: Fix appointment_date_not_past constraint
-- Allow past dates for completed, cancelled, or declined appointments
-- Only prevent past dates for pending or confirmed appointments

-- Drop the old constraint
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointment_date_not_past;

-- Add new constraint that allows past dates for completed/cancelled/declined appointments
ALTER TABLE appointments ADD CONSTRAINT appointment_date_not_past 
  CHECK (
    appointment_date >= CURRENT_DATE::date 
    OR status IN ('completed', 'cancelled', 'declined')
  );

COMMENT ON CONSTRAINT appointment_date_not_past ON appointments IS 
  'Prevents past dates for pending/confirmed appointments, but allows past dates for completed/cancelled/declined appointments';

