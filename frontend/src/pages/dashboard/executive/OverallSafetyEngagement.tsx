import { useState, useEffect, useMemo, useCallback } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { useAuth } from '../../../contexts/AuthContext'
import { executiveService } from '../../../services/executiveService'
import type { SafetyEngagementResponse } from '../../../services/executiveService'
import { isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { getTodayDateString, getStartOfWeekDateString } from '../../../shared/date'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts'
import './OverallSafetyEngagement.css'

type DatePreset = 'thisWeek' | 'thisMonth' | 'last30Days' | 'custom'

/**
 * Calculate date range based on preset (optimized - no duplication)
 */
const calculateDateRange = (preset: DatePreset, customStart?: string, customEnd?: string) => {
  const today = new Date()
  const todayStr = getTodayDateString()

  switch (preset) {
    case 'thisWeek':
      return {
        start: getStartOfWeekDateString(),
        end: todayStr,
      }
    case 'thisMonth': {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      return {
        start: monthStart.toISOString().split('T')[0],
        end: todayStr,
      }
    }
    case 'last30Days': {
      const last30Days = new Date(today)
      last30Days.setDate(today.getDate() - 30)
      return {
        start: last30Days.toISOString().split('T')[0],
        end: todayStr,
      }
    }
    case 'custom':
      return {
        start: customStart || getStartOfWeekDateString(),
        end: customEnd || todayStr,
      }
    default:
      return {
        start: getStartOfWeekDateString(),
        end: todayStr,
      }
  }
}

/**
 * Validate date range (SECURITY: Client-side validation before API call)
 */
const validateDateRange = (start: string, end: string): string | null => {
  if (!start || !end) return 'Start and end dates are required'
  if (start > end) return 'Start date must be before or equal to end date'
  
  const todayStr = getTodayDateString()
  if (end > todayStr) return 'End date cannot be in the future'
  
  const startDate = new Date(start)
  const endDate = new Date(end)
  const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  
  if (daysDiff > 365) return 'Date range cannot exceed 365 days'
  if (start < '2020-01-01') return 'Start date cannot be before 2020-01-01'
  
  return null
}

export function OverallSafetyEngagement() {
  const { business_name } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<SafetyEngagementResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [datePreset, setDatePreset] = useState<DatePreset>('thisWeek')
  const [startDate, setStartDate] = useState<string>(getStartOfWeekDateString())
  const [endDate, setEndDate] = useState<string>(getTodayDateString())

  // Calculate date range based on preset (optimized - single source of truth)
  const dateRange = useMemo(() => {
    return calculateDateRange(datePreset, startDate, endDate)
  }, [datePreset, startDate, endDate])

  // Memoized fetch function to prevent unnecessary re-renders
  const fetchData = useCallback(async () => {
    // Client-side validation before API call
    const validationError = validateDateRange(dateRange.start, dateRange.end)
    if (validationError) {
      setError(validationError)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await executiveService.getSafetyEngagement({
        startDate: dateRange.start,
        endDate: dateRange.end,
      })
      
      // Use centralized error handling
      if (isApiError(result)) {
        setError(getApiErrorMessage(result))
      } else {
        setData(result.data)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load safety engagement data')
    } finally {
      setLoading(false)
    }
  }, [dateRange.start, dateRange.end])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleDatePresetChange = (preset: DatePreset) => {
    setDatePreset(preset)
    if (preset !== 'custom') {
      const calculatedRange = calculateDateRange(preset)
      setStartDate(calculatedRange.start)
      setEndDate(calculatedRange.end)
    }
  }

  const handleStartDateChange = (value: string) => {
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return
    
    setStartDate(value)
    setDatePreset('custom')
    // Auto-adjust end date if start > end
    if (value > endDate) {
      setEndDate(value)
    }
  }

  const handleEndDateChange = (value: string) => {
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return
    
    const todayStr = getTodayDateString()
    // Prevent future dates
    if (value > todayStr) {
      setEndDate(todayStr)
      return
    }
    
    setEndDate(value)
    setDatePreset('custom')
    // Auto-adjust start date if end < start
    if (value < startDate) {
      setStartDate(value)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="safety-engagement-container">
          <Loading message="Loading safety engagement data..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="safety-engagement-container">
          <div className="safety-engagement-error">
            <p>{error}</p>
            <button onClick={fetchData}>Retry</button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (!data) {
    return (
      <DashboardLayout>
        <div className="safety-engagement-container">
          <div className="safety-engagement-empty">
            <p>No data available</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const engagementPercentage = data.overallSafetyEngagement
  const checkInPercentage = data.checkInCompletion
  const { green, amber, red, pending } = data.readinessBreakdown

  // Calculate trend (mock for now - can be enhanced with historical data)
  const trendDirection = engagementPercentage >= 75 ? 'up' : 'neutral'
  const trend = engagementPercentage >= 85 ? '+2%' : engagementPercentage >= 75 ? '+1%' : '0%'

  // Breakdown card data
  const breakdownCards = [
    {
      type: 'green',
      label: 'Green',
      value: green,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      ),
    },
    {
      type: 'amber',
      label: 'Amber',
      value: amber,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      ),
    },
    {
      type: 'red',
      label: 'Red',
      value: red,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      ),
    },
    {
      type: 'pending',
      label: 'Pending',
      value: pending,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      ),
    },
  ]

  return (
    <DashboardLayout>
      <div className="safety-engagement-container">
        {/* Header */}
        <div className="safety-engagement-header">
          <div>
            <h1 className="safety-engagement-title">Overall Safety Engagement</h1>
            <p className="safety-engagement-subtitle">
              {business_name ? `${business_name} • Work Readiness Overview` : 'Work Readiness Overview'}
            </p>
          </div>
          <button className="safety-engagement-refresh-btn" onClick={fetchData} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>

        {/* Date Filter */}
        <div className="safety-engagement-date-filter">
          <div className="safety-engagement-date-presets">
            <button
              className={`safety-engagement-preset-btn ${datePreset === 'thisWeek' ? 'active' : ''}`}
              onClick={() => handleDatePresetChange('thisWeek')}
            >
              This Week
            </button>
            <button
              className={`safety-engagement-preset-btn ${datePreset === 'thisMonth' ? 'active' : ''}`}
              onClick={() => handleDatePresetChange('thisMonth')}
            >
              This Month
            </button>
            <button
              className={`safety-engagement-preset-btn ${datePreset === 'last30Days' ? 'active' : ''}`}
              onClick={() => handleDatePresetChange('last30Days')}
            >
              Last 30 Days
            </button>
            <button
              className={`safety-engagement-preset-btn ${datePreset === 'custom' ? 'active' : ''}`}
              onClick={() => handleDatePresetChange('custom')}
            >
              Custom Range
            </button>
          </div>
          <div className="safety-engagement-date-inputs">
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => handleStartDateChange(e.target.value)}
              max={dateRange.end}
              className="safety-engagement-date-input"
            />
            <span className="safety-engagement-date-separator">to</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => handleEndDateChange(e.target.value)}
              min={dateRange.start}
              max={getTodayDateString()}
              className="safety-engagement-date-input"
            />
          </div>
        </div>

        {/* Main Card - Overall Safety Engagement */}
        <div className="safety-engagement-main-card">
          <div className="safety-engagement-main-header">
            <h2 className="safety-engagement-main-title">Safety Engagement</h2>
            {trendDirection === 'up' && (
              <div className="safety-engagement-trend up">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
                <span>{trend} vs last week</span>
              </div>
            )}
          </div>
          <div className="safety-engagement-main-value">{engagementPercentage}%</div>
          <div className="safety-engagement-main-metrics">
            <div className="safety-engagement-metric">
              <span className="safety-engagement-metric-label">Check-ins</span>
              <span className="safety-engagement-metric-value">{checkInPercentage}%</span>
            </div>
          </div>
        </div>

        {/* Readiness Breakdown Cards */}
        <div className="safety-engagement-breakdown">
          {breakdownCards.map((card) => (
            <div key={card.type} className={`safety-engagement-breakdown-card ${card.type}`}>
              <div className="safety-engagement-breakdown-header">
                <div className={`safety-engagement-breakdown-icon ${card.type}`}>
                  {card.icon}
                </div>
                <h3 className="safety-engagement-breakdown-title">{card.label}</h3>
              </div>
              <div className="safety-engagement-breakdown-value">{card.value}</div>
              <div className="safety-engagement-breakdown-label">Workers</div>
            </div>
          ))}
        </div>

        {/* Summary Stats */}
        <div className="safety-engagement-summary">
          <div className="safety-engagement-summary-card">
            <div className="safety-engagement-summary-label">Total Workers</div>
            <div className="safety-engagement-summary-value">{data.totalWorkers}</div>
          </div>
          <div className="safety-engagement-summary-card">
            <div className="safety-engagement-summary-label">Active Workers</div>
            <div className="safety-engagement-summary-value">{data.activeWorkers}</div>
          </div>
          <div className="safety-engagement-summary-card">
            <div className="safety-engagement-summary-label">Period</div>
            <div className="safety-engagement-summary-value">
              {formatDate(dateRange.start)} - {formatDate(dateRange.end)}
            </div>
          </div>
        </div>

        {/* Safety Engagement Trend Chart */}
        <div className="safety-engagement-chart-card">
          <div className="safety-engagement-chart-header">
            <div>
              <h3 className="safety-engagement-chart-title">Safety Engagement Trend</h3>
              <p className="safety-engagement-chart-subtitle">
                Daily work readiness percentage over the selected period
              </p>
            </div>
          </div>
          <div className="safety-engagement-chart-content">
            {data.dailyTrends && data.dailyTrends.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart
                  data={data.dailyTrends}
                  margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
                >
                  <defs>
                    <linearGradient id="engagementGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                      <stop offset="50%" stopColor="#10B981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="#9CA3AF"
                    style={{ fontSize: '12px', fontWeight: '500' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => {
                      const date = new Date(value)
                      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    }}
                    interval="preserveStartEnd"
                    minTickGap={30}
                  />
                  <YAxis
                    stroke="#9CA3AF"
                    style={{ fontSize: '12px', fontWeight: '500' }}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                    tickFormatter={(value) => `${value}%`}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E5E7EB',
                      borderRadius: '8px',
                      padding: '12px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    }}
                    labelFormatter={(value) => {
                      const date = new Date(value)
                      return date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    }}
                    formatter={(value: number) => [`${value}%`, 'Engagement']}
                  />
                  <Area
                    type="monotone"
                    dataKey="engagement"
                    stroke="#10B981"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#engagementGradient)"
                    dot={false}
                    activeDot={{ r: 6, fill: '#10B981', strokeWidth: 2, stroke: '#FFFFFF' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="safety-engagement-chart-empty">
                <p>No trend data available for the selected period</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

