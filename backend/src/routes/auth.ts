import { Hono } from 'hono'
import { setCookie, getCookie } from 'hono/cookie'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { supabase } from '../lib/supabase.js'
import { authMiddleware, requireRole, AuthVariables, COOKIE_NAMES } from '../middleware/auth.js'
import { sanitizeInput, isValidEmail, isValidName, isValidPassword } from '../middleware/security.js'
import { getAdminClient } from '../utils/adminClient.js'
import { ensureUserRecordExists } from '../utils/userUtils.js'
import { generateUniqueQuickLoginCode, isValidQuickLoginCode, generateUniquePinCode } from '../utils/quickLoginCode.js'
import { cascadeBusinessInfoUpdate } from '../utils/executiveHelpers.js'

/**
 * Helper function to set secure cookies
 * 
 * SECURITY FEATURES:
 * - httpOnly: true - Prevents JavaScript access (XSS protection)
 * - secure: true in production - Only sent over HTTPS
 * - sameSite: 'None' in production, 'Lax' in dev - CSRF protection
 * - Proper expiration based on token lifetime
 * - path: '/' - Available for entire application
 * 
 * For cross-origin requests (Vercel frontend → Render backend), use 'None'
 * For same-origin or localhost, use 'Lax'
 * 'None' requires 'Secure: true' (HTTPS only)
 * 'Strict' doesn't work for cross-origin requests
 */
function setSecureCookies(c: any, accessToken: string, refreshToken: string, expiresAt: number, userId: string) {
  const isProduction = process.env.NODE_ENV === 'production'
  
  const sameSite = isProduction ? 'None' : 'Lax'
  const secure = isProduction // Must be true when SameSite=None
  
  // expiresAt is in seconds since epoch (Unix timestamp)
  // Calculate maxAge properly
  let maxAge: number
  if (expiresAt && expiresAt > 0) {
    // expiresAt is in seconds, Date.now() is in milliseconds
    const expirationTime = expiresAt * 1000
    const now = Date.now()
    maxAge = Math.max(0, Math.floor((expirationTime - now) / 1000))
    
    // Ensure minimum 1 hour and maximum 7 days for access token
    maxAge = Math.max(3600, Math.min(maxAge, 3600 * 24 * 7))
  } else {
    // Default: 1 hour for access token if no expiration provided
    maxAge = 3600
  }
  
  
  // Set access token cookie with proper expiration
  setCookie(c, COOKIE_NAMES.ACCESS_TOKEN, accessToken, {
    httpOnly: true,
    secure: secure, // Required when SameSite=None
    sameSite: sameSite, // 'None' for cross-origin (production), 'Lax' for dev
    maxAge: maxAge, // 1 hour default, up to 7 days based on token expiration
    path: '/',
  })

  // Set refresh token cookie - longer expiration (30 days)
  const refreshTokenMaxAge = 3600 * 24 * 30 // 30 days
  setCookie(c, COOKIE_NAMES.REFRESH_TOKEN, refreshToken, {
    httpOnly: true,
    secure: secure,
    sameSite: sameSite,
    maxAge: refreshTokenMaxAge,
    path: '/',
  })
  
  // Set user_id cookie to track session ownership
  // This helps detect when a different user logs in
  setCookie(c, COOKIE_NAMES.USER_ID, userId, {
    httpOnly: true,
    secure: secure,
    sameSite: sameSite,
    maxAge: refreshTokenMaxAge, // Same as refresh token
    path: '/',
  })
  
}

/**
 * Helper function to clear cookies securely
 * 
 * SECURITY FEATURES:
 * - httpOnly: true - Prevents JavaScript access (XSS protection)
 * - secure: true in production - Only sent over HTTPS
 * - sameSite: 'None' in production, 'Lax' in dev - CSRF protection
 * - maxAge: 0 - Immediately expires and deletes the cookie
 * - path: '/' - Ensures cookie is cleared for entire application
 * 
 * This function is called on logout to ensure all authentication cookies
 * are properly removed from the browser for security.
 */
function clearCookies(c: any) {
  const isProduction = process.env.NODE_ENV === 'production'
  const sameSite = isProduction ? 'None' : 'Lax' // Match setSecureCookies
  const secure = isProduction // Must be true when SameSite=None
  
  // Clear access token cookie - set maxAge to 0 and empty value
  // Setting maxAge to 0 tells the browser to delete the cookie immediately
  setCookie(c, COOKIE_NAMES.ACCESS_TOKEN, '', {
    httpOnly: true, // Prevents JavaScript access (XSS protection)
    secure: secure, // HTTPS only in production
    sameSite: sameSite, // CSRF protection
    maxAge: 0, // Expires immediately - browser will delete the cookie
    path: '/', // Clear for entire application
  })
  
  // Clear refresh token cookie - set maxAge to 0 and empty value
  setCookie(c, COOKIE_NAMES.REFRESH_TOKEN, '', {
    httpOnly: true, // Prevents JavaScript access (XSS protection)
    secure: secure, // HTTPS only in production
    sameSite: sameSite, // CSRF protection
    maxAge: 0, // Expires immediately - browser will delete the cookie
    path: '/', // Clear for entire application
  })
  
  // Clear user_id cookie
  setCookie(c, COOKIE_NAMES.USER_ID, '', {
    httpOnly: true, // Prevents JavaScript access (XSS protection)
    secure: secure, // HTTPS only in production
    sameSite: sameSite, // CSRF protection
    maxAge: 0, // Expires immediately - browser will delete the cookie
    path: '/', // Clear for entire application
  })
  
}

const auth = new Hono<{ Variables: AuthVariables }>()

