import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { useAuth } from '../../../contexts/AuthContext'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './WhsControlCenterDashboard.css'

interface Case {
  id: string
  caseNumber: string
  workerId: string
  workerName: string
  workerEmail: string
  teamId: string
  teamName: string
  siteLocation: string
  supervisorId: string | null
  supervisorName: string
  teamLeaderId: string | null
  teamLeaderName: string
  clinicianId: string | null
  clinicianName: string | null
  type: string
  reason: string
  startDate: string
  endDate: string | null
  status: 'NEW CASE' | 'IN PROGRESS' | 'CLOSED' | 'IN REHAB' | 'RETURN TO WORK' | 'TRIAGED' | 'ASSESSED'
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  isActive: boolean
  createdAt: string
  updatedAt: string
  approvedBy?: string | null
  approvedAt?: string | null
  returnToWorkDutyType?: 'modified' | 'full' | null
  returnToWorkDate?: string | null
}

interface Clinician {
  id: string
  email: string
  name: string
}

interface Summary {
  total: number
  new: number
  active: number
  completed: number
  byType: Record<string, number>
}


const TYPE_LABELS: Record<string, string> = {
  accident: 'Accident',
  injury: 'Injury',
  medical_leave: 'Medical Leave',
  other: 'Other',
}

export function WhsControlCenterDashboard() {
  const { user, first_name } = useAuth()
  const navigate = useNavigate()
  const [cases, setCases] = useState<Case[]>([])
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    new: 0,
    active: 0,
    completed: 0,
    byType: {},
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentTab, setCurrentTab] = useState<'cases' | 'completed' | 'notifications'>('cases')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('active') // Default to active cases
  const [typeFilter, setTypeFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const itemsPerPage = 20
  const [selectedCase, setSelectedCase] = useState<Case | null>(null)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [clinicians, setClinicians] = useState<Clinician[]>([])
  const [selectedClinicianId, setSelectedClinicianId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [loadingClinicians, setLoadingClinicians] = useState(false)
  const [showSuccessToast, setShowSuccessToast] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // Debounce search query to prevent excessive API calls
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery)
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 500) // Wait 500ms after user stops typing

    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fetch cases when filters change (using debounced search)
  useEffect(() => {
    let isMounted = true

    const fetchCases = async () => {
      try {
        setLoading(true)
        setError('')

        const params = new URLSearchParams({
          page: currentPage.toString(),
          limit: itemsPerPage.toString(),
          status: statusFilter,
          type: typeFilter,
          search: debouncedSearchQuery,
        })

        const result = await apiClient.get<{ cases: Case[]; summary: Summary }>(
          `${API_ROUTES.WHS.CASES}?${params.toString()}`
        )

        if (isApiError(result)) {
          throw new Error(getApiErrorMessage(result) || 'Failed to fetch cases')
        }

        const data = result.data
        
        // Only update state if component is still mounted
        if (isMounted) {
          setCases(data.cases || [])
          setSummary(data.summary || {
            total: 0,
            new: 0,
            active: 0,
            completed: 0,
            byType: {},
          })
        }
      } catch (err: any) {
        console.error('Error fetching cases:', err)
        if (isMounted) {
          setError(err.message || 'Failed to load cases')
          setCases([])
          setSummary({
            total: 0,
            new: 0,
            active: 0,
            completed: 0,
            byType: {},
          })
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchCases()

    return () => {
      isMounted = false
    }
  }, [currentPage, statusFilter, typeFilter, debouncedSearchQuery, refreshKey])

  // Sort and display cases - prioritize active/new cases
  const displayedCases = useMemo(() => {
    return [...cases].sort((a, b) => {
      // Sort by status priority: NEW CASE > IN PROGRESS > CLOSED
      const statusPriority: Record<string, number> = {
        'NEW CASE': 1,
        'IN PROGRESS': 2,
        'CLOSED': 3,
      }
      const aPriority = statusPriority[a.status] || 99
      const bPriority = statusPriority[b.status] || 99
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority
      }
      
      // If same status, sort by created date (newest first)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }, [cases])

  const handleRefresh = () => {
    setCurrentPage(1)
    setRefreshKey(prev => prev + 1)
  }

  // Fetch clinicians when assign modal opens
  useEffect(() => {
    if (showAssignModal) {
      const fetchClinicians = async () => {
        try {
          setLoadingClinicians(true)
          const result = await apiClient.get<{ clinicians: Clinician[] }>(
            API_ROUTES.WHS.CLINICIANS
          )

          if (isApiError(result)) {
            throw new Error(getApiErrorMessage(result) || 'Failed to fetch clinicians')
          }

          setClinicians(result.data.clinicians || [])
        } catch (err: any) {
          console.error('Error fetching clinicians:', err)
          alert(err.message || 'Failed to load clinicians')
        } finally {
          setLoadingClinicians(false)
        }
      }

      fetchClinicians()
    }
  }, [showAssignModal])

  const handleAssignToClinician = async () => {
    if (!selectedCase || !selectedClinicianId) {
      return
    }

    try {
      setAssigning(true)
      const result = await apiClient.post<{ clinician: { name: string } }>(
        API_ROUTES.WHS.CASE_ASSIGN_CLINICIAN(selectedCase.id),
        { clinician_id: selectedClinicianId }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to assign case')
      }

      const clinicianName = result.data.clinician?.name || 'Clinician'
      
      setShowAssignModal(false)
      setSelectedCase(null)
      setSelectedClinicianId('')
      
      // Show success toast
      setSuccessMessage(`Case successfully assigned to ${clinicianName}`)
      setShowSuccessToast(true)
      
      // Auto-hide toast after 3 seconds
      setTimeout(() => {
        setShowSuccessToast(false)
      }, 3000)
      
      handleRefresh()
    } catch (err: any) {
      console.error('Error assigning case:', err)
      alert(err.message || 'Failed to assign case to clinician')
    } finally {
      setAssigning(false)
    }
  }

  // Memoized style functions for better performance
  const getStatusStyle = useCallback((status: string) => {
    switch (status) {
      case 'NEW CASE':
        return { bg: '#DBEAFE', color: '#3B82F6' } // Blue
      case 'TRIAGED':
        return { bg: '#E9D5FF', color: '#8B5CF6' } // Purple
      case 'ASSESSED':
        return { bg: '#FEF3C7', color: '#F59E0B' } // Amber
      case 'IN PROGRESS':
        return { bg: '#FEF2F2', color: '#EF4444' } // Red
      case 'IN REHAB':
        return { bg: '#D1FAE5', color: '#10B981' } // Green
      case 'RETURN TO WORK':
        return { bg: '#CFFAFE', color: '#06B6D4' } // Cyan
      case 'CLOSED':
        return { bg: '#F3F4F6', color: '#6B7280' } // Gray
      default:
        return { bg: '#F3F4F6', color: '#6B7280' } // Gray
    }
  }, [])

  const getSeverityStyle = useCallback((severity: string) => {
    switch (severity) {
      case 'HIGH':
        return { bg: '#FEE2E2', color: '#EF4444' }
      case 'MEDIUM':
        return { bg: '#FEF3C7', color: '#F59E0B' }
      case 'LOW':
        return { bg: '#E0E7FF', color: '#6366F1' }
      default:
        return { bg: '#F3F4F6', color: '#6B7280' }
    }
  }, [])

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }, [])

  return (
    <DashboardLayout>
      <div className="whs-dashboard">
        {/* Header */}
        <div className="whs-header">
          <div>
            <h1 className="whs-title">WHS Dashboard</h1>
            <p className="whs-subtitle">Welcome back, {first_name || user?.email?.split('@')[0] || 'Admin'}</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="whs-summary-grid">
          <div className="whs-summary-card">
            <div className="whs-summary-icon" style={{ backgroundColor: '#F3F4F6' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
              </svg>
            </div>
            <div className="whs-summary-content">
              <p className="whs-summary-label">Total Cases</p>
              <p className="whs-summary-value">{summary.total}</p>
            </div>
          </div>

          <div className="whs-summary-card">
            <div className="whs-summary-icon" style={{ backgroundColor: '#EFF6FF' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </div>
            <div className="whs-summary-content">
              <p className="whs-summary-label">New Cases</p>
              <p className="whs-summary-value">{summary.new}</p>
            </div>
          </div>

          <div className="whs-summary-card">
            <div className="whs-summary-icon" style={{ backgroundColor: '#FFFBEB' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
              </svg>
            </div>
            <div className="whs-summary-content">
              <p className="whs-summary-label">Active Cases</p>
              <p className="whs-summary-value">{summary.active}</p>
            </div>
          </div>

          <div className="whs-summary-card">
            <div className="whs-summary-icon" style={{ backgroundColor: '#ECFDF5' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <div className="whs-summary-content">
              <p className="whs-summary-label">Completed</p>
              <p className="whs-summary-value">{summary.completed}</p>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="whs-tabs">
          <button
            className={`whs-tab ${currentTab === 'cases' ? 'active' : ''}`}
            onClick={() => {
              setCurrentTab('cases')
              setStatusFilter('active')
              setCurrentPage(1)
            }}
          >
            Active Cases <span className="whs-tab-count">{summary.active}</span>
          </button>
          <button
            className={`whs-tab ${currentTab === 'completed' ? 'active' : ''}`}
            onClick={() => {
              setCurrentTab('completed')
              setStatusFilter('closed')
              setCurrentPage(1)
            }}
          >
            Completed <span className="whs-tab-count">{summary.completed}</span>
          </button>
          <button
            className={`whs-tab ${currentTab === 'notifications' ? 'active' : ''}`}
            onClick={() => setCurrentTab('notifications')}
          >
            Notifications <span className="whs-tab-badge">0</span>
          </button>
        </div>

        {/* My Cases Section - Only show when Cases or Completed tab is active */}
        {(currentTab === 'cases' || currentTab === 'completed') && (
          <div className="whs-section">
            <div className="whs-section-header">
              <div>
                <h2 className="whs-section-title">
                  {currentTab === 'completed' ? 'Completed Cases' : 'Active Cases'}
                </h2>
                <p className="whs-section-subtitle">
                  {currentTab === 'completed' 
                    ? 'View cases completed by clinicians' 
                    : 'Manage and track your assigned cases'}
                </p>
              </div>
            </div>

            <div className="whs-filters">
              <div className="whs-search-container">
                <svg className="whs-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <path d="m21 21-4.35-4.35"></path>
                </svg>
                <input
                  type="text"
                  className="whs-search-input"
                  placeholder="Search cases..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {currentTab === 'cases' && (
                <select
                  className="whs-filter-select"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value)
                    setCurrentPage(1) // Reset to first page when filter changes
                  }}
                >
                  <option value="all">All Cases</option>
                  <option value="new">New Cases</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              )}
              {currentTab === 'completed' && (
                <select
                  className="whs-filter-select"
                  value={typeFilter}
                  onChange={(e) => {
                    setTypeFilter(e.target.value)
                    setCurrentPage(1)
                  }}
                >
                  <option value="all">All Types</option>
                  <option value="accident">Accident</option>
                  <option value="injury">Injury</option>
                  <option value="medical_leave">Medical Leave</option>
                  <option value="other">Other</option>
                </select>
              )}
              <button className="whs-refresh-btn" onClick={handleRefresh}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                Refresh
              </button>
            </div>
          </div>
        )}

        {/* Cases Overview Table - Only show when Cases or Completed tab is active */}
        {(currentTab === 'cases' || currentTab === 'completed') && (
          <div className="whs-table-card">
            <div className="whs-table-header">
              <h3 className="whs-table-title">
                {currentTab === 'completed' ? 'Completed Cases Overview' : 'Cases Overview'}
              </h3>
            </div>
          
          {loading ? (
            <Loading message="Loading cases..." size="medium" />
          ) : error ? (
            <div className="whs-error">
              <p>{error}</p>
            </div>
          ) : displayedCases.length === 0 ? (
            <div className="whs-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ margin: '0 auto 16px', color: '#94A3B8' }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              <p style={{ fontWeight: 500, color: '#0F172A', marginBottom: '4px' }}>No cases found</p>
              <p style={{ fontSize: '13px', color: '#64748B' }}>
                {searchQuery || statusFilter !== 'all' || typeFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Cases will appear here when supervisors report incidents'}
              </p>
            </div>
          ) : (
            <div className="whs-table-container">
              <table className="whs-table">
                <thead>
                  <tr>
                    <th>Case #</th>
                    <th>Worker</th>
                    <th>Incident</th>
                    <th>Status</th>
                    <th>Severity</th>
                    <th>Supervisor</th>
                    <th>Clinician</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedCases.map((caseItem) => {
                    const statusStyleObj = getStatusStyle(caseItem.status)
                    const statusStyle = { backgroundColor: statusStyleObj.bg, color: statusStyleObj.color }
                    const severityStyleObj = getSeverityStyle(caseItem.severity)
                    const severityStyle = { backgroundColor: severityStyleObj.bg, color: severityStyleObj.color }
                    
                    return (
                      <tr key={caseItem.id}>
                        <td className="whs-case-number">{caseItem.caseNumber}</td>
                        <td>
                          <div className="whs-worker-info">
                            <div className="whs-worker-name">{caseItem.workerName}</div>
                            <div className="whs-worker-email">{caseItem.workerEmail}</div>
                          </div>
                        </td>
                        <td>
                          <div className="whs-incident-info">
                            <div className="whs-incident-type">{TYPE_LABELS[caseItem.type] || caseItem.type}</div>
                            <div className="whs-incident-team">{caseItem.teamName} • {caseItem.siteLocation}</div>
                          </div>
                        </td>
                        <td>
                          <span className="whs-status-badge" style={statusStyle}>
                            {caseItem.status}
                          </span>
                        </td>
                        <td>
                          <span className="whs-severity-badge" style={severityStyle}>
                            {caseItem.severity}
                          </span>
                        </td>
                        <td className="whs-supervisor">{caseItem.supervisorName}</td>
                        <td className="whs-clinician">
                          {caseItem.clinicianName ? (
                            <span style={{ color: '#10B981', fontWeight: 500 }}>{caseItem.clinicianName}</span>
                          ) : (
                            <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Not assigned</span>
                          )}
                        </td>
                        <td className="whs-date">{formatDate(caseItem.createdAt)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button 
                              className="whs-action-btn"
                              onClick={() => {
                                navigate(PROTECTED_ROUTES.WHS_CONTROL_CENTER.CASE_DETAIL.replace(':caseId', caseItem.id))
                              }}
                              title="View case details"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                              </svg>
                              View
                            </button>
                            {!caseItem.clinicianId && (
                              <button 
                                className="whs-action-btn"
                                onClick={() => {
                                  setSelectedCase(caseItem)
                                  setSelectedClinicianId('')
                                  setShowAssignModal(true)
                                }}
                                title="Assign to clinician"
                                style={{ color: '#10B981', borderColor: '#10B981' }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                  <circle cx="8.5" cy="7" r="4"></circle>
                                  <line x1="20" y1="8" x2="20" y2="14"></line>
                                  <line x1="23" y1="11" x2="17" y2="11"></line>
                                </svg>
                                Assign
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          </div>
        )}

        {/* Notifications Tab Content */}
        {currentTab === 'notifications' && (
          <div className="whs-section">
            <div className="whs-section-header">
              <div>
                <h2 className="whs-section-title">Notifications</h2>
                <p className="whs-section-subtitle">View your notifications</p>
              </div>
            </div>
            <div className="whs-empty">
              <p style={{ color: '#64748B' }}>No notifications at this time</p>
            </div>
          </div>
        )}
      </div>

      {/* Assign to Clinician Modal */}
      {showAssignModal && selectedCase && (
        <div className="whs-modal-overlay" onClick={() => setShowAssignModal(false)}>
          <div className="whs-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="whs-modal-header">
              <div>
                <h2 className="whs-modal-title">Assign Case to Clinician</h2>
                <p className="whs-modal-subtitle">{selectedCase.caseNumber}</p>
              </div>
              <button 
                className="whs-modal-close"
                onClick={() => setShowAssignModal(false)}
                aria-label="Close modal"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="whs-modal-body">
              <div className="whs-detail-item" style={{ marginBottom: '20px' }}>
                <span className="whs-detail-label">Worker:</span>
                <span className="whs-detail-value">{selectedCase.workerName}</span>
              </div>
              <div className="whs-detail-item" style={{ marginBottom: '20px' }}>
                <span className="whs-detail-label">Case Number:</span>
                <span className="whs-detail-value">{selectedCase.caseNumber}</span>
              </div>
              <div className="whs-detail-item" style={{ marginBottom: '20px' }}>
                <span className="whs-detail-label">Incident Type:</span>
                <span className="whs-detail-value">{TYPE_LABELS[selectedCase.type] || selectedCase.type}</span>
              </div>
              
              <div style={{ marginTop: '24px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#0F172A', marginBottom: '8px' }}>
                  Select Clinician *
                </label>
                {loadingClinicians ? (
                  <p style={{ color: '#64748B', fontSize: '14px' }}>Loading clinicians...</p>
                ) : clinicians.length === 0 ? (
                  <p style={{ color: '#EF4444', fontSize: '14px' }}>No clinicians available</p>
                ) : (
                  <select
                    value={selectedClinicianId}
                    onChange={(e) => setSelectedClinicianId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '6px',
                      fontSize: '14px',
                      color: '#0F172A',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="">-- Select a clinician --</option>
                    {clinicians.map((clinician) => (
                      <option key={clinician.id} value={clinician.id}>
                        {clinician.name} ({clinician.email})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="whs-modal-footer">
              <button 
                className="whs-modal-close-btn"
                onClick={() => setShowAssignModal(false)}
              >
                Cancel
              </button>
              <button 
                className="whs-modal-submit-btn"
                onClick={handleAssignToClinician}
                disabled={assigning || !selectedClinicianId || loadingClinicians}
                style={{ 
                  background: '#10B981',
                  marginLeft: '12px',
                }}
              >
                {assigning ? 'Assigning...' : 'Assign Case'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast Notification */}
      {showSuccessToast && (
        <div className="success-toast">
          <div className="success-toast-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>{successMessage}</span>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
