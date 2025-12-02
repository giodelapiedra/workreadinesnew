import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './MyIncidents.css'

interface Incident {
  id: string
  workerId: string
  workerName: string
  workerEmail: string
  teamId: string
  teamName: string
  siteLocation: string | null
  type: string
  reason: string
  startDate: string
  endDate: string | null
  isActive: boolean
  assignedToWhs: boolean
  clinicianId: string | null
  caseStatus: string | null
  statusCategory: 'in_progress' | 'rehabilitation' | 'completed'
  approvedByClinician: string | null
  approvedAt: string | null
  whsApprovedBy: string | null
  whsApprovedAt: string | null
  returnToWorkDutyType: string | null
  returnToWorkDate: string | null
  createdAt: string
  updatedAt: string
}

interface IncidentData {
  in_progress: Incident[]
  rehabilitation: Incident[]
  completed: Incident[]
}

export function MyIncidents() {
  const navigate = useNavigate()
  const [incidents, setIncidents] = useState<IncidentData>({
    in_progress: [],
    rehabilitation: [],
    completed: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  
  // Date range state - default to last 6 months
  const today = new Date()
  const defaultStartDate = new Date(today.getFullYear(), today.getMonth() - 6, 1)
  const [startDate, setStartDate] = useState(defaultStartDate.toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0])
  const [activePreset, setActivePreset] = useState<'last30' | 'last3months' | 'last6months' | 'lastYear' | 'custom'>('last6months')

  const fetchIncidents = useCallback(async () => {
    try {
      setError('')
      setLoading(true)

      const params = new URLSearchParams({
        startDate,
        endDate,
      })

      const result = await apiClient.get<{ incidents: IncidentData }>(
        `${API_ROUTES.SUPERVISOR.MY_INCIDENTS}?${params.toString()}`
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch incidents')
      }

      const data = result.data
      const allIncidents: IncidentData = data.incidents || { in_progress: [], rehabilitation: [], completed: [] }

      const filterByClinicianApproval = (group: Incident[]) =>
        group.filter((incident) => Boolean(incident.approvedByClinician))

      const filteredIncidents: IncidentData = {
        in_progress: filterByClinicianApproval(allIncidents.in_progress || []),
        rehabilitation: filterByClinicianApproval(allIncidents.rehabilitation || []),
        completed: filterByClinicianApproval(allIncidents.completed || []),
      }

      setIncidents(filteredIncidents)
    } catch (err: any) {
      console.error('Error fetching incidents:', err)
      setError(err.message || 'Failed to load incidents')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => {
    fetchIncidents()
  }, [fetchIncidents])

  // Date preset handlers
  const setDatePreset = (preset: 'last30' | 'last3months' | 'last6months' | 'lastYear') => {
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    const endDateStr = today.toISOString().split('T')[0]
    
    let startDateStr = ''
    
    switch (preset) {
      case 'last30':
        const last30 = new Date(today)
        last30.setDate(last30.getDate() - 30)
        startDateStr = last30.toISOString().split('T')[0]
        break
      case 'last3months':
        const last3Months = new Date(today.getFullYear(), today.getMonth() - 3, 1)
        startDateStr = last3Months.toISOString().split('T')[0]
        break
      case 'last6months':
        const last6Months = new Date(today.getFullYear(), today.getMonth() - 6, 1)
        startDateStr = last6Months.toISOString().split('T')[0]
        break
      case 'lastYear':
        const lastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
        startDateStr = lastYear.toISOString().split('T')[0]
        break
    }
    
    setStartDate(startDateStr)
    setEndDate(endDateStr)
    setActivePreset(preset)
  }

  const handleDateChange = (type: 'start' | 'end', value: string) => {
    if (type === 'start') {
      setStartDate(value)
    } else {
      setEndDate(value)
    }
    setActivePreset('custom')
  }

  // Combine all incidents and filter
  const allIncidents = useMemo(() => {
    return [
      ...incidents.in_progress,
      ...incidents.rehabilitation,
      ...incidents.completed,
    ]
  }, [incidents])

  // Filter incidents based on search query
  const filteredIncidents = useMemo(() => {
    if (!searchQuery.trim()) return allIncidents
    const query = searchQuery.toLowerCase()
    return allIncidents.filter(incident =>
      incident.workerName.toLowerCase().includes(query) ||
      incident.workerEmail.toLowerCase().includes(query) ||
      incident.teamName.toLowerCase().includes(query) ||
      (incident.siteLocation && incident.siteLocation.toLowerCase().includes(query))
    )
  }, [allIncidents, searchQuery])

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      injury: 'Injury / Medical',
      medical_leave: 'Sick Leave',
      accident: 'On Leave / RDO',
      transfer: 'Transferred',
      other: 'Not Rostered',
    }
    return labels[type] || type
  }

  const getCaseStatusLabel = (caseStatus: string | null) => {
    if (!caseStatus) return 'New'
    const labels: Record<string, string> = {
      new: 'New',
      triaged: 'Triaged',
      assessed: 'Assessed',
      in_rehab: 'In Rehabilitation',
      return_to_work: 'Return to Work',
      closed: 'Closed',
    }
    return labels[caseStatus] || caseStatus
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) {
      return `${diffMins}m`
    } else if (diffHours < 24) {
      const mins = diffMins % 60
      return mins > 0 ? `${diffHours}h ${mins}m` : `${diffHours}h`
    } else {
      const hours = diffHours % 24
      return hours > 0 ? `${diffDays}d ${hours}h` : `${diffDays}d`
    }
  }

  const getStatusBadgeClass = (statusCategory: string, caseStatus: string | null) => {
    if (statusCategory === 'completed') return 'status-resolved'
    if (statusCategory === 'rehabilitation') return 'status-in-progress'
    if (caseStatus === 'new') return 'status-new'
    return 'status-in-progress'
  }

  const getStatusLabel = (statusCategory: string, caseStatus: string | null) => {
    if (statusCategory === 'completed') return 'RESOLVED'
    if (statusCategory === 'rehabilitation') return 'IN PROGRESS'
    if (caseStatus === 'new' || !caseStatus) return 'NEW'
    return 'IN PROGRESS'
  }

  const getSeverity = (type: string) => {
    if (type === 'injury') return { level: 'Emergency', icon: '🔴' }
    if (type === 'accident') return { level: 'High', icon: '🔴' }
    if (type === 'medical_leave') return { level: 'Medium', icon: '🟠' }
    return { level: 'Low', icon: '🔵' }
  }

  const handleViewIncident = (incident: Incident) => {
    navigate(`${PROTECTED_ROUTES.SUPERVISOR.MY_INCIDENTS}/${incident.id}`)
  }

  const IncidentTableRow = ({ incident }: { incident: Incident }) => {
    const severity = getSeverity(incident.type)
    const statusBadgeClass = getStatusBadgeClass(incident.statusCategory, incident.caseStatus)
    const statusLabel = getStatusLabel(incident.statusCategory, incident.caseStatus)
    const reference = `#${incident.id.substring(0, 8).toUpperCase()}`
    const location = incident.siteLocation 
      ? `${incident.siteLocation}, ${incident.teamName}` 
      : incident.teamName

    return (
      <tr className="incident-table-row">
        <td className="table-cell reference-cell">{reference}</td>
        <td className="table-cell">
          <span className={`status-badge ${statusBadgeClass}`}>{statusLabel}</span>
        </td>
        <td className="table-cell">{location}</td>
        <td className="table-cell">{getTimeAgo(incident.createdAt)}</td>
        <td className="table-cell">{getTypeLabel(incident.type)}</td>
        <td className="table-cell">
          <span className="severity-badge" data-severity={severity.level.toLowerCase()}>
            <span className="severity-icon">{severity.icon}</span>
            {severity.level}
          </span>
        </td>
        <td className="table-cell action-cell">
          <button 
            className="view-btn"
            onClick={() => handleViewIncident(incident)}
          >
            View
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </td>
      </tr>
    )
  }


  return (
    <DashboardLayout>
      <div className="my-incidents-container">
        {/* Header */}
        <div className="my-incidents-header">
          <div className="header-left">
            <h1 className="page-title">My Submitted Incidents</h1>
            <p className="page-subtitle">Monitor the status of incidents you've submitted</p>
          </div>
          <div className="header-actions">
            <button
              onClick={fetchIncidents}
              className="refresh-btn"
              title="Refresh"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Date Filters and Search */}
        <div className="filters-container">
          <div className="date-filters">
            <div className="date-presets">
              <button
                className={`date-preset-btn ${activePreset === 'last30' ? 'active' : ''}`}
                onClick={() => setDatePreset('last30')}
                title="Last 30 Days"
              >
                30 Days
              </button>
              <button
                className={`date-preset-btn ${activePreset === 'last3months' ? 'active' : ''}`}
                onClick={() => setDatePreset('last3months')}
                title="Last 3 Months"
              >
                3 Months
              </button>
              <button
                className={`date-preset-btn ${activePreset === 'last6months' ? 'active' : ''}`}
                onClick={() => setDatePreset('last6months')}
                title="Last 6 Months"
              >
                6 Months
              </button>
              <button
                className={`date-preset-btn ${activePreset === 'lastYear' ? 'active' : ''}`}
                onClick={() => setDatePreset('lastYear')}
                title="Last Year"
              >
                1 Year
              </button>
            </div>
            <div className="date-inputs">
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleDateChange('start', e.target.value)}
                className="date-input"
                max={endDate}
              />
              <span className="date-separator">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => handleDateChange('end', e.target.value)}
                className="date-input"
                min={startDate}
                max={today.toISOString().split('T')[0]}
              />
            </div>
          </div>
          <div className="search-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
            <input
              type="text"
              placeholder="Search by worker name, email, or team..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {/* Incident Table */}
        {loading ? (
          <Loading message="Loading incidents..." size="large" />
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="incidents-table-container">
              <table className="incidents-table">
                <thead>
                  <tr>
                    <th className="table-header">
                      Reference
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 9l4-4 4 4M16 15l-4 4-4-4"></path>
                      </svg>
                    </th>
                    <th className="table-header">
                      Status
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 9l4-4 4 4M16 15l-4 4-4-4"></path>
                      </svg>
                    </th>
                    <th className="table-header">
                      Location
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 9l4-4 4 4M16 15l-4 4-4-4"></path>
                      </svg>
                    </th>
                    <th className="table-header">
                      Time
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 9l4-4 4 4M16 15l-4 4-4-4"></path>
                      </svg>
                    </th>
                    <th className="table-header">
                      Type
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 9l4-4 4 4M16 15l-4 4-4-4"></path>
                      </svg>
                    </th>
                    <th className="table-header">
                      Severity
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 9l4-4 4 4M16 15l-4 4-4-4"></path>
                      </svg>
                    </th>
                    <th className="table-header">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIncidents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty-table-message">
                        No incidents found
                      </td>
                    </tr>
                  ) : (
                    filteredIncidents.map(incident => (
                      <IncidentTableRow key={incident.id} incident={incident} />
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="incidents-table-mobile">
              {filteredIncidents.length === 0 ? (
                <div className="empty-table-message">
                  No incidents found
                </div>
              ) : (
                filteredIncidents.map(incident => {
                  const severity = getSeverity(incident.type)
                  const statusBadgeClass = getStatusBadgeClass(incident.statusCategory, incident.caseStatus)
                  const statusLabel = getStatusLabel(incident.statusCategory, incident.caseStatus)
                  const reference = `#${incident.id.substring(0, 8).toUpperCase()}`
                  const location = incident.siteLocation 
                    ? `${incident.siteLocation}, ${incident.teamName}` 
                    : incident.teamName

                  return (
                    <div key={incident.id} className="incident-card-mobile">
                      <div className="incident-card-header">
                        <div>
                          <div className="incident-card-ref">{reference}</div>
                          <div className="incident-card-status">
                            <span className={`status-badge ${statusBadgeClass}`}>{statusLabel}</span>
                          </div>
                        </div>
                        <span className="severity-badge" data-severity={severity.level.toLowerCase()}>
                          <span className="severity-icon">{severity.icon}</span>
                          {severity.level}
                        </span>
                      </div>
                      <div className="incident-card-body">
                        <div className="incident-card-row">
                          <span className="incident-card-label">Location:</span>
                          <span className="incident-card-value">{location}</span>
                        </div>
                        <div className="incident-card-row">
                          <span className="incident-card-label">Time:</span>
                          <span className="incident-card-value">{getTimeAgo(incident.createdAt)}</span>
                        </div>
                        <div className="incident-card-row">
                          <span className="incident-card-label">Type:</span>
                          <span className="incident-card-value">{getTypeLabel(incident.type)}</span>
                        </div>
                      </div>
                      <div className="incident-card-actions">
                        <button 
                          className="view-btn view-btn-mobile"
                          onClick={() => handleViewIncident(incident)}
                        >
                          View Details
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}

