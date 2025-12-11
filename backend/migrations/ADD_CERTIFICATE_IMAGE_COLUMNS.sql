-- Add missing image columns to certificate_templates table
-- Run this in Supabase SQL Editor

-- Add background image columns
ALTER TABLE certificate_templates 
ADD COLUMN IF NOT EXISTS background_image_url TEXT,
ADD COLUMN IF NOT EXISTS use_background_mode BOOLEAN DEFAULT false;

-- Add text positioning for background mode
ALTER TABLE certificate_templates 
ADD COLUMN IF NOT EXISTS text_positions JSONB DEFAULT '[]'::jsonb;

-- Add image URL columns
ALTER TABLE certificate_templates 
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS logo_position JSONB,
ADD COLUMN IF NOT EXISTS header_image_url TEXT,
ADD COLUMN IF NOT EXISTS footer_image_url TEXT,
ADD COLUMN IF NOT EXISTS signature_image_url TEXT,
ADD COLUMN IF NOT EXISTS signature_position JSONB;

-- Verify columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'certificate_templates' 
AND column_name IN (
  'background_image_url', 
  'use_background_mode', 
  'text_positions',
  'logo_url',
  'logo_position',
  'header_image_url',
  'footer_image_url',
  'signature_image_url',
  'signature_position'
)
ORDER BY column_name;

