import { Hono } from 'hono'
import bcrypt from 'bcrypt'
import { supabase } from '../lib/supabase.js'
import { authMiddleware, requireRole, AuthVariables } from '../middleware/auth.js'
import { getCaseStatusFromNotes } from '../utils/caseStatus.js'
import { parseIncidentNotes, extractReturnToWorkData } from '../utils/notesParser.js'
import { getAdminClient } from '../utils/adminClient.js'
import { isValidEmail } from '../middleware/security.js'
// Import optimized utility functions
import { getTodayDateString, getTodayDate, getStartOfWeekDateString, getFirstDayOfMonthString, dateToDateString } from '../utils/dateUtils.js'
import { validateTeamId, validatePassword, validateStringInput, validateEmail } from '../utils/validationUtils.js'
import { isExceptionActive, getWorkersWithActiveExceptions } from '../utils/exceptionUtils.js'
import { formatTeamLeader, formatUserFullName, getUserInitials } from '../utils/userUtils.js'

const supervisor = new Hono<{ Variables: AuthVariables }>()

// Get supervisor dashboard data
supervisor.get('/dashboard', authMiddleware, requireRole(['supervisor']), async (c) => {
  // Set no-cache headers to ensure fresh data
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  c.header('Pragma', 'no-cache')
  c.header('Expires', '0')
  
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const today = getTodayDateString()
    const startOfWeekStr = getStartOfWeekDateString()

    // Get teams assigned to this supervisor
    const adminClient = getAdminClient()
    const { data: assignedTeams, error: teamsError } = await adminClient
      .from('teams')
      .select('id, name, site_location, team_leader_id')
      .eq('supervisor_id', user.id)

    if (teamsError) {
      console.error('Error fetching assigned teams:', teamsError)
      return c.json({ error: 'Failed to fetch assigned teams', details: teamsError.message }, 500)
    }

    // If supervisor has no teams assigned, return empty dashboard
    if (!assignedTeams || assignedTeams.length === 0) {
      return c.json({
        assignedTeams: [],
        teamInfo: null,
        metrics: {
          warmUpCompletion: 0,
          warmUpComplete: 0,
          warmUpTotal: 0,
          checkInCompletion: 0,
          checkInComplete: 0,
          checkInTotal: 0,
          statusSummary: { green: 0, amber: 0, pending: 0 },
          incidentsToday: 0,
          nearMissesWeek: 0,
        },
        teamMembers: [],
        attentionRequired: null,
      })
    }

    const teamIds = assignedTeams.map(t => t.id)

    // Get all workers from teams assigned to this supervisor
    const { data: teamMembers, error: membersError } = await adminClient
      .from('team_members')
      .select('user_id, team_id')
      .in('team_id', teamIds)

    if (membersError) {
      console.error('Error fetching team members:', membersError)
      return c.json({ error: 'Failed to fetch team members', details: membersError.message }, 500)
    }

    const workerIds = teamMembers?.map(tm => tm.user_id) || []

    // Filter: Only include workers who have assigned schedules for TODAY
    // Supervisor dashboard should only show workers with schedules assigned by Team Leaders
    const { data: schedulesToday } = await adminClient
      .from('worker_schedules')
      .select('worker_id')
      .in('team_id', teamIds)
      .eq('scheduled_date', today)
      .eq('is_active', true)
    
    const workersWithSchedulesToday = Array.from(new Set((schedulesToday || []).map((s: any) => s.worker_id)))
    
    // Filter to only workers with assigned schedules for today
    const activeWorkerIdsForDashboard = workerIds.filter((id: string) => workersWithSchedulesToday.includes(id))

    if (activeWorkerIdsForDashboard.length === 0) {
      // Build team info for display
      const teamInfo = assignedTeams.length === 1
        ? {
            name: assignedTeams[0].name,
            siteLocation: assignedTeams[0].site_location,
            displayName: assignedTeams[0].site_location 
              ? `${assignedTeams[0].name} • ${assignedTeams[0].site_location}`
              : assignedTeams[0].name,
          }
        : null

      return c.json({
        assignedTeams: assignedTeams.map(t => ({
          id: t.id,
          name: t.name,
          siteLocation: t.site_location,
        })),
        teamInfo,
        metrics: {
          warmUpCompletion: 0,
          warmUpComplete: 0,
          warmUpTotal: 0,
          checkInCompletion: 0,
          checkInComplete: 0,
          checkInTotal: 0,
          statusSummary: { green: 0, amber: 0, pending: 0 },
          incidentsToday: 0,
          nearMissesWeek: 0,
        },
        teamMembers: [],
        attentionRequired: null,
      })
    }

    // Get worker user details (only workers with assigned schedules for today)
    const { data: allWorkers, error: workersError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .eq('role', 'worker')
      .in('id', activeWorkerIdsForDashboard)

    if (workersError) {
      console.error('Error fetching workers:', workersError)
      return c.json({ error: 'Failed to fetch workers', details: workersError.message }, 500)
    }

    // OPTIMIZATION: Execute parallel queries for incidents (independent data)
    const [
      { data: incidentsToday, error: incidentsError },
      { data: nearMissesWeek, error: nearMissesError },
    ] = await Promise.all([
      adminClient
        .from('incidents')
        .select('id')
        .eq('incident_date', today)
        .in('user_id', activeWorkerIdsForDashboard)
        .eq('incident_type', 'incident'),
      adminClient
        .from('incidents')
        .select('id')
        .gte('incident_date', startOfWeekStr)
        .in('user_id', activeWorkerIdsForDashboard)
        .eq('incident_type', 'near_miss'),
    ])

    // OPTIMIZATION: Execute all parallel queries at once
    const todayDate = new Date(today)
    
    // Parallel fetch of all required data
    const [
      { data: activeExceptions, error: exceptionsError },
      { data: warmUpsAll, error: warmUpsAllError },
      { data: checkInsAll, error: checkInsAllError },
    ] = await Promise.all([
      adminClient
        .from('worker_exceptions')
        .select('user_id, exception_type, reason, start_date, end_date')
        .eq('is_active', true)
        .in('user_id', activeWorkerIdsForDashboard),
      adminClient
        .from('warm_ups')
        .select('user_id, completed')
        .eq('warm_up_date', today)
        .in('user_id', activeWorkerIdsForDashboard),
      adminClient
        .from('daily_checkins')
        .select('user_id, predicted_readiness, pain_level, fatigue_level, stress_level, additional_notes')
        .eq('check_in_date', today)
        .in('user_id', activeWorkerIdsForDashboard),
    ])

    // Filter out workers with active exceptions that apply to today
    const workersWithExceptions = getWorkersWithActiveExceptions(activeExceptions || [], todayDate)

    // Filter worker IDs to exclude those with active exceptions (from already filtered list with schedules)
    const activeWorkerIds = activeWorkerIdsForDashboard.filter(id => !workersWithExceptions.has(id))

    // OPTIMIZATION: Use already fetched warmUpsAll and checkInsAll instead of separate queries
    // Calculate metrics - EXCLUDE workers with active exceptions from totals
    const warmUpsCompleted = (warmUpsAll || []).filter(w => w.completed && !workersWithExceptions.has(w.user_id))
    const warmUpComplete = warmUpsCompleted.length
    const warmUpTotal = activeWorkerIds.length // Only count workers without exceptions
    const warmUpCompletion = warmUpTotal > 0 ? Math.round((warmUpComplete / warmUpTotal) * 100) : 0

    // Status summary from check-ins - exclude workers with exceptions
    const checkInsWithoutExceptions = (checkInsAll || []).filter(c => !workersWithExceptions.has(c.user_id))
    const checkInComplete = checkInsWithoutExceptions.length
    const checkInTotal = activeWorkerIds.length // Only count workers without exceptions
    const checkInCompletion = checkInTotal > 0 ? Math.round((checkInComplete / checkInTotal) * 100) : 0

    const statusSummary = {
      green: checkInsWithoutExceptions.filter(c => c.predicted_readiness === 'Green').length,
      amber: checkInsWithoutExceptions.filter(c => c.predicted_readiness === 'Yellow').length,
      pending: checkInTotal - checkInComplete,
    }

    // OPTIMIZATION: Create maps in single pass
    const warmUpsMap = new Map<string, boolean>()
    warmUpsAll?.forEach(w => {
      if (w.completed) {
        warmUpsMap.set(w.user_id, true)
      }
    })

    const checkInsMap = new Map(checkInsAll?.map(c => [c.user_id, c]) || [])
    
    // Create a map of user_id to exception info - single pass
    const exceptionsMap = new Map<string, any>()
    if (activeExceptions) {
      activeExceptions.forEach((exception) => {
        if (isExceptionActive(exception, todayDate)) {
          exceptionsMap.set(exception.user_id, {
            exception_type: exception.exception_type,
            reason: exception.reason,
            start_date: exception.start_date,
            end_date: exception.end_date,
          })
        }
      })
    }
    
    // Create a map of user_id to team_id for workers
    const workerTeamMap = new Map(teamMembers?.map(tm => [tm.user_id, tm.team_id]) || [])

    // Build team info for display (if single team, show detailed info)
    const teamInfo = assignedTeams.length === 1
      ? {
          name: assignedTeams[0].name,
          siteLocation: assignedTeams[0].site_location,
          displayName: assignedTeams[0].site_location 
            ? `${assignedTeams[0].name} • ${assignedTeams[0].site_location}`
            : assignedTeams[0].name,
        }
      : null

    const teamMembersList = (allWorkers || []).map(worker => {
      const warmUpComplete = warmUpsMap.get(worker.id) || false
      const checkIn = checkInsMap.get(worker.id)
      const checkInComplete = !!checkIn
      const exception = exceptionsMap.get(worker.id)
      const hasActiveException = !!exception
      
      let status: 'green' | 'amber' | 'pending' | 'exception' = 'pending'
      if (hasActiveException) {
        status = 'exception'
      } else if (checkInComplete) {
        status = checkIn.predicted_readiness === 'Green' ? 'green' : 
                 checkIn.predicted_readiness === 'Yellow' ? 'amber' : 'pending'
      }

      // Get worker's team name
      const workerTeamId = workerTeamMap.get(worker.id)
      const workerTeam = assignedTeams.find(t => t.id === workerTeamId)

      return {
        id: worker.id,
        name: worker.full_name || 
              (worker.first_name && worker.last_name ? `${worker.first_name} ${worker.last_name}` : null) ||
              worker.email.split('@')[0],
        initials: (worker.full_name || 
                  (worker.first_name && worker.last_name ? `${worker.first_name} ${worker.last_name}` : null) ||
                  worker.email.split('@')[0])
          .split(' ')
          .map((n: string) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2),
        email: worker.email,
        teamName: workerTeam?.name || null,
        warmUpComplete,
        checkInComplete,
        status,
        hasReminder: !checkInComplete && !hasActiveException, // Don't remind if they have exception
        checkInData: checkIn,
        exception: exception || null, // Include exception info
        hasActiveException,
      }
    })

    // Find attention required (amber/red status with concerning symptoms)
    // EXCLUDE workers with active exceptions from attention required
    let attentionRequired = null
    const amberMember = checkInsAll?.find(c => 
      !workersWithExceptions.has(c.user_id) && // Exclude workers with exceptions
      c.predicted_readiness === 'Yellow' && 
      (c.pain_level >= 5 || c.stress_level >= 7 || c.fatigue_level >= 7)
    )

    if (amberMember) {
      const member = teamMembersList.find(m => m.id === amberMember.user_id)
      if (member && !member.hasActiveException) {
        attentionRequired = {
          memberName: member.name,
          status: 'Amber Status',
          description: amberMember.pain_level >= 5
            ? `Reported moderate pain (${amberMember.pain_level}/10)${amberMember.additional_notes ? '. ' + amberMember.additional_notes : ''}. Please check in and adjust tasks if needed.`
            : amberMember.stress_level >= 7
            ? `Reported high stress level (${amberMember.stress_level}/10). Please check in and adjust tasks if needed.`
            : `Reported high fatigue level (${amberMember.fatigue_level}/10). Please check in and adjust tasks if needed.`,
        }
      }
    }

    return c.json({
      assignedTeams: assignedTeams.map(t => ({
        id: t.id,
        name: t.name,
        siteLocation: t.site_location,
      })),
      teamInfo,
      metrics: {
        warmUpCompletion,
        warmUpComplete,
        warmUpTotal,
        checkInCompletion,
        checkInComplete,
        checkInTotal,
        statusSummary,
        incidentsToday: incidentsToday?.length ?? 0,
        nearMissesWeek: nearMissesWeek?.length ?? 0,
      },
      teamMembers: teamMembersList,
      attentionRequired,
    })
  } catch (error: any) {
    console.error('Supervisor dashboard error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Create team leader (supervisor can create team leaders under them)
supervisor.post('/team-leaders', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { email, password, first_name, last_name, team_name, site_location } = await c.req.json()

    // SECURITY: Comprehensive input validation
    if (!isValidEmail(email)) {
      return c.json({ error: 'Invalid email format' }, 400)
    }

    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      return c.json({ error: passwordValidation.error }, 400)
    }

    const firstNameValidation = validateStringInput(first_name, 100, 'First name')
    if (!firstNameValidation.valid) {
      return c.json({ error: firstNameValidation.error }, 400)
    }

    const lastNameValidation = validateStringInput(last_name, 100, 'Last name')
    if (!lastNameValidation.valid) {
      return c.json({ error: lastNameValidation.error }, 400)
    }

    const teamNameValidation = validateStringInput(team_name, 200, 'Team name')
    if (!teamNameValidation.valid) {
      return c.json({ error: teamNameValidation.error }, 400)
    }

    // Optional field validation
    const trimmedSiteLocation = site_location && typeof site_location === 'string' 
      ? site_location.trim().slice(0, 200) 
      : null

    const adminClient = getAdminClient()

    // Get supervisor's business_name and business_registration_number to inherit to team leader
    const { data: supervisorData, error: supervisorError } = await adminClient
      .from('users')
      .select('business_name, business_registration_number')
      .eq('id', user.id)
      .single()

    if (supervisorError) {
      console.error('Error fetching supervisor data:', supervisorError)
      return c.json({ error: 'Failed to fetch supervisor data', details: supervisorError.message }, 500)
    }

    // Log supervisor data for debugging
    console.log('Supervisor data for inheritance:', {
      supervisor_id: user.id,
      business_name: supervisorData?.business_name,
      business_registration_number: supervisorData?.business_registration_number,
    })

    // Validate supervisor has business information (optional check - can be null for team leaders)
    // Note: Team leaders inherit business info even if supervisor doesn't have it (will be null)

    // Check if email already exists
    const { data: existingUser } = await adminClient
      .from('users')
      .select('email')
      .eq('email', email)
      .single()

    if (existingUser) {
      return c.json({ error: 'User with this email already exists' }, 409)
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError || !authData.user) {
      if (authError?.message?.includes('already registered') || 
          authError?.message?.includes('User already registered') ||
          authError?.message?.includes('already exists')) {
        return c.json({ error: 'User with this email already exists' }, 409)
      }
      console.error('Supabase Auth error:', authError)
      return c.json({ 
        error: 'Failed to create user', 
        details: authError?.message,
        code: authError?.status 
      }, 500)
    }

    // Hash password with bcrypt
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(password, saltRounds)

    // Prepare user data with validated inputs
    const trimmedFirstName = firstNameValidation.value!
    const trimmedLastName = lastNameValidation.value!
    const fullName = `${trimmedFirstName} ${trimmedLastName}`.trim()

    // Prepare business data - handle empty strings and null values
    const inheritedBusinessName = supervisorData?.business_name 
      ? (typeof supervisorData.business_name === 'string' ? supervisorData.business_name.trim() : supervisorData.business_name)
      : null
    const inheritedBusinessRegNumber = supervisorData?.business_registration_number
      ? (typeof supervisorData.business_registration_number === 'string' ? supervisorData.business_registration_number.trim() : supervisorData.business_registration_number)
      : null

    const userInsertData: any = {
      id: authData.user.id,
      email: email.trim().toLowerCase(), // Normalize email
      role: 'team_leader',
      password_hash: hashedPassword,
      first_name: trimmedFirstName,
      last_name: trimmedLastName,
      full_name: fullName,
      business_name: inheritedBusinessName || null, // Inherit from supervisor
      business_registration_number: inheritedBusinessRegNumber || null, // Inherit from supervisor
      created_at: new Date().toISOString(),
    }

    // Log data being inserted for debugging
    console.log('Creating team leader with data:', {
      email: userInsertData.email,
      business_name: userInsertData.business_name,
      business_registration_number: userInsertData.business_registration_number,
    })

    // Create user record in database
    const { data: userData, error: userError } = await adminClient
      .from('users')
      .insert([userInsertData])
      .select('id, email, role, first_name, last_name, full_name, business_name, business_registration_number')
      .single()

    if (userError) {
      console.error('Database insert error:', userError)
      console.error('Failed to insert user data:', JSON.stringify(userInsertData, null, 2))
      // Clean up auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      return c.json({ 
        error: 'Failed to create user record', 
        details: userError.message,
        code: userError.code,
        hint: userError.hint 
      }, 500)
    }

    // Log successful creation
    console.log('Team leader created successfully:', {
      id: userData.id,
      email: userData.email,
      business_name: userData.business_name,
      business_registration_number: userData.business_registration_number,
    })

    // Create team for the team leader, assigned to this supervisor
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .insert([
        {
          team_leader_id: userData.id,
          supervisor_id: user.id, // Assign to this supervisor
          name: teamNameValidation.value!,
          site_location: trimmedSiteLocation,
        },
      ])
      .select()
      .single()

    if (teamError) {
      console.error('Team creation error:', teamError)
      // Clean up
      await adminClient.from('users').delete().eq('id', userData.id)
      await supabase.auth.admin.deleteUser(authData.user.id)
      return c.json({ 
        error: 'Failed to create team', 
        details: teamError.message,
        code: teamError.code 
      }, 500)
    }

    return c.json({
      message: 'Team leader created successfully',
      teamLeader: {
        id: userData.id,
        email: userData.email,
        first_name: userData.first_name,
        last_name: userData.last_name,
        full_name: userData.full_name,
        role: userData.role,
      },
      team: {
        id: team.id,
        name: team.name,
        site_location: team.site_location,
      },
    }, 201)
  } catch (error: any) {
    console.error('Create team leader error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get all teams created by this supervisor
supervisor.get('/teams', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()
    
    // Get all teams assigned to this supervisor
    const { data: teams, error: teamsError } = await adminClient
      .from('teams')
      .select('id, name, site_location, team_leader_id, created_at')
      .eq('supervisor_id', user.id)
      .order('created_at', { ascending: false })

    if (teamsError) {
      console.error('Error fetching teams:', teamsError)
      return c.json({ error: 'Failed to fetch teams', details: teamsError.message }, 500)
    }

    // OPTIMIZATION: Batch fetch all data in parallel to avoid N+1 queries
    const teamIds = (teams || []).map(t => t.id)
    const teamLeaderIds = (teams || []).map(t => t.team_leader_id).filter(Boolean)
    
    const today = getTodayDateString()
    const todayDate = getTodayDate()
    
    // Parallel fetch of all team-related data
    const [
      { data: allTeamLeaders },
      { data: allTeamMembers },
      { data: allExceptions },
      { data: allCheckIns },
      { data: allCases },
    ] = await Promise.all([
      teamLeaderIds.length > 0
        ? adminClient
            .from('users')
            .select('id, email, first_name, last_name, full_name')
            .in('id', teamLeaderIds)
        : Promise.resolve({ data: [] }),
      teamIds.length > 0
        ? adminClient
            .from('team_members')
            .select('user_id, team_id')
            .in('team_id', teamIds)
        : Promise.resolve({ data: [] }),
      teamIds.length > 0
        ? adminClient
            .from('worker_exceptions')
            .select('user_id, start_date, end_date, team_id')
            .eq('is_active', true)
            .in('team_id', teamIds)
        : Promise.resolve({ data: [] }),
      teamIds.length > 0
        ? adminClient
            .from('daily_checkins')
            .select('user_id, predicted_readiness')
            .eq('check_in_date', today)
        : Promise.resolve({ data: [] }),
      teamIds.length > 0
        ? adminClient
            .from('worker_exceptions')
            .select('id, team_id, user_id, start_date, end_date, is_active, deactivated_at')
            .in('team_id', teamIds)
        : Promise.resolve({ data: [] }),
    ])

    // OPTIMIZATION: Create lookup maps for O(1) access
    const teamLeaderMap = new Map((allTeamLeaders || []).map(tl => [tl.id, tl]))
    const membersByTeam = new Map<string, any[]>()
    const exceptionsByTeam = new Map<string, any[]>()
    
    ;(allTeamMembers || []).forEach(member => {
      if (!membersByTeam.has(member.team_id)) {
        membersByTeam.set(member.team_id, [])
      }
      membersByTeam.get(member.team_id)!.push(member)
    })
    
    ;(allExceptions || []).forEach(exception => {
      const teamId = exception.team_id
      if (!exceptionsByTeam.has(teamId)) {
        exceptionsByTeam.set(teamId, [])
      }
      exceptionsByTeam.get(teamId)!.push(exception)
    })

    // Calculate total cases for all team leaders (count all worker_exceptions for supervisor's teams)
    // allCases includes all exceptions (both active and inactive) for all teams
    const totalCases = (allCases || []).length

    // Build team details
    const teamsWithDetails = (teams || []).map(team => {
      const teamLeader = teamLeaderMap.get(team.team_leader_id)
      const members = membersByTeam.get(team.id) || []
      const memberIds = members.map(m => m.user_id)
      const memberCount = members.length
      
      // Get active exceptions for this team
      const teamExceptions = exceptionsByTeam.get(team.id) || []
      const workersWithExceptions = getWorkersWithActiveExceptions(teamExceptions, todayDate)
      const activeMemberCount = memberIds.filter(id => !workersWithExceptions.has(id)).length
      
      // Get check-ins for this team's members
      const teamCheckIns = (allCheckIns || []).filter(ci => memberIds.includes(ci.user_id))
      const checkInsWithoutExceptions = teamCheckIns.filter(c => !workersWithExceptions.has(c.user_id))
      const checkInCount = checkInsWithoutExceptions.length
      
      const checkInStats = {
        green: checkInsWithoutExceptions.filter(c => c.predicted_readiness === 'Green').length,
        amber: checkInsWithoutExceptions.filter(c => c.predicted_readiness === 'Yellow').length,
        pending: activeMemberCount - checkInCount,
      }

      return {
          id: team.id,
          name: team.name,
          siteLocation: team.site_location,
          teamLeader: teamLeader ? formatTeamLeader(teamLeader) : null,
          memberCount, // Total members including those with exceptions
          activeMemberCount, // Members without active exceptions (should be used for compliance calculation)
          exceptionCount: workersWithExceptions.size, // Number of workers with active exceptions
          checkInStats,
          createdAt: team.created_at,
        }
    })

    return c.json({
      teams: teamsWithDetails,
      totalCases, // Total cases across all team leaders
    })
  } catch (error: any) {
    console.error('Get supervisor teams error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Delete team (supervisor only - requires password verification)
supervisor.delete('/teams/:teamId', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const teamId = c.req.param('teamId')
    const { password } = await c.req.json()

    // SECURITY: Validate inputs
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      return c.json({ error: passwordValidation.error || 'Password is required to delete team' }, 400)
    }

    const teamIdValidation = validateTeamId(teamId)
    if (!teamIdValidation.valid) {
      return c.json({ error: teamIdValidation.error }, 400)
    }

    const adminClient = getAdminClient()

    // Verify team exists and belongs to this supervisor
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('id, name, supervisor_id, team_leader_id')
      .eq('id', teamId)
      .eq('supervisor_id', user.id)
      .single()

    if (teamError || !team) {
      return c.json({ error: 'Team not found or unauthorized' }, 404)
    }

    // SECURITY: Verify supervisor's password before deletion
    // Get supervisor's email and password hash from users table
    const { data: supervisorUser, error: userError } = await adminClient
      .from('users')
      .select('email, password_hash')
      .eq('id', user.id)
      .single()

    if (userError || !supervisorUser) {
      console.error('Error fetching supervisor user:', userError)
      return c.json({ error: 'Failed to verify identity' }, 500)
    }

    // Verify password using bcrypt (if password_hash exists) or Supabase Auth
    let passwordValid = false

    if (supervisorUser.password_hash) {
      // Verify using stored password hash
      passwordValid = await bcrypt.compare(password, supervisorUser.password_hash)
    } else {
      // If no password_hash, verify using Supabase Auth (but don't create a new session)
      try {
        // Use signInWithPassword but we'll ignore the session - just check for errors
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: supervisorUser.email,
          password: password,
        })
        passwordValid = !signInError
        // Sign out immediately to prevent session creation
        if (passwordValid) {
          await supabase.auth.signOut()
        }
      } catch (authError: any) {
        console.error('Password verification error:', authError)
        passwordValid = false
      }
    }

    if (!passwordValid) {
      console.error('Password verification failed for supervisor:', user.email)
      return c.json({ error: 'Invalid password. Please enter your correct password to delete this team.' }, 401)
    }

    // Password verified - proceed with deletion
    // Delete in proper order to respect foreign key constraints:
    // 1. Delete team members first
    // 2. Delete worker exceptions
    // 3. Delete schedules (if any)
    // 4. Delete team
    // 5. Optionally delete team leader user (or just leave them as orphaned team_leader)

    const { error: deleteMembersError } = await adminClient
      .from('team_members')
      .delete()
      .eq('team_id', teamId)

    if (deleteMembersError) {
      console.error('Error deleting team members:', deleteMembersError)
      // Continue anyway - might not have members
    }

    // Delete exceptions for this team
    const { error: deleteExceptionsError } = await adminClient
      .from('worker_exceptions')
      .delete()
      .eq('team_id', teamId)

    if (deleteExceptionsError) {
      console.error('Error deleting exceptions:', deleteExceptionsError)
      // Continue anyway
    }

    // Delete schedules for team leader (DISABLED - Team Leaders now assign individual worker schedules)
    // NOTE: work_schedules table is kept in database but not used in logic anymore
    // const { error: deleteSchedulesError } = await adminClient
    //   .from('work_schedules')
    //   .delete()
    //   .eq('user_id', team.team_leader_id)
    // 
    // if (deleteSchedulesError) {
    //   console.error('Error deleting schedules:', deleteSchedulesError)
    //   // Continue anyway
    // }

    // Delete the team
    const { error: deleteTeamError } = await adminClient
      .from('teams')
      .delete()
      .eq('id', teamId)

    if (deleteTeamError) {
      console.error('Error deleting team:', deleteTeamError)
      return c.json({ error: 'Failed to delete team', details: deleteTeamError.message }, 500)
    }

    // Optionally delete team leader user and auth account
    // Note: Commenting this out for now - team leader might be used elsewhere
    // If you want to delete team leader account too, uncomment below:
    /*
    const { error: deleteUserError } = await adminClient
      .from('users')
      .delete()
      .eq('id', team.team_leader_id)

    if (deleteUserError) {
      console.error('Error deleting team leader user:', deleteUserError)
      // Continue anyway - team is deleted
    }

    try {
      await supabase.auth.admin.deleteUser(team.team_leader_id)
    } catch (authDeleteError) {
      console.error('Error deleting team leader auth account:', authDeleteError)
      // Continue anyway - team is deleted
    }
    */

    console.log(`[DeleteTeam] Team ${teamId} deleted successfully by supervisor ${user.email} (${user.id})`)

    return c.json({
      message: 'Team deleted successfully',
      deletedTeamId: teamId,
    })
  } catch (error: any) {
    console.error('Delete team error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get team members for a specific team (supervisor can view any team they supervise)
supervisor.get('/teams/:teamId/members', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const teamId = c.req.param('teamId')
    
    // SECURITY: Validate teamId format (UUID)
    const teamIdValidation = validateTeamId(teamId)
    if (!teamIdValidation.valid) {
      return c.json({ error: teamIdValidation.error }, 400)
    }

    const adminClient = getAdminClient()

    // OPTIMIZATION: Parallel fetch of team and members
    const [
      { data: team, error: teamError },
      { data: teamMembers, error: membersError },
    ] = await Promise.all([
      adminClient
        .from('teams')
        .select('id, name, supervisor_id')
        .eq('id', teamId)
        .eq('supervisor_id', user.id)
        .single(),
      adminClient
        .from('team_members')
        .select('*')
        .eq('team_id', teamId),
    ])

    if (teamError || !team) {
      return c.json({ error: 'Team not found or unauthorized' }, 404)
    }

    if (membersError) {
      console.error('Error fetching team members:', membersError)
      return c.json({ error: 'Failed to fetch team members', details: membersError.message }, 500)
    }

    // OPTIMIZATION: Batch fetch all user data in one query instead of N queries
    const memberUserIds = (teamMembers || []).map((m: any) => m.user_id)
    
    if (memberUserIds.length === 0) {
      return c.json({
        team: {
          id: team.id,
          name: team.name,
        },
        members: [],
      })
    }

    const today = getTodayDateString()
    const todayDate = getTodayDate()

    // OPTIMIZATION: Parallel fetch of users and exceptions
    const [
      { data: allUserData, error: usersError },
      { data: activeExceptions, error: exceptionsError },
    ] = await Promise.all([
      adminClient
        .from('users')
        .select('id, email, first_name, last_name, full_name, role')
        .in('id', memberUserIds),
      adminClient
        .from('worker_exceptions')
        .select('user_id, exception_type, reason, start_date, end_date')
        .eq('is_active', true)
        .eq('team_id', teamId),
    ])

    if (usersError) {
      console.error('Error fetching users:', usersError)
      return c.json({ error: 'Failed to fetch user data', details: usersError.message }, 500)
    }

    if (exceptionsError) {
      console.error('Error fetching exceptions:', exceptionsError)
      // Don't fail if exceptions query fails, just log it
    }

    // OPTIMIZATION: Create map for O(1) lookup instead of O(n) searches
    const userDataMap = new Map((allUserData || []).map(u => [u.id, u]))
    
    // Create map of active exceptions by user_id
    const exceptionsByUser = new Map<string, any>()
    if (activeExceptions) {
      activeExceptions.forEach((exception: any) => {
        if (isExceptionActive(exception, todayDate)) {
          exceptionsByUser.set(exception.user_id, exception)
        }
      })
    }

    // Map members with user data and exception info
    const membersWithUsers = (teamMembers || []).map((member: any) => {
      const userData = userDataMap.get(member.user_id)
      const exception = exceptionsByUser.get(member.user_id)
      
      if (!userData) {
        console.warn(`User ${member.user_id} not found for team member`)
        return {
          ...member,
          users: null,
          hasActiveException: false,
          exception: null,
        }
      }

      return {
        ...member,
        users: userData,
        hasActiveException: !!exception,
        exception: exception ? {
          exception_type: exception.exception_type,
          reason: exception.reason,
          start_date: exception.start_date,
          end_date: exception.end_date,
        } : null,
      }
    })

    // Filter out members without user data
    const validMembers = membersWithUsers.filter((m: any) => m.users !== null)

    return c.json({
      team: {
        id: team.id,
        name: team.name,
      },
      members: validMembers,
    })
  } catch (error: any) {
    console.error('Get team members error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get supervisor analytics (aggregated across all teams)
// IMPORTANT: This endpoint calculates analytics ONLY for teams assigned to the supervisor
// - Supervisor monitors compliance of team leaders and their workers
// - Expected check-ins are based on team leader's schedules (Monday-Friday, etc.)
// - Only counts scheduled working days, not all days in the date range
// Uses caching for improved performance
supervisor.get('/analytics', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Import cache utility
    const { cache, CacheManager } = await import('../utils/cache.js')
    
    // Get date filters from query params
    const startDate = c.req.query('startDate') || getFirstDayOfMonthString()
    const endDate = c.req.query('endDate') || getTodayDateString()

    // Generate cache key
    const cacheKey = CacheManager.generateKey('supervisor-analytics', {
      userId: user.id,
      startDate,
      endDate,
    })

    // Try to get from cache (5 minute TTL)
    const cached = cache.get(cacheKey)
    if (cached) {
      return c.json(cached, 200, {
        'X-Cache': 'HIT',
        'Cache-Control': 'public, max-age=300',
      })
    }

    const adminClient = getAdminClient()

    // Limit date range to prevent excessive data fetching (max 90 days)
    const startDateObj = new Date(startDate)
    const endDateObj = new Date(endDate)
    const daysDiff = Math.ceil((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDiff > 90) {
      return c.json({ error: 'Date range cannot exceed 90 days' }, 400)
    }

    // Get all teams assigned to this supervisor ONLY
    // This ensures supervisor only sees analytics for teams they manage
    const { data: assignedTeams, error: teamsError } = await adminClient
      .from('teams')
      .select('id, name, site_location, team_leader_id')
      .eq('supervisor_id', user.id)

    if (teamsError) {
      console.error('Error fetching assigned teams:', teamsError)
      return c.json({ error: 'Failed to fetch assigned teams', details: teamsError.message }, 500)
    }

    if (!assignedTeams || assignedTeams.length === 0) {
      return c.json({
        summary: {
          totalTeams: 0,
          totalMembers: 0,
          totalActiveMembers: 0,
          overallCompletionRate: 0,
          overallReadiness: { green: 0, amber: 0, red: 0 },
          totalIncidents: 0,
          totalNearMisses: 0,
          totalActiveExceptions: 0,
        },
        teamStats: [],
        teamLeaderPerformance: [],
        dailyTrends: [],
        readinessDistribution: { green: 0, amber: 0, red: 0, pending: 0 },
        topTeamsByCases: [],
        exceptionStats: {
          byType: {
            transfer: 0,
            accident: 0,
            injury: 0,
            medical_leave: 0,
            other: 0,
          },
          byTeam: {},
          total: 0,
        },
      })
    }

    const teamIds = assignedTeams.map(t => t.id)
    const teamLeaderIds = assignedTeams.map(t => t.team_leader_id).filter(Boolean)

    // Get all team members from supervisor's teams ONLY
    // These are the workers that the supervisor monitors for compliance
    const { data: allTeamMembers, error: membersError } = await adminClient
      .from('team_members')
      .select('user_id, team_id')
      .in('team_id', teamIds)

    if (membersError) {
      console.error('Error fetching team members:', membersError)
      return c.json({ error: 'Failed to fetch team members', details: membersError.message }, 500)
    }

    const allWorkerIds = (allTeamMembers || []).map(tm => tm.user_id)

    if (allWorkerIds.length === 0) {
      return c.json({
        summary: {
          totalTeams: assignedTeams.length,
          totalMembers: 0,
          totalActiveMembers: 0,
          overallCompletionRate: 0,
          overallReadiness: { green: 0, amber: 0, red: 0 },
          totalIncidents: 0,
          totalNearMisses: 0,
          totalActiveExceptions: 0,
        },
        teamStats: [],
        teamLeaderPerformance: [],
        dailyTrends: [],
        readinessDistribution: { green: 0, amber: 0, red: 0, pending: 0 },
        topTeamsByCases: [],
        exceptionStats: {
          byType: {
            transfer: 0,
            accident: 0,
            injury: 0,
            medical_leave: 0,
            other: 0,
          },
          byTeam: {},
          total: 0,
        },
      })
    }

    // Get team leader details
    const { data: teamLeaders } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .in('id', teamLeaderIds)

    const teamLeaderMap = new Map((teamLeaders || []).map(tl => [tl.id, tl]))

    // Use utility function isExceptionActive instead of duplicate local function

    // Get all exceptions for workers in supervisor's teams (regardless of is_active status)
    // This ensures historical exceptions that were closed/removed are still counted in analytics
    // This includes exceptions created/updated by team leaders - each exception record is counted
    // if it overlaps with the selected date range and wasn't deactivated before that date
    const { data: allExceptionsRaw } = await adminClient
      .from('worker_exceptions')
      .select('user_id, exception_type, start_date, end_date, team_id, is_active, deactivated_at')
      .in('user_id', allWorkerIds) // Get exceptions for all workers in supervisor's teams
    
    // Filter exceptions to only include those that overlap with the selected date range
    // Normalize dates to ensure accurate comparison
    const rangeStart = new Date(startDate)
    rangeStart.setHours(0, 0, 0, 0)
    const rangeEnd = new Date(endDate)
    rangeEnd.setHours(23, 59, 59, 999) // Include the entire end date
    
    const allExceptions = (allExceptionsRaw || []).filter((exception: any) => {
      const exceptionStart = new Date(exception.start_date)
      exceptionStart.setHours(0, 0, 0, 0)
      const exceptionEnd = exception.end_date ? new Date(exception.end_date) : null
      if (exceptionEnd) {
        exceptionEnd.setHours(23, 59, 59, 999) // Include the entire end date
      }
      
      // Exception overlaps with date range if:
      // - Exception starts before or on range end
      // - Exception ends after or on range start (or has no end date, meaning it's ongoing)
      // This ensures ALL exceptions that occurred during the date range are counted,
      // including those created/updated by team leaders and later removed
      return exceptionStart <= rangeEnd && (!exceptionEnd || exceptionEnd >= rangeStart)
    })

    const exceptionsByWorker = new Map<string, any[]>()
    if (allExceptions) {
      allExceptions.forEach((exception: any) => {
        const workerId = exception.user_id
        if (!exceptionsByWorker.has(workerId)) {
          exceptionsByWorker.set(workerId, [])
        }
        exceptionsByWorker.get(workerId)!.push(exception)
      })
    }

    // Fetch data in parallel for better performance
    // Also fetch schedules to preserve workers with historical check-ins even if schedule was deleted
    const [checkInsResult, warmUpsResult, incidentsResult, schedulesResult, checkInsForSchedulesResult] = await Promise.all([
      adminClient
        .from('daily_checkins')
        .select('user_id, check_in_date, predicted_readiness, pain_level, fatigue_level, stress_level, sleep_quality')
        .in('user_id', allWorkerIds)
        .gte('check_in_date', startDate)
        .lte('check_in_date', endDate)
        .order('check_in_date', { ascending: true }),
      adminClient
        .from('warm_ups')
        .select('user_id, warm_up_date, completed')
        .in('user_id', allWorkerIds)
        .gte('warm_up_date', startDate)
        .lte('warm_up_date', endDate),
      adminClient
        .from('incidents')
        .select('id, user_id, incident_date, incident_type')
        .in('user_id', allWorkerIds)
        .gte('incident_date', startDate)
        .lte('incident_date', endDate),
      adminClient
        .from('worker_schedules')
        .select('worker_id, scheduled_date, day_of_week, effective_date, expiry_date, is_active')
        .in('worker_id', allWorkerIds),
      adminClient
        .from('daily_checkins')
        .select('user_id, check_in_date')
        .in('user_id', allWorkerIds)
        .gte('check_in_date', startDate)
        .lte('check_in_date', endDate)
    ])

    const allCheckIns = checkInsResult.data || []
    const allWarmUps = warmUpsResult.data || []
    const incidents = incidentsResult.data || []
    const allWorkerSchedules = schedulesResult.data || []
    const checkInsForSchedules = checkInsForSchedulesResult.data || []

    // Calculate date range for schedule processing
    const start = new Date(startDate)
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)

    // Create a map: date -> Set of worker IDs with schedules on that date
    // Only includes ACTIVE schedules for accurate completion rate calculation
    const schedulesByDate = new Map<string, Set<string>>()
    
    // Filter to only ACTIVE schedules (same logic as team leader analytics)
    const activeSchedules = (allWorkerSchedules || []).filter((s: any) => s.is_active === true)
    
    // Process schedules to build the date map (supports both single-date and recurring)
    activeSchedules.forEach((schedule: any) => {
      // Single-date schedule
      if (schedule.scheduled_date && (schedule.day_of_week === null || schedule.day_of_week === undefined)) {
        const scheduleDate = new Date(schedule.scheduled_date)
        if (scheduleDate >= start && scheduleDate <= end) {
      const dateStr = schedule.scheduled_date
      if (!schedulesByDate.has(dateStr)) {
        schedulesByDate.set(dateStr, new Set())
        }
      schedulesByDate.get(dateStr)!.add(schedule.worker_id)
        }
      }
      // Recurring schedule: calculate all matching dates
      else if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        const effectiveDate = schedule.effective_date ? new Date(schedule.effective_date) : start
        const expiryDate = schedule.expiry_date ? new Date(schedule.expiry_date) : end
        expiryDate.setHours(23, 59, 59, 999)
        
        const scheduleStart = effectiveDate > start ? effectiveDate : start
        const scheduleEnd = expiryDate < end ? expiryDate : end
        
        // Calculate all dates that match the day_of_week within the effective range
        for (let d = new Date(scheduleStart); d <= scheduleEnd; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay() // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
          
          // Check if this date matches the schedule's day_of_week
          if (dayOfWeek === schedule.day_of_week) {
            const dateStr = dateToDateString(d)
            if (!schedulesByDate.has(dateStr)) {
              schedulesByDate.set(dateStr, new Set())
            }
            schedulesByDate.get(dateStr)!.add(schedule.worker_id)
          }
        }
      }
      })
    
    // Add check-ins (preserve workers with check-ins even if schedule was deleted)
    checkInsForSchedules.forEach((checkIn: any) => {
      const dateStr = checkIn.check_in_date
      if (!schedulesByDate.has(dateStr)) {
        schedulesByDate.set(dateStr, new Set())
      }
      schedulesByDate.get(dateStr)!.add(checkIn.user_id)
    })

    // Helper function to check if a worker is scheduled to work on a specific date
    // UPDATED: Supports both single-date and recurring schedules, only ACTIVE schedules
    const isWorkerScheduledOnDate = (workerId: string, checkDate: Date): boolean => {
      const year = checkDate.getFullYear()
      const month = String(checkDate.getMonth() + 1).padStart(2, '0')
      const day = String(checkDate.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`

      // Check if worker has an individual schedule for this date (from pre-fetched map)
      const workersWithScheduleOnDate = schedulesByDate.get(dateStr) || new Set()
      return workersWithScheduleOnDate.has(workerId)
    }

    // Filter valid check-ins (exclude exception days)
    const validCheckIns = (allCheckIns || []).filter((checkIn: any) => {
      const checkInDate = new Date(checkIn.check_in_date)
      const workerExceptions = exceptionsByWorker.get(checkIn.user_id) || []
      return !workerExceptions.some(exception => isExceptionActive(exception, checkInDate))
    })

    // Calculate expected check-ins (only on scheduled days, excluding exception days)
    // This calculates based on:
    // 1. Workers from supervisor's teams ONLY
    // 2. Individual worker schedules (from worker_schedules table) - supports both single-date and recurring
    // 3. Only ACTIVE schedules count toward expected check-ins
    // 4. Excludes days when workers have exceptions
    let totalExpectedCheckIns = 0
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0]
      const checkDate = new Date(dateStr)
      
      // Get workers with schedules on this date (from pre-fetched map)
      const workersWithScheduleOnDate = schedulesByDate.get(dateStr) || new Set()
      
      // Count workers who are:
      // - Have assigned schedule on this date
      // - Without exceptions on this date
      const activeWorkersOnDate = Array.from(workersWithScheduleOnDate).filter(workerId => {
        // Check if worker has exception on this date
        const workerExceptions = exceptionsByWorker.get(workerId) || []
        return !workerExceptions.some(exception => isExceptionActive(exception, checkDate))
      })
      
      totalExpectedCheckIns += activeWorkersOnDate.length
    }

    // Calculate summary statistics
    // Count unique check-ins (one per worker per day) - use a Set to track unique worker+date combinations
    const uniqueCheckInsSet = new Set<string>()
    validCheckIns.forEach((checkIn: any) => {
      const key = `${checkIn.user_id}-${checkIn.check_in_date}`
      uniqueCheckInsSet.add(key)
    })
    const totalCheckIns = uniqueCheckInsSet.size // Count unique worker+date combinations, not total check-ins
    const overallCompletionRate = totalExpectedCheckIns > 0 ? Math.round((totalCheckIns / totalExpectedCheckIns) * 100 * 10) / 10 : 0

    // Calculate readiness based on unique workers (not total check-ins)
    // For each worker, get their latest check-in status in the date range
    const workerLatestStatus = new Map<string, { status: string; date: string }>()
    validCheckIns.forEach((checkIn: any) => {
      const workerId = checkIn.user_id
      const checkInDate = checkIn.check_in_date
      const existing = workerLatestStatus.get(workerId)
      
      // Keep the latest check-in status for each worker
      if (!existing || checkInDate > existing.date) {
        workerLatestStatus.set(workerId, {
          status: checkIn.predicted_readiness,
          date: checkInDate
        })
      }
    })
    
    // Count workers by their latest readiness status
    let greenWorkers = 0
    let amberWorkers = 0
    let redWorkers = 0
    
    workerLatestStatus.forEach((data) => {
      const status = data.status
      if (status === 'Green') {
        greenWorkers++
      } else if (status === 'Yellow' || status === 'Amber') {
        amberWorkers++
      } else if (status === 'Red') {
        redWorkers++
      }
    })
    
    const totalWorkersWithReadiness = greenWorkers + amberWorkers + redWorkers
    
    // Calculate percentages based on workers, not check-ins
    const overallReadiness = {
      green: totalWorkersWithReadiness > 0 ? Math.round((greenWorkers / totalWorkersWithReadiness) * 100) : 0,
      amber: totalWorkersWithReadiness > 0 ? Math.round((amberWorkers / totalWorkersWithReadiness) * 100) : 0,
      red: totalWorkersWithReadiness > 0 ? Math.round((redWorkers / totalWorkersWithReadiness) * 100) : 0,
    }
    
    // Keep check-in counts for distribution (for display purposes)
    const green = validCheckIns.filter((c: any) => c.predicted_readiness === 'Green').length
    const amber = validCheckIns.filter((c: any) => c.predicted_readiness === 'Yellow' || c.predicted_readiness === 'Amber').length
    const red = validCheckIns.filter((c: any) => c.predicted_readiness === 'Red').length

    // Count active members (without exceptions on end date)
    const activeWorkers = allWorkerIds.filter(workerId => {
      const workerExceptions = exceptionsByWorker.get(workerId) || []
      return !workerExceptions.some(exception => isExceptionActive(exception, endDateObj))
    })

    // Team statistics
    const teamStatsMap = new Map<string, any>()
    assignedTeams.forEach(team => {
      const teamMembers = (allTeamMembers || []).filter(tm => tm.team_id === team.id)
      const teamWorkerIds = teamMembers.map(tm => tm.user_id)
      const teamCheckIns = validCheckIns.filter((c: any) => teamWorkerIds.includes(c.user_id))
      
      // Count unique check-ins for this team (one per worker per day)
      const uniqueTeamCheckInsSet = new Set<string>()
      teamCheckIns.forEach((checkIn: any) => {
        const key = `${checkIn.user_id}-${checkIn.check_in_date}`
        uniqueTeamCheckInsSet.add(key)
      })
      const uniqueTeamCheckIns = uniqueTeamCheckInsSet.size
      
      // Count expected check-ins for this team (only on scheduled days, excluding exception days)
      let teamExpectedCheckIns = 0
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0]
        const checkDate = new Date(dateStr)
        
        // Get workers with schedules on this date (from schedulesByDate map which includes both single-date and recurring)
        const workersWithScheduleOnDate = schedulesByDate.get(dateStr) || new Set()
        
        const activeWorkersOnDate = Array.from(workersWithScheduleOnDate).filter(workerId => {
          // Only count workers from this team
          if (!teamWorkerIds.includes(workerId)) return false
          
          // Check if worker has exception on this date
          const workerExceptions = exceptionsByWorker.get(workerId) || []
          return !workerExceptions.some(exception => isExceptionActive(exception, checkDate))
        })
        
        teamExpectedCheckIns += activeWorkersOnDate.length
      }

      const teamCompletionRate = teamExpectedCheckIns > 0 ? Math.round((uniqueTeamCheckIns / teamExpectedCheckIns) * 100 * 10) / 10 : 0
      const teamGreen = teamCheckIns.filter((c: any) => c.predicted_readiness === 'Green').length
      const teamAmber = teamCheckIns.filter((c: any) => c.predicted_readiness === 'Yellow' || c.predicted_readiness === 'Amber').length
      const teamRed = teamCheckIns.filter((c: any) => c.predicted_readiness === 'Red').length

      teamStatsMap.set(team.id, {
        teamId: team.id,
        teamName: team.name,
        siteLocation: team.site_location,
        teamLeaderId: team.team_leader_id,
        totalMembers: teamMembers.length,
        activeMembers: teamWorkerIds.filter(workerId => {
          const workerExceptions = exceptionsByWorker.get(workerId) || []
          return !workerExceptions.some(exception => isExceptionActive(exception, endDateObj))
        }).length,
        completionRate: teamCompletionRate,
        totalCheckIns: uniqueTeamCheckIns, // Use unique count, not total check-ins
        readiness: {
          green: teamGreen,
          amber: teamAmber,
          red: teamRed,
        },
      })
    })

    const teamStats = Array.from(teamStatsMap.values())

    // Team leader performance
    // IMPORTANT: Always return entries for all teams, even if they have no data in the date range
    // This ensures the frontend can display teams even when filtering by date range with no check-ins
    const teamLeaderPerformance = assignedTeams.map(team => {
      const teamStat = teamStatsMap.get(team.id)
      const teamLeader = teamLeaderMap.get(team.team_leader_id)
      
      return {
        teamLeaderId: team.team_leader_id,
        teamLeaderName: teamLeader?.full_name || 
                       (teamLeader?.first_name && teamLeader?.last_name 
                         ? `${teamLeader.first_name} ${teamLeader.last_name}`
                         : teamLeader?.email || 'Unknown'),
        teamLeaderEmail: teamLeader?.email || '',
        teamId: team.id,
        teamName: team.name,
        completionRate: teamStat?.completionRate || 0,
        activeMembers: teamStat?.activeMembers || 0,
        totalCheckIns: teamStat?.totalCheckIns || 0,
        readiness: teamStat?.readiness || { green: 0, amber: 0, red: 0 },
      }
    }).sort((a, b) => b.completionRate - a.completionRate)

    // Daily trends
    const dailyTrendsMap = new Map<string, {
      date: string
      completed: number
      green: number
      amber: number
      red: number
    }>()

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0]
      const checkDate = new Date(dateStr)
      
      // Get workers with schedules on this date (from schedulesByDate map which includes both single-date and recurring)
      const workersWithScheduleOnDate = schedulesByDate.get(dateStr) || new Set()
      
      const activeWorkersOnDate = Array.from(workersWithScheduleOnDate).filter(workerId => {
        const workerExceptions = exceptionsByWorker.get(workerId) || []
        return !workerExceptions.some(exception => isExceptionActive(exception, checkDate))
      }).length
      
      dailyTrendsMap.set(dateStr, {
        date: dateStr,
        completed: 0,
        green: 0,
        amber: 0,
        red: 0,
      })
    }

    validCheckIns.forEach((checkIn: any) => {
      const dateStr = checkIn.check_in_date
      const dayData = dailyTrendsMap.get(dateStr)
      if (dayData) {
        dayData.completed++
        if (checkIn.predicted_readiness === 'Green') dayData.green++
        else if (checkIn.predicted_readiness === 'Yellow' || checkIn.predicted_readiness === 'Amber') dayData.amber++
        else if (checkIn.predicted_readiness === 'Red') dayData.red++
      }
    })

    let dailyTrends = Array.from(dailyTrendsMap.values())
    
    // Sample data if too many days (keep every nth day for chart performance)
    if (dailyTrends.length > 30) {
      const sampleRate = Math.ceil(dailyTrends.length / 30)
      dailyTrends = dailyTrends.filter((_, index) => index % sampleRate === 0)
    }

    // Readiness distribution (for date range - used by Overall Readiness chart)
    // This should match the overallReadiness percentages which are now calculated based on workers (latest status)
    const readinessDistribution = {
      green: greenWorkers, // Number of workers with Green status (latest check-in)
      amber: amberWorkers, // Number of workers with Amber status (latest check-in)
      red: redWorkers, // Number of workers with Red status (latest check-in)
      pending: 0, // Not applicable for date range distribution
    }
    
    // Also calculate today's status for reference (if needed elsewhere)
    const today = getTodayDateString()
    const todayCheckIns = validCheckIns.filter((c: any) => c.check_in_date === today)
    const todayActiveWorkers = allWorkerIds.filter(workerId => {
      const workerExceptions = exceptionsByWorker.get(workerId) || []
      return !workerExceptions.some(exception => isExceptionActive(exception, new Date(today)))
    })
    const todayReadinessDistribution = {
      green: todayCheckIns.filter((c: any) => c.predicted_readiness === 'Green').length,
      amber: todayCheckIns.filter((c: any) => c.predicted_readiness === 'Yellow' || c.predicted_readiness === 'Amber').length,
      red: todayCheckIns.filter((c: any) => c.predicted_readiness === 'Red').length,
      pending: todayActiveWorkers.length - todayCheckIns.length,
    }

    // Exception statistics - count by type
    const exceptionTypeCounts: Record<string, number> = {
      transfer: 0,
      accident: 0,
      injury: 0,
      medical_leave: 0,
      other: 0,
    }

    // Count exceptions by type (all exceptions that overlap with the date range, regardless of is_active status)
    // This ensures historical exceptions that were closed/removed are still counted
    // Note: allExceptions is already filtered to only include overlapping exceptions, so we count all of them
    if (allExceptions) {
      allExceptions.forEach((exception: any) => {
        const type = exception.exception_type as string
        if (exceptionTypeCounts.hasOwnProperty(type)) {
          exceptionTypeCounts[type]++
        } else {
          exceptionTypeCounts[type] = 1
        }
      })
    }

    // Exception statistics by team
    // Count exceptions based on team_id stored in the exception record
    // This ensures exceptions created/updated by team leaders are properly counted
    const exceptionsByTeam = new Map<string, Record<string, number>>()
    assignedTeams.forEach(team => {
      // Filter exceptions by team_id - this includes all exceptions for workers in this team
      // regardless of when they were created or by whom (team leader or supervisor)
      const teamExceptions = (allExceptions || []).filter((exc: any) => exc.team_id === team.id)
      const teamExceptionCounts: Record<string, number> = {
        transfer: 0,
        accident: 0,
        injury: 0,
        medical_leave: 0,
        other: 0,
      }
      
      // Note: teamExceptions are already filtered to only include overlapping exceptions
      // So we count all of them directly
      teamExceptions.forEach((exception: any) => {
        const type = exception.exception_type as string
        if (teamExceptionCounts.hasOwnProperty(type)) {
          teamExceptionCounts[type]++
        } else {
          teamExceptionCounts[type] = 1
        }
      })
      
      exceptionsByTeam.set(team.id, teamExceptionCounts)
    })

    // Total exceptions (all exceptions that overlap with the date range, regardless of is_active status)
    const totalActiveExceptions = Object.values(exceptionTypeCounts).reduce((sum, count) => sum + count, 0)

    // Calculate top teams by cases (cases = worker_exceptions submitted by site supervisor)
    // Count all exceptions (cases) per team in the date range
    const casesByTeam = new Map<string, number>()
    assignedTeams.forEach(team => {
      const teamCases = (allExceptions || []).filter((exc: any) => exc.team_id === team.id)
      casesByTeam.set(team.id, teamCases.length)
    })

    // Get top 5 teams by cases
    const topTeamsByCases = Array.from(casesByTeam.entries())
      .map(([teamId, caseCount]) => {
        const team = assignedTeams.find(t => t.id === teamId)
        const teamStat = teamStatsMap.get(teamId)
        return {
          teamId,
          teamName: team?.name || 'Unknown',
          siteLocation: team?.site_location || null,
          caseCount,
          completionRate: teamStat?.completionRate || 0,
          readiness: teamStat?.readiness || { green: 0, amber: 0, red: 0 },
        }
      })
      .sort((a, b) => b.caseCount - a.caseCount)
      .slice(0, 5)

    const responseData = {
      summary: {
        totalTeams: assignedTeams.length,
        totalMembers: allWorkerIds.length,
        totalActiveMembers: activeWorkers.length,
        overallCompletionRate,
        overallReadiness,
        totalIncidents: incidents?.filter((i: any) => i.incident_type === 'incident').length || 0,
        totalNearMisses: incidents?.filter((i: any) => i.incident_type === 'near_miss').length || 0,
        totalActiveExceptions,
      },
      teamStats,
      teamLeaderPerformance,
      dailyTrends,
      readinessDistribution,
      topTeamsByCases,
      exceptionStats: {
        byType: exceptionTypeCounts,
        byTeam: Object.fromEntries(exceptionsByTeam),
        total: totalActiveExceptions,
      },
    }

    // Ensure response data structure is complete
    if (!responseData.teamLeaderPerformance || !Array.isArray(responseData.teamLeaderPerformance)) {
      console.error('[GET /supervisor/analytics] ERROR: teamLeaderPerformance is missing or not an array')
      responseData.teamLeaderPerformance = []
    }

    // Store in cache (5 minute TTL)
    cache.set(cacheKey, responseData, 5 * 60 * 1000)

    return c.json(responseData, 200, {
      'X-Cache': 'MISS',
      'Cache-Control': 'public, max-age=300',
    })
  } catch (error: any) {
    console.error('Supervisor analytics error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// ============================================
// Incident Management System Endpoints
// ============================================

// Get all incidents (exceptions) for supervisor's teams
// NOTE: Automatically includes exceptions created/updated by team leaders via "Manage Exception"
// Only shows incident-worthy exception types: accident, injury, medical_leave, other
// Transfer exceptions are excluded (administrative action, not an incident)
supervisor.get('/incidents', authMiddleware, requireRole(['supervisor']), async (c) => {
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
    
    const status = c.req.query('status') || 'all' // 'all', 'active', 'closed'
    const type = c.req.query('type') || 'all' // 'all', 'injury', 'medical_leave', etc.
    const search = c.req.query('search') || ''

    // Validate pagination
    if (limit < 1 || limit > 1000) {
      return c.json({ error: 'Invalid pagination parameters. Limit must be between 1 and 1000' }, 400)
    }
    if (page !== undefined && (page < 1)) {
      return c.json({ error: 'Invalid pagination parameters. Page must be >= 1' }, 400)
    }

    const adminClient = getAdminClient()

    // Get supervisor's teams
    let teams
    let teamsError
    try {
      const result = await adminClient
        .from('teams')
        .select('id')
        .eq('supervisor_id', user.id)
      teams = result.data
      teamsError = result.error
    } catch (err: any) {
      console.error('[GET /supervisor/incidents] Error fetching teams:', err)
      return c.json({ 
        error: 'Failed to fetch teams', 
        details: err.message || 'Unknown error'
      }, 500)
    }

    if (teamsError) {
      console.error('[GET /supervisor/incidents] Error fetching teams:', teamsError)
      return c.json({ 
        error: 'Failed to fetch teams', 
        details: teamsError.message 
      }, 500)
    }

    const teamIds = (teams || []).map((t: any) => t.id)

    if (teamIds.length === 0) {
      return c.json({
        incidents: [],
        summary: {
          total: 0,
          active: 0,
          closed: 0,
          closedThisMonth: 0,
          byType: {},
          teamMemberCount: 0,
        },
        pagination: {
          page: 1,
          limit,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      }, 200, {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      })
    }

    // Build query for exceptions (incidents)
    // NOTE: Only show exception types that are considered "incidents":
    // - accident, injury, medical_leave, other (exclude 'transfer' as it's administrative, not an incident)
    const incidentTypes = ['accident', 'injury', 'medical_leave', 'other']
    
    let countQuery = adminClient
      .from('worker_exceptions')
      .select('*', { count: 'exact', head: true })
      .in('team_id', teamIds)
      .in('exception_type', incidentTypes) // Only incident-worthy exceptions

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
          site_location
        ),
        clinician:users!worker_exceptions_clinician_id_fkey(
          id,
          email,
          first_name,
          last_name,
          full_name
        )
      `)
      .in('team_id', teamIds)
      .in('exception_type', incidentTypes) // Only incident-worthy exceptions

    // Filter by status
    const todayStr = getTodayDateString()
    if (status === 'active') {
      query = query.eq('is_active', true).gte('start_date', todayStr).or(`end_date.is.null,end_date.gte.${todayStr}`)
      countQuery = countQuery.eq('is_active', true).gte('start_date', todayStr).or(`end_date.is.null,end_date.gte.${todayStr}`)
    } else if (status === 'closed') {
      query = query.or(`end_date.lt.${todayStr},is_active.eq.false`)
      countQuery = countQuery.or(`end_date.lt.${todayStr},is_active.eq.false`)
    }

    // Filter by type
    if (type !== 'all') {
      query = query.eq('exception_type', type)
      countQuery = countQuery.eq('exception_type', type)
    }

    // Get paginated incidents using cursor or offset-based pagination
    let incidents: any[] = []
    let incidentsError: any = null
    let count: number | null = null
    let hasMore = false
    
    if (useCursor) {
      // Cursor-based pagination (more efficient for large datasets)
      const { decodeCursor, encodeCursor } = await import('../utils/pagination.js')
      
      // Decode cursor if provided
      let cursorFilter = query.order('created_at', { ascending: false })
      if (cursor) {
        const decoded = decodeCursor(cursor)
        if (decoded) {
          const cursorDate = decoded.createdAt || decoded.created_at
          if (cursorDate) {
            cursorFilter = cursorFilter.lt('created_at', cursorDate)
          }
        }
      }
      
      // Fetch limit + 1 to check if there's more
      const { data: incidentsData, error: incidentsErr } = await cursorFilter.limit(limit + 1)
      
      incidents = incidentsData || []
      incidentsError = incidentsErr
      hasMore = incidents.length > limit
      
      // Remove extra item if we got one
      if (hasMore) {
        incidents = incidents.slice(0, limit)
      }
    } else {
      // Offset-based pagination (backward compatible)
      const offset = ((page || 1) - 1) * limit
      
      // Get total count for offset pagination
      const { count: totalCount, error: countError } = await countQuery

    if (countError) {
      console.error('[GET /supervisor/incidents] Error counting incidents:', countError)
      return c.json({ error: 'Failed to count incidents', details: countError.message }, 500)
    }

      count = totalCount || 0

    // Get paginated incidents
      const { data: incidentsData, error: incidentsErr } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
      
      incidents = incidentsData || []
      incidentsError = incidentsErr
    }

    if (incidentsError) {
      console.error('[GET /supervisor/incidents] Error fetching incidents:', incidentsError)
      return c.json({ error: 'Failed to fetch incidents', details: incidentsError.message }, 500)
    }

    // Get summary statistics (only incident-worthy exceptions)
    const { data: allIncidents, error: summaryError } = await adminClient
      .from('worker_exceptions')
      .select('id, exception_type, is_active, start_date, end_date, created_at')
      .in('team_id', teamIds)
      .in('exception_type', incidentTypes) // Only count incident-worthy exceptions

    if (summaryError) {
      console.error('[GET /supervisor/incidents] Error fetching summary:', summaryError)
    }

    const todayDate = new Date()
    const startOfMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1)

    const summary = {
      total: allIncidents?.length || 0,
      active: 0,
      closed: 0,
      closedThisMonth: 0,
      byType: {} as Record<string, number>,
    }

    ;(allIncidents || []).forEach((incident: any) => {
      // Count by type
      const typeKey = incident.exception_type || 'other'
      summary.byType[typeKey] = (summary.byType[typeKey] || 0) + 1

      // Check if active
      const startDate = new Date(incident.start_date)
      const endDate = incident.end_date ? new Date(incident.end_date) : null
      const isCurrentlyActive = todayDate >= startDate && (!endDate || todayDate <= endDate) && incident.is_active

      if (isCurrentlyActive) {
        summary.active++
      } else {
        summary.closed++
        // Check if closed this month
        const closedDate = incident.end_date ? new Date(incident.end_date) : incident.updated_at ? new Date(incident.updated_at) : null
        if (closedDate && closedDate >= startOfMonth) {
          summary.closedThisMonth++
        }
      }
    })

    // Format incidents
    let formattedIncidents = (incidents || []).map((incident: any) => {
      const user = Array.isArray(incident.users) ? incident.users[0] : incident.users
      const team = Array.isArray(incident.teams) ? incident.teams[0] : incident.teams
      const clinician = Array.isArray(incident.clinician) ? incident.clinician[0] : incident.clinician

      const startDate = new Date(incident.start_date)
      const endDate = incident.end_date ? new Date(incident.end_date) : null
      const isCurrentlyActive = todayDate >= startDate && (!endDate || todayDate <= endDate) && incident.is_active

      // OPTIMIZATION: Use centralized notes parser
      const caseStatus = getCaseStatusFromNotes(incident.notes)
      const parsedNotes = parseIncidentNotes(incident.notes)
      const returnToWorkData = extractReturnToWorkData(
        incident.notes,
        incident.return_to_work_duty_type,
        incident.return_to_work_date
      )
      
      const approvedBy = parsedNotes?.approved_by || null
      const approvedAt = parsedNotes?.approved_at || null
      const returnToWorkDutyType = returnToWorkData.dutyType
      const returnToWorkDate = returnToWorkData.returnDate
      const clinicalNotes = parsedNotes?.clinical_notes || null
      const clinicalNotesUpdatedAt = parsedNotes?.clinical_notes_updated_at || null

      return {
        id: incident.id,
        workerId: incident.user_id,
        workerName: user?.full_name || 
                   (user?.first_name && user?.last_name 
                     ? `${user.first_name} ${user.last_name}`
                     : user?.email || 'Unknown'),
        workerEmail: user?.email || '',
        teamId: incident.team_id,
        teamName: team?.name || '',
        type: incident.exception_type,
        reason: incident.reason || '',
        startDate: incident.start_date,
        endDate: incident.end_date,
        isActive: isCurrentlyActive,
        assignedToWhs: incident.assigned_to_whs || false,
        clinicianId: incident.clinician_id || null,
        clinicianName: clinician ? (clinician.full_name || 
                   (clinician.first_name && clinician.last_name 
                     ? `${clinician.first_name} ${clinician.last_name}`
                     : clinician.email || 'Unknown')) : null,
        clinicianEmail: clinician?.email || null,
        caseStatus: caseStatus,
        notes: incident.notes || null,
        approvedBy: approvedBy,
        approvedAt: approvedAt,
        returnToWorkDutyType: returnToWorkDutyType || incident.return_to_work_duty_type || null,
        returnToWorkDate: returnToWorkDate || incident.return_to_work_date || null,
        clinicalNotes: clinicalNotes,
        clinicalNotesUpdatedAt: clinicalNotesUpdatedAt,
        createdAt: incident.created_at,
        updatedAt: incident.updated_at,
      }
    })

    // Apply search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase()
      formattedIncidents = formattedIncidents.filter(incident => 
        incident.workerName.toLowerCase().includes(searchLower) ||
        incident.workerEmail.toLowerCase().includes(searchLower)
      )
    }

    // Build pagination response
    let paginationResponse: any
    
    if (useCursor) {
      // Cursor-based pagination response
      const { encodeCursor } = await import('../utils/pagination.js')
      
      let nextCursor: string | undefined = undefined
      if (hasMore && formattedIncidents.length > 0) {
        const lastItem = incidents[incidents.length - 1]
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

    // Get team member count (with error handling)
    let teamMemberCount = 0
    try {
      const { data: teamMembers, error: membersError } = await adminClient
        .from('team_members')
        .select('user_id')
        .in('team_id', teamIds)

      if (membersError) {
        console.error('[GET /supervisor/incidents] Error fetching team members:', membersError)
        // Continue with 0 count instead of failing
      } else {
        const uniqueMemberIds = new Set((teamMembers || []).map((tm: any) => tm.user_id))
        teamMemberCount = uniqueMemberIds.size
      }
    } catch (err: any) {
      console.error('[GET /supervisor/incidents] Error counting team members:', err)
      // Continue with 0 count instead of failing
    }

    return c.json({
      incidents: formattedIncidents,
      summary: {
        ...summary,
        teamMemberCount,
      },
      pagination: paginationResponse,
    }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  } catch (error: any) {
    console.error('[GET /supervisor/incidents] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Report new incident (create exception for worker)
supervisor.post('/incidents', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { workerId, teamId, type, reason, startDate, endDate } = await c.req.json()

    // Validation
    if (!workerId || !teamId || !type || !startDate) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    const validTypes = ['transfer', 'accident', 'injury', 'medical_leave', 'other']
    if (!validTypes.includes(type)) {
      return c.json({ error: 'Invalid incident type' }, 400)
    }

    const adminClient = getAdminClient()

    // Verify team belongs to supervisor
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('id, supervisor_id')
      .eq('id', teamId)
      .eq('supervisor_id', user.id)
      .single()

    if (teamError || !team) {
      return c.json({ error: 'Team not found or unauthorized' }, 404)
    }

    // Verify worker is in this team
    const { data: teamMember, error: memberError } = await adminClient
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId)
      .eq('user_id', workerId)
      .single()

    if (memberError || !teamMember) {
      return c.json({ error: 'Worker not found in this team' }, 404)
    }

    // Check if worker already has active exception (excluding closed cases)
    const { data: existingException, error: existingError } = await adminClient
      .from('worker_exceptions')
      .select('id, notes, is_active, deactivated_at')
      .eq('user_id', workerId)
      .eq('is_active', true)
      .maybeSingle()

    if (existingException) {
      // Check if case is closed (case_status in notes)
      // OPTIMIZATION: Use centralized notes parser
      const caseStatus = getCaseStatusFromNotes(existingException.notes)
      let isClosed = caseStatus === 'closed' || caseStatus === 'return_to_work'
      
      // Also check deactivated_at timestamp (if case was closed by supervisor)
      if (!isClosed && existingException.deactivated_at) {
        isClosed = true
      }
      
      if (!isClosed) {
      return c.json({ error: 'Worker already has an active incident/exception' }, 400)
      }
    }

    // OPTIMIZATION: Automatically deactivate all active schedules when incident is reported
    // This uses the new worker schedule logic - schedules are soft-deleted (is_active = false)
    // but data remains in database for analytics purposes
    let deactivatedScheduleCount = 0
    try {
      // OPTIMIZATION: Use count query instead of fetching all IDs to reduce data transfer
      const { count: scheduleCount, error: countError } = await adminClient
        .from('worker_schedules')
        .select('*', { count: 'exact', head: true })
        .eq('worker_id', workerId)
        .eq('is_active', true)
      
      if (!countError && scheduleCount && scheduleCount > 0) {
        // Only update if there are active schedules
        const { error: deactivateError } = await adminClient
          .from('worker_schedules')
          .update({ is_active: false })
          .eq('worker_id', workerId)
          .eq('is_active', true)

        if (deactivateError) {
          console.error('[POST /supervisor/incidents] Error deactivating schedules:', deactivateError)
          // Don't fail the incident creation if schedule deactivation fails
        } else {
          deactivatedScheduleCount = scheduleCount
          if (deactivatedScheduleCount > 0) {
            console.log(`[POST /supervisor/incidents] Automatically deactivated ${deactivatedScheduleCount} active schedule(s) for worker ${workerId} (Incident reported)`)
          }
        }
      }
    } catch (deactivateScheduleError: any) {
      console.error('[POST /supervisor/incidents] Error in schedule deactivation process:', deactivateScheduleError)
      // Don't fail the incident creation if schedule deactivation fails
    }

    // Create exception (incident)
    const { data: newException, error: createError } = await adminClient
      .from('worker_exceptions')
      .insert([{
        user_id: workerId,
        team_id: teamId,
        exception_type: type,
        reason: reason || '',
        start_date: startDate,
        end_date: endDate || null,
        is_active: true,
        created_by: user.id,
      }])
      .select()
      .single()

    if (createError) {
      console.error('[POST /supervisor/incidents] Error creating incident:', createError)
      return c.json({ error: 'Failed to create incident', details: createError.message }, 500)
    }

    // Create notifications for worker and team leader
    try {
      // Get worker and team leader details for notifications
      const [workerResult, teamResult] = await Promise.all([
        adminClient
          .from('users')
          .select('id, email, first_name, last_name, full_name')
          .eq('id', workerId)
          .single(),
        adminClient
          .from('teams')
          .select('team_leader_id, name')
          .eq('id', teamId)
          .single(),
      ])

      const worker = workerResult.data
      const team = teamResult.data
      const supervisorName = (user as any).first_name || user.email || 'Site Supervisor'
      const workerName = worker?.full_name || 
                        (worker?.first_name && worker?.last_name 
                          ? `${worker.first_name} ${worker.last_name}`
                          : worker?.email || 'Unknown Worker')
      
      const incidentTypeLabels: Record<string, string> = {
        accident: 'Accident',
        injury: 'Injury',
        medical_leave: 'Medical Leave',
        transfer: 'Transfer',
        other: 'Other',
      }
      const incidentTypeLabel = incidentTypeLabels[type] || type

      // Create notifications
      const notifications: any[] = []

      // Notification for worker
      if (worker) {
        notifications.push({
          user_id: workerId,
          type: 'system', // Using 'system' type for incident notifications
          title: '⚠️ Incident Report Filed',
          message: `An ${incidentTypeLabel} incident has been reported for you by ${supervisorName}. Your schedules have been temporarily deactivated. Please contact your team leader for more information.`,
          data: {
            incident_id: newException.id,
            incident_type: type,
            supervisor_id: user.id,
            supervisor_name: supervisorName,
            team_id: teamId,
            team_name: team?.name || '',
            start_date: startDate,
            end_date: endDate || null,
            reason: reason || '',
          },
          is_read: false,
        })
      }

      // Notification for team leader
      if (team?.team_leader_id) {
        // OPTIMIZATION: Don't format dates here - let frontend handle formatting for better performance
        notifications.push({
          user_id: team.team_leader_id,
          type: 'system', // Using 'system' type for incident notifications
          title: '⚠️ Worker Incident Reported',
          message: `${supervisorName} has reported an ${incidentTypeLabel} incident for ${workerName}.`,
          data: {
            incident_id: newException.id,
            worker_id: workerId,
            worker_name: workerName,
            worker_email: worker?.email || '',
            incident_type: type,
            incident_type_label: incidentTypeLabel,
            supervisor_id: user.id,
            supervisor_name: supervisorName,
            supervisor_email: user.email || '',
            team_id: teamId,
            team_name: team?.name || '',
            start_date: startDate,
            end_date: endDate || null,
            reason: reason || '',
            schedules_deactivated: deactivatedScheduleCount,
          },
          is_read: false,
        })
      }

      // Insert notifications in batch
      if (notifications.length > 0) {
        const { error: notifyError } = await adminClient
          .from('notifications')
          .insert(notifications)

        if (notifyError) {
          console.error('[POST /supervisor/incidents] Error creating notifications:', notifyError)
          // Don't fail the incident creation if notifications fail
        } else {
          console.log(`[POST /supervisor/incidents] Created ${notifications.length} notification(s) for incident ${newException.id}`)
        }
      }
    } catch (notificationError: any) {
      console.error('[POST /supervisor/incidents] Error in notification process:', notificationError)
      // Don't fail the incident creation if notifications fail
    }

    // Invalidate cache for analytics (since exception affects analytics)
    try {
      const { cache } = await import('../utils/cache.js')
      
      // Invalidate supervisor analytics
      cache.deleteByUserId(user.id, ['supervisor-analytics'])
      
      // Also invalidate team leader analytics
      const { data: teamData } = await adminClient
        .from('teams')
        .select('team_leader_id')
        .eq('id', teamId)
        .single()
      
      if (teamData?.team_leader_id) {
        cache.deleteByUserId(teamData.team_leader_id, ['analytics'])
      }
    } catch (cacheError: any) {
      console.error('[POST /supervisor/incidents] Error invalidating cache:', cacheError)
      // Don't fail the request if cache invalidation fails
    }

    return c.json({ 
      incident: newException,
      deactivatedSchedules: deactivatedScheduleCount,
      ...(deactivatedScheduleCount > 0 && {
        scheduleMessage: `${deactivatedScheduleCount} active schedule(s) were automatically deactivated. Schedule data is preserved for analytics.`
      }),
    }, 201)
  } catch (error: any) {
    console.error('[POST /supervisor/incidents] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Assign incident to WHS (supervisor approval)
supervisor.patch('/incidents/:incidentId/assign-to-whs', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const incidentId = c.req.param('incidentId')

    const adminClient = getAdminClient()

    // Verify incident belongs to supervisor's team
    const { data: incident, error: incidentError } = await adminClient
      .from('worker_exceptions')
      .select('id, team_id, teams!inner(supervisor_id)')
      .eq('id', incidentId)
      .single()

    if (incidentError || !incident) {
      return c.json({ error: 'Incident not found' }, 404)
    }

    const team = Array.isArray((incident as any).teams) ? (incident as any).teams[0] : (incident as any).teams
    if (team?.supervisor_id !== user.id) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // Get incident details for notification
    const { data: incidentDetails, error: detailsError } = await adminClient
      .from('worker_exceptions')
      .select(`
        id,
        exception_type,
        reason,
        start_date,
        created_at,
        users!worker_exceptions_user_id_fkey(
          first_name,
          last_name,
          full_name,
          email
        ),
        teams!worker_exceptions_team_id_fkey(
          name,
          site_location
        )
      `)
      .eq('id', incidentId)
      .single()

    if (detailsError || !incidentDetails) {
      console.error('[PATCH /supervisor/incidents/:id/assign-to-whs] Error fetching incident details:', detailsError)
      return c.json({ error: 'Failed to fetch incident details' }, 500)
    }

    // Update exception to mark as assigned to WHS
    const { data: updated, error: updateError } = await adminClient
      .from('worker_exceptions')
      .update({
        assigned_to_whs: true,
      })
      .eq('id', incidentId)
      .select()
      .single()

    if (updateError) {
      console.error('[PATCH /supervisor/incidents/:id/assign-to-whs] Error:', updateError)
      return c.json({ error: 'Failed to assign incident to WHS', details: updateError.message }, 500)
    }

    // Generate case number for notification
    const createdAt = new Date(incidentDetails.created_at || new Date())
    const year = createdAt.getFullYear()
    const month = String(createdAt.getMonth() + 1).padStart(2, '0')
    const day = String(createdAt.getDate()).padStart(2, '0')
    const hours = String(createdAt.getHours()).padStart(2, '0')
    const minutes = String(createdAt.getMinutes()).padStart(2, '0')
    const seconds = String(createdAt.getSeconds()).padStart(2, '0')
    const uuidPrefix = incidentId.substring(0, 4).toUpperCase()
    const caseNumber = `CASE-${year}${month}${day}-${hours}${minutes}${seconds}-${uuidPrefix}`

    // Get all WHS users to send notifications
    const { data: whsUsers, error: whsUsersError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name')
      .eq('role', 'whs_control_center')

    if (!whsUsersError && whsUsers && whsUsers.length > 0) {
      const worker = Array.isArray(incidentDetails.users) ? incidentDetails.users[0] : incidentDetails.users
      const team = Array.isArray(incidentDetails.teams) ? incidentDetails.teams[0] : incidentDetails.teams
      const workerName = worker?.full_name || 
                        (worker?.first_name && worker?.last_name 
                          ? `${worker.first_name} ${worker.last_name}`
                          : worker?.email || 'Unknown')

      const incidentTypeLabels: Record<string, string> = {
        accident: 'Accident',
        injury: 'Injury',
        medical_leave: 'Medical Leave',
        other: 'Other',
      }

      // Create notifications for all WHS users
      const supervisorName = (user as any).first_name || user.email || 'Unknown'
      const notifications = whsUsers.map((whsUser: any) => ({
        user_id: whsUser.id,
        type: 'incident_assigned',
        title: 'New Incident Assigned',
        message: `A new ${incidentTypeLabels[incidentDetails.exception_type] || incidentDetails.exception_type} incident has been assigned to WHS by ${supervisorName}.`,
        data: {
          incident_id: incidentId,
          case_number: caseNumber,
          worker_name: workerName,
          worker_email: worker?.email || '',
          team_name: team?.name || '',
          site_location: team?.site_location || '',
          incident_type: incidentDetails.exception_type,
          supervisor_id: user.id,
          supervisor_name: supervisorName,
        },
        is_read: false,
      }))

      // Insert notifications in batch
      const { error: notifyError } = await adminClient
        .from('notifications')
        .insert(notifications)

      if (notifyError) {
        console.error('[PATCH /supervisor/incidents/:id/assign-to-whs] Error creating notifications:', notifyError)
        // Don't fail the request if notifications fail - incident is still assigned
      }
    }

    return c.json({ incident: updated })
  } catch (error: any) {
    console.error('[PATCH /supervisor/incidents/:id/assign-to-whs] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Close incident (deactivate exception)
supervisor.patch('/incidents/:incidentId/close', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const incidentId = c.req.param('incidentId')

    const adminClient = getAdminClient()

    // Verify incident belongs to supervisor's team
    const { data: incident, error: incidentError } = await adminClient
      .from('worker_exceptions')
      .select('id, user_id, team_id, teams!inner(supervisor_id)')
      .eq('id', incidentId)
      .single()

    if (incidentError || !incident) {
      return c.json({ error: 'Incident not found' }, 404)
    }

    const team = Array.isArray((incident as any).teams) ? (incident as any).teams[0] : (incident as any).teams
    if (team?.supervisor_id !== user.id) {
      return c.json({ error: 'Unauthorized' }, 403)
    }

    // OPTIMIZATION: Automatically reactivate all inactive schedules for this worker when incident is closed
    // This uses the new worker schedule logic - schedules that were deactivated due to exception will be reactivated
    let reactivatedScheduleCount = 0
    try {
      // OPTIMIZATION: Use count query instead of fetching all IDs to reduce data transfer
      const { count: scheduleCount, error: countError } = await adminClient
        .from('worker_schedules')
        .select('*', { count: 'exact', head: true })
        .eq('worker_id', (incident as any).user_id)
        .eq('is_active', false)
      
      if (!countError && scheduleCount && scheduleCount > 0) {
        // Only update if there are inactive schedules
        const { error: reactivateError } = await adminClient
          .from('worker_schedules')
          .update({ is_active: true })
          .eq('worker_id', (incident as any).user_id)
          .eq('is_active', false)

        if (reactivateError) {
          console.error('[PATCH /supervisor/incidents/:incidentId/close] Error reactivating schedules:', reactivateError)
          // Don't fail the incident closure if schedule reactivation fails
        } else {
          reactivatedScheduleCount = scheduleCount
          if (reactivatedScheduleCount > 0) {
            console.log(`[PATCH /supervisor/incidents/:incidentId/close] Automatically reactivated ${reactivatedScheduleCount} schedule(s) for worker ${(incident as any).user_id} (Incident closed)`)
          }
        }
      }
    } catch (reactivateScheduleError: any) {
      console.error('[PATCH /supervisor/incidents/:incidentId/close] Error in schedule reactivation process:', reactivateScheduleError)
      // Don't fail the incident closure if schedule reactivation fails
    }

    // Update exception to inactive and set deactivated_at timestamp
    const today = getTodayDateString()
    const { data: updated, error: updateError } = await adminClient
      .from('worker_exceptions')
      .update({
        is_active: false,
        end_date: today,
        deactivated_at: new Date().toISOString(),
      })
      .eq('id', incidentId)
      .select()
      .single()

    if (updateError) {
      console.error('[PATCH /supervisor/incidents/:id/close] Error:', updateError)
      return c.json({ error: 'Failed to close incident', details: updateError.message }, 500)
    }

    // Invalidate cache for analytics (since incident closure affects analytics)
    try {
      const { cache } = await import('../utils/cache.js')
      
      // Invalidate supervisor analytics
      cache.deleteByUserId(user.id, ['supervisor-analytics'])
      
      // Also invalidate team leader analytics
      const { data: teamData } = await adminClient
        .from('teams')
        .select('team_leader_id')
        .eq('id', (incident as any).team_id)
        .single()
      
      if (teamData?.team_leader_id) {
        cache.deleteByUserId(teamData.team_leader_id, ['analytics'])
      }
    } catch (cacheError: any) {
      console.error('[PATCH /supervisor/incidents/:incidentId/close] Error invalidating cache:', cacheError)
      // Don't fail the request if cache invalidation fails
    }

    return c.json({ 
      incident: updated,
      reactivatedSchedules: reactivatedScheduleCount,
      ...(reactivatedScheduleCount > 0 && {
        scheduleMessage: `${reactivatedScheduleCount} schedule(s) were automatically reactivated for this worker. Exception has been removed.`
      }),
    })
  } catch (error: any) {
    console.error('[PATCH /supervisor/incidents/:id/close] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get workers for reporting incident (supervisor's teams only)
// NOTE: Only returns users with role='worker' - team leaders are excluded
supervisor.get('/incidents/workers', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // Get supervisor's teams
    const { data: teams, error: teamsError } = await adminClient
      .from('teams')
      .select('id, name, site_location')
      .eq('supervisor_id', user.id)

    if (teamsError) {
      console.error('[GET /supervisor/incidents/workers] Error fetching teams:', teamsError)
      return c.json({ error: 'Failed to fetch teams', details: teamsError.message }, 500)
    }

    const teamIds = (teams || []).map(t => t.id)

    if (teamIds.length === 0) {
      return c.json({ workers: [] })
    }

    // Get all team members
    const { data: teamMembers, error: membersError } = await adminClient
      .from('team_members')
      .select('user_id, team_id')
      .in('team_id', teamIds)

    if (membersError) {
      console.error('[GET /supervisor/incidents/workers] Error fetching members:', membersError)
      return c.json({ error: 'Failed to fetch workers', details: membersError.message }, 500)
    }

    const workerIds = Array.from(new Set((teamMembers || []).map((tm: any) => tm.user_id)))

    if (workerIds.length === 0) {
      return c.json({ workers: [] })
    }

    // Get worker details
    const { data: workers, error: workersError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .eq('role', 'worker')
      .in('id', workerIds)

    if (workersError) {
      console.error('[GET /supervisor/incidents/workers] Error fetching workers:', workersError)
      return c.json({ error: 'Failed to fetch workers', details: workersError.message }, 500)
    }

    // Map workers to teams
    const workerMap = new Map()
    ;(teamMembers || []).forEach((tm: any) => {
      if (!workerMap.has(tm.user_id)) {
        workerMap.set(tm.user_id, [])
      }
      const team = teams?.find(t => t.id === tm.team_id)
      if (team) {
        workerMap.get(tm.user_id).push(team)
      }
    })

    // Format workers
    const formattedWorkers = (workers || []).map((worker: any) => {
      const workerTeams = workerMap.get(worker.id) || []
      return {
        id: worker.id,
        email: worker.email,
        name: worker.full_name || 
              (worker.first_name && worker.last_name 
                ? `${worker.first_name} ${worker.last_name}`
                : worker.email),
        teams: workerTeams.map((t: any) => ({
          id: t.id,
          name: t.name,
          siteLocation: t.site_location,
        })),
      }
    })

    return c.json({ workers: formattedWorkers })
  } catch (error: any) {
    console.error('[GET /supervisor/incidents/workers] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get supervisor's submitted incidents for monitoring (Kanban board view)
// Returns incidents grouped by status: In Progress, Rehabilitation, Completed
supervisor.get('/my-incidents', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // Get date range from query params (default: last 6 months)
    const today = new Date()
    const defaultStartDate = new Date(today.getFullYear(), today.getMonth() - 6, 1)
    const startDateParam = c.req.query('startDate')
    const endDateParam = c.req.query('endDate')
    
    const startDate = startDateParam || dateToDateString(defaultStartDate)
    const endDate = endDateParam || dateToDateString(today)
    
    // Validate date range (max 2 years to prevent performance issues)
    const startDateObj = new Date(startDate)
    const endDateObj = new Date(endDate)
    const daysDiff = Math.ceil((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDiff > 730) {
      return c.json({ error: 'Date range cannot exceed 2 years' }, 400)
    }
    if (startDateObj > endDateObj) {
      return c.json({ error: 'startDate must be less than or equal to endDate' }, 400)
    }

    // OPTIMIZATION: Get incidents created by this supervisor within date range
    // Only fetch incidents (exclude transfer type as it's administrative)
    const incidentTypes = ['accident', 'injury', 'medical_leave', 'other']
    
    const { data: incidents, error: incidentsError } = await adminClient
      .from('worker_exceptions')
      .select(`
        id,
        user_id,
        team_id,
        exception_type,
        reason,
        start_date,
        end_date,
        is_active,
        notes,
        created_at,
        updated_at,
        assigned_to_whs,
        clinician_id,
        return_to_work_duty_type,
        return_to_work_date,
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
      .eq('created_by', user.id)
      .in('exception_type', incidentTypes)
      .gte('created_at', `${startDate}T00:00:00.000Z`)
      .lte('created_at', `${endDate}T23:59:59.999Z`)
      .order('created_at', { ascending: false })

    if (incidentsError) {
      console.error('[GET /supervisor/my-incidents] Error fetching incidents:', incidentsError)
      return c.json({ error: 'Failed to fetch incidents', details: incidentsError.message }, 500)
    }

    // Process incidents and extract case status
    const processedIncidents = (incidents || []).map((incident: any) => {
      const worker = incident.users || {}
      const team = incident.teams || {}
      
      // Extract case status from notes
      const caseStatus = getCaseStatusFromNotes(incident.notes)
      
      // OPTIMIZATION: Use centralized notes parser
      const parsedNotes = parseIncidentNotes(incident.notes)
      const returnToWorkData = extractReturnToWorkData(
        incident.notes,
        incident.return_to_work_duty_type,
        incident.return_to_work_date
      )
      
      const approvedByClinician = parsedNotes?.approved_by || null
      const approvedAt = parsedNotes?.approved_at || null
      const whsApprovedBy = parsedNotes?.whs_approved_by || null
      const whsApprovedAt = parsedNotes?.whs_approved_at || null
      const returnToWorkDutyType = returnToWorkData.dutyType
      const returnToWorkDate = returnToWorkData.returnDate
      const clinicalNotes = parsedNotes?.clinical_notes || null
      const clinicalNotesUpdatedAt = parsedNotes?.clinical_notes_updated_at || null
      
      // Determine status category for Kanban board
      let statusCategory: 'in_progress' | 'rehabilitation' | 'completed' = 'in_progress'
      
      if (caseStatus === 'in_rehab') {
        statusCategory = 'rehabilitation'
      } else if (caseStatus === 'return_to_work' || caseStatus === 'closed' || !incident.is_active) {
        statusCategory = 'completed'
      } else {
        // new, triaged, assessed, or no status = in_progress
        statusCategory = 'in_progress'
      }

      return {
        id: incident.id,
        workerId: incident.user_id,
        workerName: worker.full_name || 
                   (worker.first_name && worker.last_name 
                     ? `${worker.first_name} ${worker.last_name}`
                     : worker.email || 'Unknown'),
        workerEmail: worker.email || '',
        teamId: incident.team_id,
        teamName: team.name || 'Unknown Team',
        siteLocation: team.site_location || null,
        type: incident.exception_type,
        reason: incident.reason || '',
        startDate: incident.start_date,
        endDate: incident.end_date,
        isActive: incident.is_active,
        assignedToWhs: incident.assigned_to_whs || false,
        clinicianId: incident.clinician_id,
        caseStatus: caseStatus, // Raw case status from notes
        statusCategory: statusCategory, // For Kanban board grouping
        approvedByClinician,
        approvedAt,
        whsApprovedBy,
        whsApprovedAt,
        returnToWorkDutyType,
        returnToWorkDate,
        clinicalNotes,
        clinicalNotesUpdatedAt,
        createdAt: incident.created_at,
        updatedAt: incident.updated_at,
      }
    })

    // Group incidents by status category
    const inProgress = processedIncidents.filter(i => i.statusCategory === 'in_progress')
    const rehabilitation = processedIncidents.filter(i => i.statusCategory === 'rehabilitation')
    const completed = processedIncidents.filter(i => i.statusCategory === 'completed')

    return c.json({
      incidents: {
        in_progress: inProgress,
        rehabilitation: rehabilitation,
        completed: completed,
      },
      counts: {
        in_progress: inProgress.length,
        rehabilitation: rehabilitation.length,
        completed: completed.length,
        total: processedIncidents.length,
      },
      dateRange: {
        startDate,
        endDate,
      },
    })
  } catch (error: any) {
    console.error('[GET /supervisor/my-incidents] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})


// ============================================
// Notifications Endpoints for Supervisor
// ============================================

// Get notifications for Supervisor
supervisor.get('/notifications', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200) // Max 200 notifications
    const unreadOnly = c.req.query('unread_only') === 'true'

    const adminClient = getAdminClient()

    // SECURITY: Only fetch notifications belonging to the authenticated supervisor
    let query = adminClient
      .from('notifications')
      .select('*')
      .eq('user_id', user.id) // Critical: Only get user's own notifications
      .order('created_at', { ascending: false })
      .limit(limit)

    if (unreadOnly) {
      query = query.eq('is_read', false)
    }

    const { data: notifications, error } = await query

    if (error) {
      console.error('[GET /supervisor/notifications] Error:', error)
      return c.json({ error: 'Failed to fetch notifications', details: error.message }, 500)
    }

    // Count unread notifications
    const { count: unreadCount, error: countError } = await adminClient
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)

    if (countError) {
      console.error('[GET /supervisor/notifications] Error counting unread:', countError)
    }

    return c.json({
      notifications: notifications || [],
      unreadCount: unreadCount || 0,
    })
  } catch (error: any) {
    console.error('[GET /supervisor/notifications] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark notification as read (Supervisor)
supervisor.patch('/notifications/:notificationId/read', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const notificationId = c.req.param('notificationId')
    const adminClient = getAdminClient()

    // SECURITY: Only allow marking own notifications as read
    const { data: notification, error: fetchError } = await adminClient
      .from('notifications')
      .select('id, user_id')
      .eq('id', notificationId)
      .eq('user_id', user.id) // Critical: Only allow updating own notifications
      .single()

    if (fetchError || !notification) {
      return c.json({ error: 'Notification not found or unauthorized' }, 404)
    }

    const { error: updateError } = await adminClient
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId)
      .eq('user_id', user.id) // Double-check security

    if (updateError) {
      console.error('[PATCH /supervisor/notifications/:id/read] Error:', updateError)
      return c.json({ error: 'Failed to mark notification as read', details: updateError.message }, 500)
    }

    return c.json({ success: true })
  } catch (error: any) {
    console.error('[PATCH /supervisor/notifications/:id/read] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark all notifications as read (Supervisor)
supervisor.patch('/notifications/read-all', authMiddleware, requireRole(['supervisor']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // SECURITY: Only mark own notifications as read
    const { error: updateError } = await adminClient
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('user_id', user.id) // Critical: Only update own notifications
      .eq('is_read', false) // Only update unread ones

    if (updateError) {
      console.error('[PATCH /supervisor/notifications/read-all] Error:', updateError)
      return c.json({ error: 'Failed to mark all notifications as read', details: updateError.message }, 500)
    }

    return c.json({ success: true })
  } catch (error: any) {
    console.error('[PATCH /supervisor/notifications/read-all] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

export default supervisor

