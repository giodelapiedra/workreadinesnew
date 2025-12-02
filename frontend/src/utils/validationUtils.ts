/**
 * Centralized Validation Utilities
 * 
 * Single source of truth for all validation functions
 * Prevents code duplication and ensures consistency
 * 
 * Note: This file extends the existing validation utilities
 * Backend validation utilities are in backend/src/utils/validationUtils.ts
 */

import { calculateAge } from '../shared/date'

/**
 * Validates password strength
 */
export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' }
  }

  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' }
  }

  return { valid: true }
}

/**
 * Validates string input (general purpose)
 */
export function validateStringInput(
  input: string,
  options?: { minLength?: number; maxLength?: number; required?: boolean }
): { valid: boolean; error?: string } {
  const { minLength, maxLength, required = true } = options || {}

  if (required && (!input || typeof input !== 'string' || input.trim().length === 0)) {
    return { valid: false, error: 'This field is required' }
  }

  if (minLength && input.length < minLength) {
    return { valid: false, error: `Must be at least ${minLength} characters long` }
  }

  if (maxLength && input.length > maxLength) {
    return { valid: false, error: `Must be no more than ${maxLength} characters long` }
  }

  return { valid: true }
}

/**
 * Validates birthday input from month, day, year dropdowns
 * 
 * @param month - Month string (1-12)
 * @param day - Day string (1-31)
 * @param year - Year string (4 digits)
 * @returns Object with validation result and error message
 */
export function validateBirthday(
  month: string,
  day: string,
  year: string
): { valid: boolean; error: string } {
  // If any field is empty, consider it valid (user is still filling it out)
  if (!month || !day || !year) {
    return { valid: true, error: '' }
  }

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const birthDate = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Check if date is valid
  if (isNaN(birthDate.getTime())) {
    return {
      valid: false,
      error: 'It looks like you entered the wrong info. Please be sure to use your real birthday.'
    }
  }

  // Check if date is in the future
  if (birthDate >= today) {
    return {
      valid: false,
      error: 'It looks like you entered the wrong info. Please be sure to use your real birthday.'
    }
  }

  // Check minimum age (18 years old)
  const age = calculateAge(dateStr)
  if (age !== null && age < 18) {
    return {
      valid: false,
      error: 'It looks like you entered the wrong info. Please be sure to use your real birthday.'
    }
  }

  return { valid: true, error: '' }
}

