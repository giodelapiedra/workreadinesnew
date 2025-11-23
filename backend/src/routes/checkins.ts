import { Hono } from 'hono'
import { supabase } from '../lib/supabase.js'
import { authMiddleware, requireRole, AuthVariables } from '../middleware/auth.js'
import { getCaseStatusFromNotes } from '../utils/caseStatus.js'
import { getAdminClient } from '../utils/adminClient.js'
import { parseTime, compareTime, formatDateString, parseDateString } from '../utils/dateTime.js'
import { getTodayDateString, dateToDateString } from '../utils/dateUtils.js'

// Date/time utilities are now imported from '../utils/dateTime'

// Helper: Determine shift type from start and end time
function getShiftType(startTime: string, endTime?: string): 'morning' | 'afternoon' | 'night' | 'flexible' {
  const startHour = parseTime(startTime).hours
  const endHour = endTime ? parseTime(endTime).hours : null
  
  // If we have end time, use both to determine shift type more accurately
  if (endTime && endHour !== null) {
    // Check if shift spans across midnight
    const spansMidnight = startHour > endHour
    
    // Day shift: typically ends before 6 PM (18:00) and doesn't span midnight
    // OR starts early (4-6 AM) and ends in the afternoon/evening
    if (!spansMidnight) {
      // Day shift: ends before 6 PM or starts early and ends late afternoon
      if (endHour < 18 || (startHour >= 4 && startHour < 12 && endHour >= 12 && endHour <= 18)) {
        if (startHour < 12) return 'morning'
        return 'afternoon'
      }
      // Afternoon shift: starts after 12 PM, ends before 10 PM
      if (startHour >= 12 && endHour < 22) {
        return 'afternoon'
      }
    }
    
    // Night shift: starts at 6 PM or later, OR spans midnight, OR starts very early and ends very early
    if (startHour >= 18 || spansMidnight || (startHour < 6 && endHour < 6)) {
      return 'night'
    }
  }
  
  // Fallback to start time only (backward compatibility)
  if (startHour >= 6 && startHour < 12) return 'morning'
  if (startHour >= 12 && startHour < 18) return 'afternoon'
  if (startHour >= 18 || startHour < 6) return 'night'
  
  return 'flexible'
}

// Helper: Calculate time before shift start (in hours, can be negative for previous day)
function subtractHours(timeStr: string, hours: number): string {
  const { hours: h, minutes: m } = parseTime(timeStr)
  
  // Convert to total minutes
  let totalMinutes = (h * 60) + m - (hours * 60)
  
  // Handle negative (previous day)
  while (totalMinutes < 0) {
    totalMinutes += 24 * 60 // Add a day
  }
  
  // Handle overflow (next day)
  totalMinutes = totalMinutes % (24 * 60)
  
  const newHours = Math.floor(totalMinutes / 60)
  const newMinutes = totalMinutes % 60
  
  return `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`
}

// Helper: Get check-in window based on shift start time
// Check-in window should be BEFORE the shift starts (typically 2-4 hours before)
function getCheckInWindow(shiftType: 'morning' | 'afternoon' | 'night' | 'flexible', startTime?: string, endTime?: string): {
  windowStart: string
  windowEnd: string
  recommendedStart: string
  recommendedEnd: string
} {
  // Default flexible window (no shift)
  if (shiftType === 'flexible' || !startTime) {
    return {
      windowStart: '05:00',
      windowEnd: '23:00',
      recommendedStart: '05:00',
      recommendedEnd: '23:00',
    }
  }

  const startHour = parseTime(startTime).hours
  
  // Calculate check-in window: 4 hours before shift start to 1 hour before shift start
  // This ensures workers check in BEFORE their shift begins
  let windowStart: string
  let windowEnd: string
  let recommendedStart: string
  let recommendedEnd: string
  
  if (startHour >= 4) {
    // Normal case: shift starts later in the day (4 AM or later)
    // Check-in window: 4 hours before to 1 hour before
    windowStart = subtractHours(startTime, 4)
    windowEnd = subtractHours(startTime, 1)
    recommendedStart = subtractHours(startTime, 3)
    recommendedEnd = subtractHours(startTime, 1)
  } else {
    // Early morning shift (before 4 AM): check-in window might be previous day
    // For shifts starting 1-3 AM, check-in window is previous day 9 PM - 12 AM
    if (startHour >= 1 && startHour < 4) {
      windowStart = subtractHours(startTime, 4) // This will be previous day
      windowEnd = subtractHours(startTime, 1)
      recommendedStart = subtractHours(startTime, 3)
      recommendedEnd = subtractHours(startTime, 1)
    } else {
      // Very early shift (midnight), use previous day window
      windowStart = '21:00' // 9 PM previous day
      windowEnd = '23:59'   // 11:59 PM previous day
      recommendedStart = '22:00'
      recommendedEnd = '23:59'
    }
  }
  
  // Special handling for very early shifts (before 6 AM)
  if (startHour < 6) {
    const windowStartHour = parseTime(windowStart).hours
    // If check-in window would be on previous day (starts after 8 PM), adjust
    if (windowStartHour > 20 || windowStartHour < startHour) {
      // Check-in window spans previous day - adjust to reasonable hours
      // For 4 AM shift: window should be 12 AM (midnight) - 3 AM same day
      if (startHour >= 4) {
        windowStart = '00:00' // Start from midnight same day
        windowEnd = subtractHours(startTime, 1)
        recommendedStart = '01:00'
        recommendedEnd = subtractHours(startTime, 1)
      } else {
        // For very early shifts (1-3 AM), use previous day 9 PM - 12 AM
        windowStart = '21:00'
        windowEnd = '23:59'
        recommendedStart = '22:00'
        recommendedEnd = '23:59'
      }
    }
  }
  
  // Ensure window doesn't end after shift starts
  if (compareTime(windowEnd, startTime) >= 0) {
    windowEnd = subtractHours(startTime, 1) // 1 hour before shift (minimum)
    recommendedEnd = subtractHours(startTime, 1)
  }
  
  // For very late shifts (after 10 PM), adjust window start to reasonable hours
  if (startHour >= 22) {
    windowStart = subtractHours(startTime, 3) // 3 hours before instead of 4
    recommendedStart = subtractHours(startTime, 2) // 2 hours before
  }

  return {
    windowStart,
    windowEnd,
    recommendedStart,
    recommendedEnd,
  }
}

// Helper: Check if current time is within check-in window
function isWithinCheckInWindow(currentTime: string, windowStart: string, windowEnd: string): boolean {
  // Handle night shift that spans midnight
  if (compareTime(windowStart, windowEnd) > 0) {
    // Window spans midnight
    return compareTime(currentTime, windowStart) >= 0 || compareTime(currentTime, windowEnd) <= 0
  } else {
    // Normal window within same day
    return compareTime(currentTime, windowStart) >= 0 && compareTime(currentTime, windowEnd) <= 0
  }
}

