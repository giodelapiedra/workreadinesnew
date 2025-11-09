import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { authMiddleware, requireRole, AuthVariables } from '../middleware/auth'
import { getAdminClient } from '../utils/adminClient'

const schedules = new Hono<{ Variables: AuthVariables }>()

// ============================================
// Worker Schedules Endpoints
// Team Leaders can create/manage schedules for workers in their team
// ============================================

// Get worker schedules (Team Leader views schedules for workers in their team)
schedules.get('/workers', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()
    
    // Get team leader's team
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('id')
      .eq('team_leader_id', user.id)
      .single()

    if (teamError || !team) {
      return c.json({ error: 'Team not found' }, 404)
    }

    // Get query params for filtering
    const startDate = c.req.query('startDate')
    const endDate = c.req.query('endDate')
    const workerId = c.req.query('workerId')

    // Build query - include all fields including recurring schedule fields
    // Note: Include both active and inactive schedules so users can activate/deactivate them
    let query = adminClient
      .from('worker_schedules')
      .select(`
        *,
        users!worker_schedules_worker_id_fkey(id, email, first_name, last_name, full_name)
      `)
      .eq('team_id', team.id)

    // Apply filters
    if (workerId) {
      query = query.eq('worker_id', workerId)
    }
    
    // For date filters, handle both single-date and recurring schedules
    // Single-date: filter by scheduled_date
    // Recurring: filter by effective_date/expiry_date overlap with filter range
    // Since Supabase doesn't support complex OR easily, we'll fetch all and filter in memory if date filters are provided
    // But for now, only apply date filters to single-date schedules
    // TODO: Could improve this with PostgREST filters or client-side filtering
    if (startDate || endDate) {
      // Only filter single-date schedules - recurring schedules are shown if they overlap
      // This means recurring schedules might show up even outside the filter range, but that's acceptable
      if (startDate) {
        query = query.or(`scheduled_date.gte.${startDate},day_of_week.not.is.null`)
      }
      if (endDate) {
        query = query.or(`scheduled_date.lte.${endDate},day_of_week.not.is.null`)
      }
    }

    // Order by: first recurring schedules (those with day_of_week), then single-date schedules
    // Group by type: recurring first (day_of_week not null), then by date/time
    query = query.order('day_of_week', { ascending: true, nullsFirst: false })
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .order('start_time', { ascending: true })

    const { data, error } = await query

    if (error) {
      console.error('[GET /schedules/workers] Error:', error)
      return c.json({ error: 'Failed to fetch worker schedules', details: error.message }, 500)
    }

    return c.json({ schedules: data || [] }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  } catch (error: any) {
    console.error('[GET /schedules/workers] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get worker's own schedule (Worker views their own schedules)
// IMPORTANT: Only returns ACTIVE schedules - inactive schedules are excluded from future dates
schedules.get('/my-schedule', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (user.role !== 'worker') {
      return c.json({ error: 'Forbidden: This endpoint is only accessible to workers' }, 403)
    }

    const adminClient = getAdminClient()

    // Get query params for date range
    const startDateStr = c.req.query('startDate') || new Date().toISOString().split('T')[0]
    const endDateStr = c.req.query('endDate') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // Default: next 7 days

    const startDate = new Date(startDateStr + 'T00:00:00.000Z')
    const endDate = new Date(endDateStr + 'T23:59:59.999Z')
    
    console.log(`[GET /schedules/my-schedule] Requested date range: ${startDateStr} to ${endDateStr} (${startDate.toISOString()} to ${endDate.toISOString()})`)

    // Get all ACTIVE schedules (both single-date and recurring)
    const { data: allSchedules, error: schedulesError } = await adminClient
      .from('worker_schedules')
      .select('*')
      .eq('worker_id', user.id)
      .eq('is_active', true) // IMPORTANT: Only active schedules for future dates

    if (schedulesError) {
      console.error('[GET /schedules/my-schedule] Error:', schedulesError)
      return c.json({ error: 'Failed to fetch schedule', details: schedulesError.message }, 500)
    }

    console.log(`[GET /schedules/my-schedule] Found ${allSchedules?.length || 0} active schedules for worker ${user.id} (${user.email})`)
    if (allSchedules && allSchedules.length > 0) {
      allSchedules.forEach((s: any, idx: number) => {
        const dayName = s.day_of_week !== null ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.day_of_week] : 'Single date'
        console.log(`[GET /schedules/my-schedule] Schedule ${idx + 1}: ${dayName} (day_of_week=${s.day_of_week}), scheduled_date=${s.scheduled_date}, effective_date=${s.effective_date}, expiry_date=${s.expiry_date}, is_active=${s.is_active}, start_time=${s.start_time}, end_time=${s.end_time}`)
      })
    } else {
      console.log(`[GET /schedules/my-schedule] No active schedules found for worker ${user.id} (${user.email})`)
    }

    // Process schedules to generate dates in the range (supports both single-date and recurring)
    const scheduleList: any[] = []

    console.log(`[GET /schedules/my-schedule] Processing ${allSchedules?.length || 0} schedules for date range: ${startDateStr} to ${endDateStr}`)

    ;(allSchedules || []).forEach((schedule: any) => {
      // Single-date schedule: check if date is within range
      if (schedule.scheduled_date && schedule.day_of_week === null) {
        const scheduleDate = new Date(schedule.scheduled_date)
        scheduleDate.setHours(0, 0, 0, 0)
        if (scheduleDate >= startDate && scheduleDate <= endDate) {
          scheduleList.push({
            ...schedule,
            display_date: schedule.scheduled_date,
          })
          console.log(`[GET /schedules/my-schedule] Added single-date schedule: ${schedule.scheduled_date}`)
        }
      }
      // Recurring schedule: calculate all matching dates in the range
      else if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        const effectiveDate = schedule.effective_date ? new Date(schedule.effective_date + 'T00:00:00.000Z') : startDate
        const expiryDate = schedule.expiry_date ? new Date(schedule.expiry_date + 'T23:59:59.999Z') : endDate
        
        // Determine the actual start date for iteration
        const scheduleStart = effectiveDate > startDate ? effectiveDate : startDate
        const scheduleEnd = expiryDate < endDate ? expiryDate : endDate
        
        // Only process if there's an overlap
        if (scheduleStart <= scheduleEnd) {
          console.log(`[GET /schedules/my-schedule] Processing recurring schedule: day_of_week=${schedule.day_of_week}, effective=${schedule.effective_date}, expiry=${schedule.expiry_date}, range=${scheduleStart.toISOString().split('T')[0]} to ${scheduleEnd.toISOString().split('T')[0]}`)
        
        // Generate dates for this recurring schedule
          let matchCount = 0
          const currentDate = new Date(scheduleStart)
          
          while (currentDate <= scheduleEnd) {
            const dayOfWeek = currentDate.getDay() // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
          
          // Check if this date matches the schedule's day_of_week
          if (dayOfWeek === schedule.day_of_week) {
              const dateStr = currentDate.toISOString().split('T')[0]
            scheduleList.push({
              ...schedule,
              display_date: dateStr, // The actual date for this occurrence
              scheduled_date: null, // Clear scheduled_date to indicate this is from recurring
            })
              matchCount++
            }
            
            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1)
          }
          
          console.log(`[GET /schedules/my-schedule] Generated ${matchCount} dates for recurring schedule (day_of_week=${schedule.day_of_week})`)
        } else {
          console.log(`[GET /schedules/my-schedule] Skipping recurring schedule: no overlap with requested range (effective=${schedule.effective_date}, expiry=${schedule.expiry_date})`)
        }
      }
    })

    // Sort by date, then by start time
    scheduleList.sort((a, b) => {
      const dateA = new Date(a.display_date)
      const dateB = new Date(b.display_date)
      if (dateA.getTime() !== dateB.getTime()) {
        return dateA.getTime() - dateB.getTime()
      }
      return (a.start_time || '').localeCompare(b.start_time || '')
    })

    console.log(`[GET /schedules/my-schedule] Returning ${scheduleList.length} schedule entries for date range ${startDateStr} to ${endDateStr}`)

    return c.json({ schedules: scheduleList }, 200, {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    })
  } catch (error: any) {
    console.error('[GET /schedules/my-schedule] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Create worker schedule (Team Leader only)
// Supports single date or date range with day selection for bulk creation
schedules.post('/workers', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { 
      worker_id,
      scheduled_date, // Single date (YYYY-MM-DD) - for single schedule
      start_date,     // Start date for range (YYYY-MM-DD)
      end_date,       // End date for range (YYYY-MM-DD)
      days_of_week,   // Array of day numbers (0=Sunday, 1=Monday, ..., 6=Saturday) for recurring
      start_time, 
      end_time,
      check_in_window_start, // Optional: custom check-in window
      check_in_window_end,   // Optional: custom check-in window
      requires_daily_checkin, // Optional: whether schedule requires daily check-in
      daily_checkin_start_time, // Optional: daily check-in window start
      daily_checkin_end_time,   // Optional: daily check-in window end
      project_id,
      notes
    } = await c.req.json()

    // Validation: Either single date OR (start_date + end_date + days_of_week)
    if (!worker_id || !start_time || !end_time) {
      return c.json({ error: 'worker_id, start_time, and end_time are required' }, 400)
    }

    if (!scheduled_date && (!start_date || !end_date || !days_of_week)) {
      return c.json({ error: 'Either scheduled_date OR (start_date, end_date, and days_of_week) are required' }, 400)
    }

    if (requires_daily_checkin && (!daily_checkin_start_time || !daily_checkin_end_time)) {
      return c.json({ error: 'daily_checkin_start_time and daily_checkin_end_time are required when requires_daily_checkin is true' }, 400)
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    
    let isRecurringMode = false
    let recurringDays: number[] = []
    let effectiveDate: string | null = null
    let expiryDate: string | null = null
    
    if (scheduled_date && (!start_date || !end_date || !days_of_week)) {
      // Single date mode - create one record with specific date
      if (!dateRegex.test(scheduled_date)) {
        return c.json({ error: 'Invalid scheduled_date format. Use YYYY-MM-DD format' }, 400)
      }
      isRecurringMode = false
    } else if (start_date && end_date && days_of_week) {
      // Recurring pattern mode - create one record per day_of_week (not per date!)
      if (!dateRegex.test(start_date) || !dateRegex.test(end_date)) {
        return c.json({ error: 'Invalid date format. Use YYYY-MM-DD format' }, 400)
      }
      
      if (!Array.isArray(days_of_week) || days_of_week.length === 0) {
        return c.json({ error: 'days_of_week must be a non-empty array of day numbers (0-6)' }, 400)
      }
      
      // Validate day numbers
      const validDays = days_of_week.filter((day: number) => day >= 0 && day <= 6 && Number.isInteger(day))
      if (validDays.length !== days_of_week.length) {
        return c.json({ error: 'days_of_week must contain integers between 0 (Sunday) and 6 (Saturday)' }, 400)
      }
      
      const start = new Date(start_date)
      const end = new Date(end_date)
      
      if (start > end) {
        return c.json({ error: 'start_date must be before or equal to end_date' }, 400)
      }
      
      isRecurringMode = true
      recurringDays = [...new Set(validDays)].sort() // Remove duplicates and sort
      effectiveDate = start_date
      expiryDate = end_date
    } else {
      return c.json({ error: 'Either scheduled_date OR (start_date, end_date, and days_of_week) are required' }, 400)
    }

    // Validate time format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
    // Normalize time format (remove seconds if present: HH:MM:SS -> HH:MM)
    const normalizeTime = (time: string): string => {
      return time.split(':').slice(0, 2).join(':')
    }
    const normalizedStartTime = normalizeTime(start_time)
    const normalizedEndTime = normalizeTime(end_time)
    
    if (!timeRegex.test(normalizedStartTime) || !timeRegex.test(normalizedEndTime)) {
      return c.json({ error: 'Invalid time format. Use HH:MM format' }, 400)
    }

    // Ensure end time is after start time (use normalized times)
    if (normalizedEndTime <= normalizedStartTime) {
      return c.json({ error: 'end_time must be after start_time' }, 400)
    }

    // Normalize daily check-in times if provided
    let normalizedDailyStart: string | null = null
    let normalizedDailyEnd: string | null = null
    
    if (requires_daily_checkin) {
      if (!daily_checkin_start_time || !daily_checkin_end_time) {
        return c.json({ error: 'daily_checkin_start_time and daily_checkin_end_time are required when requires_daily_checkin is true' }, 400)
      }
      normalizedDailyStart = normalizeTime(daily_checkin_start_time)
      normalizedDailyEnd = normalizeTime(daily_checkin_end_time)
      if (!timeRegex.test(normalizedDailyStart) || !timeRegex.test(normalizedDailyEnd)) {
        return c.json({ error: 'Invalid daily check-in time format. Use HH:MM format' }, 400)
      }
      if (normalizedDailyEnd <= normalizedDailyStart) {
        return c.json({ error: 'daily_checkin_end_time must be after daily_checkin_start_time' }, 400)
      }
    }

    const adminClient = getAdminClient()

    // Get team leader's team
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('id')
      .eq('team_leader_id', user.id)
      .single()

    if (teamError || !team) {
      return c.json({ error: 'Team not found' }, 404)
    }

    // Verify worker is in this team
    const { data: teamMember, error: memberError } = await adminClient
      .from('team_members')
      .select('user_id, team_id')
      .eq('team_id', team.id)
      .eq('user_id', worker_id)
      .single()

    if (memberError || !teamMember) {
      return c.json({ error: 'Worker not found in your team' }, 404)
    }

    // Verify worker is actually a worker
    const { data: worker, error: workerError } = await adminClient
      .from('users')
      .select('id, role')
      .eq('id', worker_id)
      .eq('role', 'worker')
      .single()

    if (workerError || !worker) {
      return c.json({ error: 'Invalid worker or user is not a worker' }, 400)
    }

    // Check for existing schedules to prevent duplicates
    // Check both active and inactive schedules to prevent duplicates
    if (isRecurringMode) {
      // Check for existing recurring schedules for the same days (any status, any time)
      // A worker cannot have duplicate day_of_week schedules (e.g., two Monday schedules)
      const { data: existingSchedules } = await adminClient
        .from('worker_schedules')
        .select('id, day_of_week, is_active')
        .eq('worker_id', worker_id)
        .in('day_of_week', recurringDays)
        .is('scheduled_date', null)

      if (existingSchedules && existingSchedules.length > 0) {
        const conflictingDays = existingSchedules.map(s => {
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
          const status = s.is_active ? 'active' : 'inactive'
          return `${dayNames[s.day_of_week]} (${status})`
        }).join(', ')
        return c.json({ 
          error: `Schedule already exists for this worker on: ${conflictingDays}. Please edit or activate the existing schedule instead.` 
        }, 409)
      }
    } else {
      // Check for existing single-date schedule (any status, any time)
      // A worker cannot have duplicate scheduled_date schedules
      const { data: existingSchedule } = await adminClient
        .from('worker_schedules')
        .select('id, scheduled_date, is_active')
        .eq('worker_id', worker_id)
        .eq('scheduled_date', scheduled_date)
        .is('day_of_week', null)
        .maybeSingle()

      if (existingSchedule) {
        const status = existingSchedule.is_active ? 'active' : 'inactive'
        return c.json({ 
          error: `Schedule already exists for this worker on ${scheduled_date} (${status}). Please edit or activate the existing schedule instead.` 
        }, 409)
      }
    }

    // Create schedule(s) based on mode
    let schedulesToInsert: any[] = []

    if (isRecurringMode) {
      // Create one record per day_of_week (not per date!)
      schedulesToInsert = recurringDays.map(day => {
        const scheduleData: any = {
          worker_id,
          team_id: team.id,
          day_of_week: day,
          scheduled_date: null, // NULL for recurring schedules
          effective_date: effectiveDate,
          expiry_date: expiryDate,
          start_time: normalizedStartTime,
          end_time: normalizedEndTime,
          created_by: user.id,
          is_active: true,
        }

        if (check_in_window_start) scheduleData.check_in_window_start = normalizeTime(check_in_window_start)
        if (check_in_window_end) scheduleData.check_in_window_end = normalizeTime(check_in_window_end)
        if (requires_daily_checkin !== undefined) scheduleData.requires_daily_checkin = requires_daily_checkin
        if (daily_checkin_start_time) scheduleData.daily_checkin_start_time = normalizedDailyStart
        if (daily_checkin_end_time) scheduleData.daily_checkin_end_time = normalizedDailyEnd
        if (project_id) scheduleData.project_id = project_id
        if (notes) scheduleData.notes = notes

        return scheduleData
      })
    } else {
      // Single date schedule - create one record
      const scheduleData: any = {
        worker_id,
        team_id: team.id,
        scheduled_date: scheduled_date,
        day_of_week: null, // NULL for single-date schedules
        effective_date: null,
        expiry_date: null,
        start_time: normalizedStartTime,
        end_time: normalizedEndTime,
        created_by: user.id,
        is_active: true,
      }

      if (check_in_window_start) scheduleData.check_in_window_start = normalizeTime(check_in_window_start)
      if (check_in_window_end) scheduleData.check_in_window_end = normalizeTime(check_in_window_end)
      if (requires_daily_checkin !== undefined) scheduleData.requires_daily_checkin = requires_daily_checkin
      if (daily_checkin_start_time) scheduleData.daily_checkin_start_time = normalizedDailyStart
      if (daily_checkin_end_time) scheduleData.daily_checkin_end_time = normalizedDailyEnd
      if (project_id) scheduleData.project_id = project_id
      if (notes) scheduleData.notes = notes

      schedulesToInsert = [scheduleData]
    }

    const { data: createdSchedules, error: createError } = await adminClient
      .from('worker_schedules')
      .insert(schedulesToInsert)
      .select()

    if (createError) {
      console.error('[POST /schedules/workers] Error:', createError)
      console.error('[POST /schedules/workers] Attempted to insert:', JSON.stringify(schedulesToInsert, null, 2))
      
      // Provide more detailed error message
      let errorMessage = 'Failed to create worker schedules'
      if (createError.message) {
        errorMessage += `: ${createError.message}`
      }
      if (createError.code) {
        errorMessage += ` (Code: ${createError.code})`
      }
      if (createError.details) {
        errorMessage += ` - ${createError.details}`
      }
      
      return c.json({ 
        error: errorMessage,
        details: createError.message,
        code: createError.code,
        hint: createError.hint 
      }, 500)
    }

    // Invalidate cache for analytics (since new schedule affects analytics)
    try {
      const { cache } = await import('../utils/cache')
      
      // Invalidate analytics cache for this team leader
      cache.deleteByUserId(user.id, ['analytics'])
      
      // Also invalidate supervisor analytics if supervisor exists
      const { data: supervisorData } = await adminClient
        .from('teams')
        .select('supervisor_id')
        .eq('id', team.id)
        .single()
      
      if (supervisorData?.supervisor_id) {
        cache.deleteByUserId(supervisorData.supervisor_id, ['supervisor-analytics'])
      }
    } catch (cacheError: any) {
      console.error('[POST /schedules/workers] Error invalidating cache:', cacheError)
      // Don't fail the request if cache invalidation fails
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const createdDays = isRecurringMode 
      ? recurringDays.map(d => dayNames[d]).join(', ')
      : 'single date'

    return c.json({ 
      message: `Worker schedule${schedulesToInsert.length !== 1 ? 's' : ''} created successfully (${createdSchedules?.length || 0} recurring pattern${createdSchedules?.length !== 1 ? 's' : ''} for ${createdDays})`,
      schedules: createdSchedules || [],
      count: createdSchedules?.length || 0,
      isRecurring: isRecurringMode
    }, 201)
  } catch (error: any) {
    console.error('[POST /schedules/workers] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update worker schedule (Team Leader only)
schedules.put('/workers/:id', authMiddleware, requireRole(['team_leader']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const scheduleId = c.req.param('id')
    const { 
      scheduled_date,
      day_of_week,
      effective_date,
      expiry_date,
      start_time, 
      end_time,
      check_in_window_start,
      check_in_window_end,
      requires_daily_checkin,
      daily_checkin_start_time,
      daily_checkin_end_time,
      project_id,
      is_active,
      notes
    } = await c.req.json()

    const adminClient = getAdminClient()

    // Get the schedule and verify ownership through team relationship
    const { data: schedule, error: scheduleError } = await adminClient
      .from('worker_schedules')
      .select('worker_id, team_id, start_time, end_time, scheduled_date, day_of_week')
      .eq('id', scheduleId)
      .single()

    if (scheduleError || !schedule) {
      return c.json({ error: 'Schedule not found' }, 404)
    }

    // Verify that this schedule belongs to team leader's team
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .select('id, team_leader_id')
      .eq('id', schedule.team_id)
      .eq('team_leader_id', user.id)
      .single()

    if (teamError || !team) {
      return c.json({ error: 'Unauthorized - you can only edit schedules for workers in your team' }, 403)
    }

    // VALIDATION: Prevent ANY schedule updates if worker has an active exception
    const { data: activeException } = await adminClient
      .from('worker_exceptions')
      .select('id, exception_type, start_date, end_date')
      .eq('user_id', schedule.worker_id)
      .eq('is_active', true)
      .maybeSingle()

    if (activeException) {
      // Check if exception overlaps with schedule date or today
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const checkDate = schedule.scheduled_date ? new Date(schedule.scheduled_date) : today
      checkDate.setHours(0, 0, 0, 0)
      
      const exceptionStart = new Date(activeException.start_date)
      exceptionStart.setHours(0, 0, 0, 0)
      const exceptionEnd = activeException.end_date ? new Date(activeException.end_date) : null
      if (exceptionEnd) exceptionEnd.setHours(23, 59, 59, 999)

      if (checkDate >= exceptionStart && (!exceptionEnd || checkDate <= exceptionEnd)) {
        const exceptionLabels: Record<string, string> = {
          transfer: 'Transfer',
          accident: 'Accident',
          injury: 'Injury',
          medical_leave: 'Medical Leave',
          other: 'Other',
        }
        const exceptionLabel = exceptionLabels[activeException.exception_type] || activeException.exception_type
        
        return c.json({ 
          error: `Cannot update schedule: Worker has an active ${exceptionLabel} exemption. Please remove or close the exemption first.` 
        }, 400)
      }
    }

    const updateData: any = {}
    
    // Handle schedule type: single-date vs recurring
    if (scheduled_date !== undefined) {
      if (scheduled_date === null) {
        updateData.scheduled_date = null
      } else {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/
        if (!dateRegex.test(scheduled_date)) {
          return c.json({ error: 'Invalid date format. Use YYYY-MM-DD format' }, 400)
        }
        updateData.scheduled_date = scheduled_date
      }
    }
    
    if (day_of_week !== undefined) {
      if (day_of_week === null) {
        updateData.day_of_week = null
      } else {
        if (typeof day_of_week !== 'number' || day_of_week < 0 || day_of_week > 6) {
          return c.json({ error: 'Invalid day_of_week (0-6)' }, 400)
        }
        updateData.day_of_week = day_of_week
      }
    }
    
    if (effective_date !== undefined) {
      updateData.effective_date = effective_date || null
      if (effective_date && !/^\d{4}-\d{2}-\d{2}$/.test(effective_date)) {
        return c.json({ error: 'Invalid effective_date format. Use YYYY-MM-DD format' }, 400)
      }
    }
    
    if (expiry_date !== undefined) {
      updateData.expiry_date = expiry_date || null
      if (expiry_date && !/^\d{4}-\d{2}-\d{2}$/.test(expiry_date)) {
        return c.json({ error: 'Invalid expiry_date format. Use YYYY-MM-DD format' }, 400)
      }
    }
    
    // Validate schedule type constraint: must have either scheduled_date OR day_of_week, not both
    const finalScheduledDate = updateData.scheduled_date !== undefined ? updateData.scheduled_date : schedule.scheduled_date
    const finalDayOfWeek = updateData.day_of_week !== undefined ? updateData.day_of_week : schedule.day_of_week
    
    if (finalScheduledDate !== null && finalDayOfWeek !== null) {
      return c.json({ error: 'Schedule must be either single-date (scheduled_date) OR recurring (day_of_week), not both' }, 400)
    }
    
    if (finalScheduledDate === null && finalDayOfWeek === null) {
      return c.json({ error: 'Schedule must have either scheduled_date or day_of_week' }, 400)
    }

    // Check for duplicate schedules when changing day/date
    // Prevent updating to a day/date that already exists for this worker
    if (finalDayOfWeek !== null && finalDayOfWeek !== schedule.day_of_week) {
      // Changing to a recurring schedule - check if worker already has this day_of_week
      const { data: existingSchedule } = await adminClient
        .from('worker_schedules')
        .select('id, day_of_week, is_active')
        .eq('worker_id', schedule.worker_id)
        .eq('day_of_week', finalDayOfWeek)
        .is('scheduled_date', null)
        .neq('id', scheduleId)
        .maybeSingle()

      if (existingSchedule) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        const status = existingSchedule.is_active ? 'active' : 'inactive'
        return c.json({ 
          error: `Schedule already exists for this worker on ${dayNames[finalDayOfWeek]} (${status}). Please edit or activate the existing schedule instead.` 
        }, 409)
      }
    }
    
    if (finalScheduledDate !== null && finalScheduledDate !== schedule.scheduled_date) {
      // Changing to a single-date schedule - check if worker already has this scheduled_date
      const { data: existingSchedule } = await adminClient
        .from('worker_schedules')
        .select('id, scheduled_date, is_active')
        .eq('worker_id', schedule.worker_id)
        .eq('scheduled_date', finalScheduledDate)
        .is('day_of_week', null)
        .neq('id', scheduleId)
        .maybeSingle()

      if (existingSchedule) {
        const status = existingSchedule.is_active ? 'active' : 'inactive'
        return c.json({ 
          error: `Schedule already exists for this worker on ${finalScheduledDate} (${status}). Please edit or activate the existing schedule instead.` 
        }, 409)
      }
    }
    
    // Helper to normalize time format (HH:MM or HH:MM:SS -> HH:MM)
    const normalizeTime = (time: string | null | undefined): string | null => {
      if (!time) return null
      return time.split(':').slice(0, 2).join(':')
    }
    
    if (start_time !== undefined) {
      const normalized = normalizeTime(start_time)
      if (normalized) {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
        if (!timeRegex.test(normalized)) {
          return c.json({ error: 'Invalid time format. Use HH:MM format' }, 400)
        }
        updateData.start_time = normalized
      }
    }
    if (end_time !== undefined) {
      const normalized = normalizeTime(end_time)
      if (normalized) {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
        if (!timeRegex.test(normalized)) {
          return c.json({ error: 'Invalid time format. Use HH:MM format' }, 400)
        }
        updateData.end_time = normalized
      }
    }
    if (check_in_window_start !== undefined) {
      const normalized = normalizeTime(check_in_window_start)
      if (normalized) {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
        if (!timeRegex.test(normalized)) {
          return c.json({ error: 'Invalid check-in window start time format. Use HH:MM format' }, 400)
        }
        updateData.check_in_window_start = normalized
      } else {
        updateData.check_in_window_start = null
      }
    }
    if (check_in_window_end !== undefined) {
      const normalized = normalizeTime(check_in_window_end)
      if (normalized) {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
        if (!timeRegex.test(normalized)) {
          return c.json({ error: 'Invalid check-in window end time format. Use HH:MM format' }, 400)
        }
        updateData.check_in_window_end = normalized
      } else {
        updateData.check_in_window_end = null
      }
    }
    if (requires_daily_checkin !== undefined) {
      updateData.requires_daily_checkin = requires_daily_checkin
      // If requiring daily check-in, ensure times are provided
      if (requires_daily_checkin && (!daily_checkin_start_time || !daily_checkin_end_time)) {
        return c.json({ error: 'daily_checkin_start_time and daily_checkin_end_time are required when requires_daily_checkin is true' }, 400)
      }
    }
    if (daily_checkin_start_time !== undefined) {
      const normalized = normalizeTime(daily_checkin_start_time)
      updateData.daily_checkin_start_time = normalized
    }
    if (daily_checkin_end_time !== undefined) {
      const normalized = normalizeTime(daily_checkin_end_time)
      updateData.daily_checkin_end_time = normalized
    }
    if (project_id !== undefined) updateData.project_id = project_id || null
    if (is_active !== undefined) updateData.is_active = is_active
    if (notes !== undefined) updateData.notes = notes || null

    // Validate daily check-in times if requiring daily check-in
    if (updateData.requires_daily_checkin || requires_daily_checkin) {
      const finalDailyStart = updateData.daily_checkin_start_time !== undefined ? updateData.daily_checkin_start_time : daily_checkin_start_time
      const finalDailyEnd = updateData.daily_checkin_end_time !== undefined ? updateData.daily_checkin_end_time : daily_checkin_end_time
      
      if (finalDailyStart && finalDailyEnd) {
        // Normalize time format (remove seconds if present)
        const normalizeTime = (time: string | null): string | null => {
          if (!time) return null
          return time.split(':').slice(0, 2).join(':')
        }
        const normalizedStart = normalizeTime(finalDailyStart)
        const normalizedEnd = normalizeTime(finalDailyEnd)
        
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
        if (normalizedStart && normalizedEnd) {
          if (!timeRegex.test(normalizedStart) || !timeRegex.test(normalizedEnd)) {
            return c.json({ error: 'Invalid daily check-in time format. Use HH:MM format' }, 400)
          }
          if (normalizedEnd <= normalizedStart) {
            return c.json({ error: 'daily_checkin_end_time must be after daily_checkin_start_time' }, 400)
          }
          // Update normalized values
          updateData.daily_checkin_start_time = normalizedStart
          updateData.daily_checkin_end_time = normalizedEnd
        }
      }
    }

    // Validate that end_time is after start_time
    const finalStartTime = updateData.start_time || schedule.start_time
    const finalEndTime = updateData.end_time || schedule.end_time
    if (finalEndTime <= finalStartTime) {
      return c.json({ error: 'end_time must be after start_time' }, 400)
    }

    const { data, error } = await adminClient
      .from('worker_schedules')
      .update(updateData)
      .eq('id', scheduleId)
      .select()
      .single()

    if (error) {
      console.error('[PUT /schedules/workers/:id] Error:', error)
      return c.json({ error: 'Failed to update worker schedule', details: error.message }, 500)
    }

    // Invalidate cache for analytics (since schedule update affects analytics)
    try {
      const { cache } = await import('../utils/cache')
      
      // Get team_id from updated schedule
      const { data: updatedSchedule } = await adminClient
        .from('worker_schedules')
        .select('team_id')
        .eq('id', scheduleId)
        .single()
      
      if (updatedSchedule?.team_id) {
        // Get team leader and supervisor IDs
        const { data: teamData } = await adminClient
          .from('teams')
          .select('team_leader_id, supervisor_id')
          .eq('id', updatedSchedule.team_id)
          .single()
        
        // Invalidate team leader analytics
        if (teamData?.team_leader_id) {
          cache.deleteByUserId(teamData.team_leader_id, ['analytics'])
        }
        
        // Invalidate supervisor analytics
        if (teamData?.supervisor_id) {
          cache.deleteByUserId(teamData.supervisor_id, ['supervisor-analytics'])
        }
      }
    } catch (cacheError: any) {
      console.error('[PUT /schedules/workers/:id] Error invalidating cache:', cacheError)
      // Don't fail the request if cache invalidation fails
    }

    return c.json({
      message: 'Worker schedule updated successfully',
      schedule: data 
    })
  } catch (error: any) {
    console.error('[PUT /schedules/workers/:id] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// NOTE: DELETE endpoint removed - Use PUT with is_active toggle instead
// Schedules can be activated/deactivated via PUT /workers/:id with is_active field

export default schedules

