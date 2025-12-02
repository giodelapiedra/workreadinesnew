import { Hono } from 'hono'
import { authMiddleware, requireRole, AuthVariables } from '../middleware/auth.js'
import { getCaseStatusFromNotes, mapCaseStatusToDisplay, isValidCaseStatus } from '../utils/caseStatus.js'
import { parseIncidentNotes } from '../utils/notesParser.js'
import { getAdminClient } from '../utils/adminClient.js'
import { formatDateString, parseDateString } from '../utils/dateTime.js'
import { getTodayDateString, dateToDateString } from '../utils/dateUtils.js'
import { calculateAge } from '../utils/ageUtils.js'
import { getIncidentPhotoProxyUrl, extractR2FilePath, getContentTypeFromFilePath } from '../utils/photoUrl.js'
import { getFromR2 } from '../utils/r2Storage.js'

const clinician = new Hono<{ Variables: AuthVariables }>()

// Utility functions to reduce duplication
const isDebugMode = process.env.NODE_ENV === 'development'

const debugLog = (...args: any[]) => {
  if (isDebugMode) {
    console.log(...args)
  }
}

// Format user full name
const formatUserName = (user: any): string => {
  if (!user) return 'Unknown'
  if (user.full_name) return user.full_name
  if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`
  return user.email || 'Unknown'
}

// Generate case number from exception
const generateCaseNumber = (exceptionId: string, createdAt: string): string => {
  const date = new Date(createdAt)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const uuidPrefix = exceptionId?.substring(0, 4)?.toUpperCase() || 'CASE'
  return `CASE-${year}${month}${day}-${hours}${minutes}${seconds}-${uuidPrefix}`
}

// Validate and sanitize string input
const sanitizeString = (input: any, maxLength?: number): string => {
  if (typeof input !== 'string') return ''
  const trimmed = input.trim()
  return maxLength ? trimmed.substring(0, maxLength) : trimmed
}

// OPTIMIZATION: Validate transcription ID format (reusable)
const validateTranscriptionId = (id: any): { valid: boolean; error?: string } => {
  if (!id || typeof id !== 'string' || id.length > 36) {
    return { valid: false, error: 'Invalid transcription ID format' }
  }
  // Basic UUID format check (8-4-4-4-12 hex characters)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(id)) {
    return { valid: false, error: 'Invalid transcription ID format' }
  }
  return { valid: true }
}

// SECURITY: Validate analysis object structure (deep validation)
const validateAnalysisObject = (analysis: any): { valid: boolean; error?: string } => {
  if (analysis === undefined || analysis === null) {
    return { valid: true } // Optional field
  }
  
  if (typeof analysis !== 'object' || Array.isArray(analysis)) {
    return { valid: false, error: 'Analysis must be a valid object' }
  }

  // SECURITY: Limit object size to prevent DoS
  const analysisStr = JSON.stringify(analysis)
  if (analysisStr.length > 50000) { // 50KB limit
    return { valid: false, error: 'Analysis object too large. Maximum size is 50KB' }
  }

  // SECURITY: Validate structure - only allow expected fields
  const allowedKeys = ['summary', 'keyPoints', 'recommendations', 'concerns', 'actionItems']
  const analysisKeys = Object.keys(analysis)
  
  // Check if all keys are allowed
  for (const key of analysisKeys) {
    if (!allowedKeys.includes(key)) {
      return { valid: false, error: `Invalid analysis field: ${key}. Allowed fields: ${allowedKeys.join(', ')}` }
    }
  }

  // Validate summary if present
  if (analysis.summary !== undefined) {
    if (typeof analysis.summary !== 'string') {
      return { valid: false, error: 'Analysis summary must be a string' }
    }
    if (analysis.summary.length > 5000) {
      return { valid: false, error: 'Analysis summary too long. Maximum length is 5,000 characters' }
    }
  }

  // Validate keyPoints if present
  if (analysis.keyPoints !== undefined) {
    if (!Array.isArray(analysis.keyPoints)) {
      return { valid: false, error: 'Analysis keyPoints must be an array' }
    }
    if (analysis.keyPoints.length > 100) {
      return { valid: false, error: 'Too many key points. Maximum is 100' }
    }
    for (let i = 0; i < analysis.keyPoints.length; i++) {
      if (typeof analysis.keyPoints[i] !== 'string') {
        return { valid: false, error: `Key point ${i + 1} must be a string` }
      }
      if (analysis.keyPoints[i].length > 1000) {
        return { valid: false, error: `Key point ${i + 1} too long. Maximum length is 1,000 characters` }
      }
    }
  }

  // Validate actionItems if present
  if (analysis.actionItems !== undefined) {
    if (!Array.isArray(analysis.actionItems)) {
      return { valid: false, error: 'Analysis actionItems must be an array' }
    }
    if (analysis.actionItems.length > 100) {
      return { valid: false, error: 'Too many action items. Maximum is 100' }
    }
    for (let i = 0; i < analysis.actionItems.length; i++) {
      if (typeof analysis.actionItems[i] !== 'string') {
        return { valid: false, error: `Action item ${i + 1} must be a string` }
      }
      if (analysis.actionItems[i].length > 1000) {
        return { valid: false, error: `Action item ${i + 1} too long. Maximum length is 1,000 characters` }
      }
    }
  }

  // Validate recommendations if present
  if (analysis.recommendations !== undefined) {
    if (!Array.isArray(analysis.recommendations)) {
      return { valid: false, error: 'Analysis recommendations must be an array' }
    }
    if (analysis.recommendations.length > 100) {
      return { valid: false, error: 'Too many recommendations. Maximum is 100' }
    }
    for (let i = 0; i < analysis.recommendations.length; i++) {
      if (typeof analysis.recommendations[i] !== 'string') {
        return { valid: false, error: `Recommendation ${i + 1} must be a string` }
      }
      if (analysis.recommendations[i].length > 1000) {
        return { valid: false, error: `Recommendation ${i + 1} too long. Maximum length is 1,000 characters` }
      }
    }
  }

  // Validate concerns if present
  if (analysis.concerns !== undefined) {
    if (!Array.isArray(analysis.concerns)) {
      return { valid: false, error: 'Analysis concerns must be an array' }
    }
    if (analysis.concerns.length > 100) {
      return { valid: false, error: 'Too many concerns. Maximum is 100' }
    }
    for (let i = 0; i < analysis.concerns.length; i++) {
      if (typeof analysis.concerns[i] !== 'string') {
        return { valid: false, error: `Concern ${i + 1} must be a string` }
      }
      if (analysis.concerns[i].length > 1000) {
        return { valid: false, error: `Concern ${i + 1} too long. Maximum length is 1,000 characters` }
      }
    }
  }

  return { valid: true }
}

// Validate date input
const validateDateInput = (dateStr: any): { valid: boolean; error?: string; date?: Date } => {
  if (!dateStr || typeof dateStr !== 'string') {
    return { valid: false, error: 'Date is required' }
  }
  
  try {
    const date = parseDateString(dateStr)
    if (isNaN(date.getTime())) {
      return { valid: false, error: 'Invalid date' }
    }
    
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (date < today) {
      return { valid: false, error: 'Date cannot be in the past' }
    }
    
    return { valid: true, date }
  } catch {
    return { valid: false, error: 'Invalid date format. Expected YYYY-MM-DD' }
  }
}

// OPTIMIZATION: Validate and normalize time format (reusable)
const validateAndNormalizeTime = (time: any): { valid: boolean; error?: string; normalized?: string } => {
  if (time === undefined || time === null) {
    return { valid: false, error: 'Time is required' }
  }

  const timeStr = String(time).trim()
  if (!timeStr) {
    return { valid: false, error: 'Time cannot be empty' }
  }

  // Accept both H:MM and HH:MM formats
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
  if (!timeRegex.test(timeStr)) {
    return { valid: false, error: 'Invalid time format. Expected HH:MM (e.g., 09:00 or 9:00)' }
  }

  // Normalize to HH:MM format (2-digit hours)
  const [hours, minutes] = timeStr.split(':')
  const normalized = `${hours.padStart(2, '0')}:${minutes}`

  return { valid: true, normalized }
}

// OPTIMIZATION: Centralized utility for duty type label formatting
const formatDutyTypeLabel = (dutyType: string | null | undefined): string => {
  if (!dutyType || typeof dutyType !== 'string') {
    return 'Unknown'
  }
  const normalized = dutyType.trim().toLowerCase()
  return normalized === 'modified' ? 'Modified Duties' : normalized === 'full' ? 'Full Duties' : 'Unknown'
}

// OPTIMIZATION: Centralized utility for formatting return date in notifications
const formatReturnDateForNotification = (dateStr: string | null | undefined): string => {
  if (!dateStr || typeof dateStr !== 'string') {
    return 'Invalid Date'
  }
  try {
    const date = parseDateString(dateStr)
    if (isNaN(date.getTime())) {
      return 'Invalid Date'
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return 'Invalid Date'
  }
}



// Get cases assigned to clinician (cases that need medical attention)
clinician.get('/cases', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
    const status = c.req.query('status') || 'all'
    const search = c.req.query('search') || ''

    const adminClient = getAdminClient()
    const offset = (page - 1) * limit

    // Get medical-related exceptions assigned to this clinician
    let query = adminClient
      .from('worker_exceptions')
      .select(`
        *,
        users!worker_exceptions_user_id_fkey(
          id,
          email,
          first_name,
          last_name,
          full_name
        ),
        teams!worker_exceptions_team_id_fkey(
          id,
          name,
          site_location,
          supervisor_id,
          team_leader_id
        )
      `)
      .in('exception_type', ['injury', 'medical_leave', 'accident', 'other'])
      .eq('clinician_id', user.id) // Only show cases assigned to this clinician
      .eq('assigned_to_whs', true) // Only cases that were assigned to WHS

    // Filter by status
    const todayStr = getTodayDateString()
    if (status === 'active') {
      query = query.eq('is_active', true).gte('start_date', todayStr).or(`end_date.is.null,end_date.gte.${todayStr}`)
    } else if (status === 'closed') {
      query = query.or(`end_date.lt.${todayStr},is_active.eq.false`)
    } else if (status === 'rehab') {
      // Cases in rehabilitation (has active rehab plan)
      query = query.eq('is_active', true)
    }

    // OPTIMIZATION: Count query should use same filters as main query for accuracy
    const countQuery = adminClient
      .from('worker_exceptions')
      .select('*', { count: 'exact', head: true })
      .in('exception_type', ['injury', 'medical_leave', 'accident', 'other'])
      .eq('clinician_id', user.id)
      .eq('assigned_to_whs', true)
    
    // Apply same status filters to count query
    if (status === 'active') {
      countQuery.eq('is_active', true).gte('start_date', todayStr).or(`end_date.is.null,end_date.gte.${todayStr}`)
    } else if (status === 'closed') {
      countQuery.or(`end_date.lt.${todayStr},is_active.eq.false`)
    } else if (status === 'rehab') {
      countQuery.eq('is_active', true)
    }

    // Get total count and cases in parallel (OPTIMIZED: Both queries use same filters)
    const [countResult, casesResult] = await Promise.all([
      countQuery,
      query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
    ])

    const { count } = countResult
    const { data: cases, error: casesError } = casesResult


    if (casesError) {
      console.error('[GET /clinician/cases] Database Error:', casesError)
      console.error('[GET /clinician/cases] User ID:', user.id)
      console.error('[GET /clinician/cases] Query filters:', {
        exception_types: ['injury', 'medical_leave', 'accident', 'other'],
        clinician_id: user.id,
        assigned_to_whs: true,
        status
      })
      return c.json({ error: 'Failed to fetch cases', details: casesError.message }, 500)
    }

    // Ensure cases is always an array

    // Get rehabilitation plans for cases (to determine rehab status)
    // SECURITY & OPTIMIZATION: Only get plans for this clinician's cases
    const caseIds = (cases || []).map((c: any) => c.id)
    const caseUserIds = (cases || []).map((c: any) => c.user_id).filter(Boolean)
    const caseTeamIds = (cases || []).map((c: any) => c.team_id).filter(Boolean)
    
    let rehabPlans: any[] = []
    if (caseIds.length > 0) {
      const { data: rehabPlansData, error: rehabError } = await adminClient
      .from('rehabilitation_plans')
      .select('exception_id, status')
      .in('exception_id', caseIds)
          .eq('clinician_id', user.id) // SECURITY: Only plans assigned to this clinician
      .eq('status', 'active')
      
      if (rehabError) {
        console.error('[GET /clinician/cases] Error fetching rehab plans:', rehabError)
      } else {
        rehabPlans = rehabPlansData || []
      }
    }

    const rehabMap = new Map()
    if (rehabPlans) {
      rehabPlans.forEach((plan: any) => {
        rehabMap.set(plan.exception_id, true)
      })
    }

    // OPTIMIZATION: Batch fetch team_members for phone numbers
    let phoneMap = new Map<string, string>()
    if (caseUserIds.length > 0 && caseTeamIds.length > 0) {
      const { data: teamMembers, error: membersError } = await adminClient
        .from('team_members')
        .select('user_id, team_id, phone')
        .in('user_id', caseUserIds)
        .in('team_id', caseTeamIds)
      
      if (!membersError && teamMembers) {
        teamMembers.forEach((member: any) => {
          const key = `${member.user_id}_${member.team_id}`
          if (member.phone) {
            phoneMap.set(key, member.phone)
          }
        })
      }
    }

    // Get supervisor and team leader info for all unique IDs (optimized batch fetch)
    const supervisorIds = Array.from(new Set(
      (cases || [])
        .map((incident: any) => {
          const team = Array.isArray(incident.teams) ? incident.teams[0] : incident.teams
          return team?.supervisor_id
        })
        .filter(Boolean)
    ))

    const teamLeaderIds = Array.from(new Set(
      (cases || [])
        .map((incident: any) => {
          const team = Array.isArray(incident.teams) ? incident.teams[0] : incident.teams
          return team?.team_leader_id
        })
        .filter(Boolean)
    ))

    // Batch fetch all users (supervisors and team leaders) in parallel
    const allUserIds = Array.from(new Set([...supervisorIds, ...teamLeaderIds]))
    let userMap = new Map()
    if (allUserIds.length > 0) {
      const { data: users } = await adminClient
        .from('users')
        .select('id, email, first_name, last_name, full_name, gender, date_of_birth')
        .in('id', allUserIds)

      if (users) {
        users.forEach((userData: any) => {
          userMap.set(userData.id, userData)
        })
      }
    }

    // OPTIMIZATION: Fetch all related incidents in one query
    const casesArray = Array.isArray(cases) ? cases : []
    const incidentCaseUserIds = casesArray.map((c: any) => c.user_id)
    const incidentCaseStartDates = casesArray.map((c: any) => c.start_date)
    
    // Fetch all approved incidents for these users
    const { data: relatedIncidents } = await adminClient
      .from('incidents')
      .select('id, user_id, incident_date, photo_url, ai_analysis_result, description, severity')
      .in('user_id', incidentCaseUserIds.length > 0 ? incidentCaseUserIds : ['00000000-0000-0000-0000-000000000000'])
      .eq('approval_status', 'approved')
      .order('created_at', { ascending: false })
    
    // Create map for O(1) lookup: key = `${user_id}_${incident_date}`
    // Also create a fallback map for approximate date matching
    const incidentMap = new Map()
    const incidentUserMap = new Map<string, any[]>() // Map user_id to array of incidents
    
    if (relatedIncidents) {
      relatedIncidents.forEach((inc: any) => {
        const key = `${inc.user_id}_${inc.incident_date}`
        incidentMap.set(key, inc)
        
        // Also group by user_id for fallback matching
        if (!incidentUserMap.has(inc.user_id)) {
          incidentUserMap.set(inc.user_id, [])
        }
        incidentUserMap.get(inc.user_id)!.push(inc)
      })
    }

    // Format cases (OPTIMIZATION: Pre-calculate date once, use Map for O(1) lookups)
    const todayDate = new Date()
    todayDate.setHours(0, 0, 0, 0) // Normalize to start of day for accurate comparison
    let formattedCases = casesArray.map((incident: any) => {
      // OPTIMIZATION: Use direct array access instead of Array.isArray check (faster)
      const user = incident.users?.[0] || incident.users
      const team = incident.teams?.[0] || incident.teams
      const supervisor = team?.supervisor_id ? userMap.get(team.supervisor_id) : null
      const teamLeader = team?.team_leader_id ? userMap.get(team.team_leader_id) : null
      
      // Get phone from phoneMap
      const phoneKey = `${incident.user_id}_${incident.team_id}`
      const phone = phoneMap.get(phoneKey) || null

      // OPTIMIZATION: Cache date calculations
      const startDate = new Date(incident.start_date)
      startDate.setHours(0, 0, 0, 0)
      const endDate = incident.end_date ? new Date(incident.end_date) : null
      if (endDate) endDate.setHours(0, 0, 0, 0)
      
      const isCurrentlyActive = todayDate >= startDate && (!endDate || todayDate <= endDate) && incident.is_active
      const isInRehab = rehabMap.has(incident.id) // O(1) Map lookup

      // Generate case number using utility function
      const caseNumber = generateCaseNumber(incident.id, incident.created_at)

      // Get case_status from notes field using secure helper
      const caseStatusFromNotes = getCaseStatusFromNotes(incident.notes)

      // Determine case status using optimized utility function
      const caseStatus = mapCaseStatusToDisplay(caseStatusFromNotes, isInRehab, isCurrentlyActive)

      // Determine priority
      let priority = 'MEDIUM'
      if (incident.exception_type === 'injury' || incident.exception_type === 'accident') {
        priority = 'HIGH'
      } else if (incident.exception_type === 'medical_leave') {
        priority = 'MEDIUM'
      } else {
        priority = 'LOW'
      }

      return {
        id: incident.id,
        caseNumber,
        workerId: incident.user_id,
        workerName: formatUserName(user),
        workerEmail: user?.email || '',
        workerInitials: user?.first_name?.[0]?.toUpperCase() + user?.last_name?.[0]?.toUpperCase() || 'U',
        workerGender: user?.gender || null,
        workerAge: user?.date_of_birth ? calculateAge(user.date_of_birth) : null,
        teamId: incident.team_id,
        teamName: team?.name || '',
        siteLocation: team?.site_location || '',
        supervisorId: team?.supervisor_id || null,
        supervisorName: formatUserName(supervisor),
        teamLeaderId: team?.team_leader_id || null,
        teamLeaderName: formatUserName(teamLeader),
        type: incident.exception_type,
        reason: incident.reason || '',
        startDate: incident.start_date,
        endDate: incident.end_date,
        status: caseStatus,
        priority,
        isActive: isCurrentlyActive,
        isInRehab,
        caseStatus: caseStatusFromNotes || null, // Internal case status
        notes: incident.notes || null,
        createdAt: incident.created_at,
        updatedAt: incident.updated_at,
        return_to_work_duty_type: incident.return_to_work_duty_type || null,
        return_to_work_date: incident.return_to_work_date || null,
        phone: phone,
        healthLink: null, // Not available in current schema
        payer: null, // Not available in current schema
        caseManager: !!teamLeader, // Team leader acts as case manager
        // Include incident photo and AI analysis
        // Convert R2 URLs to proxy URLs to avoid DNS resolution issues
        incidentPhotoUrl: (() => {
          // Try exact match first
          const incidentKey = `${incident.user_id}_${incident.start_date}`
          const exactMatch = incidentMap.get(incidentKey)
          if (exactMatch && exactMatch.id) {
            return getIncidentPhotoProxyUrl(exactMatch.photo_url, exactMatch.id, 'clinician')
          }
          
          // Fallback: Find incident within 7 days
          const userIncidents = incidentUserMap.get(incident.user_id) || []
          const exceptionDate = new Date(incident.start_date)
          exceptionDate.setHours(0, 0, 0, 0)
          
          for (const inc of userIncidents) {
            const incDate = new Date(inc.incident_date)
            incDate.setHours(0, 0, 0, 0)
            const daysDiff = Math.abs((incDate.getTime() - exceptionDate.getTime()) / (1000 * 60 * 60 * 24))
            if (daysDiff <= 7 && inc.id) {
              return getIncidentPhotoProxyUrl(inc.photo_url, inc.id, 'clinician')
            }
          }
          
          return null
        })(),
        incidentAiAnalysis: (() => {
          // Try exact match first
          const incidentKey = `${incident.user_id}_${incident.start_date}`
          const exactMatch = incidentMap.get(incidentKey)
          if (exactMatch?.ai_analysis_result) {
            try {
              if (typeof exactMatch.ai_analysis_result === 'string') {
                return JSON.parse(exactMatch.ai_analysis_result)
              }
              return exactMatch.ai_analysis_result
            } catch {
              return null
            }
          }
          
          // Fallback: Find incident within 7 days
          const userIncidents = incidentUserMap.get(incident.user_id) || []
          const exceptionDate = new Date(incident.start_date)
          exceptionDate.setHours(0, 0, 0, 0)
          
          for (const inc of userIncidents) {
            const incDate = new Date(inc.incident_date)
            incDate.setHours(0, 0, 0, 0)
            const daysDiff = Math.abs((incDate.getTime() - exceptionDate.getTime()) / (1000 * 60 * 60 * 24))
            if (daysDiff <= 7 && inc.ai_analysis_result) {
              try {
                if (typeof inc.ai_analysis_result === 'string') {
                  return JSON.parse(inc.ai_analysis_result)
                }
                return inc.ai_analysis_result
              } catch {
                return null
              }
            }
          }
          
          return null
        })(),
      }
    })

    // Apply search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase()
      formattedCases = formattedCases.filter(caseItem => 
        caseItem.workerName.toLowerCase().includes(searchLower) ||
        caseItem.workerEmail.toLowerCase().includes(searchLower) ||
        caseItem.caseNumber.toLowerCase().includes(searchLower) ||
        caseItem.teamName.toLowerCase().includes(searchLower)
      )
    }

    // Get summary statistics (OPTIMIZED: Only query assigned cases with filters first)
    // This prevents loading thousands of cases into memory
    const { data: allCases } = await adminClient
      .from('worker_exceptions')
      .select('id, exception_type, is_active, start_date, end_date, notes')
      .in('exception_type', ['injury', 'medical_leave', 'accident', 'other'])
      .eq('clinician_id', user.id) // Filter by clinician FIRST (uses index)
      .eq('assigned_to_whs', true)

    // OPTIMIZATION: Only get rehab plans for THIS clinician's cases, not all plans
    // SECURITY: Also filter by clinician_id for additional security
    const allCaseIds = (allCases || []).map(c => c.id)
    const { data: allRehabPlans } = allCaseIds.length > 0
      ? await adminClient
          .from('rehabilitation_plans')
          .select('exception_id, status')
          .in('exception_id', allCaseIds) // Only get plans for this clinician's cases
          .eq('clinician_id', user.id) // SECURITY: Only plans assigned to this clinician
      : { data: [] }

    // OPTIMIZATION: Pre-build Set for O(1) lookup instead of O(n) in loop
    const rehabCasesSet = new Set(
      (allRehabPlans?.filter((p: any) => p.status === 'active') || [])
        .map((p: any) => p.exception_id)
    )

    // OPTIMIZATION: Use single loop with early returns and efficient checks
    let activeCount = 0
    let completedCount = 0
    let inRehabCount = 0
    const casesList = allCases || []
    const total = casesList.length

    // Process cases in single optimized loop
    for (let i = 0; i < total; i++) {
      const caseItem = casesList[i]
      const caseStatusFromNotes = getCaseStatusFromNotes(caseItem.notes)
      
      // Fast path: Check closed status first (most common filter)
      if (caseStatusFromNotes === 'closed' || caseStatusFromNotes === 'return_to_work') {
        completedCount++
        continue
      }
      
      // Check if in rehab (Set lookup is O(1))
      const isInRehab = rehabCasesSet.has(caseItem.id) || caseStatusFromNotes === 'in_rehab'
      
      if (isInRehab) {
        inRehabCount++
        // Don't count as active if in rehab
        continue
      }
      
      // Everything else is active (not closed, not in rehab)
      activeCount++
    }

    const summary = {
      total,
      active: activeCount,
      completed: completedCount,
      inRehab: inRehabCount,
      pendingConfirmation: 0,
    }

    const responseData = {
      cases: formattedCases,
      summary,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
        hasNext: page < Math.ceil((count || 0) / limit),
        hasPrev: page > 1,
      },
    }
    
    return c.json(responseData, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  } catch (error: any) {
    console.error('[GET /clinician/cases] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get single case detail by ID (OPTIMIZED: Direct lookup instead of fetching all cases)
clinician.get('/cases/:id', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const caseId = c.req.param('id')
    if (!caseId) {
      return c.json({ error: 'Case ID is required' }, 400)
    }

    const adminClient = getAdminClient()

    // OPTIMIZATION: Get single case with related data in one query
    const { data: caseData, error: caseError } = await adminClient
      .from('worker_exceptions')
      .select(`
        *,
        users!worker_exceptions_user_id_fkey(
          id,
          email,
          first_name,
          last_name,
          full_name
        ),
        teams!worker_exceptions_team_id_fkey(
          id,
          name,
          site_location,
          supervisor_id,
          team_leader_id
        )
      `)
      .eq('id', caseId)
      .eq('clinician_id', user.id) // SECURITY: Only their assigned cases
      .eq('assigned_to_whs', true)
      .in('exception_type', ['injury', 'medical_leave', 'accident', 'other'])
      .single()

    if (caseError || !caseData) {
      console.error('[GET /clinician/cases/:id] Error:', caseError)
      return c.json({ error: 'Case not found or not authorized' }, 404)
    }

    // OPTIMIZATION: Parallel fetch of related data
    const team = Array.isArray(caseData.teams) ? caseData.teams[0] : caseData.teams
    const userIds = [team?.supervisor_id, team?.team_leader_id].filter(Boolean)
    
    // Get related incident (for photo and AI analysis)
    // Match by user_id and date (incident_date should match start_date)
    const incidentDate = caseData.start_date
    
    const [teamMemberResult, usersResult, rehabPlanResult, incidentResult] = await Promise.all([
      // Get phone number
      adminClient
        .from('team_members')
        .select('phone')
        .eq('user_id', caseData.user_id)
        .eq('team_id', caseData.team_id)
        .maybeSingle(),
      
      // Get supervisor and team leader info
      userIds.length > 0
        ? adminClient
            .from('users')
            .select('id, email, first_name, last_name, full_name, gender, date_of_birth')
            .in('id', userIds)
        : Promise.resolve({ data: [] }),
      
      // Check rehab status
      adminClient
        .from('rehabilitation_plans')
        .select('id, status')
        .eq('exception_id', caseId)
        .eq('clinician_id', user.id)
        .eq('status', 'active')
        .maybeSingle(),
      
      // Get related incident (for photo and AI analysis)
      // Use flexible matching to handle date format differences
      (async () => {
        // First try exact date match
        const { data: exactMatch } = await adminClient
          .from('incidents')
          .select('id, photo_url, ai_analysis_result, incident_date, description, severity')
          .eq('user_id', caseData.user_id)
          .eq('incident_date', incidentDate)
          .eq('approval_status', 'approved')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        if (exactMatch) {
          return { data: exactMatch }
        }
        
        // Fallback: Get most recent approved incident for this user within 7 days
        const { data: recentIncident } = await adminClient
          .from('incidents')
          .select('id, photo_url, ai_analysis_result, incident_date, description, severity')
          .eq('user_id', caseData.user_id)
          .eq('approval_status', 'approved')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        if (recentIncident) {
          const incidentDateObj = new Date(recentIncident.incident_date)
          const exceptionDateObj = new Date(incidentDate)
          const daysDiff = Math.abs((incidentDateObj.getTime() - exceptionDateObj.getTime()) / (1000 * 60 * 60 * 24))
          
          if (daysDiff <= 7) {
            return { data: recentIncident }
          }
        }
        
        return { data: null }
      })()
    ])

    // Build user map for O(1) lookups
    const userMap = new Map()
    if (usersResult.data) {
      usersResult.data.forEach((u: any) => userMap.set(u.id, u))
    }

    const user_data = Array.isArray(caseData.users) ? caseData.users[0] : caseData.users
    const supervisor = userMap.get(team?.supervisor_id)
    const teamLeader = userMap.get(team?.team_leader_id)
    
    // Determine case status
    const caseStatusFromNotes = getCaseStatusFromNotes(caseData.notes)
    const isInRehab = !!rehabPlanResult.data
    const todayDate = new Date()
    todayDate.setHours(0, 0, 0, 0)
    const startDate = new Date(caseData.start_date)
    startDate.setHours(0, 0, 0, 0)
    const endDate = caseData.end_date ? new Date(caseData.end_date) : null
    if (endDate) endDate.setHours(0, 0, 0, 0)
    const isCurrentlyActive = todayDate >= startDate && (!endDate || todayDate <= endDate) && caseData.is_active

    // Determine priority
    let priority = 'MEDIUM'
    if (caseData.exception_type === 'injury' || caseData.exception_type === 'accident') {
      priority = 'HIGH'
    } else if (caseData.exception_type === 'medical_leave') {
      priority = 'MEDIUM'
    } else {
      priority = 'LOW'
    }

    // Parse AI analysis if available
    let aiAnalysis = null
    if (incidentResult.data?.ai_analysis_result) {
      try {
        if (typeof incidentResult.data.ai_analysis_result === 'string') {
          aiAnalysis = JSON.parse(incidentResult.data.ai_analysis_result)
        } else {
          aiAnalysis = incidentResult.data.ai_analysis_result
        }
      } catch (parseError) {
        console.warn('[GET /clinician/cases/:id] Failed to parse AI analysis:', parseError)
      }
    }

    const formattedCase = {
      id: caseData.id,
      caseNumber: generateCaseNumber(caseData.id, caseData.created_at),
      workerId: caseData.user_id,
      workerName: formatUserName(user_data),
      workerEmail: user_data?.email || '',
      workerInitials: (user_data?.first_name?.[0]?.toUpperCase() || '') + (user_data?.last_name?.[0]?.toUpperCase() || '') || 'U',
      workerGender: user_data?.gender || null,
      workerAge: user_data?.date_of_birth ? calculateAge(user_data.date_of_birth) : null,
      teamId: caseData.team_id,
      teamName: team?.name || '',
      siteLocation: team?.site_location || '',
      supervisorName: formatUserName(supervisor),
      teamLeaderName: formatUserName(teamLeader),
      type: caseData.exception_type,
      reason: caseData.reason || '',
      startDate: caseData.start_date,
      endDate: caseData.end_date,
      status: mapCaseStatusToDisplay(caseStatusFromNotes, isInRehab, isCurrentlyActive),
      priority,
      isActive: isCurrentlyActive,
      isInRehab,
      caseStatus: caseStatusFromNotes || null,
      notes: caseData.notes || null,
      createdAt: caseData.created_at,
      updatedAt: caseData.updated_at,
      return_to_work_duty_type: caseData.return_to_work_duty_type || null,
      return_to_work_date: caseData.return_to_work_date || null,
      phone: teamMemberResult.data?.phone || null,
      // Include incident photo and AI analysis (both formats for backward compatibility)
      // Convert R2 URLs to proxy URLs to avoid DNS resolution issues
      incidentPhotoUrl: incidentResult.data?.id 
        ? getIncidentPhotoProxyUrl(incidentResult.data?.photo_url, incidentResult.data.id, 'clinician') 
        : null,
      incidentId: incidentResult.data?.id || null,
      incidentAiAnalysis: aiAnalysis,
      incident: {
        photoUrl: incidentResult.data?.id 
          ? getIncidentPhotoProxyUrl(incidentResult.data?.photo_url, incidentResult.data.id, 'clinician') 
          : null,
        incidentId: incidentResult.data?.id || null,
        aiAnalysis: aiAnalysis,
        description: incidentResult.data?.description || null,
        severity: incidentResult.data?.severity || null,
      },
    }

    return c.json({ case: formattedCase }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  } catch (error: any) {
    console.error('[GET /clinician/cases/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get detailed daily progress for a specific rehabilitation plan
clinician.get('/rehabilitation-plans/:id/progress', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const planId = c.req.param('id')
    if (!planId) {
      return c.json({ error: 'Plan ID is required' }, 400)
    }

    const adminClient = getAdminClient()

    // SECURITY: Get the plan with exercises and verify ownership
    const { data: plan, error: planError } = await adminClient
      .from('rehabilitation_plans')
      .select(`
        *,
        clinician_id,
        worker_exceptions!rehabilitation_plans_exception_id_fkey(
          id,
          user_id,
          users!worker_exceptions_user_id_fkey(
            id,
            email,
            first_name,
            last_name,
            full_name
          )
        ),
        rehabilitation_exercises(
          id,
          exercise_name,
          exercise_order
        )
      `)
      .eq('id', planId)
      .eq('clinician_id', user.id) // SECURITY & OPTIMIZATION: Filter by clinician_id first
      .single()

    if (planError || !plan) {
      return c.json({ error: 'Plan not found or not authorized' }, 404)
    }

    // SECURITY: Double-check ownership (defense in depth)
    if (plan.clinician_id !== user.id) {
      console.error(`[GET /clinician/rehabilitation-plans/:id/progress] SECURITY: User ${user.id} attempted to view plan ${planId} owned by ${plan.clinician_id}`)
      return c.json({ error: 'Forbidden: You can only view your own rehabilitation plans' }, 403)
    }

    const exception = plan.worker_exceptions
    const workerUser = Array.isArray(exception?.users) ? exception?.users[0] : exception?.users
    const workerUserId = exception?.user_id

    // Get all completions for this plan
    const { data: completions } = await adminClient
      .from('rehabilitation_plan_completions')
      .select('completion_date, exercise_id')
      .eq('plan_id', planId)
      .eq('user_id', workerUserId)
      .order('completion_date', { ascending: true })

    // Group completions by date
    const completionsByDate = new Map<string, Set<string>>()
    if (completions) {
      for (const completion of completions) {
        const dateStr = typeof completion.completion_date === 'string' 
          ? completion.completion_date.split('T')[0]
          : formatDateString(new Date(completion.completion_date))
        
        if (!completionsByDate.has(dateStr)) {
          completionsByDate.set(dateStr, new Set())
        }
        completionsByDate.get(dateStr)!.add(completion.exercise_id)
      }
    }

    // Sort exercises by order
    const exercises = (plan.rehabilitation_exercises || [])
      .sort((a: any, b: any) => a.exercise_order - b.exercise_order)
      .map((ex: any) => ({
        id: ex.id,
        exercise_name: ex.exercise_name,
        exercise_order: ex.exercise_order,
      }))

    const totalExercises = exercises.length

    // Parse dates
    const startDate = parseDateString(plan.start_date)
    const endDate = parseDateString(plan.end_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
    const now = new Date()

    // Build daily progress array
    const dailyProgress: Array<{
      dayNumber: number
      date: string
      status: 'completed' | 'current' | 'pending'
      exercisesCompleted: number
      totalExercises: number
      isFullyCompleted: boolean
    }> = []

    let currentDay = 1
    let daysCompleted = 0

    for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
      const dayDate = new Date(startDate)
      dayDate.setDate(dayDate.getDate() + dayOffset)
      const dayDateStr = formatDateString(dayDate)
      const dayNumber = dayOffset + 1

      const dayCompletions = completionsByDate.get(dayDateStr) || new Set()
      const exercisesCompleted = dayCompletions.size
      const allExercisesCompleted = totalExercises > 0 && exercises.every((ex: any) => dayCompletions.has(ex.id))

      let status: 'completed' | 'current' | 'pending'
      if (dayDate > today) {
        status = 'pending'
      } else if (allExercisesCompleted) {
        status = 'completed'
        daysCompleted++
      } else if (dayNumber === currentDay) {
        status = 'current'
      } else {
        status = 'current'
      }

      dailyProgress.push({
        dayNumber,
        date: dayDateStr,
        status,
        exercisesCompleted,
        totalExercises,
        isFullyCompleted: allExercisesCompleted,
      })

      // Update currentDay logic (same as in main endpoint)
      if (dayDate > today) {
        if (currentDay === dayNumber) {
          currentDay = dayNumber
          break
        }
      } else if (allExercisesCompleted) {
        if (dayOffset < totalDays - 1) {
          const nextDayDate = new Date(dayDate)
          nextDayDate.setDate(dayDate.getDate() + 1)
          nextDayDate.setHours(6, 0, 0, 0)
          if (now >= nextDayDate) {
            currentDay = dayOffset + 2
          } else {
            currentDay = dayOffset + 1
            break
          }
        } else {
          currentDay = totalDays
          break
        }
      } else {
        currentDay = dayNumber
        break
      }
    }

    // Update status based on currentDay
    for (let i = 0; i < dailyProgress.length; i++) {
      const day = dailyProgress[i]
      if (day.dayNumber === currentDay && day.status !== 'completed') {
        day.status = 'current'
      } else if (day.dayNumber > currentDay) {
        day.status = 'pending'
      } else if (day.isFullyCompleted && day.dayNumber < currentDay) {
        day.status = 'completed'
      }
    }

    const progress = totalDays > 0 ? Math.round((daysCompleted / totalDays) * 100) : 0

    return c.json({
      plan: {
        id: plan.id,
        plan_name: plan.plan_name,
        plan_description: plan.plan_description,
        workerName: formatUserName(workerUser),
        caseNumber: generateCaseNumber(exception?.id || plan.id, plan.created_at),
        startDate: plan.start_date,
        endDate: plan.end_date,
        duration: totalDays,
        progress,
        currentDay,
        daysCompleted,
        status: plan.status,
      },
      dailyProgress,
    })
  } catch (error: any) {
    console.error('[GET /clinician/rehabilitation-plans/:id/progress] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get rehabilitation plans
clinician.get('/rehabilitation-plans', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const status = c.req.query('status') || 'active'
    const adminClient = getAdminClient()

    let query = adminClient
      .from('rehabilitation_plans')
      .select(`
        *,
        worker_exceptions!rehabilitation_plans_exception_id_fkey(
          id,
          exception_type,
          reason,
          start_date,
          end_date,
          users!worker_exceptions_user_id_fkey(
            id,
            email,
            first_name,
            last_name,
            full_name
          ),
          teams!worker_exceptions_team_id_fkey(
            id,
            name,
            site_location
          )
        ),
        rehabilitation_exercises(
          id,
          exercise_name,
          repetitions,
          instructions,
          video_url,
          exercise_order
        )
      `)
      .eq('clinician_id', user.id) // SECURITY: Only show plans assigned to this clinician

    if (status === 'active') {
      query = query.eq('status', 'active')
    } else if (status === 'completed') {
      query = query.eq('status', 'completed')
    } else if (status === 'cancelled') {
      query = query.eq('status', 'cancelled')
    }

    const { data: plans, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('[GET /clinician/rehabilitation-plans] Database Error:', error)
      console.error('[GET /clinician/rehabilitation-plans] User ID:', user.id)
      console.error('[GET /clinician/rehabilitation-plans] Status filter:', status)
      return c.json({ error: 'Failed to fetch rehabilitation plans', details: error.message }, 500)
    }

    // Ensure plans is always an array

    // OPTIMIZATION: Build plan_id to user_id mapping first
    const planIds = (plans || []).map((p: any) => p.id)
    const planToUserId = new Map<string, string>()
    debugLog(`Building planToUserId mapping for ${planIds.length} plans`)
    
    for (const plan of plans || []) {
      const exception = plan.worker_exceptions
      const worker = Array.isArray(exception?.users) ? exception?.users[0] : exception?.users
      if (worker?.id) {
        planToUserId.set(plan.id, worker.id)
      }
    }

    // OPTIMIZATION: Batch fetch all completion records for all plans in one query
    // But we need to filter by user_id for each plan
    const completionsByPlanId = new Map<string, Map<string, Set<string>>>()
    
    if (planIds.length > 0) {
      // Fetch all completions for these plans
      const { data: allCompletions } = await adminClient
        .from('rehabilitation_plan_completions')
        .select('plan_id, completion_date, exercise_id, user_id')
        .in('plan_id', planIds)
        .order('completion_date', { ascending: true })

      // Group completions by plan_id and then by date, filtering by correct user_id
      if (allCompletions && allCompletions.length > 0) {
        for (const completion of allCompletions) {
          const expectedUserId = planToUserId.get(completion.plan_id)
          if (!expectedUserId) continue
          
          // Filter by correct user_id
          if (String(completion.user_id).trim() !== String(expectedUserId).trim()) continue

          // Normalize date to YYYY-MM-DD format
          const dateStr = typeof completion.completion_date === 'string' 
            ? completion.completion_date.split('T')[0]
            : formatDateString(new Date(completion.completion_date))

          if (!completionsByPlanId.has(completion.plan_id)) {
            completionsByPlanId.set(completion.plan_id, new Map())
          }
          const planCompletions = completionsByPlanId.get(completion.plan_id)!
          if (!planCompletions.has(dateStr)) {
            planCompletions.set(dateStr, new Set())
          }
          planCompletions.get(dateStr)!.add(completion.exercise_id)
        }
      }
    }

    // Format plans (no await needed inside map)
    const plansArray = Array.isArray(plans) ? plans : []
    const formattedPlans = plansArray.map((plan: any) => {
      const exception = plan.worker_exceptions
      const user = Array.isArray(exception?.users) ? exception?.users[0] : exception?.users
      const team = Array.isArray(exception?.teams) ? exception?.teams[0] : exception?.teams

      // Generate case number using utility function
      const caseNumber = generateCaseNumber(exception?.id || plan.id, plan.created_at)

      // Sort exercises by order
      const exercises = (plan.rehabilitation_exercises || [])
        .sort((a: any, b: any) => a.exercise_order - b.exercise_order)
        .map((ex: any) => ({
          id: ex.id,
          exercise_name: ex.exercise_name,
          repetitions: ex.repetitions,
          instructions: ex.instructions,
          video_url: ex.video_url,
          exercise_order: ex.exercise_order,
        }))

      // Get completions for this plan from the pre-fetched map
      // Since each plan is for one exception (one worker), we can use all completions for the plan
      const completionsByDate = completionsByPlanId.get(plan.id) || new Map()

      // Calculate progress based on actual completions
      // Parse dates using utility function to avoid timezone issues
      const startDate = parseDateString(plan.start_date)
      const endDate = parseDateString(plan.end_date)
      
      // Get today's date
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      today.setHours(0, 0, 0, 0)
      
      // Calculate total days (inclusive: start and end dates both count)
      const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1

      // LOGIC: 
      // Day 1 = start_date (date when clinician assigned the plan)
      // Example: If plan assigned on November 3, 2025:
      //   - Day 1 = November 3, 2025
      //   - Day 2 = November 4, 2025
      //   - Day 3 = November 5, 2025
      //   - ... Day 7 = November 9, 2025 (if 7 days duration)
      // Only count completions from start_date onwards
      // Current day is the first day where not all exercises are completed
      
      let currentDay = 1
      let daysCompleted = 0
      const currentTime = new Date() // Current date and time (not just date)
      
      // Iterate through each day from start date (Day 1 = start_date)
      // IMPORTANT: Even if a day is completed, we don't advance to next day until 6:00 AM of the next day
      for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
        const dayDate = new Date(startDate)
        dayDate.setDate(dayDate.getDate() + dayOffset)
        const dayDateStr = formatDateString(dayDate)
        const dayNumber = dayOffset + 1

        // If this day is in the future, stop here
        if (dayDate > today) {
          currentDay = dayNumber
          break
        }

        // Check completions for this exact date
        const dayCompletions = completionsByDate.get(dayDateStr) || new Set()
        
        // Check if all exercises for this day are completed
        if (exercises.length === 0) {
          currentDay = dayNumber
          break
        }
        
        const allExercisesCompleted = exercises.length > 0 && 
          exercises.every((ex: any) => dayCompletions.has(ex.id))
        
        if (allExercisesCompleted) {
          daysCompleted++
          
          // Check if we can advance to next day (must be past 6:00 AM of next day)
          if (dayOffset < totalDays - 1) {
            const nextDayDate = new Date(dayDate)
            nextDayDate.setDate(dayDate.getDate() + 1)
            nextDayDate.setHours(6, 0, 0, 0)
            
            if (currentTime >= nextDayDate) {
              currentDay = dayNumber + 1
              // Continue to check next day
            } else {
              currentDay = dayNumber
              break
            }
          } else {
            currentDay = totalDays
            break
          }
        } else {
          currentDay = dayNumber
          break
        }
      }

      // Ensure currentDay doesn't exceed totalDays
      currentDay = Math.min(currentDay, totalDays)

      // Calculate progress based on completed days
      const progress = totalDays > 0 ? Math.round((daysCompleted / totalDays) * 100) : 0

      return {
        id: plan.id,
        exceptionId: plan.exception_id,
        caseNumber,
        workerId: user?.id || '',
        workerName: formatUserName(user),
        workerEmail: user?.email || '',
        teamName: team?.name || '',
        siteLocation: team?.site_location || '',
        plan_name: plan.plan_name || 'Recovery Plan',
        plan_description: plan.plan_description || 'Daily recovery exercises and activities',
        duration: totalDays,
        startDate: plan.start_date,
        endDate: plan.end_date,
        progress,
        currentDay,
        daysCompleted,
        status: plan.status,
        notes: plan.notes || '',
        exercises,
        createdAt: plan.created_at,
        updatedAt: plan.updated_at,
      }
    })

    return c.json({ plans: formattedPlans })
  } catch (error: any) {
    console.error('[GET /clinician/rehabilitation-plans] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Create rehabilitation plan
clinician.post('/rehabilitation-plans', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { 
      exception_id, 
      plan_name, 
      plan_description, 
      duration_days,
      start_date, // Optional: if not provided, defaults to today
      exercises 
    } = await c.req.json()

    // Validate required fields
    if (!exception_id || typeof exception_id !== 'string') {
      return c.json({ error: 'exception_id is required and must be a string' }, 400)
    }
    
    const sanitizedPlanName = sanitizeString(plan_name, 255)
    if (!sanitizedPlanName) {
      return c.json({ error: 'plan_name is required' }, 400)
    }

    if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
      return c.json({ error: 'At least one exercise is required' }, 400)
    }

    // Validate exercises with sanitization
    const maxExercises = 50 // Prevent excessive exercises
    if (exercises.length > maxExercises) {
      return c.json({ error: `Maximum ${maxExercises} exercises allowed` }, 400)
    }
    
    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i]
      const exerciseName = sanitizeString(exercise?.exercise_name, 255)
      if (!exerciseName) {
        return c.json({ error: `Exercise ${i + 1}: exercise_name is required` }, 400)
      }
    }

    // Validate and parse start_date
    let startDate: Date
    let startDateStr: string
    
    if (start_date && typeof start_date === 'string') {
      const validation = validateDateInput(start_date)
      if (!validation.valid || !validation.date) {
        return c.json({ error: validation.error || 'Invalid start_date' }, 400)
      }
      startDate = validation.date
      startDateStr = formatDateString(startDate)
      debugLog(`Using provided start_date: ${start_date} -> ${startDateStr}`)
    } else {
      // Default to today if not provided
      const now = new Date()
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      startDate.setHours(0, 0, 0, 0)
      startDateStr = formatDateString(startDate)
      debugLog(`No start_date provided, defaulting to today: ${startDateStr}`)
    }
    
    // Validate duration_days
    const duration = parseInt(String(duration_days))
    if (isNaN(duration) || duration < 1 || duration > 365) {
      return c.json({ error: 'duration_days must be between 1 and 365' }, 400)
    }
    
    // End date = start_date + (duration_days - 1) because start_date is Day 1
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + duration - 1)
    const endDateStr = formatDateString(endDate)
    
    debugLog(`Creating plan: startDate=${startDateStr}, endDate=${endDateStr}, duration=${duration}`)

    const adminClient = getAdminClient()

    // SECURITY: Check if exception exists AND belongs to this clinician
    const { data: exception, error: exceptionError } = await adminClient
      .from('worker_exceptions')
      .select('id, clinician_id')
      .eq('id', exception_id)
      .single()

    if (exceptionError || !exception) {
      return c.json({ error: 'Exception not found' }, 404)
    }

    // SECURITY: Ensure clinician can only create plans for their assigned cases
    if (exception.clinician_id !== user.id) {
      console.error(`[POST /clinician/rehabilitation-plans] SECURITY: User ${user.id} attempted to create plan for exception ${exception_id} assigned to clinician ${exception.clinician_id}`)
      return c.json({ error: 'Forbidden: You can only create plans for cases assigned to you' }, 403)
    }

    // Check if plan already exists for this exception
    const { data: existingPlan } = await adminClient
      .from('rehabilitation_plans')
      .select('id')
      .eq('exception_id', exception_id)
      .eq('status', 'active')
      .single()

    if (existingPlan) {
      return c.json({ error: 'Active rehabilitation plan already exists for this case' }, 400)
    }

    // Create plan with sanitized inputs
    const sanitizedDescription = sanitizeString(plan_description, 2000)
    const { data: plan, error: planError } = await adminClient
      .from('rehabilitation_plans')
      .insert({
        exception_id,
        clinician_id: user.id,
        plan_name: sanitizedPlanName,
        plan_description: sanitizedDescription || 'Daily recovery exercises and activities',
        start_date: startDateStr,
        end_date: endDateStr,
        status: 'active',
        notes: null,
      })
      .select()
      .single()

    if (planError) {
      console.error('[POST /clinician/rehabilitation-plans] Error:', planError)
      return c.json({ error: 'Failed to create rehabilitation plan', details: planError.message }, 500)
    }

    // Create exercises with sanitized inputs
    const exercisesToInsert = exercises.map((exercise: any, index: number) => ({
      plan_id: plan.id,
      exercise_name: sanitizeString(exercise.exercise_name, 255),
      repetitions: sanitizeString(exercise.repetitions, 100) || null,
      instructions: sanitizeString(exercise.instructions, 5000) || null,
      video_url: sanitizeString(exercise.video_url, 500) || null,
      exercise_order: index,
    }))

    const { data: insertedExercises, error: exercisesError } = await adminClient
      .from('rehabilitation_exercises')
      .insert(exercisesToInsert)
      .select()

    if (exercisesError) {
      console.error('[POST /clinician/rehabilitation-plans] Error inserting exercises:', exercisesError)
      // Rollback: delete the plan if exercises fail
      await adminClient
        .from('rehabilitation_plans')
        .delete()
        .eq('id', plan.id)
      return c.json({ error: 'Failed to create exercises', details: exercisesError.message }, 500)
    }

    return c.json({ 
      plan: { ...plan, exercises: insertedExercises }, 
      message: 'Rehabilitation plan created successfully' 
    }, 201)
  } catch (error: any) {
    console.error('[POST /clinician/rehabilitation-plans] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update rehabilitation plan
clinician.patch('/rehabilitation-plans/:id', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const planId = c.req.param('id')
    
    // Validate planId is UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(planId)) {
      return c.json({ error: 'Invalid plan ID format' }, 400)
    }
    
    const { start_date, end_date, status, notes } = await c.req.json()

    const adminClient = getAdminClient()

    // SECURITY: Verify plan exists AND belongs to this clinician
    const { data: plan, error: planError } = await adminClient
      .from('rehabilitation_plans')
      .select('id, clinician_id')
      .eq('id', planId)
      .single()

    if (planError || !plan) {
      return c.json({ error: 'Rehabilitation plan not found' }, 404)
    }

    // SECURITY: Ensure clinician can only update their own plans
    if (plan.clinician_id !== user.id) {
      console.error(`[PATCH /clinician/rehabilitation-plans/:id] SECURITY: User ${user.id} attempted to update plan ${planId} owned by ${plan.clinician_id}`)
      return c.json({ error: 'Forbidden: You can only update your own rehabilitation plans' }, 403)
    }

    // Build update object with validation
    const updates: any = {}
    
    if (start_date) {
      const validation = validateDateInput(start_date)
      if (!validation.valid || !validation.date) {
        return c.json({ error: validation.error || 'Invalid start_date' }, 400)
      }
      updates.start_date = formatDateString(validation.date)
    }
    
    if (end_date) {
      const validation = validateDateInput(end_date)
      if (!validation.valid || !validation.date) {
        return c.json({ error: validation.error || 'Invalid end_date' }, 400)
      }
      updates.end_date = formatDateString(validation.date)
      
      // Validate end_date >= start_date
      if (updates.start_date && updates.end_date < updates.start_date) {
        return c.json({ error: 'end_date must be greater than or equal to start_date' }, 400)
      }
    }
    
    if (status) {
      const validStatuses = ['active', 'completed', 'cancelled']
      if (!validStatuses.includes(status)) {
        return c.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, 400)
      }
      updates.status = status
    }
    
    if (notes !== undefined) {
      updates.notes = sanitizeString(notes, 5000) || null
    }
    
    updates.updated_at = new Date().toISOString()

    const { data: updatedPlan, error: updateError } = await adminClient
      .from('rehabilitation_plans')
      .update(updates)
      .eq('id', planId)
      .select()
      .single()

    if (updateError) {
      console.error('[PATCH /clinician/rehabilitation-plans/:id] Error:', updateError)
      return c.json({ error: 'Failed to update rehabilitation plan', details: updateError.message }, 500)
    }

    return c.json({ plan: updatedPlan, message: 'Rehabilitation plan updated successfully' })
  } catch (error: any) {
    console.error('[PATCH /clinician/rehabilitation-plans/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update case status
clinician.patch('/cases/:id/status', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const caseId = c.req.param('id')
    const { status, return_to_work_duty_type, return_to_work_date } = await c.req.json()

    // SECURITY: Validate case ID format (UUID)
    if (!caseId || typeof caseId !== 'string' || caseId.length > 36) {
      return c.json({ error: 'Invalid case ID format' }, 400)
    }
    
    // SECURITY: Validate that return to work fields are only provided when status is return_to_work
    if (status !== 'return_to_work' && (return_to_work_duty_type || return_to_work_date)) {
      return c.json({ error: 'Return to work fields can only be set when status is return_to_work' }, 400)
    }

    // Security: Validate status using centralized utility
    if (!status || !isValidCaseStatus(status)) {
      return c.json({ 
        error: `status must be one of: ${['new', 'triaged', 'assessed', 'in_rehab', 'return_to_work', 'closed'].join(', ')}` 
      }, 400)
    }

    const adminClient = getAdminClient()

    // OPTIMIZATION: Single query to get case with notes (reduces database round trips)
    const { data: caseItem, error: caseError } = await adminClient
      .from('worker_exceptions')
      .select('id, clinician_id, is_active, start_date, end_date, notes, return_to_work_duty_type, return_to_work_date')
      .eq('id', caseId)
      .eq('clinician_id', user.id)
      .single()

    if (caseError || !caseItem) {
      return c.json({ error: 'Case not found or not assigned to you' }, 404)
    }

    // BUSINESS RULE: Check for active rehabilitation plans before allowing return_to_work or closed
    if (status === 'return_to_work' || status === 'closed') {
      const { data: activePlans, error: plansError } = await adminClient
        .from('rehabilitation_plans')
        .select('id, status')
        .eq('exception_id', caseId)
        .eq('status', 'active')
        .limit(1)

      if (plansError) {
        console.error('[PATCH /clinician/cases/:id/status] Error checking rehabilitation plans:', plansError)
        return c.json({ error: 'Failed to check rehabilitation plans', details: plansError.message }, 500)
      }

      if (activePlans && activePlans.length > 0) {
        return c.json({ 
          error: 'Cannot update case status while active rehabilitation plans exist',
          details: 'Please complete or cancel all active rehabilitation plans before marking the case as "Return to Work" or "Closed".'
        }, 400)
      }
    }

    // OPTIMIZATION: Use user from auth context (already available, no need for extra query)
    // Only fetch from DB if we need additional user fields not in auth context
    const clinicianName = formatUserName(user)

    // OPTIMIZATION: Use centralized notes parser
    const parsedNotes = parseIncidentNotes(caseItem.notes)
    let notesData: any = parsedNotes || {}
    
    // Preserve original notes if not JSON
    if (caseItem.notes && !parsedNotes) {
      notesData = { original_notes: caseItem.notes }
    }
    
    // BUSINESS RULE: If case is already "return_to_work", prevent changing back to earlier statuses
    const currentCaseStatus = notesData?.case_status?.toLowerCase() || 
                             (caseItem.return_to_work_duty_type ? 'return_to_work' : null)
    
    if (currentCaseStatus === 'return_to_work') {
      // Only allow changing to "closed" or keeping as "return_to_work"
      const restrictedStatuses = ['new', 'triaged', 'assessed', 'in_rehab']
      if (restrictedStatuses.includes(status.toLowerCase())) {
        return c.json({ 
          error: 'Cannot change status back to earlier stages once case is set to "Return to Work"',
          details: 'Once a case has been marked as "Return to Work", it can only be changed to "Closed" or remain as "Return to Work".'
        }, 400)
      }
    }

    // Prepare updates based on status
    const now = new Date()
    const updates: any = {
      updated_at: now.toISOString(),
    }
    
    // Update case_status in notes
    const timestamp = now.toISOString()
    notesData.case_status = status
    notesData.case_status_updated_at = timestamp
    
    // If case is being closed, store approval information
    if (status === 'closed' || status === 'return_to_work') {
      notesData.approved_by = clinicianName
      notesData.approved_by_id = user.id
      notesData.approved_at = timestamp
    }
    
    updates.notes = JSON.stringify(notesData)

    // OPTIMIZATION: Pre-calculate date string once
    const todayDateStr = dateToDateString(now)

    // Handle status-specific updates
    if (status === 'closed') {
      updates.is_active = false
      if (!caseItem.end_date) {
        updates.end_date = todayDateStr
      }
    } else if (status === 'in_rehab') {
      updates.is_active = true
    } else if (status === 'return_to_work') {
      updates.is_active = false
      updates.end_date = todayDateStr
      
      // SECURITY: Validate and set return to work fields
      if (!return_to_work_duty_type || typeof return_to_work_duty_type !== 'string') {
        return c.json({ error: 'Return to work requires duty type' }, 400)
      }
      
      if (!return_to_work_date || typeof return_to_work_date !== 'string') {
        return c.json({ error: 'Return to work requires return date' }, 400)
      }
      
      // SECURITY: Validate duty type (whitelist approach with type safety)
      const validDutyTypes = ['modified', 'full'] as const
      const normalizedDutyType = return_to_work_duty_type.trim().toLowerCase()
      if (!validDutyTypes.includes(normalizedDutyType as typeof validDutyTypes[number])) {
        return c.json({ error: 'Duty type must be either "modified" or "full"' }, 400)
      }
      
      // SECURITY: Validate and format date using centralized utility
      const dateValidation = validateDateInput(return_to_work_date)
      if (!dateValidation.valid || !dateValidation.date) {
        return c.json({ error: dateValidation.error || 'Invalid return date format. Expected YYYY-MM-DD' }, 400)
      }
      
      // OPTIMIZATION: Prevent setting return date in the past (business logic)
      const returnDate = dateValidation.date!
      returnDate.setHours(0, 0, 0, 0)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      if (returnDate < today) {
        return c.json({ error: 'Return date cannot be in the past' }, 400)
      }
      
      // Format date to YYYY-MM-DD using utility function
      const formattedReturnDate = formatDateString(returnDate)
      
      // SECURITY: Sanitize duty type (use already normalized value)
      updates.return_to_work_duty_type = normalizedDutyType
      updates.return_to_work_date = formattedReturnDate
    } else {
      updates.is_active = true
    }

    const { data: updatedCase, error: updateError } = await adminClient
      .from('worker_exceptions')
      .update(updates)
      .eq('id', caseId)
      .select()
      .single()

    if (updateError) {
      console.error('[PATCH /clinician/cases/:id/status] Error:', updateError)
      return c.json({ error: 'Failed to update case status', details: updateError.message }, 500)
    }

    // OPTIMIZATION: Create notifications when case is closed/returned to work
    if (status === 'closed' || status === 'return_to_work') {
      try {
        // OPTIMIZATION: Single query to get case details with worker and team info
          const { data: caseDetails } = await adminClient
            .from('worker_exceptions')
            .select(`
              id,
              created_at,
              user_id,
              users!worker_exceptions_user_id_fkey(
                id,
                email,
                first_name,
                last_name,
                full_name
              ),
              teams!worker_exceptions_team_id_fkey(
                id,
                name,
                site_location,
              supervisor_id,
              team_leader_id
              )
            `)
            .eq('id', caseId)
            .single()

        if (!caseDetails) return

        // OPTIMIZATION: Calculate common values once
        const caseNumber = generateCaseNumber(caseDetails.id, caseDetails.created_at)
          const worker = Array.isArray(caseDetails.users) ? caseDetails.users[0] : caseDetails.users
          const workerName = formatUserName(worker)
          const team = Array.isArray(caseDetails.teams) ? caseDetails.teams[0] : caseDetails.teams
            const statusLabel = status === 'closed' ? 'CLOSED' : 'RETURN TO WORK'
            const statusAction = status === 'closed' ? 'closed' : 'marked as return to work'
            
        // OPTIMIZATION: Build return to work details once
        let returnToWorkSuffix = ''
            if (status === 'return_to_work' && updates.return_to_work_duty_type && updates.return_to_work_date) {
              const dutyTypeLabel = formatDutyTypeLabel(updates.return_to_work_duty_type)
              const formattedReturnDate = formatReturnDateForNotification(updates.return_to_work_date)
          returnToWorkSuffix = ` Duty Type: ${dutyTypeLabel}. Return Date: ${formattedReturnDate}.`
            }
            
        // OPTIMIZATION: Build common notification data once
        const baseNotificationData = {
                case_id: caseId,
                case_number: caseNumber,
                worker_id: caseDetails.user_id,
                worker_name: workerName,
                worker_email: worker?.email || '',
                team_id: team?.id || null,
                team_name: team?.name || '',
                site_location: team?.site_location || '',
                status: status,
                status_label: statusLabel,
                approved_by: clinicianName,
                approved_by_id: user.id,
                approved_at: timestamp,
                clinician_id: user.id,
                clinician_name: clinicianName,
                ...(status === 'return_to_work' && {
                  return_to_work_duty_type: updates.return_to_work_duty_type,
                  return_to_work_date: updates.return_to_work_date,
                }),
        }

        // OPTIMIZATION: Build base message once
        const baseMessage = `Case ${caseNumber} has been ${statusAction} and approved by ${clinicianName}. Worker: ${workerName}.${returnToWorkSuffix}`
        const workerMessage = `Your case ${caseNumber} has been ${statusAction} and approved by ${clinicianName}.${returnToWorkSuffix}`

        // OPTIMIZATION: Batch fetch all users in parallel
        const [whsUsersResult, supervisorResult, teamLeaderResult] = await Promise.all([
          adminClient
              .from('users')
            .select('id')
            .eq('role', 'whs_control_center'),
          team?.supervisor_id
            ? adminClient
                .from('users')
                .select('id')
              .eq('id', team.supervisor_id)
              .eq('role', 'supervisor')
              .single()
            : Promise.resolve({ data: null }),
          team?.team_leader_id
            ? adminClient
                .from('users')
                .select('id')
                .eq('id', team.team_leader_id)
                .eq('role', 'team_leader')
                .single()
            : Promise.resolve({ data: null }),
        ])

        const whsUsers = whsUsersResult.data || []
        const supervisor = supervisorResult.data
        const teamLeader = teamLeaderResult.data
              
        // OPTIMIZATION: Build all notifications in one array
        const allNotifications: any[] = []

        // WHS users notifications
        if (Array.isArray(whsUsers) && whsUsers.length > 0) {
          allNotifications.push(
            ...whsUsers.map((whsUser: any) => ({
              user_id: whsUser.id,
              type: 'case_closed',
              title: `✅ Case ${statusLabel}`,
              message: baseMessage,
              data: baseNotificationData,
              is_read: false,
            }))
          )
        }

        // Supervisor notification
        if (supervisor) {
          allNotifications.push({
                user_id: supervisor.id,
                type: 'case_closed',
                title: `✅ Case ${statusLabel}`,
            message: baseMessage,
            data: baseNotificationData,
                is_read: false,
          })
        }

        // Team leader notification
        if (teamLeader) {
          allNotifications.push({
            user_id: teamLeader.id,
            type: 'case_closed',
            title: `✅ Case ${statusLabel}`,
            message: baseMessage,
            data: baseNotificationData,
            is_read: false,
          })
        }

        // Worker notification
        if (caseDetails.user_id) {
          allNotifications.push({
            user_id: caseDetails.user_id,
            type: 'case_closed',
            title: `✅ Case ${statusLabel}`,
            message: workerMessage,
            data: baseNotificationData,
            is_read: false,
          })
        }

        // OPTIMIZATION: Insert all notifications in a single batch
        if (allNotifications.length > 0) {
          const { error: notifyError } = await adminClient
                .from('notifications')
            .insert(allNotifications)

          if (notifyError) {
            console.error('[PATCH /clinician/cases/:id/status] Error creating notifications:', notifyError)
          } else {
            console.log(`[PATCH /clinician/cases/:id/status] Created ${allNotifications.length} notification(s) for case ${caseNumber} (${statusLabel})`)
          }
        }
      } catch (notificationError: any) {
        console.error('[PATCH /clinician/cases/:id/status] Error in notification process:', notificationError)
        // Don't fail the request if notifications fail - case is still updated
      }
    }

    return c.json({ 
      case: updatedCase,
      status,
      message: 'Case status updated successfully' 
    })
  } catch (error: any) {
    console.error('[PATCH /clinician/cases/:id/status] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update case notes
clinician.post('/cases/:id/notes', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const caseId = c.req.param('id')
    const { notes } = await c.req.json()

    // SECURITY: Validate case ID format
    if (!caseId || typeof caseId !== 'string' || caseId.length > 36) {
      return c.json({ error: 'Invalid case ID format' }, 400)
    }

    // SECURITY: Validate notes
    if (notes !== undefined && typeof notes !== 'string') {
      return c.json({ error: 'Notes must be a string' }, 400)
    }

    // SECURITY: Sanitize and limit notes length
    const sanitizedNotes = notes ? sanitizeString(notes, 10000) : null

    const adminClient = getAdminClient()

    // Verify case exists and belongs to this clinician
    const { data: caseItem, error: caseError } = await adminClient
      .from('worker_exceptions')
      .select('id, clinician_id, notes')
      .eq('id', caseId)
      .eq('clinician_id', user.id)
      .single()

    if (caseError || !caseItem) {
      return c.json({ error: 'Case not found or not assigned to you' }, 404)
    }

    // OPTIMIZATION: Use centralized notes parser
    const parsedNotes = parseIncidentNotes(caseItem.notes)
    let notesData: any = parsedNotes || {}
    
    // Preserve original notes if not JSON
    if (caseItem.notes && !parsedNotes) {
      notesData = { original_notes: caseItem.notes, clinical_notes: sanitizedNotes }
    }

    // Update clinical notes
    notesData.clinical_notes = sanitizedNotes
    notesData.clinical_notes_updated_at = new Date().toISOString()
    notesData.clinical_notes_updated_by = user.id

    // Update case with new notes
    const { data: updatedCase, error: updateError } = await adminClient
      .from('worker_exceptions')
      .update({
        notes: JSON.stringify(notesData),
        updated_at: new Date().toISOString(),
      })
      .eq('id', caseId)
      .select()
      .single()

    if (updateError) {
      console.error('[POST /clinician/cases/:id/notes] Error:', updateError)
      return c.json({ error: 'Failed to update notes', details: updateError.message }, 500)
    }

    return c.json({
      case: updatedCase,
      message: 'Notes updated successfully'
    })
  } catch (error: any) {
    console.error('[POST /clinician/cases/:id/notes] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get notifications for clinician
clinician.get('/notifications', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)
    const unreadOnly = c.req.query('unread_only') === 'true'

    const adminClient = getAdminClient()

    let query = adminClient
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.eq('is_read', false)
    }

    const { data: notifications, error } = await query

    if (error) {
      console.error('[GET /clinician/notifications] Error:', error)
      return c.json({ error: 'Failed to fetch notifications', details: error.message }, 500)
    }

    const { count: unreadCount, error: countError } = await adminClient
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)

    if (countError) {
      console.error('[GET /clinician/notifications] Error counting unread:', countError)
    }

    return c.json({
      notifications: notifications || [],
      unreadCount: unreadCount || 0,
    })
  } catch (error: any) {
    console.error('[GET /clinician/notifications] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark notification as read
clinician.patch('/notifications/:notificationId/read', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const notificationId = c.req.param('notificationId')
    const adminClient = getAdminClient()

    const { data: notification, error: fetchError } = await adminClient
      .from('notifications')
      .select('id, user_id, is_read')
      .eq('id', notificationId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !notification) {
      return c.json({ error: 'Notification not found' }, 404)
    }

    if (notification.is_read) {
      return c.json({ message: 'Notification already read' })
    }

    const { data: updated, error: updateError } = await adminClient
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId)
      .eq('user_id', user.id)
      .select()
      .single()

    if (updateError) {
      console.error('[PATCH /clinician/notifications/:id/read] Error:', updateError)
      return c.json({ error: 'Failed to mark notification as read', details: updateError.message }, 500)
    }

    return c.json({ notification: updated })
  } catch (error: any) {
    console.error('[PATCH /clinician/notifications/:id/read] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark all notifications as read
clinician.patch('/notifications/read-all', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    const { data: updated, error: updateError } = await adminClient
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('is_read', false)
      .select()

    if (updateError) {
      console.error('[PATCH /clinician/notifications/read-all] Error:', updateError)
      return c.json({ error: 'Failed to mark notifications as read', details: updateError.message }, 500)
    }

    return c.json({ 
      message: 'All notifications marked as read',
      count: updated?.length || 0,
    })
  } catch (error: any) {
    console.error('[PATCH /clinician/notifications/read-all] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get appointments for clinician
clinician.get('/appointments', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1
    const limit = Math.min(parseInt(c.req.query('limit') || '15'), 100)
    const status = c.req.query('status') || 'all'
    const dateFilter = c.req.query('date') || 'all' // 'today', 'week', 'upcoming', 'all'
    const search = c.req.query('search') || ''

    const adminClient = getAdminClient()
    const offset = (page - 1) * limit

    let query = adminClient
      .from('appointments')
      .select(`
        *,
        worker_exceptions!appointments_case_id_fkey(
          id,
          exception_type,
          reason,
          users!worker_exceptions_user_id_fkey(
            id,
            email,
            first_name,
            last_name,
            full_name
          ),
          teams!worker_exceptions_team_id_fkey(
            id,
            name,
            site_location
          )
        ),
        users!appointments_worker_id_fkey(
          id,
          email,
          first_name,
          last_name,
          full_name
        )
      `)
      .eq('clinician_id', user.id)
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true })

    // Filter by status
    if (status !== 'all') {
      query = query.eq('status', status)
    }

    // Filter by date
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = formatDateString(today)

    if (dateFilter === 'today') {
      query = query.eq('appointment_date', todayStr)
    } else if (dateFilter === 'week') {
      const weekFromNow = new Date(today)
      weekFromNow.setDate(weekFromNow.getDate() + 7)
      const weekStr = formatDateString(weekFromNow)
      query = query.gte('appointment_date', todayStr).lte('appointment_date', weekStr)
    } else if (dateFilter === 'upcoming') {
      query = query.gte('appointment_date', todayStr)
    }

    // Get count and data
    const countQuery = adminClient
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('clinician_id', user.id)

    if (status !== 'all') {
      countQuery.eq('status', status)
    }

    if (dateFilter === 'today') {
      countQuery.eq('appointment_date', todayStr)
    } else if (dateFilter === 'week') {
      const weekFromNow = new Date(today)
      weekFromNow.setDate(weekFromNow.getDate() + 7)
      const weekStr = formatDateString(weekFromNow)
      countQuery.gte('appointment_date', todayStr).lte('appointment_date', weekStr)
    } else if (dateFilter === 'upcoming') {
      countQuery.gte('appointment_date', todayStr)
    }

    const [countResult, appointmentsResult] = await Promise.all([
      countQuery,
      query.range(offset, offset + limit - 1)
    ])

    const { count } = countResult
    const { data: appointments, error } = appointmentsResult

    if (error) {
      console.error('[GET /clinician/appointments] Error:', error)
      console.error('[GET /clinician/appointments] Error details:', JSON.stringify(error, null, 2))
      return c.json({ error: 'Failed to fetch appointments', details: error.message }, 500)
    }

    // Log appointment count (no sensitive data)
    debugLog(`[GET /clinician/appointments] Found ${appointments?.length || 0} appointments`)

    // Format appointments
    let formattedAppointments = (appointments || []).map((apt: any) => {
      const exception = apt.worker_exceptions
      const worker = Array.isArray(exception?.users) ? exception?.users[0] : exception?.users
      const team = Array.isArray(exception?.teams) ? exception?.teams[0] : exception?.teams
      const workerUser = Array.isArray(apt.users) ? apt.users[0] : apt.users

      return {
        id: apt.id,
        caseId: apt.case_id,
        caseNumber: generateCaseNumber(exception?.id || apt.case_id, exception?.created_at || apt.created_at),
        workerId: apt.worker_id,
        workerName: formatUserName(workerUser || worker),
        workerEmail: workerUser?.email || worker?.email || '',
        teamName: team?.name || '',
        siteLocation: team?.site_location || '',
        appointmentDate: apt.appointment_date,
        appointmentTime: apt.appointment_time,
        durationMinutes: apt.duration_minutes,
        status: apt.status,
        appointmentType: apt.appointment_type,
        location: apt.location || '',
        notes: apt.notes || '',
        cancellationReason: apt.cancellation_reason || '',
        createdAt: apt.created_at,
        updatedAt: apt.updated_at,
      }
    })

    // Apply search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase()
      formattedAppointments = formattedAppointments.filter((apt: any) =>
        apt.workerName.toLowerCase().includes(searchLower) ||
        apt.workerEmail.toLowerCase().includes(searchLower) ||
        apt.caseNumber.toLowerCase().includes(searchLower) ||
        apt.teamName.toLowerCase().includes(searchLower)
      )
    }

    // OPTIMIZATION: Calculate all statistics in a single loop instead of multiple filters
    const weekFromNow = new Date(today)
    weekFromNow.setDate(weekFromNow.getDate() + 7)
    const weekStr = formatDateString(weekFromNow)
    const currentMonth = todayStr.substring(0, 7) // YYYY-MM format
    
    let todayAppointments = 0
    let weekAppointments = 0
    let completedThisMonth = 0
    let cancelledThisMonth = 0
    let confirmedCount = 0
    let pendingCount = 0
    let declinedCount = 0
    
    // Single loop for all statistics (O(n) instead of O(7n))
    for (const apt of formattedAppointments) {
      // Date-based counts
      if (apt.appointmentDate === todayStr) {
        todayAppointments++
      }
      if (apt.appointmentDate >= todayStr && apt.appointmentDate <= weekStr) {
        weekAppointments++
      }
      if (apt.appointmentDate?.substring(0, 7) === currentMonth) {
        if (apt.status === 'completed') completedThisMonth++
        if (apt.status === 'cancelled') cancelledThisMonth++
      }
      
      // Status-based counts
      if (apt.status === 'confirmed') confirmedCount++
      else if (apt.status === 'pending') pendingCount++
      else if (apt.status === 'declined') declinedCount++
    }

    return c.json({
      appointments: formattedAppointments,
      summary: {
        today: todayAppointments,
        thisWeek: weekAppointments,
        completedThisMonth,
        cancelledThisMonth,
        confirmed: confirmedCount,
        pending: pendingCount,
        declined: declinedCount,
      },
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
        hasNext: page < Math.ceil((count || 0) / limit),
        hasPrev: page > 1,
      },
    })
  } catch (error: any) {
    console.error('[GET /clinician/appointments] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Create appointment
clinician.post('/appointments', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const {
      case_id,
      appointment_date,
      appointment_time,
      duration_minutes = 30,
      appointment_type = 'consultation',
      location,
      notes,
    } = await c.req.json()

    // Validate required fields
    if (!case_id || typeof case_id !== 'string') {
      return c.json({ error: 'case_id is required' }, 400)
    }

    if (!appointment_date || typeof appointment_date !== 'string') {
      return c.json({ error: 'appointment_date is required' }, 400)
    }

    if (!appointment_time || typeof appointment_time !== 'string') {
      return c.json({ error: 'appointment_time is required' }, 400)
    }

    // Validate date
    const dateValidation = validateDateInput(appointment_date)
    if (!dateValidation.valid || !dateValidation.date) {
      return c.json({ error: dateValidation.error || 'Invalid appointment_date' }, 400)
    }

    // OPTIMIZATION: Validate and normalize time format
    const timeValidation = validateAndNormalizeTime(appointment_time)
    if (!timeValidation.valid || !timeValidation.normalized) {
      return c.json({ error: timeValidation.error || 'Invalid appointment_time format' }, 400)
    }
    const normalizedTime = timeValidation.normalized

    // Validate duration
    const duration = parseInt(String(duration_minutes))
    if (isNaN(duration) || duration < 15 || duration > 480) {
      return c.json({ error: 'duration_minutes must be between 15 and 480' }, 400)
    }

    // Validate appointment type
    const validTypes = ['consultation', 'follow_up', 'assessment', 'review', 'other']
    if (!validTypes.includes(appointment_type)) {
      return c.json({ error: `appointment_type must be one of: ${validTypes.join(', ')}` }, 400)
    }

    const adminClient = getAdminClient()

    // Verify case exists and is assigned to this clinician
    const { data: caseItem, error: caseError } = await adminClient
      .from('worker_exceptions')
      .select('id, user_id, clinician_id')
      .eq('id', case_id)
      .eq('clinician_id', user.id)
      .single()

    if (caseError || !caseItem) {
      return c.json({ error: 'Case not found or not assigned to you' }, 404)
    }

    // Check for conflicting appointments (same date/time)
    const appointmentDateStr = formatDateString(dateValidation.date!)
    const [hour, minute] = normalizedTime.split(':').map(Number)
    const appointmentStart = hour * 60 + minute
    const appointmentEnd = appointmentStart + duration

    // Check for conflicts with same date and overlapping time
    const { data: conflictingAppointments, error: conflictError } = await adminClient
      .from('appointments')
      .select('id, appointment_time, duration_minutes')
      .eq('clinician_id', user.id)
      .eq('appointment_date', appointmentDateStr)
      .in('status', ['pending', 'confirmed'])

    if (conflictError) {
      console.error('[POST /clinician/appointments] Error checking conflicts:', conflictError)
    } else if (conflictingAppointments && conflictingAppointments.length > 0) {
      // Check time overlap
      for (const conflict of conflictingAppointments) {
        const [conflictHour, conflictMin] = conflict.appointment_time.split(':').map(Number)
        const conflictStart = conflictHour * 60 + conflictMin
        const conflictEnd = conflictStart + (conflict.duration_minutes || 30)

        // Check if appointments overlap
        if ((appointmentStart < conflictEnd && appointmentEnd > conflictStart)) {
          return c.json({ 
            error: 'Appointment time conflicts with an existing appointment on the same date',
            details: `Conflicts with appointment at ${conflict.appointment_time}`
          }, 409)
        }
      }
    }

    // Create appointment
    const { data: appointment, error: appointmentError } = await adminClient
      .from('appointments')
      .insert({
        case_id,
        clinician_id: user.id,
        worker_id: caseItem.user_id,
        appointment_date: appointmentDateStr,
        appointment_time: normalizedTime,
        duration_minutes: duration,
        appointment_type,
        location: sanitizeString(location, 500) || null,
        notes: sanitizeString(notes, 2000) || null,
        status: 'pending',
      })
      .select()
      .single()

    if (appointmentError) {
      console.error('[POST /clinician/appointments] Error:', appointmentError)
      console.error('[POST /clinician/appointments] Error details:', JSON.stringify(appointmentError, null, 2))
      return c.json({ error: 'Failed to create appointment', details: appointmentError.message }, 500)
    }

    debugLog(`[POST /clinician/appointments] Created appointment ${appointment.id} for case ${case_id}, worker ${caseItem.user_id}`)

    // Create notification for worker (optimized - fetch in parallel)
    try {
      const [workerResult, caseResult] = await Promise.all([
        adminClient
          .from('users')
          .select('id, email, first_name, last_name, full_name')
          .eq('id', caseItem.user_id)
          .single(),
        adminClient
          .from('worker_exceptions')
          .select('id, created_at')
          .eq('id', case_id)
          .single()
      ])

      const { data: workerData, error: workerError } = workerResult
      const { data: caseData, error: caseError } = caseResult

      if (workerError || !workerData) {
        console.error('[POST /clinician/appointments] Error fetching worker data')
        throw new Error('Failed to fetch worker data')
      }

      const caseNumber = generateCaseNumber(caseData?.id || case_id, caseData?.created_at || appointment.created_at)
      const clinicianName = formatUserName(user)
      const workerName = formatUserName(workerData)

      // Format appointment date/time for message
      const appointmentDateFormatted = formatDateString(dateValidation.date!)
      const [hourStr, minStr] = appointment_time.split(':')
      const hourNum = parseInt(hourStr)
      const timeFormatted = `${hourNum % 12 || 12}:${minStr} ${hourNum >= 12 ? 'PM' : 'AM'}`

      const notification = {
        user_id: caseItem.user_id,
        type: 'system', // Use 'system' type as it's allowed in notifications schema
        title: '📅 New Appointment Scheduled',
        message: `You have a new appointment scheduled on ${appointmentDateFormatted} at ${timeFormatted}. Case: ${caseNumber}`,
        data: {
          appointment_id: appointment.id,
          case_id,
          case_number: caseNumber,
          clinician_id: user.id,
          clinician_name: clinicianName,
          appointment_date: appointmentDateStr,
          appointment_time,
          duration_minutes: duration,
          appointment_type,
          location: sanitizeString(location, 500) || null,
          status: 'pending',
        },
        is_read: false,
      }

      const { error: notifyError } = await adminClient
        .from('notifications')
        .insert([notification])

      if (notifyError) {
        console.error('[POST /clinician/appointments] Error creating notification:', notifyError.message)
        // Don't fail the request if notification fails
      } else {
        debugLog(`[POST /clinician/appointments] Notification created for worker ${caseItem.user_id}`)
      }
    } catch (notificationError: any) {
      console.error('[POST /clinician/appointments] Error in notification process:', notificationError)
      console.error('[POST /clinician/appointments] Error stack:', notificationError?.stack)
      // Don't fail the request if notifications fail
    }

    return c.json({
      appointment,
      message: 'Appointment created successfully',
    }, 201)
  } catch (error: any) {
    console.error('[POST /clinician/appointments] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update appointment
clinician.patch('/appointments/:id', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const appointmentId = c.req.param('id')
    
    // SECURITY: Validate appointment ID format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(appointmentId)) {
      return c.json({ error: 'Invalid appointment ID format' }, 400)
    }

    // SECURITY: Parse JSON with error handling
    let updates: any
    try {
      updates = await c.req.json()
    } catch (parseError: any) {
      console.error('[PATCH /clinician/appointments/:id] JSON parse error:', parseError)
      return c.json({ error: 'Invalid JSON in request body' }, 400)
    }
    
    // Validate that updates object exists and is not empty
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return c.json({ error: 'No updates provided' }, 400)
    }

    const adminClient = getAdminClient()

    // Verify appointment exists and belongs to this clinician
    const { data: appointment, error: appointmentError } = await adminClient
      .from('appointments')
      .select('id, clinician_id, status, appointment_date')
      .eq('id', appointmentId)
      .eq('clinician_id', user.id)
      .single()

    if (appointmentError || !appointment) {
      return c.json({ error: 'Appointment not found or not authorized' }, 404)
    }

    // Build update object
    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (updates.appointment_date) {
      const dateValidation = validateDateInput(updates.appointment_date)
      if (!dateValidation.valid || !dateValidation.date) {
        return c.json({ error: dateValidation.error || 'Invalid appointment_date' }, 400)
      }
      
      const appointmentDate = formatDateString(dateValidation.date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const appointmentDateObj = new Date(dateValidation.date)
      appointmentDateObj.setHours(0, 0, 0, 0)
      
      // Check if appointment date is in the past
      const isPastDate = appointmentDateObj < today
      
      // Get current or new status to determine if past dates are allowed
      const newStatus = updates.status || appointment.status
      const allowsPastDate = ['completed', 'cancelled', 'declined'].includes(newStatus)
      
      // If date is in the past and status doesn't allow it, return error
      if (isPastDate && !allowsPastDate) {
        return c.json({ 
          error: 'Cannot set appointment date in the past for pending or confirmed appointments. Please mark the appointment as completed, cancelled, or declined first.' 
        }, 400)
      }
      
      updateData.appointment_date = appointmentDate
    }

    if (updates.appointment_time !== undefined) {
      // OPTIMIZATION: Validate and normalize time format using helper
      const timeValidation = validateAndNormalizeTime(updates.appointment_time)
      if (!timeValidation.valid || !timeValidation.normalized) {
        return c.json({ error: timeValidation.error || 'Invalid appointment_time format' }, 400)
      }
      updateData.appointment_time = timeValidation.normalized
    }

    if (updates.duration_minutes !== undefined) {
      const duration = parseInt(String(updates.duration_minutes))
      if (isNaN(duration) || duration < 15 || duration > 480) {
        return c.json({ error: 'duration_minutes must be between 15 and 480' }, 400)
      }
      updateData.duration_minutes = duration
    }

    if (updates.status) {
      const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'declined']
      if (!validStatuses.includes(updates.status)) {
        return c.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, 400)
      }
      updateData.status = updates.status
    }

    if (updates.appointment_type) {
      const validTypes = ['consultation', 'follow_up', 'assessment', 'review', 'other']
      if (!validTypes.includes(updates.appointment_type)) {
        return c.json({ error: `appointment_type must be one of: ${validTypes.join(', ')}` }, 400)
      }
      updateData.appointment_type = updates.appointment_type
    }

    if (updates.location !== undefined) {
      updateData.location = sanitizeString(updates.location, 500) || null
    }

    if (updates.notes !== undefined) {
      updateData.notes = sanitizeString(updates.notes, 2000) || null
    }

    if (updates.cancellation_reason !== undefined) {
      updateData.cancellation_reason = sanitizeString(updates.cancellation_reason, 500) || null
    }

    const { data: updatedAppointment, error: updateError } = await adminClient
      .from('appointments')
      .update(updateData)
      .eq('id', appointmentId)
      .select()
      .single()

    if (updateError) {
      console.error('[PATCH /clinician/appointments/:id] Error:', updateError)
      return c.json({ error: 'Failed to update appointment', details: updateError.message }, 500)
    }

    return c.json({
      appointment: updatedAppointment,
      message: 'Appointment updated successfully',
    })
  } catch (error: any) {
    console.error('[PATCH /clinician/appointments/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Delete appointment
clinician.delete('/appointments/:id', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const appointmentId = c.req.param('id')
    
    // Validate appointment ID format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(appointmentId)) {
      return c.json({ error: 'Invalid appointment ID format' }, 400)
    }

    const adminClient = getAdminClient()

    // Verify appointment exists and belongs to this clinician
    const { data: appointment, error: appointmentError } = await adminClient
      .from('appointments')
      .select('id, clinician_id')
      .eq('id', appointmentId)
      .eq('clinician_id', user.id)
      .single()

    if (appointmentError || !appointment) {
      return c.json({ error: 'Appointment not found or not authorized' }, 404)
    }

    const { error: deleteError } = await adminClient
      .from('appointments')
      .delete()
      .eq('id', appointmentId)

    if (deleteError) {
      console.error('[DELETE /clinician/appointments/:id] Error:', deleteError)
      return c.json({ error: 'Failed to delete appointment', details: deleteError.message }, 500)
    }

    return c.json({ message: 'Appointment deleted successfully' })
  } catch (error: any) {
    console.error('[DELETE /clinician/appointments/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Transcribe audio using Whisper API
clinician.post('/transcribe', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // SECURITY: Validate request has audio file
    let formData: FormData
    try {
      formData = await c.req.formData()
    } catch (formError: any) {
      console.error('[POST /clinician/transcribe] FormData parsing error:', formError)
      return c.json({ 
        error: 'Failed to parse form data', 
        details: formError.message || 'Invalid request format. Please ensure the audio file is properly formatted.' 
      }, 400)
    }

    const audioFile = formData.get('audio') as File | null

    if (!audioFile) {
      return c.json({ error: 'Audio file is required' }, 400)
    }

    // SECURITY: Validate file type
    const allowedTypes = ['audio/webm', 'audio/mp3', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/flac']
    if (!allowedTypes.includes(audioFile.type)) {
      return c.json({ error: 'Invalid audio file type. Supported: webm, mp3, wav, mpeg, mp4, m4a, ogg, flac' }, 400)
    }

    // SECURITY: Validate file size (max 25MB for Whisper API)
    const maxSize = 25 * 1024 * 1024 // 25MB
    if (audioFile.size > maxSize) {
      return c.json({ error: 'Audio file too large. Maximum size is 25MB' }, 400)
    }

    // Log file info for debugging
    // NOTE: Frontend now sends optimized audio (16kHz mono) for cost efficiency
    // This reduces file size by ~75% while maintaining excellent transcription quality
    console.log(`[POST /clinician/transcribe] Processing optimized audio file: ${audioFile.size} bytes, type: ${audioFile.type}`)

    // Import transcription function
    const { transcribeAudio } = await import('../utils/openai.js')

    // Pass the File object directly - the transcribeAudio function will handle conversion
    // Transcribe audio
    const transcription = await transcribeAudio(audioFile)

    return c.json({
      transcription,
      message: 'Audio transcribed successfully'
    })
  } catch (error: any) {
    console.error('[POST /clinician/transcribe] Error:', error)
    
    // Provide more specific error messages
    if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      return c.json({ 
        error: 'Transcription timeout', 
        details: 'The audio file is too long or the transcription service is taking too long. Please try with a shorter recording.' 
      }, 504)
    }
    
    if (error.message?.includes('API key')) {
      return c.json({ 
        error: 'Configuration error', 
        details: 'OpenAI API key is not configured properly.' 
      }, 500)
    }

    return c.json({ 
      error: 'Transcription failed', 
      details: error.message || 'Unknown error occurred during transcription' 
    }, 500)
  }
})

// Analyze transcription using OpenAI
clinician.post('/analyze-transcription', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { transcription, context } = await c.req.json()

    // SECURITY: Validate transcription input
    if (!transcription || typeof transcription !== 'string' || transcription.trim().length === 0) {
      return c.json({ error: 'Transcription text is required' }, 400)
    }

    // SECURITY: Validate transcription length (max 10,000 characters)
    if (transcription.length > 10000) {
      return c.json({ error: 'Transcription too long. Maximum length is 10,000 characters' }, 400)
    }

    // SECURITY: Validate context if provided
    if (context && (typeof context !== 'string' || context.length > 500)) {
      return c.json({ error: 'Context must be a string with maximum 500 characters' }, 400)
    }

    // Import analysis function
    const { analyzeTranscription } = await import('../utils/openai.js')

    // Analyze transcription
    const analysis = await analyzeTranscription({
      transcription: transcription.trim(),
      context: context?.trim() || undefined
    })

    return c.json({
      analysis,
      message: 'Transcription analyzed successfully'
    })
  } catch (error: any) {
    console.error('[POST /clinician/analyze-transcription] Error:', error)
    return c.json({ 
      error: 'Analysis failed', 
      details: error.message || 'Unknown error' 
    }, 500)
  }
})

// Save transcription to database
clinician.post('/transcriptions', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { 
      transcription_text, 
      analysis, 
      recording_duration_seconds,
      estimated_cost,
      audio_file_size_bytes,
      clinical_notes,
      appointment_id
    } = await c.req.json()

    // SECURITY: Validate transcription text
    if (!transcription_text || typeof transcription_text !== 'string' || transcription_text.trim().length === 0) {
      return c.json({ error: 'Transcription text is required' }, 400)
    }

    // SECURITY: Validate transcription length (max 50,000 characters)
    if (transcription_text.length > 50000) {
      return c.json({ error: 'Transcription too long. Maximum length is 50,000 characters' }, 400)
    }

    // SECURITY: Validate optional fields
    if (recording_duration_seconds !== undefined && (typeof recording_duration_seconds !== 'number' || recording_duration_seconds < 0)) {
      return c.json({ error: 'Recording duration must be a non-negative number' }, 400)
    }

    if (estimated_cost !== undefined && (typeof estimated_cost !== 'number' || estimated_cost < 0)) {
      return c.json({ error: 'Estimated cost must be a non-negative number' }, 400)
    }

    if (audio_file_size_bytes !== undefined && (typeof audio_file_size_bytes !== 'number' || audio_file_size_bytes < 0)) {
      return c.json({ error: 'Audio file size must be a non-negative number' }, 400)
    }

    // SECURITY: Validate analysis if provided (must be object)
    if (analysis !== undefined && (typeof analysis !== 'object' || Array.isArray(analysis) || analysis === null)) {
      return c.json({ error: 'Analysis must be a valid object' }, 400)
    }

    // SECURITY: Validate clinical notes if provided
    if (clinical_notes !== undefined && clinical_notes !== null && typeof clinical_notes !== 'string') {
      return c.json({ error: 'Clinical notes must be a string' }, 400)
    }

    // SECURITY: Validate and sanitize clinical notes
    const sanitizedClinicalNotes = clinical_notes ? sanitizeString(clinical_notes, 10000) : null

    // SECURITY: Validate appointment_id if provided (must be UUID)
    if (appointment_id !== undefined && appointment_id !== null) {
      if (typeof appointment_id !== 'string' || appointment_id.length > 36) {
        return c.json({ error: 'Invalid appointment ID format' }, 400)
      }
      
      const adminClient = getAdminClient()
      // Verify appointment exists and belongs to this clinician
      const { data: appointment, error: appointmentError } = await adminClient
        .from('appointments')
        .select('id, clinician_id')
        .eq('id', appointment_id)
        .eq('clinician_id', user.id)
        .single()

      if (appointmentError || !appointment) {
        return c.json({ error: 'Appointment not found or not authorized' }, 404)
      }
    }

    const adminClient = getAdminClient()

    // SECURITY: Ensure transcription is saved with the logged-in clinician's ID
    // Insert transcription
    const { data: transcription, error: insertError } = await adminClient
      .from('transcriptions')
      .insert({
        clinician_id: user.id, // SECURITY: Always use logged-in user's ID
        transcription_text: transcription_text.trim(),
        analysis: analysis || null,
        recording_duration_seconds: recording_duration_seconds || null,
        estimated_cost: estimated_cost || null,
        audio_file_size_bytes: audio_file_size_bytes || null,
        clinical_notes: sanitizedClinicalNotes,
        appointment_id: appointment_id || null,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[POST /clinician/transcriptions] Error:', insertError)
      return c.json({ error: 'Failed to save transcription', details: insertError.message }, 500)
    }

    // SECURITY: Verify transcription was saved with correct clinician_id
    if (transcription && transcription.clinician_id !== user.id) {
      console.error(`[POST /clinician/transcriptions] SECURITY: Transcription saved with wrong clinician_id. Expected ${user.id}, got ${transcription.clinician_id}`)
      return c.json({ error: 'Security error: Transcription not saved correctly' }, 500)
    }

    return c.json({
      transcription,
      message: 'Transcription saved successfully'
    })
  } catch (error: any) {
    console.error('[POST /clinician/transcriptions] Error:', error)
    return c.json({ 
      error: 'Failed to save transcription', 
      details: error.message || 'Unknown error' 
    }, 500)
  }
})

// Get transcriptions history
clinician.get('/transcriptions', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
    const offset = parseInt(c.req.query('offset') || '0')

    // SECURITY: Validate pagination
    if (limit < 1 || limit > 100) {
      return c.json({ error: 'Invalid limit. Must be between 1 and 100' }, 400)
    }

    if (offset < 0) {
      return c.json({ error: 'Invalid offset. Must be >= 0' }, 400)
    }

    const adminClient = getAdminClient()

    // SECURITY: Only get transcriptions for the logged-in clinician
    // Get transcriptions for this clinician (ordered by most recent first)
    const { data: transcriptions, error: fetchError } = await adminClient
      .from('transcriptions')
      .select('*')
      .eq('clinician_id', user.id) // SECURITY: Filter by logged-in clinician's ID
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (fetchError) {
      console.error('[GET /clinician/transcriptions] Error:', fetchError)
      return c.json({ error: 'Failed to fetch transcriptions', details: fetchError.message }, 500)
    }

    // SECURITY: Count only transcriptions for the logged-in clinician
    // Get total count
    const { count, error: countError } = await adminClient
      .from('transcriptions')
      .select('*', { count: 'exact', head: true })
      .eq('clinician_id', user.id) // SECURITY: Count only logged-in clinician's transcriptions

    if (countError) {
      console.error('[GET /clinician/transcriptions] Count error:', countError)
      // Don't fail the request if count fails
    }

    return c.json({
      transcriptions: transcriptions || [],
      total: count || 0,
      limit,
      offset
    })
  } catch (error: any) {
    console.error('[GET /clinician/transcriptions] Error:', error)
    return c.json({ 
      error: 'Failed to fetch transcriptions', 
      details: error.message || 'Unknown error' 
    }, 500)
  }
})

// Get single transcription by ID
clinician.get('/transcriptions/:id', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const transcriptionId = c.req.param('id')

    // SECURITY: Validate transcription ID format (UUID)
    if (!transcriptionId || typeof transcriptionId !== 'string' || transcriptionId.length > 36) {
      return c.json({ error: 'Invalid transcription ID format' }, 400)
    }

    const adminClient = getAdminClient()

    // SECURITY: Get transcription only if owned by the logged-in clinician
    // Get transcription (only if owned by this clinician)
    const { data: transcription, error: fetchError } = await adminClient
      .from('transcriptions')
      .select('*')
      .eq('id', transcriptionId)
      .eq('clinician_id', user.id) // SECURITY: Only allow access if owned by logged-in clinician
      .single()

    if (fetchError || !transcription) {
      console.error(`[GET /clinician/transcriptions/:id] SECURITY: User ${user.id} attempted to access transcription ${transcriptionId} not owned by them`)
      return c.json({ error: 'Transcription not found or unauthorized' }, 404)
    }

    // SECURITY: Double-check ownership
    if (transcription.clinician_id !== user.id) {
      console.error(`[GET /clinician/transcriptions/:id] SECURITY: User ${user.id} attempted to access transcription ${transcriptionId} owned by ${transcription.clinician_id}`)
      return c.json({ error: 'Unauthorized access to transcription' }, 403)
    }

    return c.json({ transcription })
  } catch (error: any) {
    console.error('[GET /clinician/transcriptions/:id] Error:', error)
    return c.json({ 
      error: 'Failed to fetch transcription', 
      details: error.message || 'Unknown error' 
    }, 500)
  }
})

// Delete transcription
clinician.delete('/transcriptions/:id', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const transcriptionId = c.req.param('id')

    // SECURITY: Validate transcription ID format (UUID)
    if (!transcriptionId || typeof transcriptionId !== 'string' || transcriptionId.length > 36) {
      return c.json({ error: 'Invalid transcription ID format' }, 400)
    }

    const adminClient = getAdminClient()

    // SECURITY: Verify transcription exists and is owned by logged-in clinician before deleting
    const { data: existingTranscription, error: checkError } = await adminClient
      .from('transcriptions')
      .select('clinician_id')
      .eq('id', transcriptionId)
      .single()

    if (checkError || !existingTranscription) {
      console.error(`[DELETE /clinician/transcriptions/:id] SECURITY: User ${user.id} attempted to delete non-existent transcription ${transcriptionId}`)
      return c.json({ error: 'Transcription not found' }, 404)
    }

    // SECURITY: Verify ownership before deletion
    if (existingTranscription.clinician_id !== user.id) {
      console.error(`[DELETE /clinician/transcriptions/:id] SECURITY: User ${user.id} attempted to delete transcription ${transcriptionId} owned by ${existingTranscription.clinician_id}`)
      return c.json({ error: 'Unauthorized: Cannot delete transcription owned by another clinician' }, 403)
    }

    // Delete transcription (only if owned by this clinician)
    const { error: deleteError } = await adminClient
      .from('transcriptions')
      .delete()
      .eq('id', transcriptionId)
      .eq('clinician_id', user.id) // SECURITY: Double-check ownership in delete query

    if (deleteError) {
      console.error('[DELETE /clinician/transcriptions/:id] Error:', deleteError)
      return c.json({ error: 'Failed to delete transcription', details: deleteError.message }, 500)
    }

    return c.json({ message: 'Transcription deleted successfully' })
  } catch (error: any) {
    console.error('[DELETE /clinician/transcriptions/:id] Error:', error)
    return c.json({ 
      error: 'Failed to delete transcription', 
      details: error.message || 'Unknown error' 
    }, 500)
  }
})

// Update transcription (analysis and clinical notes)
clinician.put('/transcriptions/:id', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const transcriptionId = c.req.param('id')

    // SECURITY: Validate transcription ID format (UUID)
    const idValidation = validateTranscriptionId(transcriptionId)
    if (!idValidation.valid) {
      return c.json({ error: idValidation.error }, 400)
    }

    // SECURITY: Parse JSON with error handling
    let requestBody: any
    try {
      requestBody = await c.req.json()
    } catch (parseError: any) {
      console.error('[PUT /clinician/transcriptions/:id] JSON parse error:', parseError)
      return c.json({ error: 'Invalid JSON in request body' }, 400)
    }

    const { analysis, clinical_notes } = requestBody

    // SECURITY: Validate analysis object structure (deep validation)
    const analysisValidation = validateAnalysisObject(analysis)
    if (!analysisValidation.valid) {
      return c.json({ error: analysisValidation.error }, 400)
    }

    // SECURITY: Validate clinical notes if provided
    if (clinical_notes !== undefined && typeof clinical_notes !== 'string') {
      return c.json({ error: 'Clinical notes must be a string' }, 400)
    }

    // SECURITY: Validate clinical notes length
    if (clinical_notes && clinical_notes.length > 10000) {
      return c.json({ error: 'Clinical notes too long. Maximum length is 10,000 characters' }, 400)
    }

    // SECURITY: Validate and sanitize clinical notes
    const sanitizedClinicalNotes = clinical_notes ? sanitizeString(clinical_notes, 10000) : null

    const adminClient = getAdminClient()

    // SECURITY: Verify transcription exists and is owned by logged-in clinician
    const { data: existingTranscription, error: checkError } = await adminClient
      .from('transcriptions')
      .select('clinician_id')
      .eq('id', transcriptionId)
      .single()

    if (checkError || !existingTranscription) {
      return c.json({ error: 'Transcription not found' }, 404)
    }

    // SECURITY: Verify ownership
    if (existingTranscription.clinician_id !== user.id) {
      console.error(`[PUT /clinician/transcriptions/:id] SECURITY: User ${user.id} attempted to update transcription ${transcriptionId} owned by ${existingTranscription.clinician_id}`)
      return c.json({ error: 'Unauthorized: Cannot update transcription owned by another clinician' }, 403)
    }

    // OPTIMIZATION: Build update object (only include fields that are provided)
    // SECURITY: Ensure at least one field is being updated
    if (analysis === undefined && clinical_notes === undefined) {
      return c.json({ error: 'At least one field (analysis or clinical_notes) must be provided for update' }, 400)
    }

    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString()
    }
    
    if (analysis !== undefined) {
      updateData.analysis = analysis
    }
    if (clinical_notes !== undefined) {
      updateData.clinical_notes = sanitizedClinicalNotes
    }

    // Update transcription
    const { data: updatedTranscription, error: updateError } = await adminClient
      .from('transcriptions')
      .update(updateData)
      .eq('id', transcriptionId)
      .eq('clinician_id', user.id) // SECURITY: Double-check ownership in update query
      .select()
      .single()

    if (updateError) {
      console.error('[PUT /clinician/transcriptions/:id] Error:', updateError)
      return c.json({ error: 'Failed to update transcription', details: updateError.message }, 500)
    }

    return c.json({
      transcription: updatedTranscription,
      message: 'Transcription updated successfully'
    })
  } catch (error: any) {
    console.error('[PUT /clinician/transcriptions/:id] Error:', error)
    return c.json({ 
      error: 'Failed to update transcription', 
      details: error.message || 'Unknown error' 
    }, 500)
  }
})

// Get incident photo (proxy endpoint to serve R2 images)
// This avoids DNS resolution issues with R2 public URLs
clinician.get('/incident-photo/:incidentId', authMiddleware, requireRole(['clinician']), async (c) => {
  try {
    const incidentId = c.req.param('incidentId')
    
    if (!incidentId) {
      return c.json({ error: 'Incident ID is required' }, 400)
    }

    const adminClient = getAdminClient()

    // Get incident's photo URL
    const { data: incident, error: incidentError } = await adminClient
      .from('incidents')
      .select('photo_url, user_id')
      .eq('id', incidentId)
      .single()

    if (incidentError || !incident) {
      return c.json({ error: 'Incident not found' }, 404)
    }

    if (!incident.photo_url) {
      return c.json({ error: 'Incident photo not found' }, 404)
    }

    // Extract file path from R2 URL using centralized utility
    const filePath = extractR2FilePath(incident.photo_url)

    if (!filePath) {
      // If we can't extract path, try to redirect
      console.warn(`[GET /clinician/incident-photo/:incidentId] Could not extract file path from URL: ${incident.photo_url}`)
      return c.redirect(incident.photo_url)
    }

    // Fetch image from R2
    try {
      const imageBuffer = await getFromR2(filePath)
      
      // Determine content type from file extension using centralized utility
      const contentType = getContentTypeFromFilePath(filePath)

      // Set appropriate headers
      c.header('Content-Type', contentType)
      c.header('Cache-Control', 'public, max-age=31536000, immutable') // Cache for 1 year
      c.header('Content-Disposition', `inline; filename="${filePath.split('/').pop()}"`)
      
      return c.body(imageBuffer as any)
    } catch (r2Error: any) {
      console.error(`[GET /clinician/incident-photo/:incidentId] Error fetching from R2:`, r2Error)
      // Fallback: redirect to original URL
      return c.redirect(incident.photo_url)
    }
  } catch (error: any) {
    console.error('[GET /clinician/incident-photo/:incidentId] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

export default clinician

