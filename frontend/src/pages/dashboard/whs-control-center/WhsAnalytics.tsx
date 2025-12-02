import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import './WhsAnalytics.css'

interface AnalyticsData {
  summary: {
    totalCases: number
    activeCases: number
    newCases: number
    avgResolutionTime: number // in days
    successRate: number // percentage
    clinicianAssignment: number // percentage
    closedThisPeriod: number
    upcomingDeadlines: number
    overdueTasks: number
  }
  caseTrends: Array<{
    period: string
    newCases: number
    closedCases: number
    activeCases: number
  }>
  casesByStatus: {
    open: number
    triaged: number
    assessed: number
    inRehab: number
    closed: number
    returnToWork: number
  }
  supervisorStats?: Array<{
    id: string
    name: string
    email: string
    totalCases: number
    activeCases: number
    teamsCount: number
    teamLeadersCount: number
  }>
}

interface ClinicianPerformance {
  id: string
  name: string
  email: string
  specialty: string
  status: string
  activeCases: number
  completed: number
  avgDuration: number
  successRate: number
  totalAssigned: number
}

const STATUS_COLORS = {
  open: '#3B82F6',
  triaged: '#F59E0B',
  assessed: '#8B5CF6',
  inRehab: '#EC4899',
  closed: '#10B981',
  returnToWork: '#06B6D4',
}

const CHART_COLORS = {
  newCases: '#EF4444',
  closedCases: '#3B82F6',
  activeCases: '#8B5CF6',
}

