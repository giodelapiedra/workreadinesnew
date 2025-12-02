import { useState, useEffect, useCallback, useMemo } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { API_BASE_URL } from '../../../config/api'
import { API_ROUTES } from '../../../config/apiRoutes'
import { buildUrl } from '../../../utils/queryBuilder'
import './ClinicianCalendar.css'

interface Appointment {
  id: string
  caseId: string
  caseNumber: string
  workerId: string
  workerName: string
  workerEmail: string
  teamName: string
  siteLocation: string
  appointmentDate: string
  appointmentTime: string
  durationMinutes: number
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'declined'
  appointmentType: 'consultation' | 'follow_up' | 'assessment' | 'review' | 'other'
  location: string
  notes: string
  cancellationReason: string
  createdAt: string
  updatedAt: string
}

const TYPE_LABELS: Record<string, string> = {
  consultation: 'Consultation',
  follow_up: 'Follow-up',
  assessment: 'Assessment',
  review: 'Review',
  other: 'Other',
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  confirmed: '#3b82f6',
  completed: '#10b981',
  cancelled: '#ef4444',
  declined: '#6b7280',
}

export function ClinicianCalendar() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)

  // Fetch all appointments (optimized - fetch all at once for calendar)
  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      // Fetch all appointments (no pagination for calendar view)
      const url = buildUrl(API_ROUTES.CLINICIAN.APPOINTMENTS, {
        limit: '1000',
        status: 'all',
        date: 'all'
      })
      const response = await fetch(
        `${API_BASE_URL}${url}`,
        {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch appointments' }))
        throw new Error(errorData.error || 'Failed to fetch appointments')
      }

      const data = await response.json()
      setAppointments(data.appointments || [])
    } catch (err: any) {
      console.error('Error fetching appointments:', err)
      setError(err.message || 'Failed to load appointments')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAppointments()
  }, [fetchAppointments])

  // Close sidebar when clicking outside
  useEffect(() => {
    if (showSidebar) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [showSidebar])

  // Group appointments by date
  const appointmentsByDate = useMemo(() => {
    const grouped = new Map<string, Appointment[]>()
    appointments.forEach((apt) => {
      const dateKey = apt.appointmentDate
      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, [])
      }
      grouped.get(dateKey)!.push(apt)
    })
    return grouped
  }, [appointments])

  // Calculate summary counts for display
  const { upcomingCount, pastCount } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]

    let upcoming = 0
    let past = 0

    appointments.forEach((apt) => {
      const aptDate = new Date(apt.appointmentDate)
      aptDate.setHours(0, 0, 0, 0)
      const aptDateStr = aptDate.toISOString().split('T')[0]

      if (aptDateStr >= todayStr) {
        upcoming++
      } else {
        past++
      }
    })

    return { upcomingCount: upcoming, pastCount: past }
  }, [appointments])

  // Get appointments for a specific date
  const getAppointmentsForDate = (date: Date): Appointment[] => {
    const dateStr = date.toISOString().split('T')[0]
    return appointmentsByDate.get(dateStr) || []
  }

  // Calendar month view helpers
  const getDaysInMonth = (date: Date): Date[] => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDayOfWeek = firstDay.getDay()

    const days: Date[] = []

    // Add previous month's trailing days
    const prevMonth = new Date(year, month - 1, 0)
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      days.push(new Date(year, month - 1, prevMonth.getDate() - i))
    }

    // Add current month's days
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day))
    }

    // Add next month's leading days to fill the grid
    const remainingDays = 42 - days.length // 6 rows × 7 days
    for (let day = 1; day <= remainingDays; day++) {
      days.push(new Date(year, month + 1, day))
    }

    return days
  }

  const formatTime = (time: string): string => {
    const [hours, minutes] = time.split(':')
    const hour = parseInt(hours, 10)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour % 12 || 12
    return `${displayHour}:${minutes} ${ampm}`
  }

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev)
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1)
      } else {
        newDate.setMonth(prev.getMonth() + 1)
      }
      return newDate
    })
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  const isToday = (date: Date): boolean => {
    const today = new Date()
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  const isCurrentMonth = (date: Date): boolean => {
    return date.getMonth() === currentDate.getMonth() && date.getFullYear() === currentDate.getFullYear()
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="clinician-calendar">
          <Loading message="Loading calendar..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="clinician-calendar">
          <div className="calendar-error">
            <p>Error: {error}</p>
            <button onClick={fetchAppointments} className="retry-button">
              Retry
            </button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const monthDays = getDaysInMonth(currentDate)
  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <DashboardLayout>
      <div className="clinician-calendar">
        {/* Header */}
        <header className="calendar-header">
          <div className="header-top">
            <div className="header-left">
              <h1 className="calendar-title">Appointment Calendar</h1>
              <p className="calendar-subtitle">View your upcoming and past appointments</p>
            </div>
            <button onClick={fetchAppointments} className="refresh-button" title="Refresh calendar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
          </div>

          {/* Calendar Navigation */}
          <div className="calendar-controls">
            <div className="month-navigation">
              <button onClick={() => navigateMonth('prev')} className="nav-button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
              <h2 className="current-month">{monthName}</h2>
              <button onClick={() => navigateMonth('next')} className="nav-button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </div>
            <button onClick={goToToday} className="today-button">
              Today
            </button>
          </div>
        </header>

        {/* Summary Cards */}
        <div className="calendar-summary">
          <div className="summary-card">
            <div className="summary-icon" style={{ backgroundColor: '#dbeafe' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </div>
            <div className="summary-content">
              <p className="summary-label">Upcoming</p>
              <p className="summary-value">{upcomingCount}</p>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-icon" style={{ backgroundColor: '#f3f4f6' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
              </svg>
            </div>
            <div className="summary-content">
              <p className="summary-label">Past</p>
              <p className="summary-value">{pastCount}</p>
            </div>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="calendar-container">
          <div className="calendar-grid">
            {/* Week day headers */}
            {weekDays.map((day) => (
              <div key={day} className="calendar-day-header">
                {day}
              </div>
            ))}

            {/* Calendar days */}
            {monthDays.map((day, index) => {
              const dayAppointments = getAppointmentsForDate(day)
              const isCurrentMonthDay = isCurrentMonth(day)
              const isTodayDay = isToday(day)
              const visibleAppointments = dayAppointments.slice(0, 3)
              const hasMore = dayAppointments.length > 3

              return (
                <div
                  key={index}
                  className={`calendar-day ${!isCurrentMonthDay ? 'other-month' : ''} ${isTodayDay ? 'today' : ''}`}
                >
                  <div className="day-number">{day.getDate()}</div>
                  {dayAppointments.length > 0 && (
                    <div className="day-appointments-list">
                      {visibleAppointments.map((apt) => {
                        const truncatedName = apt.workerName.length > 10 ? apt.workerName.substring(0, 10) + '...' : apt.workerName
                        return (
                          <div
                            key={apt.id}
                            className="appointment-block"
                            style={{ backgroundColor: STATUS_COLORS[apt.status] || '#6b7280' }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedAppointment(apt)
                              setShowSidebar(true)
                            }}
                            title={`${apt.workerName} - ${formatTime(apt.appointmentTime)}`}
                          >
                            <div className="appointment-block-time">{formatTime(apt.appointmentTime)}</div>
                            <div className="appointment-block-text">{truncatedName}</div>
                          </div>
                        )
                      })}
                      {hasMore && (
                        <div className="more-appointments-indicator">
                          +{dayAppointments.length - 3} more
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Appointment Detail Sidebar */}
        {showSidebar && selectedAppointment && (
          <>
            <div className="sidebar-overlay" onClick={() => {
              setShowSidebar(false)
              setSelectedAppointment(null)
            }}></div>
            <div className="appointment-sidebar">
              <div className="sidebar-header">
                <div className="sidebar-header-content">
                  <h3>Appointment Details</h3>
                  <span className="sidebar-subtitle">View appointment information</span>
                </div>
                <button 
                  onClick={() => {
                    setShowSidebar(false)
                    setSelectedAppointment(null)
                  }} 
                  className="sidebar-close-button"
                  aria-label="Close sidebar"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <div className="sidebar-content">
                {/* Status Badge - Prominent at top */}
                <div className="sidebar-status-section">
                  <span 
                    className="sidebar-status-badge"
                    style={{ 
                      color: STATUS_COLORS[selectedAppointment.status] || '#6b7280',
                      backgroundColor: `${STATUS_COLORS[selectedAppointment.status] || '#6b7280'}15`,
                      borderColor: `${STATUS_COLORS[selectedAppointment.status] || '#6b7280'}40`
                    }}
                  >
                    {selectedAppointment.status.charAt(0).toUpperCase() + selectedAppointment.status.slice(1)}
                  </span>
                </div>

                {/* Date & Time Card */}
                <div className="sidebar-card">
                  <div className="sidebar-card-header">
                    <div className="sidebar-card-icon" style={{ backgroundColor: '#EEF2FF', color: '#4F46E5' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                        <circle cx="12" cy="16" r="1"></circle>
                      </svg>
                    </div>
                    <div className="sidebar-card-title">Date & Time</div>
                  </div>
                  <div className="sidebar-card-body">
                    <div className="sidebar-datetime">
                      <div className="sidebar-date">{formatDate(new Date(selectedAppointment.appointmentDate))}</div>
                      <div className="sidebar-time">
                        <span className="time-value">{formatTime(selectedAppointment.appointmentTime)}</span>
                        <span className="time-duration">{selectedAppointment.durationMinutes} min</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Worker Information Card */}
                <div className="sidebar-card">
                  <div className="sidebar-card-header">
                    <div className="sidebar-card-icon" style={{ backgroundColor: '#F0FDF4', color: '#16A34A' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
                    </div>
                    <div className="sidebar-card-title">Worker</div>
                  </div>
                  <div className="sidebar-card-body">
                    <div className="sidebar-worker-info">
                      <div className="worker-name">{selectedAppointment.workerName}</div>
                      <div className="worker-email">{selectedAppointment.workerEmail}</div>
                    </div>
                  </div>
                </div>

                {/* Appointment Details Grid */}
                <div className="sidebar-details-grid">
                  <div className="sidebar-detail-item">
                    <div className="detail-label">Type</div>
                    <div className="detail-value">{TYPE_LABELS[selectedAppointment.appointmentType] || selectedAppointment.appointmentType}</div>
                  </div>
                  <div className="sidebar-detail-item">
                    <div className="detail-label">Case Number</div>
                    <div className="detail-value case-number">{selectedAppointment.caseNumber}</div>
                  </div>
                </div>

                {/* Team & Location Card */}
                {(selectedAppointment.teamName || selectedAppointment.location || selectedAppointment.siteLocation) && (
                  <div className="sidebar-card">
                    <div className="sidebar-card-header">
                      <div className="sidebar-card-icon" style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                          <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                      </div>
                      <div className="sidebar-card-title">Location</div>
                    </div>
                    <div className="sidebar-card-body">
                      {selectedAppointment.teamName && (
                        <div className="sidebar-location-item">
                          <span className="location-label">Team:</span>
                          <span className="location-value">{selectedAppointment.teamName}</span>
                        </div>
                      )}
                      {selectedAppointment.siteLocation && (
                        <div className="sidebar-location-item">
                          <span className="location-label">Site:</span>
                          <span className="location-value">{selectedAppointment.siteLocation}</span>
                        </div>
                      )}
                      {selectedAppointment.location && (
                        <div className="sidebar-location-item">
                          <span className="location-label">Address:</span>
                          <span className="location-value">{selectedAppointment.location}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Notes Card */}
                {selectedAppointment.notes && (
                  <div className="sidebar-card">
                    <div className="sidebar-card-header">
                      <div className="sidebar-card-icon" style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                        </svg>
                      </div>
                      <div className="sidebar-card-title">Notes</div>
                    </div>
                    <div className="sidebar-card-body">
                      <div className="sidebar-notes-content">{selectedAppointment.notes}</div>
                    </div>
                  </div>
                )}

                {/* Cancellation Reason Card */}
                {selectedAppointment.cancellationReason && (
                  <div className="sidebar-card sidebar-card-warning">
                    <div className="sidebar-card-header">
                      <div className="sidebar-card-icon" style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="8" x2="12" y2="12"></line>
                          <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                      </div>
                      <div className="sidebar-card-title">Cancellation Reason</div>
                    </div>
                    <div className="sidebar-card-body">
                      <div className="sidebar-cancellation-content">{selectedAppointment.cancellationReason}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

      </div>
    </DashboardLayout>
  )
}

