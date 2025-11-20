-- Migration to add full_name and phone columns to users table
-- Run this in Supabase SQL Editor

-- Add full_name column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'full_name') THEN
    ALTER TABLE users ADD COLUMN full_name TEXT;
    RAISE NOTICE 'Added full_name column to users table';
  ELSE
    RAISE NOTICE 'full_name column already exists';
  END IF;
END $$;

-- Add phone column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'phone') THEN
    ALTER TABLE users ADD COLUMN phone TEXT;
    RAISE NOTICE 'Added phone column to users table';
  ELSE
    RAISE NOTICE 'phone column already exists';
  END IF;
END $$;

-- Update existing users: set full_name to email prefix if null
UPDATE users 
SET full_name = SPLIT_PART(email, '@', 1)
WHERE full_name IS NULL OR full_name = '';

-- Verify the columns were added
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'users' 
  AND column_name IN ('full_name', 'phone');












































