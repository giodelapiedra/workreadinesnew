import { useState, useEffect, useCallback } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './TeamView.css'

interface Supervisor {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  business_name: string | null
  business_registration_number: string | null
  teams_count: number
  workers_count: number
}

interface TeamLeader {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
}

interface TeamMember {
  id: string
  user_id: string
  email: string
  first_name: string | null
  last_name: string | null
  full_name: string
  phone: string | null
}

interface Team {
  id: string
  name: string
  site_location: string | null
  team_leader: TeamLeader | null
  members: TeamMember[]
  members_count: number
}

interface SupervisorDetails {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  full_name: string
  business_name: string | null
  business_registration_number: string | null
}

export function TeamView() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [supervisors, setSupervisors] = useState<Supervisor[]>([])
  const [selectedSupervisor, setSelectedSupervisor] = useState<SupervisorDetails | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [showDetails, setShowDetails] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)

  useEffect(() => {
    fetchSupervisors()
  }, [])

  const fetchSupervisors = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const result = await apiClient.get<{ supervisors: Supervisor[] }>(API_ROUTES.ADMIN.SUPERVISORS)

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch supervisors')
      }

      setSupervisors(result.data.supervisors || [])
    } catch (err: any) {
      console.error('Error fetching supervisors:', err)
      setError(err.message || 'Failed to load supervisors')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSupervisorClick = useCallback(async (supervisorId: string) => {
    try {
      setDetailsLoading(true)
      setError('')

      const result = await apiClient.get<{ supervisor: SupervisorDetails; teams: Team[] }>(
        API_ROUTES.ADMIN.SUPERVISOR(supervisorId)
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch supervisor details')
      }

      setSelectedSupervisor(result.data.supervisor)
      setTeams(result.data.teams || [])
      setShowDetails(true)
    } catch (err: any) {
      console.error('Error fetching supervisor details:', err)
      setError(err.message || 'Failed to load supervisor details')
    } finally {
      setDetailsLoading(false)
    }
  }, [])

  // Reusable helper function for getting initials from any user object
  const getInitials = useCallback((user: { first_name?: string | null; last_name?: string | null; full_name?: string | null; email?: string }) => {
    if (user.first_name && user.last_name) {
      return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase()
    }
    if (user.full_name) {
      const parts = user.full_name.split(' ')
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      }
      return user.full_name[0].toUpperCase()
    }
    if (user.email) {
      return user.email[0].toUpperCase()
    }
    return 'U'
  }, [])

  // Reusable helper function for getting full name from any user object
  const getFullName = useCallback((user: { full_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string }) => {
    if (user.full_name) return user.full_name
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }
    return user.email || 'Unknown'
  }, [])

  if (loading) {
    return (
      <DashboardLayout>
        <div className="team-view">
          <Loading message="Loading supervisors..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="team-view">
        {/* Header */}
        <header className="team-view-header">
          <h1 className="team-view-title">Team View</h1>
          <p className="team-view-subtitle">Site Supervisors Overview</p>
        </header>

        {/* Error Message */}
        {error && (
          <div className="team-view-error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{error}</span>
            <button onClick={fetchSupervisors} className="retry-button">
              Retry
            </button>
          </div>
        )}

        {/* Supervisors Grid */}
        {!error && (
          <>
            {supervisors.length === 0 ? (
              <div className="team-view-empty">
                <p>No supervisors found</p>
              </div>
            ) : (
              <div className="supervisors-grid">
                {supervisors.map((supervisor) => (
                  <div 
                    key={supervisor.id} 
                    className="supervisor-card"
                    onClick={() => handleSupervisorClick(supervisor.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="supervisor-card-header">
                      <div className="supervisor-avatar">
                        {getInitials(supervisor)}
                      </div>
                      <div className="supervisor-name-section">
                        <h3 className="supervisor-name">{getFullName(supervisor)}</h3>
                        <p className="supervisor-role">Site Supervisor</p>
                      </div>
                    </div>
                    <div className="supervisor-details">
                      <div className="supervisor-detail-item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                          <polyline points="22,6 12,13 2,6"></polyline>
                        </svg>
                        <span className="supervisor-email">{supervisor.email}</span>
                      </div>
                      {supervisor.business_name && (
                        <div className="supervisor-detail-item">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                          </svg>
                          <span>{supervisor.business_name}</span>
                        </div>
                      )}
                    </div>
                    <div className="supervisor-stats">
                      <div className="supervisor-stat-item">
                        <div className="stat-icon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                          </svg>
                        </div>
                        <div className="stat-content">
                          <span className="stat-label">Teams Managed</span>
                          <span className="stat-value">{supervisor.teams_count}</span>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="stat-arrow">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      </div>
                      <div className="supervisor-stat-item">
                        <div className="stat-icon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                          </svg>
                        </div>
                        <div className="stat-content">
                          <span className="stat-label">Total Workers</span>
                          <span className="stat-value">{supervisor.workers_count}</span>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="stat-arrow">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Supervisor Details Modal */}
        {showDetails && selectedSupervisor && (
          <div className="details-overlay" onClick={() => setShowDetails(false)}>
            <div className="details-modal" onClick={(e) => e.stopPropagation()}>
              <div className="details-header">
                <div className="details-header-content">
                  <div className="details-avatar-large">
                    {getInitials(selectedSupervisor)}
                  </div>
                  <div>
                    <h2 className="details-title">{selectedSupervisor.full_name}</h2>
                    <p className="details-subtitle">Site Supervisor</p>
                  </div>
                </div>
                <button className="details-close" onClick={() => setShowDetails(false)}>
                  ×
                </button>
              </div>

              <div className="details-body">
                {detailsLoading ? (
                  <div className="details-loading">
                    <Loading message="Loading details..." size="small" />
                  </div>
                ) : (
                  <>
                    <div className="details-section">
                      <h3 className="details-section-title">Supervisor Information</h3>
                      <div className="details-info-grid">
                        <div className="details-info-item">
                          <span className="details-info-label">Email</span>
                          <span className="details-info-value">{selectedSupervisor.email}</span>
                        </div>
                        {selectedSupervisor.business_name && (
                          <div className="details-info-item">
                            <span className="details-info-label">Business Name</span>
                            <span className="details-info-value">{selectedSupervisor.business_name}</span>
                          </div>
                        )}
                        {selectedSupervisor.business_registration_number && (
                          <div className="details-info-item">
                            <span className="details-info-label">Business Registration</span>
                            <span className="details-info-value">{selectedSupervisor.business_registration_number}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="details-section">
                      <h3 className="details-section-title">Teams & Team Leaders ({teams.length})</h3>
                      {teams.length === 0 ? (
                        <p className="details-empty">No teams assigned</p>
                      ) : (
                        <div className="teams-list">
                          {teams.map((team) => (
                            <div key={team.id} className="team-card">
                              <div className="team-card-header">
                                <h4 className="team-name">{team.name}</h4>
                                {team.site_location && (
                                  <span className="team-location">{team.site_location}</span>
                                )}
                              </div>
                              {team.team_leader ? (
                                <div className="team-leader-info">
                                  <div className="team-leader-avatar">
                                    {getInitials(team.team_leader)}
                                  </div>
                                  <div className="team-leader-details">
                                    <span className="team-leader-name">{getFullName(team.team_leader)}</span>
                                    <span className="team-leader-email">{team.team_leader.email}</span>
                                  </div>
                                </div>
                              ) : (
                                <p className="team-no-leader">No team leader assigned</p>
                              )}
                              <div className="team-members-section">
                                <div className="team-members-header">
                                  <span className="team-members-label">Team Members ({team.members_count})</span>
                                </div>
                                {team.members.length === 0 ? (
                                  <p className="team-no-members">No members in this team</p>
                                ) : (
                                  <div className="team-members-list">
                                    {team.members.map((member) => (
                                      <div key={member.id} className="team-member-item">
                                        <div className="team-member-avatar">
                                          {getInitials(member)}
                                        </div>
                                        <div className="team-member-info">
                                          <span className="team-member-name">{member.full_name}</span>
                                          <span className="team-member-email">{member.email}</span>
                                          {member.phone && (
                                            <span className="team-member-phone">{member.phone}</span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

