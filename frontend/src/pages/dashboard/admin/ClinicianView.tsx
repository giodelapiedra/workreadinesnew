import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { API_BASE_URL } from '../../../config/api'
import { API_ROUTES } from '../../../config/apiRoutes'
import { formatDateDisplay, formatTime } from '../../../shared/date'
import { getUserInitials, formatUserFullName } from '../../../utils/avatarUtils'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { buildUrl } from '../../../utils/queryBuilder'
import './ClinicianView.css'

// --- Interfaces ---
interface User {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
}

interface Team {
  id: string
  name: string
  site_location?: string | null
}

interface Clinician extends User {
  active_cases: number
  total_cases: number
  upcoming_appointments: number
  total_appointments: number
  active_rehab_plans: number
  total_rehab_plans: number
}

interface Case {
  id: string
  exception_type: string
  reason: string
  start_date: string
  end_date: string | null
  is_active: boolean
  users: User | null
  teams: Team | null
}

interface Appointment {
  id: string
  appointment_date: string
  appointment_time: string
  duration_minutes: number
  status: string
  appointment_type: string
  location: string | null
  notes: string | null
  users: User | null
}

interface RehabilitationPlan {
  id: string
  plan_name: string | null
  start_date: string
  end_date: string
  status: string
  notes: string | null
  worker_exceptions: {
    users: User | null
  } | null
}

// --- Helper Functions (outside component) ---
const getInitials = (user: User) => {
  const name = user.full_name || (user.first_name && user.last_name ? `${user.first_name} ${user.last_name}` : null)
  return getUserInitials(name || undefined, user.email || undefined)
}

const formatDate = (dateString: string) => formatDateDisplay(dateString)

// Format exception type for display
const formatExceptionType = (type: string) => {
  return type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())
}

// Format status for display
const formatStatus = (status: string) => {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

// --- Generic Fetch Helper ---
const fetchData = async (url: string, errorMsg: string) => {
  const res = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: errorMsg }))
    throw new Error(data.error || errorMsg)
  }
  return res.json()
}

