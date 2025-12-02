import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth.js'
import { getCaseStatusFromNotes } from '../utils/caseStatus.js'
import { getAdminClient } from '../utils/adminClient.js'
import { analyzeIncident } from '../utils/openai.js'
import { getTodayDateString } from '../utils/dateUtils.js'
import { formatDateString } from '../utils/dateTime.js'
import { getExceptionDatesForScheduledDates } from '../utils/exceptionUtils.js'
import { 
  getScheduledDatesInRange, 
  findNextScheduledDate, 
  formatDateForDisplay 
} from '../utils/scheduleUtils.js'
import { calculateAge } from '../utils/ageUtils.js'
import {
  createPendingIncident,
  notifyTeamLeaderPendingIncident,
} from '../utils/incidentApproval.js'
import { uploadToR2, generateIncidentPhotoPath, getFromR2 } from '../utils/r2Storage.js'
import { getIncidentPhotoProxyUrl, extractR2FilePath, getContentTypeFromFilePath } from '../utils/photoUrl.js'

const worker = new Hono()

// Check if worker can submit incident report (check for active exceptions)
worker.get('/can-report-incident', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // Check if worker has active exception (excluding closed cases)
    const { data: existingException, error: existingError } = await adminClient
      .from('worker_exceptions')
      .select('id, exception_type, reason, start_date, end_date, notes, deactivated_at')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (existingException) {
      // Check if case is closed by checking case_status in notes or deactivated_at timestamp
      let isClosed = false
      
      // Check deactivated_at timestamp first (if case was closed by supervisor)
      if (existingException.deactivated_at) {
        isClosed = true
      } else if (existingException.notes) {
        // OPTIMIZATION: Use centralized case status helper
        const caseStatus = getCaseStatusFromNotes(existingException.notes)
        isClosed = caseStatus === 'closed' || caseStatus === 'return_to_work'
      }

      if (!isClosed) {
        return c.json({
          canReport: false,
          reason: 'You already have an active incident/exception. Please wait until your current case is closed before submitting a new report.',
          hasActiveCase: true,
          exceptionType: existingException.exception_type,
          startDate: existingException.start_date,
        })
      }
    }

    // Check if worker has pending incident waiting for team leader approval
    const { data: pendingIncident, error: pendingError } = await adminClient
      .from('incidents')
      .select('id, incident_type, incident_date, severity, approval_status, created_at')
      .eq('user_id', user.id)
      .eq('approval_status', 'pending_approval')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (pendingError) {
      console.error('[GET /worker/can-report-incident] Error checking pending incidents:', pendingError)
      // Don't fail - continue to allow reporting if check fails
    }

    if (pendingIncident) {
      const incidentDate = pendingIncident.incident_date 
        ? new Date(pendingIncident.incident_date).toLocaleDateString()
        : new Date(pendingIncident.created_at).toLocaleDateString()
      
      return c.json({
        canReport: false,
        reason: `You have a pending incident report submitted on ${incidentDate} that is awaiting team leader approval. Please wait for approval or rejection before submitting a new report.`,
        hasActiveCase: true,
        exceptionType: pendingIncident.incident_type,
        startDate: pendingIncident.incident_date || pendingIncident.created_at,
        pendingIncident: true,
        incidentId: pendingIncident.id,
      })
    }

    return c.json({
      canReport: true,
      reason: null,
      hasActiveCase: false,
    })

  } catch (error: any) {
    console.error('[GET /worker/can-report-incident] Error:', error)
    return c.json({ 
      error: 'Failed to check report status', 
      details: error.message 
    }, 500)
  }
})

// AI Analyze Incident Report (analyze before submitting)
worker.post('/analyze-incident', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Handle FormData (may include photo file)
    const formData = await c.req.parseBody()
    const type = formData.type as string
    const description = formData.description as string
    const location = formData.location as string
    const severity = formData.severity as string
    const date = formData.date as string
    const photo = formData.photo as File | undefined

    // Validation
    if (!type || !description || !location || !severity || !date) {
      return c.json({ error: 'Missing required fields for analysis' }, 400)
    }

    const validTypes = ['incident', 'near_miss']
    if (!validTypes.includes(type)) {
      return c.json({ error: 'Invalid report type' }, 400)
    }

    const validSeverities = ['low', 'medium', 'high', 'critical']
    if (!validSeverities.includes(severity)) {
      return c.json({ error: 'Invalid severity' }, 400)
    }

    // Perform AI analysis (with photo if provided)
    const analysis = await analyzeIncident({
      type: type as 'incident' | 'near_miss',
      description,
      location,
      severity: severity as 'low' | 'medium' | 'high' | 'critical',
      date,
      photo: photo, // Now supports image analysis with OpenAI Vision API
    })

    return c.json({
      success: true,
      hasImageAnalysis: !!photo,
      analysis,
    })

  } catch (error: any) {
    console.error('[POST /worker/analyze-incident] Error:', error)
    console.error('[POST /worker/analyze-incident] Error stack:', error.stack)
    return c.json({ 
      error: 'Failed to analyze incident report', 
      details: error.message || 'Unknown error occurred'
    }, 500)
  }
})

