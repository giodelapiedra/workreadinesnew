/**
 * OpenAI API Utility - Optimized for Cost Efficiency
 * Uses GPT-3.5-turbo for cost-effective analysis
 */

interface AnalyzeIncidentParams {
  type: 'incident' | 'near_miss'
  description: string
  location: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  date: string
  photo?: File // Optional photo for image analysis
}

interface AnalysisResult {
  summary: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  recommendations: string[]
  severityAssessment: string
  followUpActions: string[]
  advice: string // Advice/suggestions based on description
}

interface AnalyzeTranscriptionParams {
  transcription: string
  context?: string // Optional context (e.g., case number, worker name)
}

interface TranscriptionAnalysisResult {
  summary: string
  keyPoints: string[]
  clinicalNotes: string
  recommendations: string[]
  actionItems: string[]
}

interface PredictiveAnalyticsData {
  summary: {
    totalWorkers: number
    activeWorkers: number
    atRiskWorkers: number
    avgRiskScore: number
  }
  riskIndicators: Array<{
    type: string
    label: string
    count: number
    severity: 'low' | 'medium' | 'high' | 'critical'
  }>
  topRiskWorkers: Array<{
    workerName: string
    teamName: string
    siteLocation: string | null
    riskScore: number
    redPercentage: number
    avgPain: number
    avgFatigue: number
    avgSleep: number
    avgStress: number
  }>
  topRiskTeams: Array<{
    teamName: string
    siteLocation: string | null
    avgRiskScore: number
    workerCount: number
    atRiskWorkers: number
    highRiskWorkers: number
  }>
  readinessTrends: Array<{
    date: string
    green: number
    amber: number
    red: number
  }>
  period: {
    startDate: string
    endDate: string
  }
}

interface PredictiveAnalyticsAnalysisResult {
  executiveSummary: string
  keyInsights: string[]
  riskPredictions: string[]
  actionableRecommendations: string[]
  priorityActions: string[]
  trendAnalysis: string
  organizationalImpact: string
  highRiskTeams: string[]
  topWorkersConcern: string
}

/**
 * Analyze incident report using OpenAI API
 * Optimized for cost: Uses GPT-3.5-turbo for text, GPT-4o for images
 */