// Helper: Get worker's shift info for a specific date (default: today)
// ONLY uses individual worker schedules from worker_schedules table (created by Team Leader)
// NO FALLBACK - Team Leader MUST assign individual schedules
async function getWorkerShiftInfo(userId: string, targetDate?: Date): Promise<{
  hasShift: boolean
  shiftType: 'morning' | 'afternoon' | 'night' | 'flexible'
  shiftStart?: string
  shiftEnd?: string
  checkInWindow: { windowStart: string; windowEnd: string; recommendedStart: string; recommendedEnd: string }
  scheduleSource?: 'team_leader' | 'none' | 'flexible'
}> {
  const adminClient = getAdminClient()
  
  // Get target date (use local date, not UTC, to match scheduled_date in database)
  const target = targetDate || new Date()
  // Get local date string (YYYY-MM-DD) to match database date format
  const year = target.getFullYear()
  const month = String(target.getMonth() + 1).padStart(2, '0')
  const day = String(target.getDate()).padStart(2, '0')
  const targetStr = `${year}-${month}-${day}`

  // PRIORITY 1: Check worker_schedules table first (individual worker schedules)
  // Check both single-date schedules and recurring schedules
  // NOTE: Supports ALL days of week (0=Sunday, 1=Monday, ..., 6=Saturday) - INCLUDING WEEKENDS
  const targetDayOfWeek = target.getDay() // 0-6: Sunday=0, Monday=1, ..., Saturday=6
  
  // First, check for single-date schedule (works for ANY date including weekends)
  const { data: singleDateSchedule, error: singleDateError } = await adminClient
    .from('worker_schedules')
    .select('*')
    .eq('worker_id', userId)
    .eq('scheduled_date', targetStr)
    .eq('is_active', true)
    .is('day_of_week', null) // Only single-date schedules
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle()

  let workerSchedule = null
  if (singleDateError) {
    // Only log actual errors, not "not found" cases
    console.error(`[getWorkerShiftInfo] Error fetching single-date schedule for user ${userId}:`, singleDateError)
  } else {
    workerSchedule = singleDateSchedule
  }

  // If no single-date schedule found, check for recurring schedule
  if (!workerSchedule) {
    // Check for recurring schedule - need to handle expiry_date being NULL or >= target
    // Since Supabase OR syntax is limited, we'll fetch and filter in memory if needed
    let { data: recurringSchedule, error: recurringError } = await adminClient
      .from('worker_schedules')
      .select('*')
      .eq('worker_id', userId)
      .eq('day_of_week', targetDayOfWeek) // Matches any day 0-6 (including weekends: Saturday=6, Sunday=0)
      .eq('is_active', true)
      .is('scheduled_date', null) // Only recurring schedules
      // Removed .lte('effective_date', targetStr) - filter in memory to handle future effective dates
      .order('start_time', { ascending: true })

    // Filter in memory to handle both effective_date and expiry_date (can be NULL or future dates)
    // This ensures schedules with future effective_date are still considered
    if (!recurringError && recurringSchedule && recurringSchedule.length > 0) {
      recurringSchedule = recurringSchedule.filter((schedule: any) => {
        // Effective date should be NULL (always active) OR <= target date
        // Expiry date should be NULL (ongoing) OR >= target date
        const effectiveOk = !schedule.effective_date || schedule.effective_date <= targetStr
        const expiryOk = !schedule.expiry_date || schedule.expiry_date >= targetStr
        return effectiveOk && expiryOk
      })
      
      // Use the first matching schedule
      recurringSchedule = recurringSchedule.length > 0 ? recurringSchedule[0] : null
    } else {
      recurringSchedule = null
    }

    if (!recurringError && recurringSchedule && typeof recurringSchedule === 'object' && !Array.isArray(recurringSchedule)) {
      workerSchedule = recurringSchedule
    } else if (recurringError) {
      // Only log errors, not normal "no schedule found" cases
      console.error(`[getWorkerShiftInfo] Error fetching recurring schedule for user ${userId}:`, recurringError)
    }
  }
  
  if (workerSchedule) {
    const shiftType = getShiftType(workerSchedule.start_time, workerSchedule.end_time)
    
    // PRIORITY: Use daily check-in window if schedule requires daily check-in
    // Otherwise, use custom check-in window, or calculate from shift time
    let checkInWindow
    if (workerSchedule.requires_daily_checkin && workerSchedule.daily_checkin_start_time && workerSchedule.daily_checkin_end_time) {
      checkInWindow = {
        windowStart: workerSchedule.daily_checkin_start_time,
        windowEnd: workerSchedule.daily_checkin_end_time,
        recommendedStart: workerSchedule.daily_checkin_start_time,
        recommendedEnd: workerSchedule.daily_checkin_end_time,
      }
    } else if (workerSchedule.check_in_window_start && workerSchedule.check_in_window_end) {
      checkInWindow = {
        windowStart: workerSchedule.check_in_window_start,
        windowEnd: workerSchedule.check_in_window_end,
        recommendedStart: workerSchedule.check_in_window_start,
        recommendedEnd: workerSchedule.check_in_window_end,
      }
    } else {
      checkInWindow = getCheckInWindow(shiftType, workerSchedule.start_time, workerSchedule.end_time)
    }

    const result = {
      hasShift: true,
      shiftType,
      shiftStart: workerSchedule.start_time,
      shiftEnd: workerSchedule.end_time,
      checkInWindow,
      scheduleSource: 'team_leader' as const, // Individual schedule assigned by team leader
      requiresDailyCheckIn: workerSchedule.requires_daily_checkin || false,
    }
    
    return result
  }

  // NO FALLBACK: If no individual worker schedule exists, return no schedule
  // Team Leader MUST assign individual schedules via worker_schedules table
  return {
    hasShift: false,
    shiftType: 'flexible',
    checkInWindow: getCheckInWindow('flexible'),
    scheduleSource: 'none' as const, // No schedule assigned
  }
}

