import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { DashboardRedirect } from './components/DashboardRedirect'
import { Loading } from './components/Loading'
import { ROLES } from './types/roles'
import { PUBLIC_ROUTES, PROTECTED_ROUTES } from './config/routes'
import './App.css'

// =============================================================================
// EAGER LOAD: Only load Login & Register immediately (no lazy load)
// =============================================================================
import { Login } from './pages/auth/login/Login'
import { Register } from './pages/auth/register/Register'

// =============================================================================
// LAZY LOAD: All other pages load only when needed
// =============================================================================

// Worker Pages
const WorkerDashboard = lazy(() => import('./pages/dashboard/worker/WorkerDashboard').then(m => ({ default: m.WorkerDashboard })))
const WorkerCalendar = lazy(() => import('./pages/dashboard/worker/WorkerCalendar').then(m => ({ default: m.WorkerCalendar })))
const WorkerAppointments = lazy(() => import('./pages/dashboard/worker/WorkerAppointments').then(m => ({ default: m.WorkerAppointments })))
const CheckInRecords = lazy(() => import('./pages/dashboard/worker/CheckInRecords').then(m => ({ default: m.CheckInRecords })))
const RecoveryPlan = lazy(() => import('./pages/dashboard/worker/RecoveryPlan').then(m => ({ default: m.RecoveryPlan })))
const DailyCheckIn = lazy(() => import('./pages/dashboard/worker/DailyCheckIn').then(m => ({ default: m.DailyCheckIn })))
const ReportIncident = lazy(() => import('./pages/dashboard/worker/ReportIncident').then(m => ({ default: m.ReportIncident })))
const MyAccidents = lazy(() => import('./pages/dashboard/worker/MyAccidents').then(m => ({ default: m.MyAccidents })))
const AccidentDetail = lazy(() => import('./pages/dashboard/worker/AccidentDetail').then(m => ({ default: m.AccidentDetail })))

// Supervisor Pages
const SupervisorDashboard = lazy(() => import('./pages/dashboard/supervisor/SupervisorDashboard').then(m => ({ default: m.SupervisorDashboard })))
const SupervisorTeams = lazy(() => import('./pages/dashboard/supervisor/SupervisorTeams').then(m => ({ default: m.SupervisorTeams })))
const SupervisorAnalytics = lazy(() => import('./pages/dashboard/supervisor/SupervisorAnalytics').then(m => ({ default: m.SupervisorAnalytics })))
const IncidentManagement = lazy(() => import('./pages/dashboard/supervisor/IncidentManagement').then(m => ({ default: m.IncidentManagement })))
const MyIncidents = lazy(() => import('./pages/dashboard/supervisor/MyIncidents').then(m => ({ default: m.MyIncidents })))
const IncidentDetail = lazy(() => import('./pages/dashboard/supervisor/IncidentDetail').then(m => ({ default: m.IncidentDetail })))

// WHS Control Center Pages
const WhsControlCenterDashboard = lazy(() => import('./pages/dashboard/whs-control-center/WhsControlCenterDashboard').then(m => ({ default: m.WhsControlCenterDashboard })))
const RecordCases = lazy(() => import('./pages/dashboard/whs-control-center/RecordCases').then(m => ({ default: m.RecordCases })))
const WhsCaseDetail = lazy(() => import('./pages/dashboard/whs-control-center/WhsCaseDetail').then(m => ({ default: m.WhsCaseDetail })))
const WhsAnalytics = lazy(() => import('./pages/dashboard/whs-control-center/WhsAnalytics').then(m => ({ default: m.WhsAnalytics })))
const Notifications = lazy(() => import('./pages/dashboard/notifications/Notifications').then(m => ({ default: m.Notifications })))

// Executive Pages
const ExecutiveDashboard = lazy(() => import('./pages/dashboard/executive/ExecutiveDashboard').then(m => ({ default: m.ExecutiveDashboard })))
const OverallSafetyEngagement = lazy(() => import('./pages/dashboard/executive/OverallSafetyEngagement').then(m => ({ default: m.OverallSafetyEngagement })))
const HierarchyManagement = lazy(() => import('./pages/dashboard/executive/HierarchyManagement').then(m => ({ default: m.HierarchyManagement })))
const WorkerStreakMonitoring = lazy(() => import('./pages/dashboard/executive/WorkerStreakMonitoring').then(m => ({ default: m.WorkerStreakMonitoring })))
const WorkerStreakDetail = lazy(() => import('./pages/dashboard/executive/WorkerStreakDetail').then(m => ({ default: m.WorkerStreakDetail })))