export function WhsAnalytics() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'year'>('month')
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [clinicianPerformance, setClinicianPerformance] = useState<ClinicianPerformance[]>([])
  const [loadingPerformance, setLoadingPerformance] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchAnalytics = useCallback(async () => {
    // Abort previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      setLoading(true)
      setError('')

      const result = await apiClient.get<AnalyticsData>(
        `${API_ROUTES.WHS.ANALYTICS}?range=${timeRange}&_t=${Date.now()}`,
        {
          headers: { 'Cache-Control': 'no-cache' },
          signal: abortController.signal,
        }
      )

      // Check if request was aborted before processing
      if (abortController.signal.aborted) {
        return
      }

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch analytics data')
      }

      setData(result.data)
      setLastUpdated(new Date())
    } catch (err: any) {
      // Don't show error if request was aborted
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        return
      }
      console.error('Error fetching analytics:', err)
      setError(err.message || 'Failed to load analytics data')
    } finally {
      // Only update loading state if request wasn't aborted
      if (!abortController.signal.aborted) {
        setLoading(false)
      }
    }
  }, [timeRange])

  const fetchClinicianPerformance = useCallback(async () => {
    try {
      setLoadingPerformance(true)
      const result = await apiClient.get<{ clinicians: any[] }>(
        `${API_ROUTES.WHS.CLINICIANS_PERFORMANCE}?_t=${Date.now()}`,
        { headers: { 'Cache-Control': 'no-cache' } }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch clinician performance')
      }

      setClinicianPerformance(result.data.clinicians || [])
    } catch (err: any) {
      console.error('Error fetching clinician performance:', err)
      // Don't show error banner for performance, just log it
    } finally {
      setLoadingPerformance(false)
    }
  }, [])

  useEffect(() => {
    fetchAnalytics()
    fetchClinicianPerformance()
    
    return () => {
      // Only abort on unmount, not on dependency changes
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [fetchAnalytics, fetchClinicianPerformance]) // Removed timeRange - already in fetchAnalytics deps

  const formatResolutionTime = (days: number): string => {
    if (days < 1) return '<1d'
    if (days === 1) return '1d'
    return `${Math.round(days)}d`
  }

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: true 
    })
  }

  // Prepare chart data - ensure proper formatting for stacked area chart
  const trendsData = useMemo(() => {
    if (!data?.caseTrends || data.caseTrends.length === 0) return []
    return data.caseTrends.map(trend => ({
      period: trend.period,
      'New Cases': trend.newCases || 0,
      'Closed Cases': trend.closedCases || 0,
      'Active Cases': trend.activeCases || 0,
    }))
  }, [data])

  const statusData = useMemo(() => {
    if (!data?.casesByStatus) return []
    return [
      { name: 'OPEN CASES', value: data.casesByStatus.open, color: STATUS_COLORS.open },
      { name: 'TRIAGED', value: data.casesByStatus.triaged, color: STATUS_COLORS.triaged },
      { name: 'ASSESSED', value: data.casesByStatus.assessed, color: STATUS_COLORS.assessed },
      { name: 'IN REHAB', value: data.casesByStatus.inRehab, color: STATUS_COLORS.inRehab },
      { name: 'CLOSED', value: data.casesByStatus.closed, color: STATUS_COLORS.closed },
      { name: 'RETURN TO WORK', value: data.casesByStatus.returnToWork, color: STATUS_COLORS.returnToWork },
    ].filter(item => item.value > 0)
  }, [data])

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="whs-analytics-tooltip">
          <p className="tooltip-label">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="tooltip-item" style={{ color: entry.color }}>
              {entry.name}: {entry.value}
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  if (loading && !data) {
    return (
      <DashboardLayout>
        <Loading message="Loading analytics..." size="large" />
      </DashboardLayout>
    )
  }

  if (error && !data) {
    return (
      <DashboardLayout>
        <div className="whs-analytics-error">
          <p>{error}</p>
          <button onClick={fetchAnalytics} className="retry-button">
            Retry
          </button>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="whs-analytics">
        {/* Header */}
        <div className="whs-analytics-header">
          <div>
            <h1 className="whs-analytics-title">WHS Case Manager Analytics</h1>
            <p className="whs-analytics-subtitle">
              Last updated: {formatTime(lastUpdated)}
            </p>
          </div>
          <div className="whs-analytics-controls">
            <div className="time-range-selector">
              <button
                className={`time-range-btn ${timeRange === 'week' ? 'active' : ''}`}
                onClick={() => {
                  setTimeRange('week')
                  setData(null) // Clear old data immediately
                }}
                disabled={loading}
              >
                Week
              </button>
              <button
                className={`time-range-btn ${timeRange === 'month' ? 'active' : ''}`}
                onClick={() => {
                  setTimeRange('month')
                  setData(null) // Clear old data immediately
                }}
                disabled={loading}
              >
                Month
              </button>
              <button
                className={`time-range-btn ${timeRange === 'year' ? 'active' : ''}`}
                onClick={() => {
                  setTimeRange('year')
                  setData(null) // Clear old data immediately
                }}
                disabled={loading}
              >
                Year
              </button>
            </div>
            <button
              className="refresh-button"
              onClick={fetchAnalytics}
              disabled={loading}
              title="Refresh data"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="whs-analytics-error-banner">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* KPI Cards */}
        <div className="whs-analytics-kpis">
          {/* Row 1 */}
          <div className="whs-kpi-card">
            <div className="whs-kpi-icon" style={{ backgroundColor: '#DBEAFE' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
            </div>
            <div className="whs-kpi-content">
              <p className="whs-kpi-label">Total Cases</p>
              <p className="whs-kpi-value">{data?.summary.totalCases || 0}</p>
              <p className="whs-kpi-subtext">{data?.summary.activeCases || 0} active</p>
            </div>
          </div>

          <div className="whs-kpi-card">
            <div className="whs-kpi-icon" style={{ backgroundColor: '#FEE2E2' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                <polyline points="17 6 23 6 23 12"></polyline>
              </svg>
            </div>
            <div className="whs-kpi-content">
              <p className="whs-kpi-label">New Cases</p>
              <p className="whs-kpi-value">{data?.summary.newCases || 0}</p>
              <p className="whs-kpi-subtext">This {timeRange}</p>
            </div>
          </div>

          <div className="whs-kpi-card">
            <div className="whs-kpi-icon" style={{ backgroundColor: '#EDE9FE' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
            <div className="whs-kpi-content">
              <p className="whs-kpi-label">Avg Resolution Time</p>
              <p className="whs-kpi-value">
                {data?.summary.avgResolutionTime 
                  ? formatResolutionTime(data.summary.avgResolutionTime)
                  : 'N/A'}
              </p>
              <p className="whs-kpi-subtext">Days to close</p>
            </div>
          </div>

          <div className="whs-kpi-card">
            <div className="whs-kpi-icon" style={{ backgroundColor: '#D1FAE5' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <div className="whs-kpi-content">
              <p className="whs-kpi-label">Success Rate</p>
              <p className="whs-kpi-value">{data?.summary.successRate || 0}%</p>
              <p className="whs-kpi-subtext">
                {data?.summary.closedThisPeriod || 0} completed
              </p>
            </div>
          </div>

          {/* Row 2 */}
          <div className="whs-kpi-card">
            <div className="whs-kpi-icon" style={{ backgroundColor: '#E0F2FE' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="8.5" cy="7" r="4"></circle>
                <line x1="20" y1="8" x2="20" y2="14"></line>
                <line x1="23" y1="11" x2="17" y2="11"></line>
              </svg>
            </div>
            <div className="whs-kpi-content">
              <p className="whs-kpi-label">Clinician Assignment</p>
              <p className="whs-kpi-value">{data?.summary.clinicianAssignment || 0}%</p>
              <p className="whs-kpi-subtext">Cases with clinician</p>
            </div>
          </div>

          <div className="whs-kpi-card">
            <div className="whs-kpi-icon" style={{ backgroundColor: '#D1FAE5' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <div className="whs-kpi-content">
              <p className="whs-kpi-label">Closed This Period</p>
              <p className="whs-kpi-value">{data?.summary.closedThisPeriod || 0}</p>
              <p className="whs-kpi-subtext">This {timeRange}</p>
            </div>
          </div>

          <div className="whs-kpi-card">
            <div className="whs-kpi-icon" style={{ backgroundColor: '#FEF3C7' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
            <div className="whs-kpi-content">
              <p className="whs-kpi-label">Upcoming Deadlines</p>
              <p className="whs-kpi-value">{data?.summary.upcomingDeadlines || 0}</p>
              <p className="whs-kpi-subtext">Next 7 days</p>
            </div>
          </div>

          <div className="whs-kpi-card">
            <div className="whs-kpi-icon" style={{ backgroundColor: '#FEE2E2' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <div className="whs-kpi-content">
              <p className="whs-kpi-label">Overdue Tasks</p>
              <p className="whs-kpi-value">{data?.summary.overdueTasks || 0}</p>
              <p className="whs-kpi-subtext">Requires attention</p>
            </div>
          </div>
        </div>

        {/* Charts */}
        <div className="whs-analytics-charts">
          {/* Case Trends Chart */}
          <div className="whs-chart-card whs-chart-card-wide">
            <div className="whs-chart-header">
              <div className="whs-chart-title-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                  <polyline points="17 6 23 6 23 12"></polyline>
                </svg>
                <h3 className="whs-chart-title">Case Trends Over Time</h3>
              </div>
            </div>
            <div className="whs-chart-content">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart 
                  data={trendsData} 
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  baseValue={0}
                >
                  <defs>
                    <linearGradient id="colorNewCases" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.newCases} stopOpacity={0.8}/>
                      <stop offset="95%" stopColor={CHART_COLORS.newCases} stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorClosedCases" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.closedCases} stopOpacity={0.8}/>
                      <stop offset="95%" stopColor={CHART_COLORS.closedCases} stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorActiveCases" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.activeCases} stopOpacity={0.8}/>
                      <stop offset="95%" stopColor={CHART_COLORS.activeCases} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis 
                    dataKey="period" 
                    stroke="#94A3B8"
                    style={{ fontSize: '12px' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="#94A3B8"
                    style={{ fontSize: '12px' }}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 'auto']}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                    iconType="circle"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="New Cases" 
                    stackId="1"
                    stroke={CHART_COLORS.newCases}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorNewCases)"
                    connectNulls={false}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="Closed Cases" 
                    stackId="1"
                    stroke={CHART_COLORS.closedCases}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorClosedCases)"
                    connectNulls={false}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="Active Cases" 
                    stackId="1"
                    stroke={CHART_COLORS.activeCases}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorActiveCases)"
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Cases by Status Pie Chart */}
          <div className="whs-chart-card">
            <div className="whs-chart-header">
              <div className="whs-chart-title-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="20" x2="18" y2="10"></line>
                  <line x1="12" y1="20" x2="12" y2="4"></line>
                  <line x1="6" y1="20" x2="6" y2="14"></line>
                </svg>
                <h3 className="whs-chart-title">Cases by Status</h3>
              </div>
            </div>
            <div className="whs-chart-content">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend 
                    verticalAlign="bottom" 
                    height={36}
                    iconType="circle"
                    wrapperStyle={{ paddingTop: '20px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Site Supervisor Statistics Section */}
        {data?.supervisorStats && data.supervisorStats.length > 0 && (
          <div className="whs-chart-card whs-chart-card-wide" style={{ marginTop: '20px' }}>
            <div className="whs-chart-header">
              <div className="whs-chart-title-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <h3 className="whs-chart-title">Site Supervisor Statistics</h3>
              </div>
            </div>
            <div className="whs-chart-content">
              <div className="whs-performance-table-container">
                <table className="whs-performance-table">
                  <thead>
                    <tr>
                      <th>Supervisor</th>
                      <th>Teams</th>
                      <th>Team Leaders</th>
                      <th>Total Cases</th>
                      <th>Active Cases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.supervisorStats.map((supervisor) => (
                      <tr key={supervisor.id}>
                        <td>
                          <div className="whs-clinician-name">
                            {supervisor.name}
                            <span style={{ 
                              fontSize: '12px', 
                              color: '#64748B', 
                              fontWeight: 'normal',
                              display: 'block',
                              marginTop: '2px'
                            }}>
                              {supervisor.email}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="whs-specialty-badge">{supervisor.teamsCount} {supervisor.teamsCount === 1 ? 'Team' : 'Teams'}</span>
                        </td>
                        <td>
                          <span className="whs-specialty-badge" style={{ backgroundColor: '#E0F2FE', color: '#0369A1' }}>
                            {supervisor.teamLeadersCount} {supervisor.teamLeadersCount === 1 ? 'Leader' : 'Leaders'}
                          </span>
                        </td>
                        <td>
                          <span 
                            className="whs-active-cases-link"
                            onClick={() => {
                              navigate(`${PROTECTED_ROUTES.WHS_CONTROL_CENTER.DASHBOARD}?supervisor=${supervisor.id}`)
                            }}
                            title="View cases for this supervisor"
                            style={{ fontSize: '16px', fontWeight: '600' }}
                          >
                            {supervisor.totalCases}
                          </span>
                        </td>
                        <td>
                          <span 
                            className={`whs-success-rate-badge ${
                              supervisor.activeCases >= 10 ? 'high' :
                              supervisor.activeCases >= 5 ? 'medium' : 'low'
                            }`}
                            style={{ 
                              backgroundColor: supervisor.activeCases >= 10 ? '#FEE2E2' :
                                              supervisor.activeCases >= 5 ? '#FEF3C7' : '#DBEAFE',
                              color: supervisor.activeCases >= 10 ? '#DC2626' :
                                      supervisor.activeCases >= 5 ? '#D97706' : '#2563EB'
                            }}
                          >
                            {supervisor.activeCases}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Clinician Performance Section */}
        <div className="whs-chart-card whs-chart-card-wide" style={{ marginTop: '20px' }}>
          <div className="whs-chart-header">
            <div className="whs-chart-title-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="8.5" cy="7" r="4"></circle>
                <line x1="20" y1="8" x2="20" y2="14"></line>
                <line x1="23" y1="11" x2="17" y2="11"></line>
              </svg>
              <h3 className="whs-chart-title">Clinician Performance</h3>
            </div>
          </div>
          <div className="whs-chart-content">
            {loadingPerformance ? (
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <p style={{ color: '#64748B' }}>Loading clinician performance...</p>
              </div>
            ) : clinicianPerformance.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <p style={{ color: '#64748B' }}>No clinician performance data available</p>
              </div>
            ) : (
              <div className="whs-performance-table-container">
                <table className="whs-performance-table">
                  <thead>
                    <tr>
                      <th>Clinician</th>
                      <th>Specialty</th>
                      <th>Status</th>
                      <th>Active Cases</th>
                      <th>Completed</th>
                      <th>Avg Duration</th>
                      <th>Success Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clinicianPerformance.map((clinician) => (
                      <tr key={clinician.id}>
                        <td>
                          <div className="whs-clinician-name">
                            {clinician.name}
                          </div>
                        </td>
                        <td>
                          <span className="whs-specialty-badge">{clinician.specialty}</span>
                        </td>
                        <td>
                          <span className="whs-status-badge available">
                            {clinician.status}
                          </span>
                        </td>
                        <td>
                          <span 
                            className="whs-active-cases-link"
                            onClick={() => {
                              navigate(`${PROTECTED_ROUTES.WHS_CONTROL_CENTER.DASHBOARD}?clinician=${clinician.id}`)
                            }}
                            title="View cases for this clinician"
                          >
                            {clinician.activeCases}
                          </span>
                        </td>
                        <td>{clinician.completed}</td>
                        <td>{clinician.avgDuration} days</td>
                        <td>
                          <span 
                            className={`whs-success-rate-badge ${
                              clinician.successRate >= 80 ? 'high' :
                              clinician.successRate >= 60 ? 'medium' : 'low'
                            }`}
                          >
                            {clinician.successRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

