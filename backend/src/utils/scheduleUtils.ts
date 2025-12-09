/**
 * Schedule Utilities
 * Centralized functions for schedule matching and date calculations
 */

import { formatDateString, parseDateString } from './dateTimeUtils.js'

/**
 * Check if a schedule matches a specific date
 * Handles both single-date and recurring schedules with effective/expiry dates
 * @param schedule - Schedule object from database
 * @param checkDateStr - Date string to check (YYYY-MM-DD format)
 * @param dayOfWeek - Day of week (0-6, Sunday=0)
 * @returns true if schedule matches the date
 */
export function scheduleMatchesDate(
  schedule: any,
  checkDateStr: string,
  dayOfWeek: number
): boolean {
  // Check single-date schedules
  if (schedule.scheduled_date && !schedule.day_of_week) {
    if (schedule.scheduled_date === checkDateStr) {
      // Check effective_date and expiry_date
      const effectiveOk = !schedule.effective_date || schedule.effective_date <= checkDateStr
      const expiryOk = !schedule.expiry_date || schedule.expiry_date >= checkDateStr
      return effectiveOk && expiryOk
    }
    return false
  }
  
  // Check recurring schedules
  if (!schedule.scheduled_date && schedule.day_of_week !== null) {
    if (schedule.day_of_week === dayOfWeek) {
      // Check effective_date and expiry_date
      const effectiveOk = !schedule.effective_date || schedule.effective_date <= checkDateStr
      const expiryOk = !schedule.expiry_date || schedule.expiry_date >= checkDateStr
      return effectiveOk && expiryOk
    }
    return false
  }
  
  return false
}

/**
 * Get all scheduled dates for a worker within a date range
 * @param schedules - Array of schedule objects
 * @param startDate - Start date (Date object)
 * @param endDate - End date (Date object)
 * @returns Set of date strings (YYYY-MM-DD format)
 */
export function getScheduledDatesInRange(
  schedules: any[],
  startDate: Date,
  endDate: Date
): Set<string> {
  const scheduledDates = new Set<string>()
  
  if (!schedules || schedules.length === 0) {
    return scheduledDates
  }
  
  const startDateStr = formatDateString(startDate)
  const endDateStr = formatDateString(endDate)
  
  // Calculate day range
  const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  
  for (let dayOffset = 0; dayOffset <= daysDiff; dayOffset++) {
    const checkDate = new Date(startDate)
    checkDate.setDate(checkDate.getDate() + dayOffset)
    const checkDateStr = formatDateString(checkDate)
    const dayOfWeek = checkDate.getDay()
    
    // Check if any schedule matches this date
    for (const schedule of schedules) {
      if (scheduleMatchesDate(schedule, checkDateStr, dayOfWeek)) {
        scheduledDates.add(checkDateStr)
        break // Found a match, no need to check other schedules for this date
      }
    }
  }
  
  return scheduledDates
}

/**
 * Find the next scheduled date after a given date
 * @param schedules - Array of schedule objects
 * @param fromDate - Date to start searching from (Date object)
 * @param maxDaysToCheck - Maximum days to look ahead (default: 90)
 * @returns Date string (YYYY-MM-DD) or null if not found
 */
export function findNextScheduledDate(
  schedules: any[],
  fromDate: Date,
  maxDaysToCheck: number = 90
): string | null {
  if (!schedules || schedules.length === 0) {
    return null
  }
  
  const fromDateStr = formatDateString(fromDate)
  
  // Check future dates
  for (let dayOffset = 1; dayOffset <= maxDaysToCheck; dayOffset++) {
    const checkDate = new Date(fromDate)
    checkDate.setDate(checkDate.getDate() + dayOffset)
    const checkDateStr = formatDateString(checkDate)
    const dayOfWeek = checkDate.getDay()
    
    for (const schedule of schedules) {
      if (scheduleMatchesDate(schedule, checkDateStr, dayOfWeek)) {
        return checkDateStr
      }
    }
  }
  
  return null
}

/**
 * Format date for display
 * @param dateStr - Date string (YYYY-MM-DD format)
 * @returns Formatted date string
 */
export function formatDateForDisplay(dateStr: string): string {
  const date = parseDateString(dateStr)
  return date.toLocaleDateString('en-US', { 
    weekday: 'long',
    month: 'long', 
    day: 'numeric',
    year: 'numeric'
  })
}

