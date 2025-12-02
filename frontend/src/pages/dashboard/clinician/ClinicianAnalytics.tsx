import { useState, useEffect, useMemo, useCallback } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { formatDate } from '../../../shared/date'
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
  ResponsiveContainer,
} from 'recharts'
import './ClinicianAnalytics.css'

interface Case {
  id: string
  caseNumber: string
  status: string
  type: string
  priority: string
  createdAt: string
  workerName: string
  teamName: string
}

interface RehabilitationPlan {
  id: string
  caseNumber: string
  workerName: string
  duration: number
  progress: number
  currentDay: number
  status: 'active' | 'completed' | 'cancelled'
  startDate: string
  endDate: string
}

interface AnalyticsData {
  summary: {
    totalCases: number
    activeCases: number
    closedCases: number
    inRehabCases: number
    totalPlans: number
    activePlans: number
    completedPlans: number
    averagePlanDuration: number
    averageProgress: number
  }
  caseStats: {
    byStatus: Record<string, number>
    byType: Record<string, number>
    byPriority: Record<string, number>
  }
  planStats: {
    byStatus: Record<string, number>
    averageDuration: number
    averageProgress: number
    completionRate: number
  }
  trends: {
    daily: Array<{
      date: string
      cases: number
      plans: number
      completed: number
    }>
    weekly: Array<{
      week: string
      cases: number
      plans: number
      completed: number
    }>
  }
  workerRecovery: Array<{
    workerName: string
    caseCount: number
    planCount: number
    averageProgress: number
    recoveryRate: number
  }>
  typeDistribution: Array<{
    name: string
    value: number
    color: string
  }>
  priorityDistribution: Array<{
    name: string
    value: number
    color: string
  }>
}

const COLORS = {
  injury: '#EF4444',
  accident: '#F59E0B',
  medical_leave: '#3B82F6',
  other: '#8B5CF6',
  HIGH: '#DC2626',
  MEDIUM: '#F59E0B',
  LOW: '#10B981',
  active: '#3B82F6',
  completed: '#10B981',
  cancelled: '#64748B',
}

const TYPE_LABELS: Record<string, string> = {
  injury: 'Injury',
  accident: 'Accident',
  medical_leave: 'Medical Leave',
  other: 'Other',
}

