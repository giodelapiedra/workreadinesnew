import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { isValidBusinessRegNumber } from '../utils/apiHelpers'
import { authService } from '../services/authService'
import { isApiError, getApiErrorMessage } from '../lib/apiClient'
import './SupervisorBusinessInfoModal.css'

interface SupervisorBusinessInfoModalProps {
  onComplete: () => void
}

export function SupervisorBusinessInfoModal({ onComplete }: SupervisorBusinessInfoModalProps) {
  const { refreshAuth } = useAuth()
  const [businessName, setBusinessName] = useState('')
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const trimmedBusinessName = businessName.trim()
    const trimmedRegNumber = businessRegistrationNumber.trim()

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

    try {
      const result = await authService.updateProfile({
        business_name: trimmedBusinessName,
        business_registration_number: trimmedRegNumber,
      })

      if (isApiError(result)) {
        setError(getApiErrorMessage(result) || 'Failed to update business information')
        setLoading(false)
        return
      }

      await refreshAuth()
      onComplete()
    } catch (err: any) {
      console.error('Error updating business info:', err)
      setError('Failed to update business information. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="supervisor-business-modal-overlay">
      <div className="supervisor-business-modal">
        <div className="supervisor-business-modal-header">
          <div className="supervisor-business-modal-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
              <path d="M2 17l10 5 10-5"></path>
              <path d="M2 12l10 5 10-5"></path>
            </svg>
          </div>
          <h2>Business Information Required</h2>
          <p>As a supervisor, you must provide your business name and business registration number to continue using the system.</p>
        </div>

        <div className="supervisor-business-modal-content">
          <form onSubmit={handleSubmit} className="supervisor-business-modal-form">
            <div className="supervisor-business-modal-form-group">
              <label htmlFor="business_name" className="supervisor-business-modal-label">
                Business Name *
              </label>
              <input
                type="text"
                id="business_name"
                name="business_name"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="supervisor-business-modal-input"
                placeholder="Enter your business name"
                required
                autoFocus
                disabled={loading}
              />
            </div>

            <div className="supervisor-business-modal-form-group">
              <label htmlFor="business_registration_number" className="supervisor-business-modal-label">
                Business Registration Number *
              </label>
              <input
                type="text"
                id="business_registration_number"
                name="business_registration_number"
                value={businessRegistrationNumber}
                onChange={(e) => setBusinessRegistrationNumber(e.target.value)}
                className="supervisor-business-modal-input"
                placeholder="Enter your business registration number"
                required
                disabled={loading}
              />
            </div>

            {error && <div className="supervisor-business-modal-error">{error}</div>}

            <div className="supervisor-business-modal-actions">
              <button
                type="submit"
                className="supervisor-business-modal-submit"
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save & Continue'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
