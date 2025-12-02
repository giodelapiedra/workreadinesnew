import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { useAuth } from '../../../contexts/AuthContext'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { formatTime, formatDateDisplay, formatDateWithWeekday } from '../../../shared/date'
import type { WorkerStreak, CheckInRecord } from './types'
import './WorkerStreakDetail.css'

export function WorkerStreakDetail() {
  const { workerId } = useParams<{ workerId: string }>()
  const navigate = useNavigate()
  const { business_name } = useAuth()
  const [loading, setLoading] = useState(true)
  const [worker, setWorker] = useState<WorkerStreak | null>(null)
  const [checkIns, setCheckIns] = useState<CheckInRecord[]>([])
  const [loadingCheckIns, setLoadingCheckIns] = useState(false)
  const [checkInsPage, setCheckInsPage] = useState(1)
  const checkInsPerPage = 20

  useEffect(() => {
    if (workerId) {
      loadWorkerData()
    }
  }, [workerId])

  useEffect(() => {
    if (worker) {
      loadCheckIns()
    }
  }, [worker, checkInsPage])

  const loadWorkerData = async () => {
    if (!workerId) return

    try {
      setLoading(true)
      const result = await apiClient.get<{ workers: WorkerStreak[] }>(API_ROUTES.EXECUTIVE.WORKERS_STREAKS)

      if (isApiError(result)) {
        setWorker(null)
        return
      }

      const foundWorker = result.data.workers?.find(w => w.id === workerId)
      if (foundWorker) {
        setWorker(foundWorker)
      } else {
        setWorker(null)
      }
    } catch (error) {
      setWorker(null)
    } finally {
      setLoading(false)
    }
  }

  const loadCheckIns = async () => {
    if (!worker) return

    try {
      setLoadingCheckIns(true)
      
      // Fetch ALL check-ins without date filter - use very early date to get everything
      // Using 2020-01-01 as start date to get all historical check-ins
      const startDate = '2020-01-01'
      const endDate = '2099-12-31' // Future date to ensure we get all check-ins
      
      console.log(`[WorkerStreakDetail] Fetching ALL check-ins for worker ${worker.id} (no date filter)`)
      
      const result = await apiClient.get<{ checkIns: CheckInRecord[] }>(
        `${API_ROUTES.EXECUTIVE.WORKER_CHECKINS(worker.id)}?startDate=${startDate}&endDate=${endDate}`
      )

      if (!isApiError(result)) {
        const allCheckIns = result.data.checkIns || []
        const sortedCheckIns = allCheckIns
          .sort((a, b) => {
            const dateCompare = b.check_in_date.localeCompare(a.check_in_date)
            if (dateCompare !== 0) return dateCompare
            const timeA = a.check_in_time || ''
            const timeB = b.check_in_time || ''
            return timeB.localeCompare(timeA)
          })
        setCheckIns(sortedCheckIns)
      } else {
        setCheckIns([])
      }
    } catch (error) {
      setCheckIns([])
    } finally {
      setLoadingCheckIns(false)
    }
  }

  // Centralized date formatting - always show actual date (no "Today" or "Yesterday")
  const formatDate = useCallback((dateStr: string): string => {
    return formatDateDisplay(dateStr)
  }, [])

  // Helper function to get readiness class name (optimized, centralized, no duplication)
  const getReadinessClassName = useCallback((readiness: string | undefined): string => {
    if (!readiness) return ''
    const normalized = readiness.toLowerCase().trim()
    const readinessMap: Record<string, string> = {
      'green': 'green',
      'yellow': 'amber',
      'red': 'not',
    }
    return readinessMap[normalized] || normalized
  }, [])

  // Paginated check-ins
  const paginatedCheckIns = useMemo(() => {
    const startIndex = (checkInsPage - 1) * checkInsPerPage
    const endIndex = startIndex + checkInsPerPage
    return checkIns.slice(startIndex, endIndex)
  }, [checkIns, checkInsPage])

  const totalCheckInsPages = Math.ceil(checkIns.length / checkInsPerPage)

  if (loading) {
    return (
      <DashboardLayout>
        <div className="worker-streak-detail-page">
          <Loading message="Loading worker details..." size="large" />
        </div>
      </DashboardLayout>
    )
  }

  if (!worker) {
    return (
      <DashboardLayout>
        <div className="worker-streak-detail-page">
          <div className="worker-streak-detail-error">
            <h2>Worker not found</h2>
            <p>The worker you're looking for doesn't exist or you don't have access to view their details.</p>
            <button
              className="worker-streak-detail-back-btn"
              onClick={() => navigate(PROTECTED_ROUTES.EXECUTIVE.WORKER_STREAKS)}
            >
              Back to Worker Streaks
            </button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="worker-streak-detail-page">
        {/* Header */}
        <div className="worker-streak-detail-header">
          <button
            className="worker-streak-detail-back-btn"
            onClick={() => navigate(PROTECTED_ROUTES.EXECUTIVE.WORKER_STREAKS)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            Back
          </button>
          <div className="worker-streak-detail-header-content">
            <h1 className="worker-streak-detail-title">{worker.fullName}</h1>
            <p className="worker-streak-detail-subtitle">
              {worker.email}
              {business_name && <span> • {business_name}</span>}
            </p>
          </div>
        </div>

        {/* Streak Summary Cards */}
        <div className="worker-streak-detail-cards">
          <div className="worker-streak-detail-card">
            <div className="worker-streak-detail-card-icon streak">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path>
              </svg>
            </div>
            <div className="worker-streak-detail-card-content">
              <h3>Current Streak</h3>
              <div className="worker-streak-detail-card-value">
                <span className={worker.currentStreak > 0 ? 'active' : ''}>
                  {worker.currentStreak}
                </span>
                <span className="worker-streak-detail-card-label">
                  {worker.currentStreak === 1 ? 'day' : 'days'}
                </span>
                {worker.hasSevenDayBadge && (
                  <span className="worker-streak-detail-badge" title="7-Day Streak Badge">🔥</span>
                )}
              </div>
            </div>
          </div>

          <div className="worker-streak-detail-card">
            <div className="worker-streak-detail-card-icon completed">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <div className="worker-streak-detail-card-content">
              <h3>Completed Days</h3>
              <div className="worker-streak-detail-card-value">
                <span className="active">
                  {worker.completedDays} / {worker.totalScheduledDays}
                </span>
              </div>
            </div>
          </div>

          <div className="worker-streak-detail-card">
            <div className="worker-streak-detail-card-icon rate">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
            <div className="worker-streak-detail-card-content">
              <h3>Completion Rate</h3>
              <div className="worker-streak-detail-card-value">
                <span>{worker.completionPercentage}%</span>
              </div>
            </div>
          </div>

          <div className="worker-streak-detail-card">
            <div className="worker-streak-detail-card-icon scheduled">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </div>
            <div className="worker-streak-detail-card-content">
              <h3>Total Scheduled</h3>
              <div className="worker-streak-detail-card-value">
                <span>{worker.totalScheduledDays} days</span>
                {worker.pastScheduledDays > 0 && (
                  <span className="worker-streak-detail-card-note">
                    ({worker.pastScheduledDays} past, {worker.totalScheduledDays - worker.pastScheduledDays} future)
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Exception Dates */}
        {worker.exceptionDates && worker.exceptionDates.length > 0 && (
          <div className="worker-streak-detail-section">
            <h2 className="worker-streak-detail-section-title">
              Exception Periods ({worker.exceptionDates.length} {worker.exceptionDates.length === 1 ? 'date' : 'dates'})
            </h2>
            <div className="worker-streak-detail-missed-list">
              {worker.exceptionDates.map((exception, idx) => (
                <div key={idx} className="worker-streak-detail-missed-item" style={{ 
                  backgroundColor: '#fef3c7',
                  borderLeft: '3px solid #f59e0b'
                }}>
                  <div className="worker-streak-detail-missed-date">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span>{formatDateWithWeekday(exception.date)}</span>
                      <span style={{ fontSize: '11px', color: '#92400e', fontWeight: '500' }}>
                        {exception.exception_type === 'injury' ? 'Injury' :
                         exception.exception_type === 'medical_leave' ? 'Medical Leave' :
                         exception.exception_type === 'accident' ? 'Accident' :
                         exception.exception_type === 'transfer' ? 'Transfer' :
                         exception.exception_type === 'other' ? 'Other' : exception.exception_type}
                        {exception.reason && ` - ${exception.reason}`}
                      </span>
                    </div>
                  </div>
                  <span className="worker-streak-detail-missed-badge" style={{ 
                    backgroundColor: '#f59e0b',
                    color: '#fff'
                  }}>
                    Exception
                  </span>
                </div>
              ))}
            </div>
            <p style={{ 
              marginTop: '12px', 
              fontSize: '12px', 
              color: '#92400e', 
              fontStyle: 'italic',
              padding: '8px',
              backgroundColor: '#fef3c7',
              borderRadius: '4px'
            }}>
              Note: Dates with exceptions are not counted as missed schedules.
            </p>
          </div>
        )}

        {/* Missed Schedules */}
        {worker.missedScheduleCount > 0 && (
          <div className="worker-streak-detail-section">
            <h2 className="worker-streak-detail-section-title">
              Missed Schedules ({worker.missedScheduleCount})
            </h2>
            <div className="worker-streak-detail-missed-list">
              {worker.missedScheduleDates.map((date, idx) => (
                <div key={idx} className="worker-streak-detail-missed-item">
                  <div className="worker-streak-detail-missed-date">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <span>{formatDateWithWeekday(date)}</span>
                  </div>
                  <span className="worker-streak-detail-missed-badge">Missed</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Check-In History */}
        <div className="worker-streak-detail-section">
          <h2 className="worker-streak-detail-section-title">
            Check-In History
            {!loadingCheckIns && checkIns.length > 0 && (
              <span className="worker-streak-detail-loading" style={{ fontWeight: 'normal', fontSize: '14px' }}>
                ({checkIns.length} total {checkIns.length === 1 ? 'check-in' : 'check-ins'})
              </span>
            )}
            {loadingCheckIns && <span className="worker-streak-detail-loading">Loading...</span>}
          </h2>
          {loadingCheckIns ? (
            <div className="worker-streak-detail-loading-state">
              <Loading size="medium" />
            </div>
          ) : checkIns.length > 0 ? (
            <>
              <div className="worker-streak-detail-checkins">
                {paginatedCheckIns.map((checkIn) => (
                  <div key={checkIn.id} className="worker-streak-detail-checkin-item">
                    <div className="worker-streak-detail-checkin-date">
                      <span className="worker-streak-detail-checkin-date-text">
                        {formatDate(checkIn.check_in_date)}
                      </span>
                      <span className="worker-streak-detail-checkin-time">
                        {formatTime(checkIn.check_in_time)}
                      </span>
                    </div>
                    <div className="worker-streak-detail-checkin-details">
                      {checkIn.predicted_readiness && (
                        <span className={`worker-streak-detail-readiness worker-streak-detail-readiness-${getReadinessClassName(checkIn.predicted_readiness)}`}>
                          {checkIn.predicted_readiness}
                        </span>
                      )}
                      {checkIn.shift_type && (
                        <span className="worker-streak-detail-shift">
                          {checkIn.shift_type.charAt(0).toUpperCase() + checkIn.shift_type.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Pagination for Check-Ins - Show if more than 1 page OR if there are many check-ins */}
              {(totalCheckInsPages > 1 || checkIns.length > checkInsPerPage) && (
                <div className="worker-streak-detail-pagination">
                  <div className="worker-streak-detail-pagination-info">
                    Showing {((checkInsPage - 1) * checkInsPerPage) + 1} to {Math.min(checkInsPage * checkInsPerPage, checkIns.length)} of {checkIns.length} check-ins
                  </div>
                  <div className="worker-streak-detail-pagination-controls">
                    <button
                      className="worker-streak-detail-pagination-btn"
                      onClick={() => setCheckInsPage(prev => Math.max(1, prev - 1))}
                      disabled={checkInsPage === 1}
                    >
                      Previous
                    </button>
                    <div className="worker-streak-detail-pagination-pages">
                      {Array.from({ length: Math.min(totalCheckInsPages, 7) }, (_, i) => {
                        let pageNum: number
                        if (totalCheckInsPages <= 7) {
                          pageNum = i + 1
                        } else if (checkInsPage <= 4) {
                          pageNum = i + 1
                        } else if (checkInsPage >= totalCheckInsPages - 3) {
                          pageNum = totalCheckInsPages - 6 + i
                        } else {
                          pageNum = checkInsPage - 3 + i
                        }
                        return (
                          <button
                            key={pageNum}
                            className={`worker-streak-detail-pagination-page ${checkInsPage === pageNum ? 'active' : ''}`}
                            onClick={() => setCheckInsPage(pageNum)}
                          >
                            {pageNum}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      className="worker-streak-detail-pagination-btn"
                      onClick={() => setCheckInsPage(prev => Math.min(totalCheckInsPages, prev + 1))}
                      disabled={checkInsPage === totalCheckInsPages}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="worker-streak-detail-empty">
              <p>No check-in records found</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}

