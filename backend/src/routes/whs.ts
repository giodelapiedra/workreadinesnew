import { Hono } from 'hono'
import { authMiddleware, requireRole, AuthVariables } from '../middleware/auth.js'
import { getCaseStatusFromNotes, mapCaseStatusToDisplay, CaseStatus } from '../utils/caseStatus.js'
import { parseIncidentNotes } from '../utils/notesParser.js'
import { getAdminClient } from '../utils/adminClient.js'
import { normalizeDate, isDateInRange, calculateAge } from '../utils/dateTimeUtils.js'
import { formatUserFullName } from '../utils/userUtils.js'
import { getIncidentPhotoProxyUrl, extractR2FilePath, getContentTypeFromFilePath, getCertificateImageProxyUrl } from '../utils/photoUrl.js'
import { getFromR2 } from '../utils/r2Storage.js'
import { encodeCursor, decodeCursor, extractCursorDate } from '../utils/cursorPagination.js'

// OPTIMIZATION: Constants for active case statuses (avoid recreating array)
const ACTIVE_CASE_STATUSES = ['new', 'triaged', 'assessed', 'in_rehab'] as const
const COMPLETED_CASE_STATUSES = ['closed', 'return_to_work'] as const

const whs = new Hono<{ Variables: AuthVariables }>()

