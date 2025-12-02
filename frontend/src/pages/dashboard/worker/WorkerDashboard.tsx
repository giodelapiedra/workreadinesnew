import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { formatTime, formatDateWithWeekday } from '../../../shared/date'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './WorkerDashboard.css'

interface ShiftInfo {
  hasShift: boolean
  shiftType: 'morning' | 'afternoon' | 'night' | 'flexible'
  shiftStart?: string
  shiftEnd?: string
  checkInWindow: {
    windowStart: string
    windowEnd: string
    recommendedStart: string
    recommendedEnd: string
  }
  scheduleSource?: 'team_leader' | 'none' | 'flexible'
  requiresDailyCheckIn?: boolean
  date?: string
  dayName?: string
  formattedDate?: string
}

// Helper function to format case status for display
const getCaseStatusLabel = (caseStatus?: string): string => {
  if (!caseStatus) return ''
  const statusMap: Record<string, string> = {
    'new': 'NEW CASE',
    'triaged': 'TRIAGED',
    'assessed': 'ASSESSED',
    'in_rehab': 'IN REHAB',
    'return_to_work': 'RETURN TO WORK',
    'closed': 'CLOSED'
  }
  return statusMap[caseStatus] || caseStatus.toUpperCase()
}

// Helper function to get case status color
const getCaseStatusColor = (caseStatus?: string): string => {
  if (!caseStatus) return '#6b7280'
  const colorMap: Record<string, string> = {
    'new': '#3b82f6', // Blue
    'triaged': '#8b5cf6', // Purple
    'assessed': '#f59e0b', // Amber
    'in_rehab': '#10b981', // Green
    'return_to_work': '#06b6d4', // Cyan
    'closed': '#6b7280' // Gray
  }
  return colorMap[caseStatus] || '#6b7280'
}


