/**
 * Centralized Error Handler
 * 
 * Single source of truth for all error handling in the application
 * Security: All error messages are sanitized and user-friendly
 * 
 * Usage:
 * import { handleError, getErrorMessage } from '../utils/errorHandler'
 * 
 * try {
 *   // ... code
 * } catch (error) {
 *   const message = handleError(error)
 *   // Display message to user
 * }
 */

/**
 * Sensitive patterns that should be redacted from error messages
 */
const SENSITIVE_PATTERNS = [
  { pattern: /password/gi, replacement: '[REDACTED]' },
  { pattern: /token/gi, replacement: '[REDACTED]' },
  { pattern: /secret/gi, replacement: '[REDACTED]' },
  { pattern: /key/gi, replacement: '[REDACTED]' },
  { pattern: /api[_-]?key/gi, replacement: '[REDACTED]' },
  { pattern: /authorization/gi, replacement: '[REDACTED]' },
  { pattern: /bearer\s+\w+/gi, replacement: '[REDACTED]' },
  { pattern: /sql/gi, replacement: '[REDACTED]' },
  { pattern: /query/gi, replacement: '[REDACTED]' },
  { pattern: /connection\s+string/gi, replacement: '[REDACTED]' },
  { pattern: /database\s+url/gi, replacement: '[REDACTED]' },
]

/**
 * Sanitizes error messages to prevent exposing sensitive data
 * Security: Removes sensitive information from error messages
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message || typeof message !== 'string') {
    return 'An error occurred'
  }

  let sanitized = message
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }

  // Limit message length to prevent DoS attacks
  return sanitized.slice(0, 500)
}

/**
 * Gets user-friendly error message based on HTTP status code
 * Centralized fallback: Single source of truth for status messages
 */
export function getStatusErrorMessage(status: number): string {
  const statusMessages: Record<number, string> = {
    400: 'Invalid request. Please check your input and try again.',
    401: 'You are not authorized. Please log in again.',
    403: 'You do not have permission to perform this action.',
    404: 'The requested resource was not found.',
    409: 'This action conflicts with existing data.',
    422: 'The request could not be processed. Please check your input.',
    429: 'Too many requests. Please wait a moment and try again.',
    500: 'A server error occurred. Please try again later.',
    502: 'Service temporarily unavailable. Please try again later.',
    503: 'Service is currently unavailable. Please try again later.',
    504: 'Request timed out. Please try again.',
  }

  return statusMessages[status] || 'An error occurred. Please try again.'
}

/**
 * Gets user-friendly network error message
 * Centralized fallback: Secure error messages for network failures
 */
export function getNetworkErrorMessage(error?: any): string {
  // Don't expose internal error details in production
  if (!import.meta.env.DEV) {
    return 'Unable to connect to the server. Please check your internet connection and try again.'
  }

  // In development, provide more details for debugging
  if (error?.message?.includes('Failed to fetch')) {
    return 'Network error: Unable to reach the server. Please check your connection.'
  }
  
  if (error?.message?.includes('NetworkError')) {
    return 'Network error: Connection failed. Please try again.'
  }

  if (error?.message?.includes('timeout')) {
    return 'Request timed out. Please check your connection and try again.'
  }

  return 'Network error. Please check your connection and try again.'
}

/**
 * Extracts error message from various error types
 * Handles: Error objects, strings, API errors, network errors
 */
export function extractErrorMessage(error: unknown): string {
  // Handle null/undefined
  if (!error) {
    return 'An unknown error occurred'
  }

  // Handle string errors
  if (typeof error === 'string') {
    return sanitizeErrorMessage(error)
  }

  // Handle Error objects
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message)
  }

  // Handle API error responses (from apiClient)
  if (typeof error === 'object' && error !== null) {
    const err = error as any
    
    // Check for API error format
    if (err.error?.message) {
      return sanitizeErrorMessage(err.error.message)
    }
    
    if (err.message) {
      return sanitizeErrorMessage(err.message)
    }
    
    // Check for status code
    if (err.status || err.error?.status) {
      const status = err.status || err.error.status
      return getStatusErrorMessage(status)
    }
  }

  // Fallback
  return 'An error occurred. Please try again.'
}

/**
 * Main error handler - processes any error and returns user-friendly message
 * Centralized: Use this for all error handling in the application
 * 
 * @param error - Any error object, string, or unknown type
 * @returns Sanitized, user-friendly error message
 */
export function handleError(error: unknown): string {
  return extractErrorMessage(error)
}

/**
 * Checks if error is a network error (retryable)
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  
  const message = extractErrorMessage(error).toLowerCase()
  
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('connection')
  )
}

/**
 * Checks if error is an authentication error
 */
export function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  
  const err = error as any
  const status = err.status || err.error?.status || 0
  
  return status === 401 || status === 403
}