// OPTIMIZED: Get next shift info by fetching all schedules once and calculating in memory
// This reduces from 730+ database queries to just 1 query
async function getNextShiftInfoOptimized(userId: string, startFromDate: Date = new Date()): Promise<{
  hasShift: boolean
  shiftType: 'morning' | 'afternoon' | 'night' | 'flexible'
  shiftStart?: string
  shiftEnd?: string
  checkInWindow: { windowStart: string; windowEnd: string; recommendedStart: string; recommendedEnd: string }
  scheduleSource?: 'team_leader' | 'none' | 'flexible'
  date?: string
  dayName?: string
  formattedDate?: string
  requiresDailyCheckIn?: boolean
} | null> {
  const adminClient = getAdminClient()
  const startDateStr = formatDateString(startFromDate)
  
  // Fetch ALL active schedules for this worker ONCE (instead of querying per day)
  const { data: allSchedules, error } = await adminClient
    .from('worker_schedules')
    .select('*')
    .eq('worker_id', userId)
    .eq('is_active', true)
    .order('start_time', { ascending: true })

  if (error) {
    console.error(`[getNextShiftInfoOptimized] Error fetching schedules:`, error)
    return null
  }

  if (!allSchedules || allSchedules.length === 0) {
    return null
  }

  // OPTIMIZED: Single pass to separate schedules (more efficient than multiple filters)
  const singleDateSchedules: any[] = []
  const recurringSchedulesByDay = new Map<number, any[]>() // Group by day_of_week for O(1) lookup
  
  for (const schedule of allSchedules) {
    if (schedule.scheduled_date && !schedule.day_of_week) {
      // Single-date schedule
      if (schedule.scheduled_date >= startDateStr) {
        singleDateSchedules.push(schedule)
      }
    } else if (!schedule.scheduled_date && schedule.day_of_week !== null) {
      // Recurring schedule - group by day_of_week for faster lookup
      const dayOfWeek = schedule.day_of_week
      if (!recurringSchedulesByDay.has(dayOfWeek)) {
        recurringSchedulesByDay.set(dayOfWeek, [])
      }
      recurringSchedulesByDay.get(dayOfWeek)!.push(schedule)
    }
  }

  // Check single-date schedules first (usually fewer, sort by date for efficiency)
  if (singleDateSchedules.length > 0) {
    singleDateSchedules.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    const schedule = singleDateSchedules[0]
    const shiftType = getShiftType(schedule.start_time, schedule.end_time)
    let checkInWindow
    if (schedule.requires_daily_checkin && schedule.daily_checkin_start_time && schedule.daily_checkin_end_time) {
      checkInWindow = {
        windowStart: schedule.daily_checkin_start_time,
        windowEnd: schedule.daily_checkin_end_time,
        recommendedStart: schedule.daily_checkin_start_time,
        recommendedEnd: schedule.daily_checkin_end_time,
      }
    } else if (schedule.check_in_window_start && schedule.check_in_window_end) {
      checkInWindow = {
        windowStart: schedule.check_in_window_start,
        windowEnd: schedule.check_in_window_end,
        recommendedStart: schedule.check_in_window_start,
        recommendedEnd: schedule.check_in_window_end,
      }
    } else {
      checkInWindow = getCheckInWindow(shiftType, schedule.start_time, schedule.end_time)
    }

    const targetDate = parseDateString(schedule.scheduled_date)
    return {
      hasShift: true,
      shiftType,
      shiftStart: schedule.start_time,
      shiftEnd: schedule.end_time,
      checkInWindow,
      scheduleSource: 'team_leader' as const,
      requiresDailyCheckIn: schedule.requires_daily_checkin || false,
      date: schedule.scheduled_date,
      dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][targetDate.getDay()],
      formattedDate: targetDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric',
        year: 'numeric'
      }),
    }
  }

  // OPTIMIZED: Check recurring schedules - use Map for O(1) day lookup instead of nested loop
  // NOTE: Supports ALL days including weekends (Saturday=6, Sunday=0)
  // Start from dayOffset=0 to include today, then check future days
  const maxDaysToCheck = 730 // 2 years max
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  
  for (let dayOffset = 0; dayOffset <= maxDaysToCheck; dayOffset++) {
    const checkDate = new Date(startFromDate)
    checkDate.setDate(checkDate.getDate() + dayOffset)
    const checkDateStr = formatDateString(checkDate)
    const dayOfWeek = checkDate.getDay() // 0-6: Sunday=0, Monday=1, ..., Saturday=6

    // OPTIMIZED: Use Map for O(1) lookup instead of iterating through all schedules
    const schedulesForDay = recurringSchedulesByDay.get(dayOfWeek)
    if (!schedulesForDay || schedulesForDay.length === 0) {
      continue // Skip if no schedules for this day
    }

    // Find first matching schedule for this day (check effective_date and expiry_date)
    for (const schedule of schedulesForDay) {
      // Check effective_date and expiry_date
      const effectiveOk = !schedule.effective_date || schedule.effective_date <= checkDateStr
      const expiryOk = !schedule.expiry_date || schedule.expiry_date >= checkDateStr
      
      if (effectiveOk && expiryOk) {
        // Found next recurring schedule
        const shiftType = getShiftType(schedule.start_time, schedule.end_time)
        let checkInWindow
        if (schedule.requires_daily_checkin && schedule.daily_checkin_start_time && schedule.daily_checkin_end_time) {
          checkInWindow = {
            windowStart: schedule.daily_checkin_start_time,
            windowEnd: schedule.daily_checkin_end_time,
            recommendedStart: schedule.daily_checkin_start_time,
            recommendedEnd: schedule.daily_checkin_end_time,
          }
        } else if (schedule.check_in_window_start && schedule.check_in_window_end) {
          checkInWindow = {
            windowStart: schedule.check_in_window_start,
            windowEnd: schedule.check_in_window_end,
            recommendedStart: schedule.check_in_window_start,
            recommendedEnd: schedule.check_in_window_end,
          }
        } else {
          checkInWindow = getCheckInWindow(shiftType, schedule.start_time, schedule.end_time)
        }

        return {
          hasShift: true,
          shiftType,
          shiftStart: schedule.start_time,
          shiftEnd: schedule.end_time,
          checkInWindow,
          scheduleSource: 'team_leader' as const,
          requiresDailyCheckIn: schedule.requires_daily_checkin || false,
          date: checkDateStr,
          dayName: dayNames[dayOfWeek],
          formattedDate: checkDate.toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric',
            year: 'numeric'
          }),
        }
      }
    }
  }

  return null
}

const checkins = new Hono<{ Variables: AuthVariables }>()

