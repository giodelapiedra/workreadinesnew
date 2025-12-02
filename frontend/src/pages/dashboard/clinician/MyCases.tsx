import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { Avatar } from '../../../components/Avatar'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { getStatusLabel, getStatusInlineStyle } from '../../../utils/caseStatus'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './MyCases.css'

interface Case {
  id: string
  caseNumber: string
  workerId: string
  workerName: string
  workerEmail: string
  workerInitials: string
  workerProfileImageUrl?: string | null
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
  phone?: string | null
  healthLink?: number | null
  payer?: boolean | null
  caseManager?: boolean | null
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

export function MyCases() {
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

  // Debounced search - must be declared before useCallback that uses it
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery)
  
  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
      // Reset to first page when search changes
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
      
      // Add search query if provided (backend handles search)
      if (debouncedSearch.trim()) {
        params.append('search', debouncedSearch.trim())
      }

      const result = await apiClient.get<{
        cases: Case[]
        pagination: Pagination
      }>(
        `${API_ROUTES.CLINICIAN.CASES}?${params}`,
        { headers: { 'Cache-Control': 'no-cache' } }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch cases')
      }

      const data = result.data
      setCases(data.cases || [])
      setPagination(prev => ({
        ...prev,
        total: data.pagination?.total || prev.total,
        totalPages: data.pagination?.totalPages || prev.totalPages,
        hasNext: data.pagination?.hasNext || false,
        hasPrev: data.pagination?.hasPrev || false,
      }))
    } catch (err: any) {
      console.error('Error fetching cases:', err)
      setError(err.message || 'Failed to load cases')
    } finally {
      setLoading(false)
    }
  }, [pagination.page, pagination.limit, showActiveOnly, debouncedSearch])

  // Fetch cases when dependencies change
  useEffect(() => {
    fetchCases()
  }, [fetchCases])

  // Get avatar color
  // Removed getAvatarColor - now using centralized Avatar component

  // Handle pagination
  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleLimitChange = (newLimit: number) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }))
  }

  // Handle view case - navigate to detail page
  const handleViewCase = (caseId: string) => {
    navigate(PROTECTED_ROUTES.CLINICIAN.CASE_DETAIL.replace(':caseId', caseId))
  }

  // Calculate display range
  const startRecord = pagination.total > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0
  const endRecord = Math.min(pagination.page * pagination.limit, pagination.total)

  if (loading && cases.length === 0) {
    return (
      <DashboardLayout>
        <div className="my-cases-container">
          <Loading message="Loading cases..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="my-cases-container">
        {/* Header */}
        <div className="my-cases-header">
          <div>
            <h1 className="my-cases-title">My Cases</h1>
            <p className="my-cases-subtitle">Manage and view all your assigned cases</p>
          </div>
        </div>

        {/* Search and Filter Bar */}
        <div className="my-cases-controls">
          <div className="my-cases-search">
            <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
            <input
              type="text"
              placeholder="Search by Name, Company, Position, Phone or Email"
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
          <div className="my-cases-error">
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
          <div className="my-cases-empty">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <h2>No cases found</h2>
            <p>
              {searchQuery
                ? 'Try adjusting your search query'
                : showActiveOnly
                ? 'No active cases at the moment'
                : 'No cases assigned to you yet'}
            </p>
          </div>
        ) : (
          <>
            <div className="my-cases-table-wrapper">
              <table className="my-cases-table">
                <thead>
                  <tr>
                    <th>
                      <div className="table-header-content">
                        Display Name
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </div>
                    </th>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Position</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Location</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((caseItem) => {
                    const statusStyle = getStatusInlineStyle(caseItem.status)
                    return (
                      <tr key={caseItem.id} className="table-row">
                        <td>
                          <div className="display-name-cell">
                            <Avatar
                              userId={caseItem.workerId}
                              profileImageUrl={caseItem.workerProfileImageUrl}
                              firstName={caseItem.workerName.split(' ')[0]}
                              lastName={caseItem.workerName.split(' ').slice(1).join(' ')}
                              email={caseItem.workerEmail}
                              size="sm"
                              showTooltip
                            />
                            <span className="case-number">{caseItem.caseNumber || '--'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="name-cell">
                            <span className="worker-name">{caseItem.workerName || '--'}</span>
                            <span className="status-badge" style={statusStyle}>
                              {getStatusLabel(caseItem.status)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="company-name">{caseItem.teamName || '--'}</span>
                        </td>
                        <td>
                          <span className="position-text">{TYPE_LABELS[caseItem.type] || caseItem.type || '--'}</span>
                        </td>
                        <td>
                          <span className="phone-text">{caseItem.phone || '--'}</span>
                        </td>
                        <td>
                          <span className="email-text">{caseItem.workerEmail || '--'}</span>
                        </td>
                        <td>
                          <span className="location-text">{caseItem.siteLocation || 'All Locations'}</span>
                        </td>
                        <td>
                          <button
                            className="view-button"
                            onClick={() => handleViewCase(caseItem.id)}
                            aria-label={`View case ${caseItem.caseNumber}`}
                          >
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
            <div className="my-cases-pagination">
              <div className="pagination-info">
                Showing {startRecord} to {endRecord} of {pagination.total} entries
              </div>
              <div className="pagination-controls">
                <select
                  className="pagination-limit"
                  value={pagination.limit}
                  onChange={(e) => handleLimitChange(Number(e.target.value))}
                  aria-label="Items per page"
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(1)}
                  disabled={!pagination.hasPrev}
                  aria-label="First page"
                >
                  &lt;&lt;
                </button>
                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={!pagination.hasPrev}
                  aria-label="Previous page"
                >
                  &lt;
                </button>
                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                  let pageNum: number
                  if (pagination.totalPages <= 5) {
                    pageNum = i + 1
                  } else if (pagination.page <= 3) {
                    pageNum = i + 1
                  } else if (pagination.page >= pagination.totalPages - 2) {
                    pageNum = pagination.totalPages - 4 + i
                  } else {
                    pageNum = pagination.page - 2 + i
                  }
                  return (
                    <button
                      key={pageNum}
                      className={`pagination-btn ${pagination.page === pageNum ? 'active' : ''}`}
                      onClick={() => handlePageChange(pageNum)}
                      aria-label={`Page ${pageNum}`}
                      aria-current={pagination.page === pageNum ? 'page' : undefined}
                    >
                      {pageNum}
                    </button>
                  )
                })}
                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={!pagination.hasNext}
                  aria-label="Next page"
                >
                  &gt;
                </button>
                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(pagination.totalPages)}
                  disabled={!pagination.hasNext}
                  aria-label="Last page"
                >
                  &gt;&gt;
                </button>
              </div>
            </div>
          </>
        )}

      </div>
    </DashboardLayout>
  )
}

