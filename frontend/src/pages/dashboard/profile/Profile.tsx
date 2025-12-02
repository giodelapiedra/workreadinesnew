import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { useAuth } from '../../../contexts/AuthContext'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { authService } from '../../../services/authService'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { calculateAge } from '../../../shared/date'
import { validateBirthday } from '../../../utils/validationUtils'
import { getProfileImageUrl } from '../../../utils/imageUtils'
import './Profile.css'

export function Profile() {
  const { user, first_name, last_name, business_name, business_registration_number, role, profile_image_url, refreshAuth } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null)
  const [quickLoginCode, setQuickLoginCode] = useState<string | null>(null)
  const [showPin, setShowPin] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinSuccess, setPinSuccess] = useState<string | null>(null)
  const [generatingPin, setGeneratingPin] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [imageSuccess, setImageSuccess] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'change' | 'remove'>('change')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '', // Password required for saving profile changes
    business_name: '',
    business_registration_number: '',
    gender: '' as 'male' | 'female' | '',
    date_of_birth: '',
  })
  const [birthMonth, setBirthMonth] = useState('')
  const [birthDay, setBirthDay] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [birthdayError, setBirthdayError] = useState('')

  const [passwordData, setPasswordData] = useState({
    old_password: '',
    new_password: '',
    confirm_password: '',
  })

  const [showPasswords, setShowPasswords] = useState({
    password: false, // For profile edit form
    old_password: false,
    new_password: false,
    confirm_password: false,
  })

  useEffect(() => {
    // Load current user data
    if (user) {
      loadUserProfile()
    }
  }, [user, first_name, last_name, business_name, business_registration_number])

  const loadUserProfile = async () => {
    try {
      const result = await apiClient.get<{ user: any }>(API_ROUTES.AUTH.ME)
      if (!isApiError(result) && result.data.user) {
        const userData = result.data.user
        const dob = userData.date_of_birth || ''
        setFormData({
          first_name: first_name || userData.first_name || '',
          last_name: last_name || userData.last_name || '',
          email: user.email || userData.email || '',
          password: '', // Password field starts empty
          business_name: business_name || userData.business_name || '',
          business_registration_number: business_registration_number || userData.business_registration_number || '',
          gender: userData.gender || '',
          date_of_birth: dob,
        })
        // Parse date of birth into month, day, year
        if (dob) {
          const date = new Date(dob)
          if (!isNaN(date.getTime())) {
            setBirthMonth(String(date.getMonth() + 1))
            setBirthDay(String(date.getDate()))
            setBirthYear(String(date.getFullYear()))
          }
        }
      } else {
        // Fallback to AuthContext data
        setFormData({
          first_name: first_name || '',
          last_name: last_name || '',
          email: user?.email || '',
          password: '',
          business_name: business_name || '',
          business_registration_number: business_registration_number || '',
          gender: '',
          date_of_birth: '',
        })
      }
      
      // Load quick_login_code
      loadQuickLoginCode()
      setLoading(false)
    } catch (err) {
      console.error('Failed to load user profile:', err)
      // Fallback to AuthContext data
      setFormData({
        first_name: first_name || '',
        last_name: last_name || '',
        email: user?.email || '',
        password: '',
        business_name: business_name || '',
        business_registration_number: business_registration_number || '',
        gender: '',
        date_of_birth: '',
      })
      setLoading(false)
    }
  }

  const loadQuickLoginCode = async () => {
    try {
      const result = await apiClient.get<{ user: { quick_login_code?: string } }>(API_ROUTES.AUTH.ME)
      if (!isApiError(result)) {
        setQuickLoginCode(result.data.user?.quick_login_code || null)
      }
    } catch (err) {
      console.error('Failed to load quick login code:', err)
    }
  }

  // Parse date of birth into month, day, year
  useEffect(() => {
    if (formData.date_of_birth) {
      const date = new Date(formData.date_of_birth)
      if (!isNaN(date.getTime())) {
        setBirthMonth(String(date.getMonth() + 1))
        setBirthDay(String(date.getDate()))
        setBirthYear(String(date.getFullYear()))
      }
    } else {
      setBirthMonth('')
      setBirthDay('')
      setBirthYear('')
    }
  }, [formData.date_of_birth])

  // Use centralized validation utility
  // Note: validateBirthday is imported from utils/validationUtils

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }))
    // Clear errors when user starts typing
    if (error) setError(null)
    if (success) setSuccess(null)
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setPasswordData(prev => ({
      ...prev,
      [name]: value,
    }))
    // Clear errors when user starts typing
    if (passwordError) setPasswordError(null)
    if (passwordSuccess) setPasswordSuccess(null)
  }

  const togglePasswordVisibility = (field: 'password' | 'old_password' | 'new_password' | 'confirm_password') => {
    setShowPasswords(prev => ({
      ...prev,
      [field]: !prev[field],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setSaving(true)

    // Validation
    if (!formData.first_name?.trim()) {
      setError('First name is required')
      setSaving(false)
      return
    }

    if (!formData.last_name?.trim()) {
      setError('Last name is required')
      setSaving(false)
      return
    }

    // Only executives can edit business info - no validation needed for other roles

    if (!formData.email?.trim()) {
      setError('Email is required')
      setSaving(false)
      return
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(formData.email.trim())) {
      setError('Please enter a valid email address')
      setSaving(false)
      return
    }

    // Gender validation - only if not already set
    if (!formData.gender || (formData.gender !== 'male' && formData.gender !== 'female')) {
      setError('Gender is required')
      setSaving(false)
      return
    }

    // Date of birth validation from dropdowns
    if (!birthMonth || !birthDay || !birthYear) {
      setError('Date of Birth is required')
      setSaving(false)
      return
    }

    // Construct date string from dropdowns
    const dateStr = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`
    const birthDate = new Date(dateStr)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    // Validate date
    if (isNaN(birthDate.getTime())) {
      setError('Invalid date of birth format')
      setSaving(false)
      return
    }
    if (birthDate >= today) {
      setError('Date of Birth must be in the past')
      setSaving(false)
      return
    }
    
    // Check minimum age (18 years old)
    const age = calculateAge(dateStr)
    if (age === null) {
      setError('Invalid date of birth')
      setSaving(false)
      return
    }
    if (age < 18) {
      setError(`Age must be at least 18 years old. Current age: ${age} years old`)
      setSaving(false)
      return
    }
    
    // Update formData.date_of_birth for API call
    setFormData(prev => ({ ...prev, date_of_birth: dateStr }))

    // Password validation - required for saving profile changes
    if (!formData.password?.trim()) {
      setError('Password is required to save changes')
      setSaving(false)
      return
    }

    try {
      const result = await authService.updateProfile({
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password, // Send password for verification
        // Only executives can update business info - all other roles inherit it
        business_name: role === 'executive' ? (formData.business_name.trim() || null) : undefined,
        business_registration_number: role === 'executive' ? (formData.business_registration_number.trim() || null) : undefined,
        gender: formData.gender ? (formData.gender as 'male' | 'female') : undefined,
        date_of_birth: formData.date_of_birth || undefined,
      })

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to update profile')
      }

      setSuccess('Profile updated successfully!')
      
      // Clear password field after successful save
      setFormData(prev => ({
        ...prev,
        password: '',
      }))
      
      // Refresh auth context to get updated user data
      await refreshAuth()
      
      // Business info updates are handled automatically for executives
    } catch (err: any) {
      // Handle different error types
      if (err.name === 'AbortError') {
        setError('Request timed out. Please try again.')
      } else if (err.message) {
        setError(err.message)
      } else {
        setError('Failed to update profile. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  const showToastNotification = (message: string) => {
    setToastMessage(message)
    setShowToast(true)
    setTimeout(() => {
      setShowToast(false)
    }, 3000)
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset file input
    e.target.value = ''

    // Use centralized validation
    const { validateImageFile } = await import('../../../utils/imageUtils')
    const validation = validateImageFile(file)
    
    if (!validation.valid) {
      setImageError(validation.error || 'Invalid image file')
      return
    }

    // Clear errors and show confirmation modal
    setImageError(null)
    setPendingFile(file)
    setConfirmAction('change')
    setShowConfirmModal(true)
  }

  const handleImageUpload = async () => {
    if (!pendingFile) return

    setShowConfirmModal(false)
    setImageError(null)
    setImageSuccess(null)
    setUploadingImage(true)

    try {
      const formData = new FormData()
      formData.append('image', pendingFile)

      const result = await apiClient.post<{ profile_image_url: string }>(
        API_ROUTES.AUTH.PROFILE_IMAGE,
        formData
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to upload image')
      }

      // Show toast notification
      showToastNotification('Profile image updated successfully!')
      
      // Refresh auth to update profile_image_url in context
      await refreshAuth()
      
      // Wait for auth context to fully update
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Hard reload to clear all cached images across all components
      window.location.reload()
    } catch (err: any) {
      setImageError(err.message || 'Failed to upload image')
      setUploadingImage(false)
    } finally {
      setPendingFile(null)
    }
  }

  const handleDeleteImageClick = () => {
    setImageError(null)
    setConfirmAction('remove')
    setShowConfirmModal(true)
  }

  const handleDeleteImage = async () => {
    setShowConfirmModal(false)
    setImageError(null)
    setImageSuccess(null)
    setUploadingImage(true)

    try {
      const result = await apiClient.delete(API_ROUTES.AUTH.PROFILE_IMAGE)

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to delete image')
      }

      // Show toast notification
      showToastNotification('Profile image removed successfully!')
      
      // Refresh auth to update profile_image_url in context
      await refreshAuth()
      
      // Wait for auth context to fully update
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Hard reload to clear all cached images
      window.location.reload()
    } catch (err: any) {
      setImageError(err.message || 'Failed to delete image')
      setUploadingImage(false)
    }
  }

  const handleConfirmModalAction = () => {
    if (confirmAction === 'change') {
      handleImageUpload()
    } else {
      handleDeleteImage()
    }
  }

  const handleCancelModal = () => {
    setShowConfirmModal(false)
    setPendingFile(null)
  }

  const handleGeneratePin = async () => {
    setPinError(null)
    setPinSuccess(null)
    setGeneratingPin(true)

    try {
      const result = await authService.generatePin()

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to generate PIN')
      }

      setQuickLoginCode(result.data.pin)
      setPinSuccess('PIN generated successfully!')
      await refreshAuth()
    } catch (err: any) {
      setPinError(err.message || 'Failed to generate PIN')
    } finally {
      setGeneratingPin(false)
    }
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)
    setPasswordSuccess(null)
    setChangingPassword(true)

    // Validation
    if (!passwordData.old_password) {
      setPasswordError('Current password is required')
      setChangingPassword(false)
      return
    }

    if (!passwordData.new_password) {
      setPasswordError('New password is required')
      setChangingPassword(false)
      return
    }

    if (passwordData.new_password.length < 6) {
      setPasswordError('New password must be at least 6 characters')
      setChangingPassword(false)
      return
    }

    if (passwordData.new_password !== passwordData.confirm_password) {
      setPasswordError('New passwords do not match')
      setChangingPassword(false)
      return
    }

    if (passwordData.old_password === passwordData.new_password) {
      setPasswordError('New password must be different from current password')
      setChangingPassword(false)
      return
    }

    try {
      const result = await authService.changePassword({
        old_password: passwordData.old_password,
        new_password: passwordData.new_password,
      })

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to change password')
      }

      setPasswordSuccess('Password changed successfully!')
      
      // Clear password fields after successful change
      setPasswordData({
        old_password: '',
        new_password: '',
        confirm_password: '',
      })
    } catch (err: any) {
      // Handle different error types
      if (err.name === 'AbortError') {
        setPasswordError('Request timed out. Please try again.')
      } else if (err.message) {
        setPasswordError(err.message)
      } else {
        setPasswordError('Failed to change password. Please try again.')
      }
    } finally {
      setChangingPassword(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <Loading message="Loading profile..." size="medium" />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="profile-container">
        <div className="profile-header">
          <h1>Profile Settings</h1>
          <p className="profile-subtitle">Manage your personal information</p>
        </div>

        <div className="profile-content">
          {/* Profile Image Section */}
          <div className="profile-section">
            <div className="profile-section-header">
              <h2>Profile Image</h2>
              <p className="profile-section-subtitle">Update your profile picture</p>
            </div>

            <div className="profile-image-section">
              {imageError && (
                <div className="profile-error">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>{imageError}</span>
                </div>
              )}

              {imageSuccess && (
                <div className="profile-success">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                  <span>{imageSuccess}</span>
                </div>
              )}

              <div className="profile-image-container">
                <div className="profile-image-preview">
                  {profile_image_url ? (
                    <>
                      <img 
                        src={getProfileImageUrl(profile_image_url, user?.id) || profile_image_url} 
                        alt="Profile" 
                        className="profile-image"
                        onError={(e) => {
                          // Fallback to initials if image fails to load
                          const target = e.target as HTMLImageElement
                          target.style.display = 'none'
                          const parent = target.parentElement
                          if (parent) {
                            const initials = `${first_name?.[0] || ''}${last_name?.[0] || ''}`.toUpperCase() || 'U'
                            const fallback = document.createElement('div')
                            fallback.className = 'profile-image-fallback'
                            fallback.textContent = initials
                            parent.appendChild(fallback)
                          }
                        }}
                      />
                      {imageError && imageError.includes('ERR_NAME_NOT_RESOLVED') && (
                        <div className="profile-image-error-overlay">
                          <p>⚠️ Public access not enabled in R2</p>
                          <p className="profile-image-error-hint">Enable public access in Cloudflare R2 dashboard</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="profile-image-fallback">
                      {`${first_name?.[0] || ''}${last_name?.[0] || ''}`.toUpperCase() || 'U'}
                    </div>
                  )}
                </div>

                <div className="profile-image-actions">
                  <input
                    ref={fileInputRef}
                    type="file"
                    id="profile-image-input"
                    accept="image/*"
                    onChange={handleImageSelect}
                    disabled={uploadingImage}
                    style={{ display: 'none' }}
                  />
                  <label htmlFor="profile-image-input" className="profile-image-upload-btn">
                    {uploadingImage ? (
                      <>
                        <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="30"></circle>
                        </svg>
                        Uploading...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="17 8 12 3 7 8"></polyline>
                          <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                        {profile_image_url ? 'Change Image' : 'Upload Image'}
                      </>
                    )}
                  </label>
                  {profile_image_url && (
                    <button
                      type="button"
                      onClick={handleDeleteImageClick}
                      disabled={uploadingImage}
                      className="profile-image-delete-btn"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                      Remove
                    </button>
                  )}
                </div>
                <p className="profile-image-hint">Maximum file size: 5MB. Supported formats: JPG, PNG, GIF, WebP</p>
              </div>
            </div>
          </div>

          {/* Personal Information Section */}
          <div className="profile-section">
            <div className="profile-section-header">
              <h2>Personal Information</h2>
              <p className="profile-section-subtitle">Update your personal details</p>
            </div>

            <form onSubmit={handleSubmit} className="profile-form">
              {error && (
                <div className="profile-error">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div className="profile-success">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                  <span>{success}</span>
                </div>
              )}

            <div className="profile-form-group">
              <div className="profile-form-row">
                <div className="profile-form-section">
                  <label htmlFor="first_name" className="profile-label">
                    First Name <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    id="first_name"
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleChange}
                    className="profile-input"
                    placeholder="Enter your first name"
                    required
                    disabled={saving}
                  />
                </div>

                <div className="profile-form-section">
                  <label htmlFor="last_name" className="profile-label">
                    Last Name <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    id="last_name"
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleChange}
                    className="profile-input"
                    placeholder="Enter your last name"
                    required
                    disabled={saving}
                  />
                </div>
              </div>
            </div>

            <div className="profile-form-section">
              <label htmlFor="email" className="profile-label">
                Email Address <span className="required">*</span>
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="profile-input"
                placeholder="Enter your email address"
                required
                disabled={saving}
              />
            </div>

            <div className="profile-form-group">
              <div className="profile-form-row">
                <div className="profile-form-section">
                  <label htmlFor="gender" className="profile-label">
                    Gender <span className="required">*</span>
                    {formData.gender && <span className="profile-readonly-badge">(Cannot be changed)</span>}
                  </label>
                  <select
                    id="gender"
                    name="gender"
                    value={formData.gender}
                    onChange={handleChange}
                    className="profile-input"
                    required
                    disabled={saving || !!formData.gender}
                    style={formData.gender ? { backgroundColor: '#F8FAFC', cursor: 'not-allowed' } : {}}
                  >
                    <option value="">Select Gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>

                <div className="profile-form-section">
                  <label className="profile-label">
                    Date of Birth <span className="required">*</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: '4px', cursor: 'help' }}>
                      <title>Select your birthday</title>
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
                      className="profile-input birthday-select"
                      required
                      disabled={saving}
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
                      className="profile-input birthday-select"
                      required
                      disabled={saving}
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
                      className="profile-input birthday-select"
                      required
                      disabled={saving}
                    >
                      <option value="">Year</option>
                      {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map(year => (
                        <option key={year} value={String(year)}>{year}</option>
                      ))}
                    </select>
                  </div>
                  {birthMonth && birthDay && birthYear && (
                    <p className="profile-input-hint" style={{ marginTop: '4px', color: '#64748B', fontSize: '13px' }}>
                      Age: <strong>{calculateAge(`${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`) !== null ? `${calculateAge(`${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`)} years old` : 'N/A'}</strong>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {role === 'executive' && (
              <div className="profile-form-group">
                <div className="profile-form-group-header">
                  <h3 className="profile-form-group-title">Business Information</h3>
                  <p className="profile-form-group-subtitle">This information will be shared with all users under you</p>
                </div>
                <div className="profile-form-row">
                  <div className="profile-form-section">
                    <label htmlFor="business_name" className="profile-label">
                      Business Name <span className="required">*</span>
                    </label>
                    <input
                      type="text"
                      id="business_name"
                      name="business_name"
                      value={formData.business_name}
                      onChange={handleChange}
                      className="profile-input"
                      placeholder="Enter your business name"
                      disabled={saving}
                      required
                    />
                  </div>

                  <div className="profile-form-section">
                    <label htmlFor="business_registration_number" className="profile-label">
                      Registration Number <span className="required">*</span>
                    </label>
                    <input
                      type="text"
                      id="business_registration_number"
                      name="business_registration_number"
                      value={formData.business_registration_number}
                      onChange={handleChange}
                      className="profile-input"
                      placeholder="Enter registration number"
                      disabled={saving}
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {role !== 'executive' && (
              <div className="profile-form-group">
                <div className="profile-form-group-header">
                  <h3 className="profile-form-group-title">Business Information</h3>
                  <p className="profile-form-group-subtitle">Inherited from your executive</p>
                </div>
                <div className="profile-form-row">
                  <div className="profile-form-section">
                    <label htmlFor="business_name" className="profile-label">
                      Business Name
                      <span className="profile-readonly-badge">(Inherited)</span>
                    </label>
                    <input
                      type="text"
                      id="business_name"
                      name="business_name"
                      value={formData.business_name}
                      className="profile-input"
                      readOnly
                      disabled
                    />
                  </div>

                  <div className="profile-form-section">
                    <label htmlFor="business_registration_number" className="profile-label">
                      Registration Number
                      <span className="profile-readonly-badge">(Inherited)</span>
                    </label>
                    <input
                      type="text"
                      id="business_registration_number"
                      name="business_registration_number"
                      value={formData.business_registration_number}
                      className="profile-input"
                      readOnly
                      disabled
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="profile-form-section">
              <label htmlFor="password" className="profile-label">
                Current Password <span className="required">*</span>
              </label>
              <div className="profile-input-wrapper">
                <input
                  type={showPasswords.password ? 'text' : 'password'}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className="profile-input"
                  placeholder="Enter your password to save changes"
                  required
                  disabled={saving}
                />
                <button
                  type="button"
                  className="profile-password-toggle"
                  onClick={() => togglePasswordVisibility('password')}
                  disabled={saving}
                >
                  {showPasswords.password ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              <p className="profile-input-hint">Required to confirm changes</p>
            </div>

            <div className="profile-form-actions">
              <button
                type="submit"
                className="profile-save-btn"
                disabled={saving}
              >
                {saving ? (
                  <>
                    <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="30"></circle>
                    </svg>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                      <polyline points="17 21 17 13 7 13 7 21"></polyline>
                      <polyline points="7 3 7 8 15 8"></polyline>
                    </svg>
                    Save Changes
                  </>
                )}
              </button>
            </div>
            </form>
          </div>

          {/* Password Change Section */}
          <div className="profile-section">
            <div className="profile-section-header">
              <h2>Change Password</h2>
              <p className="profile-section-subtitle">Update your password for better security</p>
            </div>

            <form onSubmit={handlePasswordSubmit} className="profile-password-form">
              {passwordError && (
                <div className="profile-error">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>{passwordError}</span>
                </div>
              )}

              {passwordSuccess && (
                <div className="profile-success">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                  <span>{passwordSuccess}</span>
                </div>
              )}

              <div className="profile-form-section">
                <label htmlFor="old_password" className="profile-label">
                  Current Password <span className="required">*</span>
                </label>
                <div className="profile-input-wrapper">
                  <input
                    type={showPasswords.old_password ? 'text' : 'password'}
                    id="old_password"
                    name="old_password"
                    value={passwordData.old_password}
                    onChange={handlePasswordChange}
                    className="profile-input"
                    placeholder="Enter your current password"
                    required
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    className="profile-password-toggle"
                    onClick={() => togglePasswordVisibility('old_password')}
                    disabled={changingPassword}
                  >
                    {showPasswords.old_password ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="profile-form-section">
                <label htmlFor="new_password" className="profile-label">
                  New Password <span className="required">*</span>
                </label>
                <div className="profile-input-wrapper">
                  <input
                    type={showPasswords.new_password ? 'text' : 'password'}
                    id="new_password"
                    name="new_password"
                    value={passwordData.new_password}
                    onChange={handlePasswordChange}
                    className="profile-input"
                    placeholder="Enter your new password"
                    required
                    disabled={changingPassword}
                    minLength={6}
                  />
                  <button
                    type="button"
                    className="profile-password-toggle"
                    onClick={() => togglePasswordVisibility('new_password')}
                    disabled={changingPassword}
                  >
                    {showPasswords.new_password ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="profile-input-hint">Must be at least 6 characters</p>
              </div>

              <div className="profile-form-section">
                <label htmlFor="confirm_password" className="profile-label">
                  Confirm New Password <span className="required">*</span>
                </label>
                <div className="profile-input-wrapper">
                  <input
                    type={showPasswords.confirm_password ? 'text' : 'password'}
                    id="confirm_password"
                    name="confirm_password"
                    value={passwordData.confirm_password}
                    onChange={handlePasswordChange}
                    className="profile-input"
                    placeholder="Confirm your new password"
                    required
                    disabled={changingPassword}
                    minLength={6}
                  />
                  <button
                    type="button"
                    className="profile-password-toggle"
                    onClick={() => togglePasswordVisibility('confirm_password')}
                    disabled={changingPassword}
                  >
                    {showPasswords.confirm_password ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="profile-form-actions">
                <button
                  type="submit"
                  className="profile-save-btn"
                  disabled={changingPassword}
                >
                  {changingPassword ? (
                    <>
                      <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="30"></circle>
                      </svg>
                      Changing Password...
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                      </svg>
                      Change Password
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* PIN Section */}
          <div className="profile-section">
            <div className="profile-section-header">
              <h2>Quick Login PIN</h2>
              <p className="profile-section-subtitle">Manage your quick login PIN for easy access</p>
            </div>

            <div className="profile-pin-content">
              {pinError && (
                <div className="profile-error">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>{pinError}</span>
                </div>
              )}

              {pinSuccess && (
                <div className="profile-success">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                  <span>{pinSuccess}</span>
                </div>
              )}

              <div className="profile-form-section">
                <label className="profile-label">
                  Current PIN
                </label>
                <div className="profile-input-wrapper">
                  <input
                    type={showPin ? 'text' : 'password'}
                    value={quickLoginCode || 'No PIN set'}
                    className="profile-input"
                    readOnly
                    disabled
                  />
                  {quickLoginCode && (
                    <button
                      type="button"
                      className="profile-password-toggle"
                      onClick={() => setShowPin(!showPin)}
                    >
                      {showPin ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
                <p className="profile-input-hint">
                  {quickLoginCode 
                    ? 'Your quick login PIN. Keep it secure.'
                    : 'You don\'t have a PIN yet. Generate one to enable quick login.'}
                </p>
              </div>

              <div className="profile-pin-actions">
                <button
                  type="button"
                  className="profile-generate-pin-btn"
                  onClick={handleGeneratePin}
                  disabled={generatingPin}
                >
                  {generatingPin ? (
                    <>
                      <svg className="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="30"></circle>
                      </svg>
                      Generating...
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                      </svg>
                      {quickLoginCode ? 'Regenerate PIN' : 'Generate PIN'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Confirmation Modal */}
        {showConfirmModal && (
          <div className="profile-modal-overlay" onClick={handleCancelModal}>
            <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
              <div className="profile-modal-header">
                <h3>
                  {confirmAction === 'change' 
                    ? 'Change Profile Image?' 
                    : 'Remove Profile Image?'}
                </h3>
              </div>
              <div className="profile-modal-body">
                <p>
                  {confirmAction === 'change'
                    ? 'Are you sure you want to change your profile image? This will replace your current image.'
                    : 'Are you sure you want to remove your profile image? You can upload a new one anytime.'}
                </p>
              </div>
              <div className="profile-modal-actions">
                <button
                  type="button"
                  onClick={handleCancelModal}
                  className="profile-modal-cancel"
                  disabled={uploadingImage}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmModalAction}
                  className="profile-modal-confirm"
                  disabled={uploadingImage}
                >
                  {confirmAction === 'change' ? 'Change Image' : 'Remove Image'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toast Notification */}
        {showToast && (
          <div className="profile-toast">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span>{toastMessage}</span>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

