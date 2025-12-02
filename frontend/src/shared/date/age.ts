/**
 * Age Calculation Utilities
 * Centralized age-related functions for frontend
 * 
 * @module shared/date/age
 */

/**
 * Calculate age from date of birth
 * @param dateOfBirth - Date of birth string (YYYY-MM-DD format) or Date object
 * @returns Age in years, or null if dateOfBirth is invalid
 */
export function calculateAge(dateOfBirth: string | Date | null | undefined): number | null {
  if (!dateOfBirth) {
    return null
  }

  try {
    const birthDate = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth
    
    if (isNaN(birthDate.getTime())) {
      return null
    }

    const today = new Date()
    let age = today.getFullYear() - birthDate.getFullYear()
    const monthDiff = today.getMonth() - birthDate.getMonth()
    
    // Adjust age if birthday hasn't occurred this year
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--
    }

    // Ensure age is not negative (shouldn't happen with validation, but safety check)
    return age >= 0 ? age : null
  } catch (error) {
    console.error('Error calculating age:', error)
    return null
  }
}

/**
 * Format age with label
 * @param dateOfBirth - Date of birth string or Date object
 * @returns Formatted age string (e.g., "25 years old") or "N/A"
 */
export function formatAge(dateOfBirth: string | Date | null | undefined): string {
  const age = calculateAge(dateOfBirth)
  if (age === null) {
    return 'N/A'
  }
  return `${age} years old`
}

