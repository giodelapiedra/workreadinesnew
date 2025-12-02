import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './RecoveryPlan.css'

interface Exercise {
  id: string
  exercise_name: string
  repetitions: string | null
  instructions: string | null
  video_url: string | null
  exercise_order: number
}

interface RehabilitationPlan {
  id: string
  plan_name: string
  plan_description: string
  duration: number
  startDate: string
  endDate: string
  progress: number
  currentDay: number
  daysCompleted: number
  totalDays: number
  exercises: Exercise[]
  status: string
}

export function RecoveryPlan() {
  const navigate = useNavigate()
  const [plan, setPlan] = useState<RehabilitationPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0)
  const [completing, setCompleting] = useState(false)
  const [completedExercisesToday, setCompletedExercisesToday] = useState<Set<string>>(new Set())
  const [dayCompleted, setDayCompleted] = useState(false)
  const [nextAvailableTime, setNextAvailableTime] = useState<Date | null>(null)
  const [canProceed, setCanProceed] = useState(true)
  const [, setTimeUpdate] = useState(0) // Force re-render to update time display

  useEffect(() => {
    fetchPlan()
  }, [])

  const fetchPlan = async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<{ plan: RehabilitationPlan }>(
        API_ROUTES.CHECKINS.REHABILITATION_PLAN
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch rehabilitation plan')
      }

      const data = result.data
      
      if (data.plan) {
        setPlan(data.plan)
        setCurrentExerciseIndex(0)
        // Check which exercises are completed for the current day
        // Only check for the current day that should be shown (considering 6 AM restriction)
        await checkCompletedExercisesForCurrentDay(data.plan.id, data.plan.exercises.length, data.plan.currentDay, data.plan.startDate)
      } else {
        setError('No active rehabilitation plan found')
      }
    } catch (err: any) {
      console.error('Error fetching plan:', err)
      setError(err.message || 'Failed to load rehabilitation plan')
    } finally {
      setLoading(false)
    }
  }

  // Format date as YYYY-MM-DD string (no timezone conversion) - consistent with backend
  const formatDateString = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const checkCompletedExercisesForCurrentDay = async (planId: string, totalExercises: number, currentDay: number, startDate: string) => {
    try {
      // Calculate the date for the current day of the plan
      // Day 1 = startDate, Day 2 = startDate + 1 day, etc.
      // Parse startDate (YYYY-MM-DD) to avoid timezone issues
      const startParts = startDate.split('T')[0].split('-')
      const start = new Date(
        parseInt(startParts[0]),
        parseInt(startParts[1]) - 1,
        parseInt(startParts[2])
      )
      start.setHours(0, 0, 0, 0)
      
      const currentDayDate = new Date(start)
      currentDayDate.setDate(start.getDate() + (currentDay - 1))
      // Use formatDateString instead of toISOString to avoid timezone issues
      const currentDayDateStr = formatDateString(currentDayDate)
      
      console.log('[RecoveryPlan] Checking completions for:', {
        planId,
        currentDay,
        startDate,
        calculatedDate: currentDayDateStr,
        totalExercises
      })
      
      const result = await apiClient.get<{ completed_exercise_ids: string[] }>(
        `${API_ROUTES.CHECKINS.REHABILITATION_PLAN_COMPLETIONS}?plan_id=${planId}&date=${currentDayDateStr}`
      )
      
      if (!isApiError(result)) {
        const completedSet = new Set(result.data.completed_exercise_ids || [])
        setCompletedExercisesToday(completedSet)
        
        console.log('[RecoveryPlan] Completions received:', {
          completedExerciseIds: Array.from(completedSet),
          totalExercises,
          date: currentDayDateStr
        })
        
        // Check if all exercises are completed for the current day
        const allCompleted = completedSet.size === totalExercises && totalExercises > 0
        
        console.log('[RecoveryPlan] Day completion status:', {
          allCompleted,
          completedCount: completedSet.size,
          totalNeeded: totalExercises
        })
        
        setDayCompleted(allCompleted)
        
        // If current day is completed, calculate next available time (6:00 AM next day)
        if (allCompleted) {
          const nextDayDate = new Date(currentDayDate)
          nextDayDate.setDate(currentDayDate.getDate() + 1)
          nextDayDate.setHours(6, 0, 0, 0) // 6:00 AM of next day
          setNextAvailableTime(nextDayDate)
          
          // Check if current time is before next available time
          const now = new Date()
          setCanProceed(now >= nextDayDate)
        } else {
          setNextAvailableTime(null)
          setCanProceed(true)
        }
      }
    } catch (err) {
      console.error('Error checking completions:', err)
    }
  }

  // Update canProceed status every minute to check if 6 AM has passed
  // Also force re-render to update the time display
  useEffect(() => {
    if (dayCompleted && nextAvailableTime) {
      const checkAvailability = () => {
        const now = new Date()
        setCanProceed(now >= nextAvailableTime!)
        // Force re-render to update time display
        setTimeUpdate(prev => prev + 1)
      }
      
      checkAvailability()
      const interval = setInterval(checkAvailability, 60000) // Check every minute
      
      return () => clearInterval(interval)
    }
  }, [dayCompleted, nextAvailableTime])

  const handleComplete = async () => {
    if (!plan || !plan.exercises[currentExerciseIndex] || dayCompleted) return

    try {
      setCompleting(true)
      const result = await apiClient.post<{ message: string }>(
        API_ROUTES.CHECKINS.REHABILITATION_PLAN_COMPLETE_EXERCISE,
        {
          plan_id: plan.id,
          exercise_id: plan.exercises[currentExerciseIndex].id,
        }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to mark exercise as completed')
      }

      // Immediately update the completed exercises state to disable the button
      const completedExerciseId = plan.exercises[currentExerciseIndex].id
      setCompletedExercisesToday(prev => new Set([...prev, completedExerciseId]))
      
      // Check if all exercises are now completed
      const newCompletedSet = new Set([...completedExercisesToday, completedExerciseId])
      const allExercisesCompleted = newCompletedSet.size === plan.exercises.length && plan.exercises.length > 0
      
      if (allExercisesCompleted) {
        // All exercises completed for the day
        setDayCompleted(true)
        
        // Calculate next available time (6:00 AM next day)
        // Parse startDate to avoid timezone issues
        const startParts = plan.startDate.split('T')[0].split('-')
        const start = new Date(
          parseInt(startParts[0]),
          parseInt(startParts[1]) - 1,
          parseInt(startParts[2])
        )
        start.setHours(0, 0, 0, 0)
        
        const currentDayDate = new Date(start)
        currentDayDate.setDate(start.getDate() + (plan.currentDay - 1))
        const nextDayDate = new Date(currentDayDate)
        nextDayDate.setDate(currentDayDate.getDate() + 1)
        nextDayDate.setHours(6, 0, 0, 0) // 6:00 AM of next day
        setNextAvailableTime(nextDayDate)
        
        const now = new Date()
        setCanProceed(now >= nextDayDate)
      } else {
        // Not all exercises completed, move to next exercise if available
        if (currentExerciseIndex < plan.exercises.length - 1) {
          setCurrentExerciseIndex(currentExerciseIndex + 1)
        }
      }

      // Refresh plan to get updated progress (async, won't block UI update)
      fetchPlan().catch(err => console.error('Error refreshing plan:', err))
    } catch (err: any) {
      console.error('Error completing exercise:', err)
      alert(err.message || 'Failed to complete exercise')
    } finally {
      setCompleting(false)
    }
  }

  const getNextWarmUpTime = () => {
    if (!plan) return null
    
    // If next available time is set (6 AM next day), use that
    if (nextAvailableTime) {
      return nextAvailableTime.toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    }
    
    // Fallback: calculate next day from current day
    const startDate = new Date(plan.startDate)
    startDate.setHours(0, 0, 0, 0)
    
    if (plan.currentDay < plan.totalDays) {
      const nextDayDate = new Date(startDate)
      nextDayDate.setDate(startDate.getDate() + plan.currentDay)
      nextDayDate.setHours(6, 0, 0, 0)
      return nextDayDate.toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    }
    
    return null
  }

  const formatTimeUntilNext = () => {
    if (!nextAvailableTime) return null
    
    const now = new Date()
    const diff = nextAvailableTime.getTime() - now.getTime()
    
    if (diff <= 0) return 'Available now'
    
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    
    if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} and ${minutes} minute${minutes !== 1 ? 's' : ''}`
    }
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`
  }

  const formatNextWarmUpTime = (date: Date): string => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true 
    })
  }

  const extractYouTubeId = (url: string | null): string | null => {
    if (!url) return null
    const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/)
    return match ? match[1] : null
  }

  const getYouTubeEmbedUrl = (url: string | null): string | null => {
    const videoId = extractYouTubeId(url)
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="recovery-plan-container">
          <Loading message="Loading recovery plan..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  if (error || !plan) {
    return (
      <DashboardLayout>
        <div className="recovery-plan-container">
          <div className="recovery-plan-error">
            <p>{error || 'No active rehabilitation plan found'}</p>
            <button 
              className="recovery-plan-back-btn"
              onClick={() => navigate('/dashboard/worker')}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const currentExercise = plan.exercises[currentExerciseIndex]
  const videoEmbedUrl = currentExercise ? getYouTubeEmbedUrl(currentExercise.video_url) : null

  return (
    <DashboardLayout>
      <div className="recovery-plan-container">
        {/* Header */}
        <div className="recovery-plan-header">
          <div>
            <h1 className="recovery-plan-title">{plan.plan_name}</h1>
            <p className="recovery-plan-subtitle">{plan.plan_description}</p>
          </div>
          <div className="recovery-plan-day-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 11 12 14 22 4"></polyline>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
            Day {plan.currentDay} of {plan.totalDays}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="recovery-plan-progress-section">
          <span className="recovery-plan-progress-label">Progress</span>
          <div className="recovery-plan-progress-bar-container">
            <div 
              className="recovery-plan-progress-bar"
              style={{ width: `${plan.progress}%` }}
            ></div>
          </div>
          <span className="recovery-plan-progress-count">
            {currentExerciseIndex + 1} of {plan.exercises.length}
          </span>
        </div>

        {/* Exercise Card - Only show if current day is not completed */}
        {/* If day is completed, show the "Day Completed!" message instead */}
        {currentExercise && !dayCompleted && (
          <div className="recovery-plan-exercise-card">
            <div className="recovery-plan-exercise-header">
              <div>
                <h2 className="recovery-plan-exercise-name">{currentExercise.exercise_name}</h2>
                {currentExercise.repetitions && (
                  <p className="recovery-plan-exercise-reps">{currentExercise.repetitions}</p>
                )}
              </div>
              <div className="recovery-plan-exercise-number">
                {currentExerciseIndex + 1}
              </div>
            </div>

            {/* Video Player */}
            {videoEmbedUrl ? (
              <div className="recovery-plan-video-container">
                <iframe
                  src={videoEmbedUrl}
                  title={currentExercise.exercise_name}
                  className="recovery-plan-video"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                ></iframe>
              </div>
            ) : currentExercise.video_url ? (
              <div className="recovery-plan-video-container">
                <a 
                  href={currentExercise.video_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="recovery-plan-video-link"
                >
                  <div className="recovery-plan-video-placeholder">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="8 5 19 12 8 19 8 5"/>
                    </svg>
                    <p>Watch on YouTube</p>
                  </div>
                </a>
              </div>
            ) : (
              <div className="recovery-plan-video-container">
                <div className="recovery-plan-video-placeholder">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="8 5 19 12 8 19 8 5"/>
                  </svg>
                  <p>No video available</p>
                </div>
              </div>
            )}

            {/* Instructions */}
            {currentExercise.instructions && (
              <div className="recovery-plan-instructions">
                <p>{currentExercise.instructions}</p>
              </div>
            )}

            {/* Play Voiceover Button */}
            <button className="recovery-plan-voiceover-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="8 5 19 12 8 19 8 5"/>
              </svg>
              Play Voiceover
            </button>
          </div>
        )}

        {/* Complete Button or Day Completed Message */}
        {dayCompleted ? (
          <div className="recovery-plan-day-completed">
            <div className="recovery-plan-completed-message">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 11 12 14 22 4"></polyline>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
              </svg>
              <div>
                <h3>Day {plan.currentDay} Completed!</h3>
                {plan.currentDay < plan.totalDays ? (
                  <>
                    {canProceed ? (
                      <p>
                        Great job! You can now proceed to Day {plan.currentDay + 1}. 
                        <button 
                          className="recovery-plan-proceed-next-btn"
                          onClick={async () => {
                            // Refresh plan to get next day
                            await fetchPlan()
                          }}
                          style={{
                            marginLeft: '8px',
                            padding: '6px 12px',
                            backgroundColor: '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '500'
                          }}
                        >
                          Continue to Day {plan.currentDay + 1}
                        </button>
                      </p>
                    ) : (
                      <div style={{ marginTop: '16px', padding: '16px', backgroundColor: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '8px' }}>
                        <div style={{ marginBottom: '8px' }}>
                          <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600, color: '#065F46' }}>
                            Daily Warm-Up
                          </h4>
                          <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#047857' }}>
                            Spine & Hips Primer • 6 minutes
                          </p>
                        </div>
                        {nextAvailableTime && (
                          <p style={{ margin: 0, fontSize: '13px', color: '#059669', fontWeight: 500 }}>
                            Next warm-up: {formatNextWarmUpTime(nextAvailableTime)} ({formatTimeUntilNext() || 'Available now'})
                          </p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p>Congratulations! You have completed your rehabilitation plan.</p>
                )}
              </div>
            </div>
            <button 
              className="recovery-plan-back-dashboard-btn"
              onClick={() => navigate('/dashboard/worker')}
            >
              Back to Dashboard
            </button>
          </div>
        ) : (
          <button 
            className="recovery-plan-complete-btn"
            onClick={handleComplete}
            disabled={completing || dayCompleted || completedExercisesToday.has(currentExercise?.id || '') || !currentExercise}
          >
            {completing ? 'Completing...' : completedExercisesToday.has(currentExercise?.id || '') ? 'Already Completed' : dayCompleted ? 'Day Completed' : 'Complete'}
          </button>
        )}
      </div>
    </DashboardLayout>
  )
}

