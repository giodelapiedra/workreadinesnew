-- Certificate Templates Table
-- Stores reusable certificate templates that WHS can customize
CREATE TABLE IF NOT EXISTS certificate_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  template_type VARCHAR(50) NOT NULL, -- 'return_to_work', 'clearance', 'medical_fit', 'custom'
  
  -- Template Content (HTML with placeholders OR background image mode)
  html_content TEXT NOT NULL,
  
  -- Background Template Image (uploaded certificate design)
  background_image_url TEXT, -- Full certificate background/template image
  use_background_mode BOOLEAN DEFAULT false, -- If true, use background image instead of HTML
  
  -- Text overlay positions (for background mode)
  -- JSON: [{"field": "worker_name", "x": 100, "y": 200, "fontSize": 24, "color": "#000", "fontFamily": "Arial"}]
  text_positions JSONB DEFAULT '[]'::jsonb,
  
  -- Template Images (logo, header, footer, signature)
  logo_url TEXT, -- Company/WHS logo
  logo_position JSONB, -- {"x": 50, "y": 50, "width": 100, "height": 100}
  header_image_url TEXT, -- Header banner image
  footer_image_url TEXT, -- Footer image
  signature_image_url TEXT, -- WHS officer signature
  signature_position JSONB -- {"x": 100, "y": 800, "width": 150, "height": 50}
  
  -- Available placeholders for this template
  -- JSON array: ["{{worker_name}}", "{{date}}", "{{case_id}}", etc.]
  placeholders JSONB DEFAULT '[]'::jsonb,
  
  -- Styling options
  styles JSONB DEFAULT '{}'::jsonb, -- { "fontSize": "14px", "fontFamily": "Arial", "primaryColor": "#000" }
  
  -- Template settings
  page_size VARCHAR(20) DEFAULT 'A4', -- 'A4', 'Letter', etc.
  orientation VARCHAR(20) DEFAULT 'portrait', -- 'portrait', 'landscape'
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false, -- One default template per type
  
  -- Metadata
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Generated Certificates Table
-- Stores certificates generated from templates for specific cases/workers
CREATE TABLE IF NOT EXISTS generated_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Template reference
  template_id UUID REFERENCES certificate_templates(id) ON DELETE SET NULL,
  template_name VARCHAR(255) NOT NULL, -- Store template name in case template is deleted
  
  -- Case/Worker reference
  case_id UUID REFERENCES worker_exceptions(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worker_name VARCHAR(255) NOT NULL,
  
  -- Generated content
  html_content TEXT NOT NULL, -- Rendered HTML with actual data
  pdf_url TEXT, -- URL to stored PDF (if we implement cloud storage)
  
  -- Certificate data (snapshot of data used to generate)
  certificate_data JSONB DEFAULT '{}'::jsonb,
  
  -- Metadata
  generated_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Audit trail
  is_voided BOOLEAN DEFAULT false,
  voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_certificate_templates_type ON certificate_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_certificate_templates_active ON certificate_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_certificate_templates_created_by ON certificate_templates(created_by);

CREATE INDEX IF NOT EXISTS idx_generated_certificates_case ON generated_certificates(case_id);
CREATE INDEX IF NOT EXISTS idx_generated_certificates_worker ON generated_certificates(worker_id);
CREATE INDEX IF NOT EXISTS idx_generated_certificates_template ON generated_certificates(template_id);
CREATE INDEX IF NOT EXISTS idx_generated_certificates_generated_at ON generated_certificates(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_certificates_generated_by ON generated_certificates(generated_by);

-- RLS Policies for certificate_templates
ALTER TABLE certificate_templates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "WHS can view certificate templates" ON certificate_templates;
DROP POLICY IF EXISTS "WHS can create certificate templates" ON certificate_templates;
DROP POLICY IF EXISTS "WHS can update certificate templates" ON certificate_templates;
DROP POLICY IF EXISTS "WHS can delete certificate templates" ON certificate_templates;

-- WHS can view all templates
CREATE POLICY "WHS can view certificate templates"
  ON certificate_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- WHS can create templates
CREATE POLICY "WHS can create certificate templates"
  ON certificate_templates FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- WHS can update templates
CREATE POLICY "WHS can update certificate templates"
  ON certificate_templates FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- WHS can delete templates
CREATE POLICY "WHS can delete certificate templates"
  ON certificate_templates FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- RLS Policies for generated_certificates
ALTER TABLE generated_certificates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view generated certificates" ON generated_certificates;
DROP POLICY IF EXISTS "Workers can view their own certificates" ON generated_certificates;
DROP POLICY IF EXISTS "WHS can create certificates" ON generated_certificates;
DROP POLICY IF EXISTS "WHS can update certificates" ON generated_certificates;

-- WHS and related users can view certificates
CREATE POLICY "Users can view generated certificates"
  ON generated_certificates FOR SELECT
  USING (
    auth.uid() = worker_id OR 
    auth.uid() = generated_by OR
    auth.uid() IN (
      SELECT id FROM users WHERE role IN ('whs_control_center', 'clinician', 'supervisor', 'team_leader')
    )
  );

-- Workers can view their own certificates
CREATE POLICY "Workers can view their own certificates"
  ON generated_certificates FOR SELECT
  USING (worker_id = auth.uid());

-- WHS can create certificates
CREATE POLICY "WHS can create certificates"
  ON generated_certificates FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- WHS can update certificates (e.g., void them)
CREATE POLICY "WHS can update certificates"
  ON generated_certificates FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Default Return to Work Certificate Template
INSERT INTO certificate_templates (
  name,
  description,
  template_type,
  html_content,
  placeholders,
  styles,
  is_default
) VALUES (
  'Return to Work Certificate',
  'Standard certificate for workers cleared to return to work',
  'return_to_work',
  '<div style="font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 40px;">
      {{logo_image}}
      <h1 style="color: #1976d2; margin: 20px 0 0 0;">RETURN TO WORK CERTIFICATE</h1>
      <p style="color: #666; margin-top: 10px;">Work Health & Safety</p>
    </div>
    {{header_image}}
    
    <div style="border: 2px solid #1976d2; padding: 30px; border-radius: 8px;">
      <p style="font-size: 16px; line-height: 1.8;">
        This is to certify that:
      </p>
      
      <div style="margin: 30px 0; padding: 20px; background: #f5f5f5; border-radius: 4px;">
        <p style="font-size: 18px; font-weight: bold; margin: 0;">{{worker_name}}</p>
        <p style="color: #666; margin: 5px 0 0 0;">Employee ID: {{worker_id}}</p>
      </div>
      
      <p style="font-size: 16px; line-height: 1.8;">
        Has been medically assessed and is cleared to return to work with the following conditions:
      </p>
      
      <div style="margin: 20px 0; padding: 20px; background: #fff3e0; border-left: 4px solid #ff9800;">
        <p style="margin: 0;"><strong>Duty Type:</strong> {{duty_type}}</p>
        <p style="margin: 10px 0 0 0;"><strong>Return Date:</strong> {{return_date}}</p>
        <p style="margin: 10px 0 0 0;"><strong>Case Reference:</strong> {{case_reference}}</p>
      </div>
      
      <p style="font-size: 14px; line-height: 1.8; color: #666; margin-top: 30px;">
        {{additional_notes}}
      </p>
    </div>
    
    <div style="margin-top: 50px; padding-top: 30px; border-top: 1px solid #ddd;">
      <div style="display: flex; justify-content: space-between; align-items: flex-end;">
        <div>
          {{signature_image}}
          <p style="margin: 10px 0 0 0; font-weight: bold;">{{whs_name}}</p>
          <p style="margin: 5px 0 0 0; color: #666;">WHS Officer</p>
        </div>
        <div style="text-align: right;">
          <p style="margin: 0; font-weight: bold;">{{issue_date}}</p>
          <p style="margin: 5px 0 0 0; color: #666;">Issue Date</p>
        </div>
      </div>
    </div>
    {{footer_image}}
  </div>',
  '["{{worker_name}}", "{{worker_id}}", "{{duty_type}}", "{{return_date}}", "{{case_reference}}", "{{additional_notes}}", "{{whs_name}}", "{{issue_date}}", "{{logo_image}}", "{{header_image}}", "{{footer_image}}", "{{signature_image}}"]'::jsonb,
  '{"fontSize": "14px", "fontFamily": "Arial, sans-serif", "primaryColor": "#1976d2"}'::jsonb,
  true
)
ON CONFLICT DO NOTHING;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_certificate_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS certificate_templates_updated_at ON certificate_templates;
CREATE TRIGGER certificate_templates_updated_at
  BEFORE UPDATE ON certificate_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_certificate_templates_updated_at();

CREATE OR REPLACE FUNCTION update_generated_certificates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generated_certificates_updated_at ON generated_certificates;
CREATE TRIGGER generated_certificates_updated_at
  BEFORE UPDATE ON generated_certificates
  FOR EACH ROW
  EXECUTE FUNCTION update_generated_certificates_updated_at();
