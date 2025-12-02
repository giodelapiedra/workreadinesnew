-- Migration: Add clinician summary and recommendations fields
-- This allows clinicians to provide worker-visible summaries and recommendations
-- while keeping detailed clinical notes private

-- Add clinician_summary column (TEXT)
ALTER TABLE worker_exceptions
ADD COLUMN IF NOT EXISTS clinician_summary TEXT;

-- Add clinician_recommendations column (TEXT)
ALTER TABLE worker_exceptions
ADD COLUMN IF NOT EXISTS clinician_recommendations TEXT;

-- Add clinician_name column (VARCHAR) - to display who created the summary
ALTER TABLE worker_exceptions
ADD COLUMN IF NOT EXISTS clinician_name VARCHAR(255);

-- Add clinician_summary_updated_at column (TIMESTAMP)
ALTER TABLE worker_exceptions
ADD COLUMN IF NOT EXISTS clinician_summary_updated_at TIMESTAMP WITH TIME ZONE;

-- Add comments to columns
COMMENT ON COLUMN worker_exceptions.clinician_summary IS 'Worker-visible summary of the case assessment by the clinician';
COMMENT ON COLUMN worker_exceptions.clinician_recommendations IS 'Worker-visible recommendations from the clinician (e.g., treatment plan, restrictions, follow-up)';
COMMENT ON COLUMN worker_exceptions.clinician_name IS 'Name of the clinician who created/updated the summary and recommendations';
COMMENT ON COLUMN worker_exceptions.clinician_summary_updated_at IS 'Timestamp when the summary and recommendations were last updated';

-- Add indexes for faster queries when filtering by clinician_summary_updated_at
CREATE INDEX IF NOT EXISTS idx_worker_exceptions_clinician_summary_updated_at 
ON worker_exceptions(clinician_summary_updated_at) 
WHERE clinician_summary_updated_at IS NOT NULL;

-- Add index for faster lookups when filtering by clinician_name
CREATE INDEX IF NOT EXISTS idx_worker_exceptions_clinician_name 
ON worker_exceptions(clinician_name) 
WHERE clinician_name IS NOT NULL;

