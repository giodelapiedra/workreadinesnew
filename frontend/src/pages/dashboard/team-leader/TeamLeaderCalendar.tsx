import { useState, useEffect, useMemo, useCallback } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './TeamLeaderCalendar.css'

interface Worker {
  id: string
  email: string
  first_name?: string
  last_name?: string
  full_name?: string
}

interface WorkerSchedule {
  id: string
  worker_id: string
  scheduled_date?: string | null
  day_of_week?: number | null
  effective_date?: string | null
  expiry_date?: string | null
  start_time: string
  end_time: string
  notes?: string
  is_active: boolean
  users?: Worker
}

interface WorkerException {
  id: string
  user_id: string
  exception_type: string
  reason?: string
  start_date: string
  end_date?: string | null
  is_active: boolean
}

interface CheckIn {
  user_id: string
  check_in_date: string
  check_in_time?: string
  predicted_readiness?: string
}

interface TeamMember {
  id: string
  user_id: string
  users?: Worker
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

interface ScheduleBlock {
  type: 'shift' | 'out'
  workerId: string
  date: string
  startTime?: string
  endTime?: string
  status?: 'on_time' | 'early' | 'late' | null
  label: string
}

export function TeamLeaderCalendar() {
  const [schedules, setSchedules] = useState<WorkerSchedule[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [exceptions, setExceptions] = useState<WorkerException[]>([])
  const [checkIns, setCheckIns] = useState<CheckIn[]>([])
  const [loading, setLoading] = useState(true)
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    // Start of current week (Monday)
    const today = new Date()
    const day = today.getDay()
    const diff = today.getDate() - day + (day === 0 ? -6 : 1) // Adjust to Monday
    const monday = new Date(today)
    monday.setDate(diff)
    monday.setHours(0, 0, 0, 0)
    return monday
  })

