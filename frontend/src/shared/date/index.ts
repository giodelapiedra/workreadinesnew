/**
 * Shared Date Utilities - Index
 * Re-exports all date and age utilities
 * 
 * @module shared/date
 */

// Date utilities
export {
  getTodayDateString,
  getStartOfWeekDateString,
  formatDate,
  formatDateDisplay,
  formatDateWithWeekday,
  formatTime,
  normalizeTime
} from './date'

// Age utilities
export {
  calculateAge,
  formatAge
} from './age'

