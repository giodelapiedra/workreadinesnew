/**
 * Shared date and time utilities for backend
 * Used across routes to avoid duplication
 */

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

