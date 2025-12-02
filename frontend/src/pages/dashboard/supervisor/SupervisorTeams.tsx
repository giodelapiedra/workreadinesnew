import { useState, useEffect, useCallback, useMemo } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { Avatar } from '../../../components/Avatar'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { calculateAge } from '../../../shared/date'
import { validateBirthday } from '../../../utils/validationUtils'
import './SupervisorTeams.css'
import './SupervisorDashboard.css'

interface TeamLeader {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  initials: string
}

interface Team {
  id: string
  name: string
  siteLocation: string | null
  teamLeader: TeamLeader | null
  memberCount: number
  activeMemberCount?: number
  exceptionCount?: number
  checkInStats: {
    green: number
    amber: number
    pending: number
  }
  createdAt: string
}

// Helper for team leader avatar colors (not workers)
const getAvatarColor = (name: string) => {
  const colors = ['#9b8b7e', '#5b4fc7', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6']
  const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length
  return colors[index]
}

export function SupervisorTeams() {
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [showTeamDetailsModal, setShowTeamDetailsModal] = useState(false)
  const [teamMembers, setTeamMembers] = useState<any[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  const fetchTeams = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const result = await apiClient.get<{ teams: Team[] }>(
        `${API_ROUTES.SUPERVISOR.TEAMS}?_t=${Date.now()}`
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch teams')
      }

      setTeams(result.data.teams || [])
    } catch (err: any) {
      console.error('Error fetching teams:', err)
      setError(err.message || 'Failed to load teams')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTeams()
  }, [fetchTeams])

  // Reset form helper function (optimized - no duplication)
  const resetTeamLeaderForm = useCallback(() => {
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
    setCreateError(null)
  }, [])

  // Validate birthday and show error if invalid
  // Use centralized validation utility
  const handleCreateTeamLeader = useCallback(async () => {
    try {
      setCreateLoading(true)
      setCreateError(null)

      // Validate birthday from dropdowns
      if (!birthMonth || !birthDay || !birthYear) {
        setCreateError('Date of Birth is required')
        setCreateLoading(false)
        return
      }

      // Construct date string from dropdowns
      const dateStr = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`
      const birthDate = new Date(dateStr)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      // Validate date
      if (isNaN(birthDate.getTime())) {
        setCreateError('Invalid date of birth')
        setCreateLoading(false)
        return
      }
      
      if (birthDate >= today) {
        setCreateError('Date of Birth must be in the past')
        setCreateLoading(false)
        return
      }
      
      // Check minimum age (18 years old)
      const age = calculateAge(dateStr)
      if (age === null) {
        setCreateError('Invalid date of birth')
        setCreateLoading(false)
        return
      }
      if (age < 18) {
        setCreateError(`Age must be at least 18 years old. Current age: ${age} years old`)
        setCreateLoading(false)
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
      resetTeamLeaderForm()
      setShowCreateModal(false)
      
      // Refresh teams list
      fetchTeams()
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create team leader')
    } finally {
      setCreateLoading(false)
    }
  }, [birthMonth, birthDay, birthYear, teamLeaderForm, resetTeamLeaderForm, fetchTeams])

  const handleViewTeam = async (team: Team) => {
    setSelectedTeam(team)
    setShowTeamDetailsModal(true)
    setLoadingMembers(true)
    
    try {
      // Fetch team members from the supervisor's team endpoint
      const result = await apiClient.get<{ members: any[] }>(
        `${API_ROUTES.SUPERVISOR.TEAMS}/${team.id}/members`
      )

      if (!isApiError(result)) {
        setTeamMembers(result.data.members || [])
      } else {
        setTeamMembers([])
      }
    } catch (err) {
      console.error('Error fetching team members:', err)
      setTeamMembers([])
    } finally {
      setLoadingMembers(false)
    }
  }

  const closeTeamDetailsModal = () => {
    setShowTeamDetailsModal(false)
    setSelectedTeam(null)
    setTeamMembers([])
  }

  const handleDeleteClick = (e: React.MouseEvent, team: Team) => {
    e.stopPropagation() // Prevent opening team details modal
    setTeamToDelete(team)
    setShowDeleteModal(true)
    setDeletePassword('')
    setDeleteError(null)
  }

  const handleDeleteTeam = async () => {
    if (!teamToDelete) return

    if (!deletePassword.trim()) {
      setDeleteError('Password is required to delete team')
      return
    }

    try {
      setDeleteLoading(true)
      setDeleteError(null)

      // Use apiClient for consistent error handling and security
      const result = await apiClient.delete<{ message: string }>(
        `${API_ROUTES.SUPERVISOR.TEAMS}/${teamToDelete.id}`,
        {
          body: JSON.stringify({ password: deletePassword }),
        }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to delete team')
      }

      // Close modal and refresh teams list
      setShowDeleteModal(false)
      setTeamToDelete(null)
      setDeletePassword('')
      fetchTeams()
    } catch (err: any) {
      console.error('Error deleting team:', err)
      setDeleteError(err.message || 'Failed to delete team')
    } finally {
      setDeleteLoading(false)
    }
  }

  const closeDeleteModal = () => {
    if (deleteLoading) return // Prevent closing while deleting
    setShowDeleteModal(false)
    setTeamToDelete(null)
    setDeletePassword('')
    setDeleteError(null)
  }

  // Memoize filtered teams to avoid unnecessary recalculations
  const filteredTeams = useMemo(() => {
    if (!searchQuery.trim()) return teams
    const query = searchQuery.toLowerCase()
    return teams.filter(team => 
      team.name.toLowerCase().includes(query) ||
      team.siteLocation?.toLowerCase().includes(query) ||
      team.teamLeader?.fullName.toLowerCase().includes(query)
  )
  }, [teams, searchQuery])


  if (loading) {
    return (
      <DashboardLayout>
        <div className="supervisor-teams">
          <Loading message="Loading teams..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="supervisor-teams">
          <div className="teams-error">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <h2>Error Loading Teams</h2>
            <p>{error}</p>
            <button onClick={fetchTeams} className="retry-btn">Try Again</button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="supervisor-teams">
        {/* Header */}
        <div className="teams-header">
          <div className="teams-header-left">
            <h1 className="teams-title">All Teams</h1>
            <p className="teams-count">{teams.length} {teams.length === 1 ? 'team' : 'teams'}</p>
          </div>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="create-team-btn"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Create Team Leader
          </button>
        </div>

        {/* Search Bar */}
        <div className="teams-search-bar">
          <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
          </svg>
          <input
            type="text"
            placeholder="Search teams, locations, or team leaders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        {/* Teams Grid */}
        {filteredTeams.length === 0 ? (
          <div className="teams-empty">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <h2>No teams found</h2>
            <p>
              {searchQuery 
                ? 'Try adjusting your search query' 
                : 'Create your first team leader to get started'}
            </p>
            {!searchQuery && (
              <button 
                onClick={() => setShowCreateModal(true)}
                className="create-team-btn-secondary"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Create Team Leader
              </button>
            )}
          </div>
        ) : (
          <div className="teams-grid">
            {filteredTeams.map((team) => (
              <div 
                key={team.id} 
                className="team-card"
                onClick={() => handleViewTeam(team)}
              >
                {/* Team Leader Avatar */}
                <div className="team-card-header">
                  <div 
                    className="team-leader-avatar"
                    style={{ backgroundColor: getAvatarColor(team.teamLeader?.fullName || team.name) }}
                  >
                    {team.teamLeader?.initials || 'TL'}
                  </div>
                  <div className="team-card-title-section" style={{ flex: 1 }}>
                    <h3 className="team-card-name">{team.teamLeader?.fullName || 'No Team Leader'}</h3>
                    {team.teamLeader?.email && (
                      <p className="team-leader-email">{team.teamLeader.email}</p>
                    )}
                  </div>
                  <button
                    onClick={(e) => handleDeleteClick(e, team)}
                    className="team-delete-btn"
                    title="Delete Team"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>

                {/* Team Info */}
                <div className="team-card-body">
                  <div className="team-info-row">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    <span className="team-name-label">{team.name}</span>
                  </div>
                  
                  {team.siteLocation && (
                    <div className="team-info-row">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                      </svg>
                      <span className="team-location">{team.siteLocation}</span>
                    </div>
                  )}

                  <div className="team-info-row">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    <span className="team-members-count">
                      {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
                    </span>
                  </div>
                </div>

                {/* Status Summary */}
                <div className="team-card-footer">
                  <div className="status-dots">
                    {team.checkInStats.green > 0 && (
                      <div className="status-dot-group">
                        <div className="status-dot status-green"></div>
                        <span className="status-count">{team.checkInStats.green}</span>
                      </div>
                    )}
                    {team.checkInStats.amber > 0 && (
                      <div className="status-dot-group">
                        <div className="status-dot status-amber"></div>
                        <span className="status-count">{team.checkInStats.amber}</span>
                      </div>
                    )}
                    {team.checkInStats.pending > 0 && (
                      <div className="status-dot-group">
                        <div className="status-dot status-pending"></div>
                        <span className="status-count">{team.checkInStats.pending}</span>
                      </div>
                    )}
                    {team.memberCount === 0 && (
                      <span className="no-members-text">No members yet</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Team Leader Modal */}
      {showCreateModal && (
        <div 
          className="team-members-modal-overlay"
          onClick={() => !createLoading && setShowCreateModal(false)}
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
                onClick={() => !createLoading && setShowCreateModal(false)}
                aria-label="Close modal"
                disabled={createLoading}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="team-members-modal-body">
            {createError && (
                <div style={{ 
                  backgroundColor: '#FEF2F2', 
                  border: '1px solid #FEE2E2', 
                  borderRadius: '8px', 
                  padding: '12px',
                  marginBottom: '20px'
                }}>
                  <p style={{ fontSize: '13px', color: '#991B1B', margin: 0 }}>
                {createError}
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
                      setTeamLeaderForm(prev => ({ ...prev, email: e.target.value }))
                      setCreateError(prev => prev ? null : prev)
                    }}
                    placeholder="Enter email address"
                    disabled={createLoading}
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
                      setCreateError(null)
                    }}
                    placeholder="Enter password (min. 6 characters)"
                    disabled={createLoading}
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
                        setTeamLeaderForm(prev => ({ ...prev, first_name: e.target.value }))
                        setCreateError(prev => prev ? null : prev)
                      }}
                      placeholder="Enter first name"
                  disabled={createLoading}
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
                        setTeamLeaderForm(prev => ({ ...prev, last_name: e.target.value }))
                        setCreateError(prev => prev ? null : prev)
                      }}
                      placeholder="Enter last name"
                  disabled={createLoading}
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
                      setTeamLeaderForm(prev => ({ ...prev, team_name: e.target.value }))
                      setCreateError(prev => prev ? null : prev)
                    }}
                  placeholder="e.g., Team Alpha"
                    disabled={createLoading}
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
                      setTeamLeaderForm(prev => ({ ...prev, site_location: e.target.value }))
                      setCreateError(prev => prev ? null : prev)
                    }}
                  placeholder="e.g., Pilbara Site A"
                    disabled={createLoading}
                />
              </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <div className="team-members-form-group" style={{ flex: 1 }}>
                    <label className="team-members-form-label">Gender <span className="required">*</span></label>
                  <select
                      className="team-members-form-input"
                    value={teamLeaderForm.gender}
                        onChange={(e) => {
                          setTeamLeaderForm(prev => ({ ...prev, gender: e.target.value as 'male' | 'female' | '' }))
                          setCreateError(prev => prev ? null : prev)
                        }}
                    disabled={createLoading}
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
                          setCreateError(prev => prev ? null : prev)
                      }}
                        className="team-members-form-input birthday-select"
                      disabled={createLoading}
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
                          setCreateError(prev => prev ? null : prev)
                      }}
                        className="team-members-form-input birthday-select"
                      disabled={createLoading}
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
                          setCreateError(prev => prev ? null : prev)
                      }}
                        className="team-members-form-input birthday-select"
                      disabled={createLoading}
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
                  if (!createLoading) {
                    setShowCreateModal(false)
                    resetTeamLeaderForm()
                  }
                }}
                disabled={createLoading}
              >
                Cancel
              </button>
              <button
                className="team-members-modal-save-btn"
                onClick={handleCreateTeamLeader}
                disabled={
                  createLoading || 
                  !teamLeaderForm.email || 
                  !teamLeaderForm.password || 
                  !teamLeaderForm.first_name || 
                  !teamLeaderForm.last_name || 
                  !teamLeaderForm.team_name ||
                  !teamLeaderForm.gender ||
                  !birthMonth || 
                  !birthDay || 
                  !birthYear
                }
              >
                {createLoading ? 'Creating...' : 'Create Team Leader'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Team Details Modal */}
      {showTeamDetailsModal && selectedTeam && (
        <div 
          className="modal-overlay"
          onClick={closeTeamDetailsModal}
        >
          <div 
            className="modal-content modal-large"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-header-content">
                <div 
                  className="team-leader-avatar-large"
                  style={{ backgroundColor: getAvatarColor(selectedTeam.teamLeader?.fullName || selectedTeam.name) }}
                  aria-label={`Team ${selectedTeam.name} avatar`}
                >
                  {selectedTeam.teamLeader?.initials || 'TL'}
                </div>
                <div className="modal-header-text">
                  <h2 className="modal-team-name">{selectedTeam.name}</h2>
                  <p className="modal-subtitle">
                    {selectedTeam.siteLocation && (
                      <span className="modal-location">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }}>
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                          <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        {selectedTeam.siteLocation}
                      </span>
                    )}
                    {selectedTeam.siteLocation && selectedTeam.teamLeader && ' • '}
                    {selectedTeam.teamLeader && (
                      <span className="modal-leader">
                        Led by <strong>{selectedTeam.teamLeader.fullName}</strong>
                      </span>
                    )}
                    {!selectedTeam.teamLeader && <span className="modal-leader">No Team Leader</span>}
                  </p>
                </div>
              </div>
              <button 
                className="modal-close-btn"
                onClick={closeTeamDetailsModal}
                aria-label="Close team details modal"
                title="Close (Esc)"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="modal-body">
              {/* Team Stats */}
              <div className="team-stats-grid" role="group" aria-label="Team statistics">
                <div className="stat-card stat-card-primary" role="article" aria-label={`Total members: ${selectedTeam.memberCount}`}>
                  <div className="stat-icon" style={{ background: '#dbeafe', color: '#2563eb' }} aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                  </div>
                  <div className="stat-content">
                    <div className="stat-value" aria-label={`${selectedTeam.memberCount} total members`}>
                      {selectedTeam.memberCount}
                    </div>
                    <div className="stat-label">Total Members</div>
                  </div>
                </div>

                <div className="stat-card stat-card-success" role="article" aria-label={`Green status: ${selectedTeam.checkInStats.green}`}>
                  <div className="stat-icon" style={{ background: '#d1fae5', color: '#059669' }} aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                  <div className="stat-content">
                    <div className="stat-value" aria-label={`${selectedTeam.checkInStats.green} green status`}>
                      {selectedTeam.checkInStats.green}
                    </div>
                    <div className="stat-label">Green Status</div>
                  </div>
                </div>

                {(selectedTeam.exceptionCount || 0) > 0 && (
                  <div className="stat-card stat-card-warning" role="article" aria-label={`Exceptions: ${selectedTeam.exceptionCount}`}>
                    <div className="stat-icon" style={{ background: '#fef3c7', color: '#d97706' }} aria-hidden="true">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></path>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <div className="stat-value" aria-label={`${selectedTeam.exceptionCount} exceptions`}>
                        {selectedTeam.exceptionCount || 0}
                      </div>
                      <div className="stat-label">Exceptions</div>
                    </div>
                  </div>
                )}

                {selectedTeam.checkInStats.amber > 0 && (
                  <div className="stat-card stat-card-warning" role="article" aria-label={`Amber status: ${selectedTeam.checkInStats.amber}`}>
                    <div className="stat-icon" style={{ background: '#fef3c7', color: '#d97706' }} aria-hidden="true">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <div className="stat-value" aria-label={`${selectedTeam.checkInStats.amber} amber status`}>
                        {selectedTeam.checkInStats.amber}
                      </div>
                      <div className="stat-label">Amber Status</div>
                    </div>
                  </div>
                )}

                <div className="stat-card stat-card-neutral" role="article" aria-label={`Pending: ${selectedTeam.checkInStats.pending}`}>
                  <div className="stat-icon" style={{ background: '#f3f4f6', color: '#6b7280' }} aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                  </div>
                  <div className="stat-content">
                    <div className="stat-value" aria-label={`${selectedTeam.checkInStats.pending} pending`}>
                      {selectedTeam.checkInStats.pending}
                    </div>
                    <div className="stat-label">Pending</div>
                  </div>
                </div>
              </div>

              {/* Team Members List */}
              <div className="team-members-section">
                <div className="section-header">
                  <h3 className="section-title">Team Members</h3>
                  {teamMembers.length > 0 && (
                    <span className="section-count" aria-label={`${teamMembers.length} team members`}>
                      {teamMembers.length} {teamMembers.length === 1 ? 'member' : 'members'}
                    </span>
                  )}
                </div>
                
                {loadingMembers ? (
                  <Loading message="Loading members..." size="small" />
                ) : teamMembers.length === 0 ? (
                  <div className="members-empty" role="status" aria-live="polite">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    <p>No members in this team yet</p>
                  </div>
                ) : (
                  <div className="members-list" role="list" aria-label="Team members list">
                    {teamMembers.map((member: any, index: number) => {
                      const memberName = member.users?.full_name || 
                                        (member.users?.first_name && member.users?.last_name 
                                          ? `${member.users.first_name} ${member.users.last_name}`
                                          : member.users?.email?.split('@')[0] || 'Unknown')
                      return (
                        <div 
                          key={member.id} 
                          className="member-item"
                          role="listitem"
                          tabIndex={0}
                          aria-label={`Team member ${memberName}, ${member.users?.role || 'worker'}`}
                        >
                          <Avatar
                            userId={member.user_id}
                            profileImageUrl={member.users?.profile_image_url}
                            firstName={member.users?.first_name}
                            lastName={member.users?.last_name}
                            email={member.users?.email}
                            size="sm"
                            showTooltip
                          />
                          <div className="member-info">
                            <div className="member-name-row">
                              <div className="member-name">{memberName}</div>
                              {member.hasActiveException && member.exception && (
                                <span 
                                  className="member-exception-badge"
                                  title={`Exception: ${member.exception.exception_type?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Exception'}${member.exception.reason ? ` - ${member.exception.reason}` : ''}`}
                                  aria-label={`Exception: ${member.exception.exception_type?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Exception'}`}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                    <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></path>
                                  </svg>
                                  {member.exception.exception_type?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Exception'}
                                </span>
                              )}
                            </div>
                            <div className="member-email" aria-label={`Email: ${member.users?.email || 'No email'}`}>
                              {member.users?.email || 'No email'}
                            </div>
                            {member.phone && (
                              <div className="member-phone" aria-label={`Phone: ${member.phone}`}>
                                {member.phone}
                              </div>
                            )}
                          </div>
                          <div className="member-role-container">
                            <div className="member-role-badge" aria-label={`Role: ${member.users?.role || 'worker'}`}>
                              {member.users?.role || 'worker'}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Team Leader Contact */}
              {selectedTeam.teamLeader && (
                <div className="team-leader-contact">
                  <h3 className="section-title">Team Leader Contact</h3>
                  <div className="contact-card">
                    <div 
                      className="contact-avatar"
                      style={{ backgroundColor: getAvatarColor(selectedTeam.teamLeader.fullName) }}
                    >
                      {selectedTeam.teamLeader.initials}
                    </div>
                    <div className="contact-info">
                      <div className="contact-name">{selectedTeam.teamLeader.fullName}</div>
                      <div className="contact-email">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                          <polyline points="22,6 12,13 2,6"></polyline>
                        </svg>
                        {selectedTeam.teamLeader.email}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Team Confirmation Modal */}
      {showDeleteModal && teamToDelete && (
        <div 
          className="modal-overlay"
          onClick={closeDeleteModal}
        >
          <div 
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 style={{ color: '#dc2626' }}>Delete Team</h2>
              <button 
                className="modal-close-btn"
                onClick={closeDeleteModal}
                disabled={deleteLoading}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="modal-body">
              <div style={{ 
                padding: '16px', 
                backgroundColor: '#fef2f2', 
                border: '1px solid #fecaca', 
                borderRadius: '8px', 
                marginBottom: '20px' 
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#dc2626', marginTop: '2px', flexShrink: 0 }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  <div>
                    <p style={{ margin: 0, fontWeight: '600', color: '#991b1b', marginBottom: '8px' }}>
                      Warning: This action cannot be undone
                    </p>
                    <p style={{ margin: 0, fontSize: '14px', color: '#7f1d1d' }}>
                      You are about to delete <strong>{teamToDelete.name}</strong> and all associated data including team members, exceptions, and schedules.
                    </p>
                  </div>
                </div>
              </div>

              {deleteError && (
                <div className="modal-error">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  {deleteError}
                </div>
              )}

              <div className="form-group">
                <label>
                  Enter your password to confirm deletion
                  <span style={{ color: '#dc2626' }}> *</span>
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => {
                    setDeletePassword(e.target.value)
                    setDeleteError(null)
                  }}
                  disabled={deleteLoading}
                  placeholder="Your supervisor password"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && deletePassword.trim() && !deleteLoading) {
                      handleDeleteTeam()
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '14px',
                  }}
                />
                <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#6b7280' }}>
                  This ensures that only you can delete teams
                </p>
              </div>
            </div>

            <div className="modal-footer">
              <button
                onClick={closeDeleteModal}
                disabled={deleteLoading}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteTeam}
                disabled={deleteLoading || !deletePassword.trim()}
                style={{
                  backgroundColor: deleteLoading || !deletePassword.trim() ? '#fca5a5' : '#dc2626',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: deleteLoading || !deletePassword.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'background-color 0.2s',
                }}
              >
                {deleteLoading ? (
                  <>
                    <div style={{ 
                      width: '16px', 
                      height: '16px', 
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTopColor: 'white',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite'
                    }}></div>
                    Deleting...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    Delete Team
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

