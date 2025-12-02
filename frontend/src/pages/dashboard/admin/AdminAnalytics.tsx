import { useState, useEffect, useMemo, useCallback } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { getTodayDateString } from '../../../shared/date'
import './AdminAnalytics.css'

interface AnalyticsData {
  checkIns: {
    dailyTrend: Array<{
      date: string
      count: number
      day: string
    }>
  }
  cases: {
    byStatus: {
      pending: number
      in_progress: number
      completed: number
      cancelled: number
    }
  }
  users: {
    growthTrend: Array<{
      month: string
      count: number
    }>
  }
  aiUsage?: {
    transcriptions: {
      count: number
      totalCost: number
      averageCost: number
      dailyTrend: Array<{
        date: string
        count: number
        cost: number
        day: string
      }>
    }
    incidentAnalysis: {
      count: number
      estimatedCost: number
      dailyTrend: Array<{
        date: string
        count: number
        day: string
      }>
    }
    totalCost: number
    totalRequests: number
    users?: Array<{
      userId: string
      name: string
      email: string
      role: string
      transcriptions: { count: number; cost: number }
      incidents: { count: number; cost: number }
      totalCost: number
      totalRequests: number
    }>
  }
}

export function AdminAnalytics() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState<AnalyticsData | null>(null)
  
  // Date range state
  const [datePreset, setDatePreset] = useState<'last7days' | 'last30days' | 'custom'>('last7days')
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return getTodayDateString()
  })

  // Update dates based on preset
  useEffect(() => {
    const today = new Date()
    const date = new Date()
    
    switch (datePreset) {
      case 'last7days':
        date.setDate(today.getDate() - 7)
        setStartDate(date.toISOString().split('T')[0])
        setEndDate(today.toISOString().split('T')[0])
        break
      case 'last30days':
        date.setDate(today.getDate() - 30)
        setStartDate(date.toISOString().split('T')[0])
        setEndDate(today.toISOString().split('T')[0])
        break
      case 'custom':
        // Don't change dates for custom
        break
    }
  }, [datePreset])

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const params = new URLSearchParams({
        startDate,
        endDate,
      })

      const result = await apiClient.get<any>(
        `${API_ROUTES.ADMIN.STATS}?${params.toString()}`
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch analytics data')
      }

      const stats = result.data
      setData({
        checkIns: {
          dailyTrend: stats.checkIns?.dailyTrend || [],
        },
        cases: {
          byStatus: stats.cases?.byStatus || {
            pending: 0,
            in_progress: 0,
            completed: 0,
            cancelled: 0,
          },
        },
      users: {
        growthTrend: stats.users?.growthTrend || [],
      },
      aiUsage: stats.aiUsage || {
        transcriptions: {
          count: 0,
          totalCost: 0,
          averageCost: 0,
          dailyTrend: [],
        },
        incidentAnalysis: {
          count: 0,
          estimatedCost: 0,
          dailyTrend: [],
        },
        totalCost: 0,
        totalRequests: 0,
        users: [],
      },
    })
    } catch (err: any) {
      console.error('Error fetching analytics:', err)
      setError(err.message || 'Failed to load analytics data')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  // Memoized chart data
  const dailyCheckInsData = useMemo(() => {
    if (!data?.checkIns?.dailyTrend) return []
    return data.checkIns.dailyTrend.map(item => ({
      date: item.day,
      fullDate: item.date,
      count: item.count,
    }))
  }, [data])

  // Calculate daily check-ins statistics
  const checkInsStats = useMemo(() => {
    if (!dailyCheckInsData || dailyCheckInsData.length === 0) {
      return {
        total: 0,
        average: 0,
        highest: 0,
        highestDay: '',
        trend: 0,
      }
    }

    const total = dailyCheckInsData.reduce((sum, item) => sum + item.count, 0)
    const average = Math.round(total / dailyCheckInsData.length)
    const highest = Math.max(...dailyCheckInsData.map(item => item.count))
    const highestDayData = dailyCheckInsData.find(item => item.count === highest)
    const highestDay = highestDayData?.date || ''

    // Calculate trend (comparing first half vs second half)
    const firstHalf = dailyCheckInsData.slice(0, Math.ceil(dailyCheckInsData.length / 2))
    const secondHalf = dailyCheckInsData.slice(Math.ceil(dailyCheckInsData.length / 2))
    const firstHalfAvg = firstHalf.length > 0 
      ? firstHalf.reduce((sum, item) => sum + item.count, 0) / firstHalf.length 
      : 0
    const secondHalfAvg = secondHalf.length > 0 
      ? secondHalf.reduce((sum, item) => sum + item.count, 0) / secondHalf.length 
      : 0
    const trend = firstHalfAvg > 0 
      ? Math.round(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100) 
      : secondHalfAvg > 0 ? 100 : 0

    return {
      total,
      average,
      highest,
      highestDay,
      trend,
    }
  }, [dailyCheckInsData])

  const caseStatusData = useMemo(() => {
    if (!data?.cases?.byStatus) return []
    return Object.entries(data.cases.byStatus)
      .filter(([_, count]) => count > 0)
      .map(([status, count]) => ({
        name: status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        value: count,
      }))
  }, [data])

  const userGrowthData = useMemo(() => {
    if (!data?.users?.growthTrend) return []
    return data.users.growthTrend.map(item => ({
      month: item.month,
      users: item.count,
    }))
  }, [data])

  // Calculate user growth statistics
  const userGrowthStats = useMemo(() => {
    if (!userGrowthData || userGrowthData.length === 0) {
      return {
        total: 0,
        average: 0,
        highest: 0,
        highestMonth: '',
        growthRate: 0,
      }
    }

    const total = userGrowthData.reduce((sum, item) => sum + item.users, 0)
    const average = Math.round(total / userGrowthData.length)
    const highest = Math.max(...userGrowthData.map(item => item.users))
    const highestMonthData = userGrowthData.find(item => item.users === highest)
    const highestMonth = highestMonthData?.month || ''

    // Calculate growth rate (comparing first half vs second half
    const firstHalf = userGrowthData.slice(0, 3).reduce((sum, item) => sum + item.users, 0)
    const secondHalf = userGrowthData.slice(3).reduce((sum, item) => sum + item.users, 0)
    const growthRate = firstHalf > 0 
      ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) 
      : secondHalf > 0 ? 100 : 0

    return {
      total,
      average,
      highest,
      highestMonth,
      growthRate,
    }
  }, [userGrowthData])


  if (loading) {
    return (
      <DashboardLayout>
        <div className="admin-analytics">
          <Loading message="Loading analytics..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="admin-analytics">
          <div className="error-message">
            <p>Error: {error}</p>
            <button onClick={fetchAnalytics} className="retry-button">
              Retry
            </button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="admin-analytics">
        {/* Header */}
        <header className="analytics-header">
          <div>
            <h1 className="analytics-title">Analytics & Trends</h1>
            <p className="analytics-subtitle">System-wide analytics and performance insights</p>
          </div>
          <button onClick={fetchAnalytics} className="refresh-button" title="Refresh data">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </header>

        {/* Date Filter */}
        <div className="date-filter-section">
          <div className="date-presets">
            <button
              className={`date-preset-btn ${datePreset === 'last7days' ? 'active' : ''}`}
              onClick={() => setDatePreset('last7days')}
            >
              Last 7 Days
            </button>
            <button
              className={`date-preset-btn ${datePreset === 'last30days' ? 'active' : ''}`}
              onClick={() => setDatePreset('last30days')}
            >
              Last 30 Days
            </button>
            <button
              className={`date-preset-btn ${datePreset === 'custom' ? 'active' : ''}`}
              onClick={() => setDatePreset('custom')}
            >
              Custom Range
            </button>
          </div>
          {datePreset === 'custom' && (
            <div className="date-range-inputs">
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  if (e.target.value > endDate) {
                    setEndDate(e.target.value)
                  }
                }}
                max={endDate}
                className="date-input"
              />
              <span className="date-separator">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  if (e.target.value < startDate) {
                    setStartDate(e.target.value)
                  }
                }}
                max={getTodayDateString()}
                min={startDate}
                className="date-input"
              />
            </div>
          )}
        </div>

        {/* Charts Grid */}
        <div className="analytics-grid">
          {/* Daily Check-ins Trend */}
          {dailyCheckInsData.length > 0 && (
            <div className="chart-card full-width">
              <h3 className="chart-title">
                Daily Check-ins Trend 
                {datePreset === 'last7days' && ' (Last 7 Days)'}
                {datePreset === 'last30days' && ' (Last 30 Days)'}
                {datePreset === 'custom' && ` (${startDate} to ${endDate})`}
              </h3>
              
              {/* Summary Cards */}
              <div className="checkins-summary-cards">
                <div className="checkins-summary-card">
                  <div className="checkins-summary-icon" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                    </svg>
                  </div>
                  <div className="checkins-summary-content">
                    <p className="checkins-summary-label">Total Check-ins</p>
                    <p className="checkins-summary-value">{checkInsStats.total}</p>
                    <p className="checkins-summary-detail">In selected period</p>
                  </div>
                </div>

                <div className="checkins-summary-card">
                  <div className="checkins-summary-icon" style={{ background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="1" x2="12" y2="23"></line>
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                  </div>
                  <div className="checkins-summary-content">
                    <p className="checkins-summary-label">Average per Day</p>
                    <p className="checkins-summary-value">{checkInsStats.average}</p>
                    <p className="checkins-summary-detail">Daily average</p>
                  </div>
                </div>

                <div className="checkins-summary-card">
                  <div className="checkins-summary-icon" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                      <polyline points="17 6 23 6 23 12"></polyline>
                    </svg>
                  </div>
                  <div className="checkins-summary-content">
                    <p className="checkins-summary-label">Trend</p>
                    <p className="checkins-summary-value" style={{ color: checkInsStats.trend >= 0 ? '#10b981' : '#ef4444' }}>
                      {checkInsStats.trend >= 0 ? '+' : ''}{checkInsStats.trend}%
                    </p>
                    <p className="checkins-summary-detail">vs first half</p>
                  </div>
                </div>

                <div className="checkins-summary-card">
                  <div className="checkins-summary-icon" style={{ background: 'linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                      <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                  </div>
                  <div className="checkins-summary-content">
                    <p className="checkins-summary-label">Peak Day</p>
                    <p className="checkins-summary-value">{checkInsStats.highest}</p>
                    <p className="checkins-summary-detail">{checkInsStats.highestDay || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="checkins-chart-container">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={dailyCheckInsData}>
                    <defs>
                      <linearGradient id="checkInsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="date" 
                      stroke="#64748b"
                      tick={{ fontSize: 12 }}
                      angle={dailyCheckInsData.length > 7 ? -45 : 0}
                      textAnchor={dailyCheckInsData.length > 7 ? 'end' : 'middle'}
                      height={dailyCheckInsData.length > 7 ? 80 : 30}
                    />
                    <YAxis 
                      stroke="#64748b"
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'white', 
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                      }}
                      formatter={(value: number) => [`${value} check-ins`, 'Check-ins']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="count" 
                      stroke="#3b82f6" 
                      strokeWidth={3}
                      fill="url(#checkInsGradient)"
                      name="Check-ins"
                      dot={{ fill: '#3b82f6', r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Case Status Distribution */}
          {caseStatusData.length > 0 && (
            <div className="chart-card">
              <h3 className="chart-title">Case Status Distribution</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={caseStatusData}>
                  <defs>
                    <linearGradient id="caseStatusGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.9}/>
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" stroke="#64748b" />
                  <YAxis stroke="#64748b" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'white', 
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Bar 
                    dataKey="value" 
                    fill="url(#caseStatusGradient)"
                    radius={[8, 8, 0, 0]}
                    name="Cases"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* User Growth Trend */}
          {userGrowthData.length > 0 && (
            <div className="chart-card full-width">
              <h3 className="chart-title">User Growth Trend (Last 6 Months)</h3>
              
              {/* Summary Cards */}
              <div className="growth-summary-cards">
                <div className="growth-summary-card">
                  <div className="growth-summary-icon" style={{ background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                  </div>
                  <div className="growth-summary-content">
                    <p className="growth-summary-label">Total New Users</p>
                    <p className="growth-summary-value">{userGrowthStats.total}</p>
                    <p className="growth-summary-detail">Last 6 months</p>
                  </div>
                </div>

                <div className="growth-summary-card">
                  <div className="growth-summary-icon" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="1" x2="12" y2="23"></line>
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                  </div>
                  <div className="growth-summary-content">
                    <p className="growth-summary-label">Average per Month</p>
                    <p className="growth-summary-value">{userGrowthStats.average}</p>
                    <p className="growth-summary-detail">Monthly average</p>
                  </div>
                </div>

                <div className="growth-summary-card">
                  <div className="growth-summary-icon" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                      <polyline points="17 6 23 6 23 12"></polyline>
                    </svg>
                  </div>
                  <div className="growth-summary-content">
                    <p className="growth-summary-label">Growth Rate</p>
                    <p className="growth-summary-value" style={{ color: userGrowthStats.growthRate >= 0 ? '#10b981' : '#ef4444' }}>
                      {userGrowthStats.growthRate >= 0 ? '+' : ''}{userGrowthStats.growthRate}%
                    </p>
                    <p className="growth-summary-detail">vs first 3 months</p>
                  </div>
                </div>

                <div className="growth-summary-card">
                  <div className="growth-summary-icon" style={{ background: 'linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                      <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                  </div>
                  <div className="growth-summary-content">
                    <p className="growth-summary-label">Peak Month</p>
                    <p className="growth-summary-value">{userGrowthStats.highest}</p>
                    <p className="growth-summary-detail">{userGrowthStats.highestMonth || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="growth-chart-container">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={userGrowthData}>
                    <defs>
                      <linearGradient id="userGrowthGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="month" 
                      stroke="#64748b"
                      tick={{ fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis 
                      stroke="#64748b"
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'white', 
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                      }}
                      formatter={(value: number) => [`${value} users`, 'New Users']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="users" 
                      stroke="#10b981" 
                      strokeWidth={3}
                      fill="url(#userGrowthGradient)"
                      name="New Users"
                      dot={{ fill: '#10b981', r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* AI Usage Analytics */}
          {data?.aiUsage && data.aiUsage.totalRequests > 0 && (
            <div className="chart-card full-width">
              <h3 className="chart-title">
                AI Usage & Cost Analytics
                {datePreset === 'last7days' && ' (Last 7 Days)'}
                {datePreset === 'last30days' && ' (Last 30 Days)'}
                {datePreset === 'custom' && ` (${startDate} to ${endDate})`}
              </h3>
              
              {/* Summary Cards */}
              <div className="ai-usage-summary-cards">
                <div className="ai-usage-summary-card">
                  <div className="ai-usage-summary-icon" style={{ background: 'linear-gradient(135deg, #ddd6fe 0%, #c4b5fd 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                      <path d="M2 17l10 5 10-5M2 12l10 5 10-5"></path>
                    </svg>
                  </div>
                  <div className="ai-usage-summary-content">
                    <p className="ai-usage-summary-label">Total AI Requests</p>
                    <p className="ai-usage-summary-value">{data.aiUsage.totalRequests}</p>
                    <p className="ai-usage-summary-detail">All AI analyses</p>
                  </div>
                </div>

                <div className="ai-usage-summary-card">
                  <div className="ai-usage-summary-icon" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="1" x2="12" y2="23"></line>
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                  </div>
                  <div className="ai-usage-summary-content">
                    <p className="ai-usage-summary-label">Total Cost</p>
                    <p className="ai-usage-summary-value">${data.aiUsage.totalCost.toFixed(4)}</p>
                    <p className="ai-usage-summary-detail">Estimated OpenAI cost</p>
                  </div>
                </div>

                <div className="ai-usage-summary-card">
                  <div className="ai-usage-summary-icon" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                      <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                  </div>
                  <div className="ai-usage-summary-content">
                    <p className="ai-usage-summary-label">Transcriptions</p>
                    <p className="ai-usage-summary-value">{data.aiUsage.transcriptions.count}</p>
                    <p className="ai-usage-summary-detail">Clinician analyses</p>
                  </div>
                </div>

                <div className="ai-usage-summary-card">
                  <div className="ai-usage-summary-icon" style={{ background: 'linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                      <line x1="12" y1="9" x2="12" y2="13"></line>
                      <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                  </div>
                  <div className="ai-usage-summary-content">
                    <p className="ai-usage-summary-label">Incident Analyses</p>
                    <p className="ai-usage-summary-value">{data.aiUsage.incidentAnalysis.count}</p>
                    <p className="ai-usage-summary-detail">${data.aiUsage.incidentAnalysis.estimatedCost.toFixed(4)} estimated</p>
                  </div>
                </div>
              </div>

              {/* Charts */}
              <div className="ai-usage-charts">
                {/* Transcription Usage Trend */}
                {data.aiUsage.transcriptions.dailyTrend.length > 0 && (
                  <div className="ai-usage-chart-container">
                    <h4 className="ai-usage-chart-title">Transcription Analysis Usage</h4>
                    <ResponsiveContainer width="100%" height={250}>
                      <AreaChart data={data.aiUsage.transcriptions.dailyTrend}>
                        <defs>
                          <linearGradient id="transcriptionGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis 
                          dataKey="day" 
                          stroke="#64748b"
                          tick={{ fontSize: 11 }}
                          angle={data.aiUsage.transcriptions.dailyTrend.length > 7 ? -45 : 0}
                          textAnchor={data.aiUsage.transcriptions.dailyTrend.length > 7 ? 'end' : 'middle'}
                          height={data.aiUsage.transcriptions.dailyTrend.length > 7 ? 80 : 30}
                        />
                        <YAxis 
                          stroke="#64748b"
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'white', 
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                          }}
                          formatter={(value: number, name: string) => {
                            if (name === 'count') return [`${value} analyses`, 'Count']
                            if (name === 'cost') return [`$${value.toFixed(4)}`, 'Cost']
                            return [value, name]
                          }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="count" 
                          stroke="#8b5cf6" 
                          strokeWidth={2}
                          fill="url(#transcriptionGradient)"
                          name="count"
                          dot={{ fill: '#8b5cf6', r: 3 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Incident Analysis Trend */}
                {data.aiUsage.incidentAnalysis.dailyTrend.length > 0 && (
                  <div className="ai-usage-chart-container">
                    <h4 className="ai-usage-chart-title">Incident Analysis Usage</h4>
                    <ResponsiveContainer width="100%" height={250}>
                      <AreaChart data={data.aiUsage.incidentAnalysis.dailyTrend}>
                        <defs>
                          <linearGradient id="incidentGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis 
                          dataKey="day" 
                          stroke="#64748b"
                          tick={{ fontSize: 11 }}
                          angle={data.aiUsage.incidentAnalysis.dailyTrend.length > 7 ? -45 : 0}
                          textAnchor={data.aiUsage.incidentAnalysis.dailyTrend.length > 7 ? 'end' : 'middle'}
                          height={data.aiUsage.incidentAnalysis.dailyTrend.length > 7 ? 80 : 30}
                        />
                        <YAxis 
                          stroke="#64748b"
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'white', 
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                          }}
                          formatter={(value: number) => [`${value} analyses`, 'Count']}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="count" 
                          stroke="#f59e0b" 
                          strokeWidth={2}
                          fill="url(#incidentGradient)"
                          name="count"
                          dot={{ fill: '#f59e0b', r: 3 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* AI Usage by User List */}
              {data?.aiUsage?.users && data.aiUsage.users.length > 0 && (
                <div className="ai-usage-users-section">
                  <h3 className="section-title" style={{ marginBottom: '20px' }}>AI Usage by User</h3>
                  <div className="ai-usage-users-table">
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
                          <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>User</th>
                          <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Role</th>
                          <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '13px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Transcriptions</th>
                          <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '13px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Incidents</th>
                          <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '13px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Total Requests</th>
                          <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '13px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Total Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.aiUsage.users.map((user, index) => (
                          <tr 
                            key={user.userId} 
                            style={{ 
                              borderBottom: '1px solid #e2e8f0',
                              transition: 'background 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <td style={{ padding: '14px 16px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{user.name}</span>
                                <span style={{ fontSize: '12px', color: '#64748b' }}>{user.email}</span>
                              </div>
                            </td>
                            <td style={{ padding: '14px 16px' }}>
                              <span style={{ 
                                fontSize: '12px', 
                                padding: '4px 8px', 
                                borderRadius: '4px',
                                background: user.role === 'clinician' ? '#dbeafe' : '#fef3c7',
                                color: user.role === 'clinician' ? '#1e40af' : '#92400e',
                                fontWeight: 500,
                                textTransform: 'capitalize'
                              }}>
                                {user.role}
                              </span>
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                              {user.transcriptions.count > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{user.transcriptions.count}</span>
                                  <span style={{ fontSize: '12px', color: '#64748b' }}>${user.transcriptions.cost.toFixed(4)}</span>
                                </div>
                              ) : (
                                <span style={{ fontSize: '14px', color: '#94a3b8' }}>-</span>
                              )}
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                              {user.incidents.count > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{user.incidents.count}</span>
                                  <span style={{ fontSize: '12px', color: '#64748b' }}>${user.incidents.cost.toFixed(4)}</span>
                                </div>
                              ) : (
                                <span style={{ fontSize: '14px', color: '#94a3b8' }}>-</span>
                              )}
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                              <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{user.totalRequests}</span>
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                              <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>${user.totalCost.toFixed(4)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Empty State */}
        {!loading && !error && dailyCheckInsData.length === 0 && caseStatusData.length === 0 && userGrowthData.length === 0 && (!data?.aiUsage || data.aiUsage.totalRequests === 0) && (
          <div className="empty-state">
            <p>No analytics data available</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

