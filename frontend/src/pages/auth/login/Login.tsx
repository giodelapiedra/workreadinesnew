import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getDashboardRoute } from '../../../config/routes'
import { useAuth } from '../../../contexts/AuthContext'
import { isValidEmail } from '../../../utils/apiHelpers'
import { authService } from '../../../services/authService'
import { isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import svgImage from '../../../assets/svg.png'
import '../auth-common.css'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [quickLoginCode, setQuickLoginCode] = useState('')
  const [loginMode, setLoginMode] = useState<'email' | 'quick'>('email')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const navigate = useNavigate()
  const { setRole, refreshAuth } = useAuth()

  const showToastMessage = (message: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(message)
    setToastType(type)
    setShowToast(true)
    setTimeout(() => {
      setShowToast(false)
    }, 3000)
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const trimmedEmail = email.trim().toLowerCase()
    
    if (!isValidEmail(trimmedEmail)) {
      showToastMessage('Please enter a valid email address', 'error')
      setLoading(false)
      return
    }

    if (!password) {
      showToastMessage('Password is required', 'error')
      setLoading(false)
      return
    }

    try {
      const result = await authService.login({ email: trimmedEmail, password })

      if (isApiError(result)) {
        // Display the error message from the backend (e.g., "Invalid email or password")
        showToastMessage(getApiErrorMessage(result) || 'Failed to sign in. Please try again.', 'error')
        setLoading(false)
        return
      }

      if (!result.data?.user?.role) {
        showToastMessage('User role not found. Please contact administrator.', 'error')
        setLoading(false)
        return
      }

      // Show success toast before redirecting
      showToastMessage('Login successful! Redirecting...', 'success')
      setRole(result.data.user.role)
      await refreshAuth()
      await new Promise(resolve => setTimeout(resolve, 500))
      
      navigate(getDashboardRoute(result.data.user.role as any), { replace: true })
    } catch (err: any) {
      console.error('Login error:', err)
      showToastMessage('Failed to sign in. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleQuickLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const trimmedCode = quickLoginCode.trim()
    
    // Validate format: accepts 6 digits OR lastname-number format
    const isValidFormat = /^\d{6}$/.test(trimmedCode) || /^[a-z0-9]+-[0-9]+$/i.test(trimmedCode)
    
    if (!trimmedCode || !isValidFormat) {
      showToastMessage('Please enter a valid quick login code (6 digits or lastname-number format, e.g., delapiedra-232939)', 'error')
      setLoading(false)
      return
    }

    try {
      const result = await authService.quickLogin({ quick_login_code: trimmedCode })

      if (isApiError(result)) {
        showToastMessage(getApiErrorMessage(result) || 'Invalid quick login code', 'error')
        setLoading(false)
        return
      }

      if (!result.data?.user?.role) {
        showToastMessage('User role not found. Please contact administrator.', 'error')
        setLoading(false)
        return
      }

      // Show success toast before redirecting
      showToastMessage('Login successful! Redirecting...', 'success')
      setRole(result.data.user.role)
      await refreshAuth()
      await new Promise(resolve => setTimeout(resolve, 500))
      
      navigate(getDashboardRoute(result.data.user.role as any), { replace: true })
    } catch (err: any) {
      console.error('Quick login error:', err)
      showToastMessage('Failed to sign in. Please try again.', 'error')
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
            <div className="auth-promo-image-container">
              <img 
                src={svgImage} 
                alt="Workforce Management" 
                className="auth-promo-image"
              />
            </div>
            <h1 className="auth-promo-title">
              Ensuring Safe and
              <br />
              Ready Workplaces,
              <br />
              Every Day.
            </h1>
            <p className="auth-promo-description">
              Streamline your workforce management with our comprehensive platform designed for safety, compliance, and productivity.
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

      {/* Right Side - Login Form */}
      <div className="auth-form-section">
        <div className="auth-form-container login-form-narrow">
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
            <h2 className="auth-form-title">Log in to your account</h2>
          </div>

          {/* Login Mode Toggle */}
          <div className="login-mode-toggle">
            <button
              type="button"
              onClick={() => {
                setLoginMode('email')
                setQuickLoginCode('')
              }}
              className={`login-mode-btn ${loginMode === 'email' ? 'active' : ''}`}
            >
              Email Login
            </button>
            <button
              type="button"
              onClick={() => {
                setLoginMode('quick')
                setEmail('')
                setPassword('')
              }}
              className={`login-mode-btn ${loginMode === 'quick' ? 'active' : ''}`}
            >
              Quick Login
            </button>
          </div>

          {loginMode === 'email' ? (
            <form onSubmit={handleEmailLogin} className="auth-form">
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

              <div className="auth-input-group">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input"
                  autoComplete="current-password"
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

              <div className="auth-forgot-link">
                <Link to="/forgot-password">Forgot your password?</Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="auth-button"
              >
                {loading ? 'Logging in...' : 'Continue'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleQuickLogin} className="auth-form">
              <div className="auth-input-group">
                <input
                  type="text"
                  placeholder="Enter quick login code"
                  value={quickLoginCode}
                  onChange={(e) => {
                    const value = e.target.value
                      .replace(/[^a-z0-9-]/gi, '')
                      .slice(0, 30)
                    setQuickLoginCode(value)
                  }}
                  className="auth-input login-quick-input"
                  required
                />
              </div>
              <p className="login-quick-hint">
                Enter your PIN (e.g., delapiedra-232939) or 6-digit code
              </p>

              <button
                type="submit"
                disabled={loading || !quickLoginCode.trim() || (!/^\d{6}$/.test(quickLoginCode.trim()) && !/^[a-z0-9]+-[0-9]+$/i.test(quickLoginCode.trim()))}
                className="auth-button"
              >
                {loading ? 'Logging in...' : 'Continue'}
              </button>
            </form>
          )}

          <div className="auth-signin-link">
            Don't have an account?{' '}
            <Link to="/register" className="auth-link">
              Sign up
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