// Report Incident or Near-Miss
worker.post('/report-incident', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const formData = await c.req.formData()
    const type = formData.get('type') as string
    const description = formData.get('description') as string
    const incidentDate = formData.get('incident_date') as string
    const location = formData.get('location') as string
    const severity = formData.get('severity') as string || 'medium'
    const photo = formData.get('photo') as File | null
    const aiAnalysisResultStr = formData.get('ai_analysis_result') as string | null

    // Validation
    if (!type || !description || !incidentDate || !location) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    const validTypes = ['incident', 'near_miss']
    if (!validTypes.includes(type)) {
      return c.json({ error: 'Invalid report type. Must be "incident" or "near_miss"' }, 400)
    }

    const validSeverities = ['low', 'medium', 'high', 'critical']
    if (!validSeverities.includes(severity)) {
      return c.json({ error: 'Invalid severity. Must be "low", "medium", "high", or "critical"' }, 400)
    }

    const adminClient = getAdminClient()

    // Get worker's team (required - worker must be in a team)
    let teamId: string | null = null
    let team: any = null
    
    // Optimized: Get team member and team info in one query
    const { data: teamMember, error: teamError } = await adminClient
      .from('team_members')
      .select('team_id, teams(id, name, supervisor_id, team_leader_id)')
      .eq('user_id', user.id)
      .maybeSingle() // Use maybeSingle to handle no result gracefully

    if (teamError) {
      console.error(`[POST /worker/report-incident] Error fetching team_members for user ${user.id} (${user.email}):`, teamError)
      return c.json({ error: 'Failed to fetch team information. Please try again.' }, 500)
    }

    if (!teamMember || !teamMember.team_id) {
      console.error(`[POST /worker/report-incident] Worker ${user.id} (${user.email}) is not assigned to any team`)
      return c.json({ error: 'Worker not found in any team. Please contact your supervisor to be assigned to a team.' }, 404)
    }

    teamId = teamMember.team_id
    team = Array.isArray(teamMember.teams) ? teamMember.teams[0] : teamMember.teams

    // If team relationship didn't load, fetch team directly
    if (!team && teamId) {
      const { data: teamData, error: teamFetchError } = await adminClient
        .from('teams')
        .select('id, name, supervisor_id, team_leader_id')
        .eq('id', teamId)
        .single()
      
      if (teamFetchError || !teamData) {
        console.error(`[POST /worker/report-incident] Error fetching team ${teamId}:`, teamFetchError)
        return c.json({ error: 'Team not found. Please contact your supervisor.' }, 404)
      }
      
      team = teamData
    }

    if (!team) {
      console.error(`[POST /worker/report-incident] Team data not available for team_id: ${teamId}`)
      return c.json({ error: 'Team information not available. Please contact your supervisor.' }, 500)
    }

    // Check if worker already has active exception or incident report (excluding closed cases)
    const { data: existingException, error: existingError } = await adminClient
      .from('worker_exceptions')
      .select('id, exception_type, reason, start_date, end_date, notes, deactivated_at')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (existingException) {
      // Check if case is closed by checking case_status in notes or deactivated_at timestamp
      let isClosed = false
      
      // Check deactivated_at timestamp first (if case was closed by supervisor)
      if (existingException.deactivated_at) {
        isClosed = true
      } else if (existingException.notes) {
        // OPTIMIZATION: Use centralized case status helper
        const caseStatus = getCaseStatusFromNotes(existingException.notes)
        isClosed = caseStatus === 'closed' || caseStatus === 'return_to_work'
      }
      
      if (!isClosed) {
        return c.json({ 
          error: 'You already have an active incident/exception. Please wait until your current case is closed before submitting a new report.',
          details: 'You must wait for your current case to be closed by your supervisor or clinician before reporting a new incident.'
        }, 400)
      }
    }

    // Also check for active incidents (in case it's not synced with exceptions)
    const today = new Date().toISOString().split('T')[0]
    const { data: activeIncident, error: incidentError } = await adminClient
      .from('incidents')
      .select('id, incident_type, incident_date, severity')
      .eq('user_id', user.id)
      .gte('incident_date', today)
      .order('incident_date', { ascending: false })
      .limit(1)

    if (activeIncident && activeIncident.length > 0) {
      // Check if there's a corresponding active exception
      const { data: incidentException } = await adminClient
        .from('worker_exceptions')
        .select('id, is_active')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle()

      if (incidentException) {
        return c.json({ 
          error: 'You already have an active incident report. Please wait until your current case is closed before submitting a new report.',
          details: 'You must wait for your current case to be closed by your supervisor or clinician before reporting a new incident.'
        }, 400)
      }
    }

    // Handle photo upload if provided
    let photoUrl: string | null = null
    if (photo && photo.size > 0) {
      try {
        // SECURITY: Validate file type
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
        if (!allowedTypes.includes(photo.type)) {
          console.warn('[POST /worker/report-incident] Invalid photo type:', photo.type)
          // Continue without photo if invalid type
        } else {
          // SECURITY: Validate file size (max 5MB)
          const maxSize = 5 * 1024 * 1024 // 5MB
          if (photo.size > maxSize) {
            console.warn(`[POST /worker/report-incident] Photo too large (${photo.size} bytes). Max size is 5MB.`)
            // Continue without photo if too large
          } else {
            // Upload to Cloudflare R2 storage
            // This prevents database size limit errors
            const filePath = generateIncidentPhotoPath(user.id, photo.name)
            photoUrl = await uploadToR2(photo, filePath, photo.type)
            console.log(`[POST /worker/report-incident] Photo uploaded to R2: ${photoUrl}`)
          }
        }
      } catch (photoError: any) {
        console.error('[POST /worker/report-incident] Error uploading photo to R2:', photoError)
        // Don't fail the incident creation if photo upload fails
        // Photo will be null, incident can still be created
        }
      }

    // Get worker details for notifications
      const workerName = (user as any).full_name || 
                        ((user as any).first_name && (user as any).last_name 
                          ? `${(user as any).first_name} ${(user as any).last_name}`
                          : user.email || 'Unknown Worker')

    // Get AI analysis if available (from analyze-incident endpoint)
    let aiAnalysis = null
    if (aiAnalysisResultStr) {
      try {
        aiAnalysis = JSON.parse(aiAnalysisResultStr)
      } catch (parseError) {
        console.warn('[POST /worker/report-incident] Failed to parse AI analysis result:', parseError)
        // Continue without AI analysis if parsing fails
      }
    }

    // Create incident with pending approval status (using approval workflow)
    // This creates incident but NO exception yet - waits for team leader approval
    let incident
    try {
      incident = await createPendingIncident({
        userId: user.id,
        teamId: teamId,
        incidentType: type as 'incident' | 'near_miss',
        incidentDate: incidentDate,
        description: `${description}${location ? `\n\nLocation: ${location}` : ''}`,
        severity: severity as 'low' | 'medium' | 'high' | 'critical',
            location: location,
        photoUrl: photoUrl,
        aiAnalysis: aiAnalysis,
      })
    } catch (createError: any) {
      console.error('[POST /worker/report-incident] Error creating pending incident:', createError)
      console.error('[POST /worker/report-incident] Error stack:', createError.stack)
      console.error('[POST /worker/report-incident] Incident data:', {
        userId: user.id,
        teamId: teamId,
        incidentType: type,
        incidentDate: incidentDate,
        severity: severity,
        hasPhoto: !!photoUrl,
        hasAiAnalysis: !!aiAnalysis,
      })
      return c.json({ 
        error: 'Failed to create incident report', 
        details: createError.message || 'Unknown error occurred'
      }, 500)
      }

    // Send notification to team leader (if team has team leader)
      if (team.team_leader_id) {
      try {
        await notifyTeamLeaderPendingIncident({
          teamLeaderId: team.team_leader_id,
          incidentId: incident.id,
          workerId: user.id,
          workerName: workerName,
          workerEmail: user.email || '',
          workerProfileImageUrl: (user as any).profile_image_url || null,
          incidentType: type,
            severity: severity,
            location: location,
        })
      } catch (notifError: any) {
        console.error('[POST /worker/report-incident] Error sending notification to team leader:', notifError)
        // Don't fail the incident creation if notification fails
      }
      }

      // Notification for worker (confirmation)
    try {
      await adminClient
        .from('notifications')
        .insert({
        user_id: user.id,
        type: 'system',
        title: '✅ Report Submitted',
          message: `Your ${type === 'incident' ? 'incident' : 'near-miss'} report has been submitted successfully. Awaiting team leader approval.`,
        data: {
            incident_id: incident.id,
          incident_type: type,
            approval_status: 'pending_approval',
        },
        is_read: false,
      })
    } catch (notifError: any) {
      console.error('[POST /worker/report-incident] Error creating worker notification:', notifError)
      // Don't fail the incident creation if notification fails
    }

    return c.json({
      success: true,
      message: 'Incident report submitted successfully. Awaiting team leader approval.',
      incident: {
        id: incident.id,
        type: type,
        date: incidentDate,
        location: location,
        approval_status: 'pending_approval',
      },
    }, 201)

  } catch (error: any) {
    console.error('[POST /worker/report-incident] Error:', error)
    return c.json({ error: 'Failed to submit incident report', details: error.message }, 500)
  }
})

