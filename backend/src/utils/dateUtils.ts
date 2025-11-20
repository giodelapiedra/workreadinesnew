/**
 * Date utility functions to eliminate code duplication
 */

/**
 * Get today's date in YYYY-MM-DD format
 * @returns Today's date string
 */
export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Get today's date as Date object (normalized to start of day)
 * @returns Today's date
 */
export function getTodayDate(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

/**
 * Get start of week date string (Sunday)
 * @returns Start of week date string
 */
export function getStartOfWeekDateString(): string {
  const startOfWeek = new Date()
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
  return startOfWeek.toISOString().split('T')[0]
}

/**
 * Get first day of current month date string
 * @returns First day of month date string (YYYY-MM-01)
 */
export function getFirstDayOfMonthString(): string {
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  return firstDay.toISOString().split('T')[0]
}

/**
 * Convert Date object to date string (YYYY-MM-DD)
 * @param date - Date object to convert
 * @returns Date string
 */
export function dateToDateString(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Normalize date to start of day (00:00:00)
 * @param date - Date to normalize
 * @returns Normalized date
 */
export function normalizeDate(date: Date): Date {
  const normalized = new Date(date)
  normalized.setHours(0, 0, 0, 0)
  return normalized
}

/**
 * Check if a date string is valid
 * @param dateString - Date string to validate
 * @returns true if valid date string
 */
export function isValidDateString(dateString: string): boolean {
  if (!dateString || typeof dateString !== 'string') {
    return false
  }
  const date = new Date(dateString)
  return !isNaN(date.getTime())
}

