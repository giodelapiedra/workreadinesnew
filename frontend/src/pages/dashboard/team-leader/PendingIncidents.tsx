import { useState, useEffect } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { Avatar } from '../../../components/Avatar'
import { IncidentPhoto, AiAnalysis } from '../../../components/incident'
import { formatDateDisplay } from '../../../shared/date'
import { calculateAge } from '../../../shared/date'
import './PendingIncidents.css'

interface PendingIncident {
  id: string
  incident_type: string
  incident_date: string
  description: string
  severity: string
  photo_url: string | null
  ai_analysis_result: any
  created_at: string
  approval_status: 'pending_approval' | 'approved' | 'rejected'
  users: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    full_name: string | null
    gender: string | null
    date_of_birth: string | null
    profile_image_url: string | null
  }
}

interface PendingIncidentsProps {
  onApprovalComplete?: () => void
}

type TabType = 'pending' | 'approved' | 'rejected'

export function PendingIncidents({ onApprovalComplete }: PendingIncidentsProps) {
  const [activeTab, setActiveTab] = useState<TabType>('pending')
  const [incidents, setIncidents] = useState<PendingIncident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedIncident, setSelectedIncident] = useState<PendingIncident | null>(null)
  const [showViewModal, setShowViewModal] = useState(false)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [approvalNotes, setApprovalNotes] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [processing, setProcessing] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    fetchIncidents()
  }, [activeTab])

  const fetchIncidents = async () => {
    try {
      setLoading(true)
      setError('')

      // Fetch incidents based on active tab
      const endpoint = `/api/teams/incidents?status=${activeTab}`
      
      const result = await apiClient.get<{
        success: boolean
        incidents: PendingIncident[]
      }>(endpoint)

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result))
      }

      setIncidents(result.data.incidents || [])
    } catch (err: any) {
      setError(err.message || `Failed to fetch ${activeTab} incidents`)
    } finally {
      setLoading(false)
    }
  }

  const handleViewClick = (incident: PendingIncident) => {
    setSelectedIncident(incident)
    setShowViewModal(true)
  }

  const handleApproveClick = (incident: PendingIncident) => {
    setSelectedIncident(incident)
    setApprovalNotes('')
    setShowApproveModal(true)
  }

  const handleRejectClick = (incident: PendingIncident) => {
    setSelectedIncident(incident)
    setRejectionReason('')
    setShowRejectModal(true)
  }

  const handleApprove = async () => {
    if (!selectedIncident) return

    try {
      setProcessing(true)
      setError('')

      const result = await apiClient.post(
        `/api/teams/approve-incident/${selectedIncident.id}`,
        { notes: approvalNotes.trim() || null }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result))
      }

      // Refresh list
      await fetchIncidents()
      setShowApproveModal(false)
      setSelectedIncident(null)
      setApprovalNotes('')
      
      // Show success message
      setSuccessMessage('Incident approved successfully! Worker has been notified.')
      setTimeout(() => setSuccessMessage(''), 5000)

      if (onApprovalComplete) {
        onApprovalComplete()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to approve incident')
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!selectedIncident) return

    if (!rejectionReason.trim()) {
      setError('Rejection reason is required')
      return
    }

    try {
      setProcessing(true)
      setError('')

      const result = await apiClient.post(
        `/api/teams/reject-incident/${selectedIncident.id}`,
        { rejectionReason: rejectionReason.trim() }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result))
      }

      // Refresh list
      await fetchIncidents()
      setShowRejectModal(false)
      setSelectedIncident(null)
      setRejectionReason('')
      
      // Show success message
      setSuccessMessage('Incident rejected successfully! Worker has been notified.')
      setTimeout(() => setSuccessMessage(''), 5000)

      if (onApprovalComplete) {
        onApprovalComplete()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reject incident')
    } finally {
      setProcessing(false)
    }
  }

  const getSeverityClass = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'critical':
        return 'severity-critical'
      case 'high':
        return 'severity-high'
      case 'medium':
        return 'severity-medium'
      case 'low':
        return 'severity-low'
      default:
        return ''
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="pending-incidents-page">
          <div className="page-header">
            <h1 className="page-title">Pending Incident Approvals</h1>
          </div>
          <div className="loading-message">Loading pending incidents...</div>
        </div>
      </DashboardLayout>
    )
  }

  if (error && incidents.length === 0) {
    return (
      <DashboardLayout>
        <div className="pending-incidents-page">
          <div className="page-header">
            <h1 className="page-title">Pending Incident Approvals</h1>
          </div>
          <div className="error-message">{error}</div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="pending-incidents-page">
        <div className="page-header">
          <div className="page-header-content">
            <h1 className="page-title">Incident Approvals</h1>
            {incidents.length > 0 && (
              <span className="incident-count-badge">{incidents.length}</span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs-container">
          <button
            className={`tab-button ${activeTab === 'pending' ? 'active' : ''}`}
            onClick={() => setActiveTab('pending')}
          >
            Pending
          </button>
          <button
            className={`tab-button ${activeTab === 'approved' ? 'active' : ''}`}
            onClick={() => setActiveTab('approved')}
          >
            Approved
          </button>
          <button
            className={`tab-button ${activeTab === 'rejected' ? 'active' : ''}`}
            onClick={() => setActiveTab('rejected')}
          >
            Rejected
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}
        
        {successMessage && (
          <div className="success-message">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span>{successMessage}</span>
          </div>
        )}

          {incidents.length === 0 ? (
            <div className="empty-state">
              <p>No {activeTab} incidents.</p>
              <span className="empty-state-subtitle">
                {activeTab === 'pending' && 'All incidents have been processed'}
                {activeTab === 'approved' && 'No approved incidents yet'}
                {activeTab === 'rejected' && 'No rejected incidents yet'}
              </span>
            </div>
          ) : (
            <div className="table-container">
              <table className="incidents-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Created Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((incident) => {
                    const worker = incident.users
                    const workerName = worker?.full_name || 
                                      (worker?.first_name && worker?.last_name 
                                        ? `${worker.first_name} ${worker.last_name}`
                                        : worker?.email || 'Unknown Worker')

                    return (
                      <tr key={incident.id}>
                        <td>
                          <div className="worker-cell">
                            <Avatar
                              userId={worker?.id}
                              profileImageUrl={worker?.profile_image_url}
                              firstName={worker?.first_name}
                              lastName={worker?.last_name}
                              fullName={worker?.full_name}
                              email={worker?.email}
                              size="sm"
                            />
                            <span className="worker-name">{workerName}</span>
                          </div>
                        </td>
                        <td>
                          <span className="type-badge">
                            {incident.incident_type === 'incident' ? 'Incident' : 'Near-Miss'}
                          </span>
                        </td>
                        <td className="subject-cell">
                          Approval Required - {incident.severity.toUpperCase()}
                        </td>
                        <td>
                          {activeTab === 'pending' && <span className="status-badge status-pending">Pending</span>}
                          {activeTab === 'approved' && <span className="status-badge status-approved">Approved</span>}
                          {activeTab === 'rejected' && <span className="status-badge status-rejected">Rejected</span>}
                        </td>
                        <td className="date-cell">
                          {formatDateDisplay(incident.created_at)}
                        </td>
                        <td>
                          <div className="actions-cell">
                            <button
                              className="action-btn action-view"
                              onClick={() => handleViewClick(incident)}
                              title="View Details"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>
                            
                            {/* Only show approve/reject buttons for pending incidents */}
                            {activeTab === 'pending' && (
                              <>
                                <button
                                  className="action-btn action-approve"
                                  onClick={() => handleApproveClick(incident)}
                                  title="Approve"
                                >
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                </button>
                                <button
                                  className="action-btn action-reject"
                                  onClick={() => handleRejectClick(incident)}
                                  title="Reject"
                                >
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                  </svg>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* View Detail Modal */}
          {showViewModal && selectedIncident && (
            <div className="modal-overlay" onClick={() => setShowViewModal(false)}>
              <div className="modal-container modal-large" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Incident Detail</h3>
                  <button 
                    className="modal-close" 
                    onClick={() => setShowViewModal(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="modal-body">
                  {(() => {
                    const worker = selectedIncident.users
                    const workerName = worker?.full_name || 
                                      (worker?.first_name && worker?.last_name 
                                        ? `${worker.first_name} ${worker.last_name}`
                                        : worker?.email || 'Unknown Worker')
                    const age = worker?.date_of_birth ? calculateAge(worker.date_of_birth) : null

                    return (
                      <>
                        <div className="detail-section">
                          <h4>Worker Information</h4>
                          <div className="detail-grid">
                            <div className="detail-item">
                              <span className="detail-label">Name</span>
                              <span className="detail-value">{workerName}</span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-label">Email</span>
                              <span className="detail-value">{worker?.email}</span>
                            </div>
                            {age && (
                              <div className="detail-item">
                                <span className="detail-label">Age</span>
                                <span className="detail-value">{age} years</span>
                              </div>
                            )}
                            {worker?.gender && (
                              <div className="detail-item">
                                <span className="detail-label">Gender</span>
                                <span className="detail-value">{worker.gender === 'male' ? 'Male' : 'Female'}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="detail-section">
                          <h4>Incident Information</h4>
                          <div className="detail-grid">
                            <div className="detail-item">
                              <span className="detail-label">Type</span>
                              <span className="detail-value">
                                {selectedIncident.incident_type === 'incident' ? 'Incident' : 'Near-Miss'}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-label">Severity</span>
                              <span className={`severity-badge ${getSeverityClass(selectedIncident.severity)}`}>
                                {selectedIncident.severity.toUpperCase()}
                              </span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-label">Date</span>
                              <span className="detail-value">{formatDateDisplay(selectedIncident.incident_date)}</span>
                            </div>
                          </div>
                          <div className="detail-item detail-full">
                            <span className="detail-label">Description</span>
                            <p className="detail-description">{selectedIncident.description}</p>
                          </div>
                        </div>

                        {selectedIncident.photo_url && (
                          <div className="detail-section">
                            <h4>Incident Photo</h4>
                            <IncidentPhoto 
                              photoUrl={selectedIncident.photo_url} 
                            />
                          </div>
                        )}

                        {selectedIncident.ai_analysis_result && (
                          <div className="detail-section">
                            <h4>AI Analysis</h4>
                            <AiAnalysis analysis={selectedIncident.ai_analysis_result} />
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
                <div className="modal-footer">
                  <button
                    className="btn-secondary"
                    onClick={() => setShowViewModal(false)}
                  >
                    Close
                  </button>
                  {/* Only show action buttons for pending incidents */}
                  {selectedIncident.approval_status === 'pending_approval' && (
                    <>
                      <button
                        className="btn-primary"
                        onClick={() => {
                          setShowViewModal(false)
                          handleApproveClick(selectedIncident)
                        }}
                      >
                        Approve
                      </button>
                      <button
                        className="btn-danger"
                        onClick={() => {
                          setShowViewModal(false)
                          handleRejectClick(selectedIncident)
                        }}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {/* Show status badge for non-pending incidents */}
                  {selectedIncident.approval_status === 'approved' && (
                    <div className="status-badge status-approved">
                      Already Approved
                    </div>
                  )}
                  {selectedIncident.approval_status === 'rejected' && (
                    <div className="status-badge status-rejected">
                      Already Rejected
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Approve Modal */}
      {showApproveModal && selectedIncident && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h3>Approve Incident Report</h3>
              <button 
                className="modal-close" 
                onClick={() => setShowApproveModal(false)}
                disabled={processing}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                You are about to approve this incident report and create an exception for the worker.
                This will:
              </p>
              <ul className="approval-effects">
                <li>Create a worker exception</li>
                <li>Deactivate their active schedules</li>
                <li>Notify the worker and supervisor</li>
                <li>Start the WHS workflow</li>
              </ul>

              <div className="form-group">
                <label htmlFor="approval-notes">Additional Notes (Optional)</label>
                <textarea
                  id="approval-notes"
                  className="form-textarea"
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Add any notes about the approval..."
                  rows={4}
                  disabled={processing}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowApproveModal(false)}
                disabled={processing}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleApprove}
                disabled={processing}
              >
                {processing ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && selectedIncident && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h3>Reject Incident Report</h3>
              <button 
                className="modal-close" 
                onClick={() => setShowRejectModal(false)}
                disabled={processing}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                Please provide a reason for rejecting this incident report.
                The worker will be notified of your decision.
              </p>

              <div className="form-group">
                <label htmlFor="rejection-reason">Rejection Reason *</label>
                <textarea
                  id="rejection-reason"
                  className="form-textarea"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Explain why this incident is being rejected..."
                  rows={4}
                  required
                  disabled={processing}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowRejectModal(false)}
                disabled={processing}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={handleReject}
                disabled={processing || !rejectionReason.trim()}
              >
                {processing ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </DashboardLayout>
  )
}

