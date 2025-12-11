/**
 * Shared Date Utilities - Index
 * Re-exports all date and age utilities
 * 
 * @module shared/date
 */

// Date utilities
export {
  getTodayDateString,
  getTodayDate,
  getStartOfWeekDateString,
  getFirstDayOfMonthString,
  formatDateString,
  dateToDateString,
  parseDateString,
  isValidDateString,
  normalizeDate,
  isDateInRange,
  parseTime,
  compareTime
} from './date.js'

// Age utilities
export {
  MINIMUM_AGE,
  calculateAge,
  validateMinimumAge
} from './age.js'

// Timezone utilities
export {
  getCurrentTimeInTimezone,
  getCurrentDateInTimezone,
  getDateInTimezone,
  isValidTimezone
} from './timezone.js'

