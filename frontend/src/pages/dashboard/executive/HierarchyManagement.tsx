import React, { useState, useEffect, useCallback } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { Avatar } from '../../../components/Avatar'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './HierarchyManagement.css'

interface User {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  role: string
  profile_image_url?: string | null
}


interface Team {
  id: string
  name: string
  site_location?: string | null
  team_leader: User | null
  workers: User[]
  workers_count: number
}

interface Supervisor extends User {
  teams_count: number
  team_leaders_count: number
  workers_count: number
  teams: Team[]
}

// Constants for roles (centralized to avoid duplication - defined outside component)
const ALLOWED_ROLES = ['supervisor', 'team_leader', 'worker', 'clinician', 'whs_control_center'] as const
const ROLE_LABELS: Record<string, string> = {
  supervisor: 'Supervisor',
  team_leader: 'Team Leader',
  worker: 'Worker',
  clinician: 'Clinician',
  whs_control_center: 'WHS Control Center',
}
const ROLE_COLORS: Record<string, string> = {
  supervisor: '#3B82F6',
  team_leader: '#8B5CF6',
  worker: '#10B981',
  clinician: '#F59E0B',
  whs_control_center: '#EF4444',
}

// Helper function to get role color
const getRoleColor = (role: string): string => {
  return ROLE_COLORS[role] || '#64748B'
}

// Reusable components to reduce duplication
const EditButton = ({ onClick, title = 'Edit role' }: { onClick: () => void; title?: string }) => (
  <button className="hierarchy-edit-btn" onClick={onClick} title={title}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    </svg>
  </button>
)

// Removed UserAvatar - now using centralized Avatar component

const RoleBadge = ({ role }: { role: string }) => {
  const color = getRoleColor(role)
  return (
    <span className="hierarchy-role-badge" style={{ backgroundColor: color + '20', color }}>
      {ROLE_LABELS[role] || role}
    </span>
  )
}

