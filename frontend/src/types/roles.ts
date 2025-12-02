// User Role Types
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

export interface RoleOption {
  value: UserRole
  label: string
}

export const ROLE_OPTIONS: RoleOption[] = [
  { value: ROLES.WORKER, label: 'Worker' },
  { value: ROLES.SUPERVISOR, label: 'Supervisor' },
  { value: ROLES.WHS_CONTROL_CENTER, label: 'WHS - WHS Control Center' },
  { value: ROLES.EXECUTIVE, label: 'Executive' },
  { value: ROLES.CLINICIAN, label: 'Clinician' },
  { value: ROLES.TEAM_LEADER, label: 'Team Leader' },
  { value: ROLES.ADMIN, label: 'Admin' },
]

// Note: Use getDashboardRoute() from '../config/routes' instead of ROLE_ROUTES
// This keeps route configuration centralized and consistent