// Clinician Pages
const ClinicianDashboard = lazy(() => import('./pages/dashboard/clinician/ClinicianDashboard').then(m => ({ default: m.ClinicianDashboard })))
const MyTasks = lazy(() => import('./pages/dashboard/clinician/MyTasks').then(m => ({ default: m.MyTasks })))
const MyCases = lazy(() => import('./pages/dashboard/clinician/MyCases').then(m => ({ default: m.MyCases })))
const CaseDetail = lazy(() => import('./pages/dashboard/clinician/CaseDetail').then(m => ({ default: m.CaseDetail })))
const AdminClinicianCases = lazy(() => import('./pages/dashboard/admin/AdminClinicianCases').then(m => ({ default: m.AdminClinicianCases })))
const AppointmentManagement = lazy(() => import('./pages/dashboard/clinician/AppointmentManagement').then(m => ({ default: m.AppointmentManagement })))
const ClinicianCalendar = lazy(() => import('./pages/dashboard/clinician/ClinicianCalendar').then(m => ({ default: m.ClinicianCalendar })))
const ClinicianAnalytics = lazy(() => import('./pages/dashboard/clinician/ClinicianAnalytics').then(m => ({ default: m.ClinicianAnalytics })))
const VoiceRecordingPage = lazy(() => import('./pages/dashboard/clinician/VoiceRecordingPage').then(m => ({ default: m.VoiceRecordingPage })))
const ClinicalNotes = lazy(() => import('./pages/dashboard/clinician/ClinicalNotes').then(m => ({ default: m.ClinicalNotes })))
const ClinicalNoteDetail = lazy(() => import('./pages/dashboard/clinician/ClinicalNoteDetail').then(m => ({ default: m.ClinicalNoteDetail })))

