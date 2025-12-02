import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ROLE_OPTIONS, type UserRole } from '../../../types/roles'
import { getDashboardRoute } from '../../../config/routes'
import { useAuth } from '../../../contexts/AuthContext'
import { isValidEmail, isValidBusinessRegNumber } from '../../../utils/apiHelpers'
import { authService } from '../../../services/authService'
import { isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { calculateAge } from '../../../shared/date'
import { validateBirthday } from '../../../utils/validationUtils'
import '../auth-common.css'

export function Register() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<UserRole>('worker')
  const [businessName, setBusinessName] = useState('')
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | ''>('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [birthMonth, setBirthMonth] = useState('')
  const [birthDay, setBirthDay] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [birthdayError, setBirthdayError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const navigate = useNavigate()
  const { setRole: setAuthRole, refreshAuth } = useAuth()

  // Use centralized validation utility
  // Note: validateBirthday is imported from utils/validationUtils

  const showToastMessage = (message: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(message)
    setToastType(type)
    setShowToast(true)
    setTimeout(() => {
      setShowToast(false)
    }, 3000)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const trimmedFirstName = firstName.trim()
    const trimmedLastName = lastName.trim()
    const trimmedEmail = email.trim().toLowerCase()
    const trimmedBusinessName = role === 'supervisor' ? businessName.trim() : ''
    const trimmedRegNumber = role === 'supervisor' ? businessRegistrationNumber.trim() : ''

    // Validation
    if (!trimmedFirstName || !trimmedLastName) {
      showToastMessage('First Name and Last Name are required', 'error')
      setLoading(false)
      return
    }

    if (!gender) {
      showToastMessage('Gender is required', 'error')
      setLoading(false)
      return
    }

    // Validate birthday from dropdowns
    if (!birthMonth || !birthDay || !birthYear) {
      showToastMessage('Date of Birth is required', 'error')
      setLoading(false)
      return
    }

    // Construct date string from dropdowns
    const dateStr = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`
    const birthDate = new Date(dateStr)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    // Validate date
    if (isNaN(birthDate.getTime())) {
      showToastMessage('Invalid date of birth', 'error')
      setLoading(false)
      return
    }
    
    if (birthDate >= today) {
      showToastMessage('Date of Birth must be in the past', 'error')
      setLoading(false)
      return
    }
    
    // Check minimum age (18 years old)
    const age = calculateAge(dateStr)
    if (age === null) {
      showToastMessage('Invalid date of birth', 'error')
      setLoading(false)
      return
    }
    if (age < 18) {
      showToastMessage(`Age must be at least 18 years old. Current age: ${age} years old`, 'error')
      setLoading(false)
      return
    }
    
    // Set dateOfBirth for API call
    setDateOfBirth(dateStr)

    if (!isValidEmail(trimmedEmail)) {
      showToastMessage('Please enter a valid email address', 'error')
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      showToastMessage('Passwords do not match', 'error')
      setLoading(false)
      return
    }

    if (password.length < 6) {
      showToastMessage('Password must be at least 6 characters', 'error')
      setLoading(false)
      return
    }

    // Supervisor-specific validation
    if (role === 'supervisor') {
      if (!trimmedBusinessName || trimmedBusinessName.length < 2) {
        showToastMessage('Business Name is required (minimum 2 characters)', 'error')
        setLoading(false)
        return
      }

      if (!trimmedRegNumber || !isValidBusinessRegNumber(trimmedRegNumber)) {
        showToastMessage('Valid Business Registration Number is required', 'error')
        setLoading(false)
        return
      }
    }

    try {
      const result = await authService.register({
        first_name: trimmedFirstName,
        last_name: trimmedLastName,
        email: trimmedEmail,
        password,
        role,
        business_name: role === 'supervisor' ? trimmedBusinessName : undefined,
        business_registration_number: role === 'supervisor' ? trimmedRegNumber : undefined,
        gender: gender as 'male' | 'female',
        date_of_birth: dateOfBirth,
      })

      if (isApiError(result)) {
        const errorMessage = getApiErrorMessage(result)
        if (errorMessage.includes('already exists') || errorMessage.includes('already registered')) {
          showToastMessage('Email already registered. Please sign in instead.', 'error')
        } else if (errorMessage.includes('Invalid email')) {
          showToastMessage('Please enter a valid email address', 'error')
        } else {
          showToastMessage(errorMessage || 'Failed to sign up. Please try again.', 'error')
        }
        setLoading(false)
        return
      }

      const userRole = result.data?.user?.role || role
      if (userRole) {
        setAuthRole(userRole)
      }
      
      await refreshAuth()
      await new Promise(resolve => setTimeout(resolve, 100))

      showToastMessage('Account successfully created! Redirecting to dashboard...', 'success')
      setTimeout(() => {
        navigate(getDashboardRoute(userRole as any), { replace: true })
      }, 1000)
    } catch (err: any) {
      console.error('Registration error:', err)
      const errorMessage = err.message || 'Failed to sign up. Please try again.'
      if (errorMessage.includes('already registered') || errorMessage.includes('already exists')) {
        showToastMessage('Email already registered. Please sign in instead.', 'error')
      } else {
        showToastMessage(errorMessage, 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-split-container">
      {/* Left Side - Promotional Content */}
      <div className="auth-promo-section">
        <div className="auth-promo-content">
          <div className="auth-promo-header">
            <div className="auth-promo-logo">
              <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
                <path
                  d="M20 10C25 10 30 12 30 15V25C30 28 25 30 20 30C15 30 10 28 10 25V15C10 12 15 10 20 10Z"
                  fill="#ffffff"
                />
                <path
                  d="M15 20C15 22.5 17.5 25 20 25C22.5 25 25 22.5 25 20V15C25 12.5 22.5 10 20 10C17.5 10 15 12.5 15 15V20Z"
                  fill="#a0aec0"
                />
                <path
                  d="M25 20C25 17.5 22.5 15 20 15C17.5 15 15 17.5 15 20V25C15 27.5 17.5 30 20 30C22.5 30 25 27.5 25 25V20Z"
                  fill="#718096"
                />
              </svg>
              <span className="auth-promo-brand">Work Readiness</span>
            </div>
          </div>
          
          <div className="auth-promo-main">
            <h1 className="auth-promo-title">
              Join thousands of
              <br />
              teams building safer
              <br />
              workplaces.
            </h1>
            <p className="auth-promo-description">
              Start your journey towards better workforce management, compliance tracking, and workplace safety today.
            </p>
          </div>

          <div className="auth-promo-footer">
            <button className="auth-promo-cta">
              Learn more
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 3L11 8L6 13" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Right Side - Sign Up Form */}
      <div className="auth-form-section">
        <div className="auth-form-container">
          <div className="auth-form-header">
            <div className="auth-form-logo">
              <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
                <path
                  d="M20 10C25 10 30 12 30 15V25C30 28 25 30 20 30C15 30 10 28 10 25V15C10 12 15 10 20 10Z"
                  fill="#6366f1"
                />
                <path
                  d="M15 20C15 22.5 17.5 25 20 25C22.5 25 25 22.5 25 20V15C25 12.5 22.5 10 20 10C17.5 10 15 12.5 15 15V20Z"
                  fill="#818cf8"
                />
                <path
                  d="M25 20C25 17.5 22.5 15 20 15C17.5 15 15 17.5 15 20V25C15 27.5 17.5 30 20 30C22.5 30 25 27.5 25 25V20Z"
                  fill="#a5b4fc"
                />
              </svg>
              <span className="auth-form-brand">Work Readiness</span>
            </div>
            <h2 className="auth-form-title">Create your account</h2>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="auth-form-row">
              <div className="auth-input-group">
                <input
                  type="text"
                  placeholder="First Name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="auth-input"
                  required
                />
              </div>

              <div className="auth-input-group">
                <input
                  type="text"
                  placeholder="Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="auth-input"
                  required
                />
              </div>
            </div>

            <div className="auth-input-group">
              <input
                type="email"
                placeholder="Email address or username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="auth-input"
                autoComplete="email"
                required
              />
            </div>

            <div className="auth-form-row">
              <div className="auth-input-group">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="auth-password-toggle"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    {showPassword ? (
                      <>
                        <path d="M2 2L18 18M11.5 11.5C11.2239 11.7761 10.7761 11.7761 10.5 11.5M8.5 8.5C8.77614 8.22386 9.22386 8.22386 9.5 8.5M3 10C3 10 5 5 10 5C12.5 5 14.5 7 15.5 9M17 10C17 10 15 15 10 15C7.5 15 5.5 13 4.5 11" />
                        <circle cx="10" cy="10" r="3" />
                      </>
                    ) : (
                      <>
                        <path d="M2 10C2 10 4 5 9 5C14 5 17 10 17 10M17 10C17 10 15 15 10 15C5 15 2 10 2 10" />
                        <circle cx="10" cy="10" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>

              <div className="auth-input-group">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="auth-input"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="auth-password-toggle"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    {showConfirmPassword ? (
                      <>
                        <path d="M2 2L18 18M11.5 11.5C11.2239 11.7761 10.7761 11.7761 10.5 11.5M8.5 8.5C8.77614 8.22386 9.22386 8.22386 9.5 8.5M3 10C3 10 5 5 10 5C12.5 5 14.5 7 15.5 9M17 10C17 10 15 15 10 15C7.5 15 5.5 13 4.5 11" />
                        <circle cx="10" cy="10" r="3" />
                      </>
                    ) : (
                      <>
                        <path d="M2 10C2 10 4 5 9 5C14 5 17 10 17 10M17 10C17 10 15 15 10 15C5 15 2 10 2 10" />
                        <circle cx="10" cy="10" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
            </div>

            <div className="auth-input-group">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="auth-input auth-select"
                required
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="auth-form-row">
              <div className="auth-input-group">
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as 'male' | 'female' | '')}
                  className="auth-input auth-select"
                  required
                >
                  <option value="">Select Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>

              <div className="auth-input-group">
                <label className="auth-label">
                  Birthday <span className="required">*</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: '4px', cursor: 'help' }}>
                    <title>Select your birthday</title>
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                </label>
                {birthdayError && (
                  <div className="birthday-error-message">
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
                    className="auth-input auth-select birthday-select"
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
                    }}
                    className="auth-input auth-select birthday-select"
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
                    }}
                    className="auth-input auth-select birthday-select"
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

            {/* Business Information Fields - Required for Supervisors */}
            {role === 'supervisor' && (
              <>
                <div className="auth-input-group">
                  <input
                    type="text"
                    placeholder="Business Name *"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    className="auth-input"
                    required
                  />
                </div>

                <div className="auth-input-group">
                  <input
                    type="text"
                    placeholder="Business Registration Number *"
                    value={businessRegistrationNumber}
                    onChange={(e) => setBusinessRegistrationNumber(e.target.value)}
                    className="auth-input"
                    required
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="auth-button"
            >
              {loading ? 'Creating account...' : 'Sign Up'}
            </button>
          </form>

          <div className="auth-signin-link">
            Already have an account?{' '}
            <Link to="/login" className="auth-link">
              Sign in
            </Link>
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      {showToast && (
        <div className="auth-toast">
          <div className={`auth-toast-content ${toastType === 'success' ? 'auth-toast-success' : 'auth-toast-error'}`}>
            {toastType === 'success' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            )}
            <span>{toastMessage}</span>
          </div>
        </div>
      )}
    </div>
  )
}
