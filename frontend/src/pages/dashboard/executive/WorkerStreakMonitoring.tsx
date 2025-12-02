import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { useAuth } from '../../../contexts/AuthContext'
import { apiClient, isApiError } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { getExceptionTypeLabel } from '../../../utils/exceptionUtils'
import type { WorkerStreak } from './types'
import './WorkerStreakMonitoring.css'


export function WorkerStreakMonitoring() {
  const navigate = useNavigate()
  const { business_name } = useAuth()
  const [loading, setLoading] = useState(true)
  const [workers, setWorkers] = useState<WorkerStreak[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 20
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadWorkerStreaks()
  }, [])

  // Debounce search term to optimize filtering performance
  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }
    
    debounceTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
      setCurrentPage(1) // Reset to first page when search changes
    }, 300) // 300ms debounce delay

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [searchTerm])

  // Optimized: Memoized load function to prevent unnecessary re-renders
  const loadWorkerStreaks = useCallback(async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<{ workers: WorkerStreak[] }>(API_ROUTES.EXECUTIVE.WORKERS_STREAKS)

      if (isApiError(result)) {
        setWorkers([])
        return
      }

      setWorkers(result.data.workers || [])
    } catch (error) {
      setWorkers([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Navigate to worker detail page
  const handleViewWorker = useCallback((worker: WorkerStreak) => {
    navigate(`${PROTECTED_ROUTES.EXECUTIVE.WORKER_STREAKS}/${worker.id}`)
  }, [navigate])

  // Optimized: Memoized filtered workers to prevent unnecessary recalculations
  const filteredWorkers = useMemo(() => {
    if (!debouncedSearchTerm.trim()) return workers
    
    const searchLower = debouncedSearchTerm.toLowerCase()
    return workers.filter(worker =>
      worker.fullName.toLowerCase().includes(searchLower) ||
      worker.email.toLowerCase().includes(searchLower)
    )
  }, [workers, debouncedSearchTerm])

  // Paginated workers for display
  const paginatedWorkers = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return filteredWorkers.slice(startIndex, endIndex)
  }, [filteredWorkers, currentPage])

  const totalPages = Math.ceil(filteredWorkers.length / itemsPerPage)

  return (
    <DashboardLayout>
      <div className="worker-streak-monitoring-page">
        {/* Header */}
        <div className="worker-streak-header">
          <div className="worker-streak-header-left">
            <h1 className="worker-streak-title">Workers Check-In Streak Monitoring</h1>
            <p className="worker-streak-subtitle">
              Monitor worker check-in streaks and missed schedules
              {business_name && <span> • {business_name}</span>}
            </p>
          </div>
          <button
            className="worker-streak-refresh-btn"
            onClick={loadWorkerStreaks}
            disabled={loading}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            Refresh
          </button>
        </div>

        {/* Search Bar */}
        <div className="worker-streak-search">
          <div className="worker-streak-search-input-wrapper">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="worker-streak-search-input"
            />
          </div>
        </div>

        {/* Main Content */}
        <div className="worker-streak-main">
          {loading ? (
            <div className="worker-streak-loading">
              <Loading message="Loading worker streaks..." size="large" />
            </div>
          ) : filteredWorkers.length === 0 ? (
            <div className="worker-streak-empty">
              <p>{searchTerm ? `No workers found matching "${searchTerm}"` : 'No workers found'}</p>
            </div>
          ) : (
            <>
              <div className="worker-streak-table-container">
                <table className="worker-streak-table">
                  <thead>
                    <tr>
                      <th>Worker Name</th>
                      <th>Email</th>
                      <th>Current Streak</th>
                      <th>Progress to Total Scheduled Days</th>
                      <th>Completed Days</th>
                      <th>Missed Schedule</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedWorkers.map((worker) => (
                    <tr key={worker.id}>
                      <td>
                        <div className="worker-streak-name">
                          <div className="worker-streak-name-wrapper">
                            <strong>{worker.fullName}</strong>
                            {worker.hasActiveException && (
                              <span 
                                className="worker-streak-exception-badge"
                                title={worker.currentException 
                                  ? `${getExceptionTypeLabel(worker.currentException.exception_type)}${worker.currentException.reason ? `: ${worker.currentException.reason}` : ''}`
                                  : 'Currently in exception period'}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                  <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></path>
                                </svg>
                                <span>Exception</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="worker-streak-email">{worker.email}</span>
                      </td>
                      <td>
                        <div className="worker-streak-streak">
                          <span className={`worker-streak-streak-value ${worker.currentStreak > 0 ? 'active' : ''}`}>
                            {worker.currentStreak}
                          </span>
                          <span className="worker-streak-streak-label">
                            {worker.currentStreak === 1 ? 'day' : 'days'}
                          </span>
                          {worker.hasSevenDayBadge && (
                            <span className="worker-streak-badge" title="7-Day Streak Badge">🔥</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {worker.totalScheduledDays > 0 ? (
                          <div className="worker-streak-progress">
                            <div className="worker-streak-progress-header">
                              <span className="worker-streak-progress-text">
                                {worker.completedDays} / {worker.totalScheduledDays} days
                              </span>
                              <span className="worker-streak-progress-percentage">
                                {worker.completionPercentage}%
                              </span>
                            </div>
                            <div className="worker-streak-progress-bar">
                              <div
                                className={`worker-streak-progress-fill ${
                                  worker.completionPercentage >= 80
                                    ? 'progress-high'
                                    : worker.completionPercentage >= 50
                                    ? 'progress-medium'
                                    : 'progress-low'
                                }`}
                                style={{ width: `${worker.completionPercentage}%` }}
                              ></div>
                            </div>
                            {worker.pastScheduledDays > 0 && (
                              <div className="worker-streak-progress-note">
                                {worker.pastScheduledDays} past days, {worker.totalScheduledDays - worker.pastScheduledDays} future days
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="worker-streak-no-schedule">
                            No schedule assigned
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="worker-streak-completed">
                          <span className={`worker-streak-completed-value ${worker.completedDays > 0 ? 'active' : ''}`}>
                            {worker.completedDays}
                          </span>
                          <span className="worker-streak-completed-label">
                            {worker.completedDays === 1 ? 'day' : 'days'} completed
                          </span>
                        </div>
                      </td>
                      <td>
                        {worker.missedScheduleCount > 0 ? (
                          <div className="worker-streak-missed">
                            <div className="worker-streak-missed-count">
                              <span className="worker-streak-missed-badge">{worker.missedScheduleCount}</span>
                              <span className="worker-streak-missed-label">
                                {worker.missedScheduleCount === 1 ? 'missed' : 'missed'}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="worker-streak-no-missed">No missed schedules</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="worker-streak-view-btn"
                          onClick={() => handleViewWorker(worker)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="worker-streak-pagination">
                  <div className="worker-streak-pagination-info">
                    Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredWorkers.length)} of {filteredWorkers.length} workers
                  </div>
                  <div className="worker-streak-pagination-controls">
                    <button
                      className="worker-streak-pagination-btn"
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </button>
                    <div className="worker-streak-pagination-pages">
                      {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                        let pageNum: number
                        if (totalPages <= 7) {
                          pageNum = i + 1
                        } else if (currentPage <= 4) {
                          pageNum = i + 1
                        } else if (currentPage >= totalPages - 3) {
                          pageNum = totalPages - 6 + i
                        } else {
                          pageNum = currentPage - 3 + i
                        }
                        return (
                          <button
                            key={pageNum}
                            className={`worker-streak-pagination-page ${currentPage === pageNum ? 'active' : ''}`}
                            onClick={() => setCurrentPage(pageNum)}
                          >
                            {pageNum}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      className="worker-streak-pagination-btn"
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}