export async function analyzeIncident(params: AnalyzeIncidentParams): Promise<AnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  // Import OpenAI dynamically to avoid issues if package not installed
  const { OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey })

  // Optimized prompt - concise to minimize tokens
  const systemPrompt = `You are an expert clinician specializing in workplace safety and occupational health. Analyze incident reports from a medical and clinical perspective. Provide professional clinical advice, assessment, and recommendations. Respond in JSON format:
{
  "summary": "Brief 2-sentence clinical summary",
  "riskLevel": "low|medium|high|critical",
  "recommendations": ["3-4 brief clinical recommendations"],
  "severityAssessment": "One sentence clinical assessment of severity",
  "followUpActions": ["2-3 specific clinical follow-up actions"],
  "advice": "Expert clinician advice and medical recommendations based on the description (2-3 sentences)"
}`

  const userPrompt = `As an expert clinician, analyze this workplace incident report:

Report Type: ${params.type === 'incident' ? 'Incident' : 'Near-Miss'}
Severity: ${params.severity.toUpperCase()}
Date: ${params.date}
Location: ${params.location}
Description: ${params.description}
${params.photo ? '\n[Image attached - analyze the photo for visual evidence of the incident, injuries, hazards, or safety concerns]' : ''}

Provide your clinical assessment, medical recommendations, and professional advice.${params.photo ? ' Include observations from the image analysis.' : ''}`

  try {
    // Prepare messages array
    const messages: any[] = [
      { role: 'system', content: systemPrompt }
    ]

    // If photo is provided, use vision model with image
    if (params.photo) {
      try {
        // Convert File to base64 for OpenAI Vision API
        const arrayBuffer = await params.photo.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const base64Image = buffer.toString('base64')
        const mimeType = params.photo.type || 'image/jpeg'

        // Use GPT-4o for vision (more cost-effective than gpt-4-vision-preview)
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: userPrompt
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        })

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o', // Vision-capable model
          messages,
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: 'json_object' }
        })

        const content = completion.choices[0]?.message?.content
        if (!content) {
          throw new Error('No response from OpenAI')
        }

        const analysis = JSON.parse(content) as AnalysisResult

        // Validate and sanitize response
        return {
          summary: analysis.summary || 'Analysis completed with image review',
          riskLevel: ['low', 'medium', 'high', 'critical'].includes(analysis.riskLevel?.toLowerCase())
            ? analysis.riskLevel.toLowerCase() as 'low' | 'medium' | 'high' | 'critical'
            : params.severity,
          recommendations: Array.isArray(analysis.recommendations) 
            ? analysis.recommendations.slice(0, 4)
            : ['Conduct clinical assessment with healthcare provider', 'Monitor for signs of injury or complications', 'Follow workplace safety protocols'],
          severityAssessment: analysis.severityAssessment || 'Clinical assessment pending - please review severity classification',
          followUpActions: Array.isArray(analysis.followUpActions)
            ? analysis.followUpActions.slice(0, 3)
            : ['Notify clinical supervisor', 'Document incident for medical review', 'Monitor worker condition'],
          advice: analysis.advice || 'As a clinician, I recommend immediate medical evaluation if any injuries are present. Ensure proper documentation for clinical follow-up.'
        }
      } catch (imageError: any) {
        console.error('[OpenAI Vision Analysis] Error:', imageError)
        // Fall through to text-only analysis if image analysis fails
      }
    }

    // Text-only analysis (fallback or when no photo)
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // Cost-effective model for text-only
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3, // Lower temperature for consistent, focused responses
      max_tokens: 500, // Limit tokens to control cost
      response_format: { type: 'json_object' } // Force JSON for structured response
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      throw new Error('No response from OpenAI')
    }

    // Parse JSON response
    const analysis = JSON.parse(content) as AnalysisResult

    // Validate and sanitize response
    return {
      summary: analysis.summary || 'Analysis completed',
      riskLevel: ['low', 'medium', 'high', 'critical'].includes(analysis.riskLevel?.toLowerCase())
        ? analysis.riskLevel.toLowerCase() as 'low' | 'medium' | 'high' | 'critical'
        : params.severity,
      recommendations: Array.isArray(analysis.recommendations) 
        ? analysis.recommendations.slice(0, 4) // Limit to 4 recommendations
        : ['Conduct clinical assessment with healthcare provider', 'Monitor for signs of injury or complications', 'Follow workplace safety protocols'],
      severityAssessment: analysis.severityAssessment || 'Clinical assessment pending - please review severity classification',
      followUpActions: Array.isArray(analysis.followUpActions)
        ? analysis.followUpActions.slice(0, 3) // Limit to 3 actions
        : ['Notify clinical supervisor', 'Document incident for medical review', 'Monitor worker condition'],
      advice: analysis.advice || 'As a clinician, I recommend immediate medical evaluation if any injuries are present. Ensure proper documentation for clinical follow-up.'
    }
  } catch (error: any) {
    console.error('[OpenAI Analysis] Error:', error)
    
    // Return fallback analysis if API fails
    return {
      summary: 'Unable to complete clinical analysis. Please have a clinician review the incident manually.',
      riskLevel: params.severity,
      recommendations: [
        'Schedule clinical assessment with healthcare provider',
        'Monitor for any signs of injury or complications',
        'Ensure all safety protocols were followed',
        'Document incident for medical review'
      ],
      severityAssessment: `Clinical assessment needed - Reported severity: ${params.severity.toUpperCase()}`,
      followUpActions: [
        'Notify clinical supervisor immediately',
        'Complete incident documentation for medical review',
        'Schedule follow-up clinical assessment'
      ],
      advice: 'As a clinician, I recommend immediate medical evaluation if any injuries occurred. Ensure proper clinical documentation and follow workplace safety protocols.'
    }
  }
}

