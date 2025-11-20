/**
 * Backend Route Configuration
 * This file defines all API routes and their access control rules
 * 
 * ⚠️ IMPORTANT: Keep in sync with frontend/src/config/apiRoutes.ts
 * Frontend apiRoutes.ts is the SOURCE OF TRUTH for route definitions
 * 
 * This file focuses on:
 * - ROUTE_ACCESS_CONTROL (backend-specific)
 * - hasRouteAccess() function (backend-specific)
 * - API_ROUTES (should match frontend, but incomplete here - see frontend for full list)
 */

// User roles - must match database enum
export const ROLES = {
  WORKER: 'worker',
  SUPERVISOR: 'supervisor',
  WHS_CONTROL_CENTER: 'whs_control_center',
  EXECUTIVE: 'executive',
  CLINICIAN: 'clinician',
  TEAM_LEADER: 'team_leader',
  ADMIN: 'admin',
} as const

export type UserRole = typeof ROLES[keyof typeof ROLES]

// API route definitions
export const API_ROUTES = {
  // Auth routes (public)
  AUTH: {
    LOGIN: '/api/auth/login',
    REGISTER: '/api/auth/register',
    LOGOUT: '/api/auth/logout',
    ME: '/api/auth/me',
    REFRESH: '/api/auth/refresh',
  },
  
  // Teams routes (protected)
  TEAMS: {
    BASE: '/api/teams',
    ALL: '/api/teams/all',
    MEMBERS: '/api/teams/members',
    MEMBER: (id: string) => `/api/teams/members/${id}`,
    MEMBER_TRANSFER: (id: string) => `/api/teams/members/${id}/transfer`,
  },
  
  // Check-ins routes (protected)
  CHECKINS: {
    BASE: '/api/checkins',
    SUBMIT: '/api/checkins/submit',
    TODAY: '/api/checkins/today',
    HISTORY: '/api/checkins/history',
    TEAM: '/api/checkins/team',
    ANALYTICS: '/api/checkins/analytics',
  },
  
  // Supervisor routes (protected)
  SUPERVISOR: {
    BASE: '/api/supervisor',
    TEAMS: '/api/supervisor/teams',
    WORKERS: '/api/supervisor/workers',
    WORKER: (id: string) => `/api/supervisor/workers/${id}`,
    MY_INCIDENTS: '/api/supervisor/my-incidents',
    TEAM_LEADERS_PERFORMANCE: '/api/supervisor/team-leaders/performance',
  },
  
  // Schedules routes (protected)
  SCHEDULES: {
    BASE: '/api/schedules',
    TEAM_LEADERS: '/api/schedules/team-leaders',
    SCHEDULE: (id: string) => `/api/schedules/${id}`,
    // Worker schedules
    WORKERS: '/api/schedules/workers',
    MY_SCHEDULE: '/api/schedules/my-schedule',
    WORKER_SCHEDULE: (id: string) => `/api/schedules/workers/${id}`,
  },
} as const

