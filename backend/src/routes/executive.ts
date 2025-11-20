/**
 * Executive Routes
 * Handles user creation for supervisors, clinicians, and WHS control center
 * Only executives can access these endpoints
 */

import { Hono } from 'hono'
import bcrypt from 'bcrypt'
import { authMiddleware, requireRole } from '../middleware/auth.js'
import { createUserAccount, CreateUserInput } from '../utils/userCreation.js'
import { getAdminClient } from '../utils/adminClient.js'
import { supabase } from '../lib/supabase.js'
import { getExecutiveBusinessInfo } from '../utils/executiveHelpers.js'
import { getTodayDateString, getStartOfWeekDateString } from '../utils/dateUtils.js'
import { isExceptionActive } from '../utils/exceptionUtils.js'
import { formatUserFullName } from '../utils/userUtils.js'

const executive = new Hono()

// Constants for executive-managed roles (centralized to avoid duplication)
const EXECUTIVE_MANAGED_ROLES = ['supervisor', 'clinician', 'whs_control_center'] as const
// Roles that executives can assign (includes team_leader and worker for hierarchy management)
const EXECUTIVE_ASSIGNABLE_ROLES = [...EXECUTIVE_MANAGED_ROLES, 'team_leader', 'worker'] as const

/**
 * Create user account (executive only)
 * Executives can create: supervisor, clinician, whs_control_center
 * Users automatically inherit executive's business_name and business_registration_number
 */
