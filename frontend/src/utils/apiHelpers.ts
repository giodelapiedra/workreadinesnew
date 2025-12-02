/**
 * Utility functions for validation and HTML escaping
 * 
 * Note: For API calls, use apiClient from '../lib/apiClient' instead
 */

/**
 * Escapes HTML special characters to prevent XSS attacks
 * Use this when inserting user-controlled data into HTML templates
 */
export function escapeHtml(unsafe: string | null | undefined): string {
  if (!unsafe) return ''
  if (typeof unsafe !== 'string') return String(unsafe)
  
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Validates email format
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/**
 * Validates business registration number format
 */
export function isValidBusinessRegNumber(regNumber: string): boolean {
  if (!regNumber || typeof regNumber !== 'string') return false
  return /^[A-Za-z0-9\s\-]{3,50}$/.test(regNumber.trim())
}

