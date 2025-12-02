import { useState, useEffect, useCallback } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { formatTime, formatDateDisplay } from '../../../shared/date'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './WorkerAppointments.css'

interface Appointment {
  id: string
  caseId: string
  caseNumber: string
  clinicianId: string
  clinicianName: string
  teamName: string
  siteLocation: string
  appointmentDate: string
  appointmentTime: string
  durationMinutes: number
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'declined'
  appointmentType: 'consultation' | 'follow_up' | 'assessment' | 'review' | 'other'
  location: string
  notes: string
  cancellationReason: string
  createdAt: string
  updatedAt: string
}

const TYPE_LABELS: Record<string, string> = {
  consultation: 'Consultation',
  follow_up: 'Follow-up',
  assessment: 'Assessment',
  review: 'Review',
  other: 'Other',
}

export function WorkerAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(15)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'completed'>('all')
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [updating, setUpdating] = useState(false)

  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const status = statusFilter === 'all' ? 'all' : statusFilter
      const result = await apiClient.get<{
        appointments: Appointment[]
        pagination: { totalPages: number; total: number }
      }>(
        `${API_ROUTES.CHECKINS.APPOINTMENTS}?page=${currentPage}&limit=${itemsPerPage}&status=${status}&_t=${Date.now()}`,
        {
          headers: { 'Cache-Control': 'no-cache' },
        }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch appointments')
      }

      setAppointments(result.data.appointments || [])
      setTotalPages(result.data.pagination?.totalPages || 1)
      setTotalItems(result.data.pagination?.total || 0)
    } catch (err: any) {
      console.error('Error fetching appointments:', err)
      setError(err.message || 'Failed to fetch appointments')
    } finally {
      setLoading(false)
    }
  }, [currentPage, itemsPerPage, statusFilter])

  useEffect(() => {
    fetchAppointments()
  }, [fetchAppointments])

  const handleApprove = async (appointmentId: string) => {
    try {
      setUpdating(true)
      const result = await apiClient.patch<{ message: string }>(
        API_ROUTES.CHECKINS.APPOINTMENT_STATUS(appointmentId),
        { status: 'confirmed' }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to approve appointment')
      }

      fetchAppointments()
      setShowDetailModal(false)
    } catch (err: any) {
      setError(err.message || 'Failed to approve appointment')
    } finally {
      setUpdating(false)
    }
  }

  const handleDecline = async (appointmentId: string) => {
    if (!confirm('Are you sure you want to decline this appointment?')) {
      return
    }

    try {
      setUpdating(true)
      const result = await apiClient.patch<{ message: string }>(
        API_ROUTES.CHECKINS.APPOINTMENT_STATUS(appointmentId),
        { status: 'declined' }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to decline appointment')
      }

      fetchAppointments()
      setShowDetailModal(false)
    } catch (err: any) {
      setError(err.message || 'Failed to decline appointment')
    } finally {
      setUpdating(false)
    }
  }

  const formatDate = (dateStr: string) => formatDateDisplay(dateStr)

  const pendingCount = appointments.filter((apt) => apt.status === 'pending').length
  const confirmedCount = appointments.filter((apt) => apt.status === 'confirmed').length
  const completedCount = appointments.filter((apt) => apt.status === 'completed').length

  return (
    <DashboardLayout>
      <div className="worker-appointments">
        <div className="appointments-header">
          <div className="header-left">
            <h1>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              My Appointments
            </h1>
          </div>
        </div>

        {error && (
          <div className="alert alert-error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            {error}
          </div>
        )}

        <div className="status-filters">
          <button
            className={`status-filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All ({appointments.length})
          </button>
          <button
            className={`status-filter-btn ${statusFilter === 'pending' ? 'active' : ''}`}
            onClick={() => setStatusFilter('pending')}
          >
            Pending ({pendingCount})
          </button>
          <button
            className={`status-filter-btn ${statusFilter === 'confirmed' ? 'active' : ''}`}
            onClick={() => setStatusFilter('confirmed')}
          >
            Confirmed ({confirmedCount})
          </button>
          <button
            className={`status-filter-btn ${statusFilter === 'completed' ? 'active' : ''}`}
            onClick={() => setStatusFilter('completed')}
          >
            Completed ({completedCount})
          </button>
        </div>

        {loading ? (
          <Loading message="Loading appointments..." />
        ) : appointments.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </div>
            <h3>No appointments found</h3>
            <p>You don't have any appointments scheduled yet</p>
          </div>
        ) : (
          <div className="appointments-list">
            {appointments.map((appointment) => (
              <div key={appointment.id} className="appointment-card">
                <div className="appointment-header-card">
                  <div className="appointment-info">
                    <div className="clinician-info">
                      <div className="clinician-avatar">
                        {appointment.clinicianName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="clinician-name">Dr. {appointment.clinicianName}</div>
                        <div className="case-number">{appointment.caseNumber}</div>
                      </div>
                    </div>
                    <div className="appointment-time">
                      <div className="time-primary">{formatTime(appointment.appointmentTime)}</div>
                      <div className="time-secondary">{formatDate(appointment.appointmentDate)}</div>
                    </div>
                  </div>
                  <div className="appointment-actions">
                    <span className={`status-badge status-${appointment.status}`}>
                      {appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
                    </span>
                    {appointment.status === 'pending' && (
                      <>
                        <button
                          className="btn-sm btn-success"
                          onClick={() => handleApprove(appointment.id)}
                          disabled={updating}
                        >
                          Approve
                        </button>
                        <button
                          className="btn-sm btn-danger"
                          onClick={() => handleDecline(appointment.id)}
                          disabled={updating}
                        >
                          Decline
                        </button>
                      </>
                    )}
                    <button
                      className="btn-sm btn-primary"
                      onClick={() => {
                        setSelectedAppointment(appointment)
                        setShowDetailModal(true)
                      }}
                    >
                      View Details
                    </button>
                  </div>
                </div>
                <div className="appointment-details">
                  <div className="detail-item">
                    <span className="detail-label">Type:</span>
                    <span>{TYPE_LABELS[appointment.appointmentType] || appointment.appointmentType}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Duration:</span>
                    <span>{appointment.durationMinutes} minutes</span>
                  </div>
                  {appointment.location && (
                    <div className="detail-item">
                      <span className="detail-label">Location:</span>
                      <span>{appointment.location}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && appointments.length > 0 && (
          <div className="pagination">
            <div className="pagination-info">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, totalItems)} of{' '}
              {totalItems} appointments
            </div>
            <div className="pagination-controls">
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(parseInt(e.target.value))
                  setCurrentPage(1)
                }}
              >
                <option value={15}>15 per page</option>
                <option value={30}>30 per page</option>
                <option value={50}>50 per page</option>
              </select>
              <div className="pagination-buttons">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="pagination-btn"
                >
                  ««
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="pagination-btn"
                >
                  ‹
                </button>
                <span className="pagination-page">{currentPage}</span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="pagination-btn"
                >
                  ›
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="pagination-btn"
                >
                  »»
                </button>
              </div>
            </div>
          </div>
        )}

        {showDetailModal && selectedAppointment && (
          <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Appointment Details</h2>
                <button className="modal-close" onClick={() => setShowDetailModal(false)}>
                  ×
                </button>
              </div>
              <div className="modal-body">
                <div className="detail-section">
                  <div className="detail-row">
                    <span className="detail-label">Case Number:</span>
                    <span>{selectedAppointment.caseNumber}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Clinician:</span>
                    <span>Dr. {selectedAppointment.clinicianName}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Date:</span>
                    <span>{formatDate(selectedAppointment.appointmentDate)}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Time:</span>
                    <span>{formatTime(selectedAppointment.appointmentTime)}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Duration:</span>
                    <span>{selectedAppointment.durationMinutes} minutes</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Type:</span>
                    <span>{TYPE_LABELS[selectedAppointment.appointmentType] || selectedAppointment.appointmentType}</span>
                  </div>
                  {selectedAppointment.location && (
                    <div className="detail-row">
                      <span className="detail-label">Location:</span>
                      <span>{selectedAppointment.location}</span>
                    </div>
                  )}
                  {selectedAppointment.notes && (
                    <div className="detail-row">
                      <span className="detail-label">Notes:</span>
                      <span>{selectedAppointment.notes}</span>
                    </div>
                  )}
                  <div className="detail-row">
                    <span className="detail-label">Status:</span>
                    <span className={`status-badge status-${selectedAppointment.status}`}>
                      {selectedAppointment.status.charAt(0).toUpperCase() + selectedAppointment.status.slice(1)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                {selectedAppointment.status === 'pending' && (
                  <>
                    <button className="btn-secondary" onClick={() => setShowDetailModal(false)}>
                      Cancel
                    </button>
                    <button className="btn-danger" onClick={() => handleDecline(selectedAppointment.id)} disabled={updating}>
                      {updating ? 'Declining...' : 'Decline'}
                    </button>
                    <button className="btn-primary" onClick={() => handleApprove(selectedAppointment.id)} disabled={updating}>
                      {updating ? 'Approving...' : 'Approve'}
                    </button>
                  </>
                )}
                {selectedAppointment.status !== 'pending' && (
                  <button className="btn-secondary" onClick={() => setShowDetailModal(false)}>
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}