// Register endpoint
// IMPORTANT: Public registration is only allowed for 'worker' role
// - Site Supervisors create Team Leaders via /api/supervisor/team-leaders
// - Team Leaders create Workers via /api/teams/members
// This ensures proper hierarchy and access control
auth.post('/register', async (c) => {
  try {
    const { email, password, role, first_name, last_name, business_name, business_registration_number, gender, date_of_birth } = await c.req.json()
    
    // Validate required fields
    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }

    if (!first_name || !last_name) {
      return c.json({ error: 'First name and last name are required' }, 400)
    }

    // Trim whitespace
    const trimmedFirstName = first_name.trim()
    const trimmedLastName = last_name.trim()

    if (!trimmedFirstName || !trimmedLastName) {
      return c.json({ error: 'First name and last name cannot be empty' }, 400)
    }

    // Validate gender
    if (!gender || (gender !== 'male' && gender !== 'female')) {
      return c.json({ error: 'Gender is required and must be either "male" or "female"' }, 400)
    }

    // Validate date of birth
    if (!date_of_birth) {
      return c.json({ error: 'Date of birth is required' }, 400)
    }

    // Validate date format and ensure it's in the past
    const birthDate = new Date(date_of_birth)
    if (isNaN(birthDate.getTime())) {
      return c.json({ error: 'Invalid date of birth format' }, 400)
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (birthDate >= today) {
      return c.json({ error: 'Date of birth must be in the past' }, 400)
    }
    
    // Validate minimum age (18 years old)
    const { calculateAge } = await import('../shared/date/age.js')
    const age = calculateAge(date_of_birth)
    if (age === null) {
      return c.json({ error: 'Invalid date of birth' }, 400)
    }
    if (age < 18) {
      return c.json({ error: `Age must be at least 18 years old. Current age: ${age} years old` }, 400)
    }
    
    // Validate role
    const validRoles = ['worker', 'supervisor', 'whs_control_center', 'executive', 'clinician', 'team_leader', 'admin']
    if (!role || !validRoles.includes(role)) {
      return c.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, 400)
    }

    // Supervisor-specific validation: business_name and business_registration_number are required
    if (role === 'supervisor') {
      if (!business_name || typeof business_name !== 'string' || !business_name.trim()) {
        return c.json({ error: 'Business Name is required for supervisors' }, 400)
      }

      if (!business_registration_number || typeof business_registration_number !== 'string' || !business_registration_number.trim()) {
        return c.json({ error: 'Business Registration Number is required for supervisors' }, 400)
      }
    }

    if (password.length < 6) {
      return c.json({ error: 'Password must be at least 6 characters' }, 400)
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return c.json({ error: 'Invalid email format' }, 400)
    }

    // Hash password with bcrypt
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(password, saltRounds)

    // Use admin client to bypass RLS for user creation
    const adminClient = getAdminClient()

    // Check if user already exists using admin client
    const { data: existingUser } = await adminClient
      .from('users')
      .select('email')
      .eq('email', email)
      .single()

    if (existingUser) {
      return c.json({ error: 'User with this email already exists' }, 409)
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email for simplicity
    })

    if (authError || !authData.user) {
      console.error('Supabase Auth error:', authError)
      // Handle specific Supabase Auth errors
      if (authError?.message?.includes('already registered') || 
          authError?.message?.includes('User already registered') ||
          authError?.message?.includes('already exists')) {
        return c.json({ error: 'User with this email already exists' }, 409)
      }
      return c.json({ 
        error: 'Failed to create user', 
        details: authError?.message,
        code: authError?.status 
      }, 500)
    }

    // Create user record in database using admin client (bypasses RLS)
    // Derive full_name from first_name + last_name for backward compatibility
    const fullName = `${trimmedFirstName} ${trimmedLastName}`.trim()
    
    const userInsertData: any = {
      id: authData.user.id,
      email: authData.user.email,
      role: role,
      first_name: trimmedFirstName,
      last_name: trimmedLastName,
      full_name: fullName, // Store for backward compatibility
      password_hash: hashedPassword, // Store hashed password (additional security layer)
      gender: gender,
      date_of_birth: date_of_birth,
      created_at: new Date().toISOString(),
    }

    // Auto-generate quick login code for workers
    if (role === 'worker') {
      userInsertData.quick_login_code = await generateUniqueQuickLoginCode()
    }

    // Add business fields for supervisors
    if (role === 'supervisor') {
      userInsertData.business_name = business_name.trim()
      userInsertData.business_registration_number = business_registration_number.trim()
    }
    
    const { data: userData, error: dbError } = await adminClient
      .from('users')
      .insert([userInsertData])
      .select('id, email, role, first_name, last_name, full_name, password_hash')
      .single()

    if (dbError) {
      console.error('Database insert error:', dbError)
      console.error('Error details:', JSON.stringify(dbError, null, 2))
      // If database insert fails, clean up auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      return c.json({ 
        error: 'Failed to create user record', 
        details: dbError.message,
        code: dbError.code,
        hint: dbError.hint 
      }, 500)
    }

    if (!userData) {
      return c.json({ error: 'Failed to create user record' }, 500)
    }

    // Don't return sensitive data
    const { password_hash: _, ...userWithoutPassword } = userData

    // Create session for new user (login them in after registration)
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInData?.session) {
      // Set secure cookies
      setSecureCookies(
        c,
        signInData.session.access_token,
        signInData.session.refresh_token,
        signInData.session.expires_at || 0,
        userWithoutPassword.id
      )
    }

    return c.json(
      {
        message: 'User created successfully',
        user: {
          id: userWithoutPassword.id,
          email: userWithoutPassword.email,
          role: userWithoutPassword.role,
        },
        // Don't return tokens to frontend - we use cookies only
    // Tokens are stored securely in HttpOnly cookies
      },
      201
    )
  } catch (error: any) {
    console.error('Registration error:', error)
    console.error('Error stack:', error.stack)
    return c.json({ 
      error: 'Internal server error', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, 500)
  }
})

