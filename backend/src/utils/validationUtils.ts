/**
 * Validation utility functions to eliminate code duplication
 */

/**
 * Validate UUID format (basic check)
 * @param id - ID to validate
 * @param maxLength - Maximum length (default: 36 for UUID)
 * @returns true if valid
 */
export function isValidId(id: any, maxLength: number = 36): boolean {
  return id && typeof id === 'string' && id.length > 0 && id.length <= maxLength
}

/**
 * Validate team ID format
 * @param teamId - Team ID to validate
 * @returns { valid: boolean; error?: string }
 */
export function validateTeamId(teamId: any): { valid: boolean; error?: string } {
  if (!isValidId(teamId)) {
    return { valid: false, error: 'Invalid team ID' }
  }
  return { valid: true }
}

/**
 * Validate password
 * @param password - Password to validate
 * @returns { valid: boolean; error?: string }
 */
export function validatePassword(password: any): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' }
  }
  if (password.trim() === '') {
    return { valid: false, error: 'Password cannot be empty' }
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' }
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password must be less than 128 characters' }
  }
  return { valid: true }
}

/**
 * Validate and sanitize string input
 * @param input - Input to validate
 * @param maxLength - Maximum length
 * @param fieldName - Field name for error messages
 * @returns { valid: boolean; value?: string; error?: string }
 */
export function validateStringInput(
  input: any,
  maxLength: number,
  fieldName: string
): { valid: boolean; value?: string; error?: string } {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: `${fieldName} is required` }
  }
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { valid: false, error: `${fieldName} cannot be empty` }
  }
  if (trimmed.length > maxLength) {
    return { valid: false, error: `${fieldName} must be less than ${maxLength} characters` }
  }
  return { valid: true, value: trimmed }
}

/**
 * Validate email format
 * @param email - Email to validate
 * @returns { valid: boolean; error?: string }
 */
export function validateEmail(email: any): { valid: boolean; error?: string } {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' }
  }
  const trimmed = email.trim().toLowerCase()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid email format' }
  }
  if (trimmed.length > 255) {
    return { valid: false, error: 'Email must be less than 255 characters' }
  }
  return { valid: true }
}

