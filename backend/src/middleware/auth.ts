import { Context, Next } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { supabase } from '../lib/supabase.js'
import { getAdminClient } from '../utils/adminClient.js'
import { getCookieSameSite } from '../utils/cookieHelpers.js'

export interface User {
  id: string
  email: string
  role: string
}

export type AuthVariables = {
  user?: User
}

// Cookie names
export const COOKIE_NAMES = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  USER_ID: 'user_id', // Track which user owns this session
} as const

// Get token from cookies or Authorization header
function getToken(c: Context): string | null {
  // Try to get from secure cookie first (more secure)
  const cookieToken = getCookie(c, COOKIE_NAMES.ACCESS_TOKEN)
  if (cookieToken) {
    return cookieToken
  }

  // Fallback to Authorization header
  const authHeader = c.req.header('Authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7)
  }

  return null
}

export async function authMiddleware(c: Context<{ Variables: AuthVariables }>, next: Next) {
  try {
    const token = getToken(c)
    
    if (!token) {
      return c.json({ error: 'Unauthorized: No token provided' }, 401)
    }

    // Verify token with Supabase with retry logic
    let user = null
    let error = null
    
    try {
      const result = await supabase.auth.getUser(token)
      user = result.data?.user || null
      error = result.error || null
    } catch (networkError: any) {
      // Handle network errors specifically
      const isNetworkError = 
        networkError.code === 'ECONNRESET' ||
        networkError.code === 'ETIMEDOUT' ||
        networkError.message?.includes('fetch failed') ||
        networkError.cause?.code === 'ECONNRESET'
      
      if (isNetworkError) {
        console.error('[authMiddleware] Network error connecting to Supabase:', networkError.message || networkError.code)
        return c.json({ 
          error: 'Service temporarily unavailable', 
          message: 'Unable to verify authentication. Please try again in a moment.',
          retry: true
        }, 503)
      }
      
      // Re-throw if it's not a network error
      throw networkError
    }

    if (error || !user) {
      // Clear invalid cookies
      const isProduction = process.env.NODE_ENV === 'production'
      const userAgent = c.req.header('user-agent')
      const sameSite = getCookieSameSite(userAgent)
      const secure = isProduction
      
      setCookie(c, COOKIE_NAMES.ACCESS_TOKEN, '', { httpOnly: true, secure, sameSite, maxAge: 0, path: '/' })
      setCookie(c, COOKIE_NAMES.REFRESH_TOKEN, '', { httpOnly: true, secure, sameSite, maxAge: 0, path: '/' })
      setCookie(c, COOKIE_NAMES.USER_ID, '', { httpOnly: true, secure, sameSite, maxAge: 0, path: '/' })
      
      return c.json({ error: 'Unauthorized: Invalid token' }, 401)
    }

    // Get user role from database - try with regular client first
    let userData = null
    let dbError = null
    
    try {
      const result = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single()
      
      userData = result.data
      dbError = result.error
    } catch (networkError: any) {
      // Handle network errors when querying database
      const isNetworkError = 
        networkError.code === 'ECONNRESET' ||
        networkError.code === 'ETIMEDOUT' ||
        networkError.message?.includes('fetch failed') ||
        networkError.cause?.code === 'ECONNRESET'
      
      if (isNetworkError) {
        console.error('[authMiddleware] Network error querying database:', networkError.message || networkError.code)
        return c.json({ 
          error: 'Service temporarily unavailable', 
          message: 'Unable to verify user information. Please try again in a moment.',
          retry: true
        }, 503)
      }
      
      // Re-throw if it's not a network error
      throw networkError
    }

    // If query failed, try with admin client to bypass RLS
    if (dbError || !userData) {
      try {
        const adminClient = getAdminClient()
        const { data: adminUserData, error: adminError } = await adminClient
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single()

        if (adminUserData) {
          // User exists in database - use their actual role
          userData = adminUserData
        } else {
          // User truly doesn't exist in database
          console.error(`[authMiddleware] User ${user.id} (${user.email}) not found in database`)
          return c.json({ error: 'Unauthorized: User not found' }, 401)
        }
      } catch (adminNetworkError: any) {
        // Handle network errors with admin client
        const isNetworkError = 
          adminNetworkError.code === 'ECONNRESET' ||
          adminNetworkError.code === 'ETIMEDOUT' ||
          adminNetworkError.message?.includes('fetch failed') ||
          adminNetworkError.cause?.code === 'ECONNRESET'
        
        if (isNetworkError) {
          console.error('[authMiddleware] Network error querying database with admin client:', adminNetworkError.message || adminNetworkError.code)
          return c.json({ 
            error: 'Service temporarily unavailable', 
            message: 'Unable to verify user information. Please try again in a moment.',
            retry: true
          }, 503)
        }
        
        throw adminNetworkError
      }
    }

    // Ensure role exists - if not, this is a data integrity issue
    if (!userData || !userData.role) {
      console.error(`[authMiddleware] User ${user.id} (${user.email}) has no role assigned`)
      return c.json({ error: 'Unauthorized: User role not configured' }, 401)
    }

    // Attach user info to context with actual role from database
    c.set('user', {
      id: user.id,
      email: user.email || '',
      role: userData.role, // Use actual role, no default
    })

    await next()
  } catch (error: any) {
    console.error('[authMiddleware] Error:', error)
    
    // Check if it's a network error
    const isNetworkError = 
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.message?.includes('fetch failed') ||
      error.cause?.code === 'ECONNRESET'
    
    if (isNetworkError) {
      return c.json({ 
        error: 'Service temporarily unavailable', 
        message: 'Unable to verify authentication due to connection issues. Please try again in a moment.',
        retry: true
      }, 503)
    }
    
    return c.json({ error: 'Unauthorized: Token verification failed' }, 401)
  }
}

export function requireRole(allowedRoles: string[]) {
  return async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    const user = c.get('user')
    const path = c.req.path
    const method = c.req.method

    if (!user) {
      console.error(`[requireRole] No user in context for ${method} ${path}`)
      return c.json({ error: 'Unauthorized: User not found in context' }, 401)
    }

    if (!allowedRoles.includes(user.role)) {
      console.error(
        `[requireRole] SECURITY: Access denied for user ${user.email} (${user.id}) ` +
        `with role '${user.role}' attempting ${method} ${path}. ` +
        `Required roles: ${allowedRoles.join(', ')}`
      )
      return c.json(
        { 
          error: 'Forbidden: Insufficient permissions',
          required_roles: allowedRoles,
          your_role: user.role
        },
        403
      )
    }

    await next()
  }
}

/**
 * Middleware to log all incoming requests with authentication info
 */
export async function requestLogger(c: Context<{ Variables: AuthVariables }>, next: Next) {
  const start = Date.now()
  const method = c.req.method
  const path = c.req.path
  const user = c.get('user')
  
  console.log(
    `[Request] ${method} ${path} | User: ${user ? `${user.email} (${user.role})` : 'anonymous'}`
  )
  
  await next()
  
  const duration = Date.now() - start
  console.log(
    `[Response] ${method} ${path} | Status: ${c.res.status} | Duration: ${duration}ms`
  )
}