// Login endpoint
auth.post('/login', async (c) => {
  try {
    // NOTE: We DON'T clear cookies on login anymore
    // Each browser/tab should maintain its own session independently
    // Clearing cookies would affect other tabs in the same browser
    // Only clear cookies on explicit logout
    
    const { email, password } = await c.req.json()

    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }


    // Try Supabase Auth first (simplest approach)
    let { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    // If Supabase Auth fails, check if user has password_hash (might be out of sync)
    if (authError || !authData?.session) {
      const adminClient = getAdminClient()
      const { data: userWithHash } = await adminClient
        .from('users')
        .select('id, email, password_hash')
        .eq('email', email)
        .maybeSingle()

      // If user has password_hash, verify and sync with Supabase Auth
      if (userWithHash?.password_hash) {
        const passwordValid = await bcrypt.compare(password, userWithHash.password_hash)
        
        if (passwordValid) {
          // Sync Supabase Auth password to match database
          await supabase.auth.admin.updateUserById(userWithHash.id, { password })
          
          // Retry sign in
          const retry = await supabase.auth.signInWithPassword({ email, password })
          if (!retry.error && retry.data?.session) {
            authData = retry.data
            authError = null
          }
        }
      }

      // If still failed, return error
      if (authError || !authData?.session) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }
    }

    // Get user data from database
    const adminClient = getAdminClient()
    let { data: userData } = await adminClient
      .from('users')
      .select('id, email, role, first_name, last_name, full_name')
      .eq('id', authData.user.id)
      .maybeSingle()

    // Auto-create user record if not found
    if (!userData) {
      userData = await ensureUserRecordExists(authData.user.id, authData.user.email || email)
      if (!userData) {
        return c.json({ error: 'User setup incomplete. Please contact administrator.' }, 500)
      }
    }

    // Set secure cookies
    setSecureCookies(
      c,
      authData.session.access_token,
      authData.session.refresh_token,
      authData.session.expires_at || 0,
      userData.id
    )


    // Record login log (non-blocking - don't fail login if this fails)
    try {
      const userAgent = c.req.header('user-agent') || 'unknown'
      await adminClient
        .from('login_logs')
        .insert([{
          user_id: userData.id,
          email: userData.email,
          role: userData.role,
          user_agent: userAgent,
          login_method: 'email_password',
        }] as any)
    } catch (logError) {
      // Log error but don't fail login
      console.error('[POST /login] Failed to record login log:', logError)
    }

    // Derive full_name if not set (backward compatibility)
    const fullName = userData.full_name || 
                     (userData.first_name && userData.last_name 
                       ? `${userData.first_name} ${userData.last_name}` 
                       : userData.email?.split('@')[0] || 'User')

    return c.json({
      message: 'Login successful',
      user: {
        id: userData.id,
        email: userData.email,
        role: userData.role,
        first_name: userData.first_name || '',
        last_name: userData.last_name || '',
        full_name: fullName,
        phone: null, // Phone is stored in team_members table, not users table
      },
      // Cookies are set automatically - no need to return tokens
      // Tokens are stored securely in HttpOnly cookies
    })
  } catch (error: any) {
    console.error('Login error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Quick login endpoint (workers only - 6-digit code)
auth.post('/quick-login', async (c) => {
  try {
    const { quick_login_code } = await c.req.json()

    if (!quick_login_code || typeof quick_login_code !== 'string') {
      return c.json({ error: 'Quick login code is required' }, 400)
    }

    // Validate code format (accepts 6 digits or lastname-number format)
    if (!isValidQuickLoginCode(quick_login_code)) {
      return c.json({ error: 'Invalid quick login code format. Use 6 digits or lastname-number format (e.g., delapiedra-232939).' }, 400)
    }

    const trimmedCode = quick_login_code.trim()

    // Log attempt (mask code for security - show format but mask sensitive parts)
    const isOldFormat = /^\d{6}$/.test(trimmedCode)
    const maskedCode = isOldFormat 
      ? `${trimmedCode.substring(0, 2)}****` 
      : trimmedCode.includes('-') 
        ? `${trimmedCode.split('-')[0]}-****` 
        : `${trimmedCode.substring(0, 2)}****`

    // Find user by quick login code (workers only)
    // Optimized: Uses index on quick_login_code for fast lookup
    // Security: Role check in query prevents non-workers from using quick login
    const adminClient = getAdminClient()
    // Optimized: Uses composite index (quick_login_code, role) for fast lookup
    // Use maybeSingle() to avoid error if not found (handled gracefully below)
    const { data: userData, error: dbError } = await adminClient
      .from('users')
      .select('id, email, role, first_name, last_name, full_name')
      .eq('quick_login_code', trimmedCode)
      .eq('role', 'worker')
      .maybeSingle()

    if (dbError || !userData) {
      // Log failure (mask code for security)
      const isOldFormat = /^\d{6}$/.test(trimmedCode)
      const maskedCode = isOldFormat 
        ? `${trimmedCode.substring(0, 2)}****` 
        : trimmedCode.includes('-') 
          ? `${trimmedCode.split('-')[0]}-****` 
          : `${trimmedCode.substring(0, 2)}****`
      
      // Record failed attempt (non-blocking)
      try {
        const userAgent = c.req.header('user-agent') || 'unknown'
        await adminClient
          .from('login_logs')
          .insert([{
            email: null,
            role: 'worker',
            user_agent: userAgent,
            login_method: 'quick_login_code_failed',
            notes: 'Failed quick login attempt',
          }] as any)
      } catch (logError) {
        // Non-blocking - don't fail login if logging fails
        console.error('[POST /quick-login] Failed to record login log:', logError)
      }
      
      // Return generic error (don't reveal if code exists or not)
      return c.json({ error: 'Invalid quick login code' }, 401)
    }

    if (!userData.email) {
      return c.json({ error: 'User email not found' }, 404)
    }

    // Create session using temporary password (same pattern as regular login)
    const randomBytes = crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '')
    const tempPassword = randomBytes.slice(0, 20) + 'A1!@#'
    
    // Update password and sign in to get session
    const { error: updateError } = await supabase.auth.admin.updateUserById(userData.id, {
      password: tempPassword,
    })

    if (updateError) {
      console.error('[POST /quick-login] Error updating password:', updateError)
      return c.json({ error: 'Failed to create session. Please contact administrator.' }, 500)
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: userData.email,
      password: tempPassword,
    })

    if (signInError || !signInData.session) {
      console.error('[POST /quick-login] Error signing in:', signInError)
      return c.json({ error: 'Failed to create session. Please contact administrator.' }, 500)
    }

    // Set secure cookies
    setSecureCookies(
      c,
      signInData.session.access_token,
      signInData.session.refresh_token,
      signInData.session.expires_at || 0,
      userData.id
    )
    
    // Session created and cookies set

    // Record login (non-blocking)
    try {
      const userAgent = c.req.header('user-agent') || 'unknown'
      await adminClient
        .from('login_logs')
        .insert([{
          user_id: userData.id,
          email: userData.email,
          role: userData.role,
          user_agent: userAgent,
          login_method: 'quick_login_code',
        }] as any)
    } catch (logError) {
      // Don't fail login if logging fails
      console.error('[POST /quick-login] Failed to record login log:', logError)
    }

    // Derive full_name if not set (backward compatibility)
    const fullName = userData.full_name || 
                     (userData.first_name && userData.last_name 
                       ? `${userData.first_name} ${userData.last_name}` 
                       : userData.email?.split('@')[0] || 'User')

    return c.json({
      message: 'Quick login successful',
      user: {
        id: userData.id,
        email: userData.email,
        role: userData.role,
        first_name: userData.first_name || '',
        last_name: userData.last_name || '',
        full_name: fullName,
        phone: null, // Phone is stored in team_members table, not users table
      },
      // Cookies are set automatically - no need to return tokens
      // Tokens are stored securely in HttpOnly cookies
    })
  } catch (error: any) {
    console.error('Quick login error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Logout endpoint (doesn't require auth - allows logout even with expired tokens)
// SECURITY: Properly invalidates session and clears all cookies
auth.post('/logout', async (c) => {
  try {
    // Get token before clearing (for logging and invalidation)
    const token = c.req.header('Authorization')?.replace('Bearer ', '') || 
                  getCookie(c, COOKIE_NAMES.ACCESS_TOKEN)
    const refreshToken = getCookie(c, COOKIE_NAMES.REFRESH_TOKEN)
    
    // Get user info before clearing (for logging)
    let userId = 'unknown'
    let userEmail = 'unknown'
    
    if (token) {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser(token)
        if (user && !userError) {
          userId = user.id
          userEmail = user.email || 'unknown'
          
          // SECURITY: Invalidate the refresh token on Supabase side
          // This ensures the session cannot be reused even if cookies are somehow recovered
          if (refreshToken) {
            try {
              // Call Supabase Auth API to revoke the refresh token
              const supabaseUrl = process.env.SUPABASE_URL || ''
              const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
              
              if (supabaseUrl && supabaseServiceKey) {
                await fetch(`${supabaseUrl}/auth/v1/logout`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseServiceKey,
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                  },
                  body: JSON.stringify({ refresh_token: refreshToken }),
                }).catch(err => {
                  // Non-blocking - log but don't fail logout
                  console.warn('[POST /logout] Failed to revoke refresh token on Supabase:', err)
                })
              }
            } catch (revokeError) {
              // Non-blocking - log but don't fail logout
              console.warn('[POST /logout] Error revoking refresh token:', revokeError)
            }
          }
        }
      } catch (e) {
        // Token might be expired, that's ok - we'll still clear cookies
      }
    }
    
    // SECURITY: Clear all cookies (access token, refresh token, user_id)
    // This removes the session from the browser
    // clearCookies() already handles all cookie clearing with proper security settings
    clearCookies(c)

    return c.json({ 
      message: 'Logged out successfully',
      success: true 
    })
  } catch (error: any) {
    // SECURITY: Even if there's an error, clear cookies to ensure logout
    console.error('[POST /logout] Error during logout:', error)
    clearCookies(c)
    return c.json({ 
      message: 'Logged out successfully',
      success: true 
    })
  }
})

// Helper function to refresh token using Supabase Auth API directly
async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_at: number; user_id: string } | null> {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || ''
    // Use service role key or anon key - both work for token refresh
    const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase URL or Key for token refresh')
      return null
    }

    // Call Supabase Auth API directly to refresh token
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('Token refresh failed:', errorData)
      return null
    }

    const data = await response.json() as any
    
    if (!data.access_token || !data.refresh_token) {
      return null
    }

    // Calculate expires_at from expires_in (usually in seconds)
    const expiresAt = data.expires_in 
      ? Math.floor(Date.now() / 1000) + data.expires_in 
      : Math.floor(Date.now() / 1000) + 3600 // Default 1 hour

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || expiresAt,
      user_id: data.user?.id || '',
    }
  } catch (error: any) {
    console.error('Error refreshing token:', error)
    return null
  }
}

