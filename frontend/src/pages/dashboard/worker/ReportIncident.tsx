import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { useAuth } from '../../../contexts/AuthContext'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { getTodayDateString } from '../../../shared/date'
import './ReportIncident.css'

interface ReportFormData {
  type: 'incident' | 'near_miss'
  description: string
  date: string
  location: string
  photo: File | null
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export function ReportIncident() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Security check: ensure only workers can access
  useEffect(() => {
    if (role && role !== 'worker') {
      navigate('/dashboard')
    }
  }, [role, navigate])

  // Check if worker can report (has active exception or pending incident)
  useEffect(() => {
    const checkCanReport = async () => {
      try {
        setCheckingStatus(true)
        const result = await apiClient.get<{
          canReport: boolean
          reason?: string
          exceptionType?: string
          startDate?: string
          pendingIncident?: boolean
          incidentId?: string
        }>(API_ROUTES.WORKER.CAN_REPORT_INCIDENT)

        if (!isApiError(result)) {
          const data = result.data
          if (data.canReport) {
            setCanReport(true)
            setActiveCaseInfo(null)
          } else {
            setCanReport(false)
            setActiveCaseInfo({
              reason: data.reason || 'You have an active case that must be closed first.',
              exceptionType: data.exceptionType,
              startDate: data.startDate,
              pendingIncident: data.pendingIncident || false,
              incidentId: data.incidentId,
            })
          }
        } else {
          // If check fails, allow reporting (backend will catch it)
          setCanReport(true)
        }
      } catch (err: any) {
        console.error('Error checking report status:', err)
        // If check fails, allow reporting (backend will catch it)
        setCanReport(true)
      } finally {
        setCheckingStatus(false)
      }
    }

    if (role === 'worker') {
      checkCanReport()
      // Re-check every 30 seconds to update status if approval/rejection happens
      const interval = setInterval(checkCanReport, 30000)
      return () => clearInterval(interval)
    }
  }, [role])
  
