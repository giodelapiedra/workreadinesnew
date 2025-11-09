-- Migration: Add login_method and notes fields to login_logs table
-- This allows tracking how users logged in (email/password, quick_login_code, etc.)

-- Add login_method column (optional - tracks how user logged in)
ALTER TABLE login_logs 
ADD COLUMN IF NOT EXISTS login_method TEXT;

-- Add notes column (optional - for additional login details)
ALTER TABLE login_logs 
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Make email nullable for failed login attempts
ALTER TABLE login_logs 
ALTER COLUMN email DROP NOT NULL;

-- Make user_id nullable for failed login attempts
ALTER TABLE login_logs 
ALTER COLUMN user_id DROP NOT NULL;

-- Create index for login_method queries
CREATE INDEX IF NOT EXISTS idx_login_logs_login_method ON login_logs(login_method);

-- Add comment
COMMENT ON COLUMN login_logs.login_method IS 'Method used to login: email_password, quick_login_code, etc.';
COMMENT ON COLUMN login_logs.notes IS 'Additional notes about the login attempt (e.g., failed attempts, errors)';