/**
 * Transcribe audio using OpenAI Whisper API
 * @param audioFile - Audio file buffer or File object
 * @returns Transcribed text
 */
export async function transcribeAudio(audioFile: File | Buffer | Blob): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const { OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey })

  try {
    // Handle different input types and convert to Buffer for OpenAI SDK
    // OpenAI SDK for Node.js works best with File objects that have proper metadata
    let fileData: Buffer
    let fileName: string = 'audio.webm'
    let mimeType: string = 'audio/webm'
    
    if (Buffer.isBuffer(audioFile)) {
      // Already a Buffer
      fileData = audioFile
    } else if (audioFile && typeof audioFile === 'object' && 'arrayBuffer' in audioFile) {
      // Handle Blob or File objects
      const blob = audioFile as Blob | File
      const arrayBuffer = await blob.arrayBuffer()
      fileData = Buffer.from(arrayBuffer)
      
      if ('name' in blob && blob.name) {
        // It's a File object
        fileName = blob.name
        mimeType = blob.type || mimeType
      } else {
        // It's a Blob
        mimeType = blob.type || mimeType
        // Extract extension from mime type
        const ext = mimeType.split('/')[1] || 'webm'
        fileName = `audio.${ext}`
      }
    } else {
      throw new Error('Invalid audio file type')
    }

    // For Node.js, OpenAI SDK accepts File object or Buffer
    // Create a File object with proper metadata for the SDK
    // Note: OpenAI SDK for Node.js expects File objects with proper name and type
    const fileToUpload = new File([fileData], fileName, { 
      type: mimeType,
      lastModified: Date.now()
    })

    // Ensure the file has the correct properties for OpenAI SDK
    // The SDK will create multipart form data from the File object
    const transcriptionResponse = await openai.audio.transcriptions.create({
      file: fileToUpload,
      model: 'whisper-1',
      language: 'en', // Optional: specify language for better accuracy
      response_format: 'text'
    })

    // Handle response format - can be string or object with text property
    if (typeof transcriptionResponse === 'string') {
      return transcriptionResponse
    } else if (transcriptionResponse && typeof transcriptionResponse === 'object') {
      const response = transcriptionResponse as { text?: string }
      return response.text || String(transcriptionResponse)
    } else {
      return String(transcriptionResponse)
    }
  } catch (error: any) {
    console.error('[Whisper Transcription] Error:', error)
    throw new Error(`Transcription failed: ${error.message || 'Unknown error'}`)
  }
}

/**
 * Analyze transcription using OpenAI GPT
 * Optimized for clinical notes and assessments
 */