// Admin Pages
const AdminDashboard = lazy(() => import('./pages/dashboard/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })))
const AdminAnalytics = lazy(() => import('./pages/dashboard/admin/AdminAnalytics').then(m => ({ default: m.AdminAnalytics })))
const ManageMembers = lazy(() => import('./pages/dashboard/admin/ManageMembers').then(m => ({ default: m.ManageMembers })))
const TeamView = lazy(() => import('./pages/dashboard/admin/TeamView').then(m => ({ default: m.TeamView })))
const ClinicianView = lazy(() => import('./pages/dashboard/admin/ClinicianView').then(m => ({ default: m.ClinicianView })))

// Team Leader Pages
const TeamLeaderDashboard = lazy(() => import('./pages/dashboard/team-leader/TeamLeaderDashboard').then(m => ({ default: m.TeamLeaderDashboard })))
const TeamMembers = lazy(() => import('./pages/dashboard/team-leader/TeamMembers').then(m => ({ default: m.TeamMembers })))
const TeamLeaderCalendar = lazy(() => import('./pages/dashboard/team-leader/TeamLeaderCalendar').then(m => ({ default: m.TeamLeaderCalendar })))
const WorkerReadiness = lazy(() => import('./pages/dashboard/team-leader/WorkerReadiness').then(m => ({ default: m.WorkerReadiness })))
const CheckInAnalytics = lazy(() => import('./pages/dashboard/team-leader/CheckInAnalytics').then(m => ({ default: m.CheckInAnalytics })))
const TeamLeaderLogs = lazy(() => import('./pages/dashboard/team-leader/TeamLeaderLogs').then(m => ({ default: m.TeamLeaderLogs })))
const WorkerSchedules = lazy(() => import('./pages/dashboard/team-leader/WorkerSchedules').then(m => ({ default: m.WorkerSchedules })))
const PendingIncidents = lazy(() => import('./pages/dashboard/team-leader/PendingIncidents').then(m => ({ default: m.PendingIncidents })))

// Profile & Error Pages
const Profile = lazy(() => import('./pages/dashboard/profile/Profile').then(m => ({ default: m.Profile })))
const NotFound = lazy(() => import('./pages/errors/NotFound').then(m => ({ default: m.NotFound })))
const Unauthorized = lazy(() => import('./pages/errors/Unauthorized').then(m => ({ default: m.Unauthorized })))

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <Loading 
        fullScreen 
        message="Loading application..." 
        size="large"
      />
    )
  }

  return (
    <Suspense fallback={<Loading fullScreen message="Loading page..." size="large" />}>
      <Routes>
        {/* Public Routes - NO lazy loading for Login/Register */}
        <Route 
          path={PUBLIC_ROUTES.LOGIN}
          element={user ? <DashboardRedirect /> : <Login />} 
        />
        <Route 
          path={PUBLIC_ROUTES.REGISTER}
          element={user ? <DashboardRedirect /> : <Register />} 
        />
        
        {/* Worker Routes - ALL lazy loaded */}
        <Route
          path={PROTECTED_ROUTES.WORKER.DASHBOARD}
          element={
            <ProtectedRoute requiredRole={ROLES.WORKER}>
              <WorkerDashboard />
            </ProtectedRoute>
          }
        />
      <Route
        path={PROTECTED_ROUTES.WORKER.CALENDAR}
        element={
          <ProtectedRoute requiredRole={ROLES.WORKER}>
            <WorkerCalendar />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.WORKER.APPOINTMENTS}
        element={
          <ProtectedRoute requiredRole={ROLES.WORKER}>
            <WorkerAppointments />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.WORKER.CHECK_IN_RECORDS}
        element={
          <ProtectedRoute requiredRole={ROLES.WORKER}>
            <CheckInRecords />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.WORKER.RECOVERY_PLAN}
        element={
          <ProtectedRoute requiredRole={ROLES.WORKER}>
            <RecoveryPlan />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.WORKER.DAILY_CHECKIN}
        element={
          <ProtectedRoute requiredRole={ROLES.WORKER}>
            <DailyCheckIn />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.WORKER.REPORT_INCIDENT}
        element={
          <ProtectedRoute requiredRole={ROLES.WORKER}>
            <ReportIncident />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.WORKER.MY_ACCIDENTS}
        element={
          <ProtectedRoute requiredRole={ROLES.WORKER}>
            <MyAccidents />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.WORKER.ACCIDENT_DETAIL}
        element={
          <ProtectedRoute requiredRole={ROLES.WORKER}>
            <AccidentDetail />
          </ProtectedRoute>
        }
      />
      {/* Notifications route - accessible to all authenticated users */}
      <Route
        path={PROTECTED_ROUTES.WORKER.NOTIFICATIONS}
        element={
          <ProtectedRoute>
            <Notifications />
          </ProtectedRoute>
        }
      />
      
      {/* Supervisor Routes */}
      <Route
        path={PROTECTED_ROUTES.SUPERVISOR.DASHBOARD}
        element={
          <ProtectedRoute requiredRole={ROLES.SUPERVISOR}>
            <SupervisorDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.SUPERVISOR.TEAMS}
        element={
          <ProtectedRoute requiredRole={ROLES.SUPERVISOR}>
            <SupervisorTeams />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.SUPERVISOR.ANALYTICS}
        element={
          <ProtectedRoute requiredRole={ROLES.SUPERVISOR}>
            <SupervisorAnalytics />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.SUPERVISOR.INCIDENTS}
        element={
          <ProtectedRoute requiredRole={ROLES.SUPERVISOR}>
            <IncidentManagement />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.SUPERVISOR.MY_INCIDENTS}
        element={
          <ProtectedRoute requiredRole={ROLES.SUPERVISOR}>
            <MyIncidents />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.SUPERVISOR.INCIDENT_DETAIL}
        element={
          <ProtectedRoute requiredRole={ROLES.SUPERVISOR}>
            <IncidentDetail />
          </ProtectedRoute>
        }
      />
      
      {/* Team Leader Routes */}
      <Route
        path={PROTECTED_ROUTES.TEAM_LEADER.DASHBOARD}
        element={
          <ProtectedRoute requiredRole={ROLES.TEAM_LEADER}>
            <TeamLeaderDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.TEAM_LEADER.TEAM_MEMBERS}
        element={
          <ProtectedRoute requiredRole={ROLES.TEAM_LEADER}>
            <TeamMembers />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.TEAM_LEADER.CALENDAR}
        element={
          <ProtectedRoute requiredRole={ROLES.TEAM_LEADER}>
            <TeamLeaderCalendar />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.TEAM_LEADER.READINESS}
        element={
          <ProtectedRoute requiredRole={ROLES.TEAM_LEADER}>
            <WorkerReadiness />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.TEAM_LEADER.ANALYTICS}
        element={
          <ProtectedRoute requiredRole={ROLES.TEAM_LEADER}>
            <CheckInAnalytics />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.TEAM_LEADER.LOGS}
        element={
          <ProtectedRoute requiredRole={ROLES.TEAM_LEADER}>
            <TeamLeaderLogs />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.TEAM_LEADER.PENDING_INCIDENTS}
        element={
          <ProtectedRoute requiredRole={ROLES.TEAM_LEADER}>
            <PendingIncidents />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.TEAM_LEADER.WORKER_SCHEDULES}
        element={
          <ProtectedRoute requiredRole={ROLES.TEAM_LEADER}>
            <WorkerSchedules />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.TEAM_LEADER.NOTIFICATIONS}
        element={
          <ProtectedRoute requiredRole={ROLES.TEAM_LEADER}>
            <Notifications />
          </ProtectedRoute>
        }
      />
      
      {/* WHS Control Center Routes */}
      <Route
        path={PROTECTED_ROUTES.WHS_CONTROL_CENTER.DASHBOARD}
        element={
          <ProtectedRoute requiredRole={ROLES.WHS_CONTROL_CENTER}>
            <WhsControlCenterDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.WHS_CONTROL_CENTER.RECORD_CASES}
        element={
          <ProtectedRoute requiredRole={ROLES.WHS_CONTROL_CENTER}>
            <RecordCases />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.WHS_CONTROL_CENTER.CASE_DETAIL}
        element={
          <ProtectedRoute requiredRole={ROLES.WHS_CONTROL_CENTER}>
            <WhsCaseDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.WHS_CONTROL_CENTER.ANALYTICS}
        element={
          <ProtectedRoute requiredRole={ROLES.WHS_CONTROL_CENTER}>
            <WhsAnalytics />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.WHS_CONTROL_CENTER.NOTIFICATIONS}
        element={
          <ProtectedRoute requiredRole={ROLES.WHS_CONTROL_CENTER}>
            <Notifications />
          </ProtectedRoute>
        }
      />
      
      {/* Executive Routes */}
      <Route
        path={PROTECTED_ROUTES.EXECUTIVE.DASHBOARD}
        element={
          <ProtectedRoute requiredRole={ROLES.EXECUTIVE}>
            <ExecutiveDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.EXECUTIVE.SAFETY_ENGAGEMENT}
        element={
          <ProtectedRoute requiredRole={ROLES.EXECUTIVE}>
            <OverallSafetyEngagement />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.EXECUTIVE.HIERARCHY}
        element={
          <ProtectedRoute requiredRole={ROLES.EXECUTIVE}>
            <HierarchyManagement />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.EXECUTIVE.WORKER_STREAKS}
        element={
          <ProtectedRoute requiredRole={ROLES.EXECUTIVE}>
            <WorkerStreakMonitoring />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.EXECUTIVE.WORKER_STREAK_DETAIL}
        element={
          <ProtectedRoute requiredRole={ROLES.EXECUTIVE}>
            <WorkerStreakDetail />
          </ProtectedRoute>
        }
      />
      
      {/* Clinician Routes */}
      <Route
        path={PROTECTED_ROUTES.CLINICIAN.DASHBOARD}
        element={
          <ProtectedRoute requiredRole={ROLES.CLINICIAN}>
            <ClinicianDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.CLINICIAN.MY_TASKS}
        element={
          <ProtectedRoute requiredRole={ROLES.CLINICIAN}>
            <MyTasks />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.CLINICIAN.MY_CASES}
        element={
          <ProtectedRoute requiredRole={ROLES.CLINICIAN}>
            <MyCases />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.CLINICIAN.CASE_DETAIL}
        element={
          <ProtectedRoute requiredRole={ROLES.CLINICIAN}>
            <CaseDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.CLINICIAN.APPOINTMENTS}
        element={
          <ProtectedRoute requiredRole={ROLES.CLINICIAN}>
            <AppointmentManagement />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.CLINICIAN.CALENDAR}
        element={
          <ProtectedRoute requiredRole={ROLES.CLINICIAN}>
            <ClinicianCalendar />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.CLINICIAN.ANALYTICS}
        element={
          <ProtectedRoute requiredRole={ROLES.CLINICIAN}>
            <ClinicianAnalytics />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.CLINICIAN.VOICE_RECORDING}
        element={
          <ProtectedRoute requiredRole={ROLES.CLINICIAN}>
            <VoiceRecordingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.CLINICIAN.CLINICAL_NOTES}
        element={
          <ProtectedRoute requiredRole={ROLES.CLINICIAN}>
            <ClinicalNotes />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.CLINICIAN.CLINICAL_NOTE_DETAIL}
        element={
          <ProtectedRoute requiredRole={ROLES.CLINICIAN}>
            <ClinicalNoteDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.CLINICIAN.NOTIFICATIONS}
        element={
          <ProtectedRoute requiredRole={ROLES.CLINICIAN}>
            <Notifications />
          </ProtectedRoute>
        }
      />
      
      {/* Admin Routes */}
      <Route
        path={PROTECTED_ROUTES.ADMIN.DASHBOARD}
        element={
          <ProtectedRoute requiredRole={ROLES.ADMIN}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.ADMIN.ANALYTICS}
        element={
          <ProtectedRoute requiredRole={ROLES.ADMIN}>
            <AdminAnalytics />
          </ProtectedRoute>
        }
      />
      <Route
        path={PROTECTED_ROUTES.ADMIN.USERS}
        element={
          <ProtectedRoute requiredRole={ROLES.ADMIN}>
            <ManageMembers />
          </ProtectedRoute>
        }
      />
          <Route
            path={PROTECTED_ROUTES.ADMIN.TEAM_VIEW}
            element={
              <ProtectedRoute requiredRole={ROLES.ADMIN}>
                <TeamView />
              </ProtectedRoute>
            }
          />
          <Route
            path={PROTECTED_ROUTES.ADMIN.CLINICIAN_VIEW}
            element={
              <ProtectedRoute requiredRole={ROLES.ADMIN}>
                <ClinicianView />
              </ProtectedRoute>
            }
          />
          <Route
            path={PROTECTED_ROUTES.ADMIN.CLINICIAN_VIEW_DETAIL}
            element={
              <ProtectedRoute requiredRole={ROLES.ADMIN}>
                <ClinicianView />
              </ProtectedRoute>
            }
          />
          <Route
            path={PROTECTED_ROUTES.ADMIN.CLINICIAN_CASES}
            element={
              <ProtectedRoute requiredRole={ROLES.ADMIN}>
                <AdminClinicianCases />
              </ProtectedRoute>
            }
          />
          <Route
            path={PROTECTED_ROUTES.ADMIN.CLINICIAN_CASE_DETAIL}
            element={
              <ProtectedRoute requiredRole={ROLES.ADMIN}>
                <CaseDetail />
              </ProtectedRoute>
            }
          />
      
      {/* Profile route - accessible to all authenticated users */}
      <Route
        path={PROTECTED_ROUTES.PROFILE}
        element={
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        }
      />
      
      {/* Generic dashboard route - redirects based on role */}
      <Route
        path={PROTECTED_ROUTES.DASHBOARD}
        element={
          <ProtectedRoute>
            <DashboardRedirect />
          </ProtectedRoute>
        }
      />
      
      {/* Error Routes */}
      <Route path="/unauthorized" element={<Unauthorized />} />
      
      {/* Home and Catch-All Routes */}
      <Route 
        path={PUBLIC_ROUTES.HOME}
        element={user ? <DashboardRedirect /> : <Navigate to={PUBLIC_ROUTES.LOGIN} replace />} 
      />
      <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
