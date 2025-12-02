/**
 * Shared TypeScript types for incident-related components
 * Centralized type definitions to avoid duplication
 */

export interface AiAnalysisResult {
  summary?: string
  riskLevel?: string
  recommendations?: string[]
  injuryType?: string
  bodyPart?: string
  [key: string]: any
}

export interface IncidentData {
  photoUrl?: string | null
  aiAnalysis?: AiAnalysisResult | null
}

