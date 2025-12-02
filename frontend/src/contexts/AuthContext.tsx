import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { PUBLIC_ROUTES, isPublicRoute, getDashboardRoute } from '../config/routes'
import { useNavigate, useLocation } from 'react-router-dom'
import { authService } from '../services/authService'
import { apiClient, isApiError } from '../lib/apiClient'
import { API_ROUTES } from '../config/apiRoutes'

type Session = Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']
type User = NonNullable<Session>['user']

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  role: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  phone: string | null
  business_name: string | null
  business_registration_number: string | null
  profile_image_url: string | null
  signOut: () => Promise<void>
  setRole: (role: string | null) => void
  refreshAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/* @refresh reset */
export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  
  // Check if current path is a public route (login/register) - don't show loading for these
  const isCurrentPathPublic = isPublicRoute(location.pathname)
  
  const [state, setState] = useState({
    user: null as User | null,
    session: null as Session | null,
    role: null as string | null,
    first_name: null as string | null,
    last_name: null as string | null,
    full_name: null as string | null,
    phone: null as string | null,
    business_name: null as string | null,
    business_registration_number: null as string | null,
    profile_image_url: null as string | null,
  })
  // Don't show loading on public routes (login/register) - show content immediately
  const [loading, setLoading] = useState(!isCurrentPathPublic)

  const navigate = useNavigate()
  const userRef = useRef<User | null>(null)
  const isLoggedOutRef = useRef(false) // Track logout state to prevent requests
  const abortControllerRef = useRef<AbortController | null>(null) // Cancel pending requests on logout

  // 🧩 Utility: safe API call with graceful error handling
  const safeApiCall = useCallback(async () => {
    // Don't make requests if user is logged out
    if (isLoggedOutRef.current) {
      return { data: null, error: 401 }
    }
    
    // Create new AbortController for this request
    const controller = new AbortController()
    abortControllerRef.current = controller
    
    try {
      const result = await apiClient.get(
        API_ROUTES.AUTH.ME,
        {
          signal: controller.signal,
          headers: { 'Cache-Control': 'no-cache' },
        }
      )
      
      // Clear controller after request completes
      abortControllerRef.current = null
      
      if (isApiError(result)) {
        // Silently handle 401 errors (user is logged out)
        if (result.error.status === 401) {
          return { error: 401, data: null }
        }
        return { error: result.error.status || 'network', data: null }
      }
      
      return { data: result.data, error: null }
    } catch (err: any) {
      // Clear controller on error
      abortControllerRef.current = null
      
      // Don't log AbortError (request was cancelled intentionally)
      if (err.name === 'AbortError') {
        return { data: null, error: 'aborted' }
      }
      
      // Only log network errors if user is not logged out
      if (!isLoggedOutRef.current) {
        console.warn('[Auth] Network error:', (err as Error).message)
      }
      return { data: null, error: 'network' }
    }
  }, [])

  // ⚡ Core: Fetch user + role from backend
  const fetchUserAndRole = useCallback(
    async ({
      isInitialLoad = false,
      force = false,
    }: { isInitialLoad?: boolean; force?: boolean } = {}) => {
      // Don't fetch if user is logged out
      if (isLoggedOutRef.current) {
        return
      }

      const path = location.pathname
      const isPublic = isPublicRoute(path)

      // OPTIMIZATION: Skip API call on public routes (login/register) when not logged in
      // This prevents unnecessary 401 errors and speeds up page load
      // Only check auth if: forced, user exists, or on protected route
      if (isPublic && !userRef.current && !force) {
        if (import.meta.env.DEV)
          console.log(`[Auth] Skipping check on public route: ${path}`)
        return
      }

      const { data, error } = await safeApiCall()

      // Silently handle 401 errors (user is logged out or session expired)
      if (error === 401 || !data?.user) {
        // Only update state if not already logged out
        if (!isLoggedOutRef.current) {
          if (isInitialLoad) {
          setState((s) => ({
            ...s,
            user: null,
            session: null,
            role: null,
            first_name: null,
            last_name: null,
            full_name: null,
            phone: null,
            business_name: null,
            business_registration_number: null,
            profile_image_url: null,
          }))
          }
        }
        return
      }

      // ✅ Construct new user/session objects
      const userObj: User = {
        id: data.user.id,
        email: data.user.email || '',
        created_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        confirmed_at: new Date().toISOString(),
        last_sign_in_at: new Date().toISOString(),
        role: 'authenticated',
        updated_at: new Date().toISOString(),
      }

      const newSession: Session = {
        access_token: '',
        refresh_token: '',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: userObj,
      }

      userRef.current = userObj
      // Reset logout flag when user successfully authenticates
      isLoggedOutRef.current = false

      const userRole = data.user.role || null

      setState({
        user: userObj,
        session: newSession,
        role: userRole,
        first_name: data.user.first_name || null,
        last_name: data.user.last_name || null,
        full_name: data.user.full_name || null,
        phone: data.user.phone || null,
        business_name: data.user.business_name || null,
        business_registration_number:
          data.user.business_registration_number || null,
        profile_image_url: data.user.profile_image_url || null,
      })

      // SECURITY: Redirect authenticated users away from public routes (login/register)
      // Only redirect on initial load to prevent redirect loops
      if (isInitialLoad && isPublic && userRole) {
        const dashboardRoute = getDashboardRoute(userRole as any)
        if (dashboardRoute && dashboardRoute !== path) {
          if (import.meta.env.DEV) {
            console.log(`[Auth] Redirecting authenticated user from ${path} to ${dashboardRoute}`)
          }
          // Use replace to prevent back button from going to login
          navigate(dashboardRoute, { replace: true })
        }
      }
    },
    [location.pathname, safeApiCall, navigate]
  )

  // 🕒 Initial + Polling Logic
  useEffect(() => {
    let mounted = true
    let interval: ReturnType<typeof setInterval>

    const path = location.pathname
    const isPublic = isPublicRoute(path)

    // OPTIMIZATION: On public routes (login/register), don't call API on initial load
    // This prevents 401 errors and shows the page immediately
    if (isPublic && !userRef.current) {
      // Immediately set loading to false for public routes
      if (mounted) setLoading(false)
    } else {
      // For protected routes or when user exists, check authentication
      fetchUserAndRole({ isInitialLoad: true }).finally(() => {
        if (mounted) setLoading(false)
      })
    }

    const poll = () => {
      // Don't poll if user is logged out or on public route without user
      if (isLoggedOutRef.current) {
        return
      }
      const currentPath = location.pathname
      // Only poll if user exists or on protected route
      if (userRef.current || !isPublicRoute(currentPath)) {
        fetchUserAndRole()
      }
    }

    interval = setInterval(poll, 60000)

    // Only refresh on visibility change if user exists and on protected route
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const currentPath = location.pathname
        // Only poll if user exists and on protected route
        if (userRef.current && !isPublicRoute(currentPath)) {
          poll()
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      mounted = false
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchUserAndRole, location.pathname])

  // 🚪 Logout handler
  const signOut = useCallback(async () => {
    // Mark as logged out immediately to prevent any further requests
    isLoggedOutRef.current = true
    userRef.current = null
    
    // Cancel any pending fetch requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    
    // Clear state immediately to prevent any UI flashing
    setState({
      user: null,
      session: null,
      role: null,
      first_name: null,
      last_name: null,
      full_name: null,
      phone: null,
      business_name: null,
      business_registration_number: null,
      profile_image_url: null,
    })
    
    try {
      // Clear browser storage
      localStorage.clear()
      sessionStorage.clear()
      
      // Call logout endpoint to clear server-side cookies
      try {
        await authService.logout()
      } catch (err) {
        // Silently handle logout request errors
        console.warn('[Auth] Logout request failed:', err)
      }
    } catch (err) {
      // Silently handle logout errors
      console.warn('[Auth] Logout error:', err)
    } finally {
      // Force full page reload to /login to ensure clean state
      // This clears any cached data and ensures fresh login
      window.location.href = PUBLIC_ROUTES.LOGIN
    }
  }, [])

  const refreshAuth = useCallback(async () => {
    await fetchUserAndRole({ force: true })
  }, [fetchUserAndRole])

  // 🧠 Stable context value
  const contextValue = useMemo<AuthContextType>(
    () => ({
      ...state,
      loading,
      signOut,
      setRole: (role) => setState((s) => ({ ...s, role })),
      refreshAuth,
    }),
    [state, loading, signOut, refreshAuth]
  )

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
}

/* @refresh reset */
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
