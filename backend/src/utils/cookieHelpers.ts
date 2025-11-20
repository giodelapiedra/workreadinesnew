/**
 * Get SameSite cookie value for authentication
 * Mobile uses 'Lax' (more compatible), desktop production uses 'None' (cross-origin)
 */
export function getCookieSameSite(userAgent: string | undefined): 'None' | 'Lax' {
  const isProduction = process.env.NODE_ENV === 'production'
  const isMobile = userAgent ? /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent) : false
  
  if (isMobile || !isProduction) return 'Lax'
  return 'None'
}

