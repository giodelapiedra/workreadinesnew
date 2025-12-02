import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { SupervisorBusinessInfoModal } from '../../../components/SupervisorBusinessInfoModal'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { calculateAge } from '../../../shared/date'
import { validateBirthday } from '../../../utils/validationUtils'
import './SupervisorDashboard.css'

interface TeamCompliance {
  id: string
  name: string
  siteLocation: string | null
  teamLeader: {
    id: string
    email: string
    fullName: string
    initials: string
  } | null
  memberCount: number // Total members (including exceptions)
  activeMemberCount: number // Members without active exceptions (used for compliance)
  exceptionCount: number // Number of workers with active exceptions
  checkInStats: {
    green: number
    amber: number
    pending: number
  }
  checkInCompletion: number // Percentage (based on activeMemberCount)
  warmUpCompletion: number // Percentage (we'll calculate or fetch)
}

export function SupervisorDashboard() {
  const { user, business_name, business_registration_number } = useAuth()
  const navigate = useNavigate()
  const supervisorName = user?.email?.split('@')[0] || 'Supervisor'
  
  // Check if supervisor has required business information
  const hasBusinessInfo = business_name && business_registration_number
  const [showBusinessModal, setShowBusinessModal] = useState(!hasBusinessInfo)
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<TeamCompliance[]>([])
  const [overallMetrics, setOverallMetrics] = useState({
    totalTeams: 0,
    totalMembers: 0,
    totalCases: 0, // Total cases across all team leaders
    teamsCompleted: 0, // Teams with 100% check-in completion
  })
  const [showCreateTeamLeaderModal, setShowCreateTeamLeaderModal] = useState(false)
  const [createTeamLeaderLoading, setCreateTeamLeaderLoading] = useState(false)
  const [createTeamLeaderError, setCreateTeamLeaderError] = useState<string | null>(null)
  const [showSuccessToast, setShowSuccessToast] = useState(false)
  const [successToastMessage, setSuccessToastMessage] = useState('')
  
  // Form state for creating team leader
  const [teamLeaderForm, setTeamLeaderForm] = useState({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    team_name: '',
    site_location: '',
    gender: '' as 'male' | 'female' | '',
    date_of_birth: '',
  })
  const [birthMonth, setBirthMonth] = useState('')
  const [birthDay, setBirthDay] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [birthdayError, setBirthdayError] = useState('')

  // OPTIMIZATION: Pending promise cache to prevent duplicate API calls
  const pendingFetch = useRef<Promise<void> | null>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Re-check business info when auth context updates
    if (business_name && business_registration_number) {
      setShowBusinessModal(false)
    } else {
      setShowBusinessModal(true)
    }
  }, [business_name, business_registration_number])

  useEffect(() => {
    let isMounted = true
    let isInitialized = false
    
    const initializeData = async () => {
      if (!isMounted || isInitialized) return
      isInitialized = true
      
      await fetchTeamsData()
    }
    
    initializeData()
    
    return () => {
      isMounted = false
    }
  }, []) // Run ONCE only

  // Listen for exception updates from team leader pages and refresh dashboard
  useEffect(() => {
    const handleExceptionUpdate = () => {
      // Refresh dashboard data when exception is updated
      fetchTeamsData()
    }

    window.addEventListener('exceptionUpdated', handleExceptionUpdate)

    return () => {
      window.removeEventListener('exceptionUpdated', handleExceptionUpdate)
    }
  }, []) // Empty deps - fetchTeamsData is stable

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
        toastTimeoutRef.current = null
      }
    }
  }, [])

  const fetchTeamsData = async () => {
    // OPTIMIZATION: Return pending promise if already fetching
    if (pendingFetch.current) {
      return pendingFetch.current
    }
    
    const promise = (async () => {
      try {
        setLoading(true)
        setError(null)

        // Add cache-busting parameter to ensure fresh data
        const result = await apiClient.get<{ teams: any[]; totalCases?: number }>(
          `${API_ROUTES.SUPERVISOR.TEAMS}?_t=${Date.now()}`
        )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch teams data')
      }

      const data = result.data
      
      if (!data.teams || data.teams.length === 0) {
        setTeams([])
        setOverallMetrics({
          totalTeams: 0,
          totalMembers: 0,
          totalCases: 0,
          teamsCompleted: 0,
        })
        setLoading(false)
        return
      }

      // Transform team data to include compliance metrics
      const teamsWithCompliance: TeamCompliance[] = data.teams.map((team: any) => {
        // SECURITY: Use activeMemberCount (excludes workers with exceptions) for compliance calculation
        // activeMemberCount can be 0, so we need to check if it's explicitly provided
        const activeMemberCount = team.activeMemberCount !== undefined ? team.activeMemberCount : team.memberCount
        const activeMembers = activeMemberCount
        const checkedInCount = team.checkInStats.green + team.checkInStats.amber
        const checkInCompletion = activeMembers > 0 
          ? Math.round((checkedInCount / activeMembers) * 100)
          : 0
        
        // For now, warm-up completion is same as check-in (can be enhanced later)
        const warmUpCompletion = checkInCompletion

        return {
          id: team.id,
          name: team.name,
          siteLocation: team.siteLocation,
          teamLeader: team.teamLeader,
          memberCount: team.memberCount, // Total members including those with exceptions
          activeMemberCount, // Members without active exceptions (explicitly use provided value)
          exceptionCount: team.exceptionCount || 0, // Workers with active exceptions
          checkInStats: team.checkInStats,
          checkInCompletion,
          warmUpCompletion,
        }
      })

      // Calculate overall metrics - sum of activeMemberCount (excludes workers with exceptions)
      const totalTeams = teamsWithCompliance.length
      const totalActiveMembers = teamsWithCompliance.reduce((sum, team) => sum + (team.activeMemberCount || 0), 0)
      const teamsCompleted = teamsWithCompliance.filter(team => team.checkInCompletion === 100).length
      const totalCases = data.totalCases || 0 // Get total cases from backend

      setTeams(teamsWithCompliance)
      setOverallMetrics({
        totalTeams,
        totalMembers: totalActiveMembers, // Active members without exceptions
        totalCases,
        teamsCompleted,
      })
      } catch (err: any) {
        console.error('Error fetching teams data:', err)
        setError(err.message || 'Failed to load teams data')
      } finally {
        setLoading(false)
        pendingFetch.current = null
      }
    })()
    
    pendingFetch.current = promise
    return promise
  }

  const handleViewTeamDetails = (teamId: string) => {
    navigate(`${PROTECTED_ROUTES.SUPERVISOR.TEAMS}?teamId=${teamId}`)
  }

  // Use centralized validation utility
  // Note: validateBirthday is imported from utils/validationUtils

  const handleCreateTeamLeader = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault()
    }
    try {
      setCreateTeamLeaderLoading(true)
      setCreateTeamLeaderError(null)

      // Validate birthday from dropdowns
      if (!birthMonth || !birthDay || !birthYear) {
        setCreateTeamLeaderError('Date of Birth is required')
        setCreateTeamLeaderLoading(false)
        return
      }

      // Construct date string from dropdowns
      const dateStr = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`
      const birthDate = new Date(dateStr)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      // Validate date
      if (isNaN(birthDate.getTime())) {
        setCreateTeamLeaderError('Invalid date of birth')
        setCreateTeamLeaderLoading(false)
        return
      }
      
      if (birthDate >= today) {
        setCreateTeamLeaderError('Date of Birth must be in the past')
        setCreateTeamLeaderLoading(false)
        return
      }
      
      // Check minimum age (18 years old)
      const age = calculateAge(dateStr)
      if (age === null) {
        setCreateTeamLeaderError('Invalid date of birth')
        setCreateTeamLeaderLoading(false)
        return
      }
      if (age < 18) {
        setCreateTeamLeaderError(`Age must be at least 18 years old. Current age: ${age} years old`)
        setCreateTeamLeaderLoading(false)
        return
      }

      const result = await apiClient.post<{ message: string }>(
        API_ROUTES.SUPERVISOR.TEAM_LEADERS,
        {
          ...teamLeaderForm,
          gender: teamLeaderForm.gender || undefined,
          date_of_birth: dateStr,
        }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to create team leader')
      }

      // Reset form and close modal
      setTeamLeaderForm({
        email: '',
        password: '',
        first_name: '',
        last_name: '',
        team_name: '',
        site_location: '',
        gender: '',
        date_of_birth: '',
      })
      setBirthMonth('')
      setBirthDay('')
      setBirthYear('')
      setBirthdayError('')
      setShowCreateTeamLeaderModal(false)
      
      // Refresh teams data
      await fetchTeamsData()

      setSuccessToastMessage('Team leader successfully created')
      setShowSuccessToast(true)
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
      toastTimeoutRef.current = setTimeout(() => {
        setShowSuccessToast(false)
        toastTimeoutRef.current = null
      }, 3000)

    } catch (err: any) {
      setCreateTeamLeaderError(err.message || 'Failed to create team leader')
    } finally {
      setCreateTeamLeaderLoading(false)
    }
  }

  // Show business info modal if missing
  if (showBusinessModal) {
    return (
      <DashboardLayout>
        <SupervisorBusinessInfoModal 
          onComplete={() => {
            setShowBusinessModal(false)
          }} 
        />
      </DashboardLayout>
    )
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="supervisor-dashboard">
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100vh' 
          }}>
            <div>Loading dashboard data...</div>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="supervisor-dashboard">
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100vh',
            color: '#ef4444'
          }}>
            <div>Error: {error}</div>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="supervisor-dashboard">
        {showSuccessToast && (
          <div className="success-toast">
            <div className="success-toast-content">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>{successToastMessage || 'Action completed successfully'}</span>
            </div>
          </div>
        )}
        {/* Header */}
        <header className="supervisor-header">
          <div className="supervisor-header-left">
            <h1 className="supervisor-title">Team Compliance Dashboard</h1>
            <p className="supervisor-subtitle">
              Supervisor: {supervisorName} • {overallMetrics.totalTeams} Team{overallMetrics.totalTeams !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="supervisor-header-actions">
            <button 
              onClick={() => setShowCreateTeamLeaderModal(true)}
              className="supervisor-create-btn"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Create Team Leader
            </button>
            <button 
              onClick={fetchTeamsData}
              className="supervisor-export-btn"
              title="Refresh data"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              Refresh
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="supervisor-main">
          <div className="supervisor-container">
            {/* Overall Summary Cards */}
            <div className="supervisor-metrics-grid" style={{ marginBottom: '32px' }}>
              {/* Total Teams */}
              <div className="supervisor-metric-card">
                <div className="supervisor-metric-header">
                  <div
                    className="supervisor-metric-icon"
                    style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}
                    aria-hidden="true"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="9" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h3 className="supervisor-metric-title">Total Teams</h3>
                </div>
                <div className="supervisor-metric-value" style={{ color: '#3b82f6' }}>
                  {overallMetrics.totalTeams}
                </div>
                <p className="supervisor-metric-subtitle">
                  {overallMetrics.teamsCompleted} with 100% completion
                </p>
              </div>

              {/* Total Active Members */}
              <div className="supervisor-metric-card">
                <div className="supervisor-metric-header">
                  <div
                    className="supervisor-metric-icon"
                    style={{ backgroundColor: '#EDE9FE', color: '#6D28D9' }}
                    aria-hidden="true"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M19 21v-2a4 4 0 0 0-4-4h-6a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M20 8v6" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M23 11h-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h3 className="supervisor-metric-title">Active Members</h3>
                </div>
                <div className="supervisor-metric-value" style={{ color: '#8b5cf6' }}>
                  {overallMetrics.totalMembers}
                </div>
                <p className="supervisor-metric-subtitle">
                  Without active exceptions
                </p>
              </div>

              {/* Total Cases */}
              <div className="supervisor-metric-card">
                <div className="supervisor-metric-header">
                  <div
                    className="supervisor-metric-icon"
                    style={{ backgroundColor: '#DCFCE7', color: '#047857' }}
                    aria-hidden="true"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M9 13h6" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M9 17h3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h3 className="supervisor-metric-title">Total Cases</h3>
                </div>
                <div className="supervisor-metric-value" style={{ color: '#3b82f6' }}>
                  {overallMetrics.totalCases}
                </div>
                <p className="supervisor-metric-subtitle">
                  Across all team leaders
                </p>
              </div>
            </div>

            {/* Team Compliance Section */}
            <div className="supervisor-compliance-section">
              <div className="supervisor-compliance-header">
                <div className="supervisor-compliance-title-group">
                  <h2 className="supervisor-compliance-title">Team Compliance</h2>
                  <p className="supervisor-compliance-subtitle">Monitor check-in completion for each team</p>
                </div>
              </div>

              {teams.length === 0 ? (
                <div className="supervisor-empty-state">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                  </svg>
                  <h3>No Teams Yet</h3>
                  <p>Create your first team leader to get started</p>
                  <button onClick={() => setShowCreateTeamLeaderModal(true)}>
                    Create Team Leader
                  </button>
                </div>
              ) : (
                <div className="supervisor-teams-grid">
                  {teams.map((team) => (
                    <div 
                      key={team.id} 
                      className="supervisor-team-card"
                      onClick={() => handleViewTeamDetails(team.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      {/* Team Header */}
                      <div className="supervisor-team-card-header">
                        <div>
                          <h3 className="supervisor-team-card-title">{team.name}</h3>
                          {team.siteLocation && (
                            <p className="supervisor-team-card-location">{team.siteLocation}</p>
                          )}
                        </div>
                        {team.teamLeader && (
                          <div className="supervisor-team-leader-badge">
                            <div className="supervisor-member-avatar">
                              {team.teamLeader.initials}
                            </div>
                            <span style={{ fontSize: '12px', color: '#6e7681', marginLeft: '8px' }}>
                              {team.teamLeader.fullName}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Check-In Completion */}
                      <div className="supervisor-team-metric">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{ fontSize: '13px', fontWeight: '500', color: '#0d0d0d' }}>
                            Check-In Completion
                          </span>
                          <span style={{ fontSize: '16px', fontWeight: '600', color: '#0d0d0d' }}>
                            {team.checkInCompletion}%
                          </span>
                        </div>
                        <div className="supervisor-progress-bar" style={{ marginBottom: '12px' }}>
                          <div 
                            className="supervisor-progress-fill"
                            style={{ 
                              width: `${team.checkInCompletion}%`,
                              backgroundColor: team.checkInCompletion === 100 ? '#10b981' : team.checkInCompletion >= 80 ? '#f59e0b' : '#ef4444'
                            }}
                          ></div>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#6e7681' }}>
                          <span>
                            <span style={{ color: '#10b981', fontWeight: '600' }}>{team.checkInStats.green}</span> Green
                          </span>
                          <span>
                            <span style={{ color: '#f59e0b', fontWeight: '600' }}>{team.checkInStats.amber}</span> Amber
                          </span>
                          <span>
                            <span style={{ color: '#6e7681', fontWeight: '600' }}>{team.checkInStats.pending}</span> Pending
                          </span>
                        </div>
                      </div>

                      {/* Team Stats */}
                      <div className="supervisor-team-stats">
                        <div className="supervisor-team-stat-item">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                          </svg>
                          <span>
                            {team.activeMemberCount} Active Member{team.activeMemberCount !== 1 ? 's' : ''}
                            {team.memberCount !== team.activeMemberCount && (
                              <span style={{ color: '#9ca3af' }}> ({team.memberCount} total)</span>
                            )}
                          </span>
                        </div>
                        {team.exceptionCount > 0 && (
                          <div className="supervisor-team-stat-item">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#f59e0b' }}>
                              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                              <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></path>
                            </svg>
                            <span style={{ color: '#f59e0b', fontWeight: '500' }}>
                              {team.exceptionCount} Exception{team.exceptionCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* View Details Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleViewTeamDetails(team.id)
                        }}
                      >
                        View Details
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Create Team Leader Modal */}
        {showCreateTeamLeaderModal && (
          <div 
            className="team-members-modal-overlay"
            onClick={() => !createTeamLeaderLoading && setShowCreateTeamLeaderModal(false)}
          >
            <div 
              className="team-members-modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="team-members-modal-header">
                <div>
                  <h2 className="team-members-modal-title">Create Team Leader</h2>
                  <p className="team-members-modal-subtitle">Create a new team leader account</p>
                </div>
                <button 
                  className="team-members-modal-close"
                  onClick={() => !createTeamLeaderLoading && setShowCreateTeamLeaderModal(false)}
                  aria-label="Close modal"
                  disabled={createTeamLeaderLoading}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              <div className="team-members-modal-body">
              {createTeamLeaderError && (
                  <div style={{ 
                    backgroundColor: '#FEF2F2', 
                    border: '1px solid #FEE2E2', 
                    borderRadius: '8px', 
                    padding: '12px',
                    marginBottom: '20px'
                  }}>
                    <p style={{ fontSize: '13px', color: '#991B1B', margin: 0 }}>
                  {createTeamLeaderError}
                    </p>
                </div>
              )}

                <form onSubmit={(e) => { e.preventDefault(); handleCreateTeamLeader(); }}>
                  <div className="team-members-form-group">
                    <label className="team-members-form-label">Email *</label>
                  <input
                    type="email"
                      className="team-members-form-input"
                    value={teamLeaderForm.email}
                      onChange={(e) => {
                        setTeamLeaderForm({ ...teamLeaderForm, email: e.target.value })
                        setCreateTeamLeaderError(null)
                      }}
                      placeholder="Enter email address"
                    disabled={createTeamLeaderLoading}
                      required
                  />
                </div>

                  <div className="team-members-form-group">
                    <label className="team-members-form-label">Password *</label>
                  <input
                    type="password"
                      className="team-members-form-input"
                    value={teamLeaderForm.password}
                      onChange={(e) => {
                        setTeamLeaderForm({ ...teamLeaderForm, password: e.target.value })
                        setCreateTeamLeaderError(null)
                      }}
                      placeholder="Enter password (min. 6 characters)"
                    disabled={createTeamLeaderLoading}
                      minLength={6}
                      required
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="team-members-form-group" style={{ flex: 1 }}>
                      <label className="team-members-form-label">First Name *</label>
                    <input
                      type="text"
                        className="team-members-form-input"
                      value={teamLeaderForm.first_name}
                        onChange={(e) => {
                          setTeamLeaderForm({ ...teamLeaderForm, first_name: e.target.value })
                          setCreateTeamLeaderError(null)
                        }}
                        placeholder="Enter first name"
                      disabled={createTeamLeaderLoading}
                        maxLength={100}
                        required
                    />
                  </div>

                    <div className="team-members-form-group" style={{ flex: 1 }}>
                      <label className="team-members-form-label">Last Name *</label>
                    <input
                      type="text"
                        className="team-members-form-input"
                      value={teamLeaderForm.last_name}
                        onChange={(e) => {
                          setTeamLeaderForm({ ...teamLeaderForm, last_name: e.target.value })
                          setCreateTeamLeaderError(null)
                        }}
                        placeholder="Enter last name"
                      disabled={createTeamLeaderLoading}
                        maxLength={100}
                        required
                    />
                  </div>
                </div>

                  <div className="team-members-form-group">
                    <label className="team-members-form-label">Team Name *</label>
                  <input
                    type="text"
                      className="team-members-form-input"
                    value={teamLeaderForm.team_name}
                      onChange={(e) => {
                        setTeamLeaderForm({ ...teamLeaderForm, team_name: e.target.value })
                        setCreateTeamLeaderError(null)
                      }}
                    placeholder="e.g., Team Alpha"
                      disabled={createTeamLeaderLoading}
                      required
                  />
                </div>

                  <div className="team-members-form-group">
                    <label className="team-members-form-label">Site Location (Optional)</label>
                  <input
                    type="text"
                      className="team-members-form-input"
                    value={teamLeaderForm.site_location}
                      onChange={(e) => {
                        setTeamLeaderForm({ ...teamLeaderForm, site_location: e.target.value })
                        setCreateTeamLeaderError(null)
                      }}
                    placeholder="e.g., Pilbara Site A"
                      disabled={createTeamLeaderLoading}
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="team-members-form-group" style={{ flex: 1 }}>
                      <label className="team-members-form-label">Gender <span className="required">*</span></label>
                    <select
                        className="team-members-form-input"
                      value={teamLeaderForm.gender}
                        onChange={(e) => {
                          setTeamLeaderForm({ ...teamLeaderForm, gender: e.target.value as 'male' | 'female' | '' })
                          setCreateTeamLeaderError(null)
                        }}
                      disabled={createTeamLeaderLoading}
                      required
                    >
                      <option value="">Select Gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>

                    <div className="team-members-form-group" style={{ flex: 1 }}>
                      <label className="team-members-form-label">
                        Birthday <span className="required">*</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: '4px', cursor: 'help' }}>
                        <title>Select birthday</title>
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                      </svg>
                    </label>
                    {birthdayError && (
                      <div className="birthday-error-message" style={{ marginBottom: '12px' }}>
                        {birthdayError}
                      </div>
                    )}
                    <div className="birthday-selects">
                      <select
                        value={birthMonth}
                        onChange={(e) => {
                          setBirthMonth(e.target.value)
                          const validation = validateBirthday(e.target.value, birthDay, birthYear)
                          setBirthdayError(validation.error)
                            setCreateTeamLeaderError(null)
                        }}
                          className="team-members-form-input birthday-select"
                        disabled={createTeamLeaderLoading}
                        required
                      >
                        <option value="">Month</option>
                        {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, index) => (
                          <option key={month} value={String(index + 1)}>{month}</option>
                        ))}
                      </select>
                      <select
                        value={birthDay}
                        onChange={(e) => {
                          setBirthDay(e.target.value)
                          const validation = validateBirthday(birthMonth, e.target.value, birthYear)
                          setBirthdayError(validation.error)
                            setCreateTeamLeaderError(null)
                        }}
                          className="team-members-form-input birthday-select"
                        disabled={createTeamLeaderLoading}
                        required
                      >
                        <option value="">Day</option>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                          <option key={day} value={String(day)}>{day}</option>
                        ))}
                      </select>
                      <select
                        value={birthYear}
                        onChange={(e) => {
                          setBirthYear(e.target.value)
                          const validation = validateBirthday(birthMonth, birthDay, e.target.value)
                          setBirthdayError(validation.error)
                            setCreateTeamLeaderError(null)
                        }}
                          className="team-members-form-input birthday-select"
                        disabled={createTeamLeaderLoading}
                        required
                      >
                        <option value="">Year</option>
                        {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map(year => (
                          <option key={year} value={String(year)}>{year}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  </div>
                </form>
                </div>

              <div className="team-members-modal-footer">
                  <button
                  className="team-members-modal-close-btn"
                  onClick={() => {
                    if (!createTeamLeaderLoading) {
                      setShowCreateTeamLeaderModal(false)
                      setCreateTeamLeaderError(null)
                      setTeamLeaderForm({
                        email: '',
                        password: '',
                        first_name: '',
                        last_name: '',
                        team_name: '',
                        site_location: '',
                        gender: '',
                        date_of_birth: '',
                      })
                      setBirthMonth('')
                      setBirthDay('')
                      setBirthYear('')
                      setBirthdayError('')
                    }
                  }}
                    disabled={createTeamLeaderLoading}
                  >
                    Cancel
                  </button>
                  <button
                  className="team-members-modal-save-btn"
                    onClick={handleCreateTeamLeader}
                    disabled={createTeamLeaderLoading || !teamLeaderForm.email || !teamLeaderForm.password || !teamLeaderForm.first_name || !teamLeaderForm.last_name || !teamLeaderForm.team_name || !teamLeaderForm.gender || !birthMonth || !birthDay || !birthYear}
                  >
                    {createTeamLeaderLoading ? 'Creating...' : 'Create Team Leader'}
                  </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
