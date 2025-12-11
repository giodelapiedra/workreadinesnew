/**
 * Timezone Utilities
 * Centralized timezone-related functions for backend
 * 
 * @module shared/date/timezone
 */

/**
 * Get current time in a specific timezone
 * @param timezone - IANA timezone identifier (e.g., 'Australia/Sydney', 'Asia/Manila')
 * @returns Time string in HH:MM format
 */
export function getCurrentTimeInTimezone(timezone: string): string {
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = formatter.formatToParts(now)
    const hour = parts.find(p => p.type === 'hour')?.value || '00'
    const minute = parts.find(p => p.type === 'minute')?.value || '00'
    return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  } catch (error) {
    console.error(`[getCurrentTimeInTimezone] Invalid timezone: ${timezone}, using server time`, error)
    // Fallback to server local time
    const now = new Date()
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
  }
}

/**
 * Get current date in a specific timezone
 * @param timezone - IANA timezone identifier (e.g., 'Australia/Sydney', 'Asia/Manila')
 * @returns Date string in YYYY-MM-DD format
 */
export function getCurrentDateInTimezone(timezone: string): string {
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return formatter.format(now)
  } catch (error) {
    console.error(`[getCurrentDateInTimezone] Invalid timezone: ${timezone}, using server date`, error)
    // Fallback to server local date
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}

/**
 * Get Date object representing current date/time in a specific timezone
 * @param timezone - IANA timezone identifier
 * @returns Date object
 */
export function getDateInTimezone(timezone: string): Date {
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const parts = formatter.formatToParts(now)
    const year = parseInt(parts.find(p => p.type === 'year')?.value || '0')
    const month = parseInt(parts.find(p => p.type === 'month')?.value || '0') - 1
    const day = parseInt(parts.find(p => p.type === 'day')?.value || '0')
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0')
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0')
    const second = parseInt(parts.find(p => p.type === 'second')?.value || '0')
    
    return new Date(year, month, day, hour, minute, second)
  } catch (error) {
    console.error(`[getDateInTimezone] Invalid timezone: ${timezone}, using server date`, error)
    return new Date()
  }
}

/**
 * Validate timezone string (basic validation)
 * @param timezone - Timezone string to validate
 * @returns true if timezone appears valid
 */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== 'string') return false
  try {
    // Try to create a formatter with the timezone
    Intl.DateTimeFormat(undefined, { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

