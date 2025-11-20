-- Migration: Add clinical_notes and appointment_id columns to transcriptions table
-- Links transcriptions to appointments and allows clinicians to add clinical notes

-- Add clinical_notes column
ALTER TABLE transcriptions
ADD COLUMN IF NOT EXISTS clinical_notes TEXT;

-- Add appointment_id column with foreign key
ALTER TABLE transcriptions
ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;

-- Add comments
COMMENT ON COLUMN transcriptions.clinical_notes IS 'Clinical notes added by the clinician';
COMMENT ON COLUMN transcriptions.appointment_id IS 'Link to the appointment this transcription is associated with';

-- Add index for faster lookups by appointment
CREATE INDEX IF NOT EXISTS idx_transcriptions_appointment_id ON transcriptions(appointment_id)
WHERE appointment_id IS NOT NULL;











