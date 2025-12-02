import { useState, useEffect, useMemo, useRef } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import './AdminDashboard.css'

interface SystemStats {
  users: {
    total: number
    byRole: {
      worker: number
      team_leader: number
      supervisor: number
      clinician: number
      whs_control_center: number
      executive: number
      admin: number
    }
    active: number
    inactive: number
  }
  teams: {
    total: number
    withSupervisor: number
    withTeamLeader: number
    totalMembers: number
  }
  checkIns: {
    total: number
    today: number
    thisWeek: number
    thisMonth: number
    completionRate: number
    readiness: {
      green: number
      amber: number
      red: number
      pending: number
    }
  }
  cases: {
    total: number
    active: number
    closed: number
    byStatus: {
      pending: number
      in_progress: number
      completed: number
      cancelled: number
    }
  }
  incidents: {
    total: number
    incidents: number
    nearMisses: number
    thisMonth: number
  }
  appointments: {
    total: number
    upcoming: number
    completed: number
    cancelled: number
  }
}

const COLORS = {
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  pending: '#6b7280',
  blue: '#3b82f6',
  purple: '#8b5cf6',
}

export function AdminDashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<SystemStats | null>(null)
  
  // OPTIMIZATION: Pending promise cache to prevent duplicate API calls
  const pendingFetch = useRef<Promise<void> | null>(null)

  useEffect(() => {
    let isMounted = true
    let isInitialized = false
    
    const initializeData = async () => {
      if (!isMounted || isInitialized) return
      isInitialized = true
      
      await fetchSystemStats()
    }
    
    initializeData()
    
    return () => {
      isMounted = false
    }
  }, []) // Run ONCE only

  const fetchSystemStats = async () => {
    // OPTIMIZATION: Return pending promise if already fetching
    if (pendingFetch.current) {
      return pendingFetch.current
    }
    
    const promise = (async () => {
      try {
        setLoading(true)
        setError('')

        const result = await apiClient.get<SystemStats>(API_ROUTES.ADMIN.STATS)

        if (isApiError(result)) {
          throw new Error(getApiErrorMessage(result) || 'Failed to fetch system statistics')
        }

        setStats(result.data)
      } catch (err: any) {
        console.error('Error fetching system stats:', err)
        setError(err.message || 'Failed to load system statistics')
      } finally {
        setLoading(false)
        pendingFetch.current = null
      }
    })()
    
    pendingFetch.current = promise
    return promise
  }

  // Prepare chart data
  const roleDistributionData = useMemo(() => {
    if (!stats) return []
    return Object.entries(stats.users.byRole)
      .filter(([_, count]) => count > 0)
      .map(([role, count]) => ({
        name: role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        value: count,
        count,
      }))
  }, [stats])

  const readinessData = useMemo(() => {
    if (!stats) return []
    const { green, amber, red, pending } = stats.checkIns.readiness
    return [
      { name: 'Green', value: green, color: COLORS.green },
      { name: 'Amber', value: amber, color: COLORS.amber },
      { name: 'Red', value: red, color: COLORS.red },
      { name: 'Pending', value: pending, color: COLORS.pending },
    ].filter(item => item.value > 0)
  }, [stats])

  const caseStatusData = useMemo(() => {
    if (!stats) return []
    return Object.entries(stats.cases.byStatus).map(([status, count]) => ({
      name: status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: count,
    }))
  }, [stats])

  if (loading) {
    return (
      <DashboardLayout>
        <div className="admin-dashboard">
          <Loading message="Loading system statistics..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="admin-dashboard">
          <div className="error-message">
            <p>Error: {error}</p>
            <button onClick={fetchSystemStats} className="retry-button">
              Retry
            </button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (!stats) {
    return (
      <DashboardLayout>
        <div className="admin-dashboard">
          <div className="error-message">
            <p>No data available</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="admin-dashboard">
        {/* Header */}
        <header className="admin-header">
          <div>
            <h1 className="admin-title">Admin Dashboard</h1>
            <p className="admin-subtitle">System-wide overview and management</p>
          </div>
          <button onClick={fetchSystemStats} className="refresh-button" title="Refresh data">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </header>

        {/* Summary Cards */}
        <div className="stats-grid">
          {/* Users Card */}
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: '#dbeafe' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <div className="stat-content">
              <p className="stat-label">Total Users</p>
              <p className="stat-value">{stats.users.total}</p>
              <p className="stat-detail">{stats.users.active} active</p>
            </div>
          </div>

          {/* Teams Card */}
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: '#fef3c7' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="3" x2="9" y2="21"></line>
                <line x1="3" y1="9" x2="21" y2="9"></line>
              </svg>
            </div>
            <div className="stat-content">
              <p className="stat-label">Total Teams</p>
              <p className="stat-value">{stats.teams.total}</p>
              <p className="stat-detail">{stats.teams.totalMembers} members</p>
            </div>
          </div>

          {/* Check-ins Card */}
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: '#d1fae5' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
              </svg>
            </div>
            <div className="stat-content">
              <p className="stat-label">Check-ins</p>
              <p className="stat-value">{stats.checkIns.today}</p>
              <p className="stat-detail">{stats.checkIns.completionRate}% today • {stats.checkIns.total} total</p>
            </div>
          </div>

          {/* Cases Card */}
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: '#fce7f3' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </div>
            <div className="stat-content">
              <p className="stat-label">Cases</p>
              <p className="stat-value">{stats.cases.active}</p>
              <p className="stat-detail">{stats.cases.total} total • {stats.cases.byStatus.completed} completed</p>
            </div>
          </div>

          {/* Appointments Card */}
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: '#e0e7ff' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </div>
            <div className="stat-content">
              <p className="stat-label">Upcoming Appointments</p>
              <p className="stat-value">{stats.appointments.upcoming}</p>
              <p className="stat-detail">{stats.appointments.total} total</p>
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="charts-section">
          {/* Role Distribution */}
          <div className="chart-card">
            <h3 className="chart-title">User Distribution by Role</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={roleDistributionData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, count }) => `${name}: ${count}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {roleDistributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={Object.values(COLORS)[index % Object.values(COLORS).length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Readiness Distribution */}
          <div className="chart-card">
            <h3 className="chart-title">Readiness Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={readinessData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {readinessData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </DashboardLayout>
  )
}

