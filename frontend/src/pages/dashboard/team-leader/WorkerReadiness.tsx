import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './WorkerReadiness.css'

interface CheckInData {
  userId: string
  workerName: string
  workerEmail: string
  workerInitials: string
  hasCheckedIn: boolean
  hasWarmUp: boolean
  hasActiveException: boolean
  exception?: {
    type: string
    reason?: string
    startDate: string
    endDate?: string
  }
  status: 'green' | 'amber' | 'red' | 'pending' | 'exception'
  checkIn?: {
    checkInTime: string
    painLevel: number
    fatigueLevel: number
    stressLevel: number
    sleepQuality: number
    predictedReadiness: string
    additionalNotes?: string
    shiftType?: string
    shiftStartTime?: string
    shiftEndTime?: string
  }
}

interface CheckInsResponse {
  checkIns: CheckInData[]
  statistics: {
    total: number
    completed: number
    pending: number
    green: number
    amber: number
    red: number
    completionRate: number
    withExceptions: number
  }
  dateRange?: {
    startDate: string
    endDate: string
    isSingleDate: boolean
  }
}

// Constants
const STATUS_CONFIG = {
  green: { label: 'Fit to work', color: '#10B981' },
  amber: { label: 'Minor issue', color: '#F59E0B' },
  red: { label: 'Not fit to work', color: '#EF4444' },
  pending: { label: 'Pending', color: '#CBD5E1' },
  exception: { label: 'Exception', color: '#F59E0B' },
} as const

const STATUS_ORDER: Record<string, number> = {
  exception: 0,
  red: 1,
  amber: 2,
  green: 3,
  pending: 4,
}

const HISTORY_START_DATE = '2020-01-01'

// Helper functions
const getLocalToday = (): string => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return 'N/A'
  try {
    const date = new Date(dateStr)
    return !isNaN(date.getTime()) ? date.toLocaleDateString() : 'N/A'
  } catch {
    return 'N/A'
  }
}

const getReadinessLabel = (readiness: string): string => {
  if (readiness === 'Green') return 'Fit to work'
  if (readiness === 'Yellow' || readiness === 'Amber') return 'Minor issue'
  if (readiness === 'Red') return 'Not fit to work'
  return readiness
}

