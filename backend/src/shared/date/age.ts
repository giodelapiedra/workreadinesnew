/**
 * Age Calculation Utilities
 * Centralized age-related functions for backend
 * 
 * @module shared/date/age
 */

/**
 * Minimum age requirement (18 years old)
 */
export const MINIMUM_AGE = 18

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
 * Validate date of birth meets minimum age requirement
 * @param dateOfBirth - Date of birth string (YYYY-MM-DD format) or Date object
 * @param minimumAge - Minimum age required (default: 18)
 * @returns Object with valid boolean and optional error message
 */
export function validateMinimumAge(
  dateOfBirth: string | Date | null | undefined,
  minimumAge: number = MINIMUM_AGE
): { valid: boolean; error?: string } {
  if (!dateOfBirth) {
    return { valid: false, error: 'Date of birth is required' }
  }

  try {
    const birthDate = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth
    
    if (isNaN(birthDate.getTime())) {
      return { valid: false, error: 'Invalid date of birth format' }
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    // Check if date is in the past
    if (birthDate >= today) {
      return { valid: false, error: 'Date of birth must be in the past' }
    }

    // Calculate age
    const age = calculateAge(dateOfBirth)
    
    if (age === null) {
      return { valid: false, error: 'Invalid date of birth' }
    }

    // Check minimum age
    if (age < minimumAge) {
      return { 
        valid: false, 
        error: `Age must be at least ${minimumAge} years old. Current age: ${age} years old` 
      }
    }

    return { valid: true }
  } catch (error) {
    console.error('Error validating minimum age:', error)
    return { valid: false, error: 'Error validating date of birth' }
  }
}

