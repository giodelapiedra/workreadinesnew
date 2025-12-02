import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { getStatusStyle, getStatusInlineStyle } from '../../../utils/caseStatus'
import { getAvatarColor, getUserInitials } from '../../../utils/avatarUtils'
import { formatDateDisplay } from '../../../shared/date'
import * as XLSX from 'xlsx'
import './RecordCases.css'

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
  returnToWorkDutyType?: 'modified' | 'full' | null
  returnToWorkDate?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
}

const TYPE_LABELS: Record<string, string> = {
  accident: 'Accident',
  injury: 'Injury',
  medical_leave: 'Medical Leave',
  other: 'Other',
}

export function RecordCases() {
  const navigate = useNavigate()
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const itemsPerPage = 200 // Show 200 records per page like in the image
  // Debounce search query to reduce API calls
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery)
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fetch all cases
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

        const result = await apiClient.get<{ cases: Case[]; pagination: any }>(
          `${API_ROUTES.WHS.CASES}?${params.toString()}`
        )

        if (isApiError(result)) {
          throw new Error(getApiErrorMessage(result) || 'Failed to fetch cases')
        }

        const data = result.data
        
        if (isMounted) {
          setCases(data.cases || [])
          setTotalRecords(data.pagination?.total || data.cases?.length || 0)
        }
      } catch (err: any) {
        console.error('Error fetching cases:', err)
        if (isMounted) {
          setError(err.message || 'Failed to load cases')
          setCases([])
          setTotalRecords(0)
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

  // Cases are already sorted by backend - no client-side processing needed

  const handleRefresh = () => {
    setCurrentPage(1)
    setRefreshKey(prev => prev + 1)
  }

  const handleDownloadExcel = useCallback(async () => {
    // Prevent multiple simultaneous exports
    if (exporting) return
    
    try {
      setExporting(true)
      setError('')

      // Calculate max limit (backend allows up to 1000 per request)
      const maxLimit = Math.min(totalRecords || 1000, 1000)
      
      // Fetch all cases for export (respecting current filters)
      // Use maximum limit to get all records in one request if possible
      const params = new URLSearchParams({
        page: '1',
        limit: maxLimit.toString(),
        status: statusFilter,
        type: typeFilter,
        search: debouncedSearchQuery,
      })

      const result = await apiClient.get<{ cases: Case[] }>(
        `${API_ROUTES.WHS.CASES}?${params.toString()}`
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch cases for export')
      }

      const data = result.data
      const allCases = data.cases || []

      if (!allCases || allCases.length === 0) {
        setError('No cases to export')
        setExporting(false)
        return
      }

      // Optimize: Prepare data for Excel export (memoized transformation)
      // Use pre-allocated array for better performance
      const excelData = new Array(allCases.length)
      const typeLabelsCache = TYPE_LABELS
      
      for (let i = 0; i < allCases.length; i++) {
        const caseItem = allCases[i]
        excelData[i] = {
          'Worker Name': caseItem.workerName || '',
          'Case ID': caseItem.caseNumber || '',
          'Email Address': caseItem.workerEmail || '',
          'Incident Type': typeLabelsCache[caseItem.type] || caseItem.type || '',
          'Team': caseItem.teamName || '',
          'Status': caseItem.status || '',
          'Actions': 'View Details'
        }
      }

      // Create workbook and worksheet efficiently
      const worksheet = XLSX.utils.json_to_sheet(excelData)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Cases')

      // Set optimized column widths
      worksheet['!cols'] = [
        { wch: 25 }, // Worker Name
        { wch: 15 }, // Case ID
        { wch: 30 }, // Email Address
        { wch: 18 }, // Incident Type
        { wch: 20 }, // Team
        { wch: 15 }, // Status
        { wch: 15 }  // Actions
      ]

      // Generate filename with timestamp for uniqueness
      const date = new Date()
      const dateStr = date.toISOString().split('T')[0]
      const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-')
      const filename = `cases_export_${dateStr}_${timeStr}.xlsx`

      // Write file and trigger download (non-blocking)
      XLSX.writeFile(workbook, filename)
      
    } catch (error: any) {
      // Don't show error if user cancelled
      if (error.name === 'AbortError') {
        return
      }
      console.error('Error exporting to Excel:', error)
      setError(error.message || 'Failed to export Excel file. Please try again.')
    } finally {
      setExporting(false)
    }
  }, [totalRecords, statusFilter, typeFilter, debouncedSearchQuery, exporting])

  // Calculate pagination info
  const totalPages = useMemo(() => {
    return Math.ceil(totalRecords / itemsPerPage) || 1
  }, [totalRecords, itemsPerPage])
  
  const startRecord = useMemo(() => {
    return totalRecords > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0
  }, [currentPage, itemsPerPage, totalRecords])
  
  const endRecord = useMemo(() => {
    return Math.min(currentPage * itemsPerPage, totalRecords)
  }, [currentPage, itemsPerPage, totalRecords])

  return (
    <DashboardLayout>
      <div className="record-cases">
        {/* Header */}
        <div className="record-cases-header">
          <div>
            <h1 className="record-cases-title">Record Cases</h1>
            <p className="record-cases-subtitle">View and manage all case records</p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="record-cases-toolbar">
          <div className="record-cases-toolbar-left">
            <div className="record-cases-search">
              <svg className="record-cases-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              <input
                type="text"
                className="record-cases-search-input"
                placeholder="Search cases..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button className="record-cases-refresh-btn" title="Refresh" onClick={handleRefresh}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
            <button 
              className="record-cases-download-btn" 
              title={exporting ? 'Exporting...' : 'Download Excel'} 
              onClick={handleDownloadExcel}
              disabled={cases.length === 0 || loading || exporting}
            >
              {exporting ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="spinning">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25"></circle>
                  <path d="M12 2 A10 10 0 0 1 22 12" strokeLinecap="round"></path>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              )}
            </button>
          </div>
          <div className="record-cases-toolbar-right">
            <span className="record-cases-pagination-info">
              {totalRecords > 0 ? `${startRecord}-${endRecord} of ${totalRecords}` : '0 records'}
            </span>
            <button 
              className="record-cases-pagination-btn"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <span className="record-cases-page-number">{currentPage}</span>
            <button 
              className="record-cases-pagination-btn"
              disabled={currentPage >= totalPages || totalPages === 0}
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="record-cases-filters">
          <select
            className="record-cases-filter-select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setCurrentPage(1)
            }}
          >
            <option value="all">All Status</option>
            <option value="new">New Cases</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
          </select>
          <select
            className="record-cases-filter-select"
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
        </div>

        {/* Table */}
        <div className="record-cases-table-container">
          {loading ? (
            <Loading message="Loading case records..." size="medium" />
          ) : error ? (
            <div className="record-cases-error">
              <p>{error}</p>
            </div>
          ) : cases.length === 0 ? (
            <div className="record-cases-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="record-cases-empty-icon">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              <p className="record-cases-empty-title">No cases found</p>
              <p className="record-cases-empty-message">
                {searchQuery || statusFilter !== 'all' || typeFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Cases will appear here when they are reported'}
              </p>
            </div>
          ) : (
            <table className="record-cases-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" />
                  </th>
                  <th>Worker Name</th>
                  <th>Case ID</th>
                  <th>Email Address</th>
                  <th>Incident Type</th>
                  <th>Team</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((caseItem) => {
                  const statusStyle = getStatusInlineStyle(caseItem.status)
                  const avatarColor = getAvatarColor(caseItem.workerName)
                  const initials = getUserInitials(caseItem.workerName, caseItem.workerEmail)
                  
                  return (
                    <tr key={caseItem.id}>
                      <td>
                        <input type="checkbox" />
                      </td>
                      <td>
                        <div className="record-cases-worker-info">
                          <div 
                            className="record-cases-avatar"
                            style={{ backgroundColor: avatarColor }}
                          >
                            {initials}
                          </div>
                          <span className="record-cases-worker-name">{caseItem.workerName}</span>
                        </div>
                      </td>
                      <td className="record-cases-case-id">{caseItem.caseNumber}</td>
                      <td className="record-cases-email">{caseItem.workerEmail}</td>
                      <td className="record-cases-type">{TYPE_LABELS[caseItem.type] || caseItem.type}</td>
                      <td className="record-cases-team">{caseItem.teamName}</td>
                      <td>
                        <span className="record-cases-status-badge" style={statusStyle}>
                          {caseItem.status}
                        </span>
                      </td>
                      <td>
                        <button
                          className="record-cases-view-details"
                          onClick={() => {
                            navigate(PROTECTED_ROUTES.WHS_CONTROL_CENTER.CASE_DETAIL.replace(':caseId', caseItem.id))
                          }}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}

