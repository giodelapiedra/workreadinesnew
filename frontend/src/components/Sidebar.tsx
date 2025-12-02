import { useNavigate, useLocation } from 'react-router-dom'
import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { ROLES } from '../types/roles'
import { getProfileImageUrl } from '../utils/imageUtils'
import './Sidebar.css'

interface MenuItem {
  id: string
  label: string
  icon: React.ReactNode
  path: string
  roles: string[] // Which roles can see this menu item
  badge?: number
  children?: MenuItem[]
  group?: string // Optional group/section name
}

// Define menu items for each role
const MENU_ITEMS: MenuItem[] = [
  // Common items (visible to all roles)
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
        <polyline points="9 22 9 12 15 12 15 22"></polyline>
      </svg>
    ),
    path: '/dashboard',
    roles: [ROLES.WORKER, ROLES.SUPERVISOR, ROLES.TEAM_LEADER, ROLES.WHS_CONTROL_CENTER, ROLES.EXECUTIVE, ROLES.CLINICIAN],
    group: 'Overview', // For clinician role grouping
  },
  // Worker - Organized by groups
  {
    id: 'my-tasks',
    label: 'My Tasks',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="9 11 12 14 22 4"></polyline>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
      </svg>
    ),
    path: '/dashboard/worker',
    roles: [ROLES.WORKER],
    group: 'Overview',
  },
  {
    id: 'worker-calendar',
    label: 'My Schedule',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
    ),
    path: '/dashboard/worker/calendar',
    roles: [ROLES.WORKER],
    group: 'Schedule',
  },
  {
    id: 'worker-appointments',
    label: 'Appointments',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
    ),
    path: '/dashboard/worker/appointments',
    roles: [ROLES.WORKER],
    group: 'Schedule',
  },
  {
    id: 'check-in-records',
    label: 'Check-In Records',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    ),
    path: '/dashboard/worker/check-in-records',
    roles: [ROLES.WORKER],
    group: 'Records',
  },
  {
    id: 'my-accidents',
    label: 'My Accidents',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </svg>
    ),
    path: '/dashboard/worker/my-accidents',
    roles: [ROLES.WORKER],
    group: 'Records',
  },
  {
    id: 'report-incident',
    label: 'Report Incident',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    ),
    path: '/dashboard/worker/report-incident',
    roles: [ROLES.WORKER],
    group: 'Actions',
  },
  // Team Leader - Organized by groups
  {
    id: 'team-dashboard',
    label: 'Team Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
    ),
    path: '/dashboard/team-leader',
    roles: [ROLES.TEAM_LEADER],
    group: 'Overview',
  },
  {
    id: 'team-members',
    label: 'Team Members',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    ),
    path: '/dashboard/team-leader/team-members',
    roles: [ROLES.TEAM_LEADER],
    group: 'Team Management',
  },
  {
    id: 'worker-schedules',
    label: 'Worker Schedules',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
        <line x1="8" y1="14" x2="8" y2="14"></line>
        <line x1="12" y1="14" x2="12" y2="14"></line>
        <line x1="16" y1="14" x2="16" y2="14"></line>
      </svg>
    ),
    path: '/dashboard/team-leader/worker-schedules',
    roles: [ROLES.TEAM_LEADER],
    group: 'Team Management',
  },
  {
    id: 'pending-incidents',
    label: 'Pending Incidents',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    ),
    path: '/dashboard/team-leader/pending-incidents',
    roles: [ROLES.TEAM_LEADER],
    group: 'Team Management',
  },
  {
    id: 'worker-readiness',
    label: 'Worker Readiness',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
    ),
    path: '/dashboard/team-leader/readiness',
    roles: [ROLES.TEAM_LEADER],
    group: 'Analytics',
  },
  {
    id: 'check-in-analytics',
    label: 'Check-In Analytics',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10"></line>
        <line x1="12" y1="20" x2="12" y2="4"></line>
        <line x1="6" y1="20" x2="6" y2="14"></line>
      </svg>
    ),
    path: '/dashboard/team-leader/analytics',
    roles: [ROLES.TEAM_LEADER],
    group: 'Analytics',
  },
  {
    id: 'team-leader-calendar',
    label: 'Worker Schedules Calendar',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
    ),
    path: '/dashboard/team-leader/calendar',
    roles: [ROLES.TEAM_LEADER],
    group: 'Views',
  },
  {
    id: 'team-leader-logs',
    label: 'Activity Logs',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    ),
    path: '/dashboard/team-leader/logs',
    roles: [ROLES.TEAM_LEADER],
    group: 'Logs',
  },
  // Supervisor - Organized by groups
  {
    id: 'supervisor-dashboard',
    label: 'Supervisor Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"></path>
      </svg>
    ),
    path: '/dashboard/supervisor',
    roles: [ROLES.SUPERVISOR],
    group: 'Overview',
  },
  {
    id: 'manage-team',
    label: 'Manage Team',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="8.5" cy="7" r="4"></circle>
        <line x1="20" y1="8" x2="20" y2="14"></line>
        <line x1="23" y1="11" x2="17" y2="11"></line>
      </svg>
    ),
    path: '/dashboard/supervisor/teams',
    roles: [ROLES.SUPERVISOR],
    group: 'Team Management',
  },
  {
    id: 'incident-management',
    label: 'Incident Management',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
      </svg>
    ),
    path: '/dashboard/supervisor/incidents',
    roles: [ROLES.SUPERVISOR],
    group: 'Incidents',
  },
  {
    id: 'my-incidents',
    label: 'My Submitted Incidents',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
        <path d="M9 16l2 2 4-4"></path>
      </svg>
    ),
    path: '/dashboard/supervisor/my-incidents',
    roles: [ROLES.SUPERVISOR],
    group: 'Incidents',
  },
  {
    id: 'supervisor-analytics',
    label: 'Analytics',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10"></line>
        <line x1="12" y1="20" x2="12" y2="4"></line>
        <line x1="6" y1="20" x2="6" y2="14"></line>
      </svg>
    ),
    path: '/dashboard/supervisor/analytics',
    roles: [ROLES.SUPERVISOR],
    group: 'Analytics',
  },
  // WHS Control Center - Organized by groups
  {
    id: 'whs-dashboard',
    label: 'WHS Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="9" y1="9" x2="15" y2="15"></line>
        <line x1="15" y1="9" x2="9" y2="15"></line>
      </svg>
    ),
    path: '/dashboard/whs-control-center',
    roles: [ROLES.WHS_CONTROL_CENTER],
    group: 'Overview',
  },
  {
    id: 'whs-record-cases',
    label: 'Record Cases',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    ),
    path: '/dashboard/whs-control-center/record-cases',
    roles: [ROLES.WHS_CONTROL_CENTER],
    group: 'Cases',
  },
  {
    id: 'whs-analytics',
    label: 'Analytics',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10"></line>
        <line x1="12" y1="20" x2="12" y2="4"></line>
        <line x1="6" y1="20" x2="6" y2="14"></line>
      </svg>
    ),
    path: '/dashboard/whs-control-center/analytics',
    roles: [ROLES.WHS_CONTROL_CENTER],
    group: 'Analytics',
  },
  // Executive - Organized by groups
  {
    id: 'executive-dashboard',
    label: 'Executive Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path>
      </svg>
    ),
    path: '/dashboard/executive',
    roles: [ROLES.EXECUTIVE],
    group: 'Overview',
  },
  {
    id: 'executive-safety-engagement',
    label: 'Overall Safety Engagement',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
    ),
    path: '/dashboard/executive/safety-engagement',
    roles: [ROLES.EXECUTIVE],
    group: 'Overview',
  },
  {
    id: 'executive-hierarchy',
    label: 'Organization Hierarchy',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
    ),
    path: '/dashboard/executive/hierarchy',
    roles: [ROLES.EXECUTIVE],
    group: 'Overview',
  },
  {
    id: 'executive-worker-streaks',
    label: 'Worker Check-In Streaks',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        <path d="M12 2v6m0 8v6M4.93 4.93l4.24 4.24m6.46 6.46l4.24 4.24M2 12h6m8 0h6M4.93 19.07l4.24-4.24m6.46-6.46l4.24-4.24"></path>
      </svg>
    ),
    path: '/dashboard/executive/worker-streaks',
    roles: [ROLES.EXECUTIVE],
    group: 'Overview',
  },
  // Clinician - Organized by groups
  {
    id: 'clinician-dashboard',
    label: 'Clinician Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
    ),
    path: '/dashboard/clinician',
    roles: [ROLES.CLINICIAN],
    group: 'Overview',
  },
  {
    id: 'clinician-tasks',
    label: 'My Tasks',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="9 11 12 14 22 4"></polyline>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
      </svg>
    ),
    path: '/dashboard/clinician/tasks',
    roles: [ROLES.CLINICIAN],
    group: 'Work Management',
  },
  {
    id: 'clinician-my-cases',
    label: 'My Cases',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    ),
    path: '/dashboard/clinician/my-cases',
    roles: [ROLES.CLINICIAN],
    group: 'Work Management',
  },
  {
    id: 'clinician-appointments',
    label: 'Appointments',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
    ),
    path: '/dashboard/clinician/appointments',
    roles: [ROLES.CLINICIAN],
    group: 'Work Management',
  },
  {
    id: 'clinician-voice-recording',
    label: 'Clinician Transcription',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
    ),
    path: '/dashboard/clinician/voice-recording',
    roles: [ROLES.CLINICIAN],
    group: 'Documentation',
  },
  {
    id: 'clinician-clinical-notes',
    label: 'Clinical Notes',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </svg>
    ),
    path: '/dashboard/clinician/clinical-notes',
    roles: [ROLES.CLINICIAN],
    group: 'Documentation',
  },
  {
    id: 'clinician-calendar',
    label: 'Calendar',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"></path>
      </svg>
    ),
    path: '/dashboard/clinician/calendar',
    roles: [ROLES.CLINICIAN],
    group: 'Views',
  },
  {
    id: 'clinician-analytics',
    label: 'Analytics',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10"></line>
        <line x1="12" y1="20" x2="12" y2="4"></line>
        <line x1="6" y1="20" x2="6" y2="14"></line>
      </svg>
    ),
    path: '/dashboard/clinician/analytics',
    roles: [ROLES.CLINICIAN],
    group: 'Views',
  },
  // Admin - Organized by groups
  {
    id: 'admin-dashboard',
    label: 'Admin Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
      </svg>
    ),
    path: '/dashboard/admin',
    roles: [ROLES.ADMIN],
    group: 'Overview',
  },
  {
    id: 'admin-manage-members',
    label: 'Manage Members',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
    ),
    path: '/dashboard/admin/users',
    roles: [ROLES.ADMIN],
    group: 'User Management',
  },
  {
    id: 'admin-team-view',
    label: 'Team View',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
    ),
    path: '/dashboard/admin/team-view',
    roles: [ROLES.ADMIN],
    group: 'User Management',
  },
  {
    id: 'admin-clinician-view',
    label: 'Clinician View',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20.21 15.32A8.56 8.56 0 1 0 11.56 8a8.46 8.46 0 0 1 5.96 2.32"></path>
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="8.5" cy="7" r="2"></circle>
        <line x1="23" y1="11" x2="17" y2="11"></line>
      </svg>
    ),
    path: '/dashboard/admin/clinician-view',
    roles: [ROLES.ADMIN],
    group: 'User Management',
  },
  {
    id: 'admin-clinician-cases',
    label: 'Clinician Cases',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </svg>
    ),
    path: '/dashboard/admin/clinician-cases',
    roles: [ROLES.ADMIN],
    group: 'User Management',
  },
  {
    id: 'admin-analytics',
    label: 'Analytics',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
      </svg>
    ),
    path: '/dashboard/admin/analytics',
    roles: [ROLES.ADMIN],
    group: 'Analytics',
  },
]

