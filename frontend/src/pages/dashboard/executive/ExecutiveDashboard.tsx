import { useState, useEffect, useRef } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { useAuth } from '../../../contexts/AuthContext'
import { executiveService } from '../../../services/executiveService'
import type { User, CreateUserRequest, UpdateUserRequest } from '../../../services/executiveService'
import { isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { calculateAge } from '../../../shared/date'
import { validateBirthday } from '../../../utils/validationUtils'
import { ExecutiveBusinessSetup } from './ExecutiveBusinessSetup'
import './ExecutiveDashboard.css'

export function ExecutiveDashboard() {
  const { user, business_name, business_registration_number } = useAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    supervisor: 0,
    clinician: 0,
    whs_control_center: 0,
    total: 0,
  })
  const [users, setUsers] = useState<User[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [createLoading, setCreateLoading] = useState(false)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<'supervisor' | 'clinician' | 'whs_control_center' | 'all'>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [formData, setFormData] = useState<CreateUserRequest>({
    email: '',
    password: '',
    role: 'supervisor',
    first_name: '',
    last_name: '',
    gender: undefined,
    date_of_birth: '',
    // business_name and business_registration_number are automatically inherited from executive
  })
  const [birthMonth, setBirthMonth] = useState('')
  const [birthDay, setBirthDay] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [birthdayError, setBirthdayError] = useState('')

  const [editFormData, setEditFormData] = useState<UpdateUserRequest>({
    email: '',
    role: 'supervisor',
    first_name: '',
    last_name: '',
    password: '',
  })

  useEffect(() => {
    fetchData()
  }, [roleFilter, searchTerm, currentPage])

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch stats and users in parallel
      const [statsResult, usersResult] = await Promise.all([
        executiveService.getStats(),
        executiveService.getUsers({
          role: roleFilter === 'all' ? undefined : roleFilter,
          search: searchTerm || undefined,
          page: currentPage,
          limit: 10,
        }),
      ])

      // Handle stats result using centralized error handling
      if (isApiError(statsResult)) {
        // Only log in development to avoid exposing sensitive data in production
        if (import.meta.env.DEV) {
          console.error('Error fetching stats:', getApiErrorMessage(statsResult))
        }
      } else if (statsResult.data?.success) {
        setStats(statsResult.data.stats)
      }

      // Handle users result using centralized error handling
      if (isApiError(usersResult)) {
        // Only log in development to avoid exposing sensitive data in production
        if (import.meta.env.DEV) {
          console.error('Error fetching users:', getApiErrorMessage(usersResult))
        }
      } else if (usersResult.data?.success) {
        setUsers(usersResult.data.users)
        setTotalPages(usersResult.data.pagination.totalPages)
      }
    } catch (error: any) {
      // Only log in development to avoid exposing sensitive data in production
      if (import.meta.env.DEV) {
        console.error('Error fetching data:', error)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setCreateLoading(true)

    // Validation
    if (!formData.email || !formData.password || !formData.first_name || !formData.last_name) {
      setCreateError('Please fill in all required fields')
      setCreateLoading(false)
      return
    }

    if (formData.password.length < 6) {
      setCreateError('Password must be at least 6 characters')
      setCreateLoading(false)
      return
    }

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
    
    // Update formData.date_of_birth for API call
    setFormData(prev => ({ ...prev, date_of_birth: dateStr }))

    // Business info is automatically inherited from executive, no validation needed

    try {
      // Business info is automatically inherited from executive in the backend
      const result = await executiveService.createUser({ ...formData, date_of_birth: dateStr })

      if (isApiError(result)) {
        setCreateError(getApiErrorMessage(result) || 'Failed to create user')
        setCreateLoading(false)
        return
      }

      // Success
      setSuccessMessage(`${formData.role.charAt(0).toUpperCase() + formData.role.slice(1)} account created successfully!`)
      setShowCreateModal(false)
      setFormData({
        email: '',
        password: '',
        role: 'supervisor',
        first_name: '',
        last_name: '',
        gender: undefined,
        date_of_birth: '',
      })
      setBirthMonth('')
      setBirthDay('')
      setBirthYear('')
      setBirthdayError('')

      // Refresh data
      await fetchData()

      // Clear success message after 3 seconds
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
      toastTimeoutRef.current = setTimeout(() => {
        setSuccessMessage(null)
        toastTimeoutRef.current = null
      }, 3000)
    } catch (error: any) {
      setCreateError(error.message || 'Failed to create user')
    } finally {
      setCreateLoading(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }))
    setCreateError(null)
  }

  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setEditFormData(prev => ({
      ...prev,
      [name]: value,
    }))
    setUpdateError(null)
  }

  const handleEditUser = async (user: User) => {
    setSelectedUser(user)
    setEditFormData({
      email: user.email,
      role: user.role as 'supervisor' | 'clinician' | 'whs_control_center',
      first_name: user.first_name,
      last_name: user.last_name,
      password: '',
    })
    setShowEditModal(true)
  }

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return

    setUpdateError(null)
    setUpdateLoading(true)

    // Validation
    if (!editFormData.first_name || !editFormData.last_name || !editFormData.email) {
      setUpdateError('Please fill in all required fields')
      setUpdateLoading(false)
      return
    }

    if (editFormData.password && editFormData.password.length < 6) {
      setUpdateError('Password must be at least 6 characters')
      setUpdateLoading(false)
      return
    }

    // Business info is automatically inherited from executive, no need to validate here

    try {
      // Remove empty password and business info from update
      // Business info is inherited and cannot be changed
      const updateData: UpdateUserRequest = { ...editFormData }
      if (!updateData.password || updateData.password.trim() === '') {
        delete updateData.password
      }
      // Remove business fields - they're inherited from executive
      delete updateData.business_name
      delete updateData.business_registration_number

      const result = await executiveService.updateUser(selectedUser.id, updateData)

      if (isApiError(result)) {
        setUpdateError(getApiErrorMessage(result) || 'Failed to update user')
        setUpdateLoading(false)
        return
      }

      // Success
      setSuccessMessage('User updated successfully!')
      setShowEditModal(false)
      setSelectedUser(null)
      await fetchData()

      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
      toastTimeoutRef.current = setTimeout(() => {
        setSuccessMessage(null)
        toastTimeoutRef.current = null
      }, 3000)
    } catch (error: any) {
      setUpdateError(error.message || 'Failed to update user')
    } finally {
      setUpdateLoading(false)
    }
  }

  const handleDeleteClick = (user: User) => {
    setSelectedUser(user)
    setShowDeleteModal(true)
  }

  const handleDeleteUser = async () => {
    if (!selectedUser) return

    setDeleteError(null)
    setDeleteLoading(true)

    try {
      const result = await executiveService.deleteUser(selectedUser.id)

      if (isApiError(result)) {
        setDeleteError(getApiErrorMessage(result) || 'Failed to delete user')
        setDeleteLoading(false)
        return
      }

      // Success
      setSuccessMessage(`User "${selectedUser.full_name}" deleted successfully!`)
      setShowDeleteModal(false)
      setSelectedUser(null)
      await fetchData()

      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
      toastTimeoutRef.current = setTimeout(() => {
        setSuccessMessage(null)
        toastTimeoutRef.current = null
      }, 3000)
    } catch (error: any) {
      setDeleteError(error.message || 'Failed to delete user')
    } finally {
      setDeleteLoading(false)
    }
  }

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      supervisor: 'Supervisor',
      clinician: 'Clinician',
      whs_control_center: 'WHS Control Center',
    }
    return labels[role] || role
  }

  const getRoleBadgeClass = (role: string) => {
    const classes: Record<string, string> = {
      supervisor: 'executive-role-badge-supervisor',
      clinician: 'executive-role-badge-clinician',
      whs_control_center: 'executive-role-badge-whs',
    }
    return classes[role] || ''
  }

  // Check if executive has required business information
  const hasBusinessInfo = business_name && business_registration_number

  // Show business setup page if missing business info
  if (!hasBusinessInfo) {
    return <ExecutiveBusinessSetup />
  }

  if (loading) {
    return (
      <DashboardLayout>
        <Loading message="Loading executive dashboard..." size="medium" />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="executive-dashboard">
        <div className="executive-header">
        <div>
          <h1>Executive Dashboard</h1>
            <p className="executive-subtitle">User Management & Organization Overview</p>
        </div>
          <button
            className="executive-create-btn"
            onClick={() => setShowCreateModal(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Create User
        </button>
      </div>

        {successMessage && (
          <div className="executive-success-toast">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span>{successMessage}</span>
        </div>
        )}

        {/* Statistics Cards */}
        <div className="executive-stats-grid">
          <div className="executive-stat-card">
            <div className="executive-stat-icon supervisor">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <div className="executive-stat-content">
              <h3>{stats.supervisor}</h3>
              <p>Supervisors</p>
            </div>
          </div>

          <div className="executive-stat-card">
            <div className="executive-stat-icon clinician">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <div className="executive-stat-content">
              <h3>{stats.clinician}</h3>
              <p>Clinicians</p>
            </div>
          </div>

          <div className="executive-stat-card">
            <div className="executive-stat-icon whs">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="9" x2="15" y2="15"></line>
                <line x1="15" y1="9" x2="9" y2="15"></line>
              </svg>
            </div>
            <div className="executive-stat-content">
              <h3>{stats.whs_control_center}</h3>
              <p>WHS Control Center</p>
            </div>
          </div>

          <div className="executive-stat-card">
            <div className="executive-stat-icon total">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <div className="executive-stat-content">
              <h3>{stats.total}</h3>
              <p>Total Users</p>
            </div>
          </div>
        </div>

        {/* Filters and Search */}
        <div className="executive-filters">
          <div className="executive-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
            />
          </div>
          <select
            className="executive-role-filter"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value as any)
              setCurrentPage(1)
            }}
          >
            <option value="all">All Roles</option>
            <option value="supervisor">Supervisors</option>
            <option value="clinician">Clinicians</option>
            <option value="whs_control_center">WHS Control Center</option>
          </select>
        </div>

        {/* Users Table */}
        <div className="executive-users-card">
          <h2>Users</h2>
          {users.length === 0 ? (
            <div className="executive-empty-state">
              <p>No users found</p>
            </div>
          ) : (
            <>
              <div className="executive-users-table">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Business Info</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <strong>{user.full_name}</strong>
                        </td>
                        <td>{user.email}</td>
                        <td>
                          <span className={`executive-role-badge ${getRoleBadgeClass(user.role)}`}>
                            {getRoleLabel(user.role)}
                          </span>
                        </td>
                        <td>
                          {user.business_name ? (
                            <div>
                              <div>{user.business_name}</div>
                              {user.business_registration_number && (
                                <div className="executive-business-reg">{user.business_registration_number}</div>
                              )}
                            </div>
                          ) : (
                            <span className="executive-no-business">-</span>
                          )}
                        </td>
                        <td>{new Date(user.created_at).toLocaleDateString()}</td>
                        <td>
                          <div className="executive-actions">
                            <button
                              className="executive-action-btn edit"
                              onClick={() => handleEditUser(user)}
                              title="Edit user"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                              </svg>
                            </button>
                            <button
                              className="executive-action-btn delete"
                              onClick={() => handleDeleteClick(user)}
                              title="Delete user"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="executive-pagination">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </button>
                  <span>Page {currentPage} of {totalPages}</span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Create User Modal */}
        {showCreateModal && (
          <div
            className="executive-modal-overlay"
            onClick={() => !createLoading && setShowCreateModal(false)}
          >
            <div
              className="executive-modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <h2>Create New User</h2>

              {createError && (
                <div className="executive-modal-error">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>{createError}</span>
                </div>
              )}

              <form onSubmit={handleCreateUser}>
                <div className="executive-form-group">
                  <label>Role *</label>
                  <select
                    name="role"
                    value={formData.role}
                    onChange={handleInputChange}
                    disabled={createLoading}
                    required
                  >
                    <option value="supervisor">Supervisor</option>
                    <option value="clinician">Clinician</option>
                    <option value="whs_control_center">WHS Control Center</option>
                  </select>
                </div>

                <div className="executive-form-row">
                  <div className="executive-form-group">
                    <label>First Name *</label>
                    <input
                      type="text"
                      name="first_name"
                      value={formData.first_name}
                      onChange={handleInputChange}
                      disabled={createLoading}
                      required
                    />
                  </div>
                  <div className="executive-form-group">
                    <label>Last Name *</label>
                    <input
                      type="text"
                      name="last_name"
                      value={formData.last_name}
                      onChange={handleInputChange}
                      disabled={createLoading}
                      required
                    />
                  </div>
                </div>

                <div className="executive-form-group">
                  <label>Email *</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    disabled={createLoading}
                    required
                  />
                </div>

                <div className="executive-form-group">
                  <label>Password *</label>
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    disabled={createLoading}
                    required
                    minLength={6}
                    placeholder="Minimum 6 characters"
                  />
                </div>

                <div className="executive-form-row">
                  <div className="executive-form-group">
                    <label>Gender</label>
                    <select
                      name="gender"
                      value={formData.gender || ''}
                      onChange={handleInputChange}
                      disabled={createLoading}
                    >
                      <option value="">Select Gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                  <div className="executive-form-group">
                    <label>
                      Birthday
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
                        }}
                        className="executive-form-input birthday-select"
                        disabled={createLoading}
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
                        }}
                        className="executive-form-input birthday-select"
                        disabled={createLoading}
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
                        }}
                        className="executive-form-input birthday-select"
                        disabled={createLoading}
                      >
                        <option value="">Year</option>
                        {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map(year => (
                          <option key={year} value={String(year)}>{year}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="executive-form-info">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <span>Business information will be automatically inherited from your account</span>
                </div>

                <div className="executive-modal-actions">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    disabled={createLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createLoading}
                  >
                    {createLoading ? 'Creating...' : 'Create User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit User Modal */}
        {showEditModal && selectedUser && (
          <div
            className="executive-modal-overlay"
            onClick={() => !updateLoading && setShowEditModal(false)}
          >
            <div
              className="executive-modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <h2>Edit User</h2>

              {updateError && (
                <div className="executive-modal-error">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>{updateError}</span>
                </div>
              )}

              <form onSubmit={handleUpdateUser}>
                <div className="executive-form-group">
                  <label>Role *</label>
                  <select
                    name="role"
                    value={editFormData.role}
                    onChange={handleEditInputChange}
                    disabled={updateLoading}
                    required
                  >
                    <option value="supervisor">Supervisor</option>
                    <option value="clinician">Clinician</option>
                    <option value="whs_control_center">WHS Control Center</option>
                  </select>
                </div>

                <div className="executive-form-row">
                  <div className="executive-form-group">
                    <label>First Name *</label>
                    <input
                      type="text"
                      name="first_name"
                      value={editFormData.first_name}
                      onChange={handleEditInputChange}
                      disabled={updateLoading}
                      required
                    />
                  </div>
                  <div className="executive-form-group">
                    <label>Last Name *</label>
                    <input
                      type="text"
                      name="last_name"
                      value={editFormData.last_name}
                      onChange={handleEditInputChange}
                      disabled={updateLoading}
                      required
                    />
                  </div>
                </div>

                <div className="executive-form-group">
                  <label>Email *</label>
                  <input
                    type="email"
                    name="email"
                    value={editFormData.email}
                    onChange={handleEditInputChange}
                    disabled={updateLoading}
                    required
                  />
                </div>

                <div className="executive-form-group">
                  <label>Password (leave empty to keep current)</label>
                  <input
                    type="password"
                    name="password"
                    value={editFormData.password}
                    onChange={handleEditInputChange}
                    disabled={updateLoading}
                    minLength={6}
                    placeholder="Enter new password or leave empty"
                  />
                </div>

                <div className="executive-form-info">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <span>Business information is inherited from your account and cannot be changed</span>
                </div>

                <div className="executive-modal-actions">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    disabled={updateLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updateLoading}
                  >
                    {updateLoading ? 'Updating...' : 'Update User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteModal && selectedUser && (
          <div
            className="executive-modal-overlay"
            onClick={() => !deleteLoading && setShowDeleteModal(false)}
          >
            <div
              className="executive-delete-modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="executive-delete-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              </div>
              <h2>Are you sure?</h2>
              <p>
                Are you sure you want to delete <strong>{selectedUser.full_name}</strong> ({selectedUser.email})?
                This action cannot be undone.
              </p>

              {deleteError && (
                <div className="executive-modal-error">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="executive-modal-actions">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deleteLoading}
                  className="executive-cancel-btn"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteUser}
                  disabled={deleteLoading}
                  className="executive-delete-btn"
                >
                  {deleteLoading ? 'Deleting...' : 'Delete User'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
