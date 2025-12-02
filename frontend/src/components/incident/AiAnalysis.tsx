/**
 * AiAnalysis Component
 * 
 * Reusable component for displaying AI incident analysis
 * Used across: Worker My Accidents, WHS Control Center, Clinician Cases
 * 
 * Features:
 * - Risk level indicator (High/Medium/Low)
 * - Summary text
 * - Injury type and body part
 * - Recommendations list
 * - Beautiful gradient design
 */

import type { AiAnalysisResult } from './types'
import './AiAnalysis.css'

interface AiAnalysisProps {
  analysis: AiAnalysisResult | null | undefined
}

export function AiAnalysis({ analysis }: AiAnalysisProps) {
  // Don't render if no analysis data
  if (!analysis) {
    return null
  }
  const getRiskLevelColors = (riskLevel: string) => {
    const level = riskLevel.toLowerCase()
    if (level === 'high') {
      return { background: '#FEE2E2', color: '#DC2626' }
    }
    if (level === 'medium') {
      return { background: '#FEF3C7', color: '#D97706' }
    }
    return { background: '#D1FAE5', color: '#059669' }
  }

  return (
    <div className="case-info-section ai-analysis-section">
      <h3 className="case-section-header">
        <span className="ai-analysis-header-content">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"></path>
            <path d="M16 10v1a4 4 0 0 1-8 0v-1"></path>
            <rect x="3" y="14" width="18" height="8" rx="2"></rect>
            <line x1="7" y1="18" x2="7" y2="18"></line>
            <line x1="12" y1="18" x2="12" y2="18"></line>
            <line x1="17" y1="18" x2="17" y2="18"></line>
          </svg>
          AI ANALYSIS
        </span>
      </h3>
      <div className="case-info-divider"></div>
      <div className="ai-analysis-container">
        <div className="ai-analysis-content">
          
          {/* Risk Level Badge */}
          {analysis.riskLevel && (
            <div className="ai-analysis-risk-badge-container">
              <span 
                className="ai-analysis-risk-badge"
                style={getRiskLevelColors(analysis.riskLevel)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                Risk Level: {analysis.riskLevel}
              </span>
            </div>
          )}

          {/* Summary */}
          {analysis.summary && (
            <div className="ai-analysis-section-block">
              <h4 className="ai-analysis-section-title">Summary</h4>
              <p className="ai-analysis-summary-text">
                {analysis.summary}
              </p>
            </div>
          )}

          {/* Injury Details */}
          {(analysis.injuryType || analysis.bodyPart) && (
            <div className="ai-analysis-details-grid">
              {analysis.injuryType && (
                <div className="ai-analysis-detail-card">
                  <span className="ai-analysis-detail-label">Injury Type</span>
                  <p className="ai-analysis-detail-value">{analysis.injuryType}</p>
                </div>
              )}
              {analysis.bodyPart && (
                <div className="ai-analysis-detail-card">
                  <span className="ai-analysis-detail-label">Body Part</span>
                  <p className="ai-analysis-detail-value">{analysis.bodyPart}</p>
                </div>
              )}
            </div>
          )}

          {/* Recommendations */}
          {analysis.recommendations && analysis.recommendations.length > 0 && (
            <div className="ai-analysis-section-block">
              <h4 className="ai-analysis-section-title">Recommendations</h4>
              <ul className="ai-analysis-recommendations-list">
                {analysis.recommendations.map((rec: string, index: number) => (
                  <li key={index} className="ai-analysis-recommendation-item">
                    <span className="ai-analysis-recommendation-number">
                      {index + 1}
                    </span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

