-- Migration: Add AI Analysis Reports table
-- Stores saved AI analysis reports for executives

CREATE TABLE IF NOT EXISTS ai_analysis_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executive_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_title TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'predictive_analytics' CHECK (report_type IN ('predictive_analytics', 'custom')),
  
  -- Period covered by the report
  period_start_date DATE NOT NULL,
  period_end_date DATE NOT NULL,
  
  -- Summary data
  summary JSONB NOT NULL,
  
  -- AI Analysis content
  analysis JSONB NOT NULL,
  
  -- Analytics data snapshot
  analytics_snapshot JSONB,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT period_dates_valid CHECK (period_end_date >= period_start_date),
  CONSTRAINT report_title_not_empty CHECK (length(trim(report_title)) > 0)
);

COMMENT ON TABLE ai_analysis_reports IS 'Stores AI-generated analysis reports for executives';
COMMENT ON COLUMN ai_analysis_reports.executive_id IS 'Executive who generated this report';
COMMENT ON COLUMN ai_analysis_reports.report_title IS 'Title of the report (auto-generated or custom)';
COMMENT ON COLUMN ai_analysis_reports.report_type IS 'Type of report: predictive_analytics or custom';
COMMENT ON COLUMN ai_analysis_reports.period_start_date IS 'Start date of the analysis period';
COMMENT ON COLUMN ai_analysis_reports.period_end_date IS 'End date of the analysis period';
COMMENT ON COLUMN ai_analysis_reports.summary IS 'JSON object containing summary metrics (totalWorkers, activeWorkers, atRiskWorkers, avgRiskScore)';
COMMENT ON COLUMN ai_analysis_reports.analysis IS 'JSON object containing AI analysis (executiveSummary, keyInsights, riskPredictions, etc.)';
COMMENT ON COLUMN ai_analysis_reports.analytics_snapshot IS 'Optional: Full analytics data snapshot for reference';

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_ai_reports_executive_id ON ai_analysis_reports(executive_id);
CREATE INDEX IF NOT EXISTS idx_ai_reports_created_at ON ai_analysis_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reports_executive_created ON ai_analysis_reports(executive_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reports_period ON ai_analysis_reports(period_start_date, period_end_date);

-- Add RLS policies
ALTER TABLE ai_analysis_reports ENABLE ROW LEVEL SECURITY;

-- Executives can view their own reports
CREATE POLICY "Executives can view their own reports"
  ON ai_analysis_reports FOR SELECT
  USING (auth.uid() = executive_id);

-- Executives can insert their own reports
CREATE POLICY "Executives can insert their own reports"
  ON ai_analysis_reports FOR INSERT
  WITH CHECK (auth.uid() = executive_id);

-- Executives can delete their own reports
CREATE POLICY "Executives can delete their own reports"
  ON ai_analysis_reports FOR DELETE
  USING (auth.uid() = executive_id);

-- Service role can do everything
CREATE POLICY "Service role can manage all reports"
  ON ai_analysis_reports FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Add updated_at trigger
CREATE TRIGGER update_ai_reports_updated_at
  BEFORE UPDATE ON ai_analysis_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