// Get all incidents/cases for WHS (from all supervisors)
whs.get('/cases', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Support both cursor and offset-based pagination (backward compatible)
    const cursor = c.req.query('cursor')
    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : undefined
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 1000)
    const useCursor = cursor !== undefined || page === undefined
    
    const status = c.req.query('status') || 'active' // Default to 'active' - show active cases first
    const type = c.req.query('type') || 'all'
    const search = c.req.query('search') || ''

    // Validate pagination
    if (limit < 1 || limit > 1000) {
      return c.json({ error: 'Invalid pagination parameters. Limit must be between 1 and 1000' }, 400)
    }
    if (page !== undefined && (page < 1)) {
      return c.json({ error: 'Invalid pagination parameters. Page must be >= 1' }, 400)
    }

    const adminClient = getAdminClient()

    // Only incident-worthy exception types
    const incidentTypes = ['accident', 'injury', 'medical_leave', 'other']

    let countQuery = adminClient
      .from('worker_exceptions')
      .select('*', { count: 'exact', head: true })
      .in('exception_type', incidentTypes)
      .eq('assigned_to_whs', true) // Only show incidents assigned by supervisor

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
        ),
        clinician:users!worker_exceptions_clinician_id_fkey(
          id,
          email,
          first_name,
          last_name,
          full_name
        )
      `)
      .in('exception_type', incidentTypes)
      .eq('assigned_to_whs', true) // Only show incidents assigned by supervisor

    // Filter by status - default to active if not specified
    const todayStr = new Date().toISOString().split('T')[0]
    const filterStatus = status || 'active' // Default to active
    
    if (filterStatus === 'active') {
      // OPTIMIZATION: Use broader filter for active - will refine by case status from notes
      // Include all cases that might be active (is_active = true OR cases with in_rehab status)
      query = query.eq('is_active', true)
      countQuery = countQuery.eq('is_active', true)
    } else if (filterStatus === 'closed') {
      query = query.or(`end_date.lt.${todayStr},is_active.eq.false`)
      countQuery = countQuery.or(`end_date.lt.${todayStr},is_active.eq.false`)
    } else if (filterStatus === 'new') {
      // New cases: created within last 7 days and still active
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      query = query.eq('is_active', true).gte('created_at', weekAgo.toISOString())
      countQuery = countQuery.eq('is_active', true).gte('created_at', weekAgo.toISOString())
    }

    // Filter by type
    if (type !== 'all') {
      query = query.eq('exception_type', type)
      countQuery = countQuery.eq('exception_type', type)
    }

    // Get paginated cases using cursor or offset-based pagination
    let cases: any[] = []
    let casesError: any = null
    let count: number | null = null
    let hasMore = false
    
    if (useCursor) {
      // Cursor-based pagination (efficient for large datasets)
      let cursorFilter = query.order('created_at', { ascending: false })
      
      // Decode and apply cursor filter if provided
      if (cursor) {
        const decoded = decodeCursor(cursor)
        const cursorDate = extractCursorDate(decoded)
        if (cursorDate) {
          cursorFilter = cursorFilter.lt('created_at', cursorDate)
        }
      }
      
      // Fetch limit + 1 to check if there's more
      const { data: casesData, error: casesErr } = await cursorFilter.limit(limit + 1)
      
      cases = casesData || []
      casesError = casesErr
      hasMore = cases.length > limit
      
      // Remove extra item if we got one
      if (hasMore) {
        cases = cases.slice(0, limit)
      }
    } else {
      // Offset-based pagination (backward compatible)
      const offset = ((page || 1) - 1) * limit
      
      // Get total count (run in parallel with main query for better performance)
      const [countResult, casesResult] = await Promise.all([
        countQuery,
        query
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1)
      ])

      const { count: totalCount, error: countError } = countResult
      const { data: casesData, error: casesErr } = casesResult

      if (countError) {
        console.error('[GET /whs/cases] Error counting cases:', countError)
        return c.json({ error: 'Failed to count cases', details: countError.message }, 500)
      }

      cases = casesData || []
      casesError = casesErr
      count = totalCount || 0
    }

    if (casesError) {
      console.error('[GET /whs/cases] Error fetching cases:', casesError)
      return c.json({ error: 'Failed to fetch cases', details: casesError.message }, 500)
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
        users.forEach((user: any) => {
          userMap.set(user.id, user)
        })
      }
    }

    // OPTIMIZATION: Fetch all related incidents in one query
    const caseUserIds = (cases || []).map((c: any) => c.user_id)
    const caseStartDates = (cases || []).map((c: any) => c.start_date)
    
    const { data: relatedIncidents } = await adminClient
      .from('incidents')
      .select('id, user_id, incident_date, photo_url, ai_analysis_result, description, severity')
      .in('user_id', caseUserIds.length > 0 ? caseUserIds : ['00000000-0000-0000-0000-000000000000'])
      .in('incident_date', caseStartDates.length > 0 ? caseStartDates : ['1900-01-01'])
      .eq('approval_status', 'approved')
    
    // Create map for O(1) lookup: key = `${user_id}_${incident_date}`
    const incidentMap = new Map()
    if (relatedIncidents) {
      relatedIncidents.forEach((inc: any) => {
        const key = `${inc.user_id}_${inc.incident_date}`
        incidentMap.set(key, inc)
      })
    }

    // Format cases
    const todayDate = new Date()
    let formattedCases = (cases || []).map((incident: any) => {
      const user = Array.isArray(incident.users) ? incident.users[0] : incident.users
      const team = Array.isArray(incident.teams) ? incident.teams[0] : incident.teams
      const supervisor = team?.supervisor_id ? userMap.get(team.supervisor_id) : null
      const teamLeader = team?.team_leader_id ? userMap.get(team.team_leader_id) : null
      const clinician = Array.isArray(incident.clinician) ? incident.clinician[0] : incident.clinician

      // OPTIMIZATION: Use centralized notes parser
      const parsedNotes = parseIncidentNotes(incident.notes)
      const caseStatusFromNotes = getCaseStatusFromNotes(incident.notes)
      const approvedBy = parsedNotes?.approved_by || null
      const approvedAt = parsedNotes?.approved_at || null

      const startDate = new Date(incident.start_date)
      const endDate = incident.end_date ? new Date(incident.end_date) : null
      // OPTIMIZATION: For in_rehab cases, is_active flag is the primary indicator
      // For other cases, check date range as well
      let isCurrentlyActive = false
      if (incident.is_active) {
        if (caseStatusFromNotes === 'in_rehab') {
          // For in_rehab, is_active = true means it's active (date range is less important)
          isCurrentlyActive = true
        } else {
          // For other cases, check date range using utility function
          isCurrentlyActive = isDateInRange(todayDate, startDate, endDate)
        }
      }

      // OPTIMIZATION: Calculate createdAt once and reuse for both status check and case number
      const createdAt = new Date(incident.created_at)

      // Determine case status - use notes if available, otherwise calculate
      let caseStatus: string
      if (caseStatusFromNotes) {
        // Use centralized mapping for consistency and security
        caseStatus = mapCaseStatusToDisplay(caseStatusFromNotes, false, isCurrentlyActive)
      } else if (isCurrentlyActive) {
        // Check if it's new (created within last 7 days)
        const daysSinceCreation = Math.floor((todayDate.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
        caseStatus = daysSinceCreation <= 7 ? 'NEW CASE' : 'IN PROGRESS'
      } else {
        caseStatus = 'CLOSED'
      }

      // Generate case number (consistent with other routes)
      const year = createdAt.getFullYear()
      const month = String(createdAt.getMonth() + 1).padStart(2, '0')
      const day = String(createdAt.getDate()).padStart(2, '0')
      const hours = String(createdAt.getHours()).padStart(2, '0')
      const minutes = String(createdAt.getMinutes()).padStart(2, '0')
      const seconds = String(createdAt.getSeconds()).padStart(2, '0')
      const uuidPrefix = incident.id.substring(0, 4).toUpperCase()
      const caseNumber = `CASE-${year}${month}${day}-${hours}${minutes}${seconds}-${uuidPrefix}`

      return {
        id: incident.id,
        caseNumber,
        workerId: incident.user_id,
        workerName: user?.full_name || 
                   (user?.first_name && user?.last_name 
                     ? `${user.first_name} ${user.last_name}`
                     : user?.email || 'Unknown'),
        workerEmail: user?.email || '',
        teamId: incident.team_id,
        teamName: team?.name || '',
        siteLocation: team?.site_location || '',
        supervisorId: team?.supervisor_id || null,
        supervisorName: supervisor?.full_name ||
                       (supervisor?.first_name && supervisor?.last_name
                         ? `${supervisor.first_name} ${supervisor.last_name}`
                         : supervisor?.email || 'Unknown'),
        teamLeaderId: team?.team_leader_id || null,
        teamLeaderName: teamLeader?.full_name ||
                       (teamLeader?.first_name && teamLeader?.last_name
                         ? `${teamLeader.first_name} ${teamLeader.last_name}`
                         : teamLeader?.email || 'Unknown'),
        clinicianId: incident.clinician_id || null,
        clinicianName: clinician?.full_name ||
                      (clinician?.first_name && clinician?.last_name
                        ? `${clinician.first_name} ${clinician.last_name}`
                        : clinician?.email || null),
        type: incident.exception_type,
        reason: incident.reason || '',
        startDate: incident.start_date,
        endDate: incident.end_date,
        status: caseStatus,
        severity: getSeverity(incident.exception_type),
        isActive: isCurrentlyActive,
        createdAt: incident.created_at,
        updatedAt: incident.updated_at,
        approvedBy,
        approvedAt,
        returnToWorkDutyType: incident.return_to_work_duty_type || null,
        returnToWorkDate: incident.return_to_work_date || null,
        // OPTIMIZATION: Store internal case status for filtering
        _caseStatus: caseStatusFromNotes || 'new',
        // Include incident photo and AI analysis
        // Convert R2 URLs to proxy URLs to avoid DNS resolution issues
        incidentPhotoUrl: (() => {
          const incidentKey = `${incident.user_id}_${incident.start_date}`
          const relatedIncident = incidentMap.get(incidentKey)
          if (relatedIncident?.id) {
            return getIncidentPhotoProxyUrl(relatedIncident.photo_url, relatedIncident.id, 'whs')
          }
          return null
        })(),
        incidentAiAnalysis: (() => {
          const incidentKey = `${incident.user_id}_${incident.start_date}`
          const relatedIncident = incidentMap.get(incidentKey)
          if (relatedIncident?.ai_analysis_result) {
            try {
              if (typeof relatedIncident.ai_analysis_result === 'string') {
                return JSON.parse(relatedIncident.ai_analysis_result)
              }
              return relatedIncident.ai_analysis_result
            } catch {
              return null
            }
          }
          return null
        })(),
      }
    })

    // OPTIMIZATION: Apply status filter based on case status from notes (more accurate)
    if (filterStatus === 'active') {
      // Filter to show only active statuses: new, triaged, assessed, in_rehab
      formattedCases = formattedCases.filter(caseItem => {
        const caseStatus = (caseItem as any)._caseStatus || 'new'
        
        // Check if status is active
        if (!ACTIVE_CASE_STATUSES.includes(caseStatus as typeof ACTIVE_CASE_STATUSES[number])) {
          return false
        }
        
        // For in_rehab cases, be more lenient - just check is_active flag
        if (caseStatus === 'in_rehab') {
          return caseItem.isActive === true
        }
        
        // For other active statuses, check is_active and date range
        if (!caseItem.isActive) return false
        
        // Check date range using utility function
        const startDate = new Date(caseItem.startDate)
        const endDate = caseItem.endDate ? new Date(caseItem.endDate) : null
        return isDateInRange(todayDate, startDate, endDate)
      })
    } else if (filterStatus === 'closed') {
      // Filter to show only completed statuses: closed, return_to_work
      formattedCases = formattedCases.filter(caseItem => {
        const caseStatus = (caseItem as any)._caseStatus || 'new'
        return COMPLETED_CASE_STATUSES.includes(caseStatus as typeof COMPLETED_CASE_STATUSES[number])
      })
    }

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

    // Build pagination response
    let paginationResponse: any
    
    if (useCursor) {
      // Cursor-based pagination response
      let nextCursor: string | undefined = undefined
      if (hasMore && formattedCases.length > 0) {
        const lastItem = cases[cases.length - 1]
        nextCursor = encodeCursor({
          id: lastItem.id,
          createdAt: lastItem.created_at,
        })
      }
      
      paginationResponse = {
        limit,
        hasNext: hasMore,
        hasPrev: !!cursor,
        nextCursor,
        prevCursor: cursor || undefined,
      }
    } else {
      // Offset-based pagination response (backward compatible)
      const totalPages = Math.ceil((count || 0) / limit)
      paginationResponse = {
        page: page || 1,
        limit,
        total: count || 0,
        totalPages,
        hasNext: (page || 1) < totalPages,
        hasPrev: (page || 1) > 1,
      }
    }

    // Get summary statistics (only for assigned incidents)
    // OPTIMIZATION: Include notes field to get accurate case status
    const { data: allCases, error: summaryError } = await adminClient
      .from('worker_exceptions')
      .select('id, exception_type, is_active, start_date, end_date, created_at, notes')
      .in('exception_type', incidentTypes)
      .eq('assigned_to_whs', true) // Only count incidents assigned by supervisor

    if (summaryError) {
      console.error('[GET /whs/cases] Error fetching summary:', summaryError)
    }

    const todayDateObj = new Date()
    const startOfMonth = new Date(todayDateObj.getFullYear(), todayDateObj.getMonth(), 1)
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)

    const summary = {
      total: allCases?.length || 0,
      new: 0,
      active: 0,
      completed: 0,
      byType: {} as Record<string, number>,
    }

    // OPTIMIZATION: Use case status utilities (already imported at top)

    ;(allCases || []).forEach((caseItem: any) => {
      // Count by type
      const typeKey = caseItem.exception_type || 'other'
      summary.byType[typeKey] = (summary.byType[typeKey] || 0) + 1

      // Get case status from notes (more accurate than just is_active)
      const caseStatus = getCaseStatusFromNotes(caseItem.notes) || 'new'
      
      // Check if case is new (created within last 7 days)
      const createdAt = new Date(caseItem.created_at)
      if (createdAt >= weekAgo) {
        summary.new++
      }

      // Count active cases: status is new, triaged, assessed, or in_rehab AND is_active = true
      const isActiveStatus = ACTIVE_CASE_STATUSES.includes(caseStatus as typeof ACTIVE_CASE_STATUSES[number])
      
      // For active status cases, check if they should be counted as active
      if (isActiveStatus && caseItem.is_active) {
        if (caseStatus === 'in_rehab') {
          // in_rehab cases are active if is_active = true (date range check is optional)
          summary.active++
        } else {
          // Other active statuses need to be within date range using utility function
          const startDate = new Date(caseItem.start_date)
          const endDate = caseItem.end_date ? new Date(caseItem.end_date) : null
          if (isDateInRange(todayDateObj, startDate, endDate)) {
            summary.active++
          } else {
            // Active status but outside date range - still count as active if is_active = true
            // (might be a data issue, but we'll count it)
            summary.active++
          }
        }
      } else if (COMPLETED_CASE_STATUSES.includes(caseStatus as typeof COMPLETED_CASE_STATUSES[number])) {
        // Count completed cases: status is closed or return_to_work
        summary.completed++
      } else if (!caseItem.is_active) {
        // is_active = false means completed (legacy cases without status in notes)
        summary.completed++
      } else {
        // Default to active if status is unknown but is_active = true
        summary.active++
      }
    })

    return c.json({
      cases: formattedCases,
      summary,
      pagination: paginationResponse,
    }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  } catch (error: any) {
    console.error('[GET /whs/cases] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get single case detail by ID for WHS
whs.get('/cases/:id', authMiddleware, requireRole(['whs_control_center']), async (c) => {
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
    // WHS can view all cases assigned to WHS (no clinician_id restriction)
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
        ),
        clinician:users!worker_exceptions_clinician_id_fkey(
          id,
          email,
          first_name,
          last_name,
          full_name
        )
      `)
      .eq('id', caseId)
      .eq('assigned_to_whs', true) // SECURITY: Only cases assigned to WHS
      .in('exception_type', ['injury', 'medical_leave', 'accident', 'other'])
      .single()

    if (caseError || !caseData) {
      console.error('[GET /whs/cases/:id] Error:', caseError)
      return c.json({ error: 'Case not found or not authorized' }, 404)
    }

    // OPTIMIZATION: Parallel fetch of related data
    const team = Array.isArray(caseData.teams) ? caseData.teams[0] : caseData.teams
    const userIds = [team?.supervisor_id, team?.team_leader_id].filter(Boolean)
    
    // Get related incident (for photo and AI analysis)
    const incidentDate = caseData.start_date
    
    const [teamMemberResult, usersResult, incidentResult] = await Promise.all([
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
    const clinician = Array.isArray(caseData.clinician) ? caseData.clinician[0] : caseData.clinician
    
    // Generate case number (consistent with other routes)
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
    
    // Determine case status
    const caseStatusFromNotes = getCaseStatusFromNotes(caseData.notes)
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
        console.warn('[GET /whs/cases/:id] Failed to parse AI analysis:', parseError)
      }
    }

    const formattedCase = {
      id: caseData.id,
      caseNumber: generateCaseNumber(caseData.id, caseData.created_at),
      workerId: caseData.user_id,
      workerName: formatUserFullName(user_data || {}),
      workerEmail: user_data?.email || '',
      workerInitials: (user_data?.first_name?.[0]?.toUpperCase() || '') + (user_data?.last_name?.[0]?.toUpperCase() || '') || 'U',
      workerGender: user_data?.gender || null,
      workerAge: user_data?.date_of_birth ? calculateAge(user_data.date_of_birth) : null,
      teamId: caseData.team_id,
      teamName: team?.name || '',
      siteLocation: team?.site_location || '',
      supervisorName: formatUserFullName(supervisor || {}),
      teamLeaderName: formatUserFullName(teamLeader || {}),
      clinicianId: caseData.clinician_id || null,
      clinicianName: formatUserFullName(clinician || {}),
      type: caseData.exception_type,
      reason: caseData.reason || '',
      startDate: caseData.start_date,
      endDate: caseData.end_date,
      status: mapCaseStatusToDisplay(caseStatusFromNotes, false, isCurrentlyActive),
      // Include incident photo and AI analysis (both formats for backward compatibility)
      // Convert R2 URLs to proxy URLs to avoid DNS resolution issues
      incidentPhotoUrl: incidentResult.data?.id 
        ? getIncidentPhotoProxyUrl(incidentResult.data?.photo_url, incidentResult.data.id, 'whs') 
        : null,
      incidentId: incidentResult.data?.id || null,
      incidentAiAnalysis: aiAnalysis,
      incident: {
        photoUrl: incidentResult.data?.id 
          ? getIncidentPhotoProxyUrl(incidentResult.data?.photo_url, incidentResult.data.id, 'whs') 
          : null,
        incidentId: incidentResult.data?.id || null,
        aiAnalysis: aiAnalysis,
        description: incidentResult.data?.description || null,
        severity: incidentResult.data?.severity || null,
      },
      priority,
      isActive: isCurrentlyActive,
      caseStatus: caseStatusFromNotes || null,
      notes: caseData.notes || null,
      createdAt: caseData.created_at,
      updatedAt: caseData.updated_at,
      return_to_work_duty_type: caseData.return_to_work_duty_type || null,
      return_to_work_date: caseData.return_to_work_date || null,
      phone: teamMemberResult.data?.phone || null,
    }

    return c.json({ case: formattedCase }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  } catch (error: any) {
    console.error('[GET /whs/cases/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Helper function to determine severity
function getSeverity(type: string): string {
  const severityMap: Record<string, string> = {
    injury: 'HIGH',
    accident: 'HIGH',
    medical_leave: 'MEDIUM',
    other: 'LOW',
  }
  return severityMap[type] || 'LOW'
}

// Get notifications for WHS user
whs.get('/notifications', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200) // Max 200 notifications
    const unreadOnly = c.req.query('unread_only') === 'true'

    const adminClient = getAdminClient()

    // SECURITY: Only fetch notifications belonging to the authenticated user
    let query = adminClient
      .from('notifications')
      .select('*')
      .eq('user_id', user.id) // Critical: RLS + explicit user_id check for defense in depth
      .order('created_at', { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.eq('is_read', false)
    }

    const { data: notifications, error } = await query

    if (error) {
      console.error('[GET /whs/notifications] Error:', error)
      return c.json({ error: 'Failed to fetch notifications', details: error.message }, 500)
    }

    // SECURITY: Only count unread notifications belonging to the authenticated user
    const { count: unreadCount, error: countError } = await adminClient
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id) // Critical: Only count user's own notifications
      .eq('is_read', false)

    if (countError) {
      console.error('[GET /whs/notifications] Error counting unread:', countError)
    }

    return c.json({
      notifications: notifications || [],
      unreadCount: unreadCount || 0,
    })
  } catch (error: any) {
    console.error('[GET /whs/notifications] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark notification as read
whs.patch('/notifications/:notificationId/read', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const notificationId = c.req.param('notificationId')
    const adminClient = getAdminClient()

    // Verify notification belongs to user
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

    // SECURITY: Mark as read - verify user_id again in update (defense in depth)
    const { data: updated, error: updateError } = await adminClient
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId)
      .eq('user_id', user.id) // Critical: Double-check user ownership in update
      .select()
      .single()

    if (updateError) {
      console.error('[PATCH /whs/notifications/:id/read] Error:', updateError)
      return c.json({ error: 'Failed to mark notification as read', details: updateError.message }, 500)
    }

    return c.json({ notification: updated })
  } catch (error: any) {
    console.error('[PATCH /whs/notifications/:id/read] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark all notifications as read
whs.patch('/notifications/read-all', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // SECURITY: Only update notifications belonging to the authenticated user
    const { data: updated, error: updateError } = await adminClient
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('user_id', user.id) // Critical: Only mark user's own notifications as read
      .eq('is_read', false)
      .select()

    if (updateError) {
      console.error('[PATCH /whs/notifications/read-all] Error:', updateError)
      return c.json({ error: 'Failed to mark notifications as read', details: updateError.message }, 500)
    }

    return c.json({ 
      message: 'All notifications marked as read',
      count: updated?.length || 0,
    })
  } catch (error: any) {
    console.error('[PATCH /whs/notifications/read-all] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get all clinicians (for assignment dropdown)
whs.get('/clinicians', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    const { data: clinicians, error } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .eq('role', 'clinician')
      .order('full_name', { ascending: true, nullsFirst: false })

    if (error) {
      console.error('[GET /whs/clinicians] Error:', error)
      return c.json({ error: 'Failed to fetch clinicians', details: error.message }, 500)
    }

    const formattedClinicians = (clinicians || []).map((clinician: any) => ({
      id: clinician.id,
      email: clinician.email,
      name: clinician.full_name || 
            (clinician.first_name && clinician.last_name 
              ? `${clinician.first_name} ${clinician.last_name}`
              : clinician.email),
    }))

    return c.json({ clinicians: formattedClinicians })
  } catch (error: any) {
    console.error('[GET /whs/clinicians] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Assign case to clinician
whs.post('/cases/:caseId/assign-clinician', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const caseId = c.req.param('caseId')
    const { clinician_id } = await c.req.json()

    if (!clinician_id) {
      return c.json({ error: 'clinician_id is required' }, 400)
    }

    const adminClient = getAdminClient()

    // Verify case exists and is assigned to WHS
    const { data: caseItem, error: caseError } = await adminClient
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
          site_location
        )
      `)
      .eq('id', caseId)
      .eq('assigned_to_whs', true)
      .single()

    if (caseError || !caseItem) {
      return c.json({ error: 'Case not found or not assigned to WHS' }, 404)
    }

    // Verify clinician exists and is actually a clinician
    const { data: clinician, error: clinicianError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name, role')
      .eq('id', clinician_id)
      .eq('role', 'clinician')
      .single()

    if (clinicianError || !clinician) {
      return c.json({ error: 'Clinician not found' }, 404)
    }

    // Update case with clinician assignment
    const { data: updatedCase, error: updateError } = await adminClient
      .from('worker_exceptions')
      .update({ clinician_id })
      .eq('id', caseId)
      .select()
      .single()

    if (updateError) {
      console.error('[POST /whs/cases/:caseId/assign-clinician] Error:', updateError)
      return c.json({ error: 'Failed to assign case to clinician', details: updateError.message }, 500)
    }

    // Generate case number for notification
    const createdAt = new Date(caseItem.created_at)
    const year = createdAt.getFullYear()
    const month = String(createdAt.getMonth() + 1).padStart(2, '0')
    const day = String(createdAt.getDate()).padStart(2, '0')
    const hours = String(createdAt.getHours()).padStart(2, '0')
    const minutes = String(createdAt.getMinutes()).padStart(2, '0')
    const seconds = String(createdAt.getSeconds()).padStart(2, '0')
    const uuidPrefix = caseItem.id.substring(0, 4).toUpperCase()
    const caseNumber = `CASE-${year}${month}${day}-${hours}${minutes}${seconds}-${uuidPrefix}`

    const worker = Array.isArray(caseItem.users) ? caseItem.users[0] : caseItem.users
    const workerName = worker?.full_name || 
                     (worker?.first_name && worker?.last_name 
                       ? `${worker.first_name} ${worker.last_name}`
                       : worker?.email || 'Unknown')

    // Create notification for clinician
    const notification = {
      user_id: clinician_id,
      type: 'case_assigned_to_clinician',
      title: '📋 New Case Assigned',
      message: `A case (${caseNumber}) has been assigned to you. Worker: ${workerName}.`,
      data: {
        case_id: caseId,
        case_number: caseNumber,
        worker_id: caseItem.user_id,
        worker_name: workerName,
        worker_email: worker?.email || '',
        exception_type: caseItem.exception_type,
        reason: caseItem.reason || '',
        start_date: caseItem.start_date,
        end_date: caseItem.end_date,
        assigned_by: user.id,
        assigned_by_name: user.email || 'WHS Control Center',
      },
      is_read: false,
    }

    const { error: notifyError } = await adminClient
      .from('notifications')
      .insert([notification])

    if (notifyError) {
      console.error('[POST /whs/cases/:caseId/assign-clinician] Error creating notification:', notifyError)
      // Don't fail the assignment if notification fails
    } else {
      console.log(`[POST /whs/cases/:caseId/assign-clinician] Notification sent to clinician ${clinician_id} for case ${caseId}`)
    }

    return c.json({ 
      message: 'Case assigned to clinician successfully',
      case: updatedCase,
      clinician: {
        id: clinician.id,
        name: clinician.full_name || 
              (clinician.first_name && clinician.last_name 
                ? `${clinician.first_name} ${clinician.last_name}`
                : clinician.email),
      },
    })
  } catch (error: any) {
    console.error('[POST /whs/cases/:caseId/assign-clinician] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get WHS Analytics data
whs.get('/analytics', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const range = c.req.query('range') || 'month' // week, month, year
    const adminClient = getAdminClient()

    // Only incident-worthy exception types
    const incidentTypes = ['accident', 'injury', 'medical_leave', 'other']

    // Get all cases assigned to WHS with team and supervisor info
    const { data: allCases, error: casesError } = await adminClient
      .from('worker_exceptions')
      .select(`
        id, 
        exception_type, 
        is_active, 
        start_date, 
        end_date, 
        created_at, 
        clinician_id, 
        notes, 
        assigned_to_whs,
        team_id,
        teams!worker_exceptions_team_id_fkey(
          id,
          supervisor_id,
          name,
          site_location
        )
      `)
      .in('exception_type', incidentTypes)
      .eq('assigned_to_whs', true)

    if (casesError) {
      console.error('[GET /whs/analytics] Error fetching cases:', casesError)
      return c.json({ error: 'Failed to fetch analytics data', details: casesError.message }, 500)
    }

    const cases = allCases || []
    const today = normalizeDate(new Date())

    // Calculate date ranges
    let startDate: Date
    
    if (range === 'week') {
      startDate = new Date(today)
      startDate.setDate(startDate.getDate() - 7)
    } else if (range === 'year') {
      startDate = new Date(today.getFullYear(), 0, 1)
    } else {
      // month (default)
      startDate = new Date(today.getFullYear(), today.getMonth(), 1)
    }
    startDate = normalizeDate(startDate)

    // Filter cases within range
    const rangeCases = cases.filter((caseItem: any) => {
      const createdAt = new Date(caseItem.created_at)
      return createdAt >= startDate
    })

    // OPTIMIZATION: Calculate active cases using case status from notes (more accurate)
    const totalCases = cases.length
    const activeCases = cases.filter((c: any) => {
      const caseStatus = getCaseStatusFromNotes(c.notes) || 'new'
      const isActiveStatus = ACTIVE_CASE_STATUSES.includes(caseStatus as typeof ACTIVE_CASE_STATUSES[number])
      
      if (!isActiveStatus || !c.is_active) return false
      
      // For in_rehab cases, count as active if is_active = true
      if (caseStatus === 'in_rehab') {
        return true
      }
      
      // For other active statuses, check date range
      const start = new Date(c.start_date)
      const end = c.end_date ? new Date(c.end_date) : null
      return isDateInRange(today, start, end)
    }).length

    const newCases = rangeCases.length

    // OPTIMIZATION: Calculate closed cases using case status from notes (more accurate)
    const closedCases = cases.filter((c: any) => {
      const caseStatus = getCaseStatusFromNotes(c.notes) || 'new'
      // Count as closed if status is closed or return_to_work
      if (COMPLETED_CASE_STATUSES.includes(caseStatus as typeof COMPLETED_CASE_STATUSES[number])) {
        return true
      }
      // Legacy: also count if is_active = false or past end_date
      const end = c.end_date ? new Date(c.end_date) : null
      return !c.is_active || (end && normalizeDate(end) < today)
    })

    let avgResolutionTime = 0
    if (closedCases.length > 0) {
      const totalDays = closedCases.reduce((sum: number, c: any) => {
        const start = new Date(c.start_date)
        const end = c.end_date ? new Date(c.end_date) : new Date()
        const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
        return sum + days
      }, 0)
      avgResolutionTime = totalDays / closedCases.length
    }

    // Success rate (closed vs total)
    const successRate = totalCases > 0 ? Math.round((closedCases.length / totalCases) * 100) : 0

    // Clinician assignment rate
    const casesWithClinician = cases.filter((c: any) => c.clinician_id).length
    const clinicianAssignment = totalCases > 0 ? Math.round((casesWithClinician / totalCases) * 100) : 0

    // OPTIMIZATION: Closed this period using case status from notes
    const closedThisPeriod = rangeCases.filter((c: any) => {
      const caseStatus = getCaseStatusFromNotes(c.notes) || 'new'
      if (COMPLETED_CASE_STATUSES.includes(caseStatus as typeof COMPLETED_CASE_STATUSES[number])) {
        const end = c.end_date ? new Date(c.end_date) : null
        if (!end) return true // Closed status without end_date counts
        return normalizeDate(end) >= startDate && normalizeDate(end) <= today
      }
      // Legacy: also check is_active and end_date
      const end = c.end_date ? new Date(c.end_date) : null
      return (!c.is_active || (end && normalizeDate(end) >= startDate && normalizeDate(end) <= today))
    }).length

    // Upcoming deadlines (cases ending in next 7 days)
    const sevenDaysFromNow = normalizeDate(new Date(today))
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)
    const upcomingDeadlines = cases.filter((c: any) => {
      if (!c.end_date || !c.is_active) return false
      const end = normalizeDate(new Date(c.end_date))
      return end >= today && end <= sevenDaysFromNow
    }).length

    // Overdue tasks (cases past end date but still active)
    const overdueTasks = cases.filter((c: any) => {
      if (!c.end_date || !c.is_active) return false
      const caseStatus = getCaseStatusFromNotes(c.notes) || 'new'
      // Only count as overdue if not in_rehab (in_rehab cases can extend past end_date)
      if (caseStatus === 'in_rehab') return false
      const end = normalizeDate(new Date(c.end_date))
      return end < today
    }).length

    // Cases by status
    const casesByStatus = {
      open: 0,
      triaged: 0,
      assessed: 0,
      inRehab: 0,
      closed: 0,
      returnToWork: 0,
    }

    // OPTIMIZATION: Use centralized getCaseStatusFromNotes utility
    cases.forEach((c: any) => {
      const status = getCaseStatusFromNotes(c.notes) || 'new'
      if (status === 'new') {
        casesByStatus.open++
      } else if (status === 'triaged') {
        casesByStatus.triaged++
      } else if (status === 'assessed') {
        casesByStatus.assessed++
      } else if (status === 'in_rehab') {
        casesByStatus.inRehab++
      } else if (status === 'closed') {
        casesByStatus.closed++
      } else if (status === 'return_to_work') {
        casesByStatus.returnToWork++
      } else {
        // Default to open for unknown statuses
        casesByStatus.open++
      }
    })

    // Case trends over time
    const caseTrends: Array<{ period: string; newCases: number; closedCases: number; activeCases: number }> = []
    
    if (range === 'week') {
      // Daily for week (last 7 days)
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        date.setHours(0, 0, 0, 0)
        const dateEnd = new Date(date)
        dateEnd.setHours(23, 59, 59, 999)
        const dateStr = date.toLocaleDateString('en-US', { weekday: 'short' })
        
        // OPTIMIZATION: New cases created on this day
        const dayCases = cases.filter((c: any) => {
          const created = normalizeDate(new Date(c.created_at))
          return created.getTime() === date.getTime()
        }).length
        
        // OPTIMIZATION: Closed cases on this day using case status from notes
        const dayClosed = cases.filter((c: any) => {
          const caseStatus = getCaseStatusFromNotes(c.notes) || 'new'
          // Check if case was closed on this day
          if (COMPLETED_CASE_STATUSES.includes(caseStatus as typeof COMPLETED_CASE_STATUSES[number])) {
            const end = c.end_date ? normalizeDate(new Date(c.end_date)) : null
            if (end && end.getTime() === date.getTime()) return true
          }
          // Legacy: also check end_date
          if (!c.end_date) return false
          const end = normalizeDate(new Date(c.end_date))
          return end.getTime() === date.getTime()
        }).length
        
        // OPTIMIZATION: Active cases on this day using case status from notes
        const dayActive = cases.filter((c: any) => {
          const caseStatus = getCaseStatusFromNotes(c.notes) || 'new'
          const isActiveStatus = ACTIVE_CASE_STATUSES.includes(caseStatus as typeof ACTIVE_CASE_STATUSES[number])
          if (!isActiveStatus || !c.is_active) return false
          
          // For in_rehab cases, count as active if is_active = true
          if (caseStatus === 'in_rehab') return true
          
          // For other active statuses, check date range
          const start = new Date(c.start_date)
          const end = c.end_date ? new Date(c.end_date) : null
          return isDateInRange(date, start, end)
        }).length

        caseTrends.push({
          period: dateStr,
          newCases: dayCases,
          closedCases: dayClosed,
          activeCases: dayActive,
        })
      }
    } else if (range === 'month') {
      // Weekly for month (current month)
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      monthEnd.setHours(23, 59, 59, 999)
      
      // Calculate weeks in the month
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      const daysInMonth = lastDayOfMonth.getDate()
      const weeksInMonth = Math.ceil(daysInMonth / 7)
      
      for (let i = 0; i < weeksInMonth; i++) {
        const weekStart = new Date(firstDayOfMonth)
        weekStart.setDate(firstDayOfMonth.getDate() + (i * 7))
        weekStart.setHours(0, 0, 0, 0)
        const weekEnd = new Date(weekStart)
        weekEnd.setDate(weekStart.getDate() + 6)
        weekEnd.setHours(23, 59, 59, 999)
        
        // Don't show future weeks
        if (weekStart > today) break
        
        // New cases created in this week
        const weekCases = cases.filter((c: any) => {
          const created = new Date(c.created_at)
          return created >= weekStart && created <= weekEnd
        }).length
        
        // OPTIMIZATION: Closed cases in this week using case status from notes
        const weekClosed = cases.filter((c: any) => {
          const caseStatus = getCaseStatusFromNotes(c.notes) || 'new'
          // Check if case was closed in this week
          if (COMPLETED_CASE_STATUSES.includes(caseStatus as typeof COMPLETED_CASE_STATUSES[number])) {
            const end = c.end_date ? new Date(c.end_date) : null
            if (end && end >= weekStart && end <= weekEnd) return true
          }
          // Legacy: also check end_date
          if (!c.end_date) return false
          const end = new Date(c.end_date)
          return end >= weekStart && end <= weekEnd
        }).length
        
        // OPTIMIZATION: Active cases at the end of this week using case status from notes
        const weekActive = cases.filter((c: any) => {
          const caseStatus = getCaseStatusFromNotes(c.notes) || 'new'
          const isActiveStatus = ACTIVE_CASE_STATUSES.includes(caseStatus as typeof ACTIVE_CASE_STATUSES[number])
          if (!isActiveStatus || !c.is_active) return false
          
          // For in_rehab cases, count as active if is_active = true
          if (caseStatus === 'in_rehab') return true
          
          // For other active statuses, check date range
          const start = new Date(c.start_date)
          const end = c.end_date ? new Date(c.end_date) : null
          return isDateInRange(weekEnd, start, end)
        }).length

        caseTrends.push({
          period: `Week ${i + 1}`,
          newCases: weekCases,
          closedCases: weekClosed,
          activeCases: weekActive,
        })
      }
    } else {
      // Monthly for year (current year)
      for (let i = 0; i < 12; i++) {
        const monthStart = new Date(today.getFullYear(), i, 1)
        monthStart.setHours(0, 0, 0, 0)
        const monthEnd = new Date(today.getFullYear(), i + 1, 0)
        monthEnd.setHours(23, 59, 59, 999)
        
        // Don't show future months
        if (monthStart > today) break
        
        // OPTIMIZATION: New cases created in this month
        const monthCases = cases.filter((c: any) => {
          const created = new Date(c.created_at)
          return created >= monthStart && created <= monthEnd
        }).length
        
        // OPTIMIZATION: Closed cases in this month using case status from notes
        const monthClosed = cases.filter((c: any) => {
          const caseStatus = getCaseStatusFromNotes(c.notes) || 'new'
          // Check if case was closed in this month
          if (COMPLETED_CASE_STATUSES.includes(caseStatus as typeof COMPLETED_CASE_STATUSES[number])) {
            const end = c.end_date ? new Date(c.end_date) : null
            if (end && end >= monthStart && end <= monthEnd) return true
          }
          // Legacy: also check end_date
          if (!c.end_date) return false
          const end = new Date(c.end_date)
          return end >= monthStart && end <= monthEnd
        }).length
        
        // OPTIMIZATION: Active cases at the end of this month using case status from notes
        const monthActive = cases.filter((c: any) => {
          const caseStatus = getCaseStatusFromNotes(c.notes) || 'new'
          const isActiveStatus = ACTIVE_CASE_STATUSES.includes(caseStatus as typeof ACTIVE_CASE_STATUSES[number])
          if (!isActiveStatus || !c.is_active) return false
          
          // For in_rehab cases, count as active if is_active = true
          if (caseStatus === 'in_rehab') return true
          
          // For other active statuses, check date range
          const start = new Date(c.start_date)
          const end = c.end_date ? new Date(c.end_date) : null
          return isDateInRange(monthEnd, start, end)
        }).length

        caseTrends.push({
          period: monthStart.toLocaleDateString('en-US', { month: 'short' }),
          newCases: monthCases,
          closedCases: monthClosed,
          activeCases: monthActive,
        })
      }
    }

    // Calculate supervisor statistics (cases per supervisor)
    const supervisorStatsMap = new Map<string, { supervisorId: string; cases: any[]; teamIds: Set<string>; teamLeaderIds: Set<string> }>()
    
    cases.forEach((caseItem: any) => {
      const team = Array.isArray(caseItem.teams) ? caseItem.teams[0] : caseItem.teams
      if (team && team.supervisor_id) {
        if (!supervisorStatsMap.has(team.supervisor_id)) {
          supervisorStatsMap.set(team.supervisor_id, {
            supervisorId: team.supervisor_id,
            cases: [],
            teamIds: new Set(),
            teamLeaderIds: new Set(),
          })
        }
        const stats = supervisorStatsMap.get(team.supervisor_id)!
        stats.cases.push(caseItem)
        if (team.id) {
          stats.teamIds.add(team.id)
        }
        // Track team leader IDs (from team_leader_id field)
        if (team.team_leader_id) {
          stats.teamLeaderIds.add(team.team_leader_id)
        }
      }
    })

    // OPTIMIZATION: Get all teams for supervisors to count team leaders accurately
    // (in case some teams don't have cases yet)
    const supervisorIds = Array.from(supervisorStatsMap.keys())
    if (supervisorIds.length > 0) {
      const { data: allTeams } = await adminClient
        .from('teams')
        .select('id, supervisor_id, team_leader_id')
        .in('supervisor_id', supervisorIds)

      if (allTeams) {
        allTeams.forEach((team: any) => {
          if (team.supervisor_id && supervisorStatsMap.has(team.supervisor_id)) {
            const stats = supervisorStatsMap.get(team.supervisor_id)!
            if (team.id) {
              stats.teamIds.add(team.id)
            }
            if (team.team_leader_id) {
              stats.teamLeaderIds.add(team.team_leader_id)
            }
          }
        })
      }
    }

    // Get supervisor details
    const supervisorDetails = supervisorIds.length > 0
      ? await adminClient
          .from('users')
          .select('id, email, first_name, last_name, full_name')
          .in('id', supervisorIds)
          .eq('role', 'supervisor')
      : { data: [], error: null }

    const supervisorDetailsMap = new Map<string, any>()
    if (supervisorDetails.data) {
      supervisorDetails.data.forEach((sup: any) => {
        supervisorDetailsMap.set(sup.id, sup)
      })
    }

    // Build supervisor statistics array
    const supervisorStats = Array.from(supervisorStatsMap.entries())
      .map(([supervisorId, stats]) => {
        const supervisor = supervisorDetailsMap.get(supervisorId)
        // OPTIMIZATION: Active cases count using case status from notes
        const activeCasesCount = stats.cases.filter((c: any) => {
          const caseStatus = getCaseStatusFromNotes(c.notes) || 'new'
          const isActiveStatus = ACTIVE_CASE_STATUSES.includes(caseStatus as typeof ACTIVE_CASE_STATUSES[number])
          if (!isActiveStatus || !c.is_active) return false
          
          // For in_rehab cases, count as active if is_active = true
          if (caseStatus === 'in_rehab') return true
          
          // For other active statuses, check date range
          const start = new Date(c.start_date)
          const end = c.end_date ? new Date(c.end_date) : null
          return isDateInRange(today, start, end)
        }).length
        
        return {
          id: supervisorId,
          name: supervisor?.full_name || 
                (supervisor?.first_name && supervisor?.last_name 
                  ? `${supervisor.first_name} ${supervisor.last_name}`
                  : supervisor?.email || 'Unknown Supervisor'),
          email: supervisor?.email || '',
          totalCases: stats.cases.length,
          activeCases: activeCasesCount,
          teamsCount: stats.teamIds.size,
          teamLeadersCount: stats.teamLeaderIds.size,
        }
      })
      .sort((a, b) => b.totalCases - a.totalCases) // Sort by total cases descending

    return c.json({
      summary: {
        totalCases,
        activeCases,
        newCases,
        avgResolutionTime,
        successRate,
        clinicianAssignment,
        closedThisPeriod,
        upcomingDeadlines,
        overdueTasks,
      },
      caseTrends,
      casesByStatus,
      supervisorStats,
    }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  } catch (error: any) {
    console.error('[GET /whs/analytics] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get Clinician Performance data
whs.get('/clinicians/performance', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // Get all clinicians
    const { data: clinicians, error: cliniciansError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .eq('role', 'clinician')
      .order('full_name', { ascending: true, nullsFirst: false })

    if (cliniciansError) {
      console.error('[GET /whs/clinicians/performance] Error fetching clinicians:', cliniciansError)
      return c.json({ error: 'Failed to fetch clinicians', details: cliniciansError.message }, 500)
    }

    if (!clinicians || clinicians.length === 0) {
      return c.json({ clinicians: [] })
    }

    const clinicianIds = clinicians.map((c: any) => c.id)
    const incidentTypes = ['accident', 'injury', 'medical_leave', 'other']

    // Get all cases assigned to these clinicians
    const { data: allCases, error: casesError } = await adminClient
      .from('worker_exceptions')
      .select('id, clinician_id, is_active, start_date, end_date, created_at, notes, assigned_to_whs')
      .in('exception_type', incidentTypes)
      .eq('assigned_to_whs', true)
      .in('clinician_id', clinicianIds)

    if (casesError) {
      console.error('[GET /whs/clinicians/performance] Error fetching cases:', casesError)
      return c.json({ error: 'Failed to fetch cases', details: casesError.message }, 500)
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Get assignment notifications to track when cases were assigned to clinicians
    // OPTIMIZATION: Only fetch notifications for clinicians we have
    const { data: assignmentNotifications } = await adminClient
      .from('notifications')
      .select('id, user_id, created_at, data')
      .eq('type', 'case_assigned_to_clinician')
      .in('user_id', clinicianIds)

    // Build a map of clinician_id -> case_id -> assignment_date
    // OPTIMIZATION: Handle case reassignments by keeping the LATEST assignment date
    const assignmentDatesMap = new Map<string, Map<string, Date>>()
    if (assignmentNotifications) {
      assignmentNotifications.forEach((notif: any) => {
        try {
          const clinicianId = notif.user_id
          const caseId = notif.data?.case_id
          if (clinicianId && caseId && notif.created_at) {
            if (!assignmentDatesMap.has(clinicianId)) {
              assignmentDatesMap.set(clinicianId, new Map())
            }
            const assignmentDate = new Date(notif.created_at)
            assignmentDate.setHours(0, 0, 0, 0)
            
            // If case was reassigned, keep the latest assignment date
            const existingDate = assignmentDatesMap.get(clinicianId)!.get(caseId)
            if (!existingDate || assignmentDate.getTime() > existingDate.getTime()) {
              assignmentDatesMap.get(clinicianId)!.set(caseId, assignmentDate)
            }
          }
        } catch {
          // Ignore invalid data
        }
      })
    }

    // Get rehabilitation plans for these clinicians
    const { data: rehabPlans } = await adminClient
      .from('rehabilitation_plans')
      .select('id, clinician_id, status, created_at')
      .in('clinician_id', clinicianIds)

    // OPTIMIZATION: Pre-group cases by clinician_id to avoid filtering in loop
    const casesByClinician = new Map<string, any[]>()
    if (allCases) {
      allCases.forEach((c: any) => {
        if (c.clinician_id) {
          if (!casesByClinician.has(c.clinician_id)) {
            casesByClinician.set(c.clinician_id, [])
          }
          casesByClinician.get(c.clinician_id)!.push(c)
        }
      })
    }

    // OPTIMIZATION: Use centralized notes parser
    const parseNotes = (notes: string | null): { status: string; approved_at: string | null } => {
      if (!notes) return { status: 'open', approved_at: null }
      const parsedNotes = parseIncidentNotes(notes)
      return {
        status: parsedNotes?.case_status || 'open',
        approved_at: parsedNotes?.approved_at || null
      }
    }

    // Calculate performance for each clinician
    const performanceData = clinicians.map((clinician: any) => {
      const clinicianCases = casesByClinician.get(clinician.id) || []
      
      // OPTIMIZATION: Pre-calculate dates and status once per case
      const processedCases = clinicianCases.map((c: any) => {
        const start = new Date(c.start_date)
        start.setHours(0, 0, 0, 0)
        const end = c.end_date ? new Date(c.end_date) : null
        if (end) end.setHours(0, 0, 0, 0)
        const notesParsed = parseNotes(c.notes)
        
        return {
          ...c,
          _startDate: start,
          _endDate: end,
          _status: notesParsed.status,
          _approvedAt: notesParsed.approved_at
        }
      })
      
      // Active cases
      const activeCases = processedCases.filter((c: any) => {
        return c.is_active && today >= c._startDate && (!c._endDate || today <= c._endDate)
      }).length

      // Completed cases (closed or return to work)
      const completedCases = processedCases.filter((c: any) => {
        return c._status === 'closed' || c._status === 'return_to_work'
      }).length

      // Calculate average duration for completed cases
      // Duration = from assignment to clinician until case closure by clinician
      let avgDuration = 0
      const completedCasesWithDates = processedCases.filter((c: any) => {
        return c._status === 'closed' || c._status === 'return_to_work'
      })

      if (completedCasesWithDates.length > 0) {
        // Get assignment dates map for this clinician
        const assignmentDates = assignmentDatesMap.get(clinician.id) || new Map<string, Date>()
        
        const validDurations: number[] = []
        
        completedCasesWithDates.forEach((c: any) => {
          // Get assignment date (when WHS assigned case to clinician)
          const assignmentDate = assignmentDates.get(c.id)
          if (!assignmentDate) {
            // Skip if no notification found (can't calculate duration accurately)
            return
          }

          // Get completion date (when clinician closed/approved the case)
          let completionDate: Date | null = null
          
          // First, try to get approved_at from notes (most accurate)
          if (c._approvedAt) {
            completionDate = new Date(c._approvedAt)
          } else if (c._endDate) {
            // Fallback to end_date
            completionDate = c._endDate
          }
          
          // Skip if no completion date
          if (!completionDate) {
            return
          }

          // Normalize dates to start of day for accurate calculation
          completionDate.setHours(0, 0, 0, 0)

          // Calculate days between assignment and completion
          const days = Math.ceil((completionDate.getTime() - assignmentDate.getTime()) / (1000 * 60 * 60 * 24))
          
          // Only count positive durations (shouldn't be negative, but safety check)
          if (days >= 0) {
            validDurations.push(days)
          }
        })

        // Calculate average only if we have valid durations
        if (validDurations.length > 0) {
          const totalDays = validDurations.reduce((sum, days) => sum + days, 0)
          avgDuration = Math.round(totalDays / validDurations.length)
        }
      }

      // Success rate (completed / total assigned)
      const totalAssigned = clinicianCases.length
      const successRate = totalAssigned > 0 ? Math.round((completedCases / totalAssigned) * 100) : 0

      // Get clinician name
      const clinicianName = clinician.full_name || 
                           (clinician.first_name && clinician.last_name 
                             ? `${clinician.first_name} ${clinician.last_name}`
                             : clinician.email)

      // Specialty (default to General for now, can be extended later)
      const specialty = 'General'

      // Status (Available - can be extended to check if clinician is busy/on leave)
      const status = 'Available'

      return {
        id: clinician.id,
        name: clinicianName,
        email: clinician.email,
        specialty,
        status,
        activeCases,
        completed: completedCases,
        avgDuration,
        successRate,
        totalAssigned,
      }
    })

    // Sort by active cases (descending), then by name
    performanceData.sort((a, b) => {
      if (b.activeCases !== a.activeCases) {
        return b.activeCases - a.activeCases
      }
      return a.name.localeCompare(b.name)
    })

    return c.json({ clinicians: performanceData })
  } catch (error: any) {
    console.error('[GET /whs/clinicians/performance] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get incident photo (proxy endpoint to serve R2 images)
// This avoids DNS resolution issues with R2 public URLs
whs.get('/incident-photo/:incidentId', authMiddleware, requireRole(['whs_control_center']), async (c) => {
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
      console.warn(`[GET /whs/incident-photo/:incidentId] Could not extract file path from URL: ${incident.photo_url}`)
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
      console.error(`[GET /whs/incident-photo/:incidentId] Error fetching from R2:`, r2Error)
      // Fallback: redirect to original URL
      return c.redirect(incident.photo_url)
    }
  } catch (error: any) {
    console.error('[GET /whs/incident-photo/:incidentId] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// ============================================
// Certificate Image Proxy Endpoint
// ============================================

// Proxy endpoint for certificate images (similar to incident photos)
// This endpoint serves images from R2 storage to avoid DNS resolution issues
whs.get('/certificate-image/:userId/:imageId', async (c) => {
  try {
    const userId = c.req.param('userId')
    const imageId = c.req.param('imageId')
    
    if (!userId || !imageId) {
      return c.json({ error: 'User ID and Image ID are required' }, 400)
    }

    // Construct the R2 file path
    const filePath = `certificates/${userId}/${imageId}`
    console.log('[GET /whs/certificate-image] Fetching:', filePath)

    // Fetch image from R2
    try {
      const imageBuffer = await getFromR2(filePath)
      
      // Determine content type from file extension
      const contentType = getContentTypeFromFilePath(filePath)

      // Set appropriate headers
      c.header('Content-Type', contentType)
      c.header('Cache-Control', 'public, max-age=31536000, immutable') // Cache for 1 year
      c.header('Content-Disposition', `inline; filename="${imageId}"`)
      
      return c.body(imageBuffer as any)
    } catch (r2Error: any) {
      console.error(`[GET /whs/certificate-image] Error fetching from R2:`, r2Error)
      return c.json({ error: 'Image not found in storage' }, 404)
    }
  } catch (error: any) {
    console.error('[GET /whs/certificate-image] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// ============================================
// Certificate Management Endpoints
// ============================================

// Get all certificate templates
whs.get('/certificate-templates', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()
    const templateType = c.req.query('type') // Optional filter by type

    let query = adminClient
      .from('certificate_templates')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (templateType) {
      query = query.eq('template_type', templateType)
    }

    const { data: templates, error } = await query

    if (error) {
      console.error('[GET /whs/certificate-templates] Error:', error)
      return c.json({ error: 'Failed to fetch templates', details: error.message }, 500)
    }

    // Convert image URLs to proxy URLs
    const templatesWithProxyUrls = (templates || []).map((template: any) => {
      const getProxyUrl = (url: string | null) => {
        if (!url) return null
        return getCertificateImageProxyUrl(url) || url
      }

      return {
        ...template,
        background_image_url: getProxyUrl(template.background_image_url),
        logo_url: getProxyUrl(template.logo_url),
        header_image_url: getProxyUrl(template.header_image_url),
        footer_image_url: getProxyUrl(template.footer_image_url),
        signature_image_url: getProxyUrl(template.signature_image_url),
      }
    })

    return c.json({ templates: templatesWithProxyUrls })
  } catch (error: any) {
    console.error('[GET /whs/certificate-templates] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get single certificate template
whs.get('/certificate-templates/:id', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const templateId = c.req.param('id')
    const adminClient = getAdminClient()

    const { data: template, error } = await adminClient
      .from('certificate_templates')
      .select('*')
      .eq('id', templateId)
      .single()

    if (error || !template) {
      return c.json({ error: 'Template not found' }, 404)
    }

    // Convert image URLs to proxy URLs
    const getProxyUrl = (url: string | null) => {
      if (!url) return null
      return getCertificateImageProxyUrl(url) || url
    }

    const templateWithProxyUrls = {
      ...template,
      background_image_url: getProxyUrl(template.background_image_url),
      logo_url: getProxyUrl(template.logo_url),
      header_image_url: getProxyUrl(template.header_image_url),
      footer_image_url: getProxyUrl(template.footer_image_url),
      signature_image_url: getProxyUrl(template.signature_image_url),
    }

    return c.json({ template: templateWithProxyUrls })
  } catch (error: any) {
    console.error('[GET /whs/certificate-templates/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Create certificate template
whs.post('/certificate-templates', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const { 
      name, 
      description, 
      template_type, 
      html_content, 
      placeholders, 
      styles, 
      page_size, 
      orientation, 
      is_default,
      // Image template fields
      use_background_mode,
      background_image_url,
      text_positions,
      logo_url,
      logo_position,
      header_image_url,
      footer_image_url,
      signature_image_url,
      signature_position
    } = body

    // Validate based on template mode
    if (use_background_mode) {
      if (!name || !template_type || !background_image_url) {
        return c.json({ error: 'Missing required fields: name, template_type, background_image_url' }, 400)
      }
    } else {
      if (!name || !template_type || !html_content) {
        return c.json({ error: 'Missing required fields: name, template_type, html_content' }, 400)
      }
    }

    const adminClient = getAdminClient()

    // If setting as default, unset other defaults of same type
    if (is_default) {
      await adminClient
        .from('certificate_templates')
        .update({ is_default: false })
        .eq('template_type', template_type)
    }

    const insertData: any = {
      name,
      description,
      template_type,
      html_content: html_content || '',
      placeholders: placeholders || [],
      styles: styles || {},
      page_size: page_size || 'A4',
      orientation: orientation || 'portrait',
      is_default: is_default || false,
      created_by: user.id,
      // Image template fields
      use_background_mode: use_background_mode || false,
    }

    // Add image fields if provided
    if (background_image_url) insertData.background_image_url = background_image_url
    if (text_positions) insertData.text_positions = text_positions
    if (logo_url) insertData.logo_url = logo_url
    if (logo_position) insertData.logo_position = logo_position
    if (header_image_url) insertData.header_image_url = header_image_url
    if (footer_image_url) insertData.footer_image_url = footer_image_url
    if (signature_image_url) insertData.signature_image_url = signature_image_url
    if (signature_position) insertData.signature_position = signature_position

    const { data: template, error } = await adminClient
      .from('certificate_templates')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error('[POST /whs/certificate-templates] Error:', error)
      return c.json({ error: 'Failed to create template', details: error.message }, 500)
    }

    return c.json({ template }, 201)
  } catch (error: any) {
    console.error('[POST /whs/certificate-templates] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update certificate template
whs.put('/certificate-templates/:id', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const templateId = c.req.param('id')
    const body = await c.req.json()
    const { 
      name, 
      description, 
      html_content, 
      placeholders, 
      styles, 
      page_size, 
      orientation, 
      is_default, 
      is_active,
      // Image template fields
      use_background_mode,
      background_image_url,
      text_positions,
      logo_url,
      logo_position,
      header_image_url,
      footer_image_url,
      signature_image_url,
      signature_position
    } = body

    const adminClient = getAdminClient()

    // Verify template exists
    const { data: existing, error: fetchError } = await adminClient
      .from('certificate_templates')
      .select('*')
      .eq('id', templateId)
      .single()

    if (fetchError || !existing) {
      return c.json({ error: 'Template not found' }, 404)
    }

    // If setting as default, unset other defaults of same type
    if (is_default && existing.template_type) {
      await adminClient
        .from('certificate_templates')
        .update({ is_default: false })
        .eq('template_type', existing.template_type)
        .neq('id', templateId)
    }

    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (html_content !== undefined) updateData.html_content = html_content
    if (placeholders !== undefined) updateData.placeholders = placeholders
    if (styles !== undefined) updateData.styles = styles
    if (page_size !== undefined) updateData.page_size = page_size
    if (orientation !== undefined) updateData.orientation = orientation
    if (is_default !== undefined) updateData.is_default = is_default
    if (is_active !== undefined) updateData.is_active = is_active
    // Image template fields
    if (use_background_mode !== undefined) updateData.use_background_mode = use_background_mode
    if (background_image_url !== undefined) updateData.background_image_url = background_image_url
    if (text_positions !== undefined) updateData.text_positions = text_positions
    if (logo_url !== undefined) updateData.logo_url = logo_url
    if (logo_position !== undefined) updateData.logo_position = logo_position
    if (header_image_url !== undefined) updateData.header_image_url = header_image_url
    if (footer_image_url !== undefined) updateData.footer_image_url = footer_image_url
    if (signature_image_url !== undefined) updateData.signature_image_url = signature_image_url
    if (signature_position !== undefined) updateData.signature_position = signature_position

    const { data: template, error } = await adminClient
      .from('certificate_templates')
      .update(updateData)
      .eq('id', templateId)
      .select()
      .single()

    if (error) {
      console.error('[PUT /whs/certificate-templates/:id] Error:', error)
      return c.json({ error: 'Failed to update template', details: error.message }, 500)
    }

    return c.json({ template })
  } catch (error: any) {
    console.error('[PUT /whs/certificate-templates/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Delete certificate template
whs.delete('/certificate-templates/:id', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const templateId = c.req.param('id')
    const adminClient = getAdminClient()

    // Soft delete - just mark as inactive
    const { error } = await adminClient
      .from('certificate_templates')
      .update({ is_active: false })
      .eq('id', templateId)

    if (error) {
      console.error('[DELETE /whs/certificate-templates/:id] Error:', error)
      return c.json({ error: 'Failed to delete template', details: error.message }, 500)
    }

    return c.json({ message: 'Template deleted successfully' })
  } catch (error: any) {
    console.error('[DELETE /whs/certificate-templates/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Generate certificate from template
whs.post('/certificates/generate', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const { template_id, case_id, worker_id, certificate_data } = body

    if (!template_id || !worker_id) {
      return c.json({ error: 'Missing required fields: template_id, worker_id' }, 400)
    }

    const adminClient = getAdminClient()

    // Fetch template
    const { data: template, error: templateError } = await adminClient
      .from('certificate_templates')
      .select('*')
      .eq('id', template_id)
      .single()

    if (templateError || !template) {
      return c.json({ error: 'Template not found' }, 404)
    }

    // Fetch worker details
    const { data: worker, error: workerError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .eq('id', worker_id)
      .single()

    if (workerError || !worker) {
      return c.json({ error: 'Worker not found' }, 404)
    }

    // Fetch case details if case_id provided
    let caseDetails = null
    if (case_id) {
      const { data: caseData } = await adminClient
        .from('worker_exceptions')
        .select('*')
        .eq('id', case_id)
        .single()
      caseDetails = caseData
    }

    // Prepare data for placeholder replacement
    const workerName = worker.full_name || `${worker.first_name || ''} ${worker.last_name || ''}`.trim() || worker.email
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    
    const placeholderData: Record<string, string> = {
      '{{worker_name}}': workerName,
      '{{worker_id}}': worker.id.substring(0, 8).toUpperCase(),
      '{{worker_email}}': worker.email,
      '{{issue_date}}': today,
      '{{whs_name}}': (user as any).full_name || user.email,
      ...certificate_data, // Allow custom data from frontend
    }

    // Add case-specific data if available
    if (caseDetails) {
      placeholderData['{{case_reference}}'] = `#${caseDetails.id.substring(0, 8).toUpperCase()}`
      placeholderData['{{duty_type}}'] = caseDetails.return_to_work_duty_type || 'Full Duties'
      placeholderData['{{return_date}}'] = caseDetails.return_to_work_date 
        ? new Date(caseDetails.return_to_work_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'N/A'
      placeholderData['{{incident_type}}'] = caseDetails.exception_type || 'N/A'
      placeholderData['{{start_date}}'] = caseDetails.start_date 
        ? new Date(caseDetails.start_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'N/A'
    }

    // Generate certificate HTML based on template mode
    let htmlContent = ''
    
    // Helper function to convert image URLs to absolute proxy URLs
    const getProxyImageUrl = (imageUrl: string | null): string | null => {
      if (!imageUrl) return null
      const proxyUrl = getCertificateImageProxyUrl(imageUrl) || imageUrl
      // Convert relative proxy URLs to absolute URLs for display
      if (proxyUrl.startsWith('/api/')) {
        // In production, use the actual backend URL from environment
        // BACKEND_URL should be set to your VPS backend URL (e.g., https://api.giodelapiedra.dev or http://vps.giodelapiedra.dev:3000)
        let backendUrl = process.env.BACKEND_URL || process.env.API_BASE_URL
        
        // If BACKEND_URL is not set, log warning and use localhost fallback
        if (!backendUrl) {
          console.error('[Certificate Generation] ⚠️ BACKEND_URL not set in environment variables!')
          console.error('[Certificate Generation] Please add BACKEND_URL=http://vps.giodelapiedra.dev:3000 to your .env file')
          console.error('[Certificate Generation] Using localhost fallback - this will cause CORS errors in production!')
          backendUrl = 'http://localhost:3000'
        }
        
        // Ensure URL has protocol (http:// or https://)
        // If user provided just domain (e.g., vps.giodelapiedra.dev), add http://
        if (backendUrl && !backendUrl.startsWith('http://') && !backendUrl.startsWith('https://')) {
          // Default to http if no SSL, or check if PORT is specified
          const useHttps = process.env.NODE_ENV === 'production' && process.env.USE_HTTPS === 'true'
          backendUrl = useHttps ? `https://${backendUrl}` : `http://${backendUrl}`
        }
        
        // Remove trailing slash if present
        backendUrl = backendUrl.replace(/\/$/, '')
        
        return `${backendUrl}${proxyUrl}`
      }
      return proxyUrl
    }
    
    if (template.use_background_mode && template.background_image_url) {
      // Background image mode - render with positioned text
      // Get canvas dimensions from template styles or use default
      // Canvas dimensions should match the actual image size used in the editor
      const canvasDimensions = (template.styles as any)?.canvasDimensions || { width: 2000, height: 1414 }
      const CANVAS_WIDTH = canvasDimensions.width || 2000
      const CANVAS_HEIGHT = canvasDimensions.height || 1414
      const bgImageUrl = getProxyImageUrl(template.background_image_url)
      htmlContent = `
        <div style="position: relative; width: ${CANVAS_WIDTH}px; height: ${CANVAS_HEIGHT}px; margin: 0 auto; font-family: Arial, sans-serif; display: block; overflow: hidden; box-sizing: border-box;">
          <img src="${bgImageUrl}" style="width: ${CANVAS_WIDTH}px; height: ${CANVAS_HEIGHT}px; object-fit: fill; display: block; position: absolute; top: 0; left: 0; z-index: 1; margin: 0; padding: 0; border: none;" alt="Certificate Background" id="cert-bg-image" />
          <div style="position: absolute; top: 0; left: 0; width: ${CANVAS_WIDTH}px; height: ${CANVAS_HEIGHT}px; pointer-events: none; box-sizing: border-box; z-index: 2; margin: 0; padding: 0;">
      `
      
      // Add positioned text fields - use pixel positions (canvas is fixed at 2000x1414px)
      const textPositions = template.text_positions || []
      textPositions.forEach((pos: any) => {
        const value = placeholderData[`{{${pos.field}}}`] || `{{${pos.field}}}`
        htmlContent += `
          <div style="
            position: absolute;
            left: ${pos.x}px;
            top: ${pos.y}px;
            font-size: ${pos.fontSize}px;
            color: ${pos.color};
            font-family: ${pos.fontFamily};
            font-weight: ${pos.fontWeight || 'normal'};
            text-align: ${pos.textAlign || 'left'};
            white-space: nowrap;
            pointer-events: auto;
            z-index: 10;
          ">${value}</div>
        `
      })
      
      // Add positioned logo - use pixel positions (canvas is fixed at 800px)
      if (template.logo_url && template.logo_position) {
        const logoPos = template.logo_position as any
        const logoUrl = getProxyImageUrl(template.logo_url)
        htmlContent += `
          <img src="${logoUrl}" style="
            position: absolute;
            left: ${logoPos.x}px;
            top: ${logoPos.y}px;
            width: ${logoPos.width}px;
            height: ${logoPos.height}px;
            pointer-events: auto;
            z-index: 10;
          " alt="Logo" />
        `
      }
      
      // Add positioned signature - use pixel positions (canvas is fixed at 800px)
      if (template.signature_image_url && template.signature_position) {
        const sigPos = template.signature_position as any
        const signatureUrl = getProxyImageUrl(template.signature_image_url)
        htmlContent += `
          <img src="${signatureUrl}" style="
            position: absolute;
            left: ${sigPos.x}px;
            top: ${sigPos.y}px;
            width: ${sigPos.width}px;
            height: ${sigPos.height}px;
            pointer-events: auto;
            z-index: 10;
          " alt="Signature" />
        `
      }
      
      htmlContent += `
          </div>
        </div>
      `
    } else {
      // HTML mode - traditional placeholder replacement
      htmlContent = template.html_content
      
      // Replace text placeholders
      Object.entries(placeholderData).forEach(([placeholder, value]) => {
        htmlContent = htmlContent.replace(new RegExp(placeholder, 'g'), value || '')
      })
      
      // Replace image placeholders with actual images (using proxy URLs)
      const imagePlaceholders: Record<string, string | null> = {
        '{{logo_image}}': getProxyImageUrl(template.logo_url),
        '{{header_image}}': getProxyImageUrl(template.header_image_url),
        '{{footer_image}}': getProxyImageUrl(template.footer_image_url),
        '{{signature_image}}': getProxyImageUrl(template.signature_image_url),
      }
      
      Object.entries(imagePlaceholders).forEach(([placeholder, imageUrl]) => {
        if (imageUrl) {
          const imgTag = `<img src="${imageUrl}" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" alt="${placeholder.replace(/[{}]/g, '')}" />`
          htmlContent = htmlContent.replace(new RegExp(placeholder, 'g'), imgTag)
        } else {
          // Remove placeholder if no image
          htmlContent = htmlContent.replace(new RegExp(placeholder, 'g'), '')
        }
      })
    }

    // Create generated certificate record
    const { data: certificate, error: createError } = await adminClient
      .from('generated_certificates')
      .insert({
        template_id: template.id,
        template_name: template.name,
        case_id: case_id || null,
        worker_id: worker.id,
        worker_name: workerName,
        html_content: htmlContent,
        certificate_data: placeholderData,
        generated_by: user.id,
      })
      .select()
      .single()

    if (createError) {
      console.error('[POST /whs/certificates/generate] Error:', createError)
      return c.json({ error: 'Failed to generate certificate', details: createError.message }, 500)
    }

    return c.json({ certificate }, 201)
  } catch (error: any) {
    console.error('[POST /whs/certificates/generate] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get all generated certificates
whs.get('/certificates', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()
    const caseId = c.req.query('case_id') // Optional filter by case
    const workerId = c.req.query('worker_id') // Optional filter by worker

    let query = adminClient
      .from('generated_certificates')
      .select(`
        *,
        worker:users!generated_certificates_worker_id_fkey(
          id,
          email,
          first_name,
          last_name,
          full_name
        ),
        generated_by_user:users!generated_certificates_generated_by_fkey(
          id,
          email,
          first_name,
          last_name,
          full_name
        )
      `)
      .eq('is_voided', false)
      .order('generated_at', { ascending: false })

    if (caseId) {
      query = query.eq('case_id', caseId)
    }

    if (workerId) {
      query = query.eq('worker_id', workerId)
    }

    const { data: certificates, error } = await query

    if (error) {
      console.error('[GET /whs/certificates] Error:', error)
      return c.json({ error: 'Failed to fetch certificates', details: error.message }, 500)
    }

    return c.json({ certificates: certificates || [] })
  } catch (error: any) {
    console.error('[GET /whs/certificates] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get single generated certificate
whs.get('/certificates/:id', authMiddleware, requireRole(['whs_control_center', 'worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const certificateId = c.req.param('id')
    const adminClient = getAdminClient()

    let query = adminClient
      .from('generated_certificates')
      .select(`
        *,
        worker:users!generated_certificates_worker_id_fkey(
          id,
          email,
          first_name,
          last_name,
          full_name
        ),
        generated_by_user:users!generated_certificates_generated_by_fkey(
          id,
          email,
          first_name,
          last_name,
          full_name
        )
      `)
      .eq('id', certificateId)

    // Workers can only view their own certificates
    if (user.role === 'worker') {
      query = query.eq('worker_id', user.id)
    }

    const { data: certificate, error } = await query.single()

    if (error || !certificate) {
      return c.json({ error: 'Certificate not found' }, 404)
    }

    return c.json({ certificate })
  } catch (error: any) {
    console.error('[GET /whs/certificates/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Void a certificate
whs.put('/certificates/:id/void', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const certificateId = c.req.param('id')
    const body = await c.req.json()
    const { reason } = body

    if (!reason) {
      return c.json({ error: 'Void reason is required' }, 400)
    }

    const adminClient = getAdminClient()

    const { data: certificate, error } = await adminClient
      .from('generated_certificates')
      .update({
        is_voided: true,
        voided_by: user.id,
        voided_at: new Date().toISOString(),
        void_reason: reason,
      })
      .eq('id', certificateId)
      .select()
      .single()

    if (error) {
      console.error('[PUT /whs/certificates/:id/void] Error:', error)
      return c.json({ error: 'Failed to void certificate', details: error.message }, 500)
    }

    return c.json({ certificate })
  } catch (error: any) {
    console.error('[PUT /whs/certificates/:id/void] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Upload certificate image to R2
whs.post('/certificates/upload-image', authMiddleware, requireRole(['whs_control_center']), async (c) => {
  console.log('[POST /whs/certificates/upload-image] ===== ENDPOINT HIT =====')
  
  try {
    console.log('[POST /whs/certificates/upload-image] Request received')
    
    const user = c.get('user')
    if (!user) {
      console.error('[POST /whs/certificates/upload-image] No user found')
      return c.json({ error: 'Unauthorized' }, 401)
    }

    console.log('[POST /whs/certificates/upload-image] User:', user.id)

    const body = await c.req.parseBody()
    console.log('[POST /whs/certificates/upload-image] Body keys:', Object.keys(body))
    
    const file = body['file']
    
    if (!file) {
      console.error('[POST /whs/certificates/upload-image] No file in body')
      return c.json({ error: 'No file provided' }, 400)
    }

    // Check if file is a File object
    if (typeof file === 'string') {
      console.error('[POST /whs/certificates/upload-image] File is a string, not a File object')
      return c.json({ error: 'Invalid file format' }, 400)
    }

    if (!('arrayBuffer' in file)) {
      console.error('[POST /whs/certificates/upload-image] File does not have arrayBuffer method')
      return c.json({ error: 'Invalid file format' }, 400)
    }

    const fileObj = file as File
    console.log('[POST /whs/certificates/upload-image] File name:', fileObj.name, 'Type:', fileObj.type, 'Size:', fileObj.size)

    // Validate file type
    if (!fileObj.type.startsWith('image/')) {
      return c.json({ error: 'File must be an image' }, 400)
    }

    // Validate file size (max 5MB)
    if (fileObj.size > 5 * 1024 * 1024) {
      return c.json({ error: 'File size must be less than 5MB' }, 400)
    }

    // Generate unique filename
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(2, 8)
    const ext = fileObj.name.split('.').pop() || 'jpg'
    const imageId = `${timestamp}-${randomStr}.${ext}`
    const filename = `certificates/${user.id}/${imageId}`

    console.log('[POST /whs/certificates/upload-image] Uploading to R2:', filename)

    // Upload to R2
    const { uploadToR2 } = await import('../utils/r2Storage.js')
    const arrayBuffer = await fileObj.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    const r2Url = await uploadToR2(buffer, filename, fileObj.type)
    console.log('[Certificate Image Upload] R2 URL:', r2Url)
    
    // Convert R2 URL to proxy URL to avoid DNS issues
    const proxyUrl = getCertificateImageProxyUrl(r2Url)
    console.log('[Certificate Image Upload] Proxy URL:', proxyUrl)

    return c.json({ url: proxyUrl || r2Url }, 201)
  } catch (error: any) {
    console.error('[POST /whs/certificates/upload-image] ===== ERROR CAUGHT =====')
    console.error('[POST /whs/certificates/upload-image] Error:', error)
    console.error('[POST /whs/certificates/upload-image] Error message:', error?.message)
    console.error('[POST /whs/certificates/upload-image] Stack:', error?.stack)
    
    // Try to return error response
    try {
      return c.json({ error: 'Failed to upload image', details: error?.message || 'Unknown error' }, 500)
    } catch (responseError) {
      console.error('[POST /whs/certificates/upload-image] Failed to send error response:', responseError)
      throw error
    }
  }
})

export default whs

