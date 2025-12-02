/**
 * Centralized Route Configuration
 * This file contains all route definitions and their access control rules
 */

import { ROLES, type UserRole } from '../types/roles'

// Public routes (no authentication required)
export const PUBLIC_ROUTES = {
  LOGIN: '/login',
  REGISTER: '/register',
  HOME: '/',
} as const

// Protected routes by role
export const PROTECTED_ROUTES = {
  // Worker routes
  WORKER: {
    DASHBOARD: '/dashboard/worker',
    CALENDAR: '/dashboard/worker/calendar',
    APPOINTMENTS: '/dashboard/worker/appointments',
    CHECK_IN_RECORDS: '/dashboard/worker/check-in-records',
    DAILY_CHECKIN: '/dashboard/worker/daily-checkin',
    RECOVERY_PLAN: '/dashboard/worker/recovery-plan',
    REPORT_INCIDENT: '/dashboard/worker/report-incident',
    MY_ACCIDENTS: '/dashboard/worker/my-accidents',
    ACCIDENT_DETAIL: '/dashboard/worker/my-accidents/:caseId',
    NOTIFICATIONS: '/dashboard/notifications',
  },
  
  // Supervisor routes
  SUPERVISOR: {
    DASHBOARD: '/dashboard/supervisor',
    TEAMS: '/dashboard/supervisor/teams',
    // SCHEDULES: '/dashboard/supervisor/schedules', // DISABLED: Team Leaders now assign individual schedules to workers
    ANALYTICS: '/dashboard/supervisor/analytics',
    INCIDENTS: '/dashboard/supervisor/incidents',
    MY_INCIDENTS: '/dashboard/supervisor/my-incidents',
    INCIDENT_DETAIL: '/dashboard/supervisor/my-incidents/:incidentId',
    NOTIFICATIONS: '/dashboard/notifications',
  },
  
  // Team Leader routes
  TEAM_LEADER: {
    DASHBOARD: '/dashboard/team-leader',
    TEAM_MEMBERS: '/dashboard/team-leader/team-members',
    CALENDAR: '/dashboard/team-leader/calendar',
    READINESS: '/dashboard/team-leader/readiness',
    ANALYTICS: '/dashboard/team-leader/analytics',
    LOGS: '/dashboard/team-leader/logs',
    WORKER_SCHEDULES: '/dashboard/team-leader/worker-schedules',
    PENDING_INCIDENTS: '/dashboard/team-leader/pending-incidents',
    NOTIFICATIONS: '/dashboard/notifications',
  },
  
  // WHS Control Center routes
  WHS_CONTROL_CENTER: {
    DASHBOARD: '/dashboard/whs-control-center',
    RECORD_CASES: '/dashboard/whs-control-center/record-cases',
    CASE_DETAIL: '/dashboard/whs-control-center/:caseId',
    ANALYTICS: '/dashboard/whs-control-center/analytics',
    NOTIFICATIONS: '/dashboard/notifications',
  },
  
  // Executive routes
  EXECUTIVE: {
    DASHBOARD: '/dashboard/executive',
    SAFETY_ENGAGEMENT: '/dashboard/executive/safety-engagement',
    HIERARCHY: '/dashboard/executive/hierarchy',
    WORKER_STREAKS: '/dashboard/executive/worker-streaks',
    WORKER_STREAK_DETAIL: '/dashboard/executive/worker-streaks/:workerId',
  },
  
  // Clinician routes
  CLINICIAN: {
    DASHBOARD: '/dashboard/clinician',
    CLINICAL_NOTES: '/dashboard/clinician/clinical-notes',
    CLINICAL_NOTE_DETAIL: '/dashboard/clinician/clinical-notes/:noteId',
    MY_TASKS: '/dashboard/clinician/tasks',
    MY_CASES: '/dashboard/clinician/my-cases',
    CASE_DETAIL: '/dashboard/clinician/my-cases/:caseId',
    APPOINTMENTS: '/dashboard/clinician/appointments',
    CALENDAR: '/dashboard/clinician/calendar',
    ANALYTICS: '/dashboard/clinician/analytics',
    VOICE_RECORDING: '/dashboard/clinician/voice-recording',
    NOTIFICATIONS: '/dashboard/notifications',
  },
  
  // Admin routes
  ADMIN: {
    DASHBOARD: '/dashboard/admin',
    USERS: '/dashboard/admin/users',
    TEAM_VIEW: '/dashboard/admin/team-view',
    CLINICIAN_VIEW: '/dashboard/admin/clinician-view',
    CLINICIAN_VIEW_DETAIL: '/dashboard/admin/clinician-view/:clinicianId',
    CLINICIAN_CASES: '/dashboard/admin/clinician-cases',
    CLINICIAN_CASE_DETAIL: '/dashboard/admin/clinician-cases/:caseId',
    TEAMS: '/dashboard/admin/teams',
    ANALYTICS: '/dashboard/admin/analytics',
    SYSTEM_LOGS: '/dashboard/admin/system-logs',
    NOTIFICATIONS: '/dashboard/notifications',
  },
  
  // Generic dashboard (redirects based on role)
  DASHBOARD: '/dashboard',
  
  // Profile route (accessible to all roles)
  PROFILE: '/dashboard/profile',
} as const