executive.post('/users', authMiddleware, requireRole(['executive']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { email, password, role, first_name, last_name } = await c.req.json()

    // Validate that executive can only create specific roles
    if (!role || !EXECUTIVE_MANAGED_ROLES.includes(role as any)) {
      return c.json({ 
        error: `Invalid role. Executives can only create: ${EXECUTIVE_MANAGED_ROLES.join(', ')}` 
      }, 400)
    }

    // Get executive's business information to inherit (using helper function)
    const { data: executiveData, error: executiveError } = await getExecutiveBusinessInfo(user.id)

    if (executiveError || !executiveData) {
      console.error('Error fetching executive data:', executiveError)
      return c.json({ error: 'Failed to fetch executive data', details: executiveError || 'Executive business info not found' }, 500)
    }

    // Validate executive has business info (required for all users, especially supervisors)
    if (!executiveData.business_name || !executiveData.business_registration_number) {
      return c.json({ 
        error: 'Executive must have business name and business registration number set before creating users' 
      }, 400)
    }

    // Prepare user input - automatically inherit business info from executive
    // This ensures all users (supervisors, clinicians, whs_control_center) have the same business info as the executive
    // For supervisors, business_name and business_registration_number are REQUIRED and will be automatically inherited
    const userInput: CreateUserInput = {
      email,
      password,
      role,
      first_name,
      last_name,
      business_name: executiveData.business_name, // Automatically inherited from executive
      business_registration_number: executiveData.business_registration_number, // Automatically inherited from executive
    }

    // Create user using centralized function
    const result = await createUserAccount(userInput)

    if (!result.success) {
      return c.json({ 
        error: result.error,
        details: result.details 
      }, result.error?.includes('already exists') ? 409 : 400)
    }

    return c.json({
      success: true,
      message: 'User account created successfully',
      user: result.user,
    }, 201)
  } catch (error: any) {
    console.error('[POST /executive/users] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

/**
 * Get all users created by this executive (supervisors, clinicians, whs_control_center)
 * Only returns users with the same business_name and business_registration_number as the executive
 */
executive.get('/users', authMiddleware, requireRole(['executive']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // Get executive's business information to filter by (using helper function)
    const { data: executiveData, error: executiveError } = await getExecutiveBusinessInfo(user.id)

    if (executiveError || !executiveData) {
      console.error('Error fetching executive data:', executiveError)
      return c.json({ error: 'Failed to fetch executive data', details: executiveError || 'Executive business info not found' }, 500)
    }

    // If executive doesn't have business info, return empty list
    if (!executiveData.business_name || !executiveData.business_registration_number) {
      return c.json({
        success: true,
        users: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0,
        },
      })
    }

    // Get query parameters for filtering
    const role = c.req.query('role') // Optional: filter by role
    const search = c.req.query('search') // Optional: search by name or email
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = (page - 1) * limit

    // Build query - only get users with matching business info
    let query = adminClient
      .from('users')
      .select('id, email, role, first_name, last_name, full_name, business_name, business_registration_number, created_at', { count: 'exact' })
      .in('role', EXECUTIVE_MANAGED_ROLES)
      .eq('business_name', executiveData.business_name) // Filter by matching business name
      .eq('business_registration_number', executiveData.business_registration_number) // Filter by matching business registration number

    // Apply role filter if provided
    if (role && EXECUTIVE_MANAGED_ROLES.includes(role as any)) {
      query = query.eq('role', role)
    }

    // Apply search filter if provided
    if (search) {
      const searchTerm = `%${search}%`
      query = query.or(`first_name.ilike.${searchTerm},last_name.ilike.${searchTerm},email.ilike.${searchTerm},full_name.ilike.${searchTerm}`)
    }

    // Apply pagination
    query = query.order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data: users, error, count } = await query

    if (error) {
      console.error('Error fetching users:', error)
      return c.json({ error: 'Failed to fetch users', details: error.message }, 500)
    }

    return c.json({
      success: true,
      users: users || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    })
  } catch (error: any) {
    console.error('[GET /executive/users] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

/**
 * Get user statistics
 * Only counts users with the same business_name and business_registration_number as the executive
 */
executive.get('/stats', authMiddleware, requireRole(['executive']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Get executive's business information to filter by (using helper function)
    const { getExecutiveBusinessInfo } = await import('../utils/executiveHelpers.js')
    const { data: executiveData, error: executiveError } = await getExecutiveBusinessInfo(user.id)

    if (executiveError || !executiveData) {
      console.error('Error fetching executive data:', executiveError)
      return c.json({ error: 'Failed to fetch executive data', details: executiveError || 'Executive business info not found' }, 500)
    }

    // If executive doesn't have business info, return zero stats
    if (!executiveData.business_name || !executiveData.business_registration_number) {
      return c.json({
        success: true,
        stats: {
          supervisor: 0,
          clinician: 0,
          whs_control_center: 0,
          total: 0,
        },
      })
    }

    // Get counts by role - only users with matching business info
    const adminClient = getAdminClient()
    const { data: allUsers } = await adminClient
      .from('users')
      .select('role')
      .in('role', EXECUTIVE_MANAGED_ROLES)
      .eq('business_name', executiveData.business_name)
      .eq('business_registration_number', executiveData.business_registration_number)

    const stats = {
      supervisor: 0,
      clinician: 0,
      whs_control_center: 0,
      total: 0,
    }

    allUsers?.forEach((user: any) => {
      if (user.role && stats.hasOwnProperty(user.role)) {
        stats[user.role as keyof typeof stats]++
        stats.total++
      }
    })

    return c.json({
      success: true,
      stats,
    })
  } catch (error: any) {
    console.error('[GET /executive/stats] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

/**
 * Get single user by ID (executive only)
 * Only returns user if they have the same business_name and business_registration_number as the executive
 */
executive.get('/users/:id', authMiddleware, requireRole(['executive']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const userId = c.req.param('id')
    const adminClient = getAdminClient()

    // Get executive's business information (using helper function)
    const { data: executiveData, error: executiveError } = await getExecutiveBusinessInfo(user.id)

    if (executiveError || !executiveData) {
      return c.json({ error: 'Failed to fetch executive data', details: executiveError || 'Executive business info not found' }, 500)
    }

    // If executive doesn't have business info, deny access
    if (!executiveData.business_name || !executiveData.business_registration_number) {
      return c.json({ error: 'User not found or access denied' }, 404)
    }

    const { data: targetUser, error } = await adminClient
      .from('users')
      .select('id, email, role, first_name, last_name, full_name, created_at, business_name, business_registration_number')
      .eq('id', userId)
      .in('role', EXECUTIVE_MANAGED_ROLES)
      .eq('business_name', executiveData.business_name)
      .eq('business_registration_number', executiveData.business_registration_number)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return c.json({ error: 'User not found' }, 404)
      }
      console.error('[GET /executive/users/:id] Error:', error)
      return c.json({ error: 'Failed to fetch user', details: error.message }, 500)
    }

    if (!targetUser) {
      return c.json({ error: 'User not found or access denied' }, 404)
    }

    return c.json({ success: true, user: targetUser }, 200)
  } catch (error: any) {
    console.error('[GET /executive/users/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

/**
 * Update user (executive only)
 * Can update: email, role, first_name, last_name, password
 * Business info cannot be changed (inherited from executive)
 */
executive.patch('/users/:id', authMiddleware, requireRole(['executive']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const userId = c.req.param('id')
    const { email, role, first_name, last_name, password } = await c.req.json()

    const adminClient = getAdminClient()

    // Get executive's business information (using helper function)
    const { getExecutiveBusinessInfo } = await import('../utils/executiveHelpers.js')
    const { data: executiveData, error: executiveError } = await getExecutiveBusinessInfo(user.id)

    if (executiveError || !executiveData) {
      return c.json({ error: 'Failed to fetch executive data', details: executiveError || 'Executive business info not found' }, 500)
    }

    // Verify user exists, is in allowed roles, and has matching business info
    const { data: currentUser, error: fetchError } = await adminClient
      .from('users')
      .select('id, role, first_name, last_name')
      .eq('id', userId)
      .in('role', EXECUTIVE_MANAGED_ROLES)
      .eq('business_name', executiveData.business_name)
      .eq('business_registration_number', executiveData.business_registration_number)
      .single()

    if (fetchError || !currentUser) {
      return c.json({ error: 'User not found or access denied' }, 404)
    }

    // Build update object
    const updateData: any = {}
    
    if (email !== undefined) {
      const trimmedEmail = email.trim().toLowerCase()
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(trimmedEmail)) {
        return c.json({ error: 'Invalid email format' }, 400)
      }
      updateData.email = trimmedEmail
    }

    if (role !== undefined) {
      if (!EXECUTIVE_MANAGED_ROLES.includes(role as any)) {
        return c.json({ error: `Invalid role. Executives can only assign: ${EXECUTIVE_MANAGED_ROLES.join(', ')}` }, 400)
      }
      updateData.role = role
    }

    if (first_name !== undefined) updateData.first_name = first_name.trim()
    if (last_name !== undefined) updateData.last_name = last_name.trim()
    
    // Business info cannot be changed - it's inherited from executive
    // Always keep the executive's business info
    updateData.business_name = executiveData.business_name
    updateData.business_registration_number = executiveData.business_registration_number

    // Update password if provided
    if (password !== undefined && password.trim()) {
      if (password.length < 6) {
        return c.json({ error: 'Password must be at least 6 characters' }, 400)
      }
      const saltRounds = 10
      updateData.password_hash = await bcrypt.hash(password, saltRounds)
      
      // Also update in Supabase Auth
      try {
        await supabase.auth.admin.updateUserById(userId, {
          password: password,
        })
      } catch (authError: any) {
        console.error('Error updating password in auth:', authError)
        // Continue with database update even if auth update fails
      }
    }

    // Update full_name if first_name or last_name changed
    if (first_name !== undefined || last_name !== undefined) {
      const updatedFirstName = first_name !== undefined ? first_name.trim() : currentUser.first_name
      const updatedLastName = last_name !== undefined ? last_name.trim() : currentUser.last_name

      if (updatedFirstName && updatedLastName) {
        updateData.full_name = `${updatedFirstName} ${updatedLastName}`.trim()
      } else if (updatedFirstName) {
        updateData.full_name = updatedFirstName
      } else if (updatedLastName) {
        updateData.full_name = updatedLastName
      }
    }

    updateData.updated_at = new Date().toISOString()

    const { data: updatedUser, error } = await adminClient
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select('id, email, role, first_name, last_name, full_name, created_at, business_name, business_registration_number')
      .single()

    if (error) {
      console.error('[PATCH /executive/users/:id] Error:', error)
      return c.json({ error: 'Failed to update user', details: error.message }, 500)
    }

    return c.json({ success: true, user: updatedUser, message: 'User updated successfully' }, 200)
  } catch (error: any) {
    console.error('[PATCH /executive/users/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

/**
 * Delete user (executive only)
 * Only allows deletion of users with matching business info
 */
executive.delete('/users/:id', authMiddleware, requireRole(['executive']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const userId = c.req.param('id')
    const adminClient = getAdminClient()

    // Get executive's business information (using helper function)
    const { data: executiveData, error: executiveError } = await getExecutiveBusinessInfo(user.id)

    if (executiveError || !executiveData) {
      return c.json({ error: 'Failed to fetch executive data', details: executiveError || 'Executive business info not found' }, 500)
    }

    // Check if user exists, is in allowed roles, and has matching business info
    const { data: targetUser, error: fetchError } = await adminClient
      .from('users')
      .select('id, email, role')
      .eq('id', userId)
      .in('role', EXECUTIVE_MANAGED_ROLES)
      .eq('business_name', executiveData.business_name)
      .eq('business_registration_number', executiveData.business_registration_number)
      .single()

    if (fetchError || !targetUser) {
      return c.json({ error: 'User not found or access denied' }, 404)
    }

    // Delete from Supabase Auth first
    const { error: authError } = await supabase.auth.admin.deleteUser(targetUser.id)
    if (authError) {
      console.error('[DELETE /executive/users/:id] Auth delete error:', authError)
      // Continue with database deletion even if auth deletion fails
    }

    // Delete from database
    const { error: dbError } = await adminClient
      .from('users')
      .delete()
      .eq('id', targetUser.id)

    if (dbError) {
      console.error('[DELETE /executive/users/:id] Database delete error:', dbError)
      return c.json({ error: 'Failed to delete user', details: dbError.message }, 500)
    }

    return c.json({ success: true, message: 'User deleted successfully' }, 200)
  } catch (error: any) {
    console.error('[DELETE /executive/users/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

/**
 * Helper function to return empty safety engagement response
 */
const getEmptySafetyEngagementResponse = (startDate?: string, endDate?: string) => ({
  success: true,
  overallSafetyEngagement: 0,
  checkInCompletion: 0,
  readinessBreakdown: {
    green: 0,
    amber: 0,
    red: 0,
    pending: 0,
  },
  totalWorkers: 0,
  activeWorkers: 0,
  period: {
    startDate: startDate || getStartOfWeekDateString(),
    endDate: endDate || getTodayDateString(),
  },
  dailyTrends: [],
})

/**
 * Get Overall Safety Engagement (Work Readiness)
 * Calculates work readiness percentage based on check-ins for all workers under executive's business
 * SECURITY: Only returns data for workers under the executive's business (filtered by business_name and business_registration_number)
 */
executive.get('/safety-engagement', authMiddleware, requireRole(['executive']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // Get executive's business information
    const { data: executiveData, error: executiveError } = await getExecutiveBusinessInfo(user.id)

    if (executiveError || !executiveData) {
      console.error('[GET /executive/safety-engagement] Error fetching executive data:', executiveError)
      return c.json({ error: 'Failed to fetch executive data', details: executiveError || 'Executive business info not found' }, 500)
    }

    // If executive doesn't have business info, return empty data
    if (!executiveData.business_name || !executiveData.business_registration_number) {
      return c.json(getEmptySafetyEngagementResponse())
    }

    // Get all teams under supervisors with matching business info
    const { data: supervisors } = await adminClient
      .from('users')
      .select('id')
      .eq('role', 'supervisor')
      .eq('business_name', executiveData.business_name)
      .eq('business_registration_number', executiveData.business_registration_number)

    if (!supervisors || supervisors.length === 0) {
      return c.json(getEmptySafetyEngagementResponse())
    }

    const supervisorIds = supervisors.map(s => s.id)

    // Get all teams assigned to these supervisors
    const { data: teams } = await adminClient
      .from('teams')
      .select('id')
      .in('supervisor_id', supervisorIds)

    if (!teams || teams.length === 0) {
      return c.json(getEmptySafetyEngagementResponse())
    }

    const teamIds = teams.map(t => t.id)

    // Get all workers from these teams
    const { data: teamMembers } = await adminClient
      .from('team_members')
      .select('user_id')
      .in('team_id', teamIds)

    if (!teamMembers || teamMembers.length === 0) {
      return c.json(getEmptySafetyEngagementResponse())
    }

    const workerIds = Array.from(new Set(teamMembers.map(m => m.user_id)))

    // Get date range from query parameters or use defaults (this week)
    const queryStartDate = c.req.query('startDate')
    const queryEndDate = c.req.query('endDate')

    // Validate date format if provided (SECURITY: Prevent injection attacks)
    const isValidDateString = (dateStr: string): boolean => {
      if (!dateStr || typeof dateStr !== 'string') return false
      // Strict format validation: YYYY-MM-DD only
      const matchesFormat = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
      if (!matchesFormat) return false
      const date = new Date(dateStr)
      // Check if date is valid and matches the input string (prevents date manipulation)
      const isValid = !isNaN(date.getTime()) && dateStr === date.toISOString().split('T')[0]
      return isValid
    }

    // Use provided dates or defaults
    let startDate = queryStartDate && isValidDateString(queryStartDate) 
      ? queryStartDate 
      : getStartOfWeekDateString()
    let endDate = queryEndDate && isValidDateString(queryEndDate) 
      ? queryEndDate 
      : getTodayDateString()

    // Validate date range (SECURITY: Prevent invalid ranges)
    if (startDate > endDate) {
      return c.json({ error: 'Invalid date range: start date must be before or equal to end date' }, 400)
    }

    // Ensure end date is not in the future (SECURITY: Prevent future date queries)
    const todayStr = getTodayDateString()
    const finalEndDate = endDate > todayStr ? todayStr : endDate

    // Limit date range to prevent excessive queries (SECURITY: Prevent DoS via large date ranges)
    const startDateObj = new Date(startDate)
    const endDateObj = new Date(finalEndDate)
    const daysDiff = Math.ceil((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24))
    const MAX_DATE_RANGE_DAYS = 365 // Maximum 1 year range
    
    if (daysDiff > MAX_DATE_RANGE_DAYS) {
      return c.json({ error: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days` }, 400)
    }

    // Prevent dates too far in the past (SECURITY: Prevent excessive data queries)
    const MIN_DATE = '2020-01-01' // Minimum allowed date
    if (startDate < MIN_DATE) {
      return c.json({ error: `Start date cannot be before ${MIN_DATE}` }, 400)
    }

    // Get all check-ins for the specified date range
    const { data: checkIns } = await adminClient
      .from('daily_checkins')
      .select('user_id, check_in_date, predicted_readiness')
      .in('user_id', workerIds)
      .gte('check_in_date', startDate)
      .lte('check_in_date', finalEndDate)

    // Get all exceptions for these workers
    const { data: exceptions } = await adminClient
      .from('worker_exceptions')
      .select('user_id, exception_type, start_date, end_date, is_active, deactivated_at')
      .in('user_id', workerIds)

    // Get latest check-in per worker (most recent readiness status)
    const workerLatestCheckIn = new Map<string, { readiness: string; date: string }>()

    if (checkIns) {
      checkIns.forEach((checkIn: any) => {
        const workerId = checkIn.user_id
        const existing = workerLatestCheckIn.get(workerId)
        
        // Keep the latest check-in for each worker
        if (!existing || checkIn.check_in_date > existing.date) {
          // Check if worker had exception on this date
          const workerExceptions = exceptions?.filter((e: any) => e.user_id === workerId) || []
          const hasExceptionOnDate = workerExceptions.some((e: any) => isExceptionActive(e, new Date(checkIn.check_in_date)))
          
          // Only count check-ins from workers without exceptions
          if (!hasExceptionOnDate) {
            workerLatestCheckIn.set(workerId, {
              readiness: checkIn.predicted_readiness,
              date: checkIn.check_in_date,
            })
          }
        }
      })
    }

    // Filter workers with active exceptions during the date range (exclude from readiness calculation)
    // A worker is considered to have an active exception if they have an exception that overlaps with the selected date range
    const workersWithActiveExceptions = new Set<string>()
    if (exceptions) {
      const startDateObj = new Date(startDate)
      const endDateObj = new Date(finalEndDate)
      
      exceptions.forEach((exception: any) => {
        // Check if exception overlaps with the selected date range
        const exceptionStart = exception.start_date ? new Date(exception.start_date) : null
        const exceptionEnd = exception.end_date ? new Date(exception.end_date) : null
        
        // Exception is active if:
        // 1. It has no end date (ongoing) and started before or during the range
        // 2. It overlaps with the selected date range
        let isActiveInRange = false
        
        if (exception.is_active && !exception.deactivated_at) {
          if (!exceptionEnd) {
            // No end date - check if it started before or during the range
            if (exceptionStart && exceptionStart <= endDateObj) {
              isActiveInRange = true
            }
          } else {
            // Has end date - check for overlap
            if (exceptionStart && exceptionEnd) {
              // Overlap exists if: exception starts before range ends AND exception ends after range starts
              isActiveInRange = exceptionStart <= endDateObj && exceptionEnd >= startDateObj
            }
          }
        }
        
        if (isActiveInRange) {
          workersWithActiveExceptions.add(exception.user_id)
        }
      })
    }

    // Count workers by readiness status
    let greenWorkers = 0
    let amberWorkers = 0
    let redWorkers = 0
    let pendingWorkers = 0

    workerIds.forEach((workerId) => {
      // Skip workers with active exceptions
      if (workersWithActiveExceptions.has(workerId)) {
        return
      }

      const latestCheckIn = workerLatestCheckIn.get(workerId)
      if (latestCheckIn) {
        const readiness = latestCheckIn.readiness
        if (readiness === 'Green') {
          greenWorkers++
        } else if (readiness === 'Yellow' || readiness === 'Amber') {
          amberWorkers++
        } else if (readiness === 'Red') {
          redWorkers++
        } else {
          pendingWorkers++
        }
      } else {
        pendingWorkers++
      }
    })

    const activeWorkers = workerIds.filter(id => !workersWithActiveExceptions.has(id)).length
    const workersWithReadiness = greenWorkers + amberWorkers + redWorkers

    // Calculate overall safety engagement (work readiness percentage)
    // Formula: (Green workers * 100% + Amber workers * 50% + Red workers * 0%) / Total active workers
    const overallSafetyEngagement = activeWorkers > 0
      ? Math.round(((greenWorkers * 100 + amberWorkers * 50 + redWorkers * 0) / activeWorkers))
      : 0

    // Calculate check-in completion rate
    const checkInCompletion = activeWorkers > 0
      ? Math.round((workersWithReadiness / activeWorkers) * 100)
      : 0

    // Calculate daily trends for chart (daily safety engagement over the date range)
    const dailyTrends: Array<{ date: string; engagement: number }> = []
    const trendStartDate = new Date(startDate)
    const trendEndDate = new Date(finalEndDate)
    
    // Generate date range
    const currentDate = new Date(trendStartDate)
    while (currentDate <= trendEndDate) {
      const dateStr = currentDate.toISOString().split('T')[0]
      
      // Get check-ins for this specific date
      const dayCheckIns = checkIns?.filter((ci: any) => ci.check_in_date === dateStr) || []
      
      // Get workers with exceptions on this date
      const workersWithExceptionsOnDate = new Set<string>()
      if (exceptions) {
        exceptions.forEach((exception: any) => {
          if (!exception.is_active || exception.deactivated_at) return
          
          const exceptionStart = exception.start_date ? new Date(exception.start_date) : null
          const exceptionEnd = exception.end_date ? new Date(exception.end_date) : null
          const checkDate = new Date(dateStr)
          
          let hasException = false
          if (!exceptionEnd) {
            if (exceptionStart && exceptionStart <= checkDate) {
              hasException = true
            }
          } else {
            if (exceptionStart && exceptionEnd) {
              hasException = exceptionStart <= checkDate && exceptionEnd >= checkDate
            }
          }
          
          if (hasException) {
            workersWithExceptionsOnDate.add(exception.user_id)
          }
        })
      }
      
      // Calculate daily engagement for this date
      const dayActiveWorkers = workerIds.filter(id => !workersWithExceptionsOnDate.has(id))
      const dayWorkerReadiness = new Map<string, string>()
      
      dayCheckIns.forEach((checkIn: any) => {
        if (workersWithExceptionsOnDate.has(checkIn.user_id)) return
        
        const existing = dayWorkerReadiness.get(checkIn.user_id)
        if (!existing || checkIn.check_in_date > existing) {
          dayWorkerReadiness.set(checkIn.user_id, checkIn.predicted_readiness)
        }
      })
      
      let dayGreen = 0
      let dayAmber = 0
      let dayRed = 0
      
      dayWorkerReadiness.forEach((readiness) => {
        if (readiness === 'Green') dayGreen++
        else if (readiness === 'Yellow' || readiness === 'Amber') dayAmber++
        else if (readiness === 'Red') dayRed++
      })
      
      const dayEngagement = dayActiveWorkers.length > 0
        ? Math.round(((dayGreen * 100 + dayAmber * 50 + dayRed * 0) / dayActiveWorkers.length))
        : 0
      
      dailyTrends.push({
        date: dateStr,
        engagement: dayEngagement,
      })
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1)
    }

    return c.json({
      success: true,
      overallSafetyEngagement,
      checkInCompletion,
      readinessBreakdown: {
        green: greenWorkers,
        amber: amberWorkers,
        red: redWorkers,
        pending: pendingWorkers,
      },
      totalWorkers: workerIds.length,
      activeWorkers,
      period: {
        startDate,
        endDate: finalEndDate,
      },
      dailyTrends,
    })
  } catch (error: any) {
    console.error('[GET /executive/safety-engagement] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get all supervisors with hierarchy (executive only)
// Shows supervisors -> team leaders -> workers under executive's business
executive.get('/hierarchy', authMiddleware, requireRole(['executive']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // Get executive's business information
    const { data: executiveData, error: executiveError } = await getExecutiveBusinessInfo(user.id)

    if (executiveError || !executiveData) {
      return c.json({ error: 'Failed to fetch executive data', details: executiveError || 'Executive business info not found' }, 500)
    }

    // Get all supervisors with matching business info
    const { data: supervisors, error: supervisorsError } = await adminClient
      .from('users')
      .select('id, email, first_name, last_name, full_name, role')
      .eq('role', 'supervisor')
      .eq('business_name', executiveData.business_name)
      .eq('business_registration_number', executiveData.business_registration_number)

    if (supervisorsError) {
      console.error('[GET /executive/hierarchy] Error fetching supervisors:', supervisorsError)
      return c.json({ error: 'Failed to fetch supervisors', details: supervisorsError.message }, 500)
    }

    if (!supervisors || supervisors.length === 0) {
      return c.json({ supervisors: [] })
    }

    const supervisorIds = supervisors.map((s: any) => s.id)

    // Get all teams for these supervisors
    const { data: teams, error: teamsError } = await adminClient
      .from('teams')
      .select('id, name, site_location, supervisor_id, team_leader_id')
      .in('supervisor_id', supervisorIds)

    if (teamsError) {
      console.error('[GET /executive/hierarchy] Error fetching teams:', teamsError)
      return c.json({ error: 'Failed to fetch teams', details: teamsError.message }, 500)
    }

    const teamIds = teams?.map((t: any) => t.id) || []
    const teamLeaderIds = teams?.map((t: any) => t.team_leader_id).filter((id: string) => id) || []

    // Get team leaders
    let teamLeaders: any[] = []
    if (teamLeaderIds.length > 0) {
      const { data: leaders, error: leadersError } = await adminClient
        .from('users')
        .select('id, email, first_name, last_name, full_name, role')
        .in('id', teamLeaderIds)

      if (leadersError) {
        console.error('[GET /executive/hierarchy] Error fetching team leaders:', leadersError)
      } else {
        teamLeaders = leaders || []
      }
    }

    // Get all team members (workers)
    let teamMembers: any[] = []
    if (teamIds.length > 0) {
      const { data: members, error: membersError } = await adminClient
        .from('team_members')
        .select('id, team_id, user_id')
        .in('team_id', teamIds)

      if (membersError) {
        console.error('[GET /executive/hierarchy] Error fetching team members:', membersError)
      } else {
        teamMembers = members || []
      }
    }

    // Get worker user details
    const workerIds = Array.from(new Set(teamMembers.map((m: any) => m.user_id)))
    let workers: any[] = []
    if (workerIds.length > 0) {
      const { data: workerUsers, error: workersError } = await adminClient
        .from('users')
        .select('id, email, first_name, last_name, full_name, role')
        .in('id', workerIds)

      if (workersError) {
        console.error('[GET /executive/hierarchy] Error fetching workers:', workersError)
      } else {
        workers = workerUsers || []
      }
    }

    // Build hierarchy structure
    const teamLeaderMap = new Map(teamLeaders.map((tl: any) => [tl.id, tl]))
    const workerMap = new Map(workers.map((w: any) => [w.id, w]))
    const membersByTeam = new Map<string, any[]>()
    const teamsBySupervisor = new Map<string, any[]>()

    // Group members by team
    teamMembers.forEach((member: any) => {
      if (!membersByTeam.has(member.team_id)) {
        membersByTeam.set(member.team_id, [])
      }
      const worker = workerMap.get(member.user_id)
      if (worker) {
        membersByTeam.get(member.team_id)!.push({
          id: worker.id,
          email: worker.email,
          first_name: worker.first_name,
          last_name: worker.last_name,
          full_name: formatUserFullName(worker),
          role: worker.role,
        })
      }
    })

    // Group teams by supervisor
    teams?.forEach((team: any) => {
      if (!team.supervisor_id) return
      
      if (!teamsBySupervisor.has(team.supervisor_id)) {
        teamsBySupervisor.set(team.supervisor_id, [])
      }
      
      const teamLeader = team.team_leader_id ? teamLeaderMap.get(team.team_leader_id) : null
      const members = membersByTeam.get(team.id) || []
      
      teamsBySupervisor.get(team.supervisor_id)!.push({
        id: team.id,
        name: team.name,
        site_location: team.site_location,
        team_leader: teamLeader ? {
          id: teamLeader.id,
          email: teamLeader.email,
          first_name: teamLeader.first_name,
          last_name: teamLeader.last_name,
          full_name: formatUserFullName(teamLeader),
          role: teamLeader.role,
        } : null,
        workers: members,
        workers_count: members.length,
      })
    })

    // Build response
    const supervisorsWithHierarchy = supervisors.map((supervisor: any) => {
      const teams = teamsBySupervisor.get(supervisor.id) || []
      const totalWorkers = teams.reduce((sum, team) => sum + team.workers_count, 0)
      const totalTeamLeaders = teams.filter(t => t.team_leader).length

      return {
        id: supervisor.id,
        email: supervisor.email,
        first_name: supervisor.first_name,
        last_name: supervisor.last_name,
        full_name: formatUserFullName(supervisor),
        role: supervisor.role,
        teams_count: teams.length,
        team_leaders_count: totalTeamLeaders,
        workers_count: totalWorkers,
        teams,
      }
    })

    return c.json({ supervisors: supervisorsWithHierarchy })
  } catch (error: any) {
    console.error('[GET /executive/hierarchy] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update user role (executive only)
// Allows executive to change roles of users under their business
executive.patch('/users/:id/role', authMiddleware, requireRole(['executive']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const userId = c.req.param('id')
    const { role } = await c.req.json()

    if (!role) {
      return c.json({ error: 'Role is required' }, 400)
    }

    // Allowed roles for executive to assign (uses centralized constant)
    if (!EXECUTIVE_ASSIGNABLE_ROLES.includes(role as any)) {
      return c.json({ error: `Invalid role. Allowed roles: ${EXECUTIVE_ASSIGNABLE_ROLES.join(', ')}` }, 400)
    }

    const adminClient = getAdminClient()

    // Get executive's business information
    const { data: executiveData, error: executiveError } = await getExecutiveBusinessInfo(user.id)

    if (executiveError || !executiveData) {
      return c.json({ error: 'Failed to fetch executive data', details: executiveError || 'Executive business info not found' }, 500)
    }

    // Verify user exists and has matching business info
    const { data: targetUser, error: fetchError } = await adminClient
      .from('users')
      .select('id, email, role, first_name, last_name, full_name, business_name, business_registration_number')
      .eq('id', userId)
      .eq('business_name', executiveData.business_name)
      .eq('business_registration_number', executiveData.business_registration_number)
      .single()

    if (fetchError || !targetUser) {
      return c.json({ error: 'User not found or access denied' }, 404)
    }

    // Prevent changing own role
    if (userId === user.id) {
      return c.json({ error: 'Cannot change your own role' }, 400)
    }

    // Update role
    const { data: updatedUser, error: updateError } = await adminClient
      .from('users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, email, role, first_name, last_name, full_name, business_name, business_registration_number')
      .single()

    if (updateError) {
      console.error('[PATCH /executive/users/:id/role] Error:', updateError)
      return c.json({ error: 'Failed to update user role', details: updateError.message }, 500)
    }

    return c.json({ success: true, user: updatedUser, message: 'User role updated successfully' }, 200)
  } catch (error: any) {
    console.error('[PATCH /executive/users/:id/role] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

export default executive

