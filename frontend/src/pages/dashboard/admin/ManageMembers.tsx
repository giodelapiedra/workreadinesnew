import { useState, useEffect } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { ROLE_OPTIONS } from '../../../types/roles'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './ManageMembers.css'

interface User {
  id: string
  email: string
  role: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  created_at: string
  business_name: string | null
  business_registration_number: string | null
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

export function ManageMembers() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [users, setUsers] = useState<User[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<Partial<User>>({})
  const [showAddModal, setShowAddModal] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [createForm, setCreateForm] = useState({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    role: 'worker',
    business_name: '',
    business_registration_number: '',
  })

  useEffect(() => {
    fetchUsers()
  }, [currentPage, search, roleFilter, statusFilter])

  // Auto-hide success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage('')
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      setError('')

      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
      })
      if (search) params.append('search', search)
      if (roleFilter) params.append('role', roleFilter)
      if (statusFilter !== 'all') params.append('status', statusFilter)

      const result = await apiClient.get<{ users: User[]; pagination: Pagination }>(
        `${API_ROUTES.ADMIN.USERS}?${params}`
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch users')
      }

      setUsers(result.data.users || [])
      setPagination(result.data.pagination)
    } catch (err: any) {
      console.error('Error fetching users:', err)
      setError(err.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (value: string) => {
    setSearch(value)
    setCurrentPage(1)
  }

  const handleRoleFilter = (value: string) => {
    setRoleFilter(value)
    setCurrentPage(1)
  }

  const handleStatusFilter = (value: string) => {
    setStatusFilter(value)
    setCurrentPage(1)
  }

  const handleViewUser = async (userId: string) => {
    try {
      const result = await apiClient.get<{ user: User }>(API_ROUTES.ADMIN.USER(userId))

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch user details')
      }

      setSelectedUser(result.data.user)
      setEditForm(result.data.user)
      setEditMode(false)
      setShowSidebar(true)
    } catch (err: any) {
      console.error('Error fetching user:', err)
      setError(err.message || 'Failed to load user details')
    }
  }

  const handleEdit = () => {
    setEditMode(true)
  }

  const handleSave = async () => {
    if (!selectedUser) return

    try {
      setLoading(true)
      const result = await apiClient.patch<{ user: User }>(
        API_ROUTES.ADMIN.USER(selectedUser.id),
        editForm
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to update user')
      }

      setSelectedUser(result.data.user)
      setEditForm(result.data.user)
      setEditMode(false)
      fetchUsers() // Refresh list
    } catch (err: any) {
      console.error('Error updating user:', err)
      setError(err.message || 'Failed to update user')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedUser) return

    if (!confirm(`Are you sure you want to delete ${selectedUser.full_name || selectedUser.email}? This action cannot be undone.`)) {
      return
    }

    try {
      setLoading(true)
      const result = await apiClient.delete(API_ROUTES.ADMIN.USER(selectedUser.id))

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to delete user')
      }

      setShowSidebar(false)
      setSelectedUser(null)
      fetchUsers() // Refresh list
    } catch (err: any) {
      console.error('Error deleting user:', err)
      setError(err.message || 'Failed to delete user')
    } finally {
      setLoading(false)
    }
  }

  const handleAddUser = () => {
    setShowAddModal(true)
    setCreateError('')
    setCreateForm({
      email: '',
      password: '',
      first_name: '',
      last_name: '',
      role: 'worker',
      business_name: '',
      business_registration_number: '',
    })
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    setCreateLoading(true)

    try {
      // Validation
      if (!createForm.email || !createForm.password) {
        setCreateError('Email and password are required')
        setCreateLoading(false)
        return
      }

      if (!createForm.first_name || !createForm.last_name) {
        setCreateError('First name and last name are required')
        setCreateLoading(false)
        return
      }

      if (createForm.password.length < 6) {
        setCreateError('Password must be at least 6 characters')
        setCreateLoading(false)
        return
      }

      // Supervisor-specific validation
      if (createForm.role === 'supervisor') {
        if (!createForm.business_name || !createForm.business_registration_number) {
          setCreateError('Business Name and Business Registration Number are required for supervisors')
          setCreateLoading(false)
          return
        }
      }

      const payload: any = {
        email: createForm.email.trim(),
        password: createForm.password,
        first_name: createForm.first_name.trim(),
        last_name: createForm.last_name.trim(),
        role: createForm.role,
      }

      if (createForm.role === 'supervisor') {
        payload.business_name = createForm.business_name.trim()
        payload.business_registration_number = createForm.business_registration_number.trim()
      }

      const result = await apiClient.post<{ user: User }>(
        API_ROUTES.ADMIN.USERS,
        payload
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to create user')
      }

      // Success - close modal, show success message, and refresh list
      const userName = `${createForm.first_name.trim()} ${createForm.last_name.trim()}`.trim()
      setShowAddModal(false)
      setCreateForm({
        email: '',
        password: '',
        first_name: '',
        last_name: '',
        role: 'worker',
        business_name: '',
        business_registration_number: '',
      })
      setSuccessMessage(`User "${userName}" created successfully!`)
      fetchUsers()
    } catch (err: any) {
      console.error('Error creating user:', err)
      setCreateError(err.message || 'Failed to create user')
    } finally {
      setCreateLoading(false)
    }
  }

  const getUserInitials = (user: User) => {
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
  }

  const getRoleLabel = (role: string) => {
    const roleOption = ROLE_OPTIONS.find(r => r.value === role)
    return roleOption?.label || role
  }

  const isActive = (user: User) => {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    return new Date(user.created_at) >= thirtyDaysAgo
  }

  if (loading && !users.length) {
    return (
      <DashboardLayout>
        <div className="manage-members">
          <Loading message="Loading users..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="manage-members">
        {/* Header */}
        <header className="members-header">
          <h1 className="members-title">User List</h1>
          <button onClick={handleAddUser} className="add-user-button">
            Add User
          </button>
        </header>

        {/* Filters */}
        <div className="filters-bar">
          <div className="search-filters">
            <div className="search-input-wrapper">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="search-input"
              />
            </div>

            <select
              value={roleFilter}
              onChange={(e) => handleRoleFilter(e.target.value)}
              className="filter-select"
            >
              <option value="">Select Role</option>
              {ROLE_OPTIONS.map(role => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => handleStatusFilter(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="error-message">
            <p>{error}</p>
            <button onClick={fetchUsers} className="retry-button">Retry</button>
          </div>
        )}

        {/* Users Table */}
        <div className="table-container">
          <table className="users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Email</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} onClick={() => handleViewUser(user.id)}>
                    <td>
                      <div className="user-name-cell">
                        <div className="user-avatar">
                          {getUserInitials(user)}
                        </div>
                        <span>{user.full_name || user.email}</span>
                      </div>
                    </td>
                    <td>{getRoleLabel(user.role)}</td>
                    <td>{user.email}</td>
                    <td>
                      <span className={`status-badge ${isActive(user) ? 'active' : 'inactive'}`}>
                        {isActive(user) ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="action-menu-button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleViewUser(user.id)
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="1"></circle>
                          <circle cx="12" cy="5" r="1"></circle>
                          <circle cx="12" cy="19" r="1"></circle>
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="pagination">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={!pagination.hasPrev}
              className="pagination-button"
            >
              ← PREV
            </button>
            <div className="pagination-numbers">
              {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((pageNum) => (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`pagination-number ${currentPage === pageNum ? 'active' : ''}`}
                >
                  {pageNum}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={!pagination.hasNext}
              className="pagination-button"
            >
              NEXT →
            </button>
          </div>
        )}

        {/* User Detail Sidebar */}
        {showSidebar && selectedUser && (
          <>
            <div className="sidebar-overlay" onClick={() => setShowSidebar(false)}></div>
            <div className="user-sidebar">
              <div className="sidebar-header">
                <h3>User Details</h3>
                <button onClick={() => setShowSidebar(false)} className="sidebar-close-button">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              <div className="sidebar-content">
                {editMode ? (
                  <div className="edit-form">
                    <div className="form-group">
                      <label>First Name</label>
                      <input
                        type="text"
                        value={editForm.first_name || ''}
                        onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                        className="form-input"
                      />
                    </div>
                    <div className="form-group">
                      <label>Last Name</label>
                      <input
                        type="text"
                        value={editForm.last_name || ''}
                        onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                        className="form-input"
                      />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input
                        type="email"
                        value={editForm.email || ''}
                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                        className="form-input"
                      />
                    </div>
                    <div className="form-group">
                      <label>Role</label>
                      <select
                        value={editForm.role || ''}
                        onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                        className="form-input"
                      >
                        {ROLE_OPTIONS.map(role => (
                          <option key={role.value} value={role.value}>{role.label}</option>
                        ))}
                      </select>
                    </div>
                    {editForm.role === 'supervisor' && (
                      <>
                        <div className="form-group">
                          <label>Business Name</label>
                          <input
                            type="text"
                            value={editForm.business_name || ''}
                            onChange={(e) => setEditForm({ ...editForm, business_name: e.target.value })}
                            className="form-input"
                          />
                        </div>
                        <div className="form-group">
                          <label>Business Registration Number</label>
                          <input
                            type="text"
                            value={editForm.business_registration_number || ''}
                            onChange={(e) => setEditForm({ ...editForm, business_registration_number: e.target.value })}
                            className="form-input"
                          />
                        </div>
                      </>
                    )}
                    <div className="form-actions">
                      <button onClick={handleSave} className="save-button" disabled={loading}>
                        {loading ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button onClick={() => setEditMode(false)} className="cancel-button">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="user-details">
                    {/* User Profile Header */}
                    <div className="user-profile-header">
                      <div className="user-avatar-large">
                        {getUserInitials(selectedUser)}
                      </div>
                      <div className="user-profile-info">
                        <h4 className="user-name">{selectedUser.full_name || selectedUser.email}</h4>
                        <p className="user-role">{getRoleLabel(selectedUser.role)}</p>
                        <span className={`status-badge-large ${isActive(selectedUser) ? 'active' : 'inactive'}`}>
                          {isActive(selectedUser) ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>

                    {/* User Information Section */}
                    <div className="detail-section">
                      <h5 className="section-title">Account Information</h5>
                      <div className="detail-grid">
                        <div className="detail-item">
                          <span className="detail-label">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                              <polyline points="22,6 12,13 2,6"></polyline>
                            </svg>
                            Email
                          </span>
                          <span className="detail-value">{selectedUser.email}</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                              <line x1="16" y1="2" x2="16" y2="6"></line>
                              <line x1="8" y1="2" x2="8" y2="6"></line>
                              <line x1="3" y1="10" x2="21" y2="10"></line>
                            </svg>
                            Created
                          </span>
                          <span className="detail-value">
                            {new Date(selectedUser.created_at).toLocaleDateString('en-US', { 
                              year: 'numeric', 
                              month: 'long', 
                              day: 'numeric' 
                            })}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Business Information (if supervisor) */}
                    {(selectedUser.business_name || selectedUser.business_registration_number) && (
                      <div className="detail-section">
                        <h5 className="section-title">Business Information</h5>
                        <div className="detail-grid">
                          {selectedUser.business_name && (
                            <div className="detail-item">
                              <span className="detail-label">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                  <circle cx="12" cy="10" r="3"></circle>
                                </svg>
                                Business Name
                              </span>
                              <span className="detail-value">{selectedUser.business_name}</span>
                            </div>
                          )}
                          {selectedUser.business_registration_number && (
                            <div className="detail-item">
                              <span className="detail-label">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                  <line x1="7" y1="8" x2="17" y2="8"></line>
                                  <line x1="7" y1="12" x2="17" y2="12"></line>
                                  <line x1="7" y1="16" x2="12" y2="16"></line>
                                </svg>
                                Registration Number
                              </span>
                              <span className="detail-value">{selectedUser.business_registration_number}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="sidebar-actions">
                      <button onClick={handleEdit} className="edit-button">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        Edit User
                      </button>
                      <button onClick={handleDelete} className="delete-button" disabled={loading}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        {loading ? 'Deleting...' : 'Delete User'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Add User Modal */}
        {showAddModal && (
          <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Add New User</h2>
                <button className="modal-close" onClick={() => setShowAddModal(false)}>
                  ×
                </button>
              </div>
              <div className="modal-body">
                {createError && (
                  <div className="error-message">
                    {createError}
                    <button onClick={() => setCreateError('')}>×</button>
                  </div>
                )}
                <form onSubmit={handleCreateUser} className="user-form">
                  <div className="form-group">
                    <label>First Name *</label>
                    <input
                      type="text"
                      required
                      value={createForm.first_name}
                      onChange={(e) => setCreateForm({ ...createForm, first_name: e.target.value })}
                      className="form-input"
                      placeholder="Enter first name"
                      disabled={createLoading}
                    />
                  </div>
                  <div className="form-group">
                    <label>Last Name *</label>
                    <input
                      type="text"
                      required
                      value={createForm.last_name}
                      onChange={(e) => setCreateForm({ ...createForm, last_name: e.target.value })}
                      className="form-input"
                      placeholder="Enter last name"
                      disabled={createLoading}
                    />
                  </div>
                  <div className="form-group">
                    <label>Email *</label>
                    <input
                      type="email"
                      required
                      value={createForm.email}
                      onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                      className="form-input"
                      placeholder="Enter email address"
                      autoComplete="email"
                      disabled={createLoading}
                    />
                  </div>
                  <div className="form-group">
                    <label>Password *</label>
                    <input
                      type="password"
                      required
                      value={createForm.password}
                      onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                      className="form-input"
                      placeholder="Enter password (min. 6 characters)"
                      autoComplete="new-password"
                      disabled={createLoading}
                      minLength={6}
                    />
                  </div>
                  <div className="form-group">
                    <label>Role *</label>
                    <select
                      value={createForm.role}
                      onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                      className="form-input"
                      required
                      disabled={createLoading}
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {createForm.role === 'supervisor' && (
                    <>
                      <div className="form-group">
                        <label>Business Name *</label>
                        <input
                          type="text"
                          required
                          value={createForm.business_name}
                          onChange={(e) => setCreateForm({ ...createForm, business_name: e.target.value })}
                          className="form-input"
                          placeholder="Enter business name"
                          disabled={createLoading}
                        />
                      </div>
                      <div className="form-group">
                        <label>Business Registration Number *</label>
                        <input
                          type="text"
                          required
                          value={createForm.business_registration_number}
                          onChange={(e) => setCreateForm({ ...createForm, business_registration_number: e.target.value })}
                          className="form-input"
                          placeholder="Enter business registration number"
                          disabled={createLoading}
                        />
                      </div>
                    </>
                  )}
                  <div className="form-actions">
                    <button
                      type="button"
                      onClick={() => setShowAddModal(false)}
                      className="cancel-button"
                      disabled={createLoading}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="save-button"
                      disabled={createLoading}
                    >
                      {createLoading ? 'Creating...' : 'Create User'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Success Toast Notification */}
        {successMessage && (
          <div className="success-toast">
            <div className="success-toast-content">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>{successMessage}</span>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

