/**
 * API Routes Configuration
 * Centralized definition of all API endpoints
 * 
 * ⚠️ IMPORTANT: This is the SOURCE OF TRUTH for API routes
 * Backend routes.ts should match these definitions
 * 
 * When adding new routes:
 * 1. Add them here first
 * 2. Update backend/src/config/routes.ts to match
 * 3. Update ROUTE_ACCESS_CONTROL in both files
 */

export const API_ROUTES = {
  // Auth routes
  AUTH: {
    LOGIN: '/api/auth/login',
    REGISTER: '/api/auth/register',
    LOGOUT: '/api/auth/logout',
    ME: '/api/auth/me',
    REFRESH: '/api/auth/refresh',
    QUICK_LOGIN: '/api/auth/quick-login',
    PROFILE: '/api/auth/profile',
    PROFILE_IMAGE: '/api/auth/profile/image',
    PROFILE_IMAGE_PROXY: (userId: string) => `/api/auth/profile/image/${userId}`,
    PASSWORD: '/api/auth/password',
    VERIFY_PASSWORD: '/api/auth/verify-password',
    PIN: '/api/auth/pin',
  },

  // Teams routes
  TEAMS: {
    BASE: '/api/teams',
    ALL: '/api/teams/all',
    MEMBERS: '/api/teams/members',
    EXCEPTIONS: '/api/teams/exceptions',
    MEMBER_EXCEPTION: (id: string) => `/api/teams/members/${id}/exception`,
    MEMBER: (id: string) => `/api/teams/members/${id}`,
    MEMBER_TRANSFER: (id: string) => `/api/teams/members/${id}/transfer`,
    CHECKINS: '/api/teams/check-ins',
    CHECKINS_ANALYTICS: '/api/teams/check-ins/analytics',
    LOGS: '/api/teams/logs',
    LOGS_VERIFY_PASSWORD: '/api/teams/logs/verify-password',
    INCIDENTS: '/api/teams/incidents',
    APPROVE_INCIDENT: (id: string) => `/api/teams/approve-incident/${id}`,
    REJECT_INCIDENT: (id: string) => `/api/teams/reject-incident/${id}`,
  },

  // Check-ins routes
  CHECKINS: {
    BASE: '/api/checkins',
    SUBMIT: '/api/checkins/submit',
    TODAY: '/api/checkins/today',
    HISTORY: '/api/checkins/history',
    TEAM: '/api/checkins/team',
    ANALYTICS: '/api/checkins/analytics',
    WARM_UP: '/api/checkins/warm-up',
    DASHBOARD: '/api/checkins/dashboard',
    REHABILITATION_PLAN: '/api/checkins/rehabilitation-plan',
    REHABILITATION_PLAN_PROGRESS: '/api/checkins/rehabilitation-plan/progress',
    REHABILITATION_PLAN_COMPLETIONS: '/api/checkins/rehabilitation-plan/completions',
    REHABILITATION_PLAN_COMPLETE_EXERCISE: '/api/checkins/rehabilitation-plan/complete-exercise',
    STATUS: '/api/checkins/status',
    SHIFT_INFO: '/api/checkins/shift-info',
    NEXT_SHIFT_INFO: '/api/checkins/next-shift-info',
    APPOINTMENTS: '/api/checkins/appointments',
    APPOINTMENT_STATUS: (id: string) => `/api/checkins/appointments/${id}/status`,
  },
  
  // Supervisor routes
  SUPERVISOR: {
    BASE: '/api/supervisor',
    DASHBOARD: '/api/supervisor/dashboard',
    TEAMS: '/api/supervisor/teams',
    WORKERS: '/api/supervisor/workers',
    WORKER: (id: string) => `/api/supervisor/workers/${id}`,
    MY_INCIDENTS: '/api/supervisor/my-incidents',
    INCIDENTS: '/api/supervisor/incidents',
    INCIDENT: (id: string) => `/api/supervisor/incidents/${id}`,
    ASSIGN_INCIDENT: (id: string) => `/api/supervisor/incidents/${id}/assign-to-whs`,
    TEAM_LEADERS: '/api/supervisor/team-leaders',
    TEAM_LEADERS_PERFORMANCE: '/api/supervisor/team-leaders/performance',
    ANALYTICS: '/api/supervisor/analytics',
  },

  // Schedules routes
  SCHEDULES: {
    BASE: '/api/schedules',
    TEAM_LEADERS: '/api/schedules/team-leaders',
    SCHEDULE: (id: string) => `/api/schedules/${id}`,
    WORKERS: '/api/schedules/workers',
    WORKER_SCHEDULE: (id: string) => `/api/schedules/workers/${id}`,
    MY_SCHEDULE: '/api/schedules/my-schedule',
  },

  // Clinician routes
  CLINICIAN: {
    BASE: '/api/clinician',
    CASES: '/api/clinician/cases',
    CASE: (id: string) => `/api/clinician/cases/${id}`,
    CASE_NOTES: (id: string) => `/api/clinician/cases/${id}/notes`,
    CASE_CLINICAL_NOTES: (id: string) => `/api/clinician/cases/${id}/clinical-notes`,
    INCIDENT_AI_ANALYSIS: (id: string) => `/api/clinician/incidents/${id}/ai-analysis`,
    INCIDENT_PHOTO: (incidentId: string) => `/api/clinician/incident-photo/${incidentId}`,
    REHABILITATION_PLANS: '/api/clinician/rehabilitation-plans',
    REHABILITATION_PLAN: (id: string) => `/api/clinician/rehabilitation-plans/${id}`,
    CLINICAL_NOTES: '/api/clinician/clinical-notes',
    CLINICAL_NOTE: (id: string) => `/api/clinician/clinical-notes/${id}`,
    APPOINTMENTS: '/api/clinician/appointments',
    APPOINTMENT: (id: string) => `/api/clinician/appointments/${id}`,
    TRANSCRIPTIONS: '/api/clinician/transcriptions',
    TRANSCRIPTION: (id: string) => `/api/clinician/transcriptions/${id}`,
    TRANSCRIBE: '/api/clinician/transcribe',
    ANALYZE_TRANSCRIPTION: '/api/clinician/analyze-transcription',
    ANALYTICS: '/api/clinician/analytics',
    NOTIFICATIONS: '/api/clinician/notifications',
  },

  // WHS routes
  WHS: {
    BASE: '/api/whs',
    CASES: '/api/whs/cases',
    CASE: (id: string) => `/api/whs/cases/${id}`,
    CASE_ASSIGN_CLINICIAN: (id: string) => `/api/whs/cases/${id}/assign-clinician`,
    INCIDENT_PHOTO: (incidentId: string) => `/api/whs/incident-photo/${incidentId}`,
    ANALYTICS: '/api/whs/analytics',
    CLINICIANS: '/api/whs/clinicians',
    CLINICIANS_PERFORMANCE: '/api/whs/clinicians/performance',
  },

  // Worker routes
  WORKER: {
    BASE: '/api/worker',
    MY_TEAM: '/api/worker/my-team',
    INCIDENTS: '/api/worker/incidents',
    INCIDENT: (id: string) => `/api/worker/incidents/${id}`,
    INCIDENT_PHOTO: (incidentId: string) => `/api/worker/incident-photo/${incidentId}`,
    CASES: '/api/worker/cases',
    CASE: (id: string) => `/api/worker/cases/${id}`,
    CAN_REPORT_INCIDENT: '/api/worker/can-report-incident',
    ANALYZE_INCIDENT: '/api/worker/analyze-incident',
    REPORT_INCIDENT: '/api/worker/report-incident',
    STREAK: '/api/worker/streak',
  },

  // Admin routes
  ADMIN: {
    BASE: '/api/admin',
    USERS: '/api/admin/users',
    USER: (id: string) => `/api/admin/users/${id}`,
    USER_ROLE: (id: string) => `/api/admin/users/${id}/role`,
    ANALYTICS: '/api/admin/analytics',
    STATS: '/api/admin/stats',
    SUPERVISORS: '/api/admin/supervisors',
    SUPERVISOR: (id: string) => `/api/admin/supervisors/${id}`,
    CLINICIANS: '/api/admin/clinicians',
    CLINICIAN: (id: string) => `/api/admin/clinicians/${id}`,
    CLINICIAN_CASES: '/api/admin/clinician-cases',
    CLINICIAN_CASE: (id: string) => `/api/admin/clinician-cases/${id}`,
  },

  // Executive routes
  EXECUTIVE: {
    BASE: '/api/executive',
    USERS: '/api/executive/users',
    USER: (id: string) => `/api/executive/users/${id}`,
    USER_ROLE: (id: string) => `/api/executive/users/${id}/role`,
    STATS: '/api/executive/stats',
    SAFETY_ENGAGEMENT: '/api/executive/safety-engagement',
    HIERARCHY: '/api/executive/hierarchy',
    WORKERS_STREAKS: '/api/executive/workers/streaks',
    WORKER_CHECKINS: (workerId: string) => `/api/executive/workers/${workerId}/check-ins`,
  },
} as const

