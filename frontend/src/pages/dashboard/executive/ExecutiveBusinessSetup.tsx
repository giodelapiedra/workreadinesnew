import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { authService } from '../../../services/authService'
import { isValidBusinessRegNumber } from '../../../utils/apiHelpers'
import { isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { PROTECTED_ROUTES } from '../../../config/routes'
import './ExecutiveBusinessSetup.css'

const WorkReadinessLogo = () => (
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
)

export function ExecutiveBusinessSetup() {
  const { refreshAuth } = useAuth()
  const navigate = useNavigate()
  const [businessName, setBusinessName] = useState('')
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [verifyingPassword, setVerifyingPassword] = useState(false)
  const [passwordVerified, setPasswordVerified] = useState(false)

  // Check if form is complete
  const isFormComplete = businessName.trim().length >= 2 && 
                         businessRegistrationNumber.trim() && 
                         isValidBusinessRegNumber(businessRegistrationNumber.trim()) &&
                         password.trim().length > 0

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!isFormComplete) {
      return
    }

    const trimmedPassword = password.trim()
    
    if (!trimmedPassword) {
      setError('Current password is required')
      return
    }

    // Verify password before showing confirmation dialog
    setVerifyingPassword(true)
    setError('')

    try {
      const verifyResult = await authService.verifyPassword(trimmedPassword)

      if (isApiError(verifyResult)) {
        setError(getApiErrorMessage(verifyResult) || 'Invalid password. Please check your password and try again.')
        setPasswordVerified(false)
        setVerifyingPassword(false)
        return
      }

      // Password is valid
      setPasswordVerified(true)
      setShowConfirmDialog(true)
    } catch (err: any) {
      console.error('Error verifying password:', err)
      setError('Failed to verify password. Please try again.')
      setPasswordVerified(false)
    } finally {
      setVerifyingPassword(false)
    }
  }

  const handleConfirmSubmit = async () => {
    setShowConfirmDialog(false)
    setLoading(true)
    setError('')

    const trimmedBusinessName = businessName.trim()
    const trimmedRegNumber = businessRegistrationNumber.trim()
    const trimmedPassword = password.trim()

    // Validation
    if (!trimmedBusinessName || trimmedBusinessName.length < 2) {
      setError('Business Name is required (minimum 2 characters)')
      setLoading(false)
      return
    }

    if (!trimmedRegNumber || !isValidBusinessRegNumber(trimmedRegNumber)) {
      setError('Valid Business Registration Number is required')
      setLoading(false)
      return
    }

    if (!trimmedPassword) {
      setError('Current password is required to save changes')
      setLoading(false)
      return
    }

    try {
      const result = await authService.updateProfile({
        business_name: trimmedBusinessName,
        business_registration_number: trimmedRegNumber,
        password: trimmedPassword, // Password required for security
      })

      if (isApiError(result)) {
        setError(getApiErrorMessage(result) || 'Failed to update business information')
        setLoading(false)
        return
      }

      // Show success
      setSuccess(true)
      
      // Refresh auth context to get updated data
      await refreshAuth()
      
      // Redirect to dashboard after 1.5 seconds
      setTimeout(() => {
        navigate(PROTECTED_ROUTES.EXECUTIVE.DASHBOARD)
      }, 1500)
    } catch (err: any) {
      console.error('Error updating business info:', err)
      setError('Failed to update business information. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="executive-business-setup-full">
      <div className="executive-business-setup-split">
          {/* Left Side - Form */}
          <div className="executive-business-setup-left">
            <div className="executive-business-setup-header">
              <h1>Let's set up your business information</h1>
              <p className="executive-business-setup-subtitle">
                What is your business name and registration number?
              </p>
            </div>

            <div className="executive-business-setup-content">
              <form onSubmit={handleFormSubmit} className="executive-business-setup-form">
                <div className="executive-business-setup-form-group">
                  <label htmlFor="business_name" className="executive-business-setup-label">
                    What is your Business Name? <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    id="business_name"
                    name="business_name"
                    value={businessName}
                    onChange={(e) => {
                      setBusinessName(e.target.value)
                      setError('')
                    }}
                    className="executive-business-setup-input"
                    placeholder="e.g. ABC Corporation"
                    required
                    autoFocus
                    disabled={loading || success}
                  />
                </div>

                <div className="executive-business-setup-form-group">
                  <label htmlFor="business_registration_number" className="executive-business-setup-label">
                    Business Registration Number <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    id="business_registration_number"
                    name="business_registration_number"
                    value={businessRegistrationNumber}
                    onChange={(e) => {
                      setBusinessRegistrationNumber(e.target.value)
                      setError('')
                    }}
                    className="executive-business-setup-input"
                    placeholder="Enter your business registration number"
                    required
                    disabled={loading || success}
                  />
                  <p className="executive-business-setup-hint">
                    Provide your official business registration number for verification
                  </p>
                </div>

                <div className="executive-business-setup-form-group">
                  <label htmlFor="password" className="executive-business-setup-label">
                    Current Password <span className="required">*</span>
                  </label>
                  <div className="executive-business-setup-password-wrapper">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="password"
                      name="password"
                      value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      setError('')
                      setPasswordVerified(false)
                    }}
                      className="executive-business-setup-input"
                      placeholder="Enter your current password"
                      required
                      disabled={loading || success}
                    />
                    <button
                      type="button"
                      className="executive-business-setup-password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={loading || success}
                    >
                      {showPassword ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <p className="executive-business-setup-hint">
                    Your password is required to save changes for security purposes
                  </p>
                </div>

                {error && (
                  <div className="executive-business-setup-error">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12" y2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <span>{error}</span>
                  </div>
                )}

                {success && (
                  <div className="executive-business-setup-success">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                      <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                    <span>Business information saved successfully! Redirecting...</span>
                  </div>
                )}

                <div className="executive-business-setup-actions">
                  <button
                    type="submit"
                    className="executive-business-setup-submit"
                    disabled={loading || !isFormComplete || success || verifyingPassword}
                  >
                    {verifyingPassword ? (
                      <>
                        <svg className="executive-business-setup-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="30"></circle>
                        </svg>
                        Verifying password...
                      </>
                    ) : loading ? (
                      <>
                        <svg className="executive-business-setup-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="30"></circle>
                        </svg>
                        Completing...
                      </>
                    ) : (
                      'Complete'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Confirmation Dialog */}
          {showConfirmDialog && (
            <div className="executive-business-setup-confirm-overlay" onClick={() => setShowConfirmDialog(false)}>
              <div className="executive-business-setup-confirm-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="executive-business-setup-confirm-header">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  <h2>Confirm Business Setup</h2>
                </div>
                <div className="executive-business-setup-confirm-body">
                  <p>Are you sure you want to complete the business setup?</p>
                  <div className="executive-business-setup-confirm-details">
                    <div className="executive-business-setup-confirm-item">
                      <span className="executive-business-setup-confirm-label">Business Name:</span>
                      <span className="executive-business-setup-confirm-value">{businessName.trim()}</span>
                    </div>
                    <div className="executive-business-setup-confirm-item">
                      <span className="executive-business-setup-confirm-label">Registration Number:</span>
                      <span className="executive-business-setup-confirm-value">{businessRegistrationNumber.trim()}</span>
                    </div>
                  </div>
                  <p className="executive-business-setup-confirm-warning">
                    This action will save your business information and cannot be easily undone.
                  </p>
                </div>
                <div className="executive-business-setup-confirm-actions">
                  <button
                    type="button"
                    className="executive-business-setup-confirm-cancel"
                    onClick={() => setShowConfirmDialog(false)}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="executive-business-setup-confirm-proceed"
                    onClick={handleConfirmSubmit}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <svg className="executive-business-setup-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="30"></circle>
                        </svg>
                        Completing...
                      </>
                    ) : (
                      'Yes, Complete Setup'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Right Side - Hero/Branding Section */}
          <div className="executive-business-setup-right">
            <div className="executive-business-setup-hero">
              <div className="executive-business-setup-hero-content">
                <div className="executive-business-setup-hero-header">
                  <div className="executive-business-setup-hero-logo">
                    <WorkReadinessLogo />
                    <span className="executive-business-setup-hero-brand">
                      Work<br />Readiness
                    </span>
                  </div>
                </div>
                
                <div className="executive-business-setup-hero-main">
                  <h1 className="executive-business-setup-hero-title">
                    Build Your Foundation
                    <br />
                    for Workplace
                    <br />
                    Excellence.
                  </h1>
                  <p className="executive-business-setup-hero-description">
                    Complete your business profile to unlock powerful tools for managing your workforce, tracking compliance, and ensuring operational readiness across your organization.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
  )
}