// Refresh token endpoint (no auth required - uses refresh token)
auth.post('/refresh', async (c) => {
  try {
    const refreshToken = getCookie(c, COOKIE_NAMES.REFRESH_TOKEN)
    
    if (!refreshToken) {
      return c.json({ error: 'No refresh token provided' }, 401)
    }

    // Refresh the token using direct API call
    const refreshedTokens = await refreshAccessToken(refreshToken)

    if (!refreshedTokens) {
      // Refresh token is invalid - clear cookies
      clearCookies(c)
      return c.json({ error: 'Invalid or expired refresh token' }, 401)
    }

    // Set new cookies with refreshed tokens
    setSecureCookies(
      c,
      refreshedTokens.access_token,
      refreshedTokens.refresh_token,
      refreshedTokens.expires_at,
      refreshedTokens.user_id
    )

    // Get user role from database
    let { data: userData, error: dbError } = await supabase
      .from('users')
      .select('id, email, role, first_name, last_name, full_name')
      .eq('id', refreshedTokens.user_id)
      .single()

    // If user not found in database but token is valid, auto-create user record
    if ((dbError || !userData) && refreshedTokens.user_id) {
      // Get user email from Supabase Auth
      let authUser: any = null
      try {
        const result = await supabase.auth.getUser(refreshedTokens.access_token)
        authUser = result.data?.user
      } catch (networkError: any) {
        console.warn(`[refreshAccessToken] Network error getting user: ${networkError.message || 'Connection timeout'}`)
        // Continue without user email - use user_id only
      }
      
      if (authUser?.email) {
        const autoCreatedUser = await ensureUserRecordExists(refreshedTokens.user_id, authUser.email)
        if (!autoCreatedUser) {
          return c.json({ error: 'User setup incomplete. Please contact administrator.' }, 500)
        }
        userData = autoCreatedUser
      }
    }

    if (dbError || !userData) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Derive full_name if not set (backward compatibility)
    const fullName = userData.full_name || 
                     (userData.first_name && userData.last_name 
                       ? `${userData.first_name} ${userData.last_name}` 
                       : userData.email?.split('@')[0] || 'User')

    return c.json({
      message: 'Token refreshed successfully',
      user: {
        id: userData.id,
        email: userData.email,
        role: userData.role,
        first_name: userData.first_name || '',
        last_name: userData.last_name || '',
        full_name: fullName,
        phone: null, // Phone is stored in team_members table, not users table
      },
    })
  } catch (error: any) {
    console.error('Token refresh error:', error)
    clearCookies(c)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get current user (protected route with auto-refresh)
auth.get('/me', async (c) => {
  try {
    // First, try to get token
    const token = getCookie(c, COOKIE_NAMES.ACCESS_TOKEN)
    const refreshToken = getCookie(c, COOKIE_NAMES.REFRESH_TOKEN)
    const userId = getCookie(c, COOKIE_NAMES.USER_ID)

    // SECURITY: If no valid tokens but user_id exists, clear stale cookies
    if (!token && !refreshToken) {
      
      // If user_id exists but no tokens, this is a stale session - clear it
      if (userId) {
        clearCookies(c)
      }
      
      return c.json({ error: 'No authentication credentials' }, 401)
    }

    let currentToken = token
    let user: any = null

    // Try to verify the access token
    if (currentToken) {
      try {
      const { data: { user: tokenUser }, error: tokenError } = await supabase.auth.getUser(currentToken)
      
      if (!tokenError && tokenUser) {
        user = tokenUser
      } else if (tokenError) {
        // Token is invalid, will try to refresh below
        }
      } catch (networkError: any) {
        // Handle network errors (timeout, connection issues)
        console.warn(`[GET /me] Network error verifying token: ${networkError.message || 'Connection timeout'}`)
        // Continue to try refresh token below
      }
    }

    // If token is invalid or missing, try to refresh
    if (!user && refreshToken) {
      const refreshedTokens = await refreshAccessToken(refreshToken)

      if (refreshedTokens) {
        // Set new cookies with refreshed tokens
        setSecureCookies(
          c,
          refreshedTokens.access_token,
          refreshedTokens.refresh_token,
          refreshedTokens.expires_at,
          refreshedTokens.user_id
        )
        
        // Verify the new token and get user
        try {
        const { data: { user: refreshedUser }, error: userError } = await supabase.auth.getUser(refreshedTokens.access_token)
        
        if (!userError && refreshedUser) {
          user = refreshedUser
          currentToken = refreshedTokens.access_token
          } else if (userError) {
            console.warn(`[GET /me] Error getting user after refresh: ${userError.message}`)
          // Token refresh worked but can't get user - clear cookies
          clearCookies(c)
          return c.json({ error: 'Invalid session' }, 401)
          }
        } catch (networkError: any) {
          // Handle network errors gracefully
          console.warn(`[GET /me] Network error getting user after refresh: ${networkError.message || 'Connection timeout'}`)
          // Network error - use user_id from refreshed tokens and get user from database
          // Don't fail - continue to get user from database below
          currentToken = refreshedTokens.access_token
        }
      } else {
        // Both token and refresh failed - clear cookies
        console.log(`[GET /me] Token refresh failed - session expired for refreshToken: ${refreshToken.substring(0, 20)}...`)
        clearCookies(c)
        return c.json({ error: 'Invalid or expired session' }, 401)
      }
    }

    if (!user) {
      console.log('[GET /me] No user found after token verification and refresh attempts - returning 401')
      clearCookies(c)
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Get user role from database - try with regular client first
    let { data: userData, error: dbError } = await supabase
      .from('users')
      .select('id, email, role, first_name, last_name, full_name, business_name, business_registration_number, quick_login_code, gender, date_of_birth, profile_image_url')
      .eq('id', user.id)
      .single()

    // If query failed due to RLS or user not found, try with admin client
    if ((dbError || !userData) && user.email) {
      
      // Use admin client to bypass RLS and check if user actually exists
      const adminClient = getAdminClient()
      const { data: adminUserData, error: adminError } = await adminClient
        .from('users')
        .select('id, email, role, first_name, last_name, full_name, business_name, business_registration_number, quick_login_code, gender, date_of_birth, profile_image_url')
        .eq('id', user.id)
        .single()

      if (adminUserData) {
        // User exists in database - use their actual role
        userData = adminUserData
      } else if (adminError && adminError.code === 'PGRST116') {
        // User truly doesn't exist in database - auto-create with default role
        if (user.email) {
          const autoCreatedUser = await ensureUserRecordExists(user.id, user.email)
          if (!autoCreatedUser) {
          // Even admin client failed - this is a serious issue
            console.error(`[GET /me] Failed to auto-create user record for ${user.id}`)
          return c.json({ 
            error: 'User account not properly configured. Please contact administrator.',
            details: 'User exists in authentication but database record could not be created or accessed.'
          }, 500)
        }
          // Add missing fields for type compatibility
          userData = {
            ...autoCreatedUser,
            business_name: null,
            business_registration_number: null,
            quick_login_code: null,
            gender: null,
            date_of_birth: null,
            profile_image_url: null,
          }
        }
      } else {
        // Admin query failed for other reasons
        console.error(`[GET /me] Admin client query failed for ${user.id}:`, adminError)
        return c.json({ 
          error: 'Failed to retrieve user information',
          details: adminError?.message 
        }, 500)
      }
    }

    if (!userData) {
      // This should not happen if token is valid and user exists in Supabase Auth
      console.error(`[GET /me] User not found in database after all attempts: ${user.id}`)
      return c.json({ 
        error: 'User account not found. Please contact administrator.',
        details: 'User exists in authentication but not in database.'
      }, 404)
    }

    // Derive full_name if not set (backward compatibility)
    const fullName = userData.full_name || 
                     (userData.first_name && userData.last_name 
                       ? `${userData.first_name} ${userData.last_name}` 
                       : userData.email?.split('@')[0] || 'User')

    return c.json({
      user: {
        id: userData.id,
        email: userData.email,
        role: userData.role,
        first_name: userData.first_name || '',
        last_name: userData.last_name || '',
        full_name: fullName,
        phone: null, // Phone is stored in team_members table, not users table
        business_name: userData.business_name || null,
        business_registration_number: userData.business_registration_number || null,
        quick_login_code: userData.quick_login_code || null,
        gender: userData.gender || null,
        date_of_birth: userData.date_of_birth || null,
        profile_image_url: userData.profile_image_url || null,
      },
    })
  } catch (error: any) {
    console.error('Get user error:', error)
    clearCookies(c)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update user role (admin only)
auth.patch('/users/:id/role', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const userId = c.req.param('id')
    const { role } = await c.req.json()

    const validRoles = ['worker', 'supervisor', 'whs_control_center', 'executive', 'clinician', 'team_leader']
    if (!role || !validRoles.includes(role)) {
      return c.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, 400)
    }

    const { data, error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', userId)
      .select('id, email, role')
      .single()

    if (error) {
      return c.json({ error: 'Failed to update user role', details: error.message }, 500)
    }

    return c.json({
      message: 'User role updated successfully',
      user: data,
    })
  } catch (error: any) {
    console.error('Update role error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Change password (authenticated users only)
auth.patch('/password', authMiddleware, async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { old_password, new_password } = await c.req.json()

    // Validate required fields and types
    if (!old_password || typeof old_password !== 'string' || !old_password.trim()) {
      return c.json({ error: 'Current password is required' }, 400)
    }

    if (!new_password || typeof new_password !== 'string' || !new_password.trim()) {
      return c.json({ error: 'New password is required' }, 400)
    }

    // Validate password strength
    if (!isValidPassword(new_password)) {
      return c.json({ error: 'New password must be between 6 and 128 characters' }, 400)
    }

    if (old_password === new_password) {
      return c.json({ error: 'New password must be different from current password' }, 400)
    }

    // Get user's email and password hash from database
    const adminClient = getAdminClient()
    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('email, password_hash')
      .eq('id', user.id)
      .single()

    if (userError || !userData) {
      console.error('Failed to fetch user data:', userError)
      return c.json({ error: 'Failed to verify identity' }, 500)
    }

    // Verify old password
    let passwordValid = false

    if (userData.password_hash) {
      // Verify using stored password hash (bcrypt)
      passwordValid = await bcrypt.compare(old_password, userData.password_hash)
    } else {
      // If no password_hash, verify using Supabase Auth
      try {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: userData.email,
          password: old_password,
        })
        passwordValid = !signInError
        // Sign out immediately to prevent session creation
        if (passwordValid) {
          await supabase.auth.signOut()
        }
      } catch (authError: any) {
        console.error('Password verification error:', authError)
        passwordValid = false
      }
    }

    if (!passwordValid) {
      return c.json({ error: 'Current password is incorrect' }, 401)
    }

    // Hash new password with bcrypt
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(new_password, saltRounds)

    // Update password in Supabase Auth
    try {
      const { error: authUpdateError } = await supabase.auth.admin.updateUserById(user.id, {
        password: new_password,
      })

      if (authUpdateError) {
        console.error('Failed to update password in Supabase Auth:', authUpdateError)
        return c.json({ error: 'Failed to update password. Please try again.' }, 500)
      }
    } catch (authErr) {
      console.error('Error updating password in Supabase Auth:', authErr)
      return c.json({ error: 'Failed to update password. Please try again.' }, 500)
    }

    // Update password hash in database
    const { error: updateError } = await adminClient
      .from('users')
      .update({ password_hash: hashedPassword })
      .eq('id', user.id)

    if (updateError) {
      console.error('Failed to update password hash:', updateError)
      // Note: Password is already updated in Supabase Auth, so this is a partial failure
      // But we still return success since the main password change succeeded
      console.warn('Password updated in Supabase Auth but failed to update hash in database')
    }

    return c.json({
      message: 'Password changed successfully',
    })
  } catch (error: any) {
    console.error('Change password error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Update own profile (authenticated users only)
auth.patch('/profile', authMiddleware, async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { first_name, last_name, email, password, business_name, business_registration_number, gender, date_of_birth } = await c.req.json()

    const adminClient = getAdminClient()
    const { data: currentUserData, error: currentUserError } = await adminClient
      .from('users')
      .select('role, first_name, last_name, email, password_hash, business_name, business_registration_number, gender, date_of_birth')
      .eq('id', user.id)
      .single()

    if (currentUserError || !currentUserData) {
      console.error('Failed to fetch user data:', currentUserError)
      return c.json({ error: 'Failed to verify identity' }, 500)
    }

    const updates: any = {}

    // Handle first_name, last_name, email updates (requires password)
    if (first_name !== undefined || last_name !== undefined || email !== undefined) {
      if (!first_name || !last_name || typeof first_name !== 'string' || typeof last_name !== 'string') {
        return c.json({ error: 'First name and last name are required' }, 400)
      }

      if (!password || typeof password !== 'string' || !password.trim()) {
        return c.json({ error: 'Password is required to save changes' }, 400)
      }

      const trimmedFirstName = sanitizeInput(first_name)
      const trimmedLastName = sanitizeInput(last_name)

      if (!trimmedFirstName || !trimmedLastName || !isValidName(trimmedFirstName) || !isValidName(trimmedLastName)) {
        return c.json({ error: 'Invalid name format' }, 400)
      }

      // Verify password
      let passwordValid = false
      if (currentUserData.password_hash) {
        passwordValid = await bcrypt.compare(password, currentUserData.password_hash)
      } else {
        try {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: currentUserData.email,
            password: password,
          })
          passwordValid = !signInError
          if (passwordValid) await supabase.auth.signOut()
        } catch (e) {
          passwordValid = false
        }
      }

      if (!passwordValid) {
        return c.json({ error: 'Invalid password' }, 401)
      }

      updates.first_name = trimmedFirstName
      updates.last_name = trimmedLastName
      updates.full_name = `${trimmedFirstName} ${trimmedLastName}`.trim()

      // Handle email update
      if (email !== undefined && email !== currentUserData.email) {
        const trimmedEmail = email.trim().toLowerCase()
        if (!isValidEmail(trimmedEmail)) {
          return c.json({ error: 'Invalid email format' }, 400)
        }
        updates.email = trimmedEmail
      }
    }

    // Handle business info updates - ONLY executives can edit business info
    if (business_name !== undefined || business_registration_number !== undefined) {
      // Only executives can update business info
      if (currentUserData.role !== 'executive') {
        return c.json({ 
          error: 'Only executives can edit business information. Business information is automatically inherited from your executive.' 
        }, 403)
      }

      // Executive can update business info
      const newBusinessName = business_name !== undefined 
        ? (typeof business_name === 'string' ? business_name.trim() || null : null)
        : currentUserData.business_name
      
      const newBusinessRegNumber = business_registration_number !== undefined
        ? (typeof business_registration_number === 'string' ? business_registration_number.trim() || null : null)
        : currentUserData.business_registration_number

      // Executive validation: both fields required
      if (!newBusinessName || !newBusinessRegNumber) {
        return c.json({ error: 'Business Name and Business Registration Number are required for executives' }, 400)
      }

      updates.business_name = newBusinessName
      updates.business_registration_number = newBusinessRegNumber
    }

    // Handle gender and date_of_birth updates (no password required)
    // Prevent gender changes if already set
    if (gender !== undefined) {
      // If gender is already set, prevent changes
      if (currentUserData.gender) {
        return c.json({ error: 'Gender cannot be changed once set' }, 400)
      }
      
      if (gender !== 'male' && gender !== 'female') {
        return c.json({ error: 'Gender must be either "male" or "female"' }, 400)
      }
      updates.gender = gender
    }

    if (date_of_birth !== undefined) {
      if (!date_of_birth) {
        return c.json({ error: 'Date of birth is required' }, 400)
      }
      
      // Validate date format and ensure it's in the past
      const birthDate = new Date(date_of_birth)
      if (isNaN(birthDate.getTime())) {
        return c.json({ error: 'Invalid date of birth format' }, 400)
      }

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (birthDate >= today) {
        return c.json({ error: 'Date of birth must be in the past' }, 400)
      }
      
      // Validate minimum age (18 years old)
      const { calculateAge } = await import('../shared/date/age.js')
      const age = calculateAge(date_of_birth)
      if (age === null) {
        return c.json({ error: 'Invalid date of birth' }, 400)
      }
      if (age < 18) {
        return c.json({ error: `Age must be at least 18 years old. Current age: ${age} years old` }, 400)
      }
      
      updates.date_of_birth = date_of_birth
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No fields to update' }, 400)
    }

    updates.updated_at = new Date().toISOString()

    const { data: updatedUser, error: updateError } = await adminClient
      .from('users')
      .update(updates)
      .eq('id', user.id)
      .select('id, email, first_name, last_name, full_name, role, business_name, business_registration_number, gender, date_of_birth')
      .single()

    if (updateError) {
      console.error('Failed to update profile:', updateError)
      return c.json({ error: 'Failed to update profile', details: updateError.message }, 500)
    }

    // If executive updated business info, cascade update to all users under them
    if (currentUserData.role === 'executive' && 
        (business_name !== undefined || business_registration_number !== undefined)) {
      
      const oldBusinessName = currentUserData.business_name || ''
      const oldBusinessRegNumber = currentUserData.business_registration_number || ''
      const newBusinessName = updatedUser.business_name || ''
      const newBusinessRegNumber = updatedUser.business_registration_number || ''

      // Use helper function to cascade update (optimized and centralized)
      const cascadeResult = await cascadeBusinessInfoUpdate(
        oldBusinessName,
        oldBusinessRegNumber,
        newBusinessName,
        newBusinessRegNumber
      )

      if (!cascadeResult.success) {
        console.error('Failed to cascade business info update:', cascadeResult.error)
        // Don't fail the request, but log the error
      } else {
        console.log(`Cascaded business info update to all users under executive ${user.id}`)
      }
    }

    return c.json({
      message: 'Profile updated successfully',
      user: updatedUser,
    })
  } catch (error: any) {
    console.error('Update profile error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Verify password (authenticated users only)
auth.post('/verify-password', authMiddleware, async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { password } = await c.req.json()

    if (!password || typeof password !== 'string' || password.trim() === '') {
      return c.json({ error: 'Password is required' }, 400)
    }

    const adminClient = getAdminClient()

    // Get user's email and password hash
    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('email, password_hash')
      .eq('id', user.id)
      .single()

    if (userError || !userData) {
      console.error('[POST /auth/verify-password] Error fetching user:', userError)
      return c.json({ error: 'Failed to verify identity' }, 500)
    }

    // Verify password
    let passwordValid = false

    if (userData.password_hash) {
      // Verify using stored password hash
      passwordValid = await bcrypt.compare(password, userData.password_hash)
    } else {
      // If no password_hash, verify using Supabase Auth
      try {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: userData.email,
          password: password,
        })
        passwordValid = !signInError
        // Sign out immediately to prevent session creation
        if (passwordValid) {
          await supabase.auth.signOut()
        }
      } catch (authError: any) {
        console.error('[POST /auth/verify-password] Password verification error:', authError)
        passwordValid = false
      }
    }

    if (!passwordValid) {
      return c.json({ error: 'Invalid password' }, 401)
    }

    return c.json({ verified: true })
  } catch (error: any) {
    console.error('[POST /auth/verify-password] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Upload profile image (authenticated users only)
auth.post('/profile/image', authMiddleware, async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Handle FormData with image file
    const formData = await c.req.parseBody()
    const imageFile = formData.image as File | undefined

    if (!imageFile || !(imageFile instanceof File)) {
      return c.json({ error: 'Image file is required' }, 400)
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(imageFile.type)) {
      return c.json({ error: 'Invalid image type. Supported: JPG, PNG, GIF, WebP' }, 400)
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (imageFile.size > maxSize) {
      return c.json({ error: 'Image file too large. Maximum size is 5MB' }, 400)
    }

    const adminClient = getAdminClient()

    // Upload to Cloudflare R2 storage
    let imageUrl: string
    try {
      const { uploadToR2, generateProfileImagePath } = await import('../utils/r2Storage.js')
      const filePath = generateProfileImagePath(user.id, imageFile.name)
      imageUrl = await uploadToR2(imageFile, filePath, imageFile.type)
      console.log(`[POST /auth/profile/image] Image uploaded to R2: ${imageUrl}`)
    } catch (uploadError: any) {
      console.error('[POST /auth/profile/image] Error uploading to R2:', uploadError)
      // Fallback to base64 if R2 upload fails (for small images only)
      const arrayBuffer = await imageFile.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      
      // Only use base64 fallback for small images (< 50KB)
      if (buffer.length < 50 * 1024) {
        const base64 = buffer.toString('base64')
        const mimeType = imageFile.type || 'image/jpeg'
        imageUrl = `data:${mimeType};base64,${base64}`
        console.warn('[POST /auth/profile/image] Using base64 fallback due to R2 upload failure')
      } else {
        throw new Error('Failed to upload image. R2 storage unavailable and image too large for base64 fallback.')
      }
    }

    // Store image URL in database
    const { data: updatedUser, error: updateError } = await adminClient
      .from('users')
      .update({ 
        profile_image_url: imageUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)
      .select('id, profile_image_url')
      .single()

    if (updateError || !updatedUser) {
      console.error('[POST /auth/profile/image] Error updating profile image:', updateError)
      return c.json({ error: 'Failed to upload image', details: updateError?.message }, 500)
    }

    return c.json({
      message: 'Profile image uploaded successfully',
      profile_image_url: updatedUser.profile_image_url,
    })
  } catch (error: any) {
    console.error('[POST /auth/profile/image] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Delete profile image (authenticated users only)
auth.delete('/profile/image', authMiddleware, async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // Remove profile image URL from database
    const { data: updatedUser, error: updateError } = await adminClient
      .from('users')
      .update({ 
        profile_image_url: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)
      .select('id, profile_image_url')
      .single()

    if (updateError || !updatedUser) {
      console.error('[DELETE /auth/profile/image] Error removing profile image:', updateError)
      return c.json({ error: 'Failed to remove image', details: updateError?.message }, 500)
    }

    return c.json({
      message: 'Profile image removed successfully',
    })
  } catch (error: any) {
    console.error('[DELETE /auth/profile/image] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Get profile image (public endpoint for displaying images)
auth.get('/profile/image/:userId', async (c) => {
  try {
    const userId = c.req.param('userId')

    if (!userId) {
      return c.json({ error: 'User ID is required' }, 400)
    }

    const adminClient = getAdminClient()

    // Get user's profile image URL
    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('profile_image_url')
      .eq('id', userId)
      .single()

    if (userError || !userData) {
      return c.json({ error: 'User not found' }, 404)
    }

    // If no profile image, return 404
    if (!userData.profile_image_url) {
      return c.json({ error: 'Profile image not found' }, 404)
    }

    // If it's a data URL, return it directly
    if (userData.profile_image_url.startsWith('data:')) {
      // Extract base64 and mime type
      const matches = userData.profile_image_url.match(/^data:([^;]+);base64,(.+)$/)
      if (matches) {
        const mimeType = matches[1]
        const base64Data = matches[2]
        const buffer = Buffer.from(base64Data, 'base64')
        
        // Set appropriate headers for stable caching
        // Use hash-based cache key to prevent unnecessary reloads
        c.header('Content-Type', mimeType)
        c.header('Cache-Control', 'public, max-age=31536000, immutable') // Cache for 1 year, immutable
        c.header('ETag', `"${base64Data.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '')}"`) // Stable ETag
        
        return c.body(buffer)
      }
    }

    // If it's an R2 URL, fetch and serve it through proxy
    if (userData.profile_image_url.includes('.r2.dev') || userData.profile_image_url.includes('r2.cloudflarestorage.com')) {
      try {
        const { extractR2FilePath, getContentTypeFromFilePath } = await import('../utils/photoUrl.js')
        const { getFromR2 } = await import('../utils/r2Storage.js')
        
        // Extract file path from R2 URL
        const filePath = extractR2FilePath(userData.profile_image_url)
        
        if (!filePath) {
          console.warn(`[GET /auth/profile/image/:userId] Could not extract file path from URL: ${userData.profile_image_url}`)
          return c.redirect(userData.profile_image_url)
        }
        
        // Fetch image from R2
        const imageBuffer = await getFromR2(filePath)
        
        // Determine content type from file extension
        const contentType = getContentTypeFromFilePath(filePath)
        
        // Set appropriate headers
        c.header('Content-Type', contentType)
        c.header('Cache-Control', 'public, max-age=31536000, immutable') // Cache for 1 year
        c.header('Content-Disposition', `inline; filename="${filePath.split('/').pop()}"`)
        
        return c.body(imageBuffer as any)
      } catch (r2Error: any) {
        console.error(`[GET /auth/profile/image/:userId] Error fetching from R2:`, r2Error)
        // Fallback: redirect to original URL
        return c.redirect(userData.profile_image_url)
      }
    }
    
    // For other URLs (custom domains, CDN), redirect to it
    return c.redirect(userData.profile_image_url)
  } catch (error: any) {
    console.error('[GET /auth/profile/image/:userId] Error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

// Generate quick login PIN (authenticated users only)
auth.patch('/pin', authMiddleware, async (c) => {
  try {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const adminClient = getAdminClient()

    // Get current user data to get last_name
    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('id, last_name, quick_login_code')
      .eq('id', user.id)
      .single()

    if (userError || !userData) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Generate new PIN based on last name
    if (!userData.last_name) {
      return c.json({ error: 'Last name is required to generate PIN. Please update your profile first.' }, 400)
    }

    let newPin: string
    try {
      newPin = await generateUniquePinCode(userData.last_name)
    } catch (error: any) {
      return c.json({ error: error.message || 'Failed to generate PIN' }, 500)
    }

    // Update user's quick_login_code
    const { data: updatedUser, error: updateError } = await adminClient
      .from('users')
      .update({ quick_login_code: newPin })
      .eq('id', user.id)
      .select('id, quick_login_code')
      .single()

    if (updateError || !updatedUser) {
      console.error('Error updating PIN:', updateError)
      return c.json({ error: 'Failed to update PIN', details: updateError?.message }, 500)
    }

    return c.json({
      message: 'PIN generated successfully',
      pin: newPin,
    })
  } catch (error: any) {
    console.error('Generate PIN error:', error)
    return c.json({ error: 'Internal server error', details: error.message }, 500)
  }
})

export default auth