export async function analyzeTranscription(params: AnalyzeTranscriptionParams): Promise<TranscriptionAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const { OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey })

  const systemPrompt = `You are an expert clinician specializing in workplace safety and occupational health. Analyze clinical notes and patient conversations from a medical perspective. Extract key information, provide clinical insights, and suggest actionable recommendations. Respond in JSON format:
{
  "summary": "Brief 2-3 sentence summary of the conversation",
  "keyPoints": ["3-5 key points or findings"],
  "clinicalNotes": "Detailed clinical notes and observations (2-3 sentences)",
  "recommendations": ["3-4 clinical recommendations"],
  "actionItems": ["2-3 specific action items for follow-up"]
}`

  const userPrompt = `As an expert clinician, analyze this clinical conversation transcription:
${params.context ? `Context: ${params.context}\n\n` : ''}Transcription:
${params.transcription}

Provide your clinical analysis, extract key medical information, and suggest recommendations.`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // Cost-effective model
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      throw new Error('No response from OpenAI')
    }

    const analysis = JSON.parse(content) as TranscriptionAnalysisResult

    // Validate and sanitize response
    return {
      summary: analysis.summary || 'Analysis completed',
      keyPoints: Array.isArray(analysis.keyPoints) 
        ? analysis.keyPoints.slice(0, 5)
        : ['Review transcription for key clinical information'],
      clinicalNotes: analysis.clinicalNotes || 'Clinical notes extracted from conversation',
      recommendations: Array.isArray(analysis.recommendations)
        ? analysis.recommendations.slice(0, 4)
        : ['Review clinical notes', 'Schedule follow-up if needed', 'Document findings'],
      actionItems: Array.isArray(analysis.actionItems)
        ? analysis.actionItems.slice(0, 3)
        : ['Review transcription', 'Update clinical records', 'Schedule follow-up']
    }
  } catch (error: any) {
    console.error('[OpenAI Transcription Analysis] Error:', error)
    
    // Return fallback analysis
    return {
      summary: 'Unable to complete clinical analysis. Please review transcription manually.',
      keyPoints: ['Review transcription for key information'],
      clinicalNotes: 'Clinical notes require manual review',
      recommendations: [
        'Review transcription carefully',
        'Extract key clinical information',
        'Document findings in patient records'
      ],
      actionItems: [
        'Review transcription',
        'Update clinical records',
        'Schedule follow-up if needed'
      ]
    }
  }
}

/**
 * Analyze predictive analytics data using OpenAI API
 * Provides comprehensive insights and recommendations for executives
 */
