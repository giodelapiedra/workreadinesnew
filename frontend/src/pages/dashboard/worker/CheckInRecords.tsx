import { useState, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { formatTime } from '../../../shared/date'
import { checkinsService } from '../../../services/checkinsService'
import { isApiError } from '../../../lib/apiClient'
import './CheckInRecords.css'

export function CheckInRecords() {
  const { user, first_name, last_name, full_name, role } = useAuth()
  
  // Check-in records state
  const [checkInRecords, setCheckInRecords] = useState<any[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsPage, setRecordsPage] = useState(1)
  const [recordsPagination, setRecordsPagination] = useState<{
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  } | null>(null)
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null)
  const [showRecordDetails, setShowRecordDetails] = useState(false)

  // Additional security check: Ensure user is actually a worker
  useEffect(() => {
    if (role && role !== 'worker') {
      console.error(`[CheckInRecords] SECURITY: User ${user?.email} (${user?.id}) with role '${role}' attempted to access CheckInRecords. This should not happen!`)
    }
  }, [role, user])

  // Load check-in records
  const loadCheckInRecords = async (page: number = 1) => {
    try {
      setRecordsLoading(true)
      const result = await checkinsService.getCheckInHistory({
        limit: 10,
        page: page,
      })

      if (!isApiError(result)) {
        // Backend returns checkIns (camelCase) and pagination object
        const responseData = result.data as any
        const checkIns = responseData.checkIns || responseData.checkins || []
        const pagination = responseData.pagination || {}
        const total = pagination.total || responseData.total || 0
        
        setCheckInRecords(checkIns)
        // Calculate pagination from total
        const limit = 10
        const totalPages = Math.ceil(total / limit)
        setRecordsPagination({
          page,
          limit,
          total,
          totalPages,
          hasNext: pagination.hasNext !== undefined ? pagination.hasNext : page < totalPages,
          hasPrev: pagination.hasPrev !== undefined ? pagination.hasPrev : page > 1,
        })
        setRecordsPage(page)
      } else {
        console.error('[CheckInRecords] Failed to load check-in records:', result.error.status)
        setCheckInRecords([])
      }
    } catch (error) {
      console.error('[CheckInRecords] Error loading check-in records:', error)
      setCheckInRecords([])
    } finally {
      setRecordsLoading(false)
    }
  }

  // Load records on component mount
  useEffect(() => {
    if (user) {
      loadCheckInRecords(1)
    }
  }, [user])

  // Format date for display
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
      return 'Today'
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday'
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined 
      })
    }
  }


  // Get full name
  const getFullName = (): string => {
    if (full_name) return full_name
    if (first_name && last_name) return `${first_name} ${last_name}`
    if (first_name) return first_name
    if (user?.email) return user.email.split('@')[0]
    return 'User'
  }

  return (
    <DashboardLayout>
      <div className="checkin-records-page">
        {/* Header */}
        <header className="checkin-records-header">
          <div className="checkin-records-header-left">
            <h1 className="checkin-records-title">Check-In Records</h1>
            <p className="checkin-records-subtitle">{getFullName()}</p>
          </div>
        </header>

        {/* Main Content */}
        <main className="checkin-records-main">
          <div className="checkin-records-container">
            {/* Check-In Records Table */}
            <div className="checkin-records-card">
              {recordsLoading ? (
                <Loading message="Loading records..." size="medium" />
              ) : checkInRecords.length > 0 ? (
                <>
                  <div className="checkin-records-table">
                    <div className="checkin-records-header-row">
                      <div className="checkin-records-col-date">Date</div>
                      <div className="checkin-records-col-time">Time</div>
                      <div className="checkin-records-col-status">Status</div>
                      <div className="checkin-records-col-shift">Shift</div>
                      <div className="checkin-records-col-action">Action</div>
                    </div>
                    <div className="checkin-records-body">
                      {checkInRecords.map((record) => (
                        <div 
                          key={record.id} 
                          className="checkin-records-row"
                        >
                          <div className="checkin-records-col-date">
                            {formatDate(record.check_in_date)}
                          </div>
                          <div className="checkin-records-col-time">
                            {formatTime(record.check_in_time)}
                          </div>
                          <div className="checkin-records-col-status">
                            <span className={`checkin-status-badge checkin-status-${record.predicted_readiness?.toLowerCase() || 'unknown'}`}>
                              {record.predicted_readiness || 'N/A'}
                            </span>
                          </div>
                          <div className="checkin-records-col-shift">
                            {record.shift_type ? record.shift_type.charAt(0).toUpperCase() + record.shift_type.slice(1) : 'N/A'}
                          </div>
                          <div className="checkin-records-col-action">
                            <button
                              className="checkin-view-btn"
                              onClick={() => {
                                setSelectedRecord(record)
                                setShowRecordDetails(true)
                              }}
                            >
                              View
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Pagination */}
                  {recordsPagination && recordsPagination.totalPages > 1 && (
                    <div className="checkin-records-pagination">
                      <button
                        onClick={() => loadCheckInRecords(recordsPage - 1)}
                        disabled={!recordsPagination.hasPrev}
                        className="checkin-pagination-btn"
                      >
                        Previous
                      </button>
                      <span className="checkin-pagination-info">
                        Page {recordsPagination.page} of {recordsPagination.totalPages}
                      </span>
                      <button
                        onClick={() => loadCheckInRecords(recordsPage + 1)}
                        disabled={!recordsPagination.hasNext}
                        className="checkin-pagination-btn"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="checkin-records-empty">
                  No check-in records found.
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Check-In Record Details Modal */}
        {showRecordDetails && selectedRecord && (
          <div className="checkin-record-modal-overlay" onClick={() => setShowRecordDetails(false)}>
            <div className="checkin-record-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="checkin-record-modal-header">
                <h2 className="checkin-record-modal-title">Check-In Details</h2>
                <button 
                  className="checkin-record-modal-close"
                  onClick={() => setShowRecordDetails(false)}
                >
                  ×
                </button>
              </div>
              
              <div className="checkin-record-modal-body">
                <div className="checkin-record-detail-section">
                  <div className="checkin-record-detail-item">
                    <span className="checkin-record-detail-label">Worker:</span>
                    <span className="checkin-record-detail-value">{getFullName()}</span>
                  </div>
                  <div className="checkin-record-detail-item">
                    <span className="checkin-record-detail-label">Date:</span>
                    <span className="checkin-record-detail-value">
                      {new Date(selectedRecord.check_in_date).toLocaleDateString('en-US', { 
                        weekday: 'long',
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </span>
                  </div>
                  <div className="checkin-record-detail-item">
                    <span className="checkin-record-detail-label">Time:</span>
                    <span className="checkin-record-detail-value">{formatTime(selectedRecord.check_in_time)}</span>
                  </div>
                  <div className="checkin-record-detail-item">
                    <span className="checkin-record-detail-label">Readiness:</span>
                    <span className={`checkin-status-badge checkin-status-${selectedRecord.predicted_readiness?.toLowerCase() || 'unknown'}`}>
                      {selectedRecord.predicted_readiness || 'N/A'}
                    </span>
                  </div>
                  {selectedRecord.shift_type && (
                    <div className="checkin-record-detail-item">
                      <span className="checkin-record-detail-label">Shift:</span>
                      <span className="checkin-record-detail-value">
                        {selectedRecord.shift_type.charAt(0).toUpperCase() + selectedRecord.shift_type.slice(1)}
                        {selectedRecord.shift_start_time && selectedRecord.shift_end_time && (
                          ` (${formatTime(selectedRecord.shift_start_time)} - ${formatTime(selectedRecord.shift_end_time)})`
                        )}
                      </span>
                    </div>
                  )}
                </div>

                <div className="checkin-record-detail-section">
                  <h3 className="checkin-record-detail-section-title">Health Metrics</h3>
                  <div className="checkin-record-metrics-grid">
                    <div className="checkin-record-metric-item">
                      <span className="checkin-record-metric-label">Pain Level:</span>
                      <span className="checkin-record-metric-value">{selectedRecord.pain_level}/10</span>
                    </div>
                    <div className="checkin-record-metric-item">
                      <span className="checkin-record-metric-label">Fatigue Level:</span>
                      <span className="checkin-record-metric-value">{selectedRecord.fatigue_level}/10</span>
                    </div>
                    <div className="checkin-record-metric-item">
                      <span className="checkin-record-metric-label">Stress Level:</span>
                      <span className="checkin-record-metric-value">{selectedRecord.stress_level}/10</span>
                    </div>
                    <div className="checkin-record-metric-item">
                      <span className="checkin-record-metric-label">Sleep Quality:</span>
                      <span className="checkin-record-metric-value">{selectedRecord.sleep_quality}/12</span>
                    </div>
                  </div>
                </div>

                {selectedRecord.additional_notes && (
                  <div className="checkin-record-detail-section">
                    <h3 className="checkin-record-detail-section-title">Additional Notes</h3>
                    <p className="checkin-record-notes">{selectedRecord.additional_notes}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