// --- Component ---
export function ClinicianView() {
  const { clinicianId } = useParams<{ clinicianId?: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clinicians, setClinicians] = useState<Clinician[]>([])
  const [selectedClinician, setSelectedClinician] = useState<User | null>(null)
  const [cases, setCases] = useState<Case[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [rehabPlans, setRehabPlans] = useState<RehabilitationPlan[]>([])
  const [detailsLoading, setDetailsLoading] = useState(false)
  
  // Pagination state for list view
  const [listPage, setListPage] = useState(1)
  const [listLimit] = useState(20)
  const [listPagination, setListPagination] = useState({
    total: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  })
  
  // Pagination state for detail view sections
  const [casesPage, setCasesPage] = useState(1)
  const [casesLimit] = useState(10)
  const [casesPagination, setCasesPagination] = useState({
    total: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  })
  
  const [appointmentsPage, setAppointmentsPage] = useState(1)
  const [appointmentsLimit] = useState(10)
  const [appointmentsPagination, setAppointmentsPagination] = useState({
    total: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  })
  
  const [rehabPlansPage, setRehabPlansPage] = useState(1)
  const [rehabPlansLimit] = useState(10)
  const [rehabPlansPagination, setRehabPlansPagination] = useState({
    total: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  })
  
  // Appointment filter tab
  const [appointmentFilter, setAppointmentFilter] = useState<'all' | 'upcoming' | 'pending' | 'completed' | 'cancelled'>('all')

  // --- Fetch All Clinicians ---
  const fetchClinicians = useCallback(async (page: number = listPage) => {
    try {
      setLoading(true)
      setError('')
      const url = buildUrl(API_ROUTES.ADMIN.CLINICIANS, {
        page: page.toString(),
        limit: listLimit.toString()
      })
      const data = await fetchData(`${API_BASE_URL}${url}`, 'Failed to fetch clinicians')
      setClinicians(data.clinicians || [])
      if (data.pagination) {
        setListPagination(data.pagination)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [listPage, listLimit])

  // --- Fetch Clinician Details ---
  const fetchClinicianDetails = useCallback(async () => {
    if (!clinicianId) return
    
    try {
      setDetailsLoading(true)
      setError('')
      const url = buildUrl(API_ROUTES.ADMIN.CLINICIAN(clinicianId), {
        casesPage: casesPage.toString(),
        casesLimit: casesLimit.toString(),
        appointmentsPage: appointmentsPage.toString(),
        appointmentsLimit: appointmentsLimit.toString(),
        rehabPlansPage: rehabPlansPage.toString(),
        rehabPlansLimit: rehabPlansLimit.toString()
      })
      const data = await fetchData(`${API_BASE_URL}${url}`, 'Failed to fetch clinician details')
      setSelectedClinician(data.clinician)
      setCases(data.cases || [])
      setAppointments(data.appointments || [])
      setRehabPlans(data.rehabilitation_plans || [])
      
      if (data.casesPagination) {
        setCasesPagination(data.casesPagination)
      }
      if (data.appointmentsPagination) {
        setAppointmentsPagination(data.appointmentsPagination)
      }
      if (data.rehabPlansPagination) {
        setRehabPlansPagination(data.rehabPlansPagination)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setDetailsLoading(false)
    }
  }, [clinicianId, casesPage, casesLimit, appointmentsPage, appointmentsLimit, rehabPlansPage, rehabPlansLimit])

  useEffect(() => {
    if (clinicianId) {
      // Reset detail pagination when switching to a new clinician
      setCasesPage(1)
      setAppointmentsPage(1)
      setRehabPlansPage(1)
      setAppointmentFilter('all')
      fetchClinicianDetails()
    } else {
      // Reset state when switching back to list view
      setSelectedClinician(null)
      setCases([])
      setAppointments([])
      setRehabPlans([])
      setError('')
      fetchClinicians(listPage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicianId, listPage])
  
  // Filter appointments based on selected tab
  const filteredAppointments = useMemo(() => {
    if (appointmentFilter === 'all') {
      return appointments
    }
    
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    return appointments.filter((a) => {
      if (appointmentFilter === 'upcoming') {
        const appointmentDate = new Date(a.appointment_date)
        appointmentDate.setHours(0, 0, 0, 0)
        return appointmentDate >= today && a.status !== 'cancelled' && a.status !== 'completed'
      }
      return a.status === appointmentFilter
    })
  }, [appointments, appointmentFilter])
  
  // Calculate counts for each tab
  const appointmentCounts = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const all = appointments.length
    const upcoming = appointments.filter(a => {
      const appointmentDate = new Date(a.appointment_date)
      appointmentDate.setHours(0, 0, 0, 0)
      return appointmentDate >= today && a.status !== 'cancelled' && a.status !== 'completed'
    }).length
    const pending = appointments.filter(a => a.status === 'pending').length
    const completed = appointments.filter(a => a.status === 'completed').length
    const cancelled = appointments.filter(a => a.status === 'cancelled').length
    
    return { all, upcoming, pending, completed, cancelled }
  }, [appointments])
  
  // Fetch details when pagination changes
  useEffect(() => {
    if (clinicianId) {
      fetchClinicianDetails()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casesPage, appointmentsPage, rehabPlansPage])

  // --- Navigate to Detail Page ---
  const handleClinicianClick = useCallback((id: string) => {
    navigate(`${PROTECTED_ROUTES.ADMIN.CLINICIAN_VIEW}/${id}`)
  }, [navigate])

  // --- UI ---
  // If viewing a specific clinician detail
  if (clinicianId) {
    if (detailsLoading) {
      return (
        <DashboardLayout>
          <div className="clinician-view">
            <Loading message="Loading clinician details..." size="medium" />
          </div>
        </DashboardLayout>
      )
    }

    if (!selectedClinician) {
    return (
      <DashboardLayout>
        <div className="clinician-view">
            <div className="clinician-view-error">
              <span>Clinician not found</span>
              <button onClick={() => navigate(PROTECTED_ROUTES.ADMIN.CLINICIAN_VIEW)} className="retry-button">
                Back to List
              </button>
            </div>
        </div>
      </DashboardLayout>
    )
    }

  return (
    <DashboardLayout>
      <div className="clinician-view">
        <header className="clinician-view-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
              <button
                onClick={() => navigate(PROTECTED_ROUTES.ADMIN.CLINICIAN_VIEW)}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  border: '1px solid #E2E8F0',
                  background: '#FFFFFF',
                  color: '#64748B',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#F8FAFC'
                  e.currentTarget.style.borderColor = '#CBD5E1'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#FFFFFF'
                  e.currentTarget.style.borderColor = '#E2E8F0'
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>
              <div>
                <h1 className="clinician-view-title">{formatUserFullName(selectedClinician)}</h1>
                <p className="clinician-view-subtitle">Clinician Details</p>
              </div>
            </div>
        </header>

        {error && (
          <div className="clinician-view-error">
            <span>{error}</span>
              <button onClick={fetchClinicianDetails} className="retry-button">Retry</button>
          </div>
        )}

        {!error && (
            <div className="clinician-detail-content">
              {/* Clinician Information Section */}
                    <section className="details-section clinician-info-section">
                      <h3 className="details-section-title">Clinician Information</h3>
                      <div className="clinician-info-grid">
                        <div className="clinician-info-item">
                          <div className="clinician-info-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                              <polyline points="22,6 12,13 2,6"></polyline>
                            </svg>
                          </div>
                          <div className="clinician-info-content">
                            <div className="clinician-info-label">Email Address</div>
                            <div className="clinician-info-value">{selectedClinician.email}</div>
                          </div>
                        </div>
                        <div className="clinician-info-item">
                          <div className="clinician-info-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                              <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                          </div>
                          <div className="clinician-info-content">
                            <div className="clinician-info-label">Full Name</div>
                            <div className="clinician-info-value">{formatUserFullName(selectedClinician)}</div>
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* Cases Section */}
                    <section className="details-section">
                      <div className="details-section-header">
                        <h3 className="details-section-title">Cases</h3>
                        <span className="details-section-count">{cases.length}</span>
                      </div>
                      {cases.length > 0 ? (
                        <div className="cases-list">
                          {cases.map((x) => (
                            <div key={x.id} className="case-card">
                              <div className="case-card-header">
                          <h4 className="case-type">{formatExceptionType(x.exception_type)}</h4>
                                <span className={`case-status ${x.is_active ? 'active' : 'closed'}`}>
                                  {x.is_active ? 'Active' : 'Closed'}
                                </span>
                              </div>
                              {x.users && (
                                <p className="case-worker"><strong>Worker:</strong> {formatUserFullName(x.users)}</p>
                              )}
                              {x.teams && (
                                <p className="case-team"><strong>Team:</strong> {x.teams.name} {x.teams.site_location && `(${x.teams.site_location})`}</p>
                              )}
                              <p className="case-reason"><strong>Reason:</strong> {x.reason}</p>
                              <div className="case-dates">
                                <span><strong>Start:</strong> {formatDate(x.start_date)}</span>
                                {x.end_date && <span><strong>End:</strong> {formatDate(x.end_date)}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="details-empty">No cases assigned to this clinician</div>
                      )}
                {cases.length > 0 && casesPagination.totalPages > 1 && (
                  <div className="clinician-view-pagination-controls">
                    <span className="clinician-view-pagination-info">
                      Page {casesPage} of {casesPagination.totalPages}
                    </span>
                    <button 
                      className="clinician-view-pagination-btn"
                      disabled={casesPage === 1}
                      onClick={() => setCasesPage(prev => Math.max(1, prev - 1))}
                      title="Previous page"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="15 18 9 12 15 6"></polyline>
                      </svg>
                    </button>
                    <button 
                      className="clinician-view-pagination-btn"
                      disabled={casesPage >= casesPagination.totalPages}
                      onClick={() => setCasesPage(prev => Math.min(casesPagination.totalPages, prev + 1))}
                      title="Next page"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </button>
                  </div>
                      )}
                    </section>

                    {/* Appointments Section */}
                    <section className="details-section">
                      <div className="details-section-header">
                  <h3 className="details-section-title">Appointment Schedule</h3>
                        <span className="details-section-count">{appointments.length}</span>
                      </div>
                
                {/* Appointment Tabs - Integrated in section */}
                <div className="appointment-tabs-container">
                  <div className="appointment-tabs">
                    <button
                      className={`appointment-tab ${appointmentFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setAppointmentFilter('all')}
                    >
                      All ({appointmentCounts.all})
                    </button>
                    <button
                      className={`appointment-tab ${appointmentFilter === 'upcoming' ? 'active' : ''}`}
                      onClick={() => setAppointmentFilter('upcoming')}
                    >
                      Upcoming ({appointmentCounts.upcoming})
                    </button>
                    <button
                      className={`appointment-tab ${appointmentFilter === 'pending' ? 'active' : ''}`}
                      onClick={() => setAppointmentFilter('pending')}
                    >
                      Pending ({appointmentCounts.pending})
                    </button>
                    <button
                      className={`appointment-tab ${appointmentFilter === 'completed' ? 'active' : ''}`}
                      onClick={() => setAppointmentFilter('completed')}
                    >
                      Completed ({appointmentCounts.completed})
                    </button>
                    {appointmentCounts.cancelled > 0 && (
                      <button
                        className={`appointment-tab ${appointmentFilter === 'cancelled' ? 'active' : ''}`}
                        onClick={() => setAppointmentFilter('cancelled')}
                      >
                        Cancelled ({appointmentCounts.cancelled})
                      </button>
                    )}
                  </div>
                </div>
                
                {filteredAppointments.length > 0 ? (
                        <div className="appointments-list">
                    {filteredAppointments.map((a) => (
                            <div key={a.id} className="appointment-card">
                              <div className="appointment-card-header">
                                <div>
                                  <h4 className="appointment-date">{formatDate(a.appointment_date)}</h4>
                                  <p className="appointment-time">{formatTime(a.appointment_time)} • {a.duration_minutes} minutes</p>
                                </div>
                                <span className={`appointment-status ${a.status}`}>
                            {formatStatus(a.status)}
                                </span>
                              </div>
                              {a.users && (
                                <p className="appointment-worker"><strong>Worker:</strong> {formatUserFullName(a.users)}</p>
                              )}
                              {a.appointment_type && (
                          <p className="appointment-type"><strong>Type:</strong> {formatExceptionType(a.appointment_type)}</p>
                              )}
                              {a.location && (
                                <p className="appointment-location"><strong>Location:</strong> {a.location}</p>
                              )}
                              {a.notes && (
                                <p className="appointment-notes"><strong>Notes:</strong> {a.notes}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                  <div className="details-empty">
                    {appointmentFilter === 'all' 
                      ? 'No appointments scheduled' 
                      : `No ${appointmentFilter} appointments`}
                  </div>
                )}
                {filteredAppointments.length > 0 && appointmentsPagination.totalPages > 1 && (
                  <div className="clinician-view-pagination-controls">
                    <span className="clinician-view-pagination-info">
                      Page {appointmentsPage} of {appointmentsPagination.totalPages}
                    </span>
                    <button 
                      className="clinician-view-pagination-btn"
                      disabled={appointmentsPage === 1}
                      onClick={() => setAppointmentsPage(prev => Math.max(1, prev - 1))}
                      title="Previous page"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="15 18 9 12 15 6"></polyline>
                      </svg>
                    </button>
                    <button 
                      className="clinician-view-pagination-btn"
                      disabled={appointmentsPage >= appointmentsPagination.totalPages}
                      onClick={() => setAppointmentsPage(prev => Math.min(appointmentsPagination.totalPages, prev + 1))}
                      title="Next page"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </button>
                  </div>
                      )}
                    </section>

                    {/* Rehabilitation Plans Section */}
                    <section className="details-section">
                      <div className="details-section-header">
                        <h3 className="details-section-title">Rehabilitation Plans</h3>
                        <span className="details-section-count">{rehabPlans.length}</span>
                      </div>
                      {rehabPlans.length > 0 ? (
                        <div className="rehab-plans-list">
                          {rehabPlans.map((p) => (
                            <div key={p.id} className="rehab-plan-card">
                              <div className="rehab-plan-card-header">
                                <h4 className="rehab-plan-name">{p.plan_name || 'Rehabilitation Plan'}</h4>
                                <span className={`rehab-plan-status ${p.status}`}>
                            {formatStatus(p.status)}
                                </span>
                              </div>
                              {p.worker_exceptions?.users && (
                                <p className="rehab-plan-worker"><strong>Worker:</strong> {formatUserFullName(p.worker_exceptions.users)}</p>
                              )}
                              <div className="rehab-plan-dates">
                                <span><strong>Start:</strong> {formatDate(p.start_date)}</span>
                                <span><strong>End:</strong> {formatDate(p.end_date)}</span>
                              </div>
                              {p.notes && (
                                <p className="rehab-plan-notes"><strong>Notes:</strong> {p.notes}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="details-empty">No rehabilitation plans created</div>
                      )}
                {rehabPlans.length > 0 && rehabPlansPagination.totalPages > 1 && (
                  <div className="clinician-view-pagination-controls">
                    <span className="clinician-view-pagination-info">
                      Page {rehabPlansPage} of {rehabPlansPagination.totalPages}
                    </span>
                    <button 
                      className="clinician-view-pagination-btn"
                      disabled={rehabPlansPage === 1}
                      onClick={() => setRehabPlansPage(prev => Math.max(1, prev - 1))}
                      title="Previous page"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="15 18 9 12 15 6"></polyline>
                      </svg>
                    </button>
                    <button 
                      className="clinician-view-pagination-btn"
                      disabled={rehabPlansPage >= rehabPlansPagination.totalPages}
                      onClick={() => setRehabPlansPage(prev => Math.min(rehabPlansPagination.totalPages, prev + 1))}
                      title="Next page"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </button>
                  </div>
                      )}
                    </section>
          </div>
        )}
        </div>
      </DashboardLayout>
    )
  }

  // List view (no clinicianId)
  if (loading)
    return (
      <DashboardLayout>
        <div className="clinician-view">
          <Loading message="Loading clinicians..." size="medium" />
        </div>
      </DashboardLayout>
    )

  return (
    <DashboardLayout>
      <div className="clinician-view">
        <header className="clinician-view-header">
          <h1 className="clinician-view-title">Clinician View</h1>
          <p className="clinician-view-subtitle">All Clinicians Overview</p>
        </header>

        {error && (
          <div className="clinician-view-error">
            <span>{error}</span>
            <button onClick={() => fetchClinicians(listPage)} className="retry-button">Retry</button>
          </div>
        )}

        {!error && (
          clinicians.length === 0 ? (
            <div className="clinician-view-empty"><p>No clinicians found</p></div>
          ) : (
            <div className="clinicians-grid">
              {clinicians.map((c) => (
                <div 
                  key={c.id} 
                  className="clinician-card" 
                  onClick={() => handleClinicianClick(c.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleClinicianClick(c.id)
                    }
                  }}
                  aria-label={`View details for ${formatUserFullName(c)}`}
                >
                  <div className="clinician-card-header">
                    <div className="clinician-avatar">{getInitials(c)}</div>
                    <div className="clinician-card-info">
                      <h3 className="clinician-card-name">{formatUserFullName(c)}</h3>
                      <p className="clinician-card-role">Clinician</p>
                    </div>
                    <div className="clinician-card-arrow">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                      </svg>
                    </div>
                  </div>
                  <p className="clinician-email">{c.email}</p>
                  <div className="clinician-stats">
                    <div className="clinician-stat-item">
                      <strong>Cases</strong>
                      <div>{c.total_cases}</div>
                      {c.active_cases > 0 && (
                        <span className="stat-badge active">{c.active_cases} active</span>
                      )}
                    </div>
                    <div className="clinician-stat-item">
                      <strong>Appointments</strong>
                      <div>{c.total_appointments}</div>
                      {c.upcoming_appointments > 0 && (
                        <span className="stat-badge upcoming">{c.upcoming_appointments} upcoming</span>
                      )}
                    </div>
                    <div className="clinician-stat-item">
                      <strong>Rehab Plans</strong>
                      <div>{c.total_rehab_plans}</div>
                      {c.active_rehab_plans > 0 && (
                        <span className="stat-badge active">{c.active_rehab_plans} active</span>
                      )}
                    </div>
                  </div>
                  <div className="clinician-card-footer">
                    <span className="clinician-view-details">View Details</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        
        {!error && clinicians.length > 0 && listPagination.totalPages > 1 && (
          <div className="clinician-view-pagination-controls" style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid #E2E8F0' }}>
            <span className="clinician-view-pagination-info">
              {listPagination.total > 0 ? `${(listPage - 1) * listLimit + 1}-${Math.min(listPage * listLimit, listPagination.total)} of ${listPagination.total}` : '0 clinicians'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button 
                className="clinician-view-pagination-btn"
                disabled={listPage === 1}
                onClick={() => {
                  setListPage(prev => Math.max(1, prev - 1))
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                title="Previous page"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
              <span className="clinician-view-page-number">
                Page {listPage} of {listPagination.totalPages}
              </span>
              <button 
                className="clinician-view-pagination-btn"
                disabled={listPage >= listPagination.totalPages}
                onClick={() => {
                  setListPage(prev => Math.min(listPagination.totalPages, prev + 1))
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                title="Next page"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  )
}