export function HierarchyManagement() {
  const [supervisors, setSupervisors] = useState<Supervisor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedSupervisor, setSelectedSupervisor] = useState<Supervisor | null>(null)
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const [editingUser, setEditingUser] = useState<{ id: string; currentRole: string; name: string } | null>(null)
  const [newRole, setNewRole] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchHierarchy = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      // Use centralized apiClient for consistent error handling
      const result = await apiClient.get<{ supervisors: any[] }>(API_ROUTES.EXECUTIVE.HIERARCHY)

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch hierarchy')
      }

      const data = result.data
      setSupervisors(data.supervisors || [])
    } catch (err: any) {
      console.error('Error fetching hierarchy:', err)
      setError(err.message || 'Failed to fetch hierarchy')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHierarchy()
  }, [fetchHierarchy])

  const handleSupervisorClick = useCallback((supervisor: Supervisor) => {
    setSelectedSupervisor(supervisor)
  }, [])

  const handleCloseSidebar = useCallback(() => {
    setSelectedSupervisor(null)
    setExpandedTeams(new Set())
  }, [])

  const toggleTeam = useCallback((teamId: string) => {
    setExpandedTeams((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(teamId)) {
        newSet.delete(teamId)
      } else {
        newSet.add(teamId)
      }
      return newSet
    })
  }, [])

  const handleEditRole = useCallback((user: User) => {
    setEditingUser({
      id: user.id,
      currentRole: user.role,
      name: user.full_name || user.email,
    })
    setNewRole(user.role)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingUser(null)
    setNewRole('')
  }, [])

  const handleConfirmEdit = useCallback(async () => {
    if (!editingUser || !newRole || newRole === editingUser.currentRole) {
      return
    }

    try {
      setSaving(true)
      setError('')

      // Use centralized apiClient for consistent error handling
      const result = await apiClient.patch<{ message?: string }>(
        API_ROUTES.EXECUTIVE.USER_ROLE(editingUser.id),
        { role: newRole }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to update role')
      }

      // Refresh hierarchy
      await fetchHierarchy()
      setEditingUser(null)
      setNewRole('')
    } catch (err: any) {
      console.error('Error updating role:', err)
      setError(err.message || 'Failed to update role')
    } finally {
      setSaving(false)
    }
  }, [editingUser, newRole, fetchHierarchy])


  if (loading) {
    return (
      <DashboardLayout>
        <div className="hierarchy-management">
          <Loading message="Loading hierarchy..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="hierarchy-management">
        <div className="hierarchy-header">
          <h1 className="hierarchy-title">Organization Hierarchy</h1>
          <p className="hierarchy-subtitle">Manage supervisors, team leaders, and workers</p>
        </div>

        {error && (
          <div className="hierarchy-error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{error}</span>
            <button className="hierarchy-error-close" onClick={() => setError('')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}

        <div className="hierarchy-container">
          {/* Main Content - Supervisors List */}
          <div className="hierarchy-main">
            {supervisors.length === 0 ? (
              <div className="hierarchy-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#94A3B8' }}>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <p style={{ fontWeight: 500, color: '#0F172A', marginBottom: '4px' }}>No supervisors found</p>
                <p style={{ fontSize: '14px', color: '#64748B' }}>Supervisors will appear here once created</p>
              </div>
            ) : (
              <div className="hierarchy-supervisors-grid">
                {supervisors.map((supervisor) => (
                  <div
                    key={supervisor.id}
                    className={`hierarchy-supervisor-card ${selectedSupervisor?.id === supervisor.id ? 'selected' : ''}`}
                    onClick={() => handleSupervisorClick(supervisor)}
                  >
                    <div className="hierarchy-card-header">
                      <Avatar
                        userId={supervisor.id}
                        profileImageUrl={supervisor.profile_image_url}
                        firstName={supervisor.first_name}
                        lastName={supervisor.last_name}
                        fullName={supervisor.full_name}
                        email={supervisor.email}
                        size="md"
                        showTooltip
                      />
                      <div className="hierarchy-card-info">
                        <h3 className="hierarchy-card-name">{supervisor.full_name || supervisor.email}</h3>
                        <p className="hierarchy-card-email">{supervisor.email}</p>
                      </div>
                      <RoleBadge role={supervisor.role} />
                    </div>
                    <div className="hierarchy-card-stats">
                      <div className="hierarchy-stat-item">
                        <span className="hierarchy-stat-value">{supervisor.teams_count}</span>
                        <span className="hierarchy-stat-label">Teams</span>
                      </div>
                      <div className="hierarchy-stat-item">
                        <span className="hierarchy-stat-value">{supervisor.team_leaders_count}</span>
                        <span className="hierarchy-stat-label">Team Leaders</span>
                      </div>
                      <div className="hierarchy-stat-item">
                        <span className="hierarchy-stat-value">{supervisor.workers_count}</span>
                        <span className="hierarchy-stat-label">Workers</span>
                      </div>
                    </div>
                    <div className="hierarchy-card-actions">
                      <button
                        className="hierarchy-view-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSupervisorClick(supervisor)
                        }}
                      >
                        View Details
                      </button>
                      <EditButton
                        onClick={(e) => {
                          e.stopPropagation()
                          handleEditRole(supervisor)
                        }}
                        title="Edit role"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar Overlay */}
          {selectedSupervisor && (
            <>
              <div className="sidebar-overlay" onClick={handleCloseSidebar}></div>
              <div className="sidebar-panel">
                <div className="sidebar-header">
                  <div className="hierarchy-sidebar-title-section">
                    <div className="hierarchy-sidebar-user">
                      <Avatar
                        userId={selectedSupervisor.id}
                        profileImageUrl={selectedSupervisor.profile_image_url}
                        firstName={selectedSupervisor.first_name}
                        lastName={selectedSupervisor.last_name}
                        fullName={selectedSupervisor.full_name}
                        email={selectedSupervisor.email}
                        size="lg"
                        showTooltip
                      />
                      <div>
                        <h3 className="hierarchy-sidebar-name">{selectedSupervisor.full_name || selectedSupervisor.email}</h3>
                        <p className="hierarchy-sidebar-email">{selectedSupervisor.email}</p>
                      </div>
                    </div>
                    <div className="hierarchy-sidebar-actions">
                      <RoleBadge role={selectedSupervisor.role} />
                      <EditButton onClick={() => handleEditRole(selectedSupervisor)} title="Edit role" />
                    </div>
                  </div>
                  <button className="sidebar-close" onClick={handleCloseSidebar} aria-label="Close sidebar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>

                <div className="sidebar-body">
                  {selectedSupervisor.teams.length === 0 ? (
                    <div className="hierarchy-sidebar-empty">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#94A3B8' }}>
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                      </svg>
                      <p>No teams assigned</p>
                    </div>
                  ) : (
                    <div className="hierarchy-teams-list">
                      {selectedSupervisor.teams.map((team) => {
                        const isTeamExpanded = expandedTeams.has(team.id)
                        return (
                          <div key={team.id} className="hierarchy-team-card">
                            <div
                              className="hierarchy-team-header"
                              onClick={() => team.workers.length > 0 && toggleTeam(team.id)}
                            >
                              <div className="hierarchy-team-info">
                                {team.workers.length > 0 && (
                                  <button
                                    className={`hierarchy-team-expand ${isTeamExpanded ? 'expanded' : ''}`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleTeam(team.id)
                                    }}
                                    aria-label={isTeamExpanded ? 'Collapse' : 'Expand'}
                                  >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                  </button>
                                )}
                                <div>
                                  <h3 className="hierarchy-team-name">{team.name}</h3>
                                  {team.site_location && <p className="hierarchy-team-location">{team.site_location}</p>}
                                </div>
                              </div>
                              <span className="hierarchy-team-count">{team.workers_count} workers</span>
                            </div>

                            {/* Team Leader */}
                            {team.team_leader && (
                              <div className="hierarchy-team-leader-card">
                                <div className="hierarchy-team-leader-header">
                                  <Avatar
                                    userId={team.team_leader.id}
                                    profileImageUrl={team.team_leader.profile_image_url}
                                    firstName={team.team_leader.first_name}
                                    lastName={team.team_leader.last_name}
                                    fullName={team.team_leader.full_name}
                                    email={team.team_leader.email}
                                    size="sm"
                                    showTooltip
                                  />
                                  <div className="hierarchy-team-leader-info">
                                    <p className="hierarchy-team-leader-name">{team.team_leader.full_name || team.team_leader.email}</p>
                                    <p className="hierarchy-team-leader-email">{team.team_leader.email}</p>
                                  </div>
                                  <div className="hierarchy-team-leader-actions">
                                    <RoleBadge role={team.team_leader.role} />
                                    <EditButton
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleEditRole(team.team_leader!)
                                      }}
                                      title="Edit role"
                                    />
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Workers */}
                            {isTeamExpanded && team.workers.length > 0 && (
                              <div className="hierarchy-workers-list">
                                {team.workers.map((worker) => (
                                  <div key={worker.id} className="hierarchy-worker-card">
                                    <Avatar
                                      userId={worker.id}
                                      profileImageUrl={worker.profile_image_url}
                                      firstName={worker.first_name}
                                      lastName={worker.last_name}
                                      fullName={worker.full_name}
                                      email={worker.email}
                                      size="sm"
                                      showTooltip
                                    />
                                    <div className="hierarchy-worker-info">
                                      <p className="hierarchy-worker-name">{worker.full_name || worker.email}</p>
                                      <p className="hierarchy-worker-email">{worker.email}</p>
                                    </div>
                                    <div className="hierarchy-worker-actions">
                                      <RoleBadge role={worker.role} />
                                      <EditButton
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleEditRole(worker)
                                        }}
                                        title="Edit role"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Role Edit Confirmation Modal */}
        {editingUser && (
          <div className="hierarchy-modal-overlay" onClick={handleCancelEdit}>
            <div className="hierarchy-modal" onClick={(e) => e.stopPropagation()}>
              <div className="hierarchy-modal-header">
                <h2>Change User Role</h2>
                <button className="hierarchy-modal-close" onClick={handleCancelEdit}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <div className="hierarchy-modal-body">
                <div className="hierarchy-modal-info">
                  <p>
                    <strong>User:</strong> {editingUser.name}
                  </p>
                  <p>
                    <strong>Current Role:</strong>{' '}
                    <span style={{ color: getRoleColor(editingUser.currentRole) }}>
                      {ROLE_LABELS[editingUser.currentRole] || editingUser.currentRole}
                    </span>
                  </p>
                </div>
                <div className="hierarchy-modal-form">
                  <label htmlFor="new-role">New Role:</label>
                  <select
                    id="new-role"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="hierarchy-role-select"
                  >
                    {ALLOWED_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="hierarchy-modal-warning">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <p>Changing a user's role may affect their access and permissions. Are you sure you want to proceed?</p>
                </div>
              </div>
              <div className="hierarchy-modal-footer">
                <button className="hierarchy-modal-cancel" onClick={handleCancelEdit} disabled={saving}>
                  Cancel
                </button>
                <button
                  className="hierarchy-modal-confirm"
                  onClick={handleConfirmEdit}
                  disabled={saving || newRole === editingUser.currentRole}
                >
                  {saving ? 'Saving...' : 'Confirm Change'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

