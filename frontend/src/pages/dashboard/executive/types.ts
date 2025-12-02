/**
 * Shared types for Worker Streak components
 * Centralized to avoid duplication
 */

export interface ExceptionDate {
  date: string
  exception_type: string
  reason: string | null
}

export interface WorkerStreak {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  fullName: string
  currentStreak: number
  totalScheduledDays: number
  pastScheduledDays: number
  completedDays: number
  completionPercentage: number
  hasSevenDayBadge: boolean
  missedScheduleDates: string[]
  missedScheduleCount: number
  exceptionDates?: ExceptionDate[]
  hasActiveException?: boolean
  currentException?: {
    exception_type: string
    reason: string | null
    start_date: string
    end_date: string | null
  } | null
}

export interface CheckInRecord {
  id: string
  check_in_date: string
  check_in_time: string
  predicted_readiness?: string
  shift_type?: string
}

