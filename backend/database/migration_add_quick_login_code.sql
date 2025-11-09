-- Migration: Add quick_login_code field to users table
-- Optimized: Unique constraint + index for fast lookups

-- Add quick_login_code column
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS quick_login_code TEXT;

-- Create unique constraint (prevents duplicates, enables fast lookups)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_quick_login_code_unique'
  ) THEN
    ALTER TABLE users 
    ADD CONSTRAINT users_quick_login_code_unique UNIQUE (quick_login_code);
  END IF;
END $$;

-- Create index for optimized queries (covers quick_login_code lookup)
CREATE INDEX IF NOT EXISTS idx_users_quick_login_code ON users(quick_login_code) 
WHERE quick_login_code IS NOT NULL;

-- Create composite index for role + code queries (optimizes worker-only lookups)
CREATE INDEX IF NOT EXISTS idx_users_quick_login_code_role ON users(quick_login_code, role) 
WHERE quick_login_code IS NOT NULL AND role = 'worker';

-- Add comment
COMMENT ON COLUMN users.quick_login_code IS '6-digit unique code for quick login (workers only). No expiration - permanent code.';