  // Calculate week range (Monday to Sunday)
  const weekRange = useMemo(() => {
    const start = new Date(currentWeekStart)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      days: Array.from({ length: 7 }, (_, i) => {
        const date = new Date(start)
        date.setDate(date.getDate() + i)
        return date
      })
    }
  }, [currentWeekStart])

  useEffect(() => {
    loadData()
  }, [weekRange.startDate, weekRange.endDate])

  const loadData = async () => {
    try {
      setLoading(true)
      await Promise.all([
        loadMembers(),
        loadSchedules(),
        loadExceptions(),
        loadCheckIns()
      ])
    } catch (error) {
      console.error('[TeamLeaderCalendar] Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMembers = async () => {
    try {
      const result = await apiClient.get<{ team: any; members: TeamMember[] }>(API_ROUTES.TEAMS.BASE)
      if (isApiError(result)) throw new Error(getApiErrorMessage(result) || 'Failed to fetch team members')
      setMembers(result.data.members || [])
    } catch (error) {
      console.error('[TeamLeaderCalendar] Error loading members:', error)
      setMembers([])
    }
  }

  const loadSchedules = async () => {
    try {
      const result = await apiClient.get<{ schedules: WorkerSchedule[] }>(
        `${API_ROUTES.SCHEDULES.WORKERS}?startDate=${weekRange.startDate}&endDate=${weekRange.endDate}&_t=${Date.now()}`,
        { headers: { 'Cache-Control': 'no-cache' } }
      )
      if (isApiError(result)) throw new Error(getApiErrorMessage(result) || 'Failed to fetch schedules')
      setSchedules(result.data.schedules || [])
    } catch (error) {
      console.error('[TeamLeaderCalendar] Error loading schedules:', error)
      setSchedules([])
    }
  }

  const loadExceptions = async () => {
    try {
      const result = await apiClient.get<{ exceptions: WorkerException[] }>(API_ROUTES.TEAMS.EXCEPTIONS)
      if (isApiError(result)) throw new Error(getApiErrorMessage(result) || 'Failed to fetch exceptions')
      setExceptions((result.data.exceptions || []).filter((exc: WorkerException) => exc.is_active))
    } catch (error) {
      console.error('[TeamLeaderCalendar] Error loading exceptions:', error)
      setExceptions([])
    }
  }

  const loadCheckIns = async () => {
    try {
      const params = new URLSearchParams({
        startDate: weekRange.startDate,
        endDate: weekRange.endDate,
      })
      
      const result = await apiClient.get<{ checkIns: any }>(
        `${API_ROUTES.TEAMS.CHECKINS}?${params.toString()}`
      )
      
      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch check-ins')
      }
      
      const data = result.data
      // Flatten check-ins array
      const allCheckIns: CheckIn[] = []
      if (data.checkIns) {
        Object.values(data.checkIns).forEach((dayCheckIns: any) => {
          if (Array.isArray(dayCheckIns)) {
            dayCheckIns.forEach((checkIn: any) => {
              allCheckIns.push({
                user_id: checkIn.user_id || checkIn.userId,
                check_in_date: checkIn.check_in_date || checkIn.date,
                check_in_time: checkIn.check_in_time,
                predicted_readiness: checkIn.predicted_readiness
              })
            })
          }
        })
      }
      setCheckIns(allCheckIns)
    } catch (error) {
      console.error('[TeamLeaderCalendar] Error loading check-ins:', error)
      setCheckIns([])
    }
  }

  // Get worker name helper
  const getWorkerName = useCallback((worker: Worker | undefined): string => {
    if (!worker) return 'Unknown'
    if (worker.full_name) return worker.full_name
    if (worker.first_name && worker.last_name) return `${worker.first_name} ${worker.last_name}`
    if (worker.first_name) return worker.first_name
    return worker.email?.split('@')[0] || 'Unknown'
  }, [])

  // Get worker initials for avatar
  const getWorkerInitials = useCallback((worker: Worker | undefined): string => {
    const name = getWorkerName(worker)
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }, [getWorkerName])

  // Get schedules for a specific date
  const getSchedulesForDate = useCallback((date: Date): WorkerSchedule[] => {
    const dayOfWeek = date.getDay()
    const dateStr = date.toISOString().split('T')[0]
    const dateObj = new Date(dateStr)
    dateObj.setHours(0, 0, 0, 0)

    return schedules.filter(schedule => {
      if (!schedule.is_active) return false

      // Single-date schedule
      if (schedule.scheduled_date && (schedule.day_of_week === null || schedule.day_of_week === undefined)) {
        return schedule.scheduled_date === dateStr
      }

      // Recurring schedule
      if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        if (schedule.day_of_week !== dayOfWeek) return false

        if (schedule.effective_date) {
          const effectiveDate = new Date(schedule.effective_date)
          effectiveDate.setHours(0, 0, 0, 0)
          if (dateObj < effectiveDate) return false
        }

        if (schedule.expiry_date) {
          const expiryDate = new Date(schedule.expiry_date)
          expiryDate.setHours(23, 59, 59, 999)
          if (dateObj > expiryDate) return false
        }

        return true
      }

      return false
    })
  }, [schedules])

  // Check if worker has exception for date
  const hasException = useCallback((workerId: string, date: Date): WorkerException | null => {
    const dateStr = date.toISOString().split('T')[0]
    const checkDate = new Date(dateStr)
    checkDate.setHours(0, 0, 0, 0)

    return exceptions.find(exc => {
      if (exc.user_id !== workerId || !exc.is_active) return false
      const startDate = new Date(exc.start_date)
      startDate.setHours(0, 0, 0, 0)
      const endDate = exc.end_date ? new Date(exc.end_date) : null
      if (endDate) endDate.setHours(23, 59, 59, 999)

      return checkDate >= startDate && (!endDate || checkDate <= endDate)
    }) || null
  }, [exceptions])

  // Get check-in status for worker on date
  const getCheckInStatus = useCallback((workerId: string, date: Date, scheduleStartTime?: string): 'on_time' | 'early' | 'late' | null => {
    const dateStr = date.toISOString().split('T')[0]
    const checkIn = checkIns.find(ci => ci.user_id === workerId && ci.check_in_date === dateStr)
    
    if (!checkIn || !checkIn.check_in_time || !scheduleStartTime) return null

    // Simple status based on predicted_readiness (can be enhanced with actual time comparison)
    if (checkIn.predicted_readiness === 'Green') return 'on_time'
    if (checkIn.predicted_readiness === 'Yellow') return 'late'
    return null
  }, [checkIns])

  // Format exception type to readable label
  const formatExceptionType = useCallback((exceptionType: string): string => {
    if (!exceptionType) return 'Exception'
    return exceptionType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }, [])

  // Build schedule blocks for the week (no duplications)
  const scheduleBlocks = useMemo(() => {
    const blocks: ScheduleBlock[] = []

    weekRange.days.forEach((date) => {
      const dateStr = date.toISOString().split('T')[0]
      
      members.forEach(member => {
        const workerId = member.user_id

        // Check for exception first (Out/OOO) - takes priority over schedules
        const exception = hasException(workerId, date)
        if (exception) {
          const exceptionTypeLabel = formatExceptionType(exception.exception_type || 'exception')
          const isAllDay = !exception.reason || exception.reason.toLowerCase().includes('all day')
          
          // Show exception type as main label, with reason if available
          let exceptionLabel: string
          if (isAllDay) {
            exceptionLabel = `${exceptionTypeLabel} - All day`
          } else if (exception.reason && exception.reason.trim()) {
            exceptionLabel = `${exceptionTypeLabel} - ${exception.reason}`
          } else {
            exceptionLabel = exceptionTypeLabel
          }
          
          blocks.push({
            type: 'out',
            workerId,
            date: dateStr,
            label: exceptionLabel
          })
          return // Exception takes priority, don't show schedule
        }

        // Check for schedules
        const daySchedules = getSchedulesForDate(date).filter(s => s.worker_id === workerId)
        
        if (daySchedules.length > 0) {
          daySchedules.forEach(schedule => {
            const status = getCheckInStatus(workerId, date, schedule.start_time)
            blocks.push({
              type: 'shift',
              workerId,
              date: dateStr,
              startTime: schedule.start_time,
              endTime: schedule.end_time,
              status,
              label: `${schedule.start_time.substring(0, 5)} - ${schedule.end_time.substring(0, 5)}`
            })
          })
        }
      })
    })

    return blocks
  }, [weekRange.days, members, hasException, getSchedulesForDate, getCheckInStatus, formatExceptionType])

  // Get schedule blocks for a worker on a specific date
  const getBlocksForWorkerDate = useCallback((workerId: string, date: string): ScheduleBlock[] => {
    return scheduleBlocks.filter(block => block.workerId === workerId && block.date === date)
  }, [scheduleBlocks])

  // Navigate weeks
  const goToPreviousWeek = () => {
    const newDate = new Date(currentWeekStart)
    newDate.setDate(newDate.getDate() - 7)
    setCurrentWeekStart(newDate)
  }

  const goToNextWeek = () => {
    const newDate = new Date(currentWeekStart)
    newDate.setDate(newDate.getDate() + 7)
    setCurrentWeekStart(newDate)
  }

  const goToToday = () => {
    const today = new Date()
    const day = today.getDay()
    const diff = today.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(today)
    monday.setDate(diff)
    monday.setHours(0, 0, 0, 0)
    setCurrentWeekStart(monday)
  }

  // Check if date is today
  const isToday = (date: Date): boolean => {
    const today = new Date()
    return date.toDateString() === today.toDateString()
  }

  // Only show members who have schedules in this week
  const filteredMembers = useMemo(() => {
    return members.filter(member => {
      return weekRange.days.some(date => {
        const dateStr = date.toISOString().split('T')[0]
        const blocks = getBlocksForWorkerDate(member.user_id, dateStr)
        return blocks.length > 0
      })
    })
  }, [members, weekRange.days, getBlocksForWorkerDate])

  return (
    <DashboardLayout>
      <div className="weekly-calendar-container">
        <div className="weekly-calendar-header">
          <h1>Weekly Schedule</h1>
          <div className="calendar-controls">
            <button onClick={goToPreviousWeek} className="nav-button">← Previous</button>
            <div className="week-display">
              <h2>
                {MONTHS[weekRange.days[0].getMonth()]} {weekRange.days[0].getDate()} - {MONTHS[weekRange.days[6].getMonth()]} {weekRange.days[6].getDate()}, {weekRange.days[0].getFullYear()}
              </h2>
            </div>
            <button onClick={goToNextWeek} className="nav-button">Next →</button>
            <button onClick={goToToday} className="today-button">Today</button>
          </div>
        </div>

        {loading ? (
          <Loading message="Loading schedule..." size="medium" />
        ) : (
          <div className="weekly-calendar-wrapper">
            {/* Calendar Grid */}
            <div className="calendar-grid-wrapper">
              <div className="calendar-grid">
                {/* Day Headers */}
                <div className="grid-header-row">
                  <div className="grid-header-cell member-header-cell">
                    <span>Member</span>
                  </div>
                  {weekRange.days.map((date, index) => {
                    const dayName = DAYS_OF_WEEK[date.getDay()]
                    const dayNum = date.getDate()
                    const month = MONTHS[date.getMonth()].substring(0, 3).toUpperCase()
                    const isTodayDate = isToday(date)
                    return (
                      <div key={index} className={`grid-header-cell day-header ${isTodayDate ? 'today' : ''}`}>
                        <div className="day-name">{dayName}</div>
                        <div className="day-date">{dayNum} {month}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Member Rows */}
                {filteredMembers.length === 0 ? (
                  <div className="no-schedules-row">
                    <div className="no-schedules-message">No schedules this week</div>
                  </div>
                ) : (
                  filteredMembers.map(member => {
                    const worker = member.users
                    const workerName = getWorkerName(worker)
                    const initials = getWorkerInitials(worker)
                    
                    return (
                      <div key={member.user_id} className="grid-row">
                        {/* Member Cell */}
                        <div className="member-cell">
                          <div className="member-avatar-small">{initials}</div>
                          <span className="member-name-small">{workerName}</span>
                        </div>

                        {/* Day Cells */}
                        {weekRange.days.map((date, dayIndex) => {
                          const dateStr = date.toISOString().split('T')[0]
                          const blocks = getBlocksForWorkerDate(member.user_id, dateStr)
                          const isTodayDate = isToday(date)

                          return (
                            <div key={dayIndex} className={`grid-cell ${isTodayDate ? 'today' : ''}`}>
                              {blocks.map((block, blockIndex) => (
                                <div
                                  key={blockIndex}
                                  className={`schedule-block ${block.type} ${block.status ? `status-${block.status}` : ''}`}
                                  title={block.label}
                                >
                                  <div className="block-content">
                                    <div className="block-label">{block.label}</div>
                                    {block.status && (
                                      <div className={`status-indicator ${block.status}`}>
                                        {block.status === 'on_time' && '●'}
                                        {block.status === 'early' && '●'}
                                        {block.status === 'late' && '●'}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
