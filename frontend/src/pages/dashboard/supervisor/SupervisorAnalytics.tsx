import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { API_BASE_URL } from '../../../config/api'
import { API_ROUTES } from '../../../config/apiRoutes'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { formatDate } from '../../../shared/date'
import { buildUrl } from '../../../utils/queryBuilder'
import {
  Area,
  AreaChart,
  BarChart,
  Bar,
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
import './SupervisorAnalytics.css'

// Simple in-memory cache with TTL
const cache = new Map<string, { data: any; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

interface AnalyticsData {
  summary: {
    totalTeams: number
    totalMembers: number
    totalActiveMembers: number
    overallCompletionRate: number
    overallReadiness: { green: number; amber: number; red: number }
    totalIncidents: number
    totalNearMisses: number
    totalActiveExceptions: number
  }
  teamStats: Array<{
    teamId: string
    teamName: string
    siteLocation: string | null
    teamLeaderId: string
    totalMembers: number
    activeMembers: number
    completionRate: number
    totalCheckIns: number
    readiness: { green: number; amber: number; red: number }
  }>
  teamLeaderPerformance: Array<{
    teamLeaderId: string
    teamLeaderName: string
    teamLeaderEmail: string
    teamId: string
    teamName: string
    completionRate: number
    activeMembers: number
    totalCheckIns: number
    readiness: { green: number; amber: number; red: number }
  }>
  dailyTrends: Array<{
    date: string
    completed: number
    green: number
    amber: number
    red: number
  }>
  readinessDistribution: {
    green: number
    amber: number
    red: number
    pending: number
  }
  topTeamsByCases: Array<{
    teamId: string
    teamName: string
    siteLocation: string | null
    caseCount: number
    completionRate: number
    readiness: { green: number; amber: number; red: number }
  }>
  exceptionStats: {
    byType: {
      transfer: number
      accident: number
      injury: number
      medical_leave: number
      other: number
    }
    byTeam: Record<string, {
      transfer: number
      accident: number
      injury: number
      medical_leave: number
      other: number
    }>
    total: number
  }
}

const COLORS = {
  green: '#10b981',
  greenLight: '#d1fae5',
  amber: '#f59e0b',
  amberLight: '#fef3c7',
  red: '#ef4444',
  redLight: '#fee2e2',
  pending: '#6b7280',
  pendingLight: '#f3f4f6',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  pink: '#ec4899',
  gray: '#6b7280',
}

const EXCEPTION_COLORS: Record<string, string> = {
  transfer: '#3b82f6',
  accident: '#ef4444',
  injury: '#f59e0b',
  medical_leave: '#8b5cf6',
  other: '#6b7280',
}

const EXCEPTION_LABELS: Record<string, string> = {
  transfer: 'Transfer',
  accident: 'Accident',
  injury: 'Injury',
  medical_leave: 'Medical Leave',
  other: 'Other',
}

export function SupervisorAnalytics() {
  const navigate = useNavigate()
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
  
  // Date filters - Initialize with "this month" by default
  // Use formatDate to avoid timezone issues (uses local time, not UTC)
  const getThisMonthDates = () => {
    const today = new Date()
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
    return {
      start: formatDate(firstDay),
      end: formatDate(today)
    }
  }

  const initialDates = getThisMonthDates()
  const [startDate, setStartDate] = useState(initialDates.start)
  const [endDate, setEndDate] = useState(initialDates.end)
  const [datePreset, setDatePreset] = useState<'custom' | 'thisWeek' | 'thisMonth' | 'last30Days'>('thisMonth')


  // Date preset handlers
  const setDatePresetHandler = useCallback((preset: 'thisWeek' | 'thisMonth' | 'last30Days' | 'custom') => {
    setDatePreset(preset)
    const today = new Date()
    let start: Date, end: Date

    switch (preset) {
      case 'thisWeek':
        const dayOfWeek = today.getDay()
        start = new Date(today)
        start.setDate(today.getDate() - dayOfWeek)
        end = new Date(today)
        break
      case 'thisMonth':
        start = new Date(today.getFullYear(), today.getMonth(), 1)
        end = new Date(today)
        break
      case 'last30Days':
        start = new Date(today)
        start.setDate(today.getDate() - 30)
        end = new Date(today)
        break
      default:
        return
    }

    // Use formatDate to avoid timezone conversion issues
    setStartDate(formatDate(start))
    setEndDate(formatDate(end))
  }, [])

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const cacheKey = `analytics-${startDate}-${endDate}`
      const cached = cache.get(cacheKey)
      const now = Date.now()

      // Return cached data if still fresh
      // NOTE: Cache is cleared when date filters change, so this should always fetch fresh data
      if (cached && (now - cached.timestamp) < CACHE_TTL) {
        // Validate cached data structure
        if (cached.data && typeof cached.data === 'object' && Array.isArray(cached.data.teamLeaderPerformance)) {
          setAnalyticsData(cached.data)
          setLoading(false)
          return
        } else {
          // Invalid cache, clear it and fetch fresh
          cache.delete(cacheKey)
        }
      }

      const analyticsUrl = buildUrl(API_ROUTES.SUPERVISOR.ANALYTICS, {
        startDate,
        endDate,
      })

      const response = await fetch(`${API_BASE_URL}${analyticsUrl}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('[SupervisorAnalytics] API error:', errorData)
        throw new Error(errorData.error || 'Failed to fetch analytics data')
      }

      const data = await response.json()
      
      // Ensure data structure exists even if empty
      if (!data || typeof data !== 'object') {
        console.error('[SupervisorAnalytics] Invalid data structure received')
        throw new Error('Invalid data structure received from server')
      }
      
      // Cache the response
      cache.set(cacheKey, { data, timestamp: now })
      
      // Clean old cache entries (keep only last 10)
      if (cache.size > 10) {
        const firstKey = cache.keys().next().value
        if (firstKey) {
          cache.delete(firstKey)
        }
      }
      
      setAnalyticsData(data)
    } catch (err: any) {
      console.error('[SupervisorAnalytics] Error fetching analytics:', err)
      setError(err.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  // Prepare chart data
  const overallReadinessData = useMemo(() => {
    if (!analyticsData) return []
    // Backend returns overallReadiness as percentages (0-100)
    const { green, amber, red } = analyticsData.summary.overallReadiness
    
    // Use actual counts from readinessDistribution (now matches date range totals)
    const { green: greenCount, amber: amberCount, red: redCount } = analyticsData.readinessDistribution
    
    return [
      { 
        name: 'Green', 
        value: green, 
        count: greenCount,
        color: COLORS.green 
      },
      { 
        name: 'Amber', 
        value: amber, 
        count: amberCount,
        color: COLORS.amber 
      },
      { 
        name: 'Red', 
        value: red, 
        count: redCount,
        color: COLORS.red 
      },
    ].filter(item => item.value > 0)
  }, [analyticsData])

  const teamPerformanceData = useMemo(() => {
    if (!analyticsData) return []
    return analyticsData.teamLeaderPerformance.slice(0, 10).map(tl => ({
      name: tl.teamName.length > 12 ? tl.teamName.substring(0, 12) + '...' : tl.teamName,
      completionRate: tl.completionRate,
      green: tl.readiness.green,
      amber: tl.readiness.amber,
      red: tl.readiness.red,
    }))
  }, [analyticsData])

  const dailyTrendsData = useMemo(() => {
    if (!analyticsData) return []
    // Limit to last 30 days for better visualization
    return analyticsData.dailyTrends.slice(-30).map(trend => ({
      date: new Date(trend.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      completed: trend.completed,
      green: trend.green,
      amber: trend.amber,
      red: trend.red,
    }))
  }, [analyticsData])

  const exceptionTypeData = useMemo(() => {
    if (!analyticsData) return []
    return Object.entries(analyticsData.exceptionStats.byType)
      .map(([type, count]) => ({
        name: EXCEPTION_LABELS[type] || type,
        value: count,
        type,
        color: EXCEPTION_COLORS[type] || COLORS.gray,
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [analyticsData])

  // Sortable and paginated team leader data
  const sortedAndPaginatedTeamLeaders = useMemo(() => {
    if (!analyticsData) return []
    
    // Ensure teamLeaderPerformance exists and is an array
    const teamLeaderPerformance = analyticsData.teamLeaderPerformance || []
    
    // Create a copy for sorting
    let sorted = [...teamLeaderPerformance]
    
    // Apply sorting if configured
    if (sortConfig) {
      sorted.sort((a, b) => {
        let aValue: any, bValue: any
        
        switch (sortConfig.key) {
          case 'name':
            aValue = a.teamLeaderName.toLowerCase()
            bValue = b.teamLeaderName.toLowerCase()
            break
          case 'team':
            aValue = a.teamName.toLowerCase()
            bValue = b.teamName.toLowerCase()
            break
          case 'completionRate':
            aValue = a.completionRate
            bValue = b.completionRate
            break
          case 'activeMembers':
            aValue = a.activeMembers
            bValue = b.activeMembers
            break
          case 'totalCheckIns':
            aValue = a.totalCheckIns
            bValue = b.totalCheckIns
            break
          default:
            return 0
        }
        
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1
        return 0
      })
    }
    
    // Apply pagination
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return sorted.slice(startIndex, endIndex)
  }, [analyticsData, currentPage, itemsPerPage, sortConfig])

  // Handle sorting
  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        // Toggle direction if same column
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      }
      // New column, default to descending
      return { key, direction: 'desc' }
    })
    setCurrentPage(1) // Reset to first page on sort
  }
  
  // Format date range for display
  const formattedDateRange = useMemo(() => {
    if (!startDate || !endDate) return ''
    const start = new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const end = new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${start} - ${end}`
  }, [startDate, endDate])

  const totalPages = useMemo(() => {
    if (!analyticsData) return 0
    return Math.ceil(analyticsData.teamLeaderPerformance.length / itemsPerPage)
  }, [analyticsData, itemsPerPage])

  const CustomTooltip = memo(({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip">
          <p className="tooltip-label">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color, margin: '4px 0' }}>
              {entry.name}: {entry.value}
            </p>
          ))}
        </div>
      )
    }
    return null
  })

  const ReadinessTooltip = memo(({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="custom-tooltip">
          <p className="tooltip-label" style={{ fontWeight: 'bold', marginBottom: '8px' }}>
            {data.name}
          </p>
          <p style={{ color: data.color, margin: '4px 0' }}>
            {data.value}% ({data.count} {data.count === 1 ? 'worker' : 'workers'})
          </p>
        </div>
      )
    }
    return null
  })

  if (loading) {
    return (
      <DashboardLayout>
        <div className="supervisor-analytics">
          <Loading message="Loading analytics..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="supervisor-analytics">
          <div className="analytics-error">
            <p>Error: {error}</p>
            <button onClick={fetchAnalytics} className="retry-button">
              Retry
            </button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (!analyticsData) {
    return (
      <DashboardLayout>
        <div className="supervisor-analytics">
          <div className="analytics-error">
            <p>No data available</p>
            <p style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
              {loading ? 'Loading...' : 'Please check your date filters or try refreshing the page.'}
            </p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const totalOverallReadinessCount = overallReadinessData.reduce((sum, item) => sum + item.count, 0)

  return (
    <DashboardLayout>
      <div className="supervisor-analytics">
        {/* Header */}
        <header className="analytics-header">
          <div className="header-top">
            <div className="header-left">
              <h1 className="analytics-title">Analytics Dashboard</h1>
              {formattedDateRange && (
                <p className="analytics-date-range">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'inline-block', marginRight: '6px', verticalAlign: 'middle' }}>
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  {formattedDateRange}
                </p>
              )}
            </div>
            <button onClick={fetchAnalytics} className="refresh-button" title="Refresh data">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
          </div>
          <div className="date-filters">
            <div className="date-presets">
              <button
                className={`date-preset-btn ${datePreset === 'thisWeek' ? 'active' : ''}`}
                onClick={() => setDatePresetHandler('thisWeek')}
              >
                This Week
              </button>
              <button
                className={`date-preset-btn ${datePreset === 'thisMonth' ? 'active' : ''}`}
                onClick={() => setDatePresetHandler('thisMonth')}
              >
                This Month
              </button>
              <button
                className={`date-preset-btn ${datePreset === 'last30Days' ? 'active' : ''}`}
                onClick={() => setDatePresetHandler('last30Days')}
              >
                Last 30 Days
              </button>
            </div>
            <div className="date-range-inputs">
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  setDatePreset('custom')
                }}
                className="date-input"
                aria-label="Start date"
              />
              <span className="date-separator">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  setDatePreset('custom')
                }}
                className="date-input"
                aria-label="End date"
              />
            </div>
          </div>
        </header>

        {/* Summary Cards */}
        <div className="summary-cards-grid">
          <div className="summary-card summary-card-primary">
            <div className="summary-card-icon" style={{ backgroundColor: '#fef3c7' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <div className="summary-card-content">
              <p className="summary-card-label">Total Teams</p>
              <p className="summary-card-value">{analyticsData.summary.totalTeams}</p>
              <p className="summary-card-sublabel">{analyticsData.summary.totalActiveMembers} active members</p>
            </div>
          </div>

          <div className="summary-card summary-card-success">
            <div className="summary-card-icon" style={{ backgroundColor: '#d1fae5' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <div className="summary-card-content">
              <p className="summary-card-label">
                Completion Rate
                <span className="tooltip-icon" title="Percentage of expected check-ins completed. Only counts scheduled working days (based on team leader schedules). Formula: (Completed Check-ins ÷ Expected Check-ins on Scheduled Days) × 100">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                    <path d="M6 5V6L6 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <circle cx="6" cy="4.5" r="0.5" fill="currentColor"/>
                  </svg>
                </span>
              </p>
              <p className="summary-card-value">{analyticsData.summary.overallCompletionRate.toFixed(1)}%</p>
              <p className="summary-card-sublabel">Based on scheduled working days only</p>
            </div>
          </div>

          <div className="summary-card summary-card-warning">
            <div className="summary-card-icon" style={{ backgroundColor: '#fef3c7' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
            <div className="summary-card-content">
              <p className="summary-card-label">Active Members</p>
              <p className="summary-card-value">{analyticsData.summary.totalActiveMembers}</p>
              <p className="summary-card-sublabel">Without active exceptions</p>
            </div>
          </div>

          {/* Total Exceptions */}
          <div className="summary-card summary-card-danger">
            <div className="summary-card-icon" style={{ backgroundColor: '#fee2e2' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></path>
              </svg>
            </div>
            <div className="summary-card-content">
              <p className="summary-card-label">Total Exceptions</p>
              <p className="summary-card-value">{analyticsData.summary.totalActiveExceptions}</p>
              <p className="summary-card-sublabel">In selected date range</p>
            </div>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="charts-grid">
          {/* Exception Statistics - Donut Chart */}
          <div className="chart-card">
            <div className="chart-header">
              <h3 className="chart-title">Exception Types</h3>
            </div>
            <div className="chart-content">
              {exceptionTypeData.length === 0 ? (
                <div className="no-data-message">
                  <p>No exceptions in date range</p>
                </div>
              ) : (
                <>
                  <div className="donut-chart-container">
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={exceptionTypeData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {exceptionTypeData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="donut-chart-center">
                      <span className="donut-total">Total {analyticsData.exceptionStats.total}</span>
                    </div>
                  </div>
                  <div className="chart-legend">
                    {exceptionTypeData.map((item, index) => (
                      <div key={index} className="legend-item">
                        <div className="legend-dot" style={{ backgroundColor: item.color }}></div>
                        <span className="legend-label">{item.name}</span>
                        <span className="legend-value">({item.value})</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Overall Readiness Donut Chart */}
          <div className="chart-card">
            <div className="chart-header">
              <h3 className="chart-title">
                Overall Readiness
                <span className="tooltip-icon" title="Average readiness percentage across all workers in the selected date range. Shows the percentage breakdown of workers by readiness status (Green = Fit to work, Amber = Minor issue, Red = Not fit to work)">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                    <path d="M6 5V6L6 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <circle cx="6" cy="4.5" r="0.5" fill="currentColor"/>
                  </svg>
                </span>
              </h3>
            </div>
            <div className="chart-content">
              <div className="donut-chart-container">
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={overallReadinessData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {overallReadinessData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ReadinessTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-chart-center">
                  {overallReadinessData.length > 0 ? (
                    <>
                      <span className="donut-total">
                        {totalOverallReadinessCount}
                      </span>
                      <span className="donut-subtotal">
                        {totalOverallReadinessCount === 1 ? 'worker' : 'workers'}
                      </span>
                    </>
                  ) : (
                    <span className="donut-total">No data</span>
                  )}
                </div>
              </div>
              <div className="chart-legend">
                {overallReadinessData.map((item, index) => (
                  <div key={index} className="legend-item">
                    <div className="legend-dot" style={{ backgroundColor: item.color }}></div>
                    <span className="legend-label">{item.name}</span>
                    <span className="legend-value">{item.value}% ({item.count || 0})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Team Performance Chart */}
          <div className="chart-card chart-card-wide">
            <div className="chart-header">
              <h3 className="chart-title">Team Leader Performance</h3>
            </div>
            <div className="chart-content">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={teamPerformanceData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis 
                    dataKey="name" 
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
                    label={{ value: 'Completion %', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#64748B' } }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="completionRate" fill="#3B82F6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Daily Trends Line Chart */}
          <div className="chart-card chart-card-wide">
            <div className="chart-header">
              <h3 className="chart-title">Daily Trends</h3>
            </div>
            <div className="chart-content">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={dailyTrendsData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#60A5FA" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="fillGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#34D399" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="fillAmber" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#FBBF24" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="fillRed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EF4444" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#F87171" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#94A3B8"
                    style={{ fontSize: '12px' }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    stroke="#94A3B8"
                    style={{ fontSize: '12px' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="completed"
                    fill="url(#fillCompleted)"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    name="Completed"
                  />
                  <Area
                    type="monotone"
                    dataKey="green"
                    fill="url(#fillGreen)"
                    stroke="#10B981"
                    strokeWidth={2}
                    name="Green"
                  />
                  <Area
                    type="monotone"
                    dataKey="amber"
                    fill="url(#fillAmber)"
                    stroke="#F59E0B"
                    strokeWidth={2}
                    name="Amber"
                  />
                  <Area
                    type="monotone"
                    dataKey="red"
                    fill="url(#fillRed)"
                    stroke="#EF4444"
                    strokeWidth={2}
                    name="Red"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Team Leader Performance Table */}
        <div className="table-card">
          <div className="table-header">
            <div>
              <h3 className="table-title">Team Leader Performance</h3>
            </div>
            <div className="table-summary">
              {sortedAndPaginatedTeamLeaders.length} of {analyticsData.teamLeaderPerformance.length} team leaders
            </div>
          </div>
          <div className="table-container">
            <table className="performance-table">
              <thead>
                <tr>
                  <th 
                    className="sortable-header" 
                    onClick={() => handleSort('name')}
                  >
                    Team Leader
                    {sortConfig?.key === 'name' && (
                      <span className="sort-indicator">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </th>
                  <th 
                    className="sortable-header" 
                    onClick={() => handleSort('team')}
                  >
                    Team
                    {sortConfig?.key === 'team' && (
                      <span className="sort-indicator">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </th>
                  <th 
                    className="sortable-header" 
                    onClick={() => handleSort('activeMembers')}
                  >
                    Active Members
                    {sortConfig?.key === 'activeMembers' && (
                      <span className="sort-indicator">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </th>
                  <th 
                    className="sortable-header" 
                    onClick={() => handleSort('completionRate')}
                  >
                    Completion Rate
                    {sortConfig?.key === 'completionRate' && (
                      <span className="sort-indicator">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </th>
                  <th>Fit to work</th>
                  <th>Minor issue</th>
                  <th>Not fit to work</th>
                  <th 
                    className="sortable-header" 
                    onClick={() => handleSort('totalCheckIns')}
                  >
                    Total Check-ins
                    {sortConfig?.key === 'totalCheckIns' && (
                      <span className="sort-indicator">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedAndPaginatedTeamLeaders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="table-empty">
                      No data available
                    </td>
                  </tr>
                ) : (
                  sortedAndPaginatedTeamLeaders.map((tl) => (
                    <tr key={tl.teamLeaderId}>
                      <td>
                        <div className="team-leader-cell">
                          <div className="leader-avatar">
                            {tl.teamLeaderName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="leader-name">{tl.teamLeaderName}</div>
                            <div className="leader-email">{tl.teamLeaderEmail}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="team-name-cell">
                          <button 
                            className="team-name-link"
                            onClick={() => navigate(`${PROTECTED_ROUTES.SUPERVISOR.TEAMS}?team=${tl.teamId}`)}
                            title={`View ${tl.teamName} details`}
                          >
                            {tl.teamName}
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className="metric-value">{tl.activeMembers}</span>
                      </td>
                      <td>
                        <div className="completion-cell">
                          <span className={`completion-badge ${tl.completionRate >= 90 ? 'high' : tl.completionRate >= 70 ? 'medium' : 'low'}`}>
                            {tl.completionRate.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="readiness-badge green">{tl.readiness.green}</span>
                      </td>
                      <td>
                        <span className="readiness-badge amber">{tl.readiness.amber}</span>
                      </td>
                      <td>
                        <span className="readiness-badge red">{tl.readiness.red}</span>
                      </td>
                      <td>
                        <span className="metric-value">{tl.totalCheckIns}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="table-pagination">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="pagination-btn"
              >
                Previous
              </button>
              <span className="pagination-info">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="pagination-btn"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Top Teams by Cases */}
        {analyticsData.topTeamsByCases && analyticsData.topTeamsByCases.length > 0 && (
          <div className="priority-teams-card">
            <div className="priority-header">
                <h3 className="priority-title">
                  Top Teams by Cases
                  <span className="tooltip-icon" title="Teams with the most cases (worker exceptions) submitted by site supervisor in the selected date range">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                      <path d="M6 5V6L6 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <circle cx="6" cy="4.5" r="0.5" fill="currentColor"/>
                    </svg>
                  </span>
                </h3>
            </div>
            <div className="priority-teams-grid">
              {analyticsData.topTeamsByCases.map((team) => (
                <div key={team.teamId} className="priority-team-card">
                  <div className="priority-team-header">
                    <h4 className="priority-team-name">{team.teamName}</h4>
                    <span className="priority-badge cases">
                      {team.caseCount} {team.caseCount === 1 ? 'case' : 'cases'}
                    </span>
                  </div>
                  <div className="priority-team-metrics">
                    <div className="priority-metric">
                      <span className="priority-label">Completion Rate:</span>
                      <span className="priority-value">{team.completionRate.toFixed(1)}%</span>
                    </div>
                    <div className="priority-metric">
                      <span className="priority-label">Fit to work:</span>
                      <span className="priority-value green">{team.readiness.green}</span>
                    </div>
                    <div className="priority-metric">
                      <span className="priority-label">Minor issue:</span>
                      <span className="priority-value amber">{team.readiness.amber}</span>
                    </div>
                    <div className="priority-metric">
                      <span className="priority-label">Not fit to work:</span>
                      <span className="priority-value red">{team.readiness.red}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

