/**
 * Query Builder Utility
 * Centralized utility for building URL query parameters
 * Prevents duplication and ensures consistent URL encoding
 * 
 * @module utils/queryBuilder
 */

/**
 * Query parameters interface
 * Supports string, number, boolean, null, and undefined values
 */
export interface QueryParams {
  readonly [key: string]: string | number | boolean | null | undefined
}

/**
 * Build query string from parameters object
 * Handles null/undefined values and URL encoding
 * @param params - Query parameters object
 * @returns Query string (e.g., "?key=value&key2=value2") or empty string
 */
export function buildQueryString(params?: QueryParams | null): string {
  if (!params || typeof params !== 'object' || Object.keys(params).length === 0) {
    return ''
  }

  const queryParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    // Validate key
    if (!key || typeof key !== 'string' || key.trim() === '') {
      return
    }

    // Skip null, undefined, and empty strings
    if (value === null || value === undefined || value === '') {
      return
    }

    // Convert to string and encode
    const stringValue = String(value)
    
    // Validate: prevent XSS in query params and limit length
    if (stringValue.length > 1000) {
      console.warn(`[QueryBuilder] Parameter ${key} exceeds max length, truncating`)
      queryParams.append(key, stringValue.slice(0, 1000))
    } else {
      queryParams.append(key, stringValue)
    }
  })

  const query = queryParams.toString()
  return query ? `?${query}` : ''
}

/**
 * Build full URL with query parameters
 * @param baseUrl - Base URL (e.g., "/api/users")
 * @param params - Query parameters object
 * @returns Full URL with query string
 * @throws {Error} If baseUrl is invalid
 */
export function buildUrl(baseUrl: string, params?: QueryParams | null): string {
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('Invalid baseUrl provided to buildUrl')
  }

  return `${baseUrl}${buildQueryString(params)}`
}

/**
 * Validate and sanitize ID parameter
 * Prevents path traversal and injection attacks
 */
export function sanitizeId(id: string | null | undefined): string {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid ID parameter')
  }

  // Remove any path traversal attempts
  const sanitized = id.replace(/[./\\]/g, '')
  
  // Validate format (UUID or alphanumeric)
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    throw new Error('Invalid ID format')
  }

  // Limit length
  if (sanitized.length > 100) {
    throw new Error('ID exceeds maximum length')
  }

  return sanitized
}

