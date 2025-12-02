import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { formatTime } from '../../../shared/date'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './DailyCheckIn.css'

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
  currentTime?: string
  isWithinWindow?: boolean
  isWithinRecommended?: boolean
  scheduleSource?: 'team_leader' | 'none' | 'flexible'
  requiresDailyCheckIn?: boolean
  date?: string
  dayName?: string
  formattedDate?: string
}

export function DailyCheckIn() {
  const navigate = useNavigate()
  const [painLevel, setPainLevel] = useState(0)
  const [fatigueLevel, setFatigueLevel] = useState(0)
  const [sleepQuality, setSleepQuality] = useState(7)
  const [stressLevel, setStressLevel] = useState(0)
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [shiftInfo, setShiftInfo] = useState<ShiftInfo | null>(null)
  const [loadingShiftInfo, setLoadingShiftInfo] = useState(true)
  const [loadingCheckInStatus, setLoadingCheckInStatus] = useState(true)
  const [hasAlreadyCheckedIn, setHasAlreadyCheckedIn] = useState(false)
  const [hasActiveException, setHasActiveException] = useState(false)
  const [exceptionInfo, setExceptionInfo] = useState<{
    exception_type?: string
    reason?: string
    start_date?: string
    end_date?: string
  } | null>(null)
  const [checkInTime, setCheckInTime] = useState<string | null>(null)
  const [predictedReadiness, setPredictedReadiness] = useState<string | null>(null)
  const [nextShiftInfo, setNextShiftInfo] = useState<ShiftInfo | null>(null)
  const [loadingNextShift, setLoadingNextShift] = useState(false)
  const [hasAssignedSchedule, setHasAssignedSchedule] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [showSuccessToast, setShowSuccessToast] = useState(false)

  // Calculate predicted readiness based on all factors
  const calculateReadiness = () => {
    // Lower values = better readiness
    // Sleep quality is inverted (higher hours = better)
    const totalScore = painLevel + fatigueLevel + stressLevel + (10 - Math.min(sleepQuality / 8 * 10, 10))
    
    if (totalScore <= 10) return { level: 'Green', color: '#10b981' }
    if (totalScore <= 20) return { level: 'Yellow', color: '#f59e0b' }
    return { level: 'Red', color: '#ef4444' }
  }

  const readiness = calculateReadiness()

  // Load next shift info
  const loadNextShiftInfo = async () => {
    try {
      setLoadingNextShift(true)
      setNextShiftInfo(null) // Clear old data first
      
      const result = await apiClient.get<ShiftInfo>(API_ROUTES.CHECKINS.NEXT_SHIFT_INFO)
      
      if (!isApiError(result)) {
        setNextShiftInfo(result.data)
      } else {
        setNextShiftInfo(null)
      }
    } catch (error) {
      console.error('Error loading next shift info:', error)
      setNextShiftInfo(null)
    } finally {
      setLoadingNextShift(false)
    }
  }

  // Check if already checked in today
  useEffect(() => {
    let isMounted = true
    const abortController = new AbortController()

    const checkStatus = async () => {
      try {
        // Reset state first to prevent showing old data
        if (isMounted) {
          setLoadingCheckInStatus(true)
          setHasAlreadyCheckedIn(false)
          setCheckInTime(null)
          setPredictedReadiness(null)
          setHasActiveException(false)
          setExceptionInfo(null)
        }

        const result = await apiClient.get<{
          hasCheckedIn: boolean
          checkIn?: { check_in_time?: string; predicted_readiness?: string }
          hasActiveException?: boolean
          exception?: any
        }>(API_ROUTES.CHECKINS.STATUS, {
          signal: abortController.signal,
        })
        
        if (!isMounted) return

        if (!isApiError(result)) {
          const data = result.data
          if (data.hasCheckedIn && data.checkIn) {
            if (isMounted) {
              setHasAlreadyCheckedIn(true)
              setCheckInTime(data.checkIn.check_in_time || null)
              setPredictedReadiness(data.checkIn.predicted_readiness || null)
              
              // Load next shift info when already checked in
              loadNextShiftInfo()
            }
          } else {
            if (isMounted) {
              setHasAlreadyCheckedIn(false)
              // Also load next shift info when not checked in to show modal if needed
              loadNextShiftInfo()
            }
          }

          if (data.hasActiveException && data.exception) {
            if (isMounted) {
              setHasActiveException(true)
              setExceptionInfo(data.exception)
            }
          } else {
            if (isMounted) {
              setHasActiveException(false)
              setExceptionInfo(null)
            }
          }
        }
      } catch (error: any) {
        if (error.name === 'AbortError') return
        if (isMounted) {
          console.error('Error checking check-in status:', error)
          // Reset state on error
          setHasAlreadyCheckedIn(false)
          setHasActiveException(false)
        }
      } finally {
        if (isMounted) {
          setLoadingCheckInStatus(false)
        }
      }
    }

    checkStatus()

    return () => {
      isMounted = false
      abortController.abort()
    }
  }, [])

  // Load shift info on component mount
  useEffect(() => {
    let isMounted = true
    const abortController = new AbortController()

    const loadShiftInfo = async () => {
      try {
        // Reset state first
        if (isMounted) {
          setLoadingShiftInfo(true)
          setShiftInfo(null)
        }

        const result = await apiClient.get<ShiftInfo>(API_ROUTES.CHECKINS.SHIFT_INFO, {
          signal: abortController.signal,
        })
        
        if (!isMounted) return

        if (!isApiError(result)) {
          const data = result.data
          if (isMounted) {
            setShiftInfo(data)
            // Check if worker has assigned schedule from team leader (only individual schedules, no fallback)
            const hasSchedule = data.scheduleSource === 'team_leader'
            setHasAssignedSchedule(hasSchedule)
          }
        } else {
          console.error('Failed to load shift info:', result.error.status, result.error)
          
          // If unauthorized, show a message but don't break the check-in flow
          if (result.error.status === 401 && isMounted) {
            console.warn('Not authenticated for shift info - check-in can still proceed')
            // Set default flexible schedule (no assigned schedule)
            setShiftInfo({
              hasShift: false,
              shiftType: 'flexible',
              checkInWindow: {
                windowStart: '05:00',
                windowEnd: '23:00',
                recommendedStart: '05:00',
                recommendedEnd: '23:00',
              },
              currentTime: new Date().toTimeString().slice(0, 5),
              isWithinWindow: true,
              isWithinRecommended: true,
              scheduleSource: 'flexible',
            })
            if (isMounted) {
              setHasAssignedSchedule(false)
            }
          }
        }
      } catch (error: any) {
        if (error.name === 'AbortError') return
        if (isMounted) {
          console.error('Error loading shift info:', error)
          // Set default flexible schedule on error (no assigned schedule)
          setShiftInfo({
            hasShift: false,
            shiftType: 'flexible',
            checkInWindow: {
              windowStart: '05:00',
              windowEnd: '23:00',
              recommendedStart: '05:00',
              recommendedEnd: '23:00',
            },
            currentTime: new Date().toTimeString().slice(0, 5),
            isWithinWindow: true,
            isWithinRecommended: true,
            scheduleSource: 'flexible',
          })
          setHasAssignedSchedule(false)
        }
      } finally {
        if (isMounted) {
          setLoadingShiftInfo(false)
        }
      }
    }

    loadShiftInfo()

    return () => {
      isMounted = false
      abortController.abort()
    }
  }, [])

  // Get day name (today or yesterday for check-in windows)
  const getDayName = (offset: number = 0): string => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const today = new Date()
    const targetDate = new Date(today)
    targetDate.setDate(today.getDate() + offset)
    return days[targetDate.getDay()]
  }

  // Format time with day indication if needed
  const formatTimeWithDay = (timeStr: string, isPreviousDay: boolean = false): string => {
    const time = formatTime(timeStr)
    if (isPreviousDay) {
      return `${getDayName(-1)} ${time}`
    }
    return time
  }

  // Check if check-in window spans previous day
  const checkInWindowSpansPreviousDay = (): boolean => {
    if (!shiftInfo?.checkInWindow) return false
    const { windowStart, windowEnd } = shiftInfo.checkInWindow
    const startHour = parseInt(windowStart.split(':')[0])
    const endHour = parseInt(windowEnd.split(':')[0])
    // If window starts late (after 8 PM) and ends early (before 6 AM), it spans previous day
    // Or if start hour is greater than end hour, it definitely spans midnight
    return (startHour > 20 && endHour < 6) || startHour > endHour
  }

  // Get shift type display name
  const getShiftTypeDisplay = (shiftType: string): string => {
    switch (shiftType) {
      case 'morning': return 'Morning Shift'
      case 'afternoon': return 'Afternoon Shift'
      case 'night': return 'Night Shift'
      default: return 'Flexible Schedule'
    }
  }

  // Get window status indicator
  const getWindowStatus = () => {
    if (!shiftInfo) return { text: 'Loading...', color: '#9ca3af', icon: '⏳' }
    
    if (shiftInfo.isWithinRecommended) {
      return { text: 'Check-in Available', color: '#10b981', icon: '✅' }
    } else if (shiftInfo.isWithinWindow) {
      return { text: 'Check-in Available (Late Window)', color: '#f59e0b', icon: '⚠️' }
    } else {
      return { text: 'Outside Check-in Window', color: '#ef4444', icon: '❌' }
    }
  }

  const windowStatus = getWindowStatus()

  const getSliderColor = (value: number, maxValue: number = 10, inverted: boolean = false) => {
    let percentage = (value / maxValue) * 100
    if (inverted) {
      percentage = 100 - percentage // For sleep: higher hours = better = green
    }
    if (percentage <= 30) return '#10b981' // Green
    if (percentage <= 60) return '#f59e0b' // Yellow/Orange
    return '#ef4444' // Red
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError(null)
    
    // Validate: Additional notes are required when "Not fit to work" (Red)
    if (readiness.level === 'Red' && (!additionalNotes || additionalNotes.trim() === '')) {
      setValidationError('Additional notes are required when you are not fit to work. Please explain your condition so your team leader can understand your situation.')
      return
    }
    
    try {
      // Send data in the format the backend expects (camelCase)
      const result = await apiClient.post<{ message: string; checkIn: any }>(
        API_ROUTES.CHECKINS.SUBMIT,
        {
          painLevel,
          fatigueLevel,
          sleepQuality,
          stressLevel,
          additionalNotes: additionalNotes.trim() || undefined,
          predictedReadiness: readiness.level,
        }
      )

      if (isApiError(result)) {
        alert(getApiErrorMessage(result) || 'Failed to submit check-in. Please try again.')
        return
      }

      // Show success toast
      setShowSuccessToast(true)
      
      // Auto-hide toast and redirect after 2 seconds
      setTimeout(() => {
        setShowSuccessToast(false)
        // Redirect to dashboard after toast animation
        setTimeout(() => {
          window.location.href = '/dashboard/worker'
        }, 300)
      }, 2000)
    } catch (error: any) {
      console.error('Check-in error:', error)
      alert('Failed to submit check-in. Please try again.')
    }
  }

  return (
    <div className="daily-checkin">
      <div className="checkin-header">
        <button 
          onClick={() => navigate(PROTECTED_ROUTES.WORKER.DASHBOARD)} 
          className="checkin-back-btn"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
      </div>

      <div className="checkin-container">
        <div className="checkin-title-section">
          <h1 className="checkin-title">Daily Check-In</h1>
          <p className="checkin-subtitle">Takes 15 seconds • Help us keep you safe</p>
        </div>

        {/* Loading Check-in Status */}
        {loadingCheckInStatus && (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#6b7280',
            fontSize: '14px',
          }}>
            <div style={{ fontSize: '24px', marginBottom: '12px' }}>⏳</div>
            Checking status...
          </div>
        )}

        {/* Active Exception Warning */}
        {!loadingCheckInStatus && hasActiveException && exceptionInfo && (
          <div className="checkin-already-submitted-card" style={{
            borderLeft: '4px solid #f59e0b',
            backgroundColor: '#fffbeb',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '24px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>⚠️</div>
            <h2 style={{ color: '#92400e', marginBottom: '8px', fontSize: '20px' }}>
              Exception Active - Check-In Not Required
            </h2>
            <p style={{ color: '#78350f', marginBottom: '8px', fontWeight: '600' }}>
              {exceptionInfo.exception_type?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Exception'}
            </p>
            {exceptionInfo.reason && (
              <p style={{ color: '#78350f', marginBottom: '12px' }}>
                {exceptionInfo.reason}
              </p>
            )}
            <p style={{ color: '#92400e', fontSize: '14px', marginBottom: '16px' }}>
              You are exempt from daily check-ins during this period.
            </p>
            <button
              onClick={() => navigate(PROTECTED_ROUTES.WORKER.DASHBOARD)}
              style={{
                padding: '10px 24px',
                backgroundColor: '#f59e0b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
              }}
            >
              Back to Dashboard
            </button>
          </div>
        )}

        {/* Already Checked In Warning */}
        {!loadingCheckInStatus && !hasActiveException && hasAlreadyCheckedIn && (
          <div>
            <div className="checkin-already-submitted-card" style={{
              borderLeft: '4px solid #10b981',
              backgroundColor: '#f0fdf4',
              padding: '20px',
              borderRadius: '8px',
              marginBottom: '16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>✓</div>
              <h2 style={{ color: '#065f46', marginBottom: '8px', fontSize: '20px' }}>
                Already Checked In Today
              </h2>
              <div style={{ 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                backgroundColor: 'white',
                marginBottom: '12px',
                fontSize: '13px',
                fontWeight: '500',
                color: predictedReadiness === 'Red' ? '#991b1b' : 
                       predictedReadiness === 'Yellow' ? '#92400e' : '#065f46'
              }}>
                {predictedReadiness === 'Red' ? '🔴' : predictedReadiness === 'Yellow' ? '🟡' : '🟢'}
                <span style={{ textTransform: 'uppercase' }}>
                  {predictedReadiness === 'Green' ? 'Fit to work' :
                   predictedReadiness === 'Yellow' ? 'Minor issue' :
                   predictedReadiness === 'Red' ? 'Not fit to work' :
                   'Unknown'}
                </span>
                {checkInTime && (
                  <span style={{ color: '#737373', marginLeft: '4px' }}>
                    at {formatTime(checkInTime)}
                  </span>
                )}
              </div>
              <p style={{ color: '#065f46', fontSize: '14px', marginBottom: '16px' }}>
                Great job! You've completed today's check-in.
              </p>
              <button
                onClick={() => navigate(PROTECTED_ROUTES.WORKER.DASHBOARD)}
                style={{
                  padding: '10px 24px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
              >
                Back to Dashboard
              </button>
            </div>

            {/* Next Schedule Info */}
            {loadingNextShift && (
              <div style={{
                padding: '16px',
                textAlign: 'center',
                color: '#6b7280',
                fontSize: '14px',
                marginBottom: '16px',
                borderLeft: '4px solid #dbeafe',
                backgroundColor: '#f8fafc',
                borderRadius: '8px',
              }}>
                Loading next schedule...
              </div>
            )}
            
            {!loadingNextShift && nextShiftInfo && (
              <div style={{
                borderLeft: '4px solid #3b82f6',
                backgroundColor: '#eff6ff',
                padding: '16px',
                borderRadius: '8px',
                marginBottom: '24px',
              }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  marginBottom: '12px',
                  color: '#1e40af',
                  fontSize: '15px',
                  fontWeight: '600'
                }}>
                  <span>📅</span>
                  <span>Next Check-In Schedule</span>
                </div>
                
                {nextShiftInfo.hasShift && nextShiftInfo.shiftStart && nextShiftInfo.shiftEnd ? (
                  <div>
                    <div style={{ 
                      marginBottom: '10px', 
                      padding: '10px',
                      backgroundColor: 'white',
                      borderRadius: '6px',
                      border: '1px solid #dbeafe'
                    }}>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        marginBottom: '4px',
                        color: '#0d0d0d',
                        fontSize: '13px',
                        fontWeight: '600'
                      }}>
                        <span>{nextShiftInfo.dayName || 'Next Day'}</span>
                        {nextShiftInfo.date && (
                          <>
                            <span style={{ color: '#737373', fontWeight: '400' }}>•</span>
                            <span style={{ 
                              color: '#525252', 
                              fontSize: '12px',
                              fontWeight: '400'
                            }}>
                              {new Date(nextShiftInfo.date).toLocaleDateString('en-US', { 
                                month: 'short', 
                                day: 'numeric', 
                                year: 'numeric' 
                              })}
                            </span>
                          </>
                        )}
                        <span style={{ color: '#737373', fontWeight: '400' }}>•</span>
                        <span style={{ fontWeight: '500' }}>
                          {formatTime(nextShiftInfo.shiftStart)} - {formatTime(nextShiftInfo.shiftEnd)}
                        </span>
                      </div>
                      <div style={{ 
                        color: '#737373', 
                        fontSize: '12px',
                        marginLeft: '0'
                      }}>
                        {getShiftTypeDisplay(nextShiftInfo.shiftType)}
                      </div>
                    </div>
                    
                    <div style={{ 
                      padding: '10px',
                      backgroundColor: 'white',
                      borderRadius: '6px',
                      border: '1px solid #dbeafe'
                    }}>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        marginBottom: '4px',
                        color: '#0d0d0d',
                        fontSize: '13px',
                        fontWeight: '600'
                      }}>
                        <span>⏰</span>
                        <span>Check-in Window</span>
                      </div>
                      <div style={{ 
                        color: '#525252', 
                        fontSize: '13px',
                        marginLeft: '28px',
                        lineHeight: '1.6'
                      }}>
                        {(() => {
                          const spansPrevDay = (() => {
                            if (!nextShiftInfo?.checkInWindow) return false
                            const { windowStart, windowEnd } = nextShiftInfo.checkInWindow
                            const startHour = parseInt(windowStart.split(':')[0])
                            const endHour = parseInt(windowEnd.split(':')[0])
                            return (startHour > 20 && endHour < 6) || startHour > endHour
                          })()
                          return (
                            <span style={{ fontWeight: '500' }}>
                              {spansPrevDay ? (
                                `${formatTimeWithDay(nextShiftInfo.checkInWindow.windowStart, true)} - ${formatTime(nextShiftInfo.checkInWindow.windowEnd)}`
                              ) : (
                                `${formatTime(nextShiftInfo.checkInWindow.windowStart)} - ${formatTime(nextShiftInfo.checkInWindow.windowEnd)}`
                              )}
                            </span>
                          )
                        })()}
                        <div style={{ 
                          color: '#3b82f6', 
                          marginTop: '4px',
                          fontSize: '12px'
                        }}>
                          Recommended: {formatTime(nextShiftInfo.checkInWindow.recommendedStart)} - {formatTime(nextShiftInfo.checkInWindow.recommendedEnd)}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ 
                    color: '#525252', 
                    fontSize: '13px',
                    padding: '10px',
                    backgroundColor: 'white',
                    borderRadius: '6px',
                    border: '1px solid #dbeafe'
                  }}>
                    <span style={{ fontWeight: '600', color: '#525252' }}>No scheduled shift</span>
                    <span style={{ marginLeft: '8px' }}>• Flexible check-in available</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* No Assigned Schedule Warning */}
        {!hasAlreadyCheckedIn && !loadingShiftInfo && !hasActiveException && shiftInfo && !hasAssignedSchedule && (
          <div className="checkin-shift-info-card" style={{
            borderLeft: '4px solid #ef4444',
            backgroundColor: '#fef2f2',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '24px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🚫</div>
            <h2 style={{ color: '#991b1b', marginBottom: '8px', fontSize: '20px', fontWeight: '600' }}>
              No Assigned Schedule
            </h2>
            <p style={{ color: '#7f1d1d', marginBottom: '12px', fontSize: '14px', lineHeight: '1.6' }}>
              You don't have an assigned schedule from your Team Leader for today.
            </p>
            <p style={{ color: '#991b1b', fontSize: '13px', marginBottom: '16px', fontWeight: '500' }}>
              Please contact your Team Leader to assign you a schedule before you can check in.
            </p>
            <button
              onClick={() => navigate(PROTECTED_ROUTES.WORKER.DASHBOARD)}
              style={{
                padding: '10px 24px',
                backgroundColor: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
              }}
            >
              Back to Dashboard
            </button>
          </div>
        )}

        {/* Shift Info Card - Only show if not already checked in AND has assigned schedule */}
        {!hasAlreadyCheckedIn && !loadingShiftInfo && shiftInfo && hasAssignedSchedule && (
          <div className="checkin-shift-info-card" style={{
            borderLeft: `4px solid ${windowStatus.color}`,
            backgroundColor: windowStatus.color === '#10b981' ? '#f0fdf4' : 
                            windowStatus.color === '#f59e0b' ? '#fffbeb' : '#fef2f2',
            padding: '16px',
            borderRadius: '8px',
            marginBottom: '24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '20px' }}>{windowStatus.icon}</span>
              <strong style={{ color: windowStatus.color, fontSize: '15px' }}>{windowStatus.text}</strong>
            </div>
            
            {shiftInfo.hasShift && shiftInfo.shiftStart && shiftInfo.shiftEnd && (
              <div style={{ 
                marginBottom: '10px', 
                padding: '10px',
                backgroundColor: 'white',
                borderRadius: '6px',
                border: '1px solid #e5e7eb'
              }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  marginBottom: '4px',
                  color: '#0d0d0d',
                  fontSize: '13px',
                  fontWeight: '600'
                }}>
                  <span>📅</span>
                  <span>{getDayName()}</span>
                  <span style={{ color: '#737373', fontWeight: '400' }}>•</span>
                  <span style={{ fontWeight: '500' }}>
                    {formatTime(shiftInfo.shiftStart)} - {formatTime(shiftInfo.shiftEnd)}
                  </span>
                </div>
                <div style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginLeft: '28px'
                }}>
                  <span style={{ 
                    color: '#737373', 
                    fontSize: '12px'
                }}>
                  {getShiftTypeDisplay(shiftInfo.shiftType)}
                  </span>
                  {shiftInfo.scheduleSource === 'team_leader' && (
                    <span style={{
                      fontSize: '11px',
                      color: '#3b82f6',
                      fontWeight: '500',
                      padding: '2px 6px',
                      backgroundColor: '#eff6ff',
                      borderRadius: '4px',
                    }}>
                      Assigned Schedule
                    </span>
                  )}
                </div>
              </div>
            )}
            
            <div style={{ 
              padding: '10px',
              backgroundColor: 'white',
              borderRadius: '6px',
              border: '1px solid #e5e7eb'
            }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                marginBottom: '4px',
                color: '#0d0d0d',
                fontSize: '13px',
                fontWeight: '600'
              }}>
                <span>⏰</span>
                <span>Check-in Window</span>
              </div>
              <div style={{ 
                color: '#525252', 
                fontSize: '13px',
                marginLeft: '28px',
                lineHeight: '1.6'
              }}>
                {(() => {
                  const spansPrevDay = checkInWindowSpansPreviousDay()
                  return (
                    <>
                      {spansPrevDay ? (
                        <>
                          <span style={{ fontWeight: '500' }}>
                            {formatTimeWithDay(shiftInfo.checkInWindow.windowStart, true)} - {formatTime(shiftInfo.checkInWindow.windowEnd)}
                          </span>
                        </>
                      ) : (
                        <span style={{ fontWeight: '500' }}>
                          {formatTime(shiftInfo.checkInWindow.windowStart)} - {formatTime(shiftInfo.checkInWindow.windowEnd)}
                        </span>
                      )}
                      {shiftInfo.isWithinWindow && !shiftInfo.isWithinRecommended && (
                        <div style={{ 
                          color: '#f59e0b', 
                          marginTop: '4px',
                          fontSize: '12px'
                        }}>
                          Recommended: {formatTime(shiftInfo.checkInWindow.recommendedStart)} - {formatTime(shiftInfo.checkInWindow.recommendedEnd)}
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>
            
            {!shiftInfo.hasShift && (
              <div style={{ 
                color: '#6b7280', 
                fontSize: '13px', 
                padding: '10px',
                backgroundColor: 'white',
                borderRadius: '6px',
                border: '1px solid #e5e7eb'
              }}>
                <span style={{ fontWeight: '600', color: '#525252' }}>No scheduled shift</span>
                <span style={{ marginLeft: '8px' }}>• Flexible check-in available</span>
              </div>
            )}
          </div>
        )}

        {!loadingCheckInStatus && !hasActiveException && !hasAlreadyCheckedIn && hasAssignedSchedule && (
        <form onSubmit={handleSubmit} className="checkin-form-card">
          <div className="checkin-section">
            <h2 className="checkin-section-title">How are you feeling today?</h2>
            <p className="checkin-instructions">
              Move the sliders to rate each area (0 = none, 10 = severe)
            </p>

            {/* Pain Level Slider */}
            <div className="checkin-slider-group">
              <div className="checkin-slider-header">
                <label className="checkin-slider-label">Pain Level</label>
                <span className="checkin-slider-value">{painLevel}/10</span>
              </div>
              <p className="checkin-slider-desc">Any aches or discomfort</p>
              <div className="checkin-slider-wrapper">
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={painLevel}
                  onChange={(e) => setPainLevel(Number(e.target.value))}
                  className="checkin-slider"
                  data-value={painLevel}
                  style={{
                    '--slider-color': getSliderColor(painLevel),
                    '--slider-percentage': `${(painLevel / 10) * 100}%`,
                  } as React.CSSProperties & { '--slider-color': string; '--slider-percentage': string }}
                />
              </div>
            </div>

            {/* Fatigue Level Slider */}
            <div className="checkin-slider-group">
              <div className="checkin-slider-header">
                <label className="checkin-slider-label">Fatigue Level</label>
                <span className="checkin-slider-value">{fatigueLevel}/10</span>
              </div>
              <p className="checkin-slider-desc">How tired do you feel</p>
              <div className="checkin-slider-wrapper">
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={fatigueLevel}
                  onChange={(e) => setFatigueLevel(Number(e.target.value))}
                  className="checkin-slider"
                  data-value={fatigueLevel}
                  style={{
                    '--slider-color': getSliderColor(fatigueLevel),
                    '--slider-percentage': `${(fatigueLevel / 10) * 100}%`,
                  } as React.CSSProperties & { '--slider-color': string; '--slider-percentage': string }}
                />
              </div>
            </div>

            {/* Sleep Quality Slider */}
            <div className="checkin-slider-group">
              <div className="checkin-slider-header">
                <label className="checkin-slider-label">Sleep Quality</label>
                <span className="checkin-slider-value">{sleepQuality} hours</span>
              </div>
              <p className="checkin-slider-desc">Hours of sleep last night</p>
              <div className="checkin-slider-wrapper">
                <input
                  type="range"
                  min="0"
                  max="12"
                  value={sleepQuality}
                  onChange={(e) => setSleepQuality(Number(e.target.value))}
                  className="checkin-slider"
                  data-value={sleepQuality}
                  style={{
                    '--slider-color': getSliderColor(sleepQuality, 12, true), // Inverted: more sleep = green
                    '--slider-percentage': `${(sleepQuality / 12) * 100}%`,
                  } as React.CSSProperties & { '--slider-color': string; '--slider-percentage': string }}
                />
              </div>
            </div>

            {/* Stress Level Slider */}
            <div className="checkin-slider-group">
              <div className="checkin-slider-header">
                <label className="checkin-slider-label">Stress Level</label>
                <span className="checkin-slider-value">{stressLevel}/10</span>
              </div>
              <p className="checkin-slider-desc">Work or personal stress</p>
              <div className="checkin-slider-wrapper">
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={stressLevel}
                  onChange={(e) => setStressLevel(Number(e.target.value))}
                  className="checkin-slider"
                  data-value={stressLevel}
                  style={{
                    '--slider-color': getSliderColor(stressLevel),
                    '--slider-percentage': `${(stressLevel / 10) * 100}%`,
                  } as React.CSSProperties & { '--slider-color': string; '--slider-percentage': string }}
                />
              </div>
            </div>

            {/* Additional Notes */}
            <div className="checkin-textarea-group">
              <label className="checkin-textarea-label">
                Additional Notes {readiness.level === 'Red' ? '*' : '(Optional)'}
              </label>
              <textarea
                value={additionalNotes}
                onChange={(e) => {
                  setAdditionalNotes(e.target.value)
                  if (validationError && e.target.value.trim() !== '') {
                    setValidationError(null)
                  }
                }}
                className={`checkin-textarea ${readiness.level === 'Red' && !additionalNotes.trim() ? 'required-field' : ''}`}
                placeholder={readiness.level === 'Red' ? 'Please explain why you are not fit to work (required)' : 'Any concerns or areas that need attention?'}
                rows={4}
                required={readiness.level === 'Red'}
              />
              {readiness.level === 'Red' && (
                <small className="field-help" style={{ color: '#ef4444', marginTop: '0.5rem', display: 'block' }}>
                  * Required: Please provide details about your condition for your team leader
                </small>
              )}
            </div>
            
            {validationError && (
              <div className="checkin-error-message" style={{ 
                background: '#fee2e2', 
                color: '#991b1b', 
                padding: '0.75rem 1rem', 
                borderRadius: '0.5rem', 
                marginTop: '0.5rem',
                borderLeft: '4px solid #dc2626'
              }}>
                {validationError}
              </div>
            )}
          </div>

          {/* Predicted Readiness */}
          <div className="checkin-readiness-section">
            <label className="checkin-readiness-label">Predicted Readiness</label>
            <div 
              className="checkin-readiness-value"
              style={{ color: readiness.color }}
            >
              {readiness.level === 'Green' ? 'Fit to work' : 
               readiness.level === 'Yellow' ? 'Minor issue' : 
               'Not fit to work'}
            </div>
          </div>

          {/* Submit Button */}
          <button 
            type="submit" 
            className="checkin-submit-btn"
            disabled={!hasAssignedSchedule}
            style={{
              opacity: hasAssignedSchedule ? 1 : 0.5,
              cursor: hasAssignedSchedule ? 'pointer' : 'not-allowed',
            }}
          >
            Submit Check-In
          </button>
        </form>
        )}

        {/* Success Toast Notification */}
        {showSuccessToast && (
          <div className="success-toast">
            <div className="success-toast-content">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Check-in submitted successfully!</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

