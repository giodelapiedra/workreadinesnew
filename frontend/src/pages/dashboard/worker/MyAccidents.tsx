import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { getStatusLabel, getStatusInlineStyle } from '../../../utils/caseStatus'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './MyAccidents.css'

interface Case {
  id: string
  caseNumber: string
  workerId: string
  workerName: string
  workerEmail: string
  workerInitials: string
  teamId: string
  teamName: string
  siteLocation: string
  supervisorId: string | null
  supervisorName: string
  teamLeaderId: string | null
  teamLeaderName: string
  type: string
  reason: string
  startDate: string
  endDate: string | null
  status: 'NEW CASE' | 'ACTIVE' | 'TRIAGED' | 'ASSESSED' | 'IN REHAB' | 'RETURN TO WORK' | 'CLOSED'
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  isActive: boolean
  isInRehab: boolean
  createdAt: string
  updatedAt: string
  caseStatus: string | null
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

const TYPE_LABELS: Record<string, string> = {
  injury: 'Injury',
  accident: 'Accident',
  medical_leave: 'Medical Leave',
  other: 'Other',
}

export function MyAccidents() {
  const navigate = useNavigate()
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showActiveOnly, setShowActiveOnly] = useState(false)
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 100,
    total: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  })

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery)
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
      setPagination(prev => ({ ...prev, page: 1 }))
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fetch cases with pagination
  const fetchCases = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        status: showActiveOnly ? 'active' : 'all',
      })
      
      if (debouncedSearch.trim()) {
        params.append('search', debouncedSearch.trim())
      }

      const result = await apiClient.get<{ cases: Case[]; pagination: Pagination }>(
        `${API_ROUTES.WORKER.BASE}/cases?${params}`,
        {
          headers: { 'Cache-Control': 'no-cache' },
        }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch cases')
      }

      setCases(result.data.cases || [])
      setPagination(prev => ({
        ...prev,
        total: result.data.pagination?.total || prev.total,
        totalPages: result.data.pagination?.totalPages || prev.totalPages,
        hasNext: result.data.pagination?.hasNext || false,
        hasPrev: result.data.pagination?.hasPrev || false,
      }))
    } catch (err: any) {
      console.error('Error fetching cases:', err)
      setError(err.message || 'Failed to load cases')
    } finally {
      setLoading(false)
    }
  }, [pagination.page, pagination.limit, showActiveOnly, debouncedSearch])

  useEffect(() => {
    fetchCases()
  }, [fetchCases])

  // Get avatar color
  const getAvatarColor = useCallback((name: string) => {
    const colors = [
      '#9b8b7e', '#5b4fc7', '#10b981', '#f59e0b',
      '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6',
    ]
    const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length
    return colors[index]
  }, [])

  // Handle pagination
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Handle view case - navigate to detail page (VIEW ONLY)
  const handleViewCase = (caseId: string) => {
    navigate(PROTECTED_ROUTES.WORKER.ACCIDENT_DETAIL.replace(':caseId', caseId))
  }

  // Calculate display range
  const startRecord = pagination.total > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0
  const endRecord = Math.min(pagination.page * pagination.limit, pagination.total)

  if (loading && cases.length === 0) {
    return (
      <DashboardLayout>
        <div className="my-accidents-container">
          <Loading message="Loading your accident records..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="my-accidents-container">
        {/* Header */}
        <div className="my-accidents-header">
          <div>
            <h1 className="my-accidents-title">My Accidents</h1>
            <p className="my-accidents-subtitle">View your accident and incident records</p>
          </div>
        </div>

        {/* Search and Filter Bar */}
        <div className="my-accidents-controls">
          <div className="my-accidents-search">
            <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
            <input
              type="text"
              placeholder="Search by case number, type, or team"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          <button
            className={`active-toggle ${showActiveOnly ? 'active' : ''}`}
            onClick={() => {
              setShowActiveOnly(!showActiveOnly)
              setPagination(prev => ({ ...prev, page: 1 }))
            }}
            aria-label={showActiveOnly ? 'Show all cases' : 'Show active cases only'}
          >
            {showActiveOnly && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            )}
            Active
          </button>
        </div>

        {/* Error State */}
        {error && (
          <div className="my-accidents-error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            {error}
          </div>
        )}

        {/* Table */}
        {cases.length === 0 ? (
          <div className="my-accidents-empty">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <h2>No accident records found</h2>
            <p>
              {searchQuery
                ? 'Try adjusting your search query'
                : showActiveOnly
                ? 'No active cases at the moment'
                : 'You have no accident records yet'}
            </p>
          </div>
        ) : (
          <>
            <div className="my-accidents-table-wrapper">
              <table className="my-accidents-table">
                <thead>
                  <tr>
                    <th>Case Number</th>
                    <th>Type</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((caseItem) => {
                    const statusStyle = getStatusInlineStyle(caseItem.status)
                    const priorityStyle = caseItem.priority === 'HIGH' 
                      ? { bg: '#FEE2E2', color: '#EF4444' }
                      : caseItem.priority === 'MEDIUM'
                      ? { bg: '#FEF3C7', color: '#F59E0B' }
                      : { bg: '#DBEAFE', color: '#3B82F6' }

                    return (
                      <tr key={caseItem.id}>
                        <td>
                          <div className="case-number-cell">
                            <span className="case-number">{caseItem.caseNumber}</span>
                          </div>
                        </td>
                        <td>
                          <span className="case-type">{TYPE_LABELS[caseItem.type] || caseItem.type}</span>
                        </td>
                        <td>
                          <div className="case-reason" title={caseItem.reason}>
                            {caseItem.reason || 'N/A'}
                          </div>
                        </td>
                        <td>
                          <span className="case-status" style={statusStyle}>
                            {getStatusLabel(caseItem.status)}
                          </span>
                        </td>
                        <td>
                          <span className="case-priority" style={priorityStyle}>
                            {caseItem.priority}
                          </span>
                        </td>
                        <td>
                          <div className="case-date">
                            {new Date(caseItem.startDate).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </div>
                        </td>
                        <td>
                          <button
                            className="view-case-btn"
                            onClick={() => handleViewCase(caseItem.id)}
                            title="View case details"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                              <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                            View
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="my-accidents-pagination">
                <div className="pagination-info">
                  Showing {startRecord} to {endRecord} of {pagination.total} records
                </div>
                <div className="pagination-controls">
                  <button
                    className="pagination-btn"
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={!pagination.hasPrev}
                  >
                    Previous
                  </button>
                  <span className="pagination-page-info">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <button
                    className="pagination-btn"
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={!pagination.hasNext}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  )
}







