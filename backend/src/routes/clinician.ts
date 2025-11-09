import { Hono } from 'hono'
import { authMiddleware, requireRole, AuthVariables } from '../middleware/auth'
import { getCaseStatusFromNotes, mapCaseStatusToDisplay, isValidCaseStatus } from '../utils/caseStatus'
import { getAdminClient } from '../utils/adminClient'
import { formatDateString, parseDateString } from '../utils/dateTime'

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
    const todayStr = new Date().toISOString().split('T')[0]
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
      console.error('[GET /clinician/cases] Error:', casesError)
      return c.json({ error: 'Failed to fetch cases', details: casesError.message }, 500)
    }

    // Get rehabilitation plans for cases (to determine rehab status)
    const caseIds = (cases || []).map((c: any) => c.id)
    const { data: rehabPlans } = await adminClient
      .from('rehabilitation_plans')
      .select('exception_id, status')
      .in('exception_id', caseIds)
      .eq('status', 'active')

    const rehabMap = new Map()
    if (rehabPlans) {
      rehabPlans.forEach((plan: any) => {
        rehabMap.set(plan.exception_id, true)
      })
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
        .select('id, email, first_name, last_name, full_name')
        .in('id', allUserIds)

      if (users) {
        users.forEach((userData: any) => {
          userMap.set(userData.id, userData)
        })
      }
    }

    // Format cases (OPTIMIZATION: Pre-calculate date once, use Map for O(1) lookups)
    const todayDate = new Date()
    todayDate.setHours(0, 0, 0, 0) // Normalize to start of day for accurate comparison
    let formattedCases = (cases || []).map((incident: any) => {
      // OPTIMIZATION: Use direct array access instead of Array.isArray check (faster)
      const user = incident.users?.[0] || incident.users
      const team = incident.teams?.[0] || incident.teams
      const supervisor = team?.supervisor_id ? userMap.get(team.supervisor_id) : null
      const teamLeader = team?.team_leader_id ? userMap.get(team.team_leader_id) : null

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
    const allCaseIds = (allCases || []).map(c => c.id)
    const { data: allRehabPlans } = allCaseIds.length > 0
      ? await adminClient
          .from('rehabilitation_plans')
          .select('exception_id, status')
          .in('exception_id', allCaseIds) // Only get plans for this clinician's cases
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
      }
      
      // Everything else is active (not closed)
      activeCount++
    }

    const summary = {
      total,
      active: activeCount,
      completed: completedCount,
      inRehab: inRehabCount,
      pendingConfirmation: 0,
    }

    return c.json({
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
    }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  } catch (error: any) {
    console.error('[GET /clinician/cases] Error:', error)
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
      .single()

    if (planError || !plan) {
      return c.json({ error: 'Plan not found' }, 404)
    }

    // SECURITY: Ensure clinician can only view their own plans
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

    if (status === 'active') {
      query = query.eq('status', 'active')
    } else if (status === 'completed') {
      query = query.eq('status', 'completed')
    } else if (status === 'cancelled') {
      query = query.eq('status', 'cancelled')
    }

    const { data: plans, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('[GET /clinician/rehabilitation-plans] Error:', error)
      return c.json({ error: 'Failed to fetch rehabilitation plans', details: error.message }, 500)
    }

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
    const formattedPlans = (plans || []).map((plan: any) => {
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
    const { status } = await c.req.json()

    if (!caseId) {
      return c.json({ error: 'Case ID is required' }, 400)
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
      .select('id, clinician_id, is_active, start_date, end_date, notes')
      .eq('id', caseId)
      .eq('clinician_id', user.id)
      .single()

    if (caseError || !caseItem) {
      return c.json({ error: 'Case not found or not assigned to you' }, 404)
    }

    // OPTIMIZATION: Use user from auth context (already available, no need for extra query)
    // Only fetch from DB if we need additional user fields not in auth context
    const clinicianName = formatUserName(user)

    // Prepare updates based on status
    const now = new Date()
    const updates: any = {
      updated_at: now.toISOString(),
    }

    // OPTIMIZATION: Parse notes once and reuse
    let notesData: any = {}
    if (caseItem.notes) {
      try {
        notesData = JSON.parse(caseItem.notes)
      } catch {
        // If notes is not JSON, preserve it as text
        notesData = { original_notes: caseItem.notes }
      }
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
    const todayDateStr = now.toISOString().split('T')[0]

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

    // OPTIMIZATION: Create notification for WHS when case is closed/returned to work
    if (status === 'closed' || status === 'return_to_work') {
      try {
        // OPTIMIZATION: Reuse case data from update query instead of fetching again
          // Get case details with worker and team info for notification
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
                supervisor_id
              )
            `)
            .eq('id', caseId)
            .single()

        if (caseDetails) {
          // OPTIMIZATION: Use existing helper function for case number generation
          const caseNumber = generateCaseNumber(caseDetails.id, caseDetails.created_at)

          // OPTIMIZATION: Use existing helper function for name formatting
          const worker = Array.isArray(caseDetails.users) ? caseDetails.users[0] : caseDetails.users
          const workerName = formatUserName(worker)

          // Get team info
          const team = Array.isArray(caseDetails.teams) ? caseDetails.teams[0] : caseDetails.teams

          // Get all WHS users (batch fetch once)
          const { data: whsUsers } = await adminClient
            .from('users')
            .select('id, email, first_name, last_name, full_name')
            .eq('role', 'whs_control_center')

          if (whsUsers && whsUsers.length > 0) {
            const statusLabel = status === 'closed' ? 'CLOSED' : 'RETURN TO WORK'
            const statusAction = status === 'closed' ? 'closed' : 'marked as return to work'
            
            // Create notifications for all WHS users (batch insert)
            const notifications = whsUsers.map((whsUser: any) => ({
              user_id: whsUser.id,
              type: 'case_closed',
              title: `✅ Case ${statusLabel}`,
              message: `Case ${caseNumber} has been ${statusAction} and approved by ${clinicianName}. Worker: ${workerName}.`,
              data: {
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
              },
              is_read: false,
            }))

            // Insert notifications in batch (optimized)
            const { error: notifyError } = await adminClient
              .from('notifications')
              .insert(notifications)

            if (notifyError) {
              console.error('[PATCH /clinician/cases/:id/status] Error creating notifications:', notifyError)
              // Don't fail the request if notifications fail - case is still updated
            } else {
              console.log(`[PATCH /clinician/cases/:id/status] Created ${notifications.length} notification(s) for case ${caseNumber} (${statusLabel})`)
            }
          }

          // Also notify the supervisor who originally reported the incident
          if (team?.supervisor_id) {
            const { data: supervisor } = await adminClient
              .from('users')
              .select('id, email, first_name, last_name, full_name')
              .eq('id', team.supervisor_id)
              .eq('role', 'supervisor')
              .single()

            if (supervisor) {
              const statusLabel = status === 'closed' ? 'CLOSED' : 'RETURN TO WORK'
              const statusAction = status === 'closed' ? 'closed' : 'marked as return to work'
              
              const supervisorNotification = {
                user_id: supervisor.id,
                type: 'case_closed',
                title: `✅ Case ${statusLabel}`,
                message: `Case ${caseNumber} has been ${statusAction} and approved by ${clinicianName}. Worker: ${workerName}.`,
                data: {
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
                },
                is_read: false,
              }

              const { error: supervisorNotifyError } = await adminClient
                .from('notifications')
                .insert([supervisorNotification])

              if (supervisorNotifyError) {
                console.error('[PATCH /clinician/cases/:id/status] Error creating supervisor notification:', supervisorNotifyError)
              } else {
                console.log(`[PATCH /clinician/cases/:id/status] Created notification for supervisor ${supervisor.id} for case ${caseNumber} (${statusLabel})`)
              }
            }
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

    // Calculate statistics
    const todayAppointments = formattedAppointments.filter((apt: any) => apt.appointmentDate === todayStr).length
    const weekFromNow = new Date(today)
    weekFromNow.setDate(weekFromNow.getDate() + 7)
    const weekStr = formatDateString(weekFromNow)
    const weekAppointments = formattedAppointments.filter((apt: any) => 
      apt.appointmentDate >= todayStr && apt.appointmentDate <= weekStr
    ).length
    
    const monthFromNow = new Date(today)
    monthFromNow.setMonth(monthFromNow.getMonth() + 1)
    const monthStr = formatDateString(monthFromNow)
    const completedThisMonth = formattedAppointments.filter((apt: any) => 
      apt.status === 'completed' && apt.appointmentDate >= todayStr.substring(0, 7)
    ).length
    
    const cancelledThisMonth = formattedAppointments.filter((apt: any) => 
      apt.status === 'cancelled' && apt.appointmentDate >= todayStr.substring(0, 7)
    ).length

    // Status counts
    const confirmedCount = formattedAppointments.filter((apt: any) => apt.status === 'confirmed').length
    const pendingCount = formattedAppointments.filter((apt: any) => apt.status === 'pending').length
    const declinedCount = formattedAppointments.filter((apt: any) => apt.status === 'declined').length

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

    // Validate time format (HH:MM)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
    if (!timeRegex.test(appointment_time)) {
      return c.json({ error: 'Invalid appointment_time format. Expected HH:MM' }, 400)
    }

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
    const [hour, minute] = appointment_time.split(':').map(Number)
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
        appointment_time,
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
    
    // Validate appointment ID format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(appointmentId)) {
      return c.json({ error: 'Invalid appointment ID format' }, 400)
    }

    const updates: any = await c.req.json()
    
    // Validate that updates object exists and is not empty
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return c.json({ error: 'No updates provided' }, 400)
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

    // Build update object
    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (updates.appointment_date) {
      const dateValidation = validateDateInput(updates.appointment_date)
      if (!dateValidation.valid || !dateValidation.date) {
        return c.json({ error: dateValidation.error || 'Invalid appointment_date' }, 400)
      }
      updateData.appointment_date = formatDateString(dateValidation.date)
    }

    if (updates.appointment_time) {
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
      if (!timeRegex.test(updates.appointment_time)) {
        return c.json({ error: 'Invalid appointment_time format. Expected HH:MM' }, 400)
      }
      updateData.appointment_time = updates.appointment_time
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

export default clinician

