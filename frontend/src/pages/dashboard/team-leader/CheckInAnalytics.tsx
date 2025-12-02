import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import {
  LineChart,
  Line,
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
import './CheckInAnalytics.css'

interface AnalyticsData {
  summary: {
    totalCheckIns: number
    completionRate: number
    avgReadiness: { green: number; amber: number; red: number }
    onTimeRate: number
    totalActiveWorkers: number
    currentActiveExceptions: number
    trend: { completion: string; readiness: string }
  }
  dailyTrends: Array<{
    date: string
    completed: number
    pending: number
    green: number
    amber: number
    red: number
  }>
  workerStats: Array<{
    workerId: string
    name: string
    email: string
    totalCheckIns: number
    completionRate: number
    greenCount: number
    amberCount: number
    redCount: number
    avgReadiness: string
  }>
  weeklyPattern: Record<string, {
    avgReadiness: string
    completion: number
    green: number
    amber: number
    red: number
  }>
}

const COLORS = {
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  pending: '#6b7280',
}

export function CheckInAnalytics() {
  const { user } = useAuth()
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  
  // Date filters
  const [filterType, setFilterType] = useState<'thisMonth' | 'lastMonth' | 'thisYear' | 'custom'>('thisMonth')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth())
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

  // Initialize dates
  useEffect(() => {
    const today = new Date()
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    
    setStartDate(firstDayOfMonth.toISOString().split('T')[0])
    setEndDate(lastDayOfMonth.toISOString().split('T')[0])
    setSelectedMonth(today.getMonth())
    setSelectedYear(today.getFullYear())
  }, [])

  // Update dates when filter type changes - memoized
  useEffect(() => {
    const today = new Date()
    let start: Date, end: Date

    switch (filterType) {
      case 'thisMonth':
        start = new Date(today.getFullYear(), today.getMonth(), 1)
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
        break
      case 'lastMonth':
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
        end = new Date(today.getFullYear(), today.getMonth(), 0)
        break
      case 'thisYear':
        start = new Date(today.getFullYear(), 0, 1)
        end = new Date(today.getFullYear(), 11, 31)
        break
      case 'custom':
        // Don't change dates for custom - handled by next effect
        return
      default:
        start = new Date(today.getFullYear(), today.getMonth(), 1)
        end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    }

    const startStr = start.toISOString().split('T')[0]
    const endStr = end.toISOString().split('T')[0]
    
    // Only update if different to avoid unnecessary re-renders
    if (startDate !== startStr) setStartDate(startStr)
    if (endDate !== endStr) setEndDate(endStr)
  }, [filterType]) // Removed startDate/endDate from deps to prevent loops

  // Update dates when month/year changes
  useEffect(() => {
    if (filterType === 'custom') {
      const start = new Date(selectedYear, selectedMonth, 1)
      const end = new Date(selectedYear, selectedMonth + 1, 0)
      const startStr = start.toISOString().split('T')[0]
      const endStr = end.toISOString().split('T')[0]
      
      // Only update if different
      if (startDate !== startStr) setStartDate(startStr)
      if (endDate !== endStr) setEndDate(endStr)
    }
  }, [selectedMonth, selectedYear, filterType]) // Removed startDate/endDate from deps

  // Memoize loadAnalytics to prevent recreation on every render
  const loadAnalytics = useCallback(async () => {
    if (!startDate || !endDate) return

    try {
      setLoading(true)
      setError('')
      
      const params = new URLSearchParams({
        startDate,
        endDate,
      })

      // Store controller reference for cleanup
      let controller: AbortController | null = new AbortController()
      const timeoutId = setTimeout(() => {
        if (controller) controller.abort()
      }, 30000) // 30s timeout

      const result = await apiClient.get<AnalyticsData>(
        `${API_ROUTES.TEAMS.CHECKINS_ANALYTICS}?${params.toString()}&_t=${Date.now()}`,
        {
          headers: {
            'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      controller = null // Clear reference after fetch completes

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to load analytics data')
      }

      setAnalyticsData(result.data)
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Analytics request cancelled')
        return
      }
      setError(err.message || 'Failed to load analytics data')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  // Debounced effect for loading analytics - with cleanup
  useEffect(() => {
    if (!user || !startDate || !endDate) return

    let isMounted = true

    // Small delay to debounce rapid date changes
    const timeoutId = setTimeout(() => {
      if (isMounted) {
        loadAnalytics()
      }
    }, 300)

    return () => {
      isMounted = false
      clearTimeout(timeoutId)
    }
  }, [user, startDate, endDate, loadAnalytics])

  // Memoize formatDate to prevent recreation
  const formatDate = useCallback((dateStr: string): string => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }, [])

  // Memoize readiness data to prevent recalculation
  const readinessData = useMemo(() => {
    if (!analyticsData) return []
    return [
      { name: 'Green', value: analyticsData.summary.avgReadiness.green, color: COLORS.green },
      { name: 'Amber', value: analyticsData.summary.avgReadiness.amber, color: COLORS.amber },
      { name: 'Red', value: analyticsData.summary.avgReadiness.red, color: COLORS.red },
    ]
  }, [analyticsData?.summary.avgReadiness])

  // Memoize weekly data transformation
  const weeklyData = useMemo(() => {
    if (!analyticsData) return []
    return Object.entries(analyticsData.weeklyPattern).map(([day, data]) => ({
      day: day.substring(0, 3),
      completion: data.completion,
      green: data.green,
      amber: data.amber,
      red: data.red,
    }))
  }, [analyticsData?.weeklyPattern])

  // Memoize daily trends (limit to last 30 for performance)
  // Only recalculate if the array reference or length changes
  const dailyTrendsData = useMemo(() => {
    if (!analyticsData?.dailyTrends || analyticsData.dailyTrends.length === 0) return []
    // Limit to last 30 days max for performance
    const limited = analyticsData.dailyTrends.slice(-30)
    // Format dates once
    return limited.map(item => ({
      ...item,
      formattedDate: formatDate(item.date),
    }))
  }, [analyticsData?.dailyTrends, formatDate])

  // Memoize sorted worker stats
  const sortedWorkerStats = useMemo(() => {
    if (!analyticsData) return []
    return [...analyticsData.workerStats].sort((a, b) => b.completionRate - a.completionRate)
  }, [analyticsData?.workerStats])

  const monthNames = useMemo(() => [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ], [])

  const years = useMemo(() => 
    Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i),
    []
  )

  // Memoize tooltip formatters (must be at top level, not in JSX)
  const tooltipLabelFormatter = useCallback((value: string) => {
    const date = new Date(value)
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
  }, [])

  const lineChartFormatter = useCallback((value: any, name: string) => {
    const displayName = name === 'completed' ? 'Completed' : 'Pending'
    return [value, displayName]
  }, [])

  const barChartFormatter = useCallback((value: any, name: string) => {
    return [`${value} check-ins`, `${name.charAt(0).toUpperCase() + name.slice(1)}`]
  }, [])

  const legendFormatter = useCallback((value: string) => {
    return value
  }, [])

  if (loading) {
    return (
      <DashboardLayout>
        <Loading message="Loading analytics..." size="medium" />
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="analytics-error">
          <p>Error: {error}</p>
          <button onClick={loadAnalytics}>Retry</button>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="checkin-analytics-page">
        {/* Header */}
        <header className="analytics-header">
          <div className="analytics-header-left">
            <h1 className="analytics-title">Check-In Analytics</h1>
            <p className="analytics-subtitle">Team performance insights and trends</p>
          </div>
          <div className="analytics-header-right">
            <button className="export-btn" onClick={() => alert('Export feature coming soon!')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Export
            </button>
          </div>
        </header>

        {/* Filters */}
        <div className="analytics-filters">
          <div className="filter-group">
            <label>Quick Filters:</label>
            <div className="filter-buttons">
              <button
                className={filterType === 'thisMonth' ? 'active' : ''}
                onClick={() => setFilterType('thisMonth')}
              >
                This Month
              </button>
              <button
                className={filterType === 'lastMonth' ? 'active' : ''}
                onClick={() => setFilterType('lastMonth')}
              >
                Last Month
              </button>
              <button
                className={filterType === 'thisYear' ? 'active' : ''}
                onClick={() => setFilterType('thisYear')}
              >
                This Year
              </button>
              <button
                className={filterType === 'custom' ? 'active' : ''}
                onClick={() => setFilterType('custom')}
              >
                Custom
              </button>
            </div>
          </div>

          {filterType === 'custom' && (
            <>
              <div className="filter-group">
                <label>Month:</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="filter-select"
                >
                  {monthNames.map((month, index) => (
                    <option key={index} value={index}>
                      {month}
                    </option>
                  ))}
                </select>
              </div>
              <div className="filter-group">
                <label>Year:</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="filter-select"
                >
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="filter-dates">
            <span className="date-label">Date Range:</span>
            <span className="date-value">{new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span>to</span>
            <span className="date-value">{new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>

        {/* Summary Cards */}
        {analyticsData && analyticsData.workerStats.length === 0 ? (
          <div className="analytics-empty-state">
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3v18h18" strokeLinecap="round"/>
                <path d="M7 16l4-4 4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3>No Data Available</h3>
            <p>No check-in data found for the selected date range.</p>
            <p className="empty-state-hint">Try selecting a different time period or check if your team members have completed check-ins.</p>
          </div>
        ) : analyticsData && (
          <>
            <div className="analytics-summary-cards">
              <div className="summary-card">
                <div className="summary-label">
                  Total Check-Ins
                  <span className="tooltip-icon" title="Total number of check-ins completed by all workers in the selected period">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                      <path d="M6 5V6L6 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <circle cx="6" cy="4.5" r="0.5" fill="currentColor"/>
                    </svg>
                  </span>
                </div>
                <div className="summary-value">{analyticsData.summary.totalCheckIns.toLocaleString()}</div>
                <div className="summary-description">All completed check-ins</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">
                  Total Completed
                  <span className="tooltip-icon" title="Total number of check-ins completed by workers in the selected period">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                      <path d="M6 5V6L6 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <circle cx="6" cy="4.5" r="0.5" fill="currentColor"/>
                    </svg>
                  </span>
                </div>
                <div className="summary-value">{analyticsData.summary.totalCheckIns.toLocaleString()}</div>
                <div className="summary-description">Total completed by workers</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">
                  Total Active Workers
                  <span className="tooltip-icon" title="Total number of active workers with assigned schedules in the selected date range (excluding workers with exceptions)">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                      <path d="M6 5V6L6 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <circle cx="6" cy="4.5" r="0.5" fill="currentColor"/>
                    </svg>
                  </span>
                </div>
                <div className="summary-value">{analyticsData.summary.totalActiveWorkers || 0}</div>
                <div className="summary-description">Active workers</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">
                  Current Active Exceptions
                  <span className="tooltip-icon" title="Number of workers with active exceptions today (exceptions that are currently active)">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                      <path d="M6 5V6L6 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <circle cx="6" cy="4.5" r="0.5" fill="currentColor"/>
                    </svg>
                  </span>
                </div>
                <div className="summary-value">{analyticsData.summary.currentActiveExceptions || 0}</div>
                <div className="summary-description">Active exceptions today</div>
              </div>
            </div>

            {/* Charts Grid */}
            <div className="analytics-charts-grid">
              {/* Daily Trends Line Chart */}
              <div className="chart-card chart-card-elevated">
                <div className="chart-header">
                  <div>
                    <h3 className="chart-title">Daily Completion Trend</h3>
                    <span className="chart-subtitle">Shows completed vs pending check-ins each day (max 30 days shown)</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={320} debounce={100}>
                  <LineChart data={dailyTrendsData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }} throttleDelay={16}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDate}
                      interval="preserveStartEnd"
                      minTickGap={40}
                      stroke="#94A3B8"
                      style={{ fontSize: '11px', fontWeight: '500' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      stroke="#94A3B8" 
                      style={{ fontSize: '11px', fontWeight: '500' }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <Tooltip
                      labelFormatter={tooltipLabelFormatter}
                      contentStyle={{ 
                        backgroundColor: '#FFFFFF', 
                        border: '1px solid #E2E8F0', 
                        borderRadius: '8px',
                        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.08)',
                        padding: '12px 16px'
                      }}
                      labelStyle={{ 
                        color: '#0F172A',
                        fontWeight: '600',
                        marginBottom: '8px',
                        fontSize: '13px'
                      }}
                      itemStyle={{ 
                        padding: '4px 0',
                        fontSize: '13px',
                        color: '#64748B'
                      }}
                      formatter={lineChartFormatter}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '20px' }}
                      iconType="line"
                      formatter={(value: string) => {
                        return value === 'completed' ? 'Completed' : 'Pending'
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="completed"
                      stroke={COLORS.green}
                      strokeWidth={3}
                      name="completed"
                      dot={false}
                      activeDot={{ r: 6, fill: COLORS.green, strokeWidth: 2, stroke: 'white' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="pending"
                      stroke={COLORS.pending}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name="pending"
                      dot={false}
                      activeDot={{ r: 6, fill: COLORS.pending, strokeWidth: 2, stroke: 'white' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Readiness Distribution Pie Chart */}
              <div className="chart-card chart-card-elevated">
                <div className="chart-header">
                  <div>
                    <h3 className="chart-title">Readiness Distribution</h3>
                    <span className="chart-subtitle">Percentage breakdown: Green = Fit to work, Amber = Minor issue, Red = Not fit to work</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={320} debounce={100}>
                  <PieChart>
                    <defs>
                      {readinessData.map((_, index) => (
                        <filter key={`shadow-${index}`} id={`shadow-${index}`} x="-50%" y="-50%" width="200%" height="200%">
                          <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.1"/>
                        </filter>
                      ))}
                    </defs>
                    <Pie
                      data={readinessData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(props: any) => {
                        const { name, percent } = props
                        if (percent < 0.05) return '' // Hide small labels
                        return `${name}\n${(percent * 100).toFixed(0)}%`
                      }}
                      outerRadius={100}
                      innerRadius={60}
                      fill="#8884d8"
                      dataKey="value"
                      stroke="white"
                      strokeWidth={3}
                      isAnimationActive={false}
                    >
                      {readinessData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.color}
                          filter={`url(#shadow-${index})`}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ 
                        backgroundColor: '#FFFFFF', 
                        border: '1px solid #E2E8F0', 
                        borderRadius: '8px',
                        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.08)',
                        padding: '12px 16px'
                      }}
                      formatter={(value: any, name: string) => {
                        const label = name.charAt(0).toUpperCase() + name.slice(1)
                        return [`${value}%`, label]
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pie-legend">
                  {readinessData.map((item, index) => (
                    <div key={index} className="pie-legend-item">
                      <span className="pie-legend-color" style={{ backgroundColor: item.color }}></span>
                      <span className="pie-legend-label">{item.name}</span>
                      <span className="pie-legend-value">{item.value}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Weekly Pattern Bar Chart */}
              <div className="chart-card chart-card-wide chart-card-elevated">
                <div className="chart-header">
                  <div>
                    <h3 className="chart-title">Day of Week Pattern</h3>
                    <span className="chart-subtitle">Check-in completion patterns grouped by day of the week (Sunday to Saturday)</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={320} debounce={100}>
                  <BarChart data={weeklyData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }} throttleDelay={16}>
                    <defs>
                      <linearGradient id="greenBarGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.green} stopOpacity={1}/>
                        <stop offset="100%" stopColor={COLORS.green} stopOpacity={0.8}/>
                      </linearGradient>
                      <linearGradient id="amberBarGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.amber} stopOpacity={1}/>
                        <stop offset="100%" stopColor={COLORS.amber} stopOpacity={0.8}/>
                      </linearGradient>
                      <linearGradient id="redBarGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.red} stopOpacity={1}/>
                        <stop offset="100%" stopColor={COLORS.red} stopOpacity={0.8}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis 
                      dataKey="day" 
                      stroke="#94A3B8" 
                      style={{ fontSize: '12px', fontWeight: '500' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      stroke="#94A3B8" 
                      style={{ fontSize: '11px', fontWeight: '500' }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#FFFFFF', 
                        border: '1px solid #E2E8F0', 
                        borderRadius: '8px',
                        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.08)',
                        padding: '12px 16px'
                      }}
                      labelStyle={{ 
                        color: '#0F172A',
                        fontWeight: '600',
                        marginBottom: '8px',
                        fontSize: '13px'
                      }}
                      itemStyle={{ 
                        padding: '4px 0',
                        fontSize: '13px',
                        color: '#64748B'
                      }}
                      formatter={barChartFormatter}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '20px' }}
                      formatter={legendFormatter}
                    />
                    <Bar 
                      dataKey="green" 
                      stackId="a" 
                      fill="url(#greenBarGradient)" 
                      name="Green"
                      radius={[0, 0, 8, 8]}
                      isAnimationActive={false}
                    />
                    <Bar 
                      dataKey="amber" 
                      stackId="a" 
                      fill="url(#amberBarGradient)" 
                      name="Amber"
                      radius={[0, 0, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Bar 
                      dataKey="red" 
                      stackId="a" 
                      fill="url(#redBarGradient)" 
                      name="Red"
                      radius={[8, 8, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

            </div>

            {/* Worker Performance Table */}
            <div className="analytics-table-card">
              <div className="chart-header">
                <div>
                  <h3 className="chart-title">Worker Performance</h3>
                  <span className="chart-subtitle">Individual worker statistics ranked by completion rate. Completion = (Check-ins ÷ Days in period) × 100</span>
                </div>
              </div>
                <div className="worker-performance-table">
                <div className="table-header">
                  <div className="table-col-name">Worker</div>
                  <div className="table-col-stat">Check-Ins</div>
                  <div className="table-col-stat">Completion</div>
                  <div className="table-col-stat">Green</div>
                  <div className="table-col-stat">Amber</div>
                  <div className="table-col-stat">Red</div>
                  <div className="table-col-status">Avg Status</div>
                </div>
                <div className="table-body">
                  {sortedWorkerStats.map((worker) => (
                      <div key={worker.workerId} className="table-row">
                        <div className="table-col-name">{worker.name}</div>
                        <div className="table-col-stat">{worker.totalCheckIns}</div>
                        <div className="table-col-stat">{worker.completionRate}%</div>
                        <div className="table-col-stat">{worker.greenCount}</div>
                        <div className="table-col-stat">{worker.amberCount}</div>
                        <div className="table-col-stat">{worker.redCount}</div>
                        <div className="table-col-status">
                          <span className={`readiness-badge ${worker.avgReadiness.toLowerCase()}`}>
                            {worker.avgReadiness === 'Green' ? 'Fit to work' :
                             worker.avgReadiness === 'Amber' ? 'Minor issue' :
                             'Not fit to work'}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}

