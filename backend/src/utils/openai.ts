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