export function WorkerDashboard() {
  const { user, first_name, full_name, business_name } = useAuth()
  const navigate = useNavigate()
  
  // State management
  const [todayProgress, setTodayProgress] = useState(0)
  const [userName, setUserName] = useState(first_name || full_name || user?.email?.split('@')[0] || 'User')
  const [teamSite, setTeamSite] = useState<string | null>(null)
  const [hasWarmUp, setHasWarmUp] = useState(false)
  const [hasCheckedIn, setHasCheckedIn] = useState(false)
  const [hasActiveException, setHasActiveException] = useState(false)
  const [exceptionInfo, setExceptionInfo] = useState<{
    exception_type?: string
    reason?: string
    start_date?: string
    end_date?: string
    case_status?: string
  } | null>(null)
  const [checkInStatus, setCheckInStatus] = useState<{
    hasCheckedIn: boolean
    hasActiveException?: boolean
    exception?: {
      exception_type?: string
      reason?: string
      start_date?: string
      end_date?: string
      case_status?: string
    } | null
    checkIn: {
      check_in_time?: string
      predicted_readiness?: string
      shift_type?: string
    } | null
  } | null>(null)
  const [hasAssignedSchedule, setHasAssignedSchedule] = useState(false)
  const [todayShiftInfo, setTodayShiftInfo] = useState<ShiftInfo | null>(null)
  const [nextShiftInfo, setNextShiftInfo] = useState<ShiftInfo | null>(null)
  const [nextWarmUpTime, setNextWarmUpTime] = useState<Date | null>(null)
  const [timeUntilNext, setTimeUntilNext] = useState<string>('')
  const [hasActiveRehabPlan, setHasActiveRehabPlan] = useState<boolean>(false)
  const [rehabPlanStatus, setRehabPlanStatus] = useState<'active' | 'completed' | 'cancelled' | null>(null)
  const [recoveryPlanDayCompleted, setRecoveryPlanDayCompleted] = useState<boolean>(false)
  const recoveryPlanCheckInProgress = useRef(false)
  const [isDataLoaded, setIsDataLoaded] = useState<boolean>(false)
  const [showNoScheduleModal, setShowNoScheduleModal] = useState(false)
  const [streakData, setStreakData] = useState<{
    currentStreak: number
    longestStreak: number
    todayCheckInCompleted: boolean
    nextMilestone: number | null
    daysUntilNextMilestone: number | null
    hasSevenDayBadge: boolean
    totalScheduledDays: number
    pastScheduledDays: number
    completedDays: number
    missedScheduleDates?: string[]
    missedScheduleCount?: number
    exceptionDates?: Array<{ date: string; exception_type: string; reason: string | null }>
    nextCheckInDate: string | null
    nextCheckInDateFormatted: string | null
    badge: {
      name: string
      description: string
      icon: string
      achieved: boolean
      achievedDate: string
    } | null
  }>({
    currentStreak: 0,
    longestStreak: 0,
    todayCheckInCompleted: false,
    nextMilestone: 7,
    daysUntilNextMilestone: 7,
    hasSevenDayBadge: false,
    totalScheduledDays: 0,
    pastScheduledDays: 0,
    completedDays: 0,
    missedScheduleDates: [],
    missedScheduleCount: 0,
    exceptionDates: [],
    nextCheckInDate: null,
    nextCheckInDateFormatted: null,
    badge: null
  })

  // Update countdown timer every minute
  useEffect(() => {
    if (!nextWarmUpTime) return

    const updateCountdown = () => {
      const now = new Date()
      const diff = nextWarmUpTime.getTime() - now.getTime()
      
      if (diff <= 0) {
        setTimeUntilNext('Available now')
        return
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      
      if (hours > 0) {
        setTimeUntilNext(`${hours}h ${minutes}m`)
      } else {
        setTimeUntilNext(`${minutes}m`)
      }
    }

    // Update immediately
    updateCountdown()

    // Update every minute
    const interval = setInterval(updateCountdown, 60000)

    return () => clearInterval(interval)
  }, [nextWarmUpTime])

  // Calculate today's progress based on check-in and warm-up
  // Logic:
  // - If worker has active exception (only warm-up required):
  //   - Warm-up completed = 100%
  //   - Warm-up not completed = 0%
  // - If worker has active rehab plan (warm-up assigned):
  //   - Check-in only = 50%
  //   - Check-in + warm-up = 100%
  //   - No check-in = 0%
  // - If worker has NO active rehab plan (no warm-up assigned):
  //   - Check-in only = 100%
  //   - No check-in = 0%
  const calculateProgress = (checkedIn: boolean, warmUpComplete: boolean, hasRehabPlan: boolean, hasActiveException: boolean): number => {
    // If exception exists, only warm-up is required
    if (hasActiveException) {
      // Warm-up completed = 100%, otherwise 0%
      return warmUpComplete ? 100 : 0
    }
    
    // No exception - normal logic
    if (!hasRehabPlan) {
      // No warm-up assigned - check-in alone is 100%
      return checkedIn ? 100 : 0
    }
    
    // Warm-up assigned - need both check-in and warm-up for 100%
    if (checkedIn && warmUpComplete) return 100
    if (checkedIn) return 50 // Check-in only = 50%
    return 0
  }

  // Format next warm-up time with date - memoized to prevent re-creation
  const formatNextWarmUpTime = useCallback((date: Date): string => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true 
    })
  }, [])

  const getTimeUntilNextWarmUp = useCallback((nextTime: Date): string => {
    const now = new Date()
    const diff = nextTime.getTime() - now.getTime()
    
    if (diff <= 0) return 'Available now'
    
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }, [])

  // Calculate next daily warm-up time (next day at 6 AM)
  const calculateNextWarmUpTime = (completedToday: boolean) => {
    const now = new Date()
    if (!completedToday) {
      return now
    }
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    tomorrow.setHours(6, 0, 0, 0)
    return tomorrow
  }

  // OPTIMIZATION: Pending promise cache to prevent duplicate API calls
  const pendingRehabCheck = useRef<Promise<void> | null>(null)
  const pendingDashboardLoad = useRef<Promise<void> | null>(null)
  const pendingStreakLoad = useRef<Promise<void> | null>(null)

  // Fetch streak data
  const loadStreakData = useCallback(async () => {
    // OPTIMIZATION: Return pending promise if already in progress
    if (pendingStreakLoad.current) {
      return pendingStreakLoad.current
    }

    const promise = (async () => {
      try {
        const result = await apiClient.get<{
          currentStreak: number
          longestStreak: number
          todayCheckInCompleted: boolean
          nextMilestone: number | null
          daysUntilNextMilestone: number | null
          hasSevenDayBadge: boolean
          totalScheduledDays: number
          pastScheduledDays: number
          completedDays: number
          missedScheduleDates?: string[]
          missedScheduleCount?: number
          exceptionDates?: Array<{ date: string; exception_type: string; reason: string | null }>
          nextCheckInDate: string | null
          nextCheckInDateFormatted: string | null
          badge: {
            name: string
            description: string
            icon: string
            achieved: boolean
            achievedDate: string
          } | null
        }>(API_ROUTES.WORKER.STREAK)

        if (isApiError(result)) {
          console.error('[WorkerDashboard] Error loading streak data:', getApiErrorMessage(result))
          // Keep default values on error
          return
        }

        setStreakData(result.data)
      } catch (error) {
        console.error('[WorkerDashboard] Error loading streak data:', error)
        // Keep default values on error
      } finally {
        pendingStreakLoad.current = null
      }
    })()

    pendingStreakLoad.current = promise
    return promise
  }, [])

  // Check if worker has active rehabilitation plan and get next warm-up time
  const checkActiveRehabPlan = useCallback(async () => {
    // OPTIMIZATION: Return pending promise if already in progress
    if (pendingRehabCheck.current) {
      return pendingRehabCheck.current
    }
    
    // Prevent concurrent calls
    if (recoveryPlanCheckInProgress.current) return
    recoveryPlanCheckInProgress.current = true
    
    const promise = (async () => {
      try {
        const result = await apiClient.get<{ plan: any }>(API_ROUTES.CHECKINS.REHABILITATION_PLAN)

      if (isApiError(result)) {
        setHasActiveRehabPlan(false)
        setRehabPlanStatus(null)
        setRecoveryPlanDayCompleted(false)
        setNextWarmUpTime(null)
        return
      }

      const data = result.data
      const hasPlan = !!data.plan
      setHasActiveRehabPlan(hasPlan)
      
      // Store plan status if available
      if (data.plan?.status) {
        setRehabPlanStatus(data.plan.status)
      } else {
        setRehabPlanStatus(null)
      }
      
      // Reset recovery plan day completed if no plan
      if (!hasPlan) {
        setRecoveryPlanDayCompleted(false)
        setNextWarmUpTime(null)
        recoveryPlanCheckInProgress.current = false
        return
      }
      
      // If there's a plan, check if current day is completed to calculate next warm-up time
      if (hasPlan && data.plan) {
        const plan = data.plan
        
        // Check if current day exercises are all completed
        try {
          const startParts = plan.startDate.split('T')[0].split('-')
          const start = new Date(
            parseInt(startParts[0]),
            parseInt(startParts[1]) - 1,
            parseInt(startParts[2])
          )
          start.setHours(0, 0, 0, 0)
          
          const currentDayDate = new Date(start)
          currentDayDate.setDate(start.getDate() + (plan.currentDay - 1))
          const currentDayDateStr = `${currentDayDate.getFullYear()}-${String(currentDayDate.getMonth() + 1).padStart(2, '0')}-${String(currentDayDate.getDate()).padStart(2, '0')}`
          
          // Check completions for current day
          const completionsResult = await apiClient.get<{ completed_exercise_ids: string[] }>(
            `${API_ROUTES.CHECKINS.REHABILITATION_PLAN_COMPLETIONS}?plan_id=${plan.id}&date=${currentDayDateStr}`
          )
          
          if (!isApiError(completionsResult)) {
            const completionsData = completionsResult.data
            const completedSet = new Set(completionsData.completed_exercise_ids || [])
            const allExercisesCompleted = completedSet.size === plan.exercises.length && plan.exercises.length > 0
            
            // If all exercises completed for current day, next warm-up is 6 AM next day
            if (allExercisesCompleted) {
              setRecoveryPlanDayCompleted(true)
              const nextDayDate = new Date(currentDayDate)
              nextDayDate.setDate(currentDayDate.getDate() + 1)
              nextDayDate.setHours(6, 0, 0, 0) // 6:00 AM of next day
              setNextWarmUpTime(nextDayDate)
            } else {
              setRecoveryPlanDayCompleted(false)
              // If recovery plan day is not completed, we'll use warm-up completion status
              // But we need to wait for loadDashboardData to set hasWarmUp first
            }
          }
        } catch (err) {
          console.error('[WorkerDashboard] Error checking plan completions:', err)
        }
      }
      } catch (error) {
        console.error('[WorkerDashboard] Error checking rehabilitation plan:', error)
        setHasActiveRehabPlan(false)
        setRehabPlanStatus(null)
        setRecoveryPlanDayCompleted(false)
        setNextWarmUpTime(null)
      } finally {
        recoveryPlanCheckInProgress.current = false
        pendingRehabCheck.current = null
      }
    })()
    
    pendingRehabCheck.current = promise
    return promise
  }, [])

  // Load dashboard data - memoized because used in useEffect dependency
  const loadDashboardData = useCallback(async () => {
    // OPTIMIZATION: Return pending promise if already in progress
    if (pendingDashboardLoad.current) {
      return pendingDashboardLoad.current
    }
    
    const promise = (async () => {
      try {
        const result = await apiClient.get<any>(API_ROUTES.CHECKINS.DASHBOARD)

        if (isApiError(result)) {
          throw new Error(getApiErrorMessage(result) || 'Failed to load dashboard data')
        }

      const data = result.data

      // Set team info
      if (data.team?.displayName) {
        setTeamSite(data.team.displayName)
      } else {
        setTeamSite(null)
      }

      let warmUpCompleted = false

      // Set check-in status
      if (data.checkIn) {
        const checkInData = data.checkIn
        const hasTodayCheckIn = checkInData.hasCheckedIn || false
        warmUpCompleted = checkInData.warmUp?.completed || false

        setHasCheckedIn(hasTodayCheckIn)
        setHasActiveException(checkInData.hasActiveException || false)
        setExceptionInfo(checkInData.exception || null)
        setCheckInStatus({
          hasCheckedIn: hasTodayCheckIn,
          hasActiveException: checkInData.hasActiveException,
          exception: checkInData.exception,
          checkIn: checkInData.checkIn
        })
        setHasWarmUp(warmUpCompleted)

        // Progress will be recalculated in useEffect when all dependencies are available
        // But set initial value here for immediate display
        const warmUpCompletedForProgress = warmUpCompleted || recoveryPlanDayCompleted
        setTodayProgress(calculateProgress(hasTodayCheckIn, warmUpCompletedForProgress, hasActiveRehabPlan, checkInData.hasActiveException || false))
      } else {
        setHasCheckedIn(false)
        setHasWarmUp(false)
        // If no check-in, progress is 0 regardless of rehab plan
        setTodayProgress(0)
      }

      // Set shift info
      if (data.shift) {
        let workerHasSchedule = false
        // Today's schedule
        if (data.shift.today) {
          const hasSchedule = data.shift.today.scheduleSource === 'team_leader'
          workerHasSchedule = workerHasSchedule || hasSchedule
          setTodayShiftInfo(data.shift.today)
        } else {
          setTodayShiftInfo(null)
        }
        
        // Next shift info
        if (data.shift.next) {
          if (data.shift.next.hasShift) {
            workerHasSchedule = true
          }
          setNextShiftInfo(data.shift.next)
        } else {
          setNextShiftInfo(null)
        }
        setHasAssignedSchedule(workerHasSchedule)
      } else {
        setHasAssignedSchedule(false)
        setTodayShiftInfo(null)
        setNextShiftInfo(null)
      }

      // Set next warm-up time based on warm-up completion
      // Only set if recovery plan check is not in progress and day is not completed
      // Recovery plan check will override this if day is completed
      // If recovery plan day is not completed, use warm-up completion status
      // Only set if there's an active rehab plan
      if (hasActiveRehabPlan && !recoveryPlanCheckInProgress.current && !recoveryPlanDayCompleted) {
        const calculatedTime = calculateNextWarmUpTime(warmUpCompleted)
        setNextWarmUpTime(calculatedTime)
      } else if (!hasActiveRehabPlan) {
        // Clear next warm-up time if no active plan
        setNextWarmUpTime(null)
      }
    } catch (error) {
      console.error('[WorkerDashboard] Error loading dashboard data:', error)
      setTeamSite(null)
      setHasCheckedIn(false)
      setHasWarmUp(false)
      setTodayProgress(0)
        setHasAssignedSchedule(false)
        setTodayShiftInfo(null)
        setNextShiftInfo(null)
        setNextWarmUpTime(calculateNextWarmUpTime(false))
      } finally {
        pendingDashboardLoad.current = null
      }
    })()
    
    pendingDashboardLoad.current = promise
    return promise
  }, [])

  // OPTIMIZATION: Single initialization effect - run ONCE only
  useEffect(() => {
    if (!user) return

    const displayName = first_name || full_name || user?.email?.split('@')[0] || 'User'
    setUserName(displayName)
    
    let isMounted = true
    let isInitialized = false
    
    // Initialize data ONCE
    const initializeData = async () => {
      if (!isMounted || isInitialized) return
      isInitialized = true
      
      // OPTIMIZATION: Fetch all in parallel
      await Promise.all([
        checkActiveRehabPlan(),
        loadDashboardData(),
        loadStreakData()
      ])
      
      // Mark data as loaded after all fetches complete
      if (isMounted) {
        setIsDataLoaded(true)
      }
    }
    
    // Run immediately, no delay needed
    initializeData()
    
    // Only refresh on visibility change if user went to recovery plan and came back
    const handleVisibilityChange = () => {
      if (!isMounted) return
      if (document.visibilityState === 'visible' && isInitialized) {
        // Only refresh if page was already initialized (prevents double load)
        Promise.all([
          checkActiveRehabPlan(),
          loadDashboardData(),
          loadStreakData()
        ])
      }
    }

    // Also refresh when window receives focus (when user navigates back)
    const handleFocus = () => {
      if (!isMounted) return
      if (isInitialized) {
        // Refresh data when user returns to the page
        Promise.all([
          checkActiveRehabPlan(),
          loadDashboardData(),
          loadStreakData()
        ])
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    
    return () => {
      isMounted = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [user]) // ONLY depend on user, nothing else to prevent re-runs

  // Update next warm-up time when warm-up completion status changes
  // Priority: Recovery plan day completion > Warm-up completion > Available now
  useEffect(() => {
    // Don't update if recovery plan check is in progress
    if (recoveryPlanCheckInProgress.current) return
    
    // If no active rehab plan, clear next warm-up time
    if (!hasActiveRehabPlan) {
      setNextWarmUpTime(null)
      return
    }
    
    // If recovery plan day is completed, don't override (it's already set by checkActiveRehabPlan)
    if (recoveryPlanDayCompleted) return
    
    // Otherwise, use warm-up completion status
    const calculatedTime = calculateNextWarmUpTime(hasWarmUp)
    setNextWarmUpTime(calculatedTime)
  }, [hasWarmUp, recoveryPlanDayCompleted, hasActiveRehabPlan])

  // Memoize warm-up completion status (combines daily warm-up and recovery plan day completion)
  const isWarmUpCompleted = useMemo(() => {
    return hasWarmUp || recoveryPlanDayCompleted
  }, [hasWarmUp, recoveryPlanDayCompleted])

  // Recalculate progress whenever warm-up, check-in, rehab plan, exception, or recovery plan day completion changes
  useEffect(() => {
    const newProgress = calculateProgress(hasCheckedIn, isWarmUpCompleted, hasActiveRehabPlan, hasActiveException)
    setTodayProgress(newProgress)
  }, [hasCheckedIn, isWarmUpCompleted, hasActiveRehabPlan, hasActiveException])

  const handleStartWarmUp = () => {
    // Navigate to recovery plan page
    navigate('/dashboard/worker/recovery-plan')
  }

  // Check if next check-in is in the future
  const isNextCheckInInFuture = useMemo(() => {
    if (!nextShiftInfo || !nextShiftInfo.date) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const nextDate = new Date(nextShiftInfo.date)
    nextDate.setHours(0, 0, 0, 0)
    return nextDate > today
  }, [nextShiftInfo])

  const handleCompleteCheckIn = () => {
    // Prevent navigation if already checked in
    if (hasCheckedIn) {
      return
    }
    
    // Check if there's a schedule for TODAY (not just any future schedule)
    const hasTodaySchedule = todayShiftInfo && 
                            todayShiftInfo.scheduleSource === 'team_leader' && 
                            todayShiftInfo.hasShift
    
    // If no schedule for today, show modal (don't navigate)
    if (!hasTodaySchedule) {
      // Show modal if there's a future schedule, otherwise it will show "no schedule"
      if (nextShiftInfo && nextShiftInfo.date) {
        setShowNoScheduleModal(true)
        return
      }
      // Even if no future schedule, show modal
      setShowNoScheduleModal(true)
      return
    }
    
    // Navigate to daily check-in page only if there's a schedule for today
    navigate(PROTECTED_ROUTES.WORKER.DAILY_CHECKIN)
  }

  const handleReportIncident = () => {
    navigate('/dashboard/worker/report-incident')
  }

  const handleViewAccidents = () => {
    navigate(PROTECTED_ROUTES.WORKER.MY_ACCIDENTS)
  }

  return (
    <DashboardLayout>
      <div className="worker-dashboard">
        {/* Header */}
        <header className="worker-header">
        <div className="worker-header-left">
          <h1 className="worker-welcome">Welcome back, {userName}</h1>
          <p className="worker-subtitle">
            {business_name ? `${business_name} • ${teamSite || 'No team assigned'}` : (teamSite || 'No team assigned')}
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="worker-main">
        <div className="worker-container">
          {/* Today's Progress Card */}
            <div className="worker-card worker-progress-card">
            <h2 className="worker-card-title">Today's Progress</h2>
            <p className="worker-card-subtitle">
              {todayProgress === 100 
                ? "🎉 Excellent! You've completed everything today!" 
                : todayProgress === 50
                ? hasActiveRehabPlan
                  ? "Keep up the great work! Complete your warm-up to reach 100%."
                  : "Keep up the great work! One more task to complete."
                : hasCheckedIn && !hasActiveRehabPlan
                ? "Great! You've completed your check-in."
                : "Start your day by completing your check-in!"}
            </p>
            <div className="worker-progress-wrapper">
              <div className="worker-progress-bar">
                <div 
                  className="worker-progress-fill" 
                  style={{ width: `${todayProgress}%` }}
                ></div>
              </div>
              <span className="worker-progress-text">{todayProgress}% Complete</span>
            </div>
            <div style={{ 
              marginTop: '16px', 
              display: 'flex', 
              gap: '16px', 
              fontSize: '13px',
              color: '#6b7280'
            }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px',
                color: hasCheckedIn ? '#10b981' : '#9ca3af'
              }}>
                {hasCheckedIn ? '✓' : '○'}
                <span>Check-In</span>
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px',
                color: isWarmUpCompleted ? '#10b981' : '#9ca3af'
              }}>
                {isWarmUpCompleted ? '✓' : '○'}
                <span>Warm-Up</span>
              </div>
            </div>
          </div>

          {/* Streak Card */}
          <div className="worker-card worker-streak-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h2 className="worker-card-title">
                <span style={{ fontSize: '24px', marginRight: '8px' }}>🔥</span>
                Check-In Streak
              </h2>
              {streakData.hasSevenDayBadge && streakData.badge && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  backgroundColor: '#fef3c7',
                  borderRadius: '20px',
                  border: '2px solid #fbbf24'
                }}>
                  <span style={{ fontSize: '20px' }}>{streakData.badge.icon}</span>
                  <span style={{ 
                    fontSize: '12px', 
                    fontWeight: '600', 
                    color: '#92400e',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    {streakData.badge.name}
                  </span>
                </div>
              )}
            </div>
            
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '12px' }}>
              <span style={{ 
                fontSize: '48px', 
                fontWeight: '700', 
                color: streakData.currentStreak > 0 ? '#f59e0b' : '#6b7280',
                lineHeight: '1'
              }}>
                {streakData.currentStreak}
              </span>
              <span style={{ 
                fontSize: '18px', 
                color: '#6b7280',
                fontWeight: '500'
              }}>
                {streakData.currentStreak === 1 ? 'day' : 'days'}
              </span>
            </div>

            {/* Next Check-In Date */}
            {streakData.nextCheckInDateFormatted && (
              <div style={{ 
                marginBottom: '16px',
                padding: '12px',
                backgroundColor: '#f0f9ff',
                borderRadius: '8px',
                border: '1px solid #bae6fd'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '16px' }}>📅</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#0369a1' }}>
                    Next Check-In
                  </span>
                </div>
                <p style={{ 
                  margin: '0',
                  fontSize: '14px',
                  color: '#0c4a6e',
                  fontWeight: '500'
                }}>
                  {streakData.nextCheckInDateFormatted}
                </p>
              </div>
            )}

            {/* Progress indicator - show progress towards total scheduled days (matching executive format) */}
            {streakData.totalScheduledDays > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: '6px'
                }}>
                  <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500' }}>
                    Progress to total scheduled days ({streakData.totalScheduledDays} days)
                  </span>
                  <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>
                    {streakData.completedDays} / {streakData.totalScheduledDays} days
                    {streakData.totalScheduledDays > 0 && (
                      <span style={{ marginLeft: '8px', color: '#374151' }}>
                        {Math.round((streakData.completedDays / streakData.totalScheduledDays) * 100)}%
                      </span>
                    )}
                  </span>
                </div>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: '#f1f3f5',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${Math.min((streakData.completedDays / streakData.totalScheduledDays) * 100, 100)}%`,
                    height: '100%',
                    backgroundColor: streakData.completedDays > 0 ? '#f59e0b' : '#d1d5db',
                    borderRadius: '4px',
                    transition: 'width 0.3s ease'
                  }}></div>
                </div>
                {streakData.pastScheduledDays > 0 && (
                  <div style={{
                    marginTop: '4px',
                    fontSize: '11px',
                    color: '#9ca3af',
                    fontStyle: 'italic'
                  }}>
                    {streakData.pastScheduledDays} past days, {streakData.totalScheduledDays - streakData.pastScheduledDays} future days
                  </div>
                )}
              </div>
            )}

            {/* Next milestone indicator (7-day, 14-day, etc.) */}
            {streakData.nextMilestone && streakData.nextMilestone > streakData.currentStreak && streakData.totalScheduledDays === 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: '6px'
                }}>
                  <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500' }}>
                    Progress to {streakData.nextMilestone}-day milestone
                  </span>
                  <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>
                    {streakData.currentStreak} / {streakData.nextMilestone}
                  </span>
                </div>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: '#f1f3f5',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${(streakData.currentStreak / streakData.nextMilestone) * 100}%`,
                    height: '100%',
                    backgroundColor: streakData.currentStreak > 0 ? '#f59e0b' : '#d1d5db',
                    borderRadius: '4px',
                    transition: 'width 0.3s ease'
                  }}></div>
                </div>
              </div>
            )}

            <p style={{ 
              margin: '0 0 16px 0',
              fontSize: '14px',
              color: '#6b7280'
            }}>
              {streakData.currentStreak === 0 
                ? streakData.totalScheduledDays > 0
                  ? `Start your streak! You have ${streakData.totalScheduledDays} scheduled ${streakData.totalScheduledDays === 1 ? 'day' : 'days'} from your team leader.`
                  : "Start your streak by completing your check-in today!"
                : streakData.currentStreak >= 7
                ? `Amazing! You've maintained a ${streakData.currentStreak}-day streak! 🎉`
                : streakData.totalScheduledDays > 0
                ? `Great progress! ${streakData.completedDays} of ${streakData.totalScheduledDays} scheduled ${streakData.totalScheduledDays === 1 ? 'day' : 'days'} completed.`
                : streakData.nextMilestone
                ? `Keep going! ${streakData.daysUntilNextMilestone} more ${streakData.daysUntilNextMilestone === 1 ? 'day' : 'days'} until your ${streakData.nextMilestone}-day milestone!`
                : "Keep up the great work!"}
            </p>

            {streakData.longestStreak > streakData.currentStreak && (
              <p style={{ 
                margin: '0',
                fontSize: '13px',
                color: '#9ca3af',
                fontStyle: 'italic'
              }}>
                Your longest streak: {streakData.longestStreak} {streakData.longestStreak === 1 ? 'day' : 'days'}
              </p>
            )}

            {streakData.hasSevenDayBadge && streakData.badge && (
              <div style={{
                marginTop: '16px',
                padding: '12px',
                backgroundColor: '#fef3c7',
                borderRadius: '8px',
                border: '1px solid #fde68a'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '18px' }}>{streakData.badge.icon}</span>
                  <span style={{ 
                    fontSize: '13px', 
                    fontWeight: '600', 
                    color: '#92400e'
                  }}>
                    {streakData.badge.name} Achieved!
                  </span>
                </div>
                <p style={{ 
                  margin: '0',
                  fontSize: '12px',
                  color: '#78350f'
                }}>
                  {streakData.badge.description}
                </p>
              </div>
            )}
          </div>

          {/* Daily Tasks Grid */}
          <div className="worker-tasks-grid">
            {/* Daily Warm-Up Card */}
            <div className="worker-card worker-task-card">
              <div className="worker-task-header">
                <div className="worker-task-icon worker-icon-play">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="8 5 19 12 8 19 8 5"/>
                  </svg>
                </div>
                <div className="worker-task-info">
                  <h3 className="worker-task-title">Daily Warm-Up</h3>
                  {nextWarmUpTime && hasActiveRehabPlan && rehabPlanStatus === 'active' && (
                    <p style={{ 
                      fontSize: '12px', 
                      color: '#64748B', 
                      margin: '4px 0 0 0',
                      fontWeight: '400'
                    }}>
                      Next warm-up: {formatNextWarmUpTime(nextWarmUpTime)} {timeUntilNext && `(${timeUntilNext})`}
                    </p>
                  )}
                </div>
              </div>
              <button 
                onClick={handleStartWarmUp}
                disabled={!isDataLoaded || !hasActiveRehabPlan}
                className="worker-btn worker-btn-primary worker-btn-large"
                style={!isDataLoaded || !hasActiveRehabPlan ? {
                  opacity: 0.5,
                  cursor: 'not-allowed'
                } : isWarmUpCompleted ? {
                  opacity: 0.9,
                  backgroundColor: '#e5e7eb',
                  color: '#6b7280'
                } : {}}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="8 5 19 12 8 19 8 5"/>
                </svg>
                {!isDataLoaded ? 'Loading...' : isWarmUpCompleted ? 'Already Completed' : 'Start Warm-Up'}
              </button>
            </div>

            {/* Daily Check-In Card */}
            <div className="worker-card worker-task-card">
              <div className="worker-task-header">
                <div className="worker-task-icon worker-icon-checkin">
                  {hasActiveException ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></path>
                    </svg>
                  ) : hasCheckedIn ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="9 12 11 14 15 10"></polyline>
                    </svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  )}
                </div>
                <div className="worker-task-info">
                  <h3 className="worker-task-title">Daily Check-In</h3>
                  {hasActiveException && exceptionInfo ? (
                    <p className="worker-task-desc" style={{ color: '#f59e0b' }}>
                      ⚠️ Exception Active • {exceptionInfo.exception_type?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Exception'}
                      {exceptionInfo.case_status && (
                        <span style={{ 
                          fontSize: '0.85em', 
                          display: 'block', 
                          marginTop: '4px',
                          fontWeight: 600,
                          color: getCaseStatusColor(exceptionInfo.case_status)
                        }}>
                          Case Status: {getCaseStatusLabel(exceptionInfo.case_status)}
                        </span>
                      )}
                      {exceptionInfo.reason && (
                        <span style={{ fontSize: '0.85em', display: 'block', marginTop: '4px' }}>
                          {exceptionInfo.reason}
                        </span>
                      )}
                    </p>
                  ) : hasCheckedIn && checkInStatus?.checkIn ? (
                    <>
                    <p className="worker-task-desc" style={{ color: '#10b981' }}>
                      ✓ Already checked in today • {checkInStatus.checkIn.predicted_readiness || 'Completed'}
                      {checkInStatus.checkIn.check_in_time && (
                        <span style={{ fontSize: '0.85em', marginLeft: '8px' }}>
                          at {checkInStatus.checkIn.check_in_time}
                        </span>
                      )}
                    </p>
                      {todayShiftInfo && todayShiftInfo.scheduleSource !== 'none' && todayShiftInfo.checkInWindow?.windowStart && todayShiftInfo.checkInWindow?.windowEnd && (
                        <p className="worker-task-desc" style={{ color: '#6b7280', marginTop: '4px', fontSize: '0.85em' }}>
                          {todayShiftInfo.shiftStart && todayShiftInfo.shiftEnd ? (
                            <span>
                              Shift: {formatTime(todayShiftInfo.shiftStart) || todayShiftInfo.shiftStart} - {formatTime(todayShiftInfo.shiftEnd) || todayShiftInfo.shiftEnd} • Check-in window: {formatTime(todayShiftInfo.checkInWindow.windowStart) || todayShiftInfo.checkInWindow.windowStart} - {formatTime(todayShiftInfo.checkInWindow.windowEnd) || todayShiftInfo.checkInWindow.windowEnd}
                            </span>
                          ) : (
                            <span>
                              Check-in window: {formatTime(todayShiftInfo.checkInWindow.windowStart) || todayShiftInfo.checkInWindow.windowStart} - {formatTime(todayShiftInfo.checkInWindow.windowEnd) || todayShiftInfo.checkInWindow.windowEnd}
                            </span>
                          )}
                        </p>
                      )}
                      {hasCheckedIn && nextShiftInfo?.hasShift && nextShiftInfo.date && (
                        <p className="worker-task-desc" style={{ color: '#3b82f6', marginTop: '8px', fontSize: '0.9em' }}>
                          📅 Next Check-In: {nextShiftInfo.formattedDate || (nextShiftInfo.dayName ? `${nextShiftInfo.dayName}, ` : '') + new Date(nextShiftInfo.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {nextShiftInfo.shiftStart && nextShiftInfo.shiftEnd && (
                            <span style={{ fontSize: '0.85em', display: 'block', marginTop: '4px', color: '#525252' }}>
                              {formatTime(nextShiftInfo.shiftStart) || nextShiftInfo.shiftStart} - {formatTime(nextShiftInfo.shiftEnd) || nextShiftInfo.shiftEnd}
                              {nextShiftInfo.checkInWindow?.windowStart && nextShiftInfo.checkInWindow?.windowEnd && (
                                <span style={{ marginLeft: '8px' }}>
                                  (Check-in window: {formatTime(nextShiftInfo.checkInWindow.windowStart) || nextShiftInfo.checkInWindow.windowStart} - {formatTime(nextShiftInfo.checkInWindow.windowEnd) || nextShiftInfo.checkInWindow.windowEnd})
                                </span>
                              )}
                            </span>
                          )}
                        </p>
                      )}
                    </>
                  ) : hasAssignedSchedule && todayShiftInfo?.hasShift ? (
                    <>
                      <p className="worker-task-desc">
                        How are you feeling? • 15 seconds
                        {todayShiftInfo.shiftStart && todayShiftInfo.shiftEnd && (
                          <span style={{ fontSize: '0.85em', display: 'block', marginTop: '4px', color: '#6b7280' }}>
                            Shift: {formatTime(todayShiftInfo.shiftStart) || todayShiftInfo.shiftStart} - {formatTime(todayShiftInfo.shiftEnd) || todayShiftInfo.shiftEnd}
                            {todayShiftInfo.checkInWindow?.windowStart && todayShiftInfo.checkInWindow?.windowEnd && (
                              <span style={{ marginLeft: '8px' }}>
                                (Check-in window: {formatTime(todayShiftInfo.checkInWindow.windowStart) || todayShiftInfo.checkInWindow.windowStart} - {formatTime(todayShiftInfo.checkInWindow.windowEnd) || todayShiftInfo.checkInWindow.windowEnd})
                              </span>
                            )}
                          </span>
                        )}
                      </p>
                      {hasCheckedIn && nextShiftInfo?.hasShift && nextShiftInfo.date && (
                        <p className="worker-task-desc" style={{ color: '#3b82f6', marginTop: '8px', fontSize: '0.9em' }}>
                          📅 Next Check-In: {nextShiftInfo.formattedDate || (nextShiftInfo.dayName ? `${nextShiftInfo.dayName}, ` : '') + new Date(nextShiftInfo.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {nextShiftInfo.shiftStart && nextShiftInfo.shiftEnd && (
                            <span style={{ fontSize: '0.85em', display: 'block', marginTop: '4px', color: '#525252' }}>
                              {formatTime(nextShiftInfo.shiftStart) || nextShiftInfo.shiftStart} - {formatTime(nextShiftInfo.shiftEnd) || nextShiftInfo.shiftEnd}
                              {nextShiftInfo.checkInWindow?.windowStart && nextShiftInfo.checkInWindow?.windowEnd && (
                                <span style={{ marginLeft: '8px' }}>
                                  (Check-in window: {formatTime(nextShiftInfo.checkInWindow.windowStart) || nextShiftInfo.checkInWindow.windowStart} - {formatTime(nextShiftInfo.checkInWindow.windowEnd) || nextShiftInfo.checkInWindow.windowEnd})
                                </span>
                              )}
                            </span>
                          )}
                        </p>
                      )}
                    </>
                  ) : hasCheckedIn && nextShiftInfo?.hasShift && nextShiftInfo.date ? (
                    <p className="worker-task-desc" style={{ color: '#3b82f6' }}>
                      📅 Next Check-In: {nextShiftInfo.formattedDate || (nextShiftInfo.dayName ? `${nextShiftInfo.dayName}, ` : '') + new Date(nextShiftInfo.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {nextShiftInfo.shiftStart && nextShiftInfo.shiftEnd && (
                        <span style={{ fontSize: '0.85em', display: 'block', marginTop: '4px', color: '#525252' }}>
                          {formatTime(nextShiftInfo.shiftStart) || nextShiftInfo.shiftStart} - {formatTime(nextShiftInfo.shiftEnd) || nextShiftInfo.shiftEnd}
                          {nextShiftInfo.checkInWindow?.windowStart && nextShiftInfo.checkInWindow?.windowEnd && (
                            <span style={{ marginLeft: '8px' }}>
                              (Check-in window: {formatTime(nextShiftInfo.checkInWindow.windowStart) || nextShiftInfo.checkInWindow.windowStart} - {formatTime(nextShiftInfo.checkInWindow.windowEnd) || nextShiftInfo.checkInWindow.windowEnd})
                            </span>
                          )}
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="worker-task-desc" style={{ color: '#ef4444' }}>
                      ⚠️ No schedule assigned • Contact Team Leader
                    </p>
                  )}
                </div>
              </div>
              {hasActiveException ? (
                <button 
                  disabled
                  className="worker-btn worker-btn-secondary worker-btn-large"
                  style={{ 
                    opacity: 0.6, 
                    cursor: 'not-allowed',
                    backgroundColor: '#fef3c7',
                    color: '#92400e',
                    borderColor: '#f59e0b'
                  }}
                  title={`Exception active: ${exceptionInfo?.exception_type || 'Unknown'}. Check-in not required.`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  </svg>
                  Exception Active
                </button>
              ) : !hasAssignedSchedule ? (
                <button 
                  disabled
                  className="worker-btn worker-btn-secondary worker-btn-large"
                  style={{ 
                    opacity: 0.6, 
                    cursor: 'not-allowed',
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                    borderColor: '#ef4444'
                  }}
                  title="No assigned schedule. Please contact your Team Leader to assign you a schedule."
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  No Schedule Assigned
                </button>
              ) : hasCheckedIn ? (
                <button 
                  disabled
                  className="worker-btn worker-btn-secondary worker-btn-large"
                  style={{ 
                    opacity: 0.6, 
                    cursor: 'not-allowed',
                    backgroundColor: '#e5e7eb',
                    color: '#6b7280'
                  }}
                  title="Already checked in today. Check-in again tomorrow."
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 11 12 14 22 4"></polyline>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                  </svg>
                  Already Checked In
                </button>
              ) : (
                <button 
                  onClick={handleCompleteCheckIn}
                  className="worker-btn worker-btn-secondary worker-btn-large"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  Complete Check-In
                </button>
              )}
            </div>
          </div>

          {/* No Schedule Modal */}
          {showNoScheduleModal && (
            <div className="worker-modal-overlay" onClick={() => setShowNoScheduleModal(false)}>
              <div className="worker-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="worker-modal-header">
                  <div className="worker-modal-icon">📅</div>
                  <h2 className="worker-modal-title">Daily Check-In</h2>
                </div>
                <div className="worker-modal-body">
                  {nextShiftInfo && nextShiftInfo.date ? (
                    <>
                      <p className="worker-modal-message">
                        You can't check in yet. Your next scheduled check-in is:
                      </p>
                      <div className="worker-modal-date">
                        {formatDateWithWeekday(nextShiftInfo.date)}
                      </div>
                      {nextShiftInfo.shiftStart && nextShiftInfo.shiftEnd && (
                        <div className="worker-modal-time">
                              {formatTime(nextShiftInfo.shiftStart) || nextShiftInfo.shiftStart} - {formatTime(nextShiftInfo.shiftEnd) || nextShiftInfo.shiftEnd}
                        </div>
                      )}
                      {nextShiftInfo.checkInWindow?.windowStart && nextShiftInfo.checkInWindow?.windowEnd && (
                        <div className="worker-modal-checkin-window">
                          Check-in window: {formatTime(nextShiftInfo.checkInWindow.windowStart) || nextShiftInfo.checkInWindow.windowStart} - {formatTime(nextShiftInfo.checkInWindow.windowEnd) || nextShiftInfo.checkInWindow.windowEnd}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="worker-modal-message">
                        You don't have a scheduled check-in for today.
                      </p>
                      <p className="worker-modal-message" style={{ marginTop: '12px', fontSize: '14px', color: '#64748B' }}>
                        Please contact your Team Leader to assign you a schedule.
                      </p>
                    </>
                  )}
                </div>
                <div className="worker-modal-footer">
                  <button
                    className="worker-modal-btn"
                    onClick={() => setShowNoScheduleModal(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Report Incident Card */}
          <div 
            className="worker-card worker-incident-card"
            onClick={handleReportIncident}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleReportIncident()
              }
            }}
            aria-label="Report Incident or Near-Miss"
          >
            <div className="worker-incident-header">
              <div className="worker-incident-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
                  <path d="M12 8v4m0 4h.01" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="worker-incident-info">
                <h3 className="worker-incident-title">Report Incident or Near-Miss</h3>
                <p className="worker-incident-desc">Quick 60-second report with photo</p>
              </div>
            </div>
            <button 
              onClick={(e) => {
                e.stopPropagation()
                handleReportIncident()
              }}
              className="worker-btn worker-btn-danger worker-btn-large"
            >
              Report Now
            </button>
          </div>

          {/* My Accidents Card */}
          <div 
            className="worker-card worker-task-card"
            onClick={handleViewAccidents}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleViewAccidents()
              }
            }}
            aria-label="View My Accidents"
          >
            <div className="worker-task-header">
              <div className="worker-task-icon" style={{ background: '#3B82F6' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
              </div>
              <div className="worker-task-info">
                <h3 className="worker-task-title">My Accidents</h3>
                <p className="worker-task-desc">View your accident and incident records</p>
              </div>
            </div>
            <button 
              onClick={(e) => {
                e.stopPropagation()
                handleViewAccidents()
              }}
              className="worker-btn worker-btn-primary worker-btn-large"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              View Records
            </button>
          </div>

        </div>
      </main>
      </div>
    </DashboardLayout>
  )
}