interface SidebarProps {
  isOpen: boolean
  isMobile: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, isMobile, onClose }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { role, profile_image_url, first_name, last_name, user: authUser } = useAuth()

  // Memoize profile image URL to prevent unnecessary recalculations and flicker
  const profileImageUrl = useMemo(() => {
    return getProfileImageUrl(profile_image_url, authUser?.id)
  }, [profile_image_url, authUser?.id])

  // Filter menu items based on user role
  const visibleMenuItems = MENU_ITEMS.filter(item => 
    role && item.roles.includes(role)
  )

  // Group menu items by group name for all roles
  const groupedMenuItems = (() => {
    // Define group order for each role
    const roleGroupOrders: Record<string, string[]> = {
      [ROLES.WORKER]: ['Overview', 'Schedule', 'Records', 'Actions', 'Other'],
      [ROLES.TEAM_LEADER]: ['Overview', 'Team Management', 'Analytics', 'Views', 'Logs', 'Other'],
      [ROLES.SUPERVISOR]: ['Overview', 'Team Management', 'Incidents', 'Analytics', 'Other'],
      [ROLES.WHS_CONTROL_CENTER]: ['Overview', 'Cases', 'Analytics', 'Other'],
      [ROLES.EXECUTIVE]: ['Overview', 'Other'],
      [ROLES.CLINICIAN]: ['Overview', 'Work Management', 'Documentation', 'Views', 'Other'],
      [ROLES.ADMIN]: ['Overview', 'User Management', 'Analytics', 'Other'],
    }
    
    const groupOrder = role ? (roleGroupOrders[role] || ['Other']) : ['Other']
    const groups: Record<string, typeof visibleMenuItems> = {}
    
    // Group items while preserving order
    visibleMenuItems.forEach(item => {
      const groupName = item.group || 'Other'
      if (!groups[groupName]) {
        groups[groupName] = []
      }
      groups[groupName].push(item)
    })
    
    // Return ordered groups
    const orderedGroups: Record<string, typeof visibleMenuItems> = {}
    groupOrder.forEach(groupName => {
      if (groups[groupName]) {
        orderedGroups[groupName] = groups[groupName]
      }
    })
    
    // Add any remaining groups
    Object.keys(groups).forEach(groupName => {
      if (!orderedGroups[groupName]) {
        orderedGroups[groupName] = groups[groupName]
      }
    })
    
    // Only return grouped items if there are multiple groups or items have groups
    const hasGroups = Object.keys(orderedGroups).length > 1 || visibleMenuItems.some(item => item.group)
    return hasGroups ? orderedGroups : null
  })()

  const isActive = (path: string) => {
    if (path === '/dashboard') {
      return location.pathname === path || location.pathname === '/'
    }
    return location.pathname.startsWith(path)
  }

  const handleMenuClick = (path: string) => {
    navigate(path)
    // Close sidebar on mobile after navigation
    if (isMobile) {
      onClose()
    }
  }

  const getUserInitials = () => {
    if (first_name && last_name) {
      return `${first_name[0]}${last_name[0]}`.toUpperCase()
    }
    if (first_name) {
      return first_name[0].toUpperCase()
    }
    if (authUser?.email) {
      return authUser.email[0].toUpperCase()
    }
    return 'U'
  }

  return (
    <div className={`sidebar ${isOpen ? 'open' : 'closed'} ${isMobile ? 'mobile' : 'desktop'}`}>
      {/* Logo/Brand Section */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
          </svg>
          <span className="sidebar-brand">WorkReadiness</span>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="sidebar-nav">
        {groupedMenuItems ? (
          // Render grouped menu items for clinician
          Object.entries(groupedMenuItems).map(([groupName, items]) => (
            <div key={groupName} className="sidebar-section">
              <div className="sidebar-group-header">{groupName}</div>
              {items.map((item) => (
                <button
                  key={item.id}
                  className={`sidebar-item ${isActive(item.path) ? 'active' : ''}`}
                  onClick={() => handleMenuClick(item.path)}
                  title={item.label}
                >
                  <span className="sidebar-item-icon">{item.icon}</span>
                  <span className="sidebar-item-label">{item.label}</span>
                  {item.badge && item.badge > 0 && (
                    <span className="sidebar-item-badge">{item.badge}</span>
                  )}
                </button>
              ))}
            </div>
          ))
        ) : (
          // Render flat menu items for other roles
          <div className="sidebar-section">
            {visibleMenuItems.map((item) => (
              <button
                key={item.id}
                className={`sidebar-item ${isActive(item.path) ? 'active' : ''}`}
                onClick={() => handleMenuClick(item.path)}
                title={item.label}
              >
                <span className="sidebar-item-icon">{item.icon}</span>
                <span className="sidebar-item-label">{item.label}</span>
                {item.badge && item.badge > 0 && (
                  <span className="sidebar-item-badge">{item.badge}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* User Profile Section at Bottom */}
      <div className="sidebar-footer">
        <button 
          className="sidebar-user"
          onClick={() => {
            navigate('/dashboard/profile')
            if (isMobile) {
              onClose()
            }
          }}
          title="View Profile"
        >
          <div className="sidebar-user-avatar">
            {profileImageUrl ? (
              <img 
                src={profileImageUrl} 
                alt="Profile" 
                className="sidebar-user-avatar-img"
                loading="eager"
                decoding="sync"
                onError={(e) => {
                  const target = e.target as HTMLImageElement
                  target.style.display = 'none'
                  const parent = target.parentElement
                  if (parent) {
                    parent.textContent = getUserInitials()
                  }
                }}
              />
            ) : (
              getUserInitials()
            )}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">
              {first_name || authUser?.email?.split('@')[0] || 'User'}
            </div>
            <div className="sidebar-user-role">
              {role?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'User'}
            </div>
          </div>
          <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            className="sidebar-user-chevron"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>
    </div>
  )
}

