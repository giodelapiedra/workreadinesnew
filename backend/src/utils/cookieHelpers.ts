/**
 * Get SameSite cookie value for authentication
 * Production (cross-domain): Always use 'None' with 'Secure' for mobile compatibility
 * Development (same-domain): Use 'Lax'
 */
export function getCookieSameSite(userAgent: string | undefined): 'None' | 'Lax' {
  const isProduction = process.env.NODE_ENV === 'production'
  
  // For cross-domain (production), MUST use 'None' with 'Secure' for mobile to work
  // Mobile browsers block cookies without SameSite=None + Secure=true
  if (isProduction) return 'None'
  
  // Development (same-domain) can use 'Lax'
  return 'Lax'
}