export function ClinicianAnalytics() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  
  // Initialize with "this month" by default - Use formatDate to avoid timezone issues
  const getThisMonthDates = useCallback(() => {
    const today = new Date()
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
    return {
      start: formatDate(firstDay),
      end: formatDate(today)
    }
  }, [])
  
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(getThisMonthDates)
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [rawCases, setRawCases] = useState<Case[]>([])
  const [rawPlans, setRawPlans] = useState<RehabilitationPlan[]>([])

  // Memoize today's date string to avoid repeated calculations
  const todayStr = useMemo(() => formatDate(new Date()), [])

  // Helper function for date display formatting
  const formatDateDisplay = useCallback((dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }, [])

  // Optimized: Pre-parse dates once
  const dateRangeBounds = useMemo(() => {
    if (!dateRange.start || !dateRange.end) return null
    const start = new Date(dateRange.start)
    start.setHours(0, 0, 0, 0)
    const end = new Date(dateRange.end)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }, [dateRange.start, dateRange.end])

  const filterByDateRange = useCallback((items: any[], dateField: string): any[] => {
    if (!dateRangeBounds) return items
    
    // Pre-parse all item dates once (optimization)
    const itemDates = new Map<any, number>()
    items.forEach((item) => {
      const dateStr = item[dateField]
      if (dateStr) {
        itemDates.set(item, new Date(dateStr).getTime())
      }
    })
    
    return items.filter(item => {
      const itemTime = itemDates.get(item)
      return itemTime !== undefined && itemTime >= dateRangeBounds.start.getTime() && itemTime <= dateRangeBounds.end.getTime()
    })
  }, [dateRangeBounds])

  const processAnalyticsData = useCallback((
    cases: Case[],
    plans: RehabilitationPlan[]
  ): AnalyticsData => {
    // Filter by date range
    const filteredCases = filterByDateRange(cases, 'createdAt')
    const filteredPlans = filterByDateRange(plans, 'startDate')
    // Summary statistics - single pass (optimized)
    let totalCases = 0
    let activeCases = 0
    let closedCases = 0
    let inRehabCases = 0
    
    let totalPlans = 0
    let activePlans = 0
    let completedPlans = 0
    let totalDuration = 0
    let totalProgress = 0

    filteredCases.forEach(c => {
      totalCases++
      if (c.status === 'CLOSED') closedCases++
      else if (c.status === 'IN REHAB') inRehabCases++
      else activeCases++
    })

    filteredPlans.forEach(p => {
      totalPlans++
      if (p.status === 'active') activePlans++
      else if (p.status === 'completed') completedPlans++
      totalDuration += p.duration
      totalProgress += p.progress
    })
    
    const avgDuration = totalPlans > 0 ? Math.round(totalDuration / totalPlans) : 0
    const avgProgress = totalPlans > 0 ? Math.round(totalProgress / totalPlans) : 0

    // Case statistics
    const byStatus: Record<string, number> = {}
    const byType: Record<string, number> = {}
    const byPriority: Record<string, number> = {}

    filteredCases.forEach(caseItem => {
      byStatus[caseItem.status] = (byStatus[caseItem.status] || 0) + 1
      byType[caseItem.type] = (byType[caseItem.type] || 0) + 1
      byPriority[caseItem.priority] = (byPriority[caseItem.priority] || 0) + 1
    })

    // Plan statistics
    const planByStatus: Record<string, number> = {}
    filteredPlans.forEach(plan => {
      planByStatus[plan.status] = (planByStatus[plan.status] || 0) + 1
    })

    const completionRate = totalPlans > 0
      ? Math.round((completedPlans / totalPlans) * 100)
      : 0

    // Daily trends - optimized with Maps (O(1) lookup)
    const dailyTrends: Array<{ date: string; cases: number; plans: number; completed: number }> = []
    
    if (!dateRangeBounds) {
      return {
        summary: { totalCases: 0, activeCases: 0, closedCases: 0, inRehabCases: 0, totalPlans: 0, activePlans: 0, completedPlans: 0, averagePlanDuration: 0, averageProgress: 0 },
        caseStats: { byStatus: {}, byType: {}, byPriority: {} },
        planStats: { byStatus: {}, averageDuration: 0, averageProgress: 0, completionRate: 0 },
        trends: { daily: [], weekly: [] },
        workerRecovery: [],
        typeDistribution: [],
        priorityDistribution: [],
      }
    }

    // Pre-build date maps for O(1) lookup (optimization)
    const casesByDate = new Map<string, number>()
    const plansByDate = new Map<string, number>()
    const completedByDate = new Map<string, number>()

    filteredCases.forEach(c => {
      const dateStr = new Date(c.createdAt).toISOString().split('T')[0]
      casesByDate.set(dateStr, (casesByDate.get(dateStr) || 0) + 1)
    })

    filteredPlans.forEach(p => {
      const startDateStr = new Date(p.startDate).toISOString().split('T')[0]
      plansByDate.set(startDateStr, (plansByDate.get(startDateStr) || 0) + 1)
      
      if (p.status === 'completed' && p.endDate) {
        const endDateStr = new Date(p.endDate).toISOString().split('T')[0]
        completedByDate.set(endDateStr, (completedByDate.get(endDateStr) || 0) + 1)
      }
    })

    const startDate = dateRangeBounds.start
    const endDate = dateRangeBounds.end
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    const maxDays = Math.min(daysDiff, 60) // Reduced to 60 days for better performance
    
    // Sample data if range is too large (optimization)
    const sampleRate = daysDiff > 60 ? Math.ceil(daysDiff / 60) : 1
    
    for (let i = 0; i <= maxDays; i++) {
      const actualDay = i * sampleRate
      const date = new Date(startDate)
      date.setDate(startDate.getDate() + actualDay)
      if (date > endDate) break
      
      const dateStr = date.toISOString().split('T')[0]
      
      dailyTrends.push({
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        cases: casesByDate.get(dateStr) || 0,
        plans: plansByDate.get(dateStr) || 0,
        completed: completedByDate.get(dateStr) || 0,
      })
    }

    // Weekly trends - removed as not displayed in UI (only daily trends are shown)

    // Worker recovery statistics
    const workerMap = new Map<string, { cases: Case[]; plans: RehabilitationPlan[] }>()
    filteredCases.forEach(caseItem => {
      if (!workerMap.has(caseItem.workerName)) {
        workerMap.set(caseItem.workerName, { cases: [], plans: [] })
      }
      workerMap.get(caseItem.workerName)!.cases.push(caseItem)
    })
    filteredPlans.forEach(plan => {
      if (!workerMap.has(plan.workerName)) {
        workerMap.set(plan.workerName, { cases: [], plans: [] })
      }
      workerMap.get(plan.workerName)!.plans.push(plan)
    })

    const workerRecovery = Array.from(workerMap.entries())
      .map(([workerName, data]) => {
        const caseCount = data.cases.length
        const planCount = data.plans.length
        const avgProgress = data.plans.length > 0
          ? Math.round(data.plans.reduce((sum, p) => sum + p.progress, 0) / data.plans.length)
          : 0
        const completedPlans = data.plans.filter(p => p.status === 'completed').length
        const recoveryRate = planCount > 0
          ? Math.round((completedPlans / planCount) * 100)
          : 0

        return {
          workerName,
          caseCount,
          planCount,
          averageProgress: avgProgress,
          recoveryRate,
        }
      })
      .sort((a, b) => b.caseCount - a.caseCount)
      .slice(0, 10) // Top 10 workers

    // Distribution charts data
    const typeDistribution = Object.entries(byType).map(([name, value]) => ({
      name: TYPE_LABELS[name] || name,
      value,
      color: COLORS[name as keyof typeof COLORS] || '#64748B',
    }))

    const priorityDistribution = Object.entries(byPriority).map(([name, value]) => ({
      name,
      value,
      color: COLORS[name as keyof typeof COLORS] || '#64748B',
    }))

    return {
      summary: {
        totalCases,
        activeCases,
        closedCases,
        inRehabCases,
        totalPlans,
        activePlans,
        completedPlans,
        averagePlanDuration: avgDuration,
        averageProgress: avgProgress,
      },
      caseStats: {
        byStatus,
        byType,
        byPriority,
      },
      planStats: {
        byStatus: planByStatus,
        averageDuration: avgDuration,
        averageProgress: avgProgress,
        completionRate,
      },
      trends: {
        daily: dailyTrends,
        weekly: [], // Not displayed in UI, kept for interface compatibility
      },
      workerRecovery,
      typeDistribution,
      priorityDistribution,
    }
  }, [filterByDateRange, dateRangeBounds])

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const [casesResult, plansResult] = await Promise.all([
        apiClient.get<{ cases: Case[] }>(`${API_ROUTES.CLINICIAN.CASES}?status=all&limit=1000`),
        apiClient.get<{ plans: RehabilitationPlan[] }>(`${API_ROUTES.CLINICIAN.REHABILITATION_PLANS}?status=all`),
      ])

      if (isApiError(casesResult) || isApiError(plansResult)) {
        throw new Error('Failed to fetch analytics data')
      }

      const casesData = casesResult.data
      const plansData = plansResult.data

      const cases: Case[] = casesData.cases || []
      const plans: RehabilitationPlan[] = plansData.plans || []

      // Store raw data for client-side filtering (optimization - no API call on date change)
      setRawCases(cases)
      setRawPlans(plans)
    } catch (err: any) {
      console.error('Error fetching analytics:', err)
      setError(err.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics, refreshKey])

  // Process analytics when raw data or date range changes (optimized - no API call needed)
  useEffect(() => {
    if (rawCases.length > 0 || rawPlans.length > 0) {
      const processedData = processAnalyticsData(rawCases, rawPlans)
      setAnalyticsData(processedData)
    }
  }, [rawCases, rawPlans, processAnalyticsData])

  // Close date filter on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (showDateFilter && !target.closest('.date-filter-container')) {
        setShowDateFilter(false)
      }
    }
    if (showDateFilter) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showDateFilter])

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  const handleResetDateRange = () => {
    // Reset to "this month" instead of last 30 days
    const thisMonthDates = getThisMonthDates()
    setDateRange(thisMonthDates)
    setShowDateFilter(false)
  }

  // Reusable tooltip style (memoized - must be before early returns per Rules of Hooks)
  const tooltipStyle = useMemo(() => ({
    backgroundColor: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  }), [])

  if (loading) {
    return (
      <DashboardLayout>
        <div className="clinician-analytics">
          <Loading message="Loading analytics..." size="large" />
        </div>
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="clinician-analytics">
          <div className="clinician-analytics-error">
            <p>{error}</p>
            <button onClick={handleRefresh}>Retry</button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (!analyticsData) {
    return (
      <DashboardLayout>
        <div className="clinician-analytics">
          <div className="clinician-analytics-error">
            <p>No analytics data available</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="clinician-analytics-content">
        {/* Header */}
        <div className="clinician-analytics-header">
          <div>
            <h1 className="clinician-analytics-title">Analytics</h1>
            <p className="clinician-analytics-subtitle">Performance insights & metrics</p>
          </div>
          <div className="clinician-analytics-actions">
            <div className="date-filter-container">
              <button 
                className="date-filter-btn"
                onClick={() => setShowDateFilter(!showDateFilter)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <span>
                  {formatDateDisplay(dateRange.start)} - {formatDateDisplay(dateRange.end)}
                </span>
              </button>
              {showDateFilter && (
                <div className="date-filter-dropdown">
                  <div className="date-filter-header">
                    <h4>Select Date Range</h4>
                    <button className="date-filter-close" onClick={() => setShowDateFilter(false)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                  <div className="date-filter-inputs">
                    <div className="date-input-group">
                      <label>Start Date</label>
                      <input
                        type="date"
                        value={dateRange.start}
                        onChange={(e) => {
                          const newStart = e.target.value
                          if (newStart <= dateRange.end) {
                            setDateRange(prev => ({ ...prev, start: newStart }))
                          }
                        }}
                        max={dateRange.end}
                      />
                    </div>
                    <div className="date-input-group">
                      <label>End Date</label>
                      <input
                        type="date"
                        value={dateRange.end}
                        onChange={(e) => {
                          const newEnd = e.target.value
                          if (newEnd >= dateRange.start && newEnd <= todayStr) {
                            setDateRange(prev => ({ ...prev, end: newEnd }))
                          }
                        }}
                        min={dateRange.start}
                        max={todayStr}
                      />
                    </div>
                  </div>
                  <div className="date-filter-footer">
                    <button className="date-filter-reset" onClick={handleResetDateRange}>
                      Reset to This Month
                    </button>
                    <button className="date-filter-apply" onClick={() => setShowDateFilter(false)}>
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button className="clinician-analytics-refresh" onClick={handleRefresh}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Key Metrics - Simple & Powerful */}
        <div className="clinician-analytics-metrics">
          <div className="clinician-analytics-metric-card primary">
            <div className="metric-number">{analyticsData.summary.totalCases}</div>
            <div className="metric-label">Total Cases</div>
            <div className="metric-subtitle">
              {analyticsData.summary.activeCases} active • {analyticsData.summary.closedCases} closed
            </div>
          </div>
          
          <div className="clinician-analytics-metric-card success">
            <div className="metric-number">{analyticsData.summary.activePlans}</div>
            <div className="metric-label">Active Plans</div>
            <div className="metric-subtitle">
              {analyticsData.summary.averageProgress}% avg progress
            </div>
          </div>

          <div className="clinician-analytics-metric-card info">
            <div className="metric-number">{analyticsData.planStats.completionRate}%</div>
            <div className="metric-label">Completion Rate</div>
            <div className="metric-subtitle">
              {analyticsData.summary.completedPlans} of {analyticsData.summary.totalPlans} completed
            </div>
          </div>

          <div className="clinician-analytics-metric-card warning">
            <div className="metric-number">{analyticsData.summary.averagePlanDuration}</div>
            <div className="metric-label">Avg Duration</div>
            <div className="metric-subtitle">days per plan</div>
          </div>
        </div>

        {/* Main Charts - Clean & Focused */}
        <div className="clinician-analytics-main">
          {/* Activity Trends */}
          <div className="clinician-analytics-chart-main">
            <div className="chart-header">
              <h3>Activity Trends</h3>
              <span className="chart-period">
                {formatDateDisplay(dateRange.start)} - {formatDateDisplay(dateRange.end)}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart 
                data={analyticsData.trends.daily} 
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                key={`daily-${analyticsData.trends.daily.length}`}
              >
                <defs>
                  <linearGradient id="colorCases" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorPlans" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="date" stroke="#94A3B8" fontSize={12} />
                <YAxis stroke="#94A3B8" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="cases" stroke="#3B82F6" fillOpacity={1} fill="url(#colorCases)" />
                <Area type="monotone" dataKey="plans" stroke="#10B981" fillOpacity={1} fill="url(#colorPlans)" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="chart-legend">
              <div className="legend-item">
                <span className="legend-dot legend-blue"></span>
                <span>Cases</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot legend-green"></span>
                <span>New Plans</span>
              </div>
            </div>
          </div>

          {/* Distribution Charts */}
          <div className="clinician-analytics-distributions">
            <div className="distribution-chart">
              <div className="chart-header">
                <h3>Case Types</h3>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={analyticsData.typeDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {analyticsData.typeDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="distribution-labels">
                {analyticsData.typeDistribution.map((item, index) => (
                  <div key={index} className="distribution-label-item">
                    <span className="distribution-dot" style={{ backgroundColor: item.color }}></span>
                    <span>{item.name}</span>
                    <span className="distribution-value">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="distribution-chart">
              <div className="chart-header">
                <h3>Priority Levels</h3>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={analyticsData.priorityDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {analyticsData.priorityDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="distribution-labels">
                {analyticsData.priorityDistribution.map((item, index) => (
                  <div key={index} className="distribution-label-item">
                    <span className="distribution-dot" style={{ backgroundColor: item.color }}></span>
                    <span>{item.name}</span>
                    <span className="distribution-value">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Worker Recovery - Simple List */}
        {analyticsData.workerRecovery.length > 0 && (
          <div className="clinician-analytics-recovery">
            <div className="chart-header">
              <h3>Top Workers Recovery</h3>
              <span className="chart-period">Performance metrics</span>
            </div>
            <div className="recovery-list">
              {analyticsData.workerRecovery.slice(0, 5).map((worker, index) => (
                <div key={index} className="recovery-item">
                  <div className="recovery-rank">{index + 1}</div>
                  <div className="recovery-info">
                    <div className="recovery-name">{worker.workerName}</div>
                    <div className="recovery-stats">
                      {worker.caseCount} cases • {worker.planCount} plans • {worker.averageProgress}% progress
                    </div>
                  </div>
                  <div className="recovery-rate">
                    <div className="recovery-rate-value">{worker.recoveryRate}%</div>
                    <div className="recovery-rate-bar">
                      <div 
                        className={`recovery-rate-fill recovery-${worker.recoveryRate >= 80 ? 'high' : worker.recoveryRate >= 50 ? 'medium' : 'low'}`}
                        style={{ width: `${worker.recoveryRate}%` }}
                      ></div>
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

