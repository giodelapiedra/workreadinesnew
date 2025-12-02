/**
 * Exception utility functions for frontend
 * Shared logic for checking worker exceptions
 * 
 * @module utils/exceptionUtils
 */

/**
 * Worker exception interface
 * Represents an exception period for a worker
 */
export interface WorkerException {
  id: string
  user_id: string
  exception_type: string
  start_date: string
  end_date?: string | null
  is_active: boolean
  reason?: string | null
  deactivated_at?: string | null
}

/**
 * Normalize date to midnight (00:00:00.000) for accurate day-level comparison
 * @param date - Date to normalize
 * @returns Normalized date with time set to midnight
 * @throws {Error} If date is invalid
 */
function normalizeDateToMidnight(date: Date): Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Invalid date provided to normalizeDateToMidnight')
  }

  const normalized = new Date(date)
  normalized.setHours(0, 0, 0, 0)
  return normalized
}

/**
 * Check if an exception is active for a given date
 * @param exception - Exception object
 * @param checkDate - Date to check (defaults to today)
 * @returns true if exception is active on the given date
 * @throws {Error} If exception or date is invalid
 */
export function isExceptionActive(
  exception: WorkerException,
  checkDate: Date = new Date()
): boolean {
  // Validate inputs
  if (!exception || typeof exception !== 'object') {
    throw new Error('Invalid exception object provided')
  }

  if (!(checkDate instanceof Date) || Number.isNaN(checkDate.getTime())) {
    throw new Error('Invalid checkDate provided')
  }

  // Early return if exception is not active
  if (!exception.is_active) {
    return false
  }

  // Validate required fields
  if (!exception.start_date || typeof exception.start_date !== 'string') {
    return false
  }

  try {
    // If exception was deactivated, check if deactivation was before or on the checkDate
    if (exception.deactivated_at) {
      const deactivatedDate = normalizeDateToMidnight(new Date(exception.deactivated_at))
      const normalizedCheckDate = normalizeDateToMidnight(checkDate)
      
      if (deactivatedDate <= normalizedCheckDate) {
        return false
      }
    }

    const normalizedCheckDate = normalizeDateToMidnight(checkDate)
    const exceptionStart = normalizeDateToMidnight(new Date(exception.start_date))
    
    // Check if checkDate is before exception starts
    if (normalizedCheckDate < exceptionStart) {
      return false
    }

    // If no end_date, exception is ongoing
    if (!exception.end_date) {
      return true
    }

    const exceptionEnd = normalizeDateToMidnight(new Date(exception.end_date))
    
    // Check if checkDate is within the exception period
    return normalizedCheckDate <= exceptionEnd
  } catch (error) {
    // If date parsing fails, exception is not active
    return false
  }
}

/**
 * Check if worker has any active exception for a given date
 * @param exceptions - Array of exceptions
 * @param workerId - Worker user ID
 * @param checkDate - Date to check (defaults to today)
 * @returns true if worker has active exception
 * @throws {Error} If inputs are invalid
 */
export function hasActiveException(
  exceptions: WorkerException[],
  workerId: string,
  checkDate: Date = new Date()
): boolean {
  // Validate inputs
  if (!Array.isArray(exceptions)) {
    return false
  }

  if (!workerId || typeof workerId !== 'string') {
    return false
  }

  if (!(checkDate instanceof Date) || Number.isNaN(checkDate.getTime())) {
    return false
  }

  // Find worker's exception
  const workerException = exceptions.find(
    exc => exc?.user_id === workerId && exc.is_active
  )
  
  if (!workerException) {
    return false
  }

  try {
    return isExceptionActive(workerException, checkDate)
  } catch {
    return false
  }
}

/**
 * Get active exception for worker on a given date
 * @param exceptions - Array of exceptions
 * @param workerId - Worker user ID
 * @param checkDate - Date to check (defaults to today)
 * @returns Active exception or undefined
 */
export function getActiveException(
  exceptions: WorkerException[],
  workerId: string,
  checkDate: Date = new Date()
): WorkerException | undefined {
  return exceptions.find(
    exc => exc.user_id === workerId && isExceptionActive(exc, checkDate)
  )
}

/**
 * Exception type labels for user-friendly display
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
 * @returns Human-readable label or original string if not found
 */
export function getExceptionTypeLabel(exceptionType: string): string {
  if (!exceptionType || typeof exceptionType !== 'string') {
    return 'Unknown'
  }

  return EXCEPTION_TYPE_LABELS[exceptionType] || exceptionType
}

/**
 * Check if exception overlaps with a date range
 * Useful for recurring schedules
 * @param exception - Exception object
 * @param startDate - Start of date range
 * @param endDate - End of date range
 * @returns true if exception overlaps with the date range
 */
export function doesExceptionOverlapRange(
  exception: WorkerException,
  startDate: Date,
  endDate: Date
): boolean {
  if (!exception.is_active) {
    return false
  }

  const normalizedStartDate = normalizeDateToMidnight(startDate)
  const normalizedEndDate = normalizeDateToMidnight(endDate)
  const exceptionStart = normalizeDateToMidnight(new Date(exception.start_date))
  const exceptionEnd = exception.end_date 
    ? normalizeDateToMidnight(new Date(exception.end_date))
    : null

  // Exception overlaps if:
  // - Exception starts before or on range end AND
  // - Exception ends after or on range start (or has no end date)
  return exceptionStart <= normalizedEndDate && 
    (!exceptionEnd || exceptionEnd >= normalizedStartDate)
}

