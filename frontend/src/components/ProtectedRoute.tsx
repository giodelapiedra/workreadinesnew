import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getDashboardRoute, hasRouteAccess, PUBLIC_ROUTES } from '../config/routes'
import type { UserRole } from '../types/roles'
import { memo, useMemo, useCallback, useEffect, useRef } from 'react'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: string
}

const IS_DEV = import.meta.env.DEV

// Loading component - memoized to prevent unnecessary re-renders
const LoadingScreen = memo(() => (
  <div style={{ 
    display: 'flex', 
    justifyContent: 'center', 
    alignItems: 'center', 
    height: '100vh',
    flexDirection: 'column',
    gap: '16px'
  }}>
    <div className="spinner" style={{
      width: '48px',
      height: '48px',
      border: '4px solid #f3f3f3',
      borderTop: '4px solid #667eea',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    }} />
    <p style={{ color: '#4a5568', fontSize: '14px' }}>Loading...</p>
  </div>
))

LoadingScreen.displayName = 'LoadingScreen'

/**
 * ProtectedRoute - Route guard component that validates authentication and role-based access
 * 
 * @param children - React node to render if access is granted
 * @param requiredRole - Optional role required to access this route
 * 
 * Behavior:
 * - Shows loading screen while auth state is being determined
 * - Redirects to login if user is not authenticated
 * - Validates role match if requiredRole is specified
 * - Validates route access permissions
 * - Redirects to user's dashboard if access is denied
 */
export const ProtectedRoute = memo(function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, loading, role } = useAuth()
  const location = useLocation()
  
  // Track previous pathname to log only on actual route changes
  const previousPathnameRef = useRef<string | null>(null)

  // Memoize redirect path calculation to avoid recalculating on every render
  const redirectPath = useMemo(() => {
    if (!role) return null
    return getDashboardRoute(role as UserRole)
  }, [role])

  // Memoize route access check to avoid recalculating on every render
  const hasAccess = useMemo(() => {
    if (!role) return false
    return hasRouteAccess(location.pathname, role as UserRole)
  }, [location.pathname, role])

  // Log route access only when pathname actually changes (not on every render)
  useEffect(() => {
    // Skip if still loading, no user, or no role
    if (loading || !user || !role) {
      return
    }

    // Only log if pathname actually changed (actual navigation)
    const pathnameChanged = previousPathnameRef.current !== location.pathname
    
    if (pathnameChanged && IS_DEV) {
      previousPathnameRef.current = location.pathname
      const requiredRoleDisplay = requiredRole || '(shared route)'
      
      // Single log message per route change
      if (requiredRole && role === requiredRole && hasAccess) {
        console.log(
          `[ProtectedRoute] Access granted: User ${user.email} accessing ${location.pathname}. ` +
          `Role: ${role}, Required: ${requiredRoleDisplay}`
        )
      } else {
        console.log(
          `[ProtectedRoute] User ${user.email} accessing ${location.pathname}. ` +
          `Role: ${role}, Required: ${requiredRoleDisplay}`
        )
      }
    }
  }, [location.pathname, user, role, requiredRole, hasAccess, loading])

  // Helper: Log security denial and redirect to dashboard
  // Memoized to prevent recreation on every render
  const handleAccessDenied = useCallback((reason: string) => {
    // Always log security denials (these are critical)
    if (IS_DEV && user) {
      console.error(
        `[ProtectedRoute] SECURITY: ${reason} User ${user.email} (${user.id}) with role '${role}' ` +
        `attempted to access '${requiredRole || 'shared'}' route at ${location.pathname}. Redirecting to proper dashboard.`
      )
    }
    
    if (redirectPath) {
      return <Navigate to={redirectPath} replace />
    }
    
    // Fallback: redirect to login if no dashboard route available
    return <Navigate to={PUBLIC_ROUTES.LOGIN} replace />
  }, [user, role, requiredRole, location.pathname, redirectPath])

  // Show loading screen while authentication state is being determined
  if (loading) {
    return <LoadingScreen />
  }

  // No user - redirect to login with return path
  if (!user) {
    const pathnameChanged = previousPathnameRef.current !== location.pathname
    if (IS_DEV && pathnameChanged) {
      previousPathnameRef.current = location.pathname
      console.log('[ProtectedRoute] No user found - redirecting to login')
    }
    return <Navigate to={PUBLIC_ROUTES.LOGIN} state={{ from: location }} replace />
  }

  // Wait for role to load to prevent flashing
  if (!role) {
    const pathnameChanged = previousPathnameRef.current !== location.pathname
    if (IS_DEV && requiredRole && pathnameChanged) {
      previousPathnameRef.current = location.pathname
      console.warn(`[ProtectedRoute] Role required (${requiredRole}) but not loaded yet. Waiting...`)
    }
    return <LoadingScreen />
  }

  // STRICT ROLE VALIDATION: If a role is required, it MUST match
  if (requiredRole && role !== requiredRole) {
    return handleAccessDenied('Access denied! Role mismatch.')
  }

  // Validate route access permissions
  if (!hasAccess) {
    return handleAccessDenied('Route access denied!')
  }

  return <>{children}</>
})