// Get worker's cases (accidents/incidents) - VIEW ONLY
worker.get('/cases', authMiddleware, requireRole(['worker']), async (c) => {
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

    // Get cases for this worker only
    let query = adminClient
      .from('worker_exceptions')
      .select(`
        *,
        teams!worker_exceptions_team_id_fkey(
          id,
          name,
          site_location,
          supervisor_id,
          team_leader_id
        )
      `)
      .eq('user_id', user.id) // SECURITY: Only this worker's cases
      .in('exception_type', ['injury', 'medical_leave', 'accident', 'other'])

    // Filter by status
    const todayStr = getTodayDateString()
    if (status === 'active') {
      query = query.eq('is_active', true).gte('start_date', todayStr).or(`end_date.is.null,end_date.gte.${todayStr}`)
    } else if (status === 'closed') {
      query = query.or(`end_date.lt.${todayStr},is_active.eq.false`)
    }

    // Count query with same filters
    const countQuery = adminClient
      .from('worker_exceptions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('exception_type', ['injury', 'medical_leave', 'accident', 'other'])
    
    if (status === 'active') {
      countQuery.eq('is_active', true).gte('start_date', todayStr).or(`end_date.is.null,end_date.gte.${todayStr}`)
    } else if (status === 'closed') {
      countQuery.or(`end_date.lt.${todayStr},is_active.eq.false`)
    }

    const [countResult, casesResult] = await Promise.all([
      countQuery,
      query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
    ])

    const { count } = countResult
    const { data: cases, error: casesError } = casesResult

    if (casesError) {
      console.error('[GET /worker/cases] Database Error:', casesError)
      return c.json({ error: 'Failed to fetch cases', details: casesError.message }, 500)
    }

    // Get rehabilitation plans for cases
    const caseIds = (cases || []).map((c: any) => c.id)
    let rehabPlans: any[] = []
    if (caseIds.length > 0) {
      const { data: rehabPlansData } = await adminClient
        .from('rehabilitation_plans')
        .select('exception_id, status')
        .in('exception_id', caseIds)
        .eq('status', 'active')
      
      rehabPlans = rehabPlansData || []
    }

    const rehabMap = new Map()
    rehabPlans.forEach((plan: any) => {
      rehabMap.set(plan.exception_id, true)
    })

    // Get supervisor and team leader info
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

    const allUserIds = Array.from(new Set([...supervisorIds, ...teamLeaderIds]))
    let userMap = new Map()
    if (allUserIds.length > 0) {
      const { data: users } = await adminClient
        .from('users')
        .select('id, email, first_name, last_name, full_name')
        .in('id', allUserIds)

      if (users) {
        users.forEach((userData: any) => {
          userMap.set(userData.id, userData)
        })
      }
    }

    // Format cases
    const { getCaseStatusFromNotes, mapCaseStatusToDisplay } = await import('../utils/caseStatus.js')
    
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
    
    const formatUserName = (user: any): string => {
      if (!user) return 'Unknown'
      if (user.full_name) return user.full_name
      if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`
      return user.email || 'Unknown'
    }

    // Get worker's user data from database
    const { data: workerUser } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .eq('id', user.id)
      .single()

    const todayDate = new Date()
    todayDate.setHours(0, 0, 0, 0)
    const casesArray = Array.isArray(cases) ? cases : []
    
    // OPTIMIZATION: Fetch all related incidents in one query
    // Fetch all approved incidents for this worker (since it's only one user)
    const { data: relatedIncidents } = await adminClient
      .from('incidents')
      .select('id, user_id, incident_date, photo_url, ai_analysis_result, description, severity')
      .eq('user_id', user.id)
      .eq('approval_status', 'approved')
      .order('created_at', { ascending: false })
    
    // Create map for O(1) lookup: key = `${user_id}_${incident_date}`
    // Also create a user-based map for fallback matching
    const incidentMap = new Map()
    const userIncidentsMap = new Map<string, any[]>() // Map user_id to array of incidents
    
    if (relatedIncidents) {
      relatedIncidents.forEach((inc: any) => {
        const key = `${inc.user_id}_${inc.incident_date}`
        incidentMap.set(key, inc)
        
        // Also group by user_id for fallback matching
        if (!userIncidentsMap.has(inc.user_id)) {
          userIncidentsMap.set(inc.user_id, [])
        }
        userIncidentsMap.get(inc.user_id)!.push(inc)
      })
    }
    let formattedCases = casesArray.map((incident: any) => {
      const team = incident.teams?.[0] || incident.teams
      const supervisor = team?.supervisor_id ? userMap.get(team.supervisor_id) : null
      const teamLeader = team?.team_leader_id ? userMap.get(team.team_leader_id) : null
      
      const startDate = new Date(incident.start_date)
      startDate.setHours(0, 0, 0, 0)
      const endDate = incident.end_date ? new Date(incident.end_date) : null
      if (endDate) endDate.setHours(0, 0, 0, 0)
      
      const isCurrentlyActive = todayDate >= startDate && (!endDate || todayDate <= endDate) && incident.is_active
      const isInRehab = rehabMap.has(incident.id)

      const caseNumber = generateCaseNumber(incident.id, incident.created_at)
      const caseStatusFromNotes = getCaseStatusFromNotes(incident.notes)
      const caseStatus = mapCaseStatusToDisplay(caseStatusFromNotes, isInRehab, isCurrentlyActive)

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
        workerName: formatUserName(workerUser),
        workerEmail: workerUser?.email || user.email || '',
        workerInitials: (workerUser?.first_name?.[0]?.toUpperCase() || '') + (workerUser?.last_name?.[0]?.toUpperCase() || '') || 'U',
        teamId: incident.team_id,
        teamName: team?.name || '',
        siteLocation: team?.site_location || '',
        supervisorName: formatUserName(supervisor),
        teamLeaderName: formatUserName(teamLeader),
        type: incident.exception_type,
        reason: incident.reason || '',
        startDate: incident.start_date,
        endDate: incident.end_date,
        status: caseStatus,
        priority,
        isActive: isCurrentlyActive,
        isInRehab,
        caseStatus: caseStatusFromNotes || null,
        notes: incident.notes || null,
        createdAt: incident.created_at,
        updatedAt: incident.updated_at,
        return_to_work_duty_type: incident.return_to_work_duty_type || null,
        return_to_work_date: incident.return_to_work_date || null,
        // Include incident photo and AI analysis (with flexible date matching)
        // Convert R2 URLs to proxy URLs to avoid DNS resolution issues
        incidentPhotoUrl: (() => {
          // Try exact match first
          const incidentKey = `${incident.user_id}_${incident.start_date}`
          const exactMatch = incidentMap.get(incidentKey)
          if (exactMatch && exactMatch.id) {
            return getIncidentPhotoProxyUrl(exactMatch.photo_url, exactMatch.id, 'worker')
          }
          
          // Fallback: Find incident within 7 days
          const userIncidents = userIncidentsMap.get(incident.user_id) || []
          const exceptionDate = new Date(incident.start_date)
          exceptionDate.setHours(0, 0, 0, 0)
          
          for (const inc of userIncidents) {
            const incDate = new Date(inc.incident_date)
            incDate.setHours(0, 0, 0, 0)
            const daysDiff = Math.abs((incDate.getTime() - exceptionDate.getTime()) / (1000 * 60 * 60 * 24))
            if (daysDiff <= 7 && inc.id) {
              return getIncidentPhotoProxyUrl(inc.photo_url, inc.id, 'worker')
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
          const userIncidents = userIncidentsMap.get(incident.user_id) || []
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
        caseItem.caseNumber.toLowerCase().includes(searchLower) ||
        caseItem.type.toLowerCase().includes(searchLower) ||
        caseItem.teamName.toLowerCase().includes(searchLower)
      )
    }

    return c.json({
      cases: formattedCases,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
        hasNext: page < Math.ceil((count || 0) / limit),
        hasPrev: page > 1,
      },
    }, 200)
  } catch (error: any) {
    console.error('[GET /worker/cases] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get single case detail for worker - VIEW ONLY
worker.get('/cases/:id', authMiddleware, requireRole(['worker']), async (c) => {
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

    // Get single case - SECURITY: Only this worker's cases
    const { data: caseData, error: caseError } = await adminClient
      .from('worker_exceptions')
      .select(`
        *,
        teams!worker_exceptions_team_id_fkey(
          id,
          name,
          site_location,
          supervisor_id,
          team_leader_id
        )
      `)
      .eq('id', caseId)
      .eq('user_id', user.id) // SECURITY: Only their own cases
      .in('exception_type', ['injury', 'medical_leave', 'accident', 'other'])
      .single()

    if (caseError || !caseData) {
      return c.json({ error: 'Case not found or not authorized' }, 404)
    }

    // Get supervisor and team leader info
    const team = Array.isArray(caseData.teams) ? caseData.teams[0] : caseData.teams
    const userIds = [team?.supervisor_id, team?.team_leader_id].filter(Boolean)
    
    let userMap = new Map()
    if (userIds.length > 0) {
      const { data: users } = await adminClient
        .from('users')
        .select('id, email, first_name, last_name, full_name, gender, date_of_birth')
        .in('id', userIds)
      
      users?.forEach((u: any) => userMap.set(u.id, u))
    }

    // Get related incident (for photo and AI analysis)
    // Match by user_id and date (incident_date should match start_date)
    // Use flexible matching: get the most recent approved incident for this user
    // that matches the exception's start_date (they should be the same when incident is approved)
    const incidentDate = caseData.start_date
    
    const [rehabPlanResult, incidentResult] = await Promise.all([
    // Check rehab status
      adminClient
      .from('rehabilitation_plans')
      .select('id, status')
      .eq('exception_id', caseId)
      .eq('status', 'active')
        .maybeSingle(),
      
      // Get related incident (for photo and AI analysis)
      // Try exact date match first, then fallback to most recent approved incident for this user
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
        
        // Fallback: Get most recent approved incident for this user
        // This handles cases where dates might not match exactly due to timezone issues
        const { data: recentIncident } = await adminClient
          .from('incidents')
          .select('id, photo_url, ai_analysis_result, incident_date, description, severity')
          .eq('user_id', caseData.user_id)
          .eq('approval_status', 'approved')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        // Only return if the incident_date is within 7 days of the exception start_date
        // This ensures we're matching the right incident
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
    
    const rehabPlan = rehabPlanResult.data

    const supervisor = userMap.get(team?.supervisor_id)
    const teamLeader = userMap.get(team?.team_leader_id)
    
    const { getCaseStatusFromNotes, mapCaseStatusToDisplay } = await import('../utils/caseStatus.js')
    
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
    
    const formatUserName = (user: any): string => {
      if (!user) return 'Unknown'
      if (user.full_name) return user.full_name
      if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`
      return user.email || 'Unknown'
    }

    const caseStatusFromNotes = getCaseStatusFromNotes(caseData.notes)
    const isInRehab = !!rehabPlan
    const todayDate = new Date()
    todayDate.setHours(0, 0, 0, 0)
    const startDate = new Date(caseData.start_date)
    startDate.setHours(0, 0, 0, 0)
    const endDate = caseData.end_date ? new Date(caseData.end_date) : null
    if (endDate) endDate.setHours(0, 0, 0, 0)
    const isCurrentlyActive = todayDate >= startDate && (!endDate || todayDate <= endDate) && caseData.is_active

    let priority = 'MEDIUM'
    if (caseData.exception_type === 'injury' || caseData.exception_type === 'accident') {
      priority = 'HIGH'
    } else if (caseData.exception_type === 'medical_leave') {
      priority = 'MEDIUM'
    } else {
      priority = 'LOW'
    }

    // Get worker's user data from database
    const { data: workerUser } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name, gender, date_of_birth')
      .eq('id', user.id)
      .single()

    const formattedCase = {
      id: caseData.id,
      caseNumber: generateCaseNumber(caseData.id, caseData.created_at),
      workerId: caseData.user_id,
      workerName: formatUserName(workerUser),
      workerEmail: workerUser?.email || user.email || '',
      workerInitials: (workerUser?.first_name?.[0]?.toUpperCase() || '') + (workerUser?.last_name?.[0]?.toUpperCase() || '') || 'U',
      workerGender: (workerUser as any)?.gender || null,
      workerDateOfBirth: (workerUser as any)?.date_of_birth || null,
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
      // Include incident photo and AI analysis (both formats for backward compatibility)
      // Convert R2 URLs to proxy URLs to avoid DNS resolution issues
      incidentPhotoUrl: incidentResult.data?.id 
        ? getIncidentPhotoProxyUrl(incidentResult.data?.photo_url, incidentResult.data.id, 'worker') 
        : null,
      incidentId: incidentResult.data?.id || null,
      incidentAiAnalysis: (() => {
        // Parse AI analysis if available
        if (incidentResult.data?.ai_analysis_result) {
          try {
            if (typeof incidentResult.data.ai_analysis_result === 'string') {
              return JSON.parse(incidentResult.data.ai_analysis_result)
            }
            return incidentResult.data.ai_analysis_result
          } catch (parseError) {
            return null
          }
        }
        return null
      })(),
        incident: {
          photoUrl: incidentResult.data?.id 
            ? getIncidentPhotoProxyUrl(incidentResult.data?.photo_url, incidentResult.data.id, 'worker') 
            : null,
          incidentId: incidentResult.data?.id || null,
          aiAnalysis: (() => {
          if (incidentResult.data?.ai_analysis_result) {
            try {
              if (typeof incidentResult.data.ai_analysis_result === 'string') {
                return JSON.parse(incidentResult.data.ai_analysis_result)
              }
              return incidentResult.data.ai_analysis_result
            } catch (parseError) {
              return null
            }
          }
          return null
        })(),
        description: incidentResult.data?.description || null,
        severity: incidentResult.data?.severity || null,
      },
    }

    return c.json({ case: formattedCase }, 200)
  } catch (error: any) {
    console.error('[GET /worker/cases/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get worker's check-in streak
worker.get('/streak', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = getTodayDateString()

    // Get all active schedules for this worker
    const { data: schedules, error: scheduleError } = await adminClient
      .from('worker_schedules')
      .select('*')
      .eq('worker_id', user.id)
      .eq('is_active', true)
      .order('scheduled_date', { ascending: false })
      .order('day_of_week', { ascending: true })

    if (scheduleError) {
      console.error('[GET /worker/streak] Error fetching schedules:', scheduleError)
      return c.json({ error: 'Failed to fetch schedules', details: scheduleError.message }, 500)
    }

    // Get all check-ins for this worker (last 30 days for performance)
    const thirtyDaysAgo = new Date(today)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const thirtyDaysAgoStr = formatDateString(thirtyDaysAgo)

    const { data: checkIns, error: checkInError } = await adminClient
      .from('daily_checkins')
      .select('check_in_date')
      .eq('user_id', user.id)
      .gte('check_in_date', thirtyDaysAgoStr)
      .order('check_in_date', { ascending: false })

    // Get all exceptions for this worker (to check if scheduled dates have exceptions)
    const { data: exceptions, error: exceptionError } = await adminClient
      .from('worker_exceptions')
      .select('exception_type, start_date, end_date, is_active, deactivated_at, reason')
      .eq('user_id', user.id)

    if (exceptionError) {
      console.error('[GET /worker/streak] Error fetching exceptions:', exceptionError)
      // Continue without exceptions - not critical
    }

    if (checkInError) {
      console.error('[GET /worker/streak] Error fetching check-ins:', checkInError)
      return c.json({ error: 'Failed to fetch check-ins', details: checkInError.message }, 500)
    }

    // Create a set of dates with check-ins (normalize to YYYY-MM-DD format)
    const checkInDates = new Set<string>()
    if (checkIns) {
      checkIns.forEach((checkIn: any) => {
        const dateStr = typeof checkIn.check_in_date === 'string' 
          ? checkIn.check_in_date.split('T')[0]
          : formatDateString(new Date(checkIn.check_in_date))
        checkInDates.add(dateStr)
      })
    }

    // Get scheduled dates for past 30 days (for streak calculation)
    const pastScheduledDates = getScheduledDatesInRange(schedules || [], thirtyDaysAgo, today)
    
    // Check which scheduled dates have exceptions (using centralized function)
    const { exceptionDates, scheduledDatesWithExceptions } = getExceptionDatesForScheduledDates(
      pastScheduledDates,
      exceptions || []
    )

    // Calculate streak: count consecutive days (going backwards from today)
    // where worker had a schedule AND completed check-in
    // Rules:
    // - Days with schedule AND check-in: count towards streak
    // - Days with schedule but NO check-in: break streak
    // - Days with NO schedule: skip (don't break streak, don't count)
    // Current streak is the most recent consecutive days with schedule + check-in
    
    let currentStreak = 0
    let longestStreak = 0
    let tempStreak = 0
    let foundFirstScheduledDay = false
    let foundMostRecentCheckIn = false // Track if we've found the most recent check-in

    // Go backwards from today to find consecutive days with schedule + check-in
    for (let dayOffset = 0; dayOffset <= 30; dayOffset++) {
      const checkDate = new Date(today)
      checkDate.setDate(checkDate.getDate() - dayOffset)
      const checkDateStr = formatDateString(checkDate)

      const hadSchedule = pastScheduledDates.has(checkDateStr)
      const hadCheckIn = checkInDates.has(checkDateStr)
      const hadException = scheduledDatesWithExceptions.has(checkDateStr)

      if (hadSchedule) {
        // Worker had a schedule on this day
        foundFirstScheduledDay = true
        
        // If there's an exception on this scheduled date, don't count it (don't break streak, don't count)
        if (hadException) {
          // Exception dates don't break streak - continue
          continue
        }
        
        if (hadCheckIn) {
          // Had schedule AND check-in - count towards streak
          if (!foundMostRecentCheckIn) {
            // This is the most recent check-in, start building current streak from here
            foundMostRecentCheckIn = true
            tempStreak = 1
            currentStreak = 1
          } else {
            // Continue building the current streak
            tempStreak++
            currentStreak = tempStreak
          }
          
          // Always update longest streak
          longestStreak = Math.max(longestStreak, tempStreak)
        } else {
          // Had schedule but NO check-in - break streak
          if (foundMostRecentCheckIn) {
            // We've already found the most recent check-in, so this breaks the current streak
            // Don't update currentStreak anymore
            tempStreak = 0
          } else {
            // Haven't found most recent check-in yet, continue searching
            tempStreak = 0
          }
        }
      } else {
        // No schedule - skip this day (doesn't break streak, doesn't count)
        // Only reset if we haven't found any scheduled days yet
        if (!foundFirstScheduledDay && dayOffset === 0) {
          // Today with no schedule - no streak
          currentStreak = 0
        }
        // For previous days without schedule, just continue (don't break streak, don't count)
        // If we're building a streak, continue building it
        if (foundMostRecentCheckIn && tempStreak > 0) {
          // We're in a streak, skipping non-scheduled days doesn't break it
          // But we don't increment the streak either
        }
      }
    }

    // Check if today's check-in is completed
    const todayCheckInCompleted = checkInDates.has(todayStr) && pastScheduledDates.has(todayStr)

    // Count completed days (past days with schedule AND check-in, excluding exception dates)
    const completedDays = Array.from(pastScheduledDates).filter(date => 
      checkInDates.has(date) && !scheduledDatesWithExceptions.has(date)
    ).length
    
    // Find missed schedule dates (past scheduled dates without check-in AND without exception)
    // Exception dates should NOT be counted as missed schedules
    const missedScheduleDates = Array.from(pastScheduledDates)
      .filter(date => !checkInDates.has(date) && !scheduledDatesWithExceptions.has(date))
      .sort()
      .reverse() // Most recent first
    
    // Debug logging for streak calculation
    console.log(`[GET /worker/streak] Current streak: ${currentStreak}, Completed days: ${completedDays}, Past scheduled days: ${pastScheduledDates.size}`)

    // Get future scheduled dates (next 90 days)
    const futureEndDate = new Date(today)
    futureEndDate.setDate(futureEndDate.getDate() + 90)
    const futureScheduledDates = getScheduledDatesInRange(schedules || [], today, futureEndDate)
    
    // Calculate total scheduled days (past + future)
    const totalScheduledDaysIncludingFuture = pastScheduledDates.size + futureScheduledDates.size
    const pastScheduledDays = pastScheduledDates.size

    // Find next scheduled check-in date
    let nextCheckInDate: string | null = null
    let nextCheckInDateFormatted: string | null = null
    
    // First check if today has a schedule but no check-in yet
    if (pastScheduledDates.has(todayStr) && !checkInDates.has(todayStr)) {
      nextCheckInDate = todayStr
      nextCheckInDateFormatted = 'Today'
    } else {
      // Find next future scheduled date
      nextCheckInDate = findNextScheduledDate(schedules || [], today, 90)
      if (nextCheckInDate) {
        nextCheckInDateFormatted = formatDateForDisplay(nextCheckInDate)
      }
    }

    // Calculate next milestone (7 days, 14 days, 30 days, etc.)
    const milestones = [7, 14, 30, 60, 90]
    const nextMilestone = milestones.find(m => m > currentStreak) || null
    const daysUntilNextMilestone = nextMilestone ? nextMilestone - currentStreak : null

    // Check if worker has achieved 7-day badge
    const hasSevenDayBadge = currentStreak >= 7

    return c.json({
      currentStreak,
      longestStreak,
      todayCheckInCompleted,
      nextMilestone,
      daysUntilNextMilestone,
      hasSevenDayBadge,
      totalScheduledDays: totalScheduledDaysIncludingFuture,
      pastScheduledDays,
      completedDays,
      missedScheduleDates,
      missedScheduleCount: missedScheduleDates.length,
      exceptionDates,
      nextCheckInDate,
      nextCheckInDateFormatted,
      badge: hasSevenDayBadge ? {
        name: '7-Day Streak',
        description: 'Completed 7 consecutive days of check-ins',
        icon: '🔥',
        achieved: true,
        achievedDate: todayStr, // Approximate - could track actual achievement date
      } : null,
    }, 200)

  } catch (error: any) {
    console.error('[GET /worker/streak] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get incident photo (proxy endpoint to serve R2 images)
// This avoids DNS resolution issues with R2 public URLs
worker.get('/incident-photo/:incidentId', async (c) => {
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
      console.warn(`[GET /worker/incident-photo/:incidentId] Could not extract file path from URL: ${incident.photo_url}`)
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
      console.error(`[GET /worker/incident-photo/:incidentId] Error fetching from R2:`, r2Error)
      // Fallback: redirect to original URL
      return c.redirect(incident.photo_url)
    }
  } catch (error: any) {
    console.error('[GET /worker/incident-photo/:incidentId] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

export default worker

