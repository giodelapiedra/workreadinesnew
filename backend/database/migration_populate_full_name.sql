-- Migration to populate full_name for existing users
-- Run this in Supabase SQL Editor
-- This will set full_name to email prefix (part before @) for users who don't have a name

-- Update existing users: set full_name to email prefix if null or empty
UPDATE users 
SET full_name = SPLIT_PART(email, '@', 1)
WHERE full_name IS NULL OR full_name = '';

-- Verify the update
SELECT 
  id,
  email,
  full_name,
  role
FROM users
ORDER BY created_at DESC
LIMIT 10;

-- Show count of users with and without full_name
SELECT 
  CASE 
    WHEN full_name IS NULL OR full_name = '' THEN 'No Name'
    ELSE 'Has Name'
  END as status,
  COUNT(*) as count
FROM users
GROUP BY status;












