// Route access control mapping
export const ROUTE_ACCESS_CONTROL: Record<string, UserRole[]> = {
  // Worker routes
  [PROTECTED_ROUTES.WORKER.DASHBOARD]: [ROLES.WORKER],
  [PROTECTED_ROUTES.WORKER.CALENDAR]: [ROLES.WORKER],
  [PROTECTED_ROUTES.WORKER.APPOINTMENTS]: [ROLES.WORKER],
  [PROTECTED_ROUTES.WORKER.CHECK_IN_RECORDS]: [ROLES.WORKER],
  [PROTECTED_ROUTES.WORKER.DAILY_CHECKIN]: [ROLES.WORKER],
  [PROTECTED_ROUTES.WORKER.RECOVERY_PLAN]: [ROLES.WORKER],
  [PROTECTED_ROUTES.WORKER.REPORT_INCIDENT]: [ROLES.WORKER],
  [PROTECTED_ROUTES.WORKER.MY_ACCIDENTS]: [ROLES.WORKER],
  [PROTECTED_ROUTES.WORKER.ACCIDENT_DETAIL]: [ROLES.WORKER],
  // Notifications route - shared by multiple roles (defined below)
  
  // Supervisor routes
  [PROTECTED_ROUTES.SUPERVISOR.DASHBOARD]: [ROLES.SUPERVISOR],
  [PROTECTED_ROUTES.SUPERVISOR.TEAMS]: [ROLES.SUPERVISOR],
  // [PROTECTED_ROUTES.SUPERVISOR.SCHEDULES]: [ROLES.SUPERVISOR], // DISABLED: Team Leaders now assign individual schedules to workers
  [PROTECTED_ROUTES.SUPERVISOR.ANALYTICS]: [ROLES.SUPERVISOR],
  [PROTECTED_ROUTES.SUPERVISOR.INCIDENTS]: [ROLES.SUPERVISOR],
  [PROTECTED_ROUTES.SUPERVISOR.MY_INCIDENTS]: [ROLES.SUPERVISOR],
  [PROTECTED_ROUTES.SUPERVISOR.INCIDENT_DETAIL]: [ROLES.SUPERVISOR],
  // Notifications route - shared by multiple roles (defined below)
  
  // Team Leader routes
  [PROTECTED_ROUTES.TEAM_LEADER.DASHBOARD]: [ROLES.TEAM_LEADER],
  [PROTECTED_ROUTES.TEAM_LEADER.TEAM_MEMBERS]: [ROLES.TEAM_LEADER],
  [PROTECTED_ROUTES.TEAM_LEADER.CALENDAR]: [ROLES.TEAM_LEADER],
  [PROTECTED_ROUTES.TEAM_LEADER.READINESS]: [ROLES.TEAM_LEADER],
  [PROTECTED_ROUTES.TEAM_LEADER.ANALYTICS]: [ROLES.TEAM_LEADER],
  [PROTECTED_ROUTES.TEAM_LEADER.LOGS]: [ROLES.TEAM_LEADER],
  [PROTECTED_ROUTES.TEAM_LEADER.WORKER_SCHEDULES]: [ROLES.TEAM_LEADER],
  [PROTECTED_ROUTES.TEAM_LEADER.PENDING_INCIDENTS]: [ROLES.TEAM_LEADER],
  
  // Notifications route - shared by multiple roles (Team Leader, WHS, Clinician, Worker, Supervisor, Admin)
  // Using WORKER.NOTIFICATIONS path since all roles use the same path
  [PROTECTED_ROUTES.WORKER.NOTIFICATIONS]: [ROLES.TEAM_LEADER, ROLES.WHS_CONTROL_CENTER, ROLES.CLINICIAN, ROLES.WORKER, ROLES.SUPERVISOR, ROLES.ADMIN],
  
  // Profile route - accessible to all authenticated users
  [PROTECTED_ROUTES.PROFILE]: [ROLES.WORKER, ROLES.SUPERVISOR, ROLES.TEAM_LEADER, ROLES.WHS_CONTROL_CENTER, ROLES.EXECUTIVE, ROLES.CLINICIAN, ROLES.ADMIN],
  
  // WHS Control Center routes
  [PROTECTED_ROUTES.WHS_CONTROL_CENTER.DASHBOARD]: [ROLES.WHS_CONTROL_CENTER],
  [PROTECTED_ROUTES.WHS_CONTROL_CENTER.RECORD_CASES]: [ROLES.WHS_CONTROL_CENTER],
  [PROTECTED_ROUTES.WHS_CONTROL_CENTER.CASE_DETAIL]: [ROLES.WHS_CONTROL_CENTER],
  [PROTECTED_ROUTES.WHS_CONTROL_CENTER.ANALYTICS]: [ROLES.WHS_CONTROL_CENTER],
  // Notifications route is shared - already defined above for TEAM_LEADER.NOTIFICATIONS
  
  // Executive routes
  [PROTECTED_ROUTES.EXECUTIVE.DASHBOARD]: [ROLES.EXECUTIVE],
  [PROTECTED_ROUTES.EXECUTIVE.SAFETY_ENGAGEMENT]: [ROLES.EXECUTIVE],
  [PROTECTED_ROUTES.EXECUTIVE.HIERARCHY]: [ROLES.EXECUTIVE],
  [PROTECTED_ROUTES.EXECUTIVE.WORKER_STREAKS]: [ROLES.EXECUTIVE],
  [PROTECTED_ROUTES.EXECUTIVE.WORKER_STREAK_DETAIL]: [ROLES.EXECUTIVE],
  
  // Clinician routes
  [PROTECTED_ROUTES.CLINICIAN.DASHBOARD]: [ROLES.CLINICIAN],
  [PROTECTED_ROUTES.CLINICIAN.MY_TASKS]: [ROLES.CLINICIAN],
  [PROTECTED_ROUTES.CLINICIAN.MY_CASES]: [ROLES.CLINICIAN],
  [PROTECTED_ROUTES.CLINICIAN.CASE_DETAIL]: [ROLES.CLINICIAN],
  [PROTECTED_ROUTES.CLINICIAN.APPOINTMENTS]: [ROLES.CLINICIAN],
  [PROTECTED_ROUTES.CLINICIAN.CALENDAR]: [ROLES.CLINICIAN],
  [PROTECTED_ROUTES.CLINICIAN.ANALYTICS]: [ROLES.CLINICIAN],
  [PROTECTED_ROUTES.CLINICIAN.VOICE_RECORDING]: [ROLES.CLINICIAN],
  [PROTECTED_ROUTES.CLINICIAN.CLINICAL_NOTES]: [ROLES.CLINICIAN],
  [PROTECTED_ROUTES.CLINICIAN.CLINICAL_NOTE_DETAIL]: [ROLES.CLINICIAN],
  // Notifications route is shared - already defined above for WHS_CONTROL_CENTER.NOTIFICATIONS
  
  // Admin routes
  [PROTECTED_ROUTES.ADMIN.DASHBOARD]: [ROLES.ADMIN],
  [PROTECTED_ROUTES.ADMIN.USERS]: [ROLES.ADMIN],
  [PROTECTED_ROUTES.ADMIN.TEAM_VIEW]: [ROLES.ADMIN],
  [PROTECTED_ROUTES.ADMIN.CLINICIAN_VIEW]: [ROLES.ADMIN],
  [PROTECTED_ROUTES.ADMIN.CLINICIAN_VIEW_DETAIL]: [ROLES.ADMIN],
  [PROTECTED_ROUTES.ADMIN.CLINICIAN_CASES]: [ROLES.ADMIN],
  [PROTECTED_ROUTES.ADMIN.CLINICIAN_CASE_DETAIL]: [ROLES.ADMIN],
  [PROTECTED_ROUTES.ADMIN.TEAMS]: [ROLES.ADMIN],
  [PROTECTED_ROUTES.ADMIN.ANALYTICS]: [ROLES.ADMIN],
  [PROTECTED_ROUTES.ADMIN.SYSTEM_LOGS]: [ROLES.ADMIN],
  // Notifications route is shared - already defined above for TEAM_LEADER.NOTIFICATIONS
}

