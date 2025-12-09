/**
 * Comprehensive Date, Time, and Age Utilities
 * Centralized module to avoid duplication and provide consistent date/time handling
 * 
 * @module utils/dateTimeUtils
 */

// ============================================================================
// TIME UTILITIES
// ============================================================================

/**
 * Parse time string (HH:MM) to hours and minutes
 */
export function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(':').map(Number)
  return { hours, minutes }
}

/**
 * Compare two times (HH:MM format)
 * Returns: negative if time1 < time2, positive if time1 > time2, 0 if equal
 */
export function compareTime(time1: string, time2: string): number {
  const t1 = parseTime(time1)
  const t2 = parseTime(time2)
  if (t1.hours !== t2.hours) return t1.hours - t2.hours
  return t1.minutes - t2.minutes
}

// ============================================================================
// DATE FORMATTING UTILITIES
// ============================================================================

/**
 * Format date as YYYY-MM-DD string (no timezone conversion)
 * Uses local timezone to avoid date shifting issues
 */
export function formatDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Parse date string (YYYY-MM-DD) to Date object (local timezone)
 * Handles both YYYY-MM-DD and ISO strings (extracts date part)
 */
export function parseDateString(dateStr: string): Date {
  const parts = dateStr.split('T')[0].split('-')
  if (parts.length !== 3) throw new Error('Invalid date format')
  const year = parseInt(parts[0])
  const month = parseInt(parts[1]) - 1
  const day = parseInt(parts[2])
  const date = new Date(year, month, day)
  date.setHours(0, 0, 0, 0)
  return date
}

/**
 * Normalize a date to start of day (00:00:00.000)
 * Useful for consistent date comparisons
 */
export function normalizeDate(date: Date): Date {
  const normalized = new Date(date)
  normalized.setHours(0, 0, 0, 0)
  return normalized
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

// ============================================================================
// DATE GETTERS (TODAY, WEEK, MONTH)
// ============================================================================

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

// ============================================================================
// DATE RANGE UTILITIES
// ============================================================================

/**
 * Check if a date is within a date range (inclusive)
 * @param checkDate - Date to check
 * @param startDate - Start of range
 * @param endDate - End of range (null means no end)
 * @returns true if checkDate is within range
 */
export function isDateInRange(checkDate: Date, startDate: Date, endDate: Date | null): boolean {
  const normalizedCheck = normalizeDate(checkDate)
  const normalizedStart = normalizeDate(startDate)
  const normalizedEnd = endDate ? normalizeDate(endDate) : null
  
  if (normalizedCheck < normalizedStart) return false
  if (normalizedEnd && normalizedCheck > normalizedEnd) return false
  return true
}

// ============================================================================
// AGE CALCULATION UTILITIES
// Re-exported from shared module to avoid duplication
// ============================================================================

/**
 * @deprecated Import directly from '../shared/date/age' for new code
 * Re-exported for backward compatibility
 */
export { calculateAge, MINIMUM_AGE, validateMinimumAge } from '../shared/date/age.js'

