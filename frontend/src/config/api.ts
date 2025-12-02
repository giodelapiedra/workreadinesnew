/**
 * Centralized API Configuration
 * 
 * Security: No insecure fallbacks in production
 * All environment variables must be properly configured
 */

/**
 * Validates URL format to prevent injection attacks
 */
function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    // Only allow http/https protocols
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Gets API base URL with proper validation
 * 
 * Security:
 * - No insecure localhost fallback in production
 * - Validates URL format to prevent injection
 * - Throws error if invalid configuration
 */
function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_BASE_URL
  
  // In development, allow localhost fallback
  const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development'
  const fallbackUrl = isDevelopment ? 'http://localhost:3000' : null
  
  const apiUrl = envUrl || fallbackUrl
  
  if (!apiUrl) {
    throw new Error(
      'VITE_API_BASE_URL environment variable is required in production. ' +
      'Please set it in your .env file or environment configuration.'
    )
  }
  
  // Validate URL format
  if (!validateUrl(apiUrl)) {
    throw new Error(
      `Invalid VITE_API_BASE_URL format: "${apiUrl}". ` +
      'Must be a valid HTTP or HTTPS URL.'
    )
  }
  
  // Security: Warn if using HTTP in production
  if (!isDevelopment && apiUrl.startsWith('http://')) {
    console.warn(
      '[Security Warning] Using HTTP instead of HTTPS in production. ' +
      'This is insecure and should be avoided.'
    )
  }
  
  return apiUrl
}

export const API_BASE_URL = getApiBaseUrl()

