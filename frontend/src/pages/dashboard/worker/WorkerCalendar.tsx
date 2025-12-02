import { useState, useEffect } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { formatTime, formatDate } from '../../../shared/date'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './WorkerCalendar.css'

interface WorkerSchedule {
  id: string
  display_date: string
  scheduled_date?: string | null
  start_time: string
  end_time: string
  requires_daily_checkin?: boolean
  daily_checkin_start_time?: string
  daily_checkin_end_time?: string
  check_in_window_start?: string
  check_in_window_end?: string
  is_active: boolean
  day_of_week?: number | null
  effective_date?: string
  expiry_date?: string
  notes?: string
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]


export function WorkerCalendar() {
  const [schedules, setSchedules] = useState<WorkerSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    loadSchedules()
  }, [currentDate])

  const loadSchedules = async () => {
    try {
      setLoading(true)
      // Get start and end of current month
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth()
      const startDate = new Date(year, month, 1)
      const endDate = new Date(year, month + 1, 0)
      
      const startDateStr = formatDate(startDate)
      const endDateStr = formatDate(endDate)

      setErrorMessage(null)

      const result = await apiClient.get<{ schedules: WorkerSchedule[] }>(
        `${API_ROUTES.SCHEDULES.MY_SCHEDULE}?startDate=${startDateStr}&endDate=${endDateStr}`,
        {
          headers: { 'Cache-Control': 'no-cache' },
          timeout: 15000,
        }
      )
      
      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch schedules')
      }
      setSchedules(result.data.schedules || [])
    } catch (error: any) {
      console.error('[WorkerCalendar] Error loading schedules:', error)
      setSchedules([])
      if (error?.name === 'AbortError') {
        setErrorMessage('Connection timed out. Please check your internet connection and try again.')
      } else {
        setErrorMessage('Unable to load schedules. Please refresh once your connection stabilizes.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Get the first day of the month and number of days
  const getMonthData = () => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDayOfWeek = firstDay.getDay()

    return { year, month, daysInMonth, startingDayOfWeek }
  }

  // Check if a date has a schedule
  const getSchedulesForDate = (date: Date): WorkerSchedule[] => {
    const dateStr = formatDate(date)
    return schedules.filter(schedule => schedule.display_date === dateStr && schedule.is_active)
  }

  // Helper: Get today's date (normalized to midnight)
  const getToday = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
  }

  // Check if date is in the past
  const isPastDate = (date: Date): boolean => {
    const checkDate = new Date(date)
    checkDate.setHours(0, 0, 0, 0)
    return checkDate < getToday()
  }

  // Check if date is today
  const isToday = (date: Date): boolean => {
    const today = getToday()
    const checkDate = new Date(date)
    checkDate.setHours(0, 0, 0, 0)
    return checkDate.getTime() === today.getTime()
  }

  // Navigate months
  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
    setSelectedDate(null)
  }

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
    setSelectedDate(null)
  }

  const goToToday = () => {
    setCurrentDate(new Date())
    setSelectedDate(new Date())
  }

  const { year, month, daysInMonth, startingDayOfWeek } = getMonthData()

  const renderCalendarDays = () => {
    const days: JSX.Element[] = []

    // Empty cells before month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(<div key={`empty-${i}`} className="worker-calendar-day empty"></div>)
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day)
      const daySchedules = getSchedulesForDate(date)
      const hasSchedule = daySchedules.length > 0
      const hasDailyCheckIn = daySchedules.some(s => s.requires_daily_checkin)
      const isPast = isPastDate(date)
      const isTodayDate = isToday(date)
      const isSelected = selectedDate?.getTime() === date.getTime()

      days.push(
        <div
          key={day}
          className={`worker-calendar-day ${hasSchedule ? 'has-schedule' : ''} ${isPast ? 'past-date' : ''} ${isTodayDate ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
          onClick={() => setSelectedDate(date)}
        >
          <div className="day-number">{day}</div>
          {hasSchedule && (
            <div className="schedule-indicators">
              {daySchedules.slice(0, 2).map((schedule) => (
                <div key={schedule.id} className={`schedule-time-badge ${isPast ? 'past' : ''}`}>
                  {schedule.start_time.substring(0, 5)} - {schedule.end_time.substring(0, 5)}
                </div>
              ))}
              {daySchedules.length > 2 && (
                <div className="schedule-more-badge">
                  +{daySchedules.length - 2}
                </div>
              )}
              {hasDailyCheckIn && (
                <div className="daily-checkin-badge" title="Daily Check-In Required">
                  ✓
                </div>
              )}
            </div>
          )}
        </div>
      )
    }

    return days
  }

  const selectedDateSchedules = selectedDate ? getSchedulesForDate(selectedDate) : []

  return (
    <DashboardLayout>
      <div className="worker-calendar-container">
        <div className="worker-calendar-header">
          <h1>My Schedule Calendar</h1>
          <p className="calendar-subtitle">View your assigned work dates and daily check-in requirements</p>
        </div>

        {loading ? (
          <Loading message="Loading calendar..." size="large" fullScreen />
        ) : errorMessage ? (
          <div className="worker-calendar-error">
            <p>{errorMessage}</p>
            <button onClick={loadSchedules} className="retry-button">Retry</button>
          </div>
        ) : (
          <>
            <div className="calendar-controls">
              <button onClick={goToPreviousMonth} className="nav-button">
                ← Previous
              </button>
              <div className="month-year">
                <h2>{MONTHS[month]} {year}</h2>
              </div>
              <button onClick={goToNextMonth} className="nav-button">
                Next →
              </button>
              <button onClick={goToToday} className="today-button">
                Today
              </button>
            </div>

            <div className="calendar-wrapper">
              <div className="calendar-grid">
                {/* Day headers */}
                {DAYS_OF_WEEK.map(day => (
                  <div key={day} className="calendar-day-header">
                    {day}
                  </div>
                ))}

                {/* Calendar days */}
                {renderCalendarDays()}
              </div>

              {/* Selected date details */}
              {selectedDate && (
                <div className="calendar-details">
                  <div className="details-header">
                    <h3>
                      {selectedDate.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </h3>
                    {isPastDate(selectedDate) && (
                      <span className="past-badge">Past</span>
                    )}
                    {isToday(selectedDate) && (
                      <span className="today-badge">Today</span>
                    )}
                  </div>
                  <div className="details-content">
                    {selectedDateSchedules.length === 0 ? (
                      <p className="no-schedule-text">No schedule assigned for this date</p>
                    ) : (
                      <div className="schedule-list">
                        {selectedDateSchedules.map((schedule) => (
                          <div key={schedule.id} className="schedule-detail-card">
                            <div className="schedule-time">
                              {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                            </div>
                            {schedule.requires_daily_checkin && (
                              <div className="daily-checkin-notice">
                                <strong>✓ Daily Check-In Required</strong>
                                {schedule.daily_checkin_start_time && schedule.daily_checkin_end_time && (
                                  <div className="checkin-window">
                                    Check-in window: {formatTime(schedule.daily_checkin_start_time)} - {formatTime(schedule.daily_checkin_end_time)}
                                  </div>
                                )}
                              </div>
                            )}
                            {schedule.notes && (
                              <div className="schedule-note">
                                <strong>Notes:</strong> {schedule.notes}
                              </div>
                            )}
                            {(schedule.effective_date || schedule.expiry_date) && (
                              <div className="schedule-dates">
                                {schedule.effective_date && (
                                  <small>From: {new Date(schedule.effective_date).toLocaleDateString()}</small>
                                )}
                                {schedule.expiry_date && (
                                  <small>Until: {new Date(schedule.expiry_date).toLocaleDateString()}</small>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="calendar-legend">
              <div className="legend-item">
                <div className="schedule-time-badge">08:00 - 17:00</div>
                <span>Upcoming Schedule</span>
              </div>
              <div className="legend-item">
                <div className="schedule-time-badge past-schedule">08:00 - 17:00</div>
                <span>Past Schedule</span>
              </div>
              <div className="legend-item">
                <div className="daily-checkin-badge">✓</div>
                <span>Daily Check-In Required</span>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}