export async function analyzePredictiveAnalytics(params: PredictiveAnalyticsData): Promise<PredictiveAnalyticsAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const { OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey })

  // Build comprehensive data summary for AI
  const topRiskWorkersSummary = params.topRiskWorkers.slice(0, 10).map((w, idx) => 
    `${idx + 1}. ${w.workerName} (Team: ${w.teamName}${w.siteLocation ? `, Site: ${w.siteLocation}` : ''}): Risk Score ${w.riskScore.toFixed(1)}%, ${w.redPercentage.toFixed(1)}% Red check-ins, Pain: ${w.avgPain.toFixed(1)}, Fatigue: ${w.avgFatigue.toFixed(1)}, Sleep: ${w.avgSleep.toFixed(1)}h, Stress: ${w.avgStress.toFixed(1)}`
  ).join('\n')

  const topRiskTeamsSummary = params.topRiskTeams.map((t, idx) => 
    `${idx + 1}. ${t.teamName}${t.siteLocation ? ` (${t.siteLocation})` : ''}: Avg Risk Score ${t.avgRiskScore.toFixed(1)}%, ${t.workerCount} workers, ${t.atRiskWorkers} at-risk workers (${t.highRiskWorkers} high-risk)`
  ).join('\n')

  const riskIndicatorsSummary = params.riskIndicators.map(ind => 
    `${ind.label}: ${ind.count} workers (${ind.severity.toUpperCase()})`
  ).join('\n')

  const readinessSummary = params.readinessTrends.slice(-7).map(t => 
    `${t.date}: Green ${t.green}, Amber ${t.amber}, Red ${t.red}`
  ).join('\n')

  const systemPrompt = `You are an expert MSK (Musculoskeletal) intelligence analyst and workplace safety consultant specializing in predictive analytics for occupational health. Analyze worker health data and provide strategic insights, risk predictions, and actionable recommendations for executives. Pay special attention to team-level risk patterns and identify which teams need immediate intervention. Respond in JSON format:
{
  "executiveSummary": "2-3 sentence high-level summary of the organization's MSK health status and key concerns, including team-level risk highlights",
  "keyInsights": ["4-6 key insights about worker health trends, risk patterns, team-level concerns, and organizational health indicators"],
  "riskPredictions": ["3-4 predictions about potential future risks, injury likelihood, and health trends based on current data"],
  "actionableRecommendations": ["4-5 specific, actionable recommendations for improving worker health, reducing risk, and preventing injuries, with team-specific focus where applicable"],
  "priorityActions": ["3-4 immediate priority actions the company should take based on the highest risk factors, including which teams to prioritize"],
  "trendAnalysis": "2-3 sentence analysis of readiness trends and health patterns over the period",
  "organizationalImpact": "2-3 sentence assessment of how current health metrics impact organizational productivity, safety, and costs",
  "highRiskTeams": ["List of teams with highest risk scores that need immediate attention, with brief explanation of why"],
  "topWorkersConcern": "Brief summary of the top 10 highest-risk workers and what patterns or concerns they represent"
}`

  const userPrompt = `As an expert MSK intelligence analyst, analyze this predictive analytics data for an organization:

**Period:** ${params.period.startDate} to ${params.period.endDate}

**Summary:**
- Total Workers: ${params.summary.totalWorkers}
- Active Workers: ${params.summary.activeWorkers}
- At Risk Workers: ${params.summary.atRiskWorkers} (${params.summary.atRiskWorkers > 0 ? ((params.summary.atRiskWorkers / params.summary.activeWorkers) * 100).toFixed(1) : 0}% of active workers)
- Average Risk Score: ${params.summary.avgRiskScore.toFixed(1)}/100

**Top Risk Teams (Teams with Highest Average Risk Scores):**
${topRiskTeamsSummary}

**Top 10 Highest Risk Workers:**
${topRiskWorkersSummary}

**Risk Indicators:**
${riskIndicatorsSummary}

**Recent Readiness Trends (Last 7 Days):**
${readinessSummary}

Provide comprehensive analysis, predictions, and strategic recommendations. Pay special attention to:
1. Which teams have the highest risk and why
2. Patterns among the top 10 highest-risk workers
3. Team-level interventions that could be most effective
4. Immediate actions needed for high-risk teams

Focus on actionable insights that executives can use to make data-driven decisions, with clear team-level priorities.`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // Cost-effective model
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4,
      max_tokens: 1200,
      response_format: { type: 'json_object' }
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      throw new Error('No response from OpenAI')
    }

    const analysis = JSON.parse(content) as PredictiveAnalyticsAnalysisResult

    // Validate and sanitize response
    return {
      executiveSummary: analysis.executiveSummary || 'Analysis completed. Review worker health metrics and risk indicators.',
      keyInsights: Array.isArray(analysis.keyInsights) 
        ? analysis.keyInsights.slice(0, 6)
        : ['Review analytics data for key insights'],
      riskPredictions: Array.isArray(analysis.riskPredictions)
        ? analysis.riskPredictions.slice(0, 4)
        : ['Monitor risk trends', 'Watch for increasing risk indicators', 'Track worker health patterns'],
      actionableRecommendations: Array.isArray(analysis.actionableRecommendations)
        ? analysis.actionableRecommendations.slice(0, 5)
        : ['Review worker health data', 'Implement preventive measures', 'Monitor high-risk workers'],
      priorityActions: Array.isArray(analysis.priorityActions)
        ? analysis.priorityActions.slice(0, 4)
        : ['Address high-risk workers', 'Review risk indicators', 'Implement preventive strategies'],
      trendAnalysis: analysis.trendAnalysis || 'Review readiness trends for patterns and changes over time.',
      organizationalImpact: analysis.organizationalImpact || 'Current health metrics impact organizational performance and safety outcomes.',
      highRiskTeams: Array.isArray(analysis.highRiskTeams)
        ? analysis.highRiskTeams.slice(0, 5)
        : ['Review team-level risk data for high-risk teams'],
      topWorkersConcern: analysis.topWorkersConcern || 'Review top 10 highest-risk workers for patterns and immediate intervention needs.'
    }
  } catch (error: any) {
    console.error('[OpenAI] Predictive analytics analysis error:', error)
    throw new Error(`Predictive analytics analysis failed: ${error.message || 'Unknown error'}`)
  }
}