// Get worker's check-in status for today (worker only)
checkins.get('/status', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Additional role verification - double check to ensure user is actually a worker
    if (user.role !== 'worker') {
      console.warn(`[GET /checkins/status] SECURITY: User ${user.id} (${user.email}) with role '${user.role}' attempted to access worker-only endpoint. Access denied.`)
      return c.json({ error: 'Forbidden: This endpoint is only accessible to workers' }, 403)
    }

    const today = getTodayDateString()
    const adminClient = getAdminClient()

    // Check for active exception first (include notes to get case_status)
    const { data: exception, error: exceptionError } = await adminClient
      .from('worker_exceptions')
      .select('id, exception_type, reason, start_date, end_date, notes')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    // If exception exists and is active for today
    let hasActiveException = false
    let caseStatus: string | null = null
    if (exception && !exceptionError) {
      const startDate = new Date(exception.start_date)
      const endDate = exception.end_date ? new Date(exception.end_date) : null
      const todayDate = new Date(today)

      if (todayDate >= startDate && (!endDate || todayDate <= endDate)) {
        hasActiveException = true
        // Extract case_status from notes field
        caseStatus = getCaseStatusFromNotes(exception.notes)
      }
    }

    // Check if worker has already checked in today
    const { data: checkIn, error } = await adminClient
      .from('daily_checkins')
      .select('id, check_in_date, check_in_time, predicted_readiness, shift_type, created_at')
      .eq('user_id', user.id)
      .eq('check_in_date', today)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('[GET /checkins/status] Error:', error)
      return c.json({ error: 'Failed to check status' }, 500)
    }

    // Check warm-up status for today
    const { data: warmUp } = await adminClient
      .from('warm_ups')
      .select('completed')
      .eq('user_id', user.id)
      .eq('warm_up_date', today)
      .eq('completed', true)
      .single()

    return c.json({
      hasCheckedIn: !!checkIn,
      hasActiveException,
      exception: hasActiveException ? {
        ...exception,
        case_status: caseStatus, // Include case_status from notes
      } : null,
      checkIn: checkIn ? {
        check_in_time: checkIn.check_in_time,
        predicted_readiness: checkIn.predicted_readiness,
        shift_type: checkIn.shift_type,
      } : null,
      warmUp: {
        completed: !!warmUp,
      },
    })
  } catch (error: any) {
    console.error('[GET /checkins/status] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get worker's check-in history with pagination (worker only)
checkins.get('/history', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (user.role !== 'worker') {
      console.warn(`[GET /checkins/history] SECURITY: User ${user.id} (${user.email}) with role '${user.role}' attempted to access worker-only endpoint. Access denied.`)
      return c.json({ error: 'Forbidden: This endpoint is only accessible to workers' }, 403)
    }

    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '10')
    const offset = (page - 1) * limit

    const adminClient = getAdminClient()

    // Get total count for pagination
    const { count } = await adminClient
      .from('daily_checkins')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    // Get paginated check-ins, ordered by date (newest first)
    const { data: checkIns, error } = await adminClient
      .from('daily_checkins')
      .select('id, check_in_date, check_in_time, predicted_readiness, shift_type, shift_start_time, shift_end_time, pain_level, fatigue_level, stress_level, sleep_quality, additional_notes, created_at')
      .eq('user_id', user.id)
      .order('check_in_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('[GET /checkins/history] Error:', error)
      return c.json({ error: 'Failed to fetch check-in history', details: error.message }, 500)
    }

    const totalPages = Math.ceil((count || 0) / limit)

    return c.json({
      checkIns: checkIns || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    })
  } catch (error: any) {
    console.error('[GET /checkins/history] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get warm-up status for today (worker only)
checkins.get('/warm-up/status', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (user.role !== 'worker') {
      console.warn(`[GET /checkins/warm-up/status] SECURITY: User ${user.id} (${user.email}) with role '${user.role}' attempted to access worker-only endpoint. Access denied.`)
      return c.json({ error: 'Forbidden: This endpoint is only accessible to workers' }, 403)
    }

    const today = getTodayDateString()
    const adminClient = getAdminClient()

    const { data: warmUp } = await adminClient
      .from('warm_ups')
      .select('completed')
      .eq('user_id', user.id)
      .eq('warm_up_date', today)
      .eq('completed', true)
      .single()

    return c.json({
      completed: !!warmUp,
    })
  } catch (error: any) {
    console.error('[GET /checkins/warm-up/status] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get worker's shift info and check-in window (worker only)
checkins.get('/shift-info', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      console.error('[GET /checkins/shift-info] No user in context')
      return c.json({ error: 'Unauthorized: User not found in context' }, 401)
    }

    // Additional role verification - double check to ensure user is actually a worker
    if (user.role !== 'worker') {
      console.warn(`[GET /checkins/shift-info] SECURITY: User ${user.id} (${user.email}) with role '${user.role}' attempted to access worker-only endpoint. Access denied.`)
      return c.json({ error: 'Forbidden: This endpoint is only accessible to workers' }, 403)
    }

    console.log(`[GET /checkins/shift-info] Request from user: ${user.id} (${user.email}), role: ${user.role}`)

    const shiftInfo = await getWorkerShiftInfo(user.id)
    
    // Get current time
    const now = new Date()
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    
    // Check if within window
    const isWithinWindow = isWithinCheckInWindow(
      currentTime,
      shiftInfo.checkInWindow.windowStart,
      shiftInfo.checkInWindow.windowEnd
    )
    
    const isWithinRecommended = isWithinCheckInWindow(
      currentTime,
      shiftInfo.checkInWindow.recommendedStart,
      shiftInfo.checkInWindow.recommendedEnd
    )

    return c.json({
      ...shiftInfo,
      currentTime,
      isWithinWindow,
      isWithinRecommended,
    })
  } catch (error: any) {
    console.error('[GET /checkins/shift-info] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get worker dashboard data (optimized - combines team, check-in status, shift info, and next shift)
checkins.get('/dashboard', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (user.role !== 'worker') {
      return c.json({ error: 'Forbidden: This endpoint is only accessible to workers' }, 403)
    }

    const adminClient = getAdminClient()
    const today = getTodayDateString()
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

    // Parallel queries for better performance
    const [
      teamMemberResult,
      exceptionResult,
      checkInResult,
      warmUpResult
    ] = await Promise.all([
      // Get team info
      adminClient
        .from('team_members')
        .select('team_id')
        .eq('user_id', user.id)
        .single(),
      // Get active exception
      adminClient
        .from('worker_exceptions')
        .select('id, exception_type, reason, start_date, end_date, notes')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single(),
      // Get today's check-in
      adminClient
        .from('daily_checkins')
        .select('id, check_in_date, check_in_time, predicted_readiness, shift_type')
        .eq('user_id', user.id)
        .eq('check_in_date', today)
        .single(),
      // Get warm-up status
      adminClient
        .from('warm_ups')
        .select('completed')
        .eq('user_id', user.id)
        .eq('warm_up_date', today)
        .eq('completed', true)
        .single()
    ])

    // Process team info
    let teamInfo = null
    if (teamMemberResult.data && !teamMemberResult.error) {
      const { data: team } = await adminClient
        .from('teams')
        .select('id, name, site_location')
        .eq('id', teamMemberResult.data.team_id)
        .single()

      if (team) {
        const displayName = team.site_location 
          ? `${team.name} • ${team.site_location}`
          : team.name
        teamInfo = { displayName }
      }
    }

    // Process exception
    let hasActiveException = false
    let exception = null
    if (exceptionResult.data && !exceptionResult.error) {
      const exc = exceptionResult.data
      const startDate = new Date(exc.start_date)
      const endDate = exc.end_date ? new Date(exc.end_date) : null
      const todayDate = new Date(today)

      if (todayDate >= startDate && (!endDate || todayDate <= endDate)) {
        hasActiveException = true
        const caseStatus = getCaseStatusFromNotes(exc.notes)
        exception = {
          exception_type: exc.exception_type,
          reason: exc.reason,
          start_date: exc.start_date,
          end_date: exc.end_date,
          case_status: caseStatus
        }
      }
    }

    // Process check-in
    const hasCheckedIn = !!(checkInResult.data && !checkInResult.error)
    const checkIn = checkInResult.data ? {
      check_in_time: checkInResult.data.check_in_time,
      predicted_readiness: checkInResult.data.predicted_readiness,
      shift_type: checkInResult.data.shift_type
    } : null

    // Process warm-up
    const hasWarmUp = !!(warmUpResult.data && !warmUpResult.error)

    // Get today's shift info
    const todayShiftInfo = await getWorkerShiftInfo(user.id)

    // OPTIMIZED: Get next shift info using optimized function (1 query instead of 14-730 queries)
    // If today has a schedule, find the NEXT one after today. Otherwise, find the next one including today.
    // This ensures Saturday/Sunday schedules are found correctly
    const searchStartDate = todayShiftInfo.hasShift ? new Date(Date.now() + 24 * 60 * 60 * 1000) : new Date() // Tomorrow if today has schedule, else today
    const nextShiftData = await getNextShiftInfoOptimized(user.id, searchStartDate)

    const nextShift = nextShiftData || {
      hasShift: false,
      shiftType: 'flexible' as const,
      checkInWindow: getCheckInWindow('flexible'),
      scheduleSource: 'none' as const,
      date: null,
      dayName: null,
      formattedDate: null,
    }

    return c.json({
      team: teamInfo,
      checkIn: {
        hasCheckedIn,
        hasActiveException,
        exception,
        checkIn,
        warmUp: { completed: hasWarmUp }
      },
      shift: {
        today: todayShiftInfo,
        next: nextShift
      }
    })
  } catch (error: any) {
    console.error('[GET /checkins/dashboard] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get worker's next shift info (tomorrow or next scheduled day)
checkins.get('/next-shift-info', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      console.error('[GET /checkins/next-shift-info] No user in context')
      return c.json({ error: 'Unauthorized: User not found in context' }, 401)
    }

    if (user.role !== 'worker') {
      console.warn(`[GET /checkins/next-shift-info] SECURITY: User ${user.id} (${user.email}) with role '${user.role}' attempted to access worker-only endpoint. Access denied.`)
      return c.json({ error: 'Forbidden: This endpoint is only accessible to workers' }, 403)
    }

    // Get tomorrow's date
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)

    // OPTIMIZED: Use optimized function (1 query instead of 14 queries)
    const nextShiftData = await getNextShiftInfoOptimized(user.id, tomorrow)

    if (nextShiftData) {
      return c.json(nextShiftData)
    }

    return c.json({
      hasShift: false,
      shiftType: 'flexible',
      checkInWindow: getCheckInWindow('flexible'),
      scheduleSource: 'none',
      date: null,
      dayName: null,
      formattedDate: null,
    })
  } catch (error: any) {
    console.error('[GET /checkins/next-shift-info] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Submit daily check-in (worker only)
checkins.post('/submit', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Additional role verification - double check to ensure user is actually a worker
    if (user.role !== 'worker') {
      console.warn(`[POST /checkins] SECURITY: User ${user.id} (${user.email}) with role '${user.role}' attempted to access worker-only endpoint. Access denied.`)
      return c.json({ error: 'Forbidden: This endpoint is only accessible to workers' }, 403)
    }

    const { painLevel, fatigueLevel, sleepQuality, stressLevel, additionalNotes, predictedReadiness } = await c.req.json()

    // Validate inputs
    if (
      typeof painLevel !== 'number' || painLevel < 0 || painLevel > 10 ||
      typeof fatigueLevel !== 'number' || fatigueLevel < 0 || fatigueLevel > 10 ||
      typeof sleepQuality !== 'number' || sleepQuality < 0 || sleepQuality > 12 ||
      typeof stressLevel !== 'number' || stressLevel < 0 || stressLevel > 10
    ) {
      return c.json({ error: 'Invalid input values' }, 400)
    }

    if (!['Green', 'Yellow', 'Red'].includes(predictedReadiness)) {
      return c.json({ error: 'Invalid predicted readiness value' }, 400)
    }

    // Validate: Additional notes are required when "Not fit to work" (Red)
    if (predictedReadiness === 'Red' && (!additionalNotes || additionalNotes.trim() === '')) {
      return c.json({ 
        error: 'Additional notes are required when you are not fit to work. Please explain your condition so your team leader can understand your situation.' 
      }, 400)
    }

    // Get shift info for this worker
    const shiftInfo = await getWorkerShiftInfo(user.id)
    
    // Get current time
    const now = new Date()
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    
    // Check if within check-in window (soft validation - allow but warn)
    const isWithinWindow = isWithinCheckInWindow(
      currentTime,
      shiftInfo.checkInWindow.windowStart,
      shiftInfo.checkInWindow.windowEnd
    )
    
    const isWithinRecommended = isWithinCheckInWindow(
      currentTime,
      shiftInfo.checkInWindow.recommendedStart,
      shiftInfo.checkInWindow.recommendedEnd
    )

    // Get user's team_id if they're part of a team
    const adminClient = getAdminClient()
    const { data: teamMember } = await adminClient
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .single()

    const today = getTodayDateString()

    // Insert or update check-in (one per day per user)
    const { data: checkIn, error: checkInError } = await adminClient
      .from('daily_checkins')
      .upsert([
        {
          user_id: user.id,
          team_id: teamMember?.team_id || null,
          pain_level: painLevel,
          fatigue_level: fatigueLevel,
          sleep_quality: sleepQuality,
          stress_level: stressLevel,
          additional_notes: additionalNotes || null,
          predicted_readiness: predictedReadiness,
          check_in_date: today,
          check_in_time: currentTime,
          shift_start_time: shiftInfo.shiftStart || null,
          shift_end_time: shiftInfo.shiftEnd || null,
          shift_type: shiftInfo.shiftType,
        },
      ], {
        onConflict: 'user_id,check_in_date',
      })
      .select()
      .single()

    if (checkInError) {
      console.error('Check-in error:', checkInError)
      return c.json({ error: 'Failed to save check-in', details: checkInError.message }, 500)
    }

    // Notify Team Leader if worker is "Not fit to work" (Red status)
    if (predictedReadiness === 'Red' && teamMember?.team_id) {
      try {
        // Get team leader's ID from team
        const { data: team, error: teamError } = await adminClient
          .from('teams')
          .select('team_leader_id, name')
          .eq('id', teamMember.team_id)
          .single()

        if (!teamError && team && team.team_leader_id) {
          // Get worker's details for notification
          const { data: workerDetails } = await adminClient
            .from('users')
            .select('id, email, first_name, last_name, full_name')
            .eq('id', user.id)
            .single()

          const workerName = workerDetails?.full_name || 
                            (workerDetails?.first_name && workerDetails?.last_name
                              ? `${workerDetails.first_name} ${workerDetails.last_name}`
                              : workerDetails?.email || 'Unknown Worker')

          // Automatically deactivate all active schedules for this worker
          // Team leader must reactivate them when worker is fit to work again
          let deactivatedScheduleCount = 0
          try {
            const { data: deactivatedSchedules, error: deactivateError } = await adminClient
              .from('worker_schedules')
              .update({ is_active: false })
              .eq('worker_id', user.id)
              .eq('is_active', true)
              .select('id')

            if (deactivateError) {
              console.error('[POST /checkins] Error deactivating schedules:', deactivateError)
              // Don't fail the check-in request if schedule deactivation fails
            } else {
              deactivatedScheduleCount = deactivatedSchedules?.length || 0
              if (deactivatedScheduleCount > 0) {
                console.log(`[POST /checkins] Automatically deactivated ${deactivatedScheduleCount} active schedule(s) for worker ${workerName} (Not fit to work)`)
              }
            }
          } catch (deactivateScheduleError: any) {
            console.error('[POST /checkins] Error in schedule deactivation process:', deactivateScheduleError)
            // Don't fail the check-in request if schedule deactivation fails
          }

          // Create notification for team leader
          const notification = {
            user_id: team.team_leader_id,
            type: 'worker_not_fit_to_work',
            title: '⚠️ Worker Not Fit to Work',
            message: `${workerName} has submitted a check-in indicating they are not fit to work. ${deactivatedScheduleCount > 0 ? `${deactivatedScheduleCount} schedule(s) have been automatically deactivated.` : ''}`,
            data: {
              check_in_id: checkIn.id,
              worker_id: user.id,
              worker_name: workerName,
              worker_email: workerDetails?.email || '',
              team_id: teamMember.team_id,
              team_name: team.name || '',
              check_in_date: today,
              check_in_time: currentTime,
              pain_level: painLevel,
              fatigue_level: fatigueLevel,
              sleep_quality: sleepQuality,
              stress_level: stressLevel,
              additional_notes: additionalNotes || null,
              shift_start_time: shiftInfo.shiftStart || null,
              shift_end_time: shiftInfo.shiftEnd || null,
              shift_type: shiftInfo.shiftType,
              schedules_deactivated: deactivatedScheduleCount,
            },
            is_read: false,
          }

          const { error: notifyError } = await adminClient
            .from('notifications')
            .insert([notification])

          if (notifyError) {
            console.error('[POST /checkins] Error creating notification for team leader:', notifyError)
            // Don't fail the check-in request if notification fails
          } else {
            console.log(`[POST /checkins] Notification sent to team leader ${team.team_leader_id} for worker ${workerName} (Not fit to work)`)
          }
        }
      } catch (notificationError: any) {
        console.error('[POST /checkins] Error in notification process:', notificationError)
        // Don't fail the check-in request if notification fails
      }
    }

    // Cache invalidation removed - cache.js was deleted as unused code

    return c.json({
      message: 'Check-in submitted successfully',
      checkIn,
      shiftInfo: {
        ...shiftInfo,
        isWithinWindow,
        isWithinRecommended,
        currentTime,
      },
    }, 201)
  } catch (error: any) {
    console.error('Submit check-in error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark warm-up as complete (worker only)
checkins.post('/warm-up', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Additional role verification - double check to ensure user is actually a worker
    if (user.role !== 'worker') {
      console.warn(`[POST /checkins/warm-up] SECURITY: User ${user.id} (${user.email}) with role '${user.role}' attempted to access worker-only endpoint. Access denied.`)
      return c.json({ error: 'Forbidden: This endpoint is only accessible to workers' }, 403)
    }

    // Get user's team_id if they're part of a team
    const { data: teamMember } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .single()

    const today = getTodayDateString()

    // Insert or update warm-up (one per day per user)
    const { data: warmUp, error: warmUpError } = await supabase
      .from('warm_ups')
      .upsert([
        {
          user_id: user.id,
          team_id: teamMember?.team_id || null,
          completed: true,
          warm_up_date: today,
        },
      ], {
        onConflict: 'user_id,warm_up_date',
      })
      .select()
      .single()

    if (warmUpError) {
      console.error('Warm-up error:', warmUpError)
      return c.json({ error: 'Failed to save warm-up', details: warmUpError.message }, 500)
    }

    return c.json({
      message: 'Warm-up marked as complete',
      warmUp,
    }, 201)
  } catch (error: any) {
    console.error('Warm-up error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get worker's active rehabilitation plan
checkins.get('/rehabilitation-plan', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // First, get worker exceptions for this user
    const { data: exceptions, error: exceptionsError } = await adminClient
      .from('worker_exceptions')
      .select('id')
      .eq('user_id', user.id)

    if (exceptionsError) {
      console.error('[GET /checkins/rehabilitation-plan] Error fetching exceptions:', exceptionsError)
      return c.json({ error: 'Failed to fetch rehabilitation plan', details: exceptionsError.message }, 500)
    }

    if (!exceptions || exceptions.length === 0) {
      return c.json({ plan: null, message: 'No active rehabilitation plan found' })
    }

    const exceptionIds = exceptions.map((e: any) => e.id)

    // Get active rehabilitation plan for this worker's exceptions
    const { data: plans, error } = await adminClient
      .from('rehabilitation_plans')
      .select(`
        *,
        worker_exceptions!rehabilitation_plans_exception_id_fkey(
          id,
          user_id,
          exception_type,
          reason
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
      .eq('status', 'active')
      .in('exception_id', exceptionIds)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      console.error('[GET /checkins/rehabilitation-plan] Error:', error)
      return c.json({ error: 'Failed to fetch rehabilitation plan', details: error.message }, 500)
    }

    if (!plans || plans.length === 0) {
      return c.json({ plan: null, message: 'No active rehabilitation plan found' })
    }

    const workerPlan = plans[0]

    // Sort exercises by order
    const exercises = (workerPlan.rehabilitation_exercises || [])
      .sort((a: any, b: any) => a.exercise_order - b.exercise_order)
      .map((ex: any) => ({
        id: ex.id,
        exercise_name: ex.exercise_name,
        repetitions: ex.repetitions,
        instructions: ex.instructions,
        video_url: ex.video_url,
        exercise_order: ex.exercise_order,
      }))

    const totalExercises = exercises.length

    // Get all completion records for this plan and user
    const { data: completions } = await adminClient
      .from('rehabilitation_plan_completions')
      .select('completion_date, exercise_id')
      .eq('plan_id', workerPlan.id)
      .eq('user_id', user.id)
      .order('completion_date', { ascending: true })

    // Group completions by date and count completed exercises per day
    // Normalize completion dates to YYYY-MM-DD format to avoid timezone issues
    const completionsByDate = new Map<string, Set<string>>()
    if (completions) {
      for (const completion of completions) {
        // Normalize date to YYYY-MM-DD format (consistent with clinician endpoint)
        const dateStr = typeof completion.completion_date === 'string' 
          ? completion.completion_date.split('T')[0]
          : formatDateString(new Date(completion.completion_date))
        
        if (!completionsByDate.has(dateStr)) {
          completionsByDate.set(dateStr, new Set())
        }
        completionsByDate.get(dateStr)!.add(completion.exercise_id)
      }
    }

    // Calculate progress based on actual completions
    // LOGIC: Day 1 = start_date (when plan was assigned by clinician)
    // Example: If plan assigned on November 3, 2025:
    //   - Day 1 = November 3, 2025 (start_date)
    //   - Day 2 = November 4, 2025
    //   - ... Day 7 = November 9, 2025 (if 7 days duration)
    // Use parseDateString to avoid timezone issues (consistent with clinician endpoint)
    const startDate = parseDateString(workerPlan.start_date)
    const endDate = parseDateString(workerPlan.end_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    // Calculate total days (inclusive: start and end dates both count)
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1

    // Find the current active day (first day where not all exercises are completed)
    // IMPORTANT: Even if a day is completed, we don't advance to next day until 6:00 AM of the next day
    let currentDay = 1
    let daysCompleted = 0
    const now = new Date() // Current date and time (not just date)

    // Iterate through each day from start date
    for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
      const dayDate = new Date(startDate)
      dayDate.setDate(dayDate.getDate() + dayOffset)
      // Use formatDateString for consistency with clinician endpoint
      const dayDateStr = formatDateString(dayDate)

      // If this day is in the future, stop here
      if (dayDate > today) {
        currentDay = dayOffset + 1
        break
      }

      // Check if all exercises are completed for this day
      const dayCompletions = completionsByDate.get(dayDateStr) || new Set()
      
      // Check if all exercises for this day are completed
      if (exercises.length === 0) {
        currentDay = dayOffset + 1
        break
      }
      
      const allExercisesCompleted = exercises.length > 0 && 
        exercises.every((ex: any) => dayCompletions.has(ex.id))

      if (allExercisesCompleted) {
        // This day is fully completed
        daysCompleted++
        
        // Check if we can advance to next day (must be past 6:00 AM of next day)
        if (dayOffset < totalDays - 1) {
          const nextDayDate = new Date(dayDate)
          nextDayDate.setDate(dayDate.getDate() + 1)
          nextDayDate.setHours(6, 0, 0, 0) // 6:00 AM of next day
          
          // Only advance to next day if current time is past 6:00 AM of next day
          if (now >= nextDayDate) {
            currentDay = dayOffset + 2 // Next day is available
            // Continue to check next day
          } else {
            // Day is completed but can't proceed yet - stay on this day
            currentDay = dayOffset + 1
            break
          }
        } else {
          // Last day completed
          currentDay = totalDays
          break
        }
      } else {
        // Found the first incomplete day - this is the current day
        currentDay = dayOffset + 1
        break
      }
    }

    // Ensure currentDay doesn't exceed totalDays
    currentDay = Math.min(currentDay, totalDays)

    // Calculate progress based on completed days
    const progress = totalDays > 0 ? Math.round((daysCompleted / totalDays) * 100) : 0

    return c.json({
      plan: {
        id: workerPlan.id,
        plan_name: workerPlan.plan_name || 'Recovery Plan',
        plan_description: workerPlan.plan_description || 'Daily recovery exercises and activities',
        duration: totalDays,
        startDate: workerPlan.start_date,
        endDate: workerPlan.end_date,
        progress,
        currentDay,
        daysCompleted,
        totalDays,
        exercises,
        status: workerPlan.status,
      }
    })
  } catch (error: any) {
    console.error('[GET /checkins/rehabilitation-plan] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get completed exercises for a specific date
checkins.get('/rehabilitation-plan/completions', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const planId = c.req.query('plan_id')
    const date = c.req.query('date') || getTodayDateString()

    if (!planId) {
      return c.json({ error: 'plan_id is required' }, 400)
    }

    const adminClient = getAdminClient()

    const { data: completions } = await adminClient
      .from('rehabilitation_plan_completions')
      .select('exercise_id')
      .eq('plan_id', planId)
      .eq('user_id', user.id)
      .eq('completion_date', date)

    const completedExerciseIds = (completions || []).map((c: any) => c.exercise_id)

    return c.json({ completed_exercise_ids: completedExerciseIds })
  } catch (error: any) {
    console.error('[GET /checkins/rehabilitation-plan/completions] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark exercise as completed for the current day of the plan
checkins.post('/rehabilitation-plan/complete-exercise', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { exercise_id, plan_id } = await c.req.json()

    if (!exercise_id || !plan_id) {
      return c.json({ error: 'exercise_id and plan_id are required' }, 400)
    }

    const adminClient = getAdminClient()
    
    // Get the plan to determine current day
    const { data: plan, error: planError } = await adminClient
      .from('rehabilitation_plans')
      .select('start_date, end_date, rehabilitation_exercises(id, exercise_order)')
      .eq('id', plan_id)
      .single()

    if (planError || !plan) {
      return c.json({ error: 'Plan not found' }, 404)
    }

    // Get all completion records for this plan and user to calculate current day
    const { data: completions } = await adminClient
      .from('rehabilitation_plan_completions')
      .select('completion_date, exercise_id')
      .eq('plan_id', plan_id)
      .eq('user_id', user.id)
      .order('completion_date', { ascending: true })

    // Calculate current day based on what's been completed
    // Use parseDateString to avoid timezone issues (consistent with other endpoints)
    const startDate = parseDateString(plan.start_date)
    const endDate = parseDateString(plan.end_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
    const exercises = (plan.rehabilitation_exercises || []).sort((a: any, b: any) => a.exercise_order - b.exercise_order)
    
    // Group completions by date (normalize dates to YYYY-MM-DD format)
    const completionsByDate = new Map<string, Set<string>>()
    if (completions) {
      for (const completion of completions) {
        // Normalize date to YYYY-MM-DD format (consistent with other endpoints)
        const dateStr = typeof completion.completion_date === 'string' 
          ? completion.completion_date.split('T')[0]
          : formatDateString(new Date(completion.completion_date))
        
        if (!completionsByDate.has(dateStr)) {
          completionsByDate.set(dateStr, new Set())
        }
        completionsByDate.get(dateStr)!.add(completion.exercise_id)
      }
    }
    
    // Find current day (first incomplete day)
    let currentDay = 1
    for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
      const dayDate = new Date(startDate)
      dayDate.setDate(dayDate.getDate() + dayOffset)
      // Use formatDateString for consistency
      const dayDateStr = formatDateString(dayDate)
      
      if (dayDate > today) {
        currentDay = dayOffset + 1
        break
      }
      
      const dayCompletions = completionsByDate.get(dayDateStr) || new Set()
      const allExercisesCompleted = exercises.length > 0 && exercises.every((ex: any) => dayCompletions.has(ex.id))
      
      if (!allExercisesCompleted) {
        currentDay = dayOffset + 1
        break
      } else if (dayOffset < totalDays - 1) {
        currentDay = dayOffset + 2
      }
    }
    
    // Calculate the date for the current day: start_date + (currentDay - 1)
    const currentDayDate = new Date(startDate)
    currentDayDate.setDate(startDate.getDate() + (currentDay - 1))
    // Use formatDateString for consistency
    const currentDayDateStr = formatDateString(currentDayDate)
    
    console.log(`[DEBUG] Completion: plan_id=${plan_id}, currentDay=${currentDay}, saving for date=${currentDayDateStr}`)

    // Check if already completed for this day
    const { data: existing } = await adminClient
      .from('rehabilitation_plan_completions')
      .select('id')
      .eq('plan_id', plan_id)
      .eq('exercise_id', exercise_id)
      .eq('user_id', user.id)
      .eq('completion_date', currentDayDateStr)
      .single()

    if (existing) {
      return c.json({ message: `Exercise already marked as completed for Day ${currentDay}` })
    }

    // Create completion record for the current day's date
    console.log(`[DEBUG] Saving completion: plan_id=${plan_id}, exercise_id=${exercise_id}, user_id=${user.id}, date=${currentDayDateStr} (Day ${currentDay})`)
    
    const { data: insertedData, error } = await adminClient
      .from('rehabilitation_plan_completions')
      .insert({
        plan_id,
        exercise_id,
        user_id: user.id,
        completion_date: currentDayDateStr,
      })
      .select()

    if (error) {
      console.error('[POST /checkins/rehabilitation-plan/complete-exercise] Error:', error)
      console.error('[POST /checkins/rehabilitation-plan/complete-exercise] Error details:', JSON.stringify(error, null, 2))
      return c.json({ error: 'Failed to mark exercise as completed', details: error.message }, 500)
    }

    console.log(`[DEBUG] Completion saved successfully:`, insertedData)

    // Verify the record was saved
    const { data: verifyData } = await adminClient
      .from('rehabilitation_plan_completions')
      .select('*')
      .eq('plan_id', plan_id)
      .eq('exercise_id', exercise_id)
      .eq('user_id', user.id)
      .eq('completion_date', currentDayDateStr)
      .single()

    console.log(`[DEBUG] Verified completion exists:`, verifyData)

    return c.json({ message: `Exercise marked as completed for Day ${currentDay}`, currentDay, completionDate: currentDayDateStr })
  } catch (error: any) {
    console.error('[POST /checkins/rehabilitation-plan/complete-exercise] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get worker appointments
checkins.get('/appointments', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const page = c.req.query('page') ? parseInt(c.req.query('page')!) : 1
    const limit = Math.min(parseInt(c.req.query('limit') || '15'), 100)
    const status = c.req.query('status') || 'all'

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
        users!appointments_clinician_id_fkey(
          id,
          email,
          first_name,
          last_name,
          full_name
        )
      `)
      .eq('worker_id', user.id)
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true })

    if (status !== 'all') {
      query = query.eq('status', status)
    }

    const countQuery = adminClient
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('worker_id', user.id)

    if (status !== 'all') {
      countQuery.eq('status', status)
    }

    const [countResult, appointmentsResult] = await Promise.all([
      countQuery,
      query.range(offset, offset + limit - 1)
    ])

    const { count } = countResult
    const { data: appointments, error } = appointmentsResult

    if (error) {
      console.error('[GET /checkins/appointments] Error:', error)
      return c.json({ error: 'Failed to fetch appointments', details: error.message }, 500)
    }

    // Format appointments (optimized - use helper functions from clinician routes)
    const formattedAppointments = (appointments || []).map((apt: any) => {
      const exception = apt.worker_exceptions
      const team = Array.isArray(exception?.teams) ? exception?.teams[0] : exception?.teams
      const clinician = Array.isArray(apt.users) ? apt.users[0] : apt.users

      // Generate case number using consistent format
      const caseId = exception?.id || apt.case_id
      const createdAt = exception?.created_at || apt.created_at
      
      // Import generateCaseNumber from clinician routes or use inline
      const date = new Date(createdAt)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      const seconds = String(date.getSeconds()).padStart(2, '0')
      const uuidPrefix = caseId?.substring(0, 4)?.toUpperCase() || 'CASE'
      const caseNumber = `CASE-${year}${month}${day}-${hours}${minutes}${seconds}-${uuidPrefix}`

      // Format clinician name
      const clinicianName = clinician?.full_name || 
        (clinician?.first_name && clinician?.last_name 
          ? `${clinician.first_name} ${clinician.last_name}`
          : clinician?.email || 'Unknown')

      return {
        id: apt.id,
        caseId: apt.case_id,
        caseNumber,
        clinicianId: apt.clinician_id,
        clinicianName,
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

    return c.json({
      appointments: formattedAppointments,
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
    console.error('[GET /checkins/appointments] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update appointment status (approve/decline)
checkins.patch('/appointments/:id/status', authMiddleware, requireRole(['worker']), async (c) => {
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

    const body = await c.req.json()
    const { status } = body

    // Validate status
    if (!status || typeof status !== 'string' || !['confirmed', 'declined'].includes(status)) {
      return c.json({ error: 'Invalid status. Must be "confirmed" or "declined"' }, 400)
    }

    const adminClient = getAdminClient()

    // Verify appointment exists and belongs to this worker
    const { data: appointment, error: appointmentError } = await adminClient
      .from('appointments')
      .select('id, worker_id, status')
      .eq('id', appointmentId)
      .eq('worker_id', user.id)
      .single()

    if (appointmentError || !appointment) {
      return c.json({ error: 'Appointment not found or not authorized' }, 404)
    }

    if (appointment.status !== 'pending') {
      return c.json({ error: 'Only pending appointments can be updated' }, 400)
    }

    // Update appointment status
    const { data: updatedAppointment, error: updateError } = await adminClient
      .from('appointments')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .select()
      .single()

    if (updateError) {
      console.error('[PATCH /checkins/appointments/:id/status] Error:', updateError)
      return c.json({ error: 'Failed to update appointment', details: updateError.message }, 500)
    }

    return c.json({
      appointment: updatedAppointment,
      message: `Appointment ${status === 'confirmed' ? 'confirmed' : 'declined'} successfully`,
    })
  } catch (error: any) {
    console.error('[PATCH /checkins/appointments/:id/status] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get notifications for worker
checkins.get('/notifications', authMiddleware, requireRole(['worker']), async (c) => {
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
      console.error('[GET /checkins/notifications] Error:', error)
      return c.json({ error: 'Failed to fetch notifications', details: error.message }, 500)
    }

    const { count: unreadCount, error: countError } = await adminClient
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)

    if (countError) {
      console.error('[GET /checkins/notifications] Error counting unread:', countError)
    }

    return c.json({
      notifications: notifications || [],
      unreadCount: unreadCount || 0,
    })
  } catch (error: any) {
    console.error('[GET /checkins/notifications] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark notification as read (worker)
checkins.patch('/notifications/:notificationId/read', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const notificationId = c.req.param('notificationId')
    const adminClient = getAdminClient()

    // Verify notification belongs to user before updating
    const { data: notification, error: fetchError } = await adminClient
      .from('notifications')
      .select('id, user_id, is_read')
      .eq('id', notificationId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !notification) {
      return c.json({ error: 'Notification not found or not authorized' }, 404)
    }

    if (notification.is_read) {
      return c.json({ message: 'Notification already marked as read' })
    }

    const { error: updateError } = await adminClient
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId)
      .eq('user_id', user.id) // Double-check ownership

    if (updateError) {
      console.error('[PATCH /checkins/notifications/:id/read] Error:', updateError)
      return c.json({ error: 'Failed to mark notification as read', details: updateError.message }, 500)
    }

    return c.json({ message: 'Notification marked as read' })
  } catch (error: any) {
    console.error('[PATCH /checkins/notifications/:id/read] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Mark all notifications as read (worker)
checkins.patch('/notifications/read-all', authMiddleware, requireRole(['worker']), async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    const { error: updateError } = await adminClient
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('is_read', false) // Only update unread notifications

    if (updateError) {
      console.error('[PATCH /checkins/notifications/read-all] Error:', updateError)
      return c.json({ error: 'Failed to mark all notifications as read', details: updateError.message }, 500)
    }

    return c.json({ message: 'All notifications marked as read' })
  } catch (error: any) {
    console.error('[PATCH /checkins/notifications/read-all] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

export default checkins