const formatExceptionType = (type: string | undefined): string => {
  if (!type) return 'Exception'
  return type.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

// Status icon component for summary cards
const StatusIcon = ({ color }: { color: string }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', marginRight: '6px', verticalAlign: 'middle' }}>
    <circle cx="5" cy="5" r="4.5" fill={color}/>
  </svg>
)

export function WorkerReadiness() {
  const { user } = useAuth()
  const [checkInsData, setCheckInsData] = useState<CheckInsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedWorker, setSelectedWorker] = useState<CheckInData | null>(null)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [workerHistory, setWorkerHistory] = useState<{ checkIns: any[]; exceptions: any[] } | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  
  const today = useMemo(() => getLocalToday(), [])
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)

  const fetchHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
  }), [])

  const loadCheckIns = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      
      if (new Date(startDate) > new Date(endDate)) {
        setError('Start date must be before or equal to end date')
        setLoading(false)
        return
      }
      
      const params = new URLSearchParams({
        startDate,
        endDate,
        _t: Date.now().toString(),
      })
      
      const result = await apiClient.get<CheckInsResponse>(
        `${API_ROUTES.TEAMS.CHECKINS}?${params.toString()}`,
        {
          headers: {
            ...fetchHeaders,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
        }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to load worker readiness data')
      }

      setCheckInsData(result.data)
    } catch (err: any) {
      setError(err.message || 'Failed to load worker readiness data')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, fetchHeaders])

  const isToday = useMemo(() => startDate === today && endDate === today, [startDate, endDate, today])

  useEffect(() => {
    if (user) {
      loadCheckIns()
      
      if (isToday) {
        const interval = setInterval(loadCheckIns, 30000)
        return () => clearInterval(interval)
      }
    }
  }, [user, loadCheckIns, isToday])

  const resetToToday = useCallback(() => {
    setStartDate(today)
    setEndDate(today)
  }, [today])

  // Load worker history - completely independent of date filter, always shows ALL history
  const loadWorkerHistory = useCallback(async (workerId: string) => {
    try {
      setLoadingHistory(true)
      
      const [exceptionsResult, checkInsResult] = await Promise.all([
        apiClient.get<{ exception: any }>(
          API_ROUTES.TEAMS.MEMBER_EXCEPTION(workerId),
          { headers: fetchHeaders }
        ),
        apiClient.get<{ checkIns: any[] }>(
          `${API_ROUTES.TEAMS.MEMBER(workerId)}/check-ins?startDate=${HISTORY_START_DATE}&endDate=${today}`,
          { headers: fetchHeaders }
        ),
      ])

      if (isApiError(checkInsResult)) {
        throw new Error(getApiErrorMessage(checkInsResult) || 'Failed to fetch check-ins')
      }

      const exceptionsData = !isApiError(exceptionsResult) ? exceptionsResult.data : { exception: null }
      const checkInsData = checkInsResult.data

      setWorkerHistory({
        checkIns: checkInsData.checkIns || [],
        exceptions: exceptionsData.exception ? [exceptionsData.exception] : (exceptionsData.exceptions || []),
      })
    } catch (err: any) {
      console.error('Error loading worker history:', err)
      setWorkerHistory({ checkIns: [], exceptions: [] })
    } finally {
      setLoadingHistory(false)
    }
  }, [today, fetchHeaders])

  const handleViewClick = useCallback(async (worker: CheckInData) => {
    setSelectedWorker(worker)
    setShowDetailsModal(true)
    await loadWorkerHistory(worker.userId)
  }, [loadWorkerHistory])

  const handleRowClick = useCallback((checkIn: CheckInData) => {
    if (checkIn.hasCheckedIn) {
      handleViewClick(checkIn)
    }
  }, [handleViewClick])

  const getStatusIcon = useCallback((status: string) => {
    const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending
    const isException = status === 'exception'
    
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        {isException ? (
          <>
            <path d="M6 2L10 10H2L6 2Z" fill={config.color}/>
            <path d="M6 7V8.5M6 5.5V6" stroke="#FFFFFF" strokeWidth="0.8" strokeLinecap="round"/>
          </>
        ) : (
          <circle cx="6" cy="6" r="5" fill={config.color} stroke="#FFFFFF" strokeWidth="1.5"/>
        )}
      </svg>
    )
  }, [])

  const getStatusLabel = useCallback((status: string) => {
    return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.label || 'Unknown'
  }, [])

  const sortedCheckIns = useMemo(() => {
    if (!checkInsData?.checkIns) return []
    
    return [...checkInsData.checkIns].sort((a, b) => {
      const aOrder = STATUS_ORDER[a.status] ?? 5
      const bOrder = STATUS_ORDER[b.status] ?? 5
      return aOrder !== bOrder ? aOrder - bOrder : a.workerName.localeCompare(b.workerName)
    })
  }, [checkInsData?.checkIns])

  return (
    <DashboardLayout>
      <div className="worker-readiness-page">
        <header className="readiness-header">
          <div>
            <h1 className="readiness-title">Worker Readiness</h1>
            <p className="readiness-subtitle">
              Monitor your team's daily check-ins and readiness status
              {checkInsData?.dateRange && !checkInsData.dateRange.isSingleDate && (
                <span className="date-range-indicator">
                  (Viewing data from {new Date(checkInsData.dateRange.startDate).toLocaleDateString()} to {new Date(checkInsData.dateRange.endDate).toLocaleDateString()})
                </span>
              )}
              {checkInsData?.dateRange && checkInsData.dateRange.isSingleDate && !isToday && (
                <span className="date-range-indicator">
                  (Viewing data for {new Date(checkInsData.dateRange.startDate).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })})
                </span>
              )}
            </p>
          </div>
          <div className="header-actions">
            <button 
              className="refresh-btn" 
              onClick={loadCheckIns}
              disabled={loading}
              title="Refresh data"
            >
              {loading ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" opacity="0.5"/>
                  <path d="M12 6V2L8 6L12 10V6C15.31 6 18 8.69 18 12C18 15.31 15.31 18 12 18" strokeDasharray="20 10"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
              )} Refresh
            </button>
          </div>
        </header>

        {/* Date Filter Section */}
        <div className="date-filter-section">
          <div className="date-filter-group">
            <label className="date-filter-label">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={endDate}
              className="date-input"
            />
          </div>
          <div className="date-filter-separator">to</div>
          <div className="date-filter-group">
            <label className="date-filter-label">To</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
              max={today}
              className="date-input"
            />
          </div>
          <button 
            className={`date-preset-btn ${isToday ? 'active' : ''}`}
            onClick={resetToToday}
            title="View today's data"
          >
            Today
          </button>
        </div>

        {loading && !checkInsData ? (
          <Loading message="Loading worker readiness data..." size="medium" />
        ) : error ? (
          <div className="readiness-error">
            <p>{error}</p>
            <button onClick={loadCheckIns} className="retry-btn">Try Again</button>
          </div>
        ) : checkInsData ? (
          <>
            {/* Summary Statistics */}
            <div className="readiness-summary">
              <div className="summary-card">
                <div className="summary-value">{checkInsData.statistics.completionRate}%</div>
                <div className="summary-label">Completion Rate</div>
                <div className="summary-detail">
                  {checkInsData.statistics.completed} / {checkInsData.statistics.total} checked in
                </div>
              </div>
              <div className="summary-card status-green">
                <div className="summary-value">{checkInsData.statistics.green}</div>
                <div className="summary-label">
                  <StatusIcon color={STATUS_CONFIG.green.color} />
                  {STATUS_CONFIG.green.label}
                </div>
              </div>
              <div className="summary-card status-amber">
                <div className="summary-value">{checkInsData.statistics.amber}</div>
                <div className="summary-label">
                  <StatusIcon color={STATUS_CONFIG.amber.color} />
                  {STATUS_CONFIG.amber.label}
                </div>
              </div>
              <div className="summary-card status-red">
                <div className="summary-value">{checkInsData.statistics.red}</div>
                <div className="summary-label">
                  <StatusIcon color={STATUS_CONFIG.red.color} />
                  {STATUS_CONFIG.red.label}
                </div>
              </div>
              <div className="summary-card status-pending">
                <div className="summary-value">{checkInsData.statistics.pending}</div>
                <div className="summary-label">
                  <StatusIcon color={STATUS_CONFIG.pending.color} />
                  {STATUS_CONFIG.pending.label}
                </div>
              </div>
              {checkInsData.statistics.withExceptions > 0 && (
                <div className="summary-card status-exception">
                  <div className="summary-value">{checkInsData.statistics.withExceptions}</div>
                  <div className="summary-label">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', marginRight: '6px', verticalAlign: 'middle' }}>
                      <path d="M5 2L8.5 8H1.5L5 2Z" fill={STATUS_CONFIG.exception.color}/>
                      <circle cx="5" cy="7" r="0.5" fill="#FFFFFF"/>
                    </svg>
                    On Exception
                  </div>
                </div>
              )}
            </div>

            {/* Workers List */}
            <div className="readiness-list-container">
              <h2 className="readiness-list-title">Team Members</h2>
              
              {sortedCheckIns.length > 0 ? (
                <div className="readiness-table">
                  <div className="readiness-table-header">
                    <div className="col-worker">Worker</div>
                    <div className="col-status">Status</div>
                    <div className="col-time">Check-in Time</div>
                    <div className="col-metrics">Metrics</div>
                    <div className="col-readiness">Readiness</div>
                    <div className="col-actions">Actions</div>
                  </div>
                  
                  <div className="readiness-table-body">
                    {sortedCheckIns.map((checkIn) => (
                      <div 
                        key={checkIn.userId} 
                        className={`readiness-table-row status-${checkIn.status} ${checkIn.hasCheckedIn ? 'clickable' : ''}`}
                        onClick={() => handleRowClick(checkIn)}
                        style={{ cursor: checkIn.hasCheckedIn ? 'pointer' : 'default' }}
                      >
                        <div className="col-worker">
                          <div className="worker-info">
                            <div className="worker-avatar">
                              {checkIn.workerInitials}
                            </div>
                            <div className="worker-details">
                              <div className="worker-name">{checkIn.workerName}</div>
                              <div className="worker-email">{checkIn.workerEmail}</div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="col-status">
                          {checkIn.hasCheckedIn && checkIn.checkIn ? (
                            <span className={`status-badge status-${checkIn.status}`}>
                              {getStatusIcon(checkIn.status)} {getStatusLabel(checkIn.status)}
                            </span>
                          ) : (
                            <span className="status-badge status-pending">
                              {getStatusIcon('pending')} {getStatusLabel('pending')}
                            </span>
                          )}
                        </div>
                        
                        <div className="col-time">
                          {checkIn.hasCheckedIn && checkIn.checkIn ? (
                            <div>
                              <div className="time-value">{checkIn.checkIn.checkInTime || 'N/A'}</div>
                              {checkIn.checkIn.shiftType && (
                                <div className="shift-info">
                                  {checkIn.checkIn.shiftType.charAt(0).toUpperCase() + checkIn.checkIn.shiftType.slice(1)}
                                  {checkIn.checkIn.shiftStartTime && ` ${checkIn.checkIn.shiftStartTime.substring(0, 5)}-${checkIn.checkIn.shiftEndTime?.substring(0, 5)}`}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="pending-text">Not checked in</span>
                          )}
                        </div>
                        
                        <div className="col-metrics">
                          {checkIn.hasCheckedIn && checkIn.checkIn ? (
                            <div className="metrics-list">
                              <div className="metric-item">
                                <span className="metric-name">Pain:</span>
                                <span className={`metric-value ${checkIn.checkIn.painLevel >= 5 ? 'high' : checkIn.checkIn.painLevel >= 3 ? 'medium' : 'low'}`}>
                                  {checkIn.checkIn.painLevel}/10
                                </span>
                              </div>
                              <div className="metric-item">
                                <span className="metric-name">Fatigue:</span>
                                <span className={`metric-value ${checkIn.checkIn.fatigueLevel >= 7 ? 'high' : checkIn.checkIn.fatigueLevel >= 5 ? 'medium' : 'low'}`}>
                                  {checkIn.checkIn.fatigueLevel}/10
                                </span>
                              </div>
                              <div className="metric-item">
                                <span className="metric-name">Stress:</span>
                                <span className={`metric-value ${checkIn.checkIn.stressLevel >= 7 ? 'high' : checkIn.checkIn.stressLevel >= 5 ? 'medium' : 'low'}`}>
                                  {checkIn.checkIn.stressLevel}/10
                                </span>
                              </div>
                              <div className="metric-item">
                                <span className="metric-name">Sleep:</span>
                                <span className={`metric-value ${checkIn.checkIn.sleepQuality >= 8 ? 'good' : checkIn.checkIn.sleepQuality >= 6 ? 'medium' : 'low'}`}>
                                  {checkIn.checkIn.sleepQuality}/12
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="no-metrics">-</span>
                          )}
                        </div>
                        
                        <div className="col-readiness">
                          {checkIn.hasCheckedIn && checkIn.checkIn ? (
                            <div className="readiness-info">
                              <span className={`readiness-badge readiness-${checkIn.checkIn.predictedReadiness.toLowerCase()}`}>
                                {getReadinessLabel(checkIn.checkIn.predictedReadiness)}
                              </span>
                              {checkIn.hasWarmUp && <span className="warmup-badge">✓ Warm-up</span>}
                              {checkIn.checkIn.additionalNotes && (
                                <div className="notes-tooltip" title={checkIn.checkIn.additionalNotes}>📝 Notes</div>
                              )}
                            </div>
                          ) : (
                            <span className="no-readiness">-</span>
                          )}
                        </div>
                        
                        <div className="col-actions">
                          <button 
                            className="view-details-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleViewClick(checkIn)
                            }}
                            title="View Worker History"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                              <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                            View
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="readiness-empty">
                  <p>No team members found. Add workers to your team to see their readiness status.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="readiness-empty">
            <p>No data available.</p>
          </div>
        )}

        {/* Details Modal */}
        {showDetailsModal && selectedWorker && (
          <div className="details-modal-overlay" onClick={() => setShowDetailsModal(false)}>
            <div className="details-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="details-modal-header">
                <div className="details-worker-info">
                  <div className="details-worker-avatar">
                    {selectedWorker.workerInitials}
                  </div>
                  <div>
                    <h2 className="details-worker-name">{selectedWorker.workerName}</h2>
                    <p className="details-worker-email">{selectedWorker.workerEmail}</p>
                  </div>
                </div>
                <button 
                  className="close-modal-btn"
                  onClick={() => setShowDetailsModal(false)}
                  title="Close"
                >
                  ×
                </button>
              </div>

              <div className="details-modal-body">
                {loadingHistory ? (
                  <Loading message="Loading worker history..." size="medium" />
                ) : (
                  <>
                    {/* Today's Check-in (if available) */}
                    {selectedWorker.checkIn && (
                      <div className="details-section">
                        <h3 className="details-section-title">Today's Check-in</h3>
                        <div className="details-status-grid">
                          <div className="details-status-item">
                            <span className="details-label">Readiness:</span>
                            <span className={`readiness-badge readiness-${selectedWorker.checkIn.predictedReadiness.toLowerCase()}`}>
                              {getReadinessLabel(selectedWorker.checkIn.predictedReadiness)}
                            </span>
                          </div>
                          <div className="details-status-item">
                            <span className="details-label">Check-in Time:</span>
                            <span className="details-value">{selectedWorker.checkIn.checkInTime || 'N/A'}</span>
                          </div>
                          <div className="details-status-item">
                            <span className="details-label">Pain:</span>
                            <span className="details-value">{selectedWorker.checkIn.painLevel}/10</span>
                          </div>
                          <div className="details-status-item">
                            <span className="details-label">Fatigue:</span>
                            <span className="details-value">{selectedWorker.checkIn.fatigueLevel}/10</span>
                          </div>
                          <div className="details-status-item">
                            <span className="details-label">Stress:</span>
                            <span className="details-value">{selectedWorker.checkIn.stressLevel}/10</span>
                          </div>
                          <div className="details-status-item">
                            <span className="details-label">Sleep:</span>
                            <span className="details-value">{selectedWorker.checkIn.sleepQuality}/12</span>
                          </div>
                        </div>
                        {selectedWorker.checkIn.additionalNotes && (
                          <div className="details-notes" style={{ marginTop: '12px' }}>
                            <strong>Notes:</strong> {selectedWorker.checkIn.additionalNotes}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Check-in History */}
                    {workerHistory?.checkIns && workerHistory.checkIns.length > 0 && (
                      <div className="details-section">
                        <h3 className="details-section-title">Check-in History</h3>
                        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                          {workerHistory.checkIns.map((checkIn: any, index: number) => {
                            const { check_in_date, check_in_time, predicted_readiness, pain_level, fatigue_level, stress_level, sleep_quality, additional_notes } = checkIn
                            const metrics = [
                              pain_level !== undefined && `Pain: ${pain_level}/10`,
                              fatigue_level !== undefined && `Fatigue: ${fatigue_level}/10`,
                              stress_level !== undefined && `Stress: ${stress_level}/10`,
                              sleep_quality !== undefined && `Sleep: ${sleep_quality}/12`,
                            ].filter(Boolean).join(' | ')
                            
                            return (
                              <div key={index} style={{ padding: '12px', borderBottom: '1px solid #E2E8F0', marginBottom: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                  <strong>{formatDate(check_in_date)}</strong>
                                  <span className={`readiness-badge readiness-${(predicted_readiness || '').toLowerCase()}`}>
                                    {predicted_readiness || 'N/A'}
                                  </span>
                                </div>
                                <div style={{ fontSize: '13px', color: '#64748B' }}>
                                  <div>Time: {check_in_time || 'N/A'}</div>
                                  {metrics && <div>{metrics}</div>}
                                  {additional_notes && (
                                    <div style={{ marginTop: '4px', fontStyle: 'italic' }}>{additional_notes}</div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Cases/Exceptions History */}
                    {workerHistory?.exceptions && workerHistory.exceptions.length > 0 && (
                      <div className="details-section">
                        <h3 className="details-section-title">Cases & Exceptions History</h3>
                        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                          {workerHistory.exceptions.map((exception: any, index: number) => {
                            const { exception_type, reason, start_date, end_date, is_active } = exception
                            const formattedStartDate = formatDate(start_date)
                            const formattedEndDate = formatDate(end_date)
                            
                            return (
                              <div key={index} className="details-exception" style={{ marginBottom: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                  <strong>{formatExceptionType(exception_type)}</strong>
                                  <span style={{ 
                                    padding: '2px 8px', 
                                    borderRadius: '4px', 
                                    fontSize: '11px',
                                    background: is_active ? '#FFFBEB' : '#F8FAFC',
                                    color: is_active ? '#B45309' : '#64748B'
                                  }}>
                                    {is_active ? 'Active' : 'Closed'}
                                  </span>
                                </div>
                                {reason && (
                                  <div style={{ marginBottom: '4px', fontSize: '13px' }}>
                                    <strong>Reason:</strong> {reason}
                                  </div>
                                )}
                                <div style={{ fontSize: '12px', color: '#64748B' }}>
                                  <div>Start: {formattedStartDate}</div>
                                  <div>End: {formattedEndDate || 'Ongoing'}</div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {(!workerHistory?.checkIns || workerHistory.checkIns.length === 0) && 
                     (!workerHistory?.exceptions || workerHistory.exceptions.length === 0) && (
                      <div className="details-section">
                        <p style={{ color: '#64748B', textAlign: 'center', padding: '20px' }}>
                          No history available for this worker.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

