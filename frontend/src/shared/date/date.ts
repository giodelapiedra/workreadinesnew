/**
 * Shared Date & Time Utilities
 * Centralized date/time functions for frontend
 * 
 * @module shared/date/date
 */

/**
 * ============================================
 * DATE STRING GENERATION
 * ============================================
 */

/**
 * Get today's date in YYYY-MM-DD format
 * @returns Today's date string
 */
export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0]
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
 * ============================================
 * DATE FORMATTING
 * ============================================
 */

/**
 * Format date as YYYY-MM-DD (local time, no timezone conversion)
 * @param date - Date object to format
 * @returns Formatted date string (YYYY-MM-DD)
 * @throws {Error} If date is invalid
 */
export const formatDate = (date: Date): string => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Invalid date provided to formatDate')
  }

  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  
  return `${year}-${month}-${day}`
}

/**
 * Format date string for display (e.g., "Jan 15, 2024")
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Formatted date string for display or empty string if invalid
 */
export const formatDateDisplay = (dateStr: string): string => {
  if (!dateStr || typeof dateStr !== 'string') {
    return ''
  }

  try {
    // Validate date string format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(dateStr)) {
      return ''
    }

    const date = new Date(dateStr + 'T00:00:00')
    
    // Check if date is valid
    if (Number.isNaN(date.getTime())) {
      return ''
    }

    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    })
  } catch {
    return ''
  }
}

/**
 * Format date for display with weekday (e.g., "Monday, Jan 15, 2024")
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Formatted date string with weekday or empty string if invalid
 */
export const formatDateWithWeekday = (dateStr: string): string => {
  if (!dateStr || typeof dateStr !== 'string') {
    return ''
  }

  try {
    // Validate date string format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(dateStr)) {
      return ''
    }

    const date = new Date(dateStr + 'T00:00:00')
    
    // Check if date is valid
    if (Number.isNaN(date.getTime())) {
      return ''
    }

    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'long', 
      day: 'numeric',
      year: 'numeric'
    })
  } catch {
    return ''
  }
}

/**
 * ============================================
 * TIME FORMATTING
 * ============================================
 */

/**
 * Format time string (HH:MM) to 12-hour format (HH:MM AM/PM)
 * @param timeStr - Time string in HH:MM format
 * @returns Formatted time string (e.g., "02:30 PM") or empty string if invalid
 * @throws {Error} If time format is invalid
 */
export const formatTime = (timeStr: string): string => {
  if (!timeStr || typeof timeStr !== 'string') {
    return ''
  }

  const timeRegex = /^(\d{1,2}):(\d{2})$/
  const match = timeStr.trim().match(timeRegex)
  
  if (!match) {
    return ''
  }

  const hours = Number.parseInt(match[1]!, 10)
  const minutes = Number.parseInt(match[2]!, 10)

  // Validate time range
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return ''
  }

  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`
}

/**
 * Normalize time format to HH:MM (ensures 2-digit hours and minutes)
 * Accepts both "H:MM" and "HH:MM" formats
 * @param time - Time string to normalize
 * @returns Normalized time string (HH:MM) or empty string if invalid
 */
export const normalizeTime = (time: string): string => {
  if (!time || typeof time !== 'string') {
    return ''
  }

  const trimmed = time.trim()
  const timeRegex = /^(\d{1,2}):(\d{2})$/
  const match = trimmed.match(timeRegex)
  
  if (!match) {
    return ''
  }

  const hours = Number.parseInt(match[1]!, 10)
  const minutes = Number.parseInt(match[2]!, 10)

  // Validate time range
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return ''
  }

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

