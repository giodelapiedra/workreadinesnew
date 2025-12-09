/**
 * Exception utility functions to eliminate code duplication
 * Uses centralized normalizeDate from dateTimeUtils
 */

import { normalizeDate } from './dateTimeUtils.js'

// Type definitions for better type safety
export interface WorkerException {
  id?: string
  start_date: string
  end_date?: string | null
  deactivated_at?: string | null
  is_active?: boolean
  exception_type?: string
  reason?: string | null
  user_id?: string
}

/**
 * Check if an exception is active for a given date
 * @param exception - Exception object with start_date and optional end_date
 * @param checkDate - Date to check (defaults to today)
 * @returns boolean - true if exception is active
 */
export function isExceptionActive(
  exception: WorkerException,
  checkDate: Date
): boolean {
  // If is_active flag is explicitly false, exception is not active
  if (exception.is_active === false) {
    return false
  }

  // If exception was deactivated, check if deactivation was before or on the checkDate
  if (exception.deactivated_at) {
    const deactivatedDate = normalizeDate(new Date(exception.deactivated_at))
    const normalizedCheckDate = normalizeDate(checkDate)
    
    // If deactivated before or on checkDate, exception was not active on that date
    if (deactivatedDate <= normalizedCheckDate) {
      return false
    }
  }

  const startDate = normalizeDate(new Date(exception.start_date))
  const normalizedCheckDate = normalizeDate(checkDate)

  // Check if checkDate is after or equal to startDate
  if (normalizedCheckDate < startDate) {
    return false
  }

  // If no end_date, exception is ongoing
  if (!exception.end_date) {
    return true
  }

  const endDate = normalizeDate(new Date(exception.end_date))

  // Check if checkDate is before or equal to endDate
  return normalizedCheckDate <= endDate
}

/**
 * Filter workers with active exceptions for a given date
 * @param exceptions - Array of exception objects
 * @param checkDate - Date to check
 * @returns Set of user IDs with active exceptions
 */
export function getWorkersWithActiveExceptions(
  exceptions: Array<WorkerException & { user_id: string }>,
  checkDate: Date
): Set<string> {
  if (!exceptions || exceptions.length === 0) {
    return new Set<string>()
  }

  return new Set(
    exceptions
      .filter((exception) => isExceptionActive(exception, checkDate))
      .map((exception) => exception.user_id)
  )
}

/**
 * Filter active exceptions for a given date
 * @param exceptions - Array of exception objects
 * @param checkDate - Date to check
 * @returns Array of active exceptions
 */
export function filterActiveExceptions<T extends WorkerException>(
  exceptions: T[],
  checkDate: Date
): T[] {
  if (!exceptions || exceptions.length === 0) {
    return []
  }

  return exceptions.filter((exception) => isExceptionActive(exception, checkDate))
}

/**
 * Check if worker has any active exception that conflicts with a date range
 * Optimized for recurring schedules
 * @param exceptions - Array of worker exceptions
 * @param startDate - Start date of the range
 * @param endDate - End date of the range
 * @returns Active exception if conflict found, null otherwise
 */
export function findConflictingException(
  exceptions: WorkerException[],
  startDate: Date,
  endDate: Date
): WorkerException | null {
  if (!exceptions || exceptions.length === 0) {
    return null
  }

  const normalizedStartDate = normalizeDate(startDate)
  const normalizedEndDate = normalizeDate(endDate)
  
  // Check sample dates: start, end, and middle
  const sampleDates = [
    normalizedStartDate,
    normalizedEndDate,
    new Date((normalizedStartDate.getTime() + normalizedEndDate.getTime()) / 2)
  ]

  for (const exception of exceptions) {
    const exceptionStart = normalizeDate(new Date(exception.start_date))
    const exceptionEnd = exception.end_date 
      ? normalizeDate(new Date(exception.end_date))
      : null

    // Check if date ranges overlap
    const rangesOverlap = exceptionStart <= normalizedEndDate && 
      (!exceptionEnd || exceptionEnd >= normalizedStartDate)

    if (rangesOverlap) {
      // Verify with sample dates
      for (const sampleDate of sampleDates) {
        if (isExceptionActive(exception, sampleDate)) {
          return exception
        }
      }
    }
  }

  return null
}

/**
 * Exception type labels for user-friendly error messages
 */
export const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  transfer: 'Transfer',
  accident: 'Accident',
  injury: 'Injury',
  medical_leave: 'Medical Leave',
  other: 'Other',
}

/**
 * Get user-friendly exception type label
 * @param exceptionType - Exception type code
 * @returns Human-readable label
 */
export function getExceptionTypeLabel(exceptionType: string): string {
  return EXCEPTION_TYPE_LABELS[exceptionType] || exceptionType
}

/**
 * Check which scheduled dates have active exceptions
 * Centralized function to avoid duplication
 * @param scheduledDates - Set of scheduled date strings (YYYY-MM-DD)
 * @param exceptions - Array of worker exceptions
 * @returns Object with exceptionDates array and scheduledDatesWithExceptions Set
 */
export function getExceptionDatesForScheduledDates(
  scheduledDates: Set<string>,
  exceptions: WorkerException[]
): {
  exceptionDates: Array<{ date: string; exception_type: string; reason: string | null }>
  scheduledDatesWithExceptions: Set<string>
} {
  const exceptionDates: Array<{ date: string; exception_type: string; reason: string | null }> = []
  const scheduledDatesWithExceptions = new Set<string>()

  if (!exceptions || exceptions.length === 0) {
    return { exceptionDates, scheduledDatesWithExceptions }
  }

  scheduledDates.forEach((scheduledDate) => {
    const scheduledDateObj = new Date(scheduledDate + 'T00:00:00')
    const hasException = exceptions.some((exception) => {
      return isExceptionActive(exception, scheduledDateObj)
    })

    if (hasException) {
      const exception = exceptions.find((e) => isExceptionActive(e, scheduledDateObj))
      if (exception) {
        exceptionDates.push({
          date: scheduledDate,
          exception_type: exception.exception_type || 'other',
          reason: exception.reason || null,
        })
        scheduledDatesWithExceptions.add(scheduledDate)
      }
    }
  })

  // Sort exception dates (most recent first)
  exceptionDates.sort((a, b) => b.date.localeCompare(a.date))

  return { exceptionDates, scheduledDatesWithExceptions }
}

