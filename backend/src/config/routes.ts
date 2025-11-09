/**
 * Backend Route Configuration
 * This file defines all API routes and their access control rules
 * Should be kept in sync with frontend route configuration
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
    ADD_MEMBER: '/api/teams/members',
    UPDATE_MEMBER: '/api/teams/members/:id',
    REMOVE_MEMBER: '/api/teams/members/:id',
    TRANSFER_MEMBER: '/api/teams/members/:id/transfer',
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
    ADD_WORKER: '/api/supervisor/workers',
    UPDATE_WORKER: '/api/supervisor/workers/:id',
    DELETE_WORKER: '/api/supervisor/workers/:id',
    MY_INCIDENTS: '/api/supervisor/my-incidents',
    TEAM_LEADERS_PERFORMANCE: '/api/supervisor/team-leaders/performance',
  },
  
  // Schedules routes (protected)
  SCHEDULES: {
    BASE: '/api/schedules',
    TEAM_LEADERS: '/api/schedules/team-leaders',
    CREATE: '/api/schedules',
    UPDATE: '/api/schedules/:id',
    DELETE: '/api/schedules/:id',
    // Worker schedules
    WORKERS: '/api/schedules/workers',
    MY_SCHEDULE: '/api/schedules/my-schedule',
    CREATE_WORKER: '/api/schedules/workers',
    UPDATE_WORKER: '/api/schedules/workers/:id',
    DELETE_WORKER: '/api/schedules/workers/:id',
  },
} as const

// Route access control - maps route patterns to allowed roles
export const ROUTE_ACCESS_CONTROL: Record<string, UserRole[]> = {
  // Teams routes
  '/api/teams': [ROLES.TEAM_LEADER],
  '/api/teams/all': [ROLES.TEAM_LEADER],
  '/api/teams/members': [ROLES.TEAM_LEADER],
  '/api/teams/members/:id': [ROLES.TEAM_LEADER],
  '/api/teams/members/:id/transfer': [ROLES.TEAM_LEADER],
  
  // Check-ins routes
  '/api/checkins': [ROLES.WORKER, ROLES.TEAM_LEADER, ROLES.SUPERVISOR],
  '/api/checkins/submit': [ROLES.WORKER],
  '/api/checkins/today': [ROLES.WORKER],
  '/api/checkins/history': [ROLES.WORKER],
  '/api/checkins/team': [ROLES.TEAM_LEADER, ROLES.SUPERVISOR],
  '/api/checkins/analytics': [ROLES.TEAM_LEADER, ROLES.SUPERVISOR],
  
  // Supervisor routes
  '/api/supervisor': [ROLES.SUPERVISOR],
  '/api/supervisor/teams': [ROLES.SUPERVISOR],
  '/api/supervisor/workers': [ROLES.SUPERVISOR],
  '/api/supervisor/workers/:id': [ROLES.SUPERVISOR],
  '/api/supervisor/my-incidents': [ROLES.SUPERVISOR],
  '/api/supervisor/team-leaders/performance': [ROLES.SUPERVISOR],
  
  // Schedules routes
  '/api/schedules': [ROLES.SUPERVISOR, ROLES.TEAM_LEADER],
  '/api/schedules/team-leaders': [ROLES.SUPERVISOR],
  '/api/schedules/:id': [ROLES.SUPERVISOR, ROLES.TEAM_LEADER],
  // Worker schedules
  '/api/schedules/workers': [ROLES.TEAM_LEADER],
  '/api/schedules/my-schedule': [ROLES.WORKER],
  '/api/schedules/workers/:id': [ROLES.TEAM_LEADER],
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

