import { Hono } from 'hono'
import bcrypt from 'bcrypt'
import { authMiddleware, requireRole } from '../middleware/auth.js'
import { getAdminClient } from '../utils/adminClient.js'
import { supabase } from '../lib/supabase.js'
import { getTodayDateString, getFirstDayOfMonthString, dateToDateString } from '../utils/dateUtils.js'

const admin = new Hono()

// Medical incident types that require clinician assignment
const MEDICAL_INCIDENT_TYPES = ['accident', 'injury', 'medical_leave', 'other'] as const

// Helper function to format clinician full name (reusable across endpoints)
const formatClinicianName = (clinician: any): string => {
  return clinician.full_name || 
         (clinician.first_name && clinician.last_name 
           ? `${clinician.first_name} ${clinician.last_name}`
           : clinician.email)
}

// Get system-wide statistics (admin only)
admin.get('/stats', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const adminClient = getAdminClient()
    
    // Get date range from query params (for analytics filtering)
    const startDateParam = c.req.query('startDate')
    const endDateParam = c.req.query('endDate')
    
    // Default to last 7 days if no dates provided
    const todayDateStr = getTodayDateString()
    const defaultStartDate = new Date()
    defaultStartDate.setDate(defaultStartDate.getDate() - 7)
    const defaultStart = dateToDateString(defaultStartDate)
    
    const startDate = startDateParam || defaultStart
    const endDate = endDateParam || todayDateStr

    // Get all users grouped by role
    const { data: allUsers } = await adminClient
      .from('users')
      .select('id, role, email, created_at')

    const usersByRole: Record<string, number> = {
      worker: 0,
      team_leader: 0,
      supervisor: 0,
      clinician: 0,
      whs_control_center: 0,
      executive: 0,
      admin: 0,
    }

    let activeUsers = 0
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    allUsers?.forEach((user: any) => {
      if (user.role && usersByRole.hasOwnProperty(user.role)) {
        usersByRole[user.role]++
      }
      // Consider user active if created in last 30 days or has recent activity
      if (new Date(user.created_at) >= thirtyDaysAgo) {
        activeUsers++
      }
    })

    // Get all teams
    const { data: allTeams } = await adminClient
      .from('teams')
      .select('id, supervisor_id, team_leader_id')

    const teamsWithSupervisor = allTeams?.filter((t: any) => t.supervisor_id).length || 0
    const teamsWithTeamLeader = allTeams?.filter((t: any) => t.team_leader_id).length || 0

    // Get all team members
    const { data: allTeamMembers } = await adminClient
      .from('team_members')
      .select('id')

    // Get check-ins statistics - optimized single query
    const todayStr = getTodayDateString()
    const thisWeek = new Date()
    thisWeek.setDate(thisWeek.getDate() - 7)
    const thisMonth = new Date()
    thisMonth.setMonth(thisMonth.getMonth() - 1)

    // Single query for all check-ins data
    const { data: allCheckIns } = await adminClient
      .from('daily_checkins')
      .select('id, predicted_readiness, check_in_date')

    // Calculate statistics from single query result
    const todayCheckIns = allCheckIns?.filter((c: any) => c.check_in_date === todayStr) || []
    const weekCheckIns = allCheckIns?.filter((c: any) => {
      const checkInDate = new Date(c.check_in_date)
      return checkInDate >= thisWeek
    }) || []
    const monthCheckIns = allCheckIns?.filter((c: any) => {
      const checkInDate = new Date(c.check_in_date)
      return checkInDate >= thisMonth
    }) || []

    // Calculate readiness distribution from all check-ins
    const readiness = {
      green: allCheckIns?.filter((c: any) => c.predicted_readiness === 'Green').length || 0,
      amber: allCheckIns?.filter((c: any) => c.predicted_readiness === 'Yellow' || c.predicted_readiness === 'Amber').length || 0,
      red: allCheckIns?.filter((c: any) => c.predicted_readiness === 'Red').length || 0,
      pending: 0,
    }

    // OPTIMIZATION: Calculate daily check-ins trend (custom date range)
    const dailyCheckInsTrend = []
    const start = new Date(startDate)
    const end = new Date(endDate)
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    
    // Limit to max 90 days for performance
    const maxDays = 90
    const actualDays = Math.min(daysDiff, maxDays)
    
    for (let i = 0; i <= actualDays; i++) {
      const date = new Date(start)
      date.setDate(date.getDate() + i)
      const dateStr = dateToDateString(date)
      
      // Skip if beyond end date
      if (dateStr > endDate) break
      
      const dayCheckIns = allCheckIns?.filter((c: any) => c.check_in_date === dateStr).length || 0
      dailyCheckInsTrend.push({
        date: dateStr,
        count: dayCheckIns,
        day: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      })
    }

    // OPTIMIZATION: Calculate user growth trend (last 6 months)
    const userGrowthTrend = []
    for (let i = 5; i >= 0; i--) {
      const date = new Date()
      date.setMonth(date.getMonth() - i)
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0)
      const monthUsers = allUsers?.filter((u: any) => {
        const userDate = new Date(u.created_at)
        return userDate >= monthStart && userDate <= monthEnd
      }).length || 0
      userGrowthTrend.push({
        month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        count: monthUsers,
      })
    }

    // Get total workers for completion rate calculation
    const totalWorkers = usersByRole.worker
    const completionRate = totalWorkers > 0 && todayCheckIns.length > 0
      ? Math.round((todayCheckIns.length / totalWorkers) * 100)
      : 0

    // Get cases statistics
    const { data: allCases } = await adminClient
      .from('cases')
      .select('id, status, is_active, start_date, end_date')

    const todayDateObj = new Date()
    todayDateObj.setHours(0, 0, 0, 0)
    const activeCases = allCases?.filter((c: any) => {
      const start = new Date(c.start_date)
      start.setHours(0, 0, 0, 0)
      const end = c.end_date ? new Date(c.end_date) : null
      if (end) end.setHours(23, 59, 59, 999)
      return c.is_active && todayDateObj >= start && (!end || todayDateObj <= end)
    }).length || 0

    const casesByStatus = {
      pending: allCases?.filter((c: any) => c.status === 'pending').length || 0,
      in_progress: allCases?.filter((c: any) => c.status === 'in_progress').length || 0,
      completed: allCases?.filter((c: any) => c.status === 'completed').length || 0,
      cancelled: allCases?.filter((c: any) => c.status === 'cancelled').length || 0,
    }

    // Get incidents statistics
    const { data: allIncidents } = await adminClient
      .from('incidents')
      .select('id, incident_type, created_at')

    const incidents = allIncidents?.filter((i: any) => i.incident_type === 'incident').length || 0
    const nearMisses = allIncidents?.filter((i: any) => i.incident_type === 'near_miss').length || 0

    const thisMonthIncidents = allIncidents?.filter((i: any) => {
      const incidentDate = new Date(i.created_at)
      return incidentDate >= thisMonth
    }).length || 0

    // Get appointments statistics
    const { data: allAppointments } = await adminClient
      .from('appointments')
      .select('id, status, appointment_date')

    const upcomingAppointments = allAppointments?.filter((a: any) => {
      return a.appointment_date >= todayStr && (a.status === 'pending' || a.status === 'confirmed')
    }).length || 0

    const completedAppointments = allAppointments?.filter((a: any) => a.status === 'completed').length || 0
    const cancelledAppointments = allAppointments?.filter((a: any) => a.status === 'cancelled').length || 0

    return c.json({
      users: {
        total: allUsers?.length || 0,
        byRole: usersByRole,
        active: activeUsers,
        inactive: (allUsers?.length || 0) - activeUsers,
        growthTrend: userGrowthTrend,
      },
      teams: {
        total: allTeams?.length || 0,
        withSupervisor: teamsWithSupervisor,
        withTeamLeader: teamsWithTeamLeader,
        totalMembers: allTeamMembers?.length || 0,
      },
      checkIns: {
        total: allCheckIns?.length || 0,
        today: todayCheckIns.length,
        thisWeek: weekCheckIns.length,
        thisMonth: monthCheckIns.length,
        completionRate,
        readiness,
        dailyTrend: dailyCheckInsTrend,
      },
      cases: {
        total: allCases?.length || 0,
        active: activeCases,
        closed: allCases?.filter((c: any) => !c.is_active).length || 0,
        byStatus: casesByStatus,
      },
      incidents: {
        total: allIncidents?.length || 0,
        incidents,
        nearMisses,
        thisMonth: thisMonthIncidents,
      },
      appointments: {
        total: allAppointments?.length || 0,
        upcoming: upcomingAppointments,
        completed: completedAppointments,
        cancelled: cancelledAppointments,
      },
    }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    })
  } catch (error: any) {
    console.error('[GET /admin/stats] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Create user account (admin only - can create any role)
admin.post('/users', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const { email, password, role, first_name, last_name, business_name, business_registration_number, gender, date_of_birth } = await c.req.json()

    // Validate required fields
    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }

    if (!first_name || !last_name) {
      return c.json({ error: 'First name and last name are required' }, 400)
    }

    // Trim whitespace
    const trimmedFirstName = first_name.trim()
    const trimmedLastName = last_name.trim()
    const trimmedEmail = email.trim().toLowerCase()

    if (!trimmedFirstName || !trimmedLastName) {
      return c.json({ error: 'First name and last name cannot be empty' }, 400)
    }

    // Validate gender
    if (gender && gender !== 'male' && gender !== 'female') {
      return c.json({ error: 'Gender must be either "male" or "female"' }, 400)
    }

    // Validate date of birth
    if (date_of_birth) {
      const birthDate = new Date(date_of_birth)
      if (isNaN(birthDate.getTime())) {
        return c.json({ error: 'Invalid date of birth format' }, 400)
      }

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (birthDate >= today) {
        return c.json({ error: 'Date of birth must be in the past' }, 400)
      }
      
      // Validate minimum age (18 years old)
      const { calculateAge } = await import('../utils/ageUtils.js')
      const age = calculateAge(date_of_birth)
      if (age === null) {
        return c.json({ error: 'Invalid date of birth' }, 400)
      }
      if (age < 18) {
        return c.json({ error: `Age must be at least 18 years old. Current age: ${age} years old` }, 400)
      }
    }

    // Validate role
    const validRoles = ['worker', 'supervisor', 'whs_control_center', 'executive', 'clinician', 'team_leader', 'admin']
    if (!role || !validRoles.includes(role)) {
      return c.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, 400)
    }

    // Supervisor-specific validation
    if (role === 'supervisor') {
      if (!business_name || typeof business_name !== 'string' || !business_name.trim()) {
        return c.json({ error: 'Business Name is required for supervisors' }, 400)
      }
      if (!business_registration_number || typeof business_registration_number !== 'string' || !business_registration_number.trim()) {
        return c.json({ error: 'Business Registration Number is required for supervisors' }, 400)
      }
    }

    if (password.length < 6) {
      return c.json({ error: 'Password must be at least 6 characters' }, 400)
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      return c.json({ error: 'Invalid email format' }, 400)
    }

    const adminClient = getAdminClient()

    // Check if user already exists
    const { data: existingUser } = await adminClient
      .from('users')
      .select('email')
      .eq('email', trimmedEmail)
      .single()

    if (existingUser) {
      return c.json({ error: 'User with this email already exists' }, 409)
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: trimmedEmail,
      password,
      email_confirm: true,
    })

    if (authError || !authData.user) {
      if (authError?.message?.includes('already registered') || 
          authError?.message?.includes('User already registered')) {
        return c.json({ error: 'User with this email already exists in auth system' }, 409)
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

    const fullName = `${trimmedFirstName} ${trimmedLastName}`.trim()
    
    const userInsertData: any = {
      id: authData.user.id,
      email: trimmedEmail,
      role: role,
      first_name: trimmedFirstName,
      last_name: trimmedLastName,
      full_name: fullName,
      password_hash: hashedPassword,
      created_at: new Date().toISOString(),
    }

    // Add gender and date_of_birth if provided
    if (gender) {
      userInsertData.gender = gender
    }
    if (date_of_birth) {
      userInsertData.date_of_birth = date_of_birth
    }

    // Add business fields for supervisors
    if (role === 'supervisor') {
      userInsertData.business_name = business_name.trim()
      userInsertData.business_registration_number = business_registration_number.trim()
    }

    // Create user record in database
    const { data: userData, error: dbError } = await adminClient
      .from('users')
      .insert([userInsertData])
      .select('id, email, role, first_name, last_name, full_name')
      .single()

    if (dbError) {
      console.error('Database insert error:', dbError)
      // If database insert fails, clean up auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      return c.json({ 
        error: 'Failed to create user record', 
        details: dbError.message 
      }, 500)
    }

    if (!userData) {
      return c.json({ error: 'Failed to create user record' }, 500)
    }

    return c.json({
      success: true,
      message: 'User account created successfully',
      user: userData,
    }, 201)
  } catch (error: any) {
    console.error('[POST /admin/users] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get all users with pagination, search, and filtering (admin only)
admin.get('/users', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1')
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
    const search = c.req.query('search') || ''
    const role = c.req.query('role') || ''
    const status = c.req.query('status') || 'all' // all, active, inactive

    if (page < 1) {
      return c.json({ error: 'Page must be >= 1' }, 400)
    }

    const adminClient = getAdminClient()
    const offset = (page - 1) * limit

    // Build query - fetch all matching users, then filter/search in memory
    // This approach avoids complex or() queries that can fail
    let allUsersQuery = adminClient
      .from('users')
      .select('id, email, role, first_name, last_name, full_name, created_at, business_name, business_registration_number', { count: 'exact' })
    
    // Apply role filter
    if (role) {
      allUsersQuery = allUsersQuery.eq('role', role)
    }

    // Apply status filter (active = created in last 30 days)
    if (status === 'active') {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      allUsersQuery = allUsersQuery.gte('created_at', thirtyDaysAgo.toISOString())
    } else if (status === 'inactive') {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      allUsersQuery = allUsersQuery.lt('created_at', thirtyDaysAgo.toISOString())
    }

    // Get all matching users first
    const { data: allMatchingUsers, error: fetchError, count } = await allUsersQuery
      .order('created_at', { ascending: false })

    if (fetchError) {
      console.error('[GET /admin/users] Error:', fetchError)
      return c.json({ error: 'Failed to fetch users', details: fetchError.message }, 500)
    }

    // Filter by search term in memory if provided
    let filteredUsers = allMatchingUsers || []
    if (search && search.trim()) {
      const searchLower = search.toLowerCase().trim()
      filteredUsers = filteredUsers.filter((user: any) => {
        const email = (user.email || '').toLowerCase()
        const firstName = (user.first_name || '').toLowerCase()
        const lastName = (user.last_name || '').toLowerCase()
        const fullName = (user.full_name || '').toLowerCase()
        return email.includes(searchLower) || 
               firstName.includes(searchLower) || 
               lastName.includes(searchLower) || 
               fullName.includes(searchLower)
      })
    }

    // Apply pagination
    const totalCount = filteredUsers.length
    const paginatedUsers = filteredUsers.slice(offset, offset + limit)
    const totalPages = Math.ceil(totalCount / limit)

    return c.json({
      users: paginatedUsers,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    }, 200)
  } catch (error: any) {
    console.error('[GET /admin/users] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get single user by ID (admin only)
admin.get('/users/:id', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const userId = c.req.param('id')
    const adminClient = getAdminClient()

    const { data: user, error } = await adminClient
      .from('users')
      .select('id, email, role, first_name, last_name, full_name, created_at, business_name, business_registration_number')
      .eq('id', userId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return c.json({ error: 'User not found' }, 404)
      }
      console.error('[GET /admin/users/:id] Error:', error)
      return c.json({ error: 'Failed to fetch user', details: error.message }, 500)
    }

    return c.json({ user }, 200)
  } catch (error: any) {
    console.error('[GET /admin/users/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update user (admin only)
admin.patch('/users/:id', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const userId = c.req.param('id')
    const { email, role, first_name, last_name, business_name, business_registration_number } = await c.req.json()
    // Note: phone is stored in team_members table, not users table

    const adminClient = getAdminClient()

    // Build update object
    const updateData: any = {}
    if (email !== undefined) updateData.email = email.trim().toLowerCase()
    if (role !== undefined) {
      const validRoles = ['worker', 'supervisor', 'whs_control_center', 'executive', 'clinician', 'team_leader', 'admin']
      if (!validRoles.includes(role)) {
        return c.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, 400)
      }
      updateData.role = role
    }
    if (first_name !== undefined) updateData.first_name = first_name.trim()
    if (last_name !== undefined) updateData.last_name = last_name.trim()
    // Note: phone is stored in team_members table, not users table
    if (business_name !== undefined) updateData.business_name = business_name?.trim() || null
    if (business_registration_number !== undefined) updateData.business_registration_number = business_registration_number?.trim() || null

    // Update full_name if first_name or last_name changed
    if (first_name !== undefined || last_name !== undefined) {
      const currentUser = await adminClient
        .from('users')
        .select('first_name, last_name')
        .eq('id', userId)
        .single()

      const updatedFirstName = first_name !== undefined ? first_name.trim() : currentUser.data?.first_name
      const updatedLastName = last_name !== undefined ? last_name.trim() : currentUser.data?.last_name

      if (updatedFirstName && updatedLastName) {
        updateData.full_name = `${updatedFirstName} ${updatedLastName}`.trim()
      } else if (updatedFirstName) {
        updateData.full_name = updatedFirstName
      } else if (updatedLastName) {
        updateData.full_name = updatedLastName
      }
    }

    const { data: updatedUser, error } = await adminClient
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select('id, email, role, first_name, last_name, full_name, created_at, business_name, business_registration_number')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return c.json({ error: 'User not found' }, 404)
      }
      console.error('[PATCH /admin/users/:id] Error:', error)
      return c.json({ error: 'Failed to update user', details: error.message }, 500)
    }

    return c.json({ user: updatedUser, message: 'User updated successfully' }, 200)
  } catch (error: any) {
    console.error('[PATCH /admin/users/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Delete user (admin only)
admin.delete('/users/:id', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const userId = c.req.param('id')
    const adminClient = getAdminClient()

    // Check if user exists
    const { data: user, error: fetchError } = await adminClient
      .from('users')
      .select('id, email')
      .eq('id', userId)
      .single()

    if (fetchError || !user) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Delete from Supabase Auth first
    const { error: authError } = await supabase.auth.admin.deleteUser(userId)
    if (authError) {
      console.error('[DELETE /admin/users/:id] Auth delete error:', authError)
      // Continue with database deletion even if auth deletion fails
    }

    // Delete from database
    const { error: dbError } = await adminClient
      .from('users')
      .delete()
      .eq('id', userId)

    if (dbError) {
      console.error('[DELETE /admin/users/:id] Database delete error:', dbError)
      return c.json({ error: 'Failed to delete user', details: dbError.message }, 500)
    }

    return c.json({ message: 'User deleted successfully' }, 200)
  } catch (error: any) {
    console.error('[DELETE /admin/users/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get all supervisors with team and worker statistics (admin only)
admin.get('/supervisors', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const adminClient = getAdminClient()

    // Get all supervisors
    const { data: supervisors, error: supervisorsError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name, business_name, business_registration_number')
      .eq('role', 'supervisor')

    if (supervisorsError) {
      console.error('[GET /admin/supervisors] Error fetching supervisors:', supervisorsError)
      return c.json({ error: 'Failed to fetch supervisors', details: supervisorsError.message }, 500)
    }

    if (!supervisors || supervisors.length === 0) {
      return c.json({ supervisors: [] })
    }

    const supervisorIds = supervisors.map((s: any) => s.id)

    // Get all teams for these supervisors
    const { data: teams, error: teamsError } = await adminClient
      .from('teams')
      .select('id, supervisor_id, team_leader_id')
      .in('supervisor_id', supervisorIds)

    if (teamsError) {
      console.error('[GET /admin/supervisors] Error fetching teams:', teamsError)
      return c.json({ error: 'Failed to fetch teams', details: teamsError.message }, 500)
    }

    // Get all team members to count workers
    const teamIds = teams?.map((t: any) => t.id) || []
    let allTeamMembers: any[] = []
    
    if (teamIds.length > 0) {
      const { data: teamMembers, error: membersError } = await adminClient
        .from('team_members')
        .select('id, team_id, user_id')
        .in('team_id', teamIds)

      if (membersError) {
        console.error('[GET /admin/supervisors] Error fetching team members:', membersError)
      } else {
        allTeamMembers = teamMembers || []
      }
    }

    // Count teams and workers per supervisor
    const supervisorStats = new Map<string, { teamsCount: number; workersCount: number; teamLeaderIds: Set<string> }>()
    
    teams?.forEach((team: any) => {
      if (!team.supervisor_id) return
      
      if (!supervisorStats.has(team.supervisor_id)) {
        supervisorStats.set(team.supervisor_id, {
          teamsCount: 0,
          workersCount: 0,
          teamLeaderIds: new Set(),
        })
      }
      
      const stats = supervisorStats.get(team.supervisor_id)!
      stats.teamsCount++
      
      if (team.team_leader_id) {
        stats.teamLeaderIds.add(team.team_leader_id)
      }
    })

    // Count workers per supervisor
    allTeamMembers.forEach((member: any) => {
      const team = teams?.find((t: any) => t.id === member.team_id)
      if (team && team.supervisor_id && supervisorStats.has(team.supervisor_id)) {
        supervisorStats.get(team.supervisor_id)!.workersCount++
      }
    })

    // Build response with supervisor details and stats
    const supervisorsWithStats = supervisors.map((supervisor: any) => {
      const stats = supervisorStats.get(supervisor.id) || { teamsCount: 0, workersCount: 0, teamLeaderIds: new Set() }
      
      return {
        id: supervisor.id,
        email: supervisor.email,
        first_name: supervisor.first_name,
        last_name: supervisor.last_name,
        full_name: supervisor.full_name || 
                   (supervisor.first_name && supervisor.last_name 
                     ? `${supervisor.first_name} ${supervisor.last_name}`
                     : supervisor.email),
        business_name: supervisor.business_name,
        business_registration_number: supervisor.business_registration_number,
        teams_count: stats.teamsCount,
        workers_count: stats.workersCount,
        team_leaders_count: stats.teamLeaderIds.size,
      }
    })

    return c.json({ supervisors: supervisorsWithStats })
  } catch (error: any) {
    console.error('[GET /admin/supervisors] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get supervisor details with team leaders and their members (admin only)
admin.get('/supervisors/:id', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const adminClient = getAdminClient()
    const supervisorId = c.req.param('id')

    // Get supervisor details
    const { data: supervisor, error: supervisorError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name, business_name, business_registration_number')
      .eq('id', supervisorId)
      .eq('role', 'supervisor')
      .single()

    if (supervisorError || !supervisor) {
      return c.json({ error: 'Supervisor not found' }, 404)
    }

    // Get all teams for this supervisor
    const { data: teams, error: teamsError } = await adminClient
      .from('teams')
      .select('id, name, site_location, team_leader_id')
      .eq('supervisor_id', supervisorId)

    if (teamsError) {
      console.error('[GET /admin/supervisors/:id] Error fetching teams:', teamsError)
      return c.json({ error: 'Failed to fetch teams', details: teamsError.message }, 500)
    }

    if (!teams || teams.length === 0) {
      return c.json({
        supervisor: {
          id: supervisor.id,
          email: supervisor.email,
          first_name: supervisor.first_name,
          last_name: supervisor.last_name,
          full_name: supervisor.full_name || 
                     (supervisor.first_name && supervisor.last_name 
                       ? `${supervisor.first_name} ${supervisor.last_name}`
                       : supervisor.email),
          business_name: supervisor.business_name,
          business_registration_number: supervisor.business_registration_number,
        },
        teams: [],
      })
    }

    const teamIds = teams.map((t: any) => t.id)
    const teamLeaderIds = teams.map((t: any) => t.team_leader_id).filter((id: string) => id)

    // Get team leaders
    let teamLeaders: any[] = []
    if (teamLeaderIds.length > 0) {
      const { data: leaders, error: leadersError } = await adminClient
        .from('users')
        .select('id, email, first_name, last_name, full_name')
        .in('id', teamLeaderIds)

      if (leadersError) {
        console.error('[GET /admin/supervisors/:id] Error fetching team leaders:', leadersError)
      } else {
        teamLeaders = leaders || []
      }
    }

    // Get all team members
    const { data: teamMembers, error: membersError } = await adminClient
      .from('team_members')
      .select('id, team_id, user_id, phone')
      .in('team_id', teamIds)

    if (membersError) {
      console.error('[GET /admin/supervisors/:id] Error fetching team members:', membersError)
    }

    // Get member user details
    const memberUserIds = (teamMembers || []).map((m: any) => m.user_id)
    let memberUsers: any[] = []
    if (memberUserIds.length > 0) {
      const { data: users, error: usersError } = await adminClient
        .from('users')
        .select('id, email, first_name, last_name, full_name')
        .in('id', memberUserIds)

      if (usersError) {
        console.error('[GET /admin/supervisors/:id] Error fetching member users:', usersError)
      } else {
        memberUsers = users || []
      }
    }

    // Create lookup maps
    const teamLeaderMap = new Map(teamLeaders.map((tl: any) => [tl.id, tl]))
    const memberUserMap = new Map(memberUsers.map((u: any) => [u.id, u]))
    const membersByTeam = new Map<string, any[]>()

    // Group members by team
    ;(teamMembers || []).forEach((member: any) => {
      if (!membersByTeam.has(member.team_id)) {
        membersByTeam.set(member.team_id, [])
      }
      const user = memberUserMap.get(member.user_id)
      membersByTeam.get(member.team_id)!.push({
        id: member.id,
        user_id: member.user_id,
        phone: member.phone,
        email: user?.email || '',
        first_name: user?.first_name || null,
        last_name: user?.last_name || null,
        full_name: user?.full_name || 
                  (user?.first_name && user?.last_name 
                    ? `${user.first_name} ${user.last_name}`
                    : user?.email || 'Unknown'),
      })
    })

    // Build teams with team leaders and members
    const teamsWithDetails = teams.map((team: any) => {
      const teamLeader = team.team_leader_id ? teamLeaderMap.get(team.team_leader_id) : null
      const members = membersByTeam.get(team.id) || []

      return {
        id: team.id,
        name: team.name,
        site_location: team.site_location,
        team_leader: teamLeader ? {
          id: teamLeader.id,
          email: teamLeader.email,
          first_name: teamLeader.first_name,
          last_name: teamLeader.last_name,
          full_name: teamLeader.full_name || 
                    (teamLeader.first_name && teamLeader.last_name 
                      ? `${teamLeader.first_name} ${teamLeader.last_name}`
                      : teamLeader.email),
        } : null,
        members,
        members_count: members.length,
      }
    })

    return c.json({
      supervisor: {
        id: supervisor.id,
        email: supervisor.email,
        first_name: supervisor.first_name,
        last_name: supervisor.last_name,
        full_name: supervisor.full_name || 
                   (supervisor.first_name && supervisor.last_name 
                     ? `${supervisor.first_name} ${supervisor.last_name}`
                     : supervisor.email),
        business_name: supervisor.business_name,
        business_registration_number: supervisor.business_registration_number,
      },
      teams: teamsWithDetails,
    })
  } catch (error: any) {
    console.error('[GET /admin/supervisors/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get all clinicians with statistics (admin only)
admin.get('/clinicians', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const adminClient = getAdminClient()

    // Get all clinicians
    const { data: clinicians, error: cliniciansError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .eq('role', 'clinician')

    if (cliniciansError) {
      console.error('[GET /admin/clinicians] Error fetching clinicians:', cliniciansError)
      return c.json({ error: 'Failed to fetch clinicians', details: cliniciansError.message }, 500)
    }

    if (!clinicians || clinicians.length === 0) {
      return c.json({ clinicians: [] })
    }

    const clinicianIds = clinicians.map((c: any) => c.id)

    // OPTIMIZATION: Fetch all data in parallel
    // Note: For admin view, we show all cases/appointments/rehab plans assigned to clinicians
    // Match the same query logic as the detail endpoint for consistency
    const [casesResult, appointmentsResult, rehabPlansResult] = await Promise.all([
      clinicianIds.length > 0
        ? adminClient
            .from('worker_exceptions')
            .select('id, clinician_id, is_active, start_date, end_date')
            .in('exception_type', MEDICAL_INCIDENT_TYPES)
            .not('clinician_id', 'is', null)
            .in('clinician_id', clinicianIds)
        : Promise.resolve({ data: [], error: null }),
      clinicianIds.length > 0
        ? adminClient
            .from('appointments')
            .select('id, clinician_id, status, appointment_date')
            .not('clinician_id', 'is', null)
            .in('clinician_id', clinicianIds)
        : Promise.resolve({ data: [], error: null }),
      clinicianIds.length > 0
        ? adminClient
            .from('rehabilitation_plans')
            .select('id, clinician_id, status')
            .not('clinician_id', 'is', null)
            .in('clinician_id', clinicianIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    const { data: allCases, error: casesError } = casesResult
    const { data: allAppointments, error: appointmentsError } = appointmentsResult
    const { data: allRehabPlans, error: rehabPlansError } = rehabPlansResult

    if (casesError) {
      console.error('[GET /admin/clinicians] Error fetching cases:', casesError)
    }
    if (appointmentsError) {
      console.error('[GET /admin/clinicians] Error fetching appointments:', appointmentsError)
    }
    if (rehabPlansError) {
      console.error('[GET /admin/clinicians] Error fetching rehabilitation plans:', rehabPlansError)
    }

    // Build statistics map
    const clinicianStats = new Map<string, {
      activeCases: number
      totalCases: number
      upcomingAppointments: number
      totalAppointments: number
      activeRehabPlans: number
      totalRehabPlans: number
    }>()

    // Initialize stats for all clinicians
    clinicians.forEach((clinician: any) => {
      clinicianStats.set(clinician.id, {
        activeCases: 0,
        totalCases: 0,
        upcomingAppointments: 0,
        totalAppointments: 0,
        activeRehabPlans: 0,
        totalRehabPlans: 0,
      })
    })

    // Count cases, appointments, and rehab plans
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    ;(allCases || []).forEach((caseItem: any) => {
      if (!caseItem?.clinician_id) return
      const stats = clinicianStats.get(caseItem.clinician_id)
      if (stats) {
        stats.totalCases++
        if (caseItem.is_active) {
          const endDate = caseItem.end_date ? new Date(caseItem.end_date) : null
          if (!endDate || endDate >= today) {
            stats.activeCases++
          }
        }
      }
    })

    ;(allAppointments || []).forEach((appointment: any) => {
      if (!appointment?.clinician_id) return
      const stats = clinicianStats.get(appointment.clinician_id)
      if (stats) {
        stats.totalAppointments++
        const appointmentDate = new Date(appointment.appointment_date)
        if (appointmentDate >= today && appointment.status !== 'cancelled' && appointment.status !== 'completed') {
          stats.upcomingAppointments++
        }
      }
    })

    ;(allRehabPlans || []).forEach((plan: any) => {
      if (!plan?.clinician_id) return
      const stats = clinicianStats.get(plan.clinician_id)
      if (stats) {
        stats.totalRehabPlans++
        if (plan.status === 'active') {
          stats.activeRehabPlans++
        }
      }
    })

    // Build response with clinician details and stats
    const cliniciansWithStats = clinicians.map((clinician: any) => {
      const stats = clinicianStats.get(clinician.id) || {
        activeCases: 0,
        totalCases: 0,
        upcomingAppointments: 0,
        totalAppointments: 0,
        activeRehabPlans: 0,
        totalRehabPlans: 0,
      }
      
      return {
        id: clinician.id,
        email: clinician.email,
        first_name: clinician.first_name,
        last_name: clinician.last_name,
        full_name: formatClinicianName(clinician),
        active_cases: stats.activeCases,
        total_cases: stats.totalCases,
        upcoming_appointments: stats.upcomingAppointments,
        total_appointments: stats.totalAppointments,
        active_rehab_plans: stats.activeRehabPlans,
        total_rehab_plans: stats.totalRehabPlans,
      }
    })

    return c.json({ clinicians: cliniciansWithStats })
  } catch (error: any) {
    console.error('[GET /admin/clinicians] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get clinician details with cases, appointments, and rehabilitation plans (admin only)
admin.get('/clinicians/:id', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const adminClient = getAdminClient()
    const clinicianId = c.req.param('id')

    // Get clinician details
    const { data: clinician, error: clinicianError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name')
      .eq('id', clinicianId)
      .eq('role', 'clinician')
      .single()

    if (clinicianError || !clinician) {
      return c.json({ error: 'Clinician not found' }, 404)
    }

    // OPTIMIZATION: Fetch all data in parallel
    // Only show exception types that are considered "incidents":
    // - accident, injury, medical_leave, other (exclude 'transfer' as it's administrative, not an incident)
    const incidentTypes = ['accident', 'injury', 'medical_leave', 'other']
    
    const [casesResult, appointmentsResult, rehabPlansResult] = await Promise.all([
      adminClient
        .from('worker_exceptions')
        .select(`
          id,
          exception_type,
          reason,
          start_date,
          end_date,
          is_active,
          created_at,
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
        .in('exception_type', incidentTypes)
        .not('clinician_id', 'is', null)
        .eq('clinician_id', clinicianId)
        .order('created_at', { ascending: false }),
      adminClient
        .from('appointments')
        .select(`
          id,
          appointment_date,
          appointment_time,
          duration_minutes,
          status,
          appointment_type,
          location,
          notes,
          created_at,
          users!appointments_worker_id_fkey(
            id,
            email,
            first_name,
            last_name,
            full_name
          ),
          worker_exceptions!appointments_case_id_fkey(
            id,
            exception_type,
            reason
          )
        `)
        .eq('clinician_id', clinicianId)
        .order('appointment_date', { ascending: false })
        .order('appointment_time', { ascending: false }),
      adminClient
        .from('rehabilitation_plans')
        .select(`
          id,
          plan_name,
          start_date,
          end_date,
          status,
          notes,
          created_at,
          worker_exceptions!rehabilitation_plans_exception_id_fkey(
            id,
            exception_type,
            reason,
            users!worker_exceptions_user_id_fkey(
              id,
              email,
              first_name,
              last_name,
              full_name
            )
          )
        `)
        .eq('clinician_id', clinicianId)
        .order('created_at', { ascending: false }),
    ])

    const { data: cases, error: casesError } = casesResult
    const { data: appointments, error: appointmentsError } = appointmentsResult
    const { data: rehabPlans, error: rehabPlansError } = rehabPlansResult

    if (casesError) {
      console.error('[GET /admin/clinicians/:id] Error fetching cases:', casesError)
    }
    if (appointmentsError) {
      console.error('[GET /admin/clinicians/:id] Error fetching appointments:', appointmentsError)
    }
    if (rehabPlansError) {
      console.error('[GET /admin/clinicians/:id] Error fetching rehabilitation plans:', rehabPlansError)
    }

    return c.json({
      clinician: {
        id: clinician.id,
        email: clinician.email,
        first_name: clinician.first_name,
        last_name: clinician.last_name,
        full_name: formatClinicianName(clinician),
      },
      cases: cases || [],
      appointments: appointments || [],
      rehabilitation_plans: rehabPlans || [],
    })
  } catch (error: any) {
    console.error('[GET /admin/clinicians/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

export default admin