// Route access control - maps route patterns to allowed roles
// IMPORTANT: More specific routes must come BEFORE general routes
// The matching algorithm checks routes in order, so specific patterns are matched first
export const ROUTE_ACCESS_CONTROL: Record<string, UserRole[]> = {
  // Teams routes (specific first)
  '/api/teams/members/:id/transfer': [ROLES.TEAM_LEADER],
  '/api/teams/members/:id': [ROLES.TEAM_LEADER],
  '/api/teams/members': [ROLES.TEAM_LEADER],
  '/api/teams/all': [ROLES.TEAM_LEADER],
  '/api/teams': [ROLES.TEAM_LEADER],
  
  // Check-ins routes (specific first)
  '/api/checkins/submit': [ROLES.WORKER],
  '/api/checkins/today': [ROLES.WORKER],
  '/api/checkins/history': [ROLES.WORKER],
  '/api/checkins/team': [ROLES.TEAM_LEADER, ROLES.SUPERVISOR],
  '/api/checkins/analytics': [ROLES.TEAM_LEADER, ROLES.SUPERVISOR],
  '/api/checkins': [ROLES.WORKER, ROLES.TEAM_LEADER, ROLES.SUPERVISOR],
  
  // Supervisor routes (specific first)
  '/api/supervisor/team-leaders/performance': [ROLES.SUPERVISOR],
  '/api/supervisor/my-incidents': [ROLES.SUPERVISOR],
  '/api/supervisor/workers/:id': [ROLES.SUPERVISOR],
  '/api/supervisor/workers': [ROLES.SUPERVISOR],
  '/api/supervisor/teams': [ROLES.SUPERVISOR],
  '/api/supervisor': [ROLES.SUPERVISOR],
  
  // Schedules routes (specific first)
  '/api/schedules/workers/:id': [ROLES.TEAM_LEADER],
  '/api/schedules/workers': [ROLES.TEAM_LEADER],
  '/api/schedules/my-schedule': [ROLES.WORKER],
  '/api/schedules/team-leaders': [ROLES.SUPERVISOR],
  '/api/schedules/:id': [ROLES.SUPERVISOR, ROLES.TEAM_LEADER],
  '/api/schedules': [ROLES.SUPERVISOR, ROLES.TEAM_LEADER],
  
  // Clinician routes (specific first)
  '/api/clinician/cases/:id/notes': [ROLES.CLINICIAN],
  '/api/clinician/transcriptions/:id': [ROLES.CLINICIAN],
  '/api/clinician/transcriptions': [ROLES.CLINICIAN],
  '/api/clinician/transcribe': [ROLES.CLINICIAN],
  '/api/clinician/analyze-transcription': [ROLES.CLINICIAN],
  '/api/clinician/appointments/:id': [ROLES.CLINICIAN],
  '/api/clinician/appointments': [ROLES.CLINICIAN],
  '/api/clinician/clinical-notes/:id': [ROLES.CLINICIAN],
  '/api/clinician/clinical-notes': [ROLES.CLINICIAN],
  '/api/clinician/rehabilitation-plans/:id': [ROLES.CLINICIAN],
  '/api/clinician/rehabilitation-plans': [ROLES.CLINICIAN],
  '/api/clinician/cases/:id': [ROLES.CLINICIAN],
  '/api/clinician/cases': [ROLES.CLINICIAN],
  '/api/clinician/analytics': [ROLES.CLINICIAN],
  '/api/clinician': [ROLES.CLINICIAN],
  
  // WHS routes (specific first)
  '/api/whs/cases/:id': [ROLES.WHS_CONTROL_CENTER],
  '/api/whs/cases': [ROLES.WHS_CONTROL_CENTER],
  '/api/whs/analytics': [ROLES.WHS_CONTROL_CENTER],
  '/api/whs': [ROLES.WHS_CONTROL_CENTER],
  
  // Worker routes (specific first)
  '/api/worker/incidents/:id': [ROLES.WORKER],
  '/api/worker/incidents': [ROLES.WORKER],
  '/api/worker/my-team': [ROLES.WORKER],
  '/api/worker': [ROLES.WORKER],
  
  // Admin routes (specific first)
  '/api/admin/users/:id/role': [ROLES.ADMIN],
  '/api/admin/users/:id': [ROLES.ADMIN],
  '/api/admin/users': [ROLES.ADMIN],
  '/api/admin/analytics': [ROLES.ADMIN],
  '/api/admin': [ROLES.ADMIN],
  
  // Executive routes (specific first)
  '/api/executive/users/:id/role': [ROLES.EXECUTIVE],
  '/api/executive/users/:id': [ROLES.EXECUTIVE],
  '/api/executive/users': [ROLES.EXECUTIVE],
  '/api/executive/hierarchy': [ROLES.EXECUTIVE],
  '/api/executive/safety-engagement': [ROLES.EXECUTIVE],
  '/api/executive/stats': [ROLES.EXECUTIVE],
  '/api/executive': [ROLES.EXECUTIVE],
}

/**
 * Check if a user role has access to a specific route
 * @param path - The route path
 * @param userRole - The user's role
 * @returns boolean - true if user has access
 */
export function hasRouteAccess(path: string, userRole: UserRole): boolean {
  // Public routes (auth endpoints except /me)
  if (path.startsWith('/api/auth/') && !path.includes('/me')) {
    return true
  }
  
  // Find matching route pattern
  for (const [routePattern, allowedRoles] of Object.entries(ROUTE_ACCESS_CONTROL)) {
    // Convert route pattern to regex (simple version)
    const regexPattern = routePattern.replace(/:[^/]+/g, '[^/]+')
    const regex = new RegExp(`^${regexPattern}$`)
    
    if (regex.test(path)) {
      return allowedRoles.includes(userRole)
    }
  }
  
  // If no pattern matches, deny access by default
  return false
}

/**
 * Get all roles that have access to a specific route
 * @param path - The route path
 * @returns UserRole[] - array of roles with access
 */
export function getAllowedRoles(path: string): UserRole[] {
  for (const [routePattern, allowedRoles] of Object.entries(ROUTE_ACCESS_CONTROL)) {
    const regexPattern = routePattern.replace(/:[^/]+/g, '[^/]+')
    const regex = new RegExp(`^${regexPattern}$`)
    
    if (regex.test(path)) {
      return allowedRoles
    }
  }
  
  return []
}

/**
 * Validate that a role is valid
 * @param role - The role to validate
 * @returns boolean - true if valid
 */
export function isValidRole(role: string): role is UserRole {
  return Object.values(ROLES).includes(role as UserRole)
}