// Helper function to check if a route requires authentication
export function isProtectedRoute(path: string): boolean {
  return path.startsWith('/dashboard')
}

// Cache for compiled regex patterns (performance optimization)
const regexCache = new Map<string, RegExp>()

// Helper function to compile regex pattern with caching
function getCompiledRegex(routePattern: string): RegExp {
  if (regexCache.has(routePattern)) {
    return regexCache.get(routePattern)!
  }
  
  // UUID pattern: 8-4-4-4-12 hex characters
  const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  const regexPattern = routePattern.replace(/:[^/]+/g, uuidPattern)
  const regex = new RegExp(`^${regexPattern}$`, 'i')
  
  regexCache.set(routePattern, regex)
  return regex
}

// Helper function to check if user has access to a route
// Optimized with caching and early returns for better performance
export function hasRouteAccess(path: string, userRole: UserRole | null): boolean {
  // Early return: no role means no access
  if (!userRole) return false
  
  // Early return: exact match (fastest path)
  const exactMatch = ROUTE_ACCESS_CONTROL[path]
  if (exactMatch) {
    return exactMatch.includes(userRole)
  }
  
  // Early return: generic dashboard route (accessible to all authenticated users)
  if (path === PROTECTED_ROUTES.DASHBOARD) {
    return true
  }
  
  // Check dynamic routes with cached regex patterns
  for (const [routePattern, allowedRoles] of Object.entries(ROUTE_ACCESS_CONTROL)) {
    // Skip if pattern doesn't contain dynamic segments (already checked exact match)
    if (!routePattern.includes(':')) continue
    
    const regex = getCompiledRegex(routePattern)
      if (regex.test(path)) {
      return allowedRoles.includes(userRole)
    }
  }
  
  // Default: deny access if route not found
    return false
}

// Helper function to get the correct dashboard route for a role
export function getDashboardRoute(role: UserRole): string {
  switch (role) {
    case ROLES.WORKER:
      return PROTECTED_ROUTES.WORKER.DASHBOARD
    case ROLES.SUPERVISOR:
      return PROTECTED_ROUTES.SUPERVISOR.DASHBOARD
    case ROLES.TEAM_LEADER:
      return PROTECTED_ROUTES.TEAM_LEADER.DASHBOARD
    case ROLES.WHS_CONTROL_CENTER:
      return PROTECTED_ROUTES.WHS_CONTROL_CENTER.DASHBOARD
    case ROLES.EXECUTIVE:
      return PROTECTED_ROUTES.EXECUTIVE.DASHBOARD
    case ROLES.CLINICIAN:
      return PROTECTED_ROUTES.CLINICIAN.DASHBOARD
    case ROLES.ADMIN:
      return PROTECTED_ROUTES.ADMIN.DASHBOARD
    default:
      return PUBLIC_ROUTES.LOGIN
  }
}

// Helper function to check if a path is a public route
export function isPublicRoute(path: string): boolean {
  return Object.values(PUBLIC_ROUTES).includes(path as any)
}