  const [formData, setFormData] = useState<ReportFormData>({
    type: 'incident',
    description: '',
    date: getTodayDateString(),
    location: '',
    photo: null,
    severity: 'medium',
  })
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [showSuccessToast, setShowSuccessToast] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState(true)
  const [canReport, setCanReport] = useState(true)
  const [activeCaseInfo, setActiveCaseInfo] = useState<{
    reason: string
    exceptionType?: string
    startDate?: string
    pendingIncident?: boolean
    incidentId?: string
  } | null>(null)
  const [analysisResult, setAnalysisResult] = useState<{
    summary: string
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
    recommendations: string[]
    severityAssessment: string
    followUpActions: string[]
    advice: string
    imageAnalysis?: string
  } | null>(null)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setError('')
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('Photo size must be less than 5MB')
        return
      }
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please upload an image file')
        return
      }

      setFormData(prev => ({ ...prev, photo: file }))
      
      // Create preview
      const reader = new FileReader()
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
      setError('')
    }
  }

  const removePhoto = () => {
    setFormData(prev => ({ ...prev, photo: null }))
    setPhotoPreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleAnalyze = async () => {
    // Prevent analysis if cannot report
    if (!canReport) {
      setError(activeCaseInfo?.reason || 'You cannot analyze while you have an active case.')
      return
    }

    // Validation
    if (!formData.description.trim()) {
      setError('Please provide a description before analyzing')
      return
    }

    if (!formData.location.trim()) {
      setError('Please provide the location before analyzing')
      return
    }

    setError('')
    setAnalyzing(true)
    setAnalysisResult(null)

    try {
      // Use FormData to support image upload for AI analysis
      const analyzeFormData = new FormData()
      analyzeFormData.append('type', formData.type)
      analyzeFormData.append('description', formData.description)
      analyzeFormData.append('location', formData.location)
      analyzeFormData.append('severity', formData.severity)
      analyzeFormData.append('date', formData.date)
      
      // Include photo for AI vision analysis if available
      if (formData.photo) {
        analyzeFormData.append('photo', formData.photo)
      }

      const result = await apiClient.post<{
        success: boolean
        hasImageAnalysis?: boolean
        analysis?: {
          summary: string
          riskLevel: 'low' | 'medium' | 'high' | 'critical'
          recommendations: string[]
          severityAssessment: string
          followUpActions: string[]
          advice: string
          imageAnalysis?: string
        }
      }>(API_ROUTES.WORKER.ANALYZE_INCIDENT, analyzeFormData)

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to analyze incident report')
      }

      if (result.data.success && result.data.analysis) {
        setAnalysisResult(result.data.analysis)
      }
    } catch (err: any) {
      console.error('Error analyzing incident report:', err)
      setError(err.message || 'Failed to analyze incident report. Please try again.')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)

    // Double check - prevent submission if cannot report
    if (!canReport) {
      setError(activeCaseInfo?.reason || 'You cannot submit a report while you have an active case.')
      return
    }

    // Validation
    if (!formData.description.trim()) {
      setError('Please provide a description')
      return
    }

    if (!formData.location.trim()) {
      setError('Please provide the location')
      return
    }

    try {
      setSubmitting(true)

      // Prepare form data
      const formDataToSend = new FormData()
      formDataToSend.append('type', formData.type)
      formDataToSend.append('description', formData.description)
      formDataToSend.append('incident_date', formData.date)
      formDataToSend.append('location', formData.location)
      formDataToSend.append('severity', formData.severity)
      
      if (formData.photo) {
        formDataToSend.append('photo', formData.photo)
      }

      // Include AI analysis result if available
      if (analysisResult) {
        formDataToSend.append('ai_analysis_result', JSON.stringify(analysisResult))
      }

      // Use centralized apiClient for FormData uploads
      // apiClient now supports FormData and will handle Content-Type automatically
      const result = await apiClient.post<{ success: boolean; message?: string }>(
        API_ROUTES.WORKER.REPORT_INCIDENT,
        formDataToSend
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to submit incident report')
      }

      setSuccess(true)
      setShowSuccessToast(true)
      
      // Reset form
      setFormData({
        type: 'incident',
        description: '',
        date: getTodayDateString(),
        location: '',
        photo: null,
        severity: 'medium',
      })
      setPhotoPreview(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }

      // Auto-hide toast after 3 seconds
      setTimeout(() => {
        setShowSuccessToast(false)
      }, 3000)

      // Redirect after 2 seconds
      setTimeout(() => {
        navigate('/dashboard/worker')
      }, 2000)

    } catch (err: any) {
      console.error('Error submitting incident report:', err)
      setError(err.message || 'Failed to submit incident report. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="report-incident-container">
        <div className="report-incident-header">
          <div>
            <h1 className="report-incident-title">Report Incident or Near-Miss</h1>
            <p className="report-incident-subtitle">Quick 60-second report with photo</p>
          </div>
        </div>

        {success && (
          <div className="report-incident-success">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <div>
              <h3>Report Submitted Successfully!</h3>
              <p>Your incident report has been submitted. Redirecting you back...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="report-incident-error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Active Case Warning */}
        {!checkingStatus && !canReport && activeCaseInfo && (
          <div className="report-incident-active-case">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <div>
              <h3>{activeCaseInfo.pendingIncident ? '⏳ Pending Report Awaiting Approval' : '⚠️ Cannot Submit New Report'}</h3>
              <p>{activeCaseInfo.reason}</p>
              {activeCaseInfo.startDate && (
                <p className="active-case-details">
                  {activeCaseInfo.pendingIncident ? 'Report submitted' : 'Active case started'}: {new Date(activeCaseInfo.startDate).toLocaleDateString()}
                  {activeCaseInfo.exceptionType && ` • Type: ${activeCaseInfo.exceptionType}`}
                </p>
              )}
              <p className="active-case-instruction">
                {activeCaseInfo.pendingIncident 
                  ? 'Your incident report is pending team leader approval. Please wait for approval or rejection before submitting a new report.'
                  : 'Please wait until your current case is closed by your supervisor or clinician before submitting a new incident report.'}
              </p>
            </div>
          </div>
        )}

        {checkingStatus && (
          <div className="report-incident-loading">
            <svg className="spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="2" x2="12" y2="6"></line>
              <line x1="12" y1="18" x2="12" y2="22"></line>
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
              <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
              <line x1="2" y1="12" x2="6" y2="12"></line>
              <line x1="18" y1="12" x2="22" y2="12"></line>
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
              <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
            </svg>
            <span>Checking report status...</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="report-incident-form" style={{ opacity: !canReport ? 0.6 : 1, pointerEvents: !canReport ? 'none' : 'auto' }}>
          {/* Report Type */}
          <div className="form-group">
            <label className="form-label">Report Type</label>
            <div className="report-type-buttons">
              <button
                type="button"
                className={`report-type-btn ${formData.type === 'incident' ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, type: 'incident' }))}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                Incident
              </button>
              <button
                type="button"
                className={`report-type-btn ${formData.type === 'near_miss' ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, type: 'near_miss' }))}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                Near-Miss
              </button>
            </div>
          </div>

          {/* Date */}
          <div className="form-group">
            <label htmlFor="date" className="form-label">Date</label>
            <input
              type="date"
              id="date"
              name="date"
              value={formData.date}
              onChange={handleInputChange}
              className="form-input"
              max={getTodayDateString()}
              required
            />
          </div>

          {/* Location */}
          <div className="form-group">
            <label htmlFor="location" className="form-label">Location</label>
            <input
              type="text"
              id="location"
              name="location"
              value={formData.location}
              onChange={handleInputChange}
              className="form-input"
              placeholder="e.g., Building A, Floor 3, Site Location"
              required
            />
          </div>

          {/* Severity Status */}
          <div className="form-group">
            <label className="form-label">Severity</label>
            <div className="severity-buttons">
              <button
                type="button"
                className={`severity-btn severity-low ${formData.severity === 'low' ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, severity: 'low' }))}
              >
                <span className="severity-dot"></span>
                Low
              </button>
              <button
                type="button"
                className={`severity-btn severity-medium ${formData.severity === 'medium' ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, severity: 'medium' }))}
              >
                <span className="severity-dot"></span>
                Medium
              </button>
              <button
                type="button"
                className={`severity-btn severity-high ${formData.severity === 'high' ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, severity: 'high' }))}
              >
                <span className="severity-dot"></span>
                High
              </button>
              <button
                type="button"
                className={`severity-btn severity-critical ${formData.severity === 'critical' ? 'active' : ''}`}
                onClick={() => setFormData(prev => ({ ...prev, severity: 'critical' }))}
              >
                <span className="severity-dot"></span>
                Critical
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="form-group">
            <label htmlFor="description" className="form-label">Description</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              className="form-textarea"
              placeholder="Describe what happened in detail..."
              rows={5}
              required
            />
          </div>

          {/* AI Analysis Section */}
          {analysisResult && (
            <>
              {/* Urgent Message for High/Critical Severity */}
              {(analysisResult.riskLevel === 'high' || analysisResult.riskLevel === 'critical') && (
                <div className="ai-urgent-alert">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  <div>
                    <h4>⚠️ URGENT: Please submit report now</h4>
                    <p>Para ma-asikaso ni Team Leader ang incident na ito. Submit mo na agad ang report para ma-handle na agad.</p>
                  </div>
                </div>
              )}

              <div className="ai-analysis-container">
                <div className="ai-analysis-header">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                  </svg>
                  <h3>Expert Clinician Analysis</h3>
                </div>
                
                <div className="ai-analysis-content">
                  <div className="ai-analysis-item">
                    <label>Summary</label>
                    <p>{analysisResult.summary}</p>
                  </div>
                  
                  <div className="ai-analysis-item">
                    <label>Risk Level</label>
                    <span className={`risk-badge risk-${analysisResult.riskLevel}`}>
                      {analysisResult.riskLevel.toUpperCase()}
                    </span>
                  </div>
                  
                  <div className="ai-analysis-item">
                    <label>Advice & Suggestions</label>
                    <p className="ai-advice-text">{analysisResult.advice}</p>
                  </div>
                  
                  <div className="ai-analysis-item">
                    <label>Severity Assessment</label>
                    <p>{analysisResult.severityAssessment}</p>
                  </div>
                  
                  <div className="ai-analysis-item">
                    <label>Recommendations</label>
                    <ul>
                      {analysisResult.recommendations.map((rec, idx) => (
                        <li key={idx}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                  
                  <div className="ai-analysis-item">
                    <label>Follow-Up Actions</label>
                    <ul>
                      {analysisResult.followUpActions.map((action, idx) => (
                        <li key={idx}>{action}</li>
                      ))}
                    </ul>
                  </div>
                  
                  {/* Image Analysis - Only shown if photo was analyzed */}
                  {analysisResult.imageAnalysis && (
                    <div className="ai-analysis-item ai-image-analysis">
                      <label>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                          <circle cx="8.5" cy="8.5" r="1.5"></circle>
                          <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        Photo Analysis
                      </label>
                      <p>{analysisResult.imageAnalysis}</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Photo Upload */}
          <div className="form-group">
            <label className="form-label">Photo (Optional)</label>
            <div className="photo-upload-container">
              {photoPreview ? (
                <div className="photo-preview-wrapper">
                  <img src={photoPreview} alt="Preview" className="photo-preview" />
                  <button
                    type="button"
                    onClick={removePhoto}
                    className="photo-remove-btn"
                    aria-label="Remove photo"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              ) : (
                <label className="photo-upload-area">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    className="photo-input"
                  />
                  <div className="photo-upload-content">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <circle cx="8.5" cy="8.5" r="1.5"></circle>
                      <polyline points="21 15 16 10 5 21"></polyline>
                    </svg>
                    <span className="photo-upload-text">Click to upload photo</span>
                    <span className="photo-upload-hint">Max 5MB - JPG, PNG</span>
                  </div>
                </label>
              )}
            </div>
          </div>

          {/* Submit Button */}
          <div className="form-actions">
            <button
              type="button"
              onClick={() => navigate('/dashboard/worker')}
              className="btn-secondary"
              disabled={submitting || analyzing}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAnalyze}
              className="btn-ai-analyze"
              disabled={submitting || analyzing || !canReport || !formData.description.trim() || !formData.location.trim()}
            >
              {analyzing ? (
                <>
                  <svg className="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="2" x2="12" y2="6"></line>
                    <line x1="12" y1="18" x2="12" y2="22"></line>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                    <line x1="2" y1="12" x2="6" y2="12"></line>
                    <line x1="18" y1="12" x2="22" y2="12"></line>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                  </svg>
                  Analyzing...
                </>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                  </svg>
                  AI Analyze
                </>
              )}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting || analyzing || !canReport}
            >
              {submitting ? (
                <>
                  <svg className="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="2" x2="12" y2="6"></line>
                    <line x1="12" y1="18" x2="12" y2="22"></line>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                    <line x1="2" y1="12" x2="6" y2="12"></line>
                    <line x1="18" y1="12" x2="22" y2="12"></line>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                  </svg>
                  Submitting...
                </>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 2L11 13"></path>
                    <path d="M22 2l-7 20-4-9-9-4 20-7z"></path>
                  </svg>
                  Report Now
                </>
              )}
            </button>
          </div>
        </form>

        {/* Success Toast Notification */}
        {showSuccessToast && (
          <div className="success-toast">
            <div className="success-toast-content">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Report Incident submitted successfully!</span>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

