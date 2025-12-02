import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { escapeHtml } from '../../../utils/apiHelpers'
import { formatDutyTypeLabel, getDutyTypeColor } from '../../../utils/dutyTypeUtils'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { IncidentPhoto, AiAnalysis } from '../../../components/incident'
import type { AiAnalysisResult } from '../../../components/incident/types'
import '../clinician/CaseDetail.css'

type CaseStatus = 'new' | 'triaged' | 'assessed' | 'in_rehab' | 'return_to_work' | 'closed'

const STATUS_STAGES: { key: CaseStatus; label: string; icon: React.ReactElement }[] = [
  { 
    key: 'new', 
    label: 'NEW', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="5" x2="18" y2="3"></line>
        <line x1="18" y1="5" x2="16" y2="3"></line>
      </svg>
    )
  },
  { 
    key: 'triaged', 
    label: 'TRIAGED', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
      </svg>
    )
  },
  { 
    key: 'assessed', 
    label: 'ASSESSED', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    )
  },
  { 
    key: 'in_rehab', 
    label: 'IN REHAB', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
      </svg>
    )
  },
  { 
    key: 'return_to_work', 
    label: 'RETURN TO WORK', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
    )
  },
  { 
    key: 'closed', 
    label: 'CLOSED', 
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    )
  },
]

const STATUS_ORDER: CaseStatus[] = ['new', 'triaged', 'assessed', 'in_rehab', 'return_to_work', 'closed']

interface IncidentDetail {
  id: string
  workerId: string
  workerName: string
  workerEmail: string
  workerGender?: string | null
  workerAge?: number | null
  teamId: string
  teamName: string
  siteLocation: string | null
  type: string
  reason: string
  startDate: string
  endDate: string | null
  isActive: boolean
  assignedToWhs: boolean
  clinicianId: string | null
  caseStatus: string | null
  statusCategory: 'in_progress' | 'rehabilitation' | 'completed'
  approvedByClinician: string | null
  approvedAt: string | null
  whsApprovedBy: string | null
  whsApprovedAt: string | null
  returnToWorkDutyType: string | null
  returnToWorkDate: string | null
  clinicalNotes: string | null
  clinicalNotesUpdatedAt: string | null
  photoUrl: string | null
  aiAnalysisResult: {
    summary?: string
    riskLevel?: string
    recommendations?: string[]
    severityAssessment?: string
    followUpActions?: string[]
    advice?: string
    imageAnalysis?: string
  } | null
  createdAt: string
  updatedAt: string
}

const Icons = {
  CloseIcon: ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  ),
  PrintIcon: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 6 2 18 2 18 9"></polyline>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
      <rect x="6" y="14" width="12" height="8"></rect>
    </svg>
  ),
  UserIcon: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  ),
}

const getTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    injury: 'Injury / Medical',
    medical_leave: 'Sick Leave',
    accident: 'On Leave / RDO',
    transfer: 'Transferred',
    other: 'Not Rostered',
  }
  return labels[type] || type
}

const getCaseStatusLabel = (caseStatus: string | null) => {
  if (!caseStatus) return 'New'
  const labels: Record<string, string> = {
    new: 'New',
    triaged: 'Triaged',
    assessed: 'Assessed',
    in_rehab: 'In Rehabilitation',
    return_to_work: 'Return to Work',
    closed: 'Closed',
  }
  return labels[caseStatus] || caseStatus
}

// Removed: Using shared utility from dutyTypeUtils.ts

const getStatusColor = (statusCategory: string, caseStatus: string | null) => {
  if (statusCategory === 'completed') return '#6B7280'
  if (statusCategory === 'rehabilitation') return '#14B8A6'
  if (caseStatus === 'new' || !caseStatus) return '#EF4444'
  return '#3B82F6'
}

const getSeverity = (type: string) => {
  if (type === 'injury') return { level: 'Emergency', icon: '🔴', color: '#EF4444' }
  if (type === 'accident') return { level: 'High', icon: '🔴', color: '#EF4444' }
  if (type === 'medical_leave') return { level: 'Medium', icon: '🟠', color: '#F59E0B' }
  return { level: 'Low', icon: '🔵', color: '#3B82F6' }
}

const getStatusIndex = (status: CaseStatus | null): number => {
  if (!status) return 0
  return STATUS_ORDER.indexOf(status)
}

export function IncidentDetail() {
  const { incidentId } = useParams<{ incidentId: string }>()
  const navigate = useNavigate()
  const [incidentDetail, setIncidentDetail] = useState<IncidentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (incidentId) {
      fetchIncidentDetail()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId])

  const fetchIncidentDetail = async () => {
    if (!incidentId) return

    try {
      setLoading(true)
      setError('')

      // Fetch all incidents and filter by ID
      // Note: In production, you might want to create a dedicated endpoint for single incident
      const today = new Date()
      const defaultStartDate = new Date(today.getFullYear(), today.getMonth() - 6, 1)
      const startDate = defaultStartDate.toISOString().split('T')[0]
      const endDate = today.toISOString().split('T')[0]

      const params = new URLSearchParams({
        startDate,
        endDate,
      })

      const result = await apiClient.get<{ incidents: any }>(
        `${API_ROUTES.SUPERVISOR.MY_INCIDENTS}?${params.toString()}`
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch incident details')
      }

      const data = result.data
      const allIncidents = [
        ...(data.incidents?.in_progress || []),
        ...(data.incidents?.rehabilitation || []),
        ...(data.incidents?.completed || []),
      ]

      const incident = allIncidents.find((inc: IncidentDetail) => inc.id === incidentId)

      if (!incident) {
        throw new Error('Incident not found')
      }

      setIncidentDetail(incident)
    } catch (err: any) {
      console.error('Error fetching incident detail:', err)
      setError(err.message || 'Failed to load incident details')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    })
  }

  const formatDateLong = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const handlePrint = () => {
    if (!incidentDetail) return

    const printWindow = window.open('', '_blank', 'width=800,height=600')
    if (!printWindow) {
      alert('Please allow popups to print this document')
      return
    }

    const printDate = new Date().toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    const severity = getSeverity(incidentDetail.type)
    const statusLabel = getCaseStatusLabel(incidentDetail.caseStatus)
    const typeLabel = getTypeLabel(incidentDetail.type)
    const reference = `#${incidentDetail.id.substring(0, 8).toUpperCase()}`

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Incident Details - ${reference}</title>
          <style>
            @media print {
              @page {
                margin: 1cm;
              }
            }
            body {
              font-family: Arial, sans-serif;
              padding: 20px;
              color: #000;
            }
            .print-header {
              border-bottom: 2px solid #000;
              padding-bottom: 10px;
              margin-bottom: 20px;
            }
            .print-header h1 {
              margin: 0 0 5px 0;
              font-size: 24px;
            }
            .print-header p {
              margin: 0;
              color: #666;
              font-size: 12px;
            }
            .print-section {
              margin-bottom: 25px;
              page-break-inside: avoid;
            }
            .print-section h2 {
              font-size: 16px;
              margin: 0 0 10px 0;
              padding-bottom: 5px;
              border-bottom: 1px solid #ccc;
              text-transform: uppercase;
            }
            .print-row {
              display: flex;
              padding: 8px 0;
              border-bottom: 1px solid #eee;
            }
            .print-label {
              font-weight: bold;
              width: 180px;
              color: #333;
            }
            .print-value {
              flex: 1;
              color: #000;
            }
            .print-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 30px;
              margin-bottom: 20px;
            }
          </style>
        </head>
        <body>
          <div class="print-header">
            <h1>Incident Details</h1>
            <p>Printed on: ${printDate}</p>
          </div>

          <div class="print-grid">
            <div>
              <div class="print-section">
                <h2>Incident Information</h2>
                <div class="print-row">
                  <span class="print-label">Reference:</span>
                  <span class="print-value">${escapeHtml(reference)}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Status:</span>
                  <span class="print-value">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Type:</span>
                  <span class="print-value">${escapeHtml(typeLabel)}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Severity:</span>
                  <span class="print-value">${escapeHtml(severity.level)}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Start Date:</span>
                  <span class="print-value">${escapeHtml(formatDate(incidentDetail.startDate))}</span>
                </div>
                ${incidentDetail.endDate ? `
                <div class="print-row">
                  <span class="print-label">End Date:</span>
                  <span class="print-value">${escapeHtml(formatDate(incidentDetail.endDate))}</span>
                </div>
                ` : ''}
                <div class="print-row">
                  <span class="print-label">Created:</span>
                  <span class="print-value">${escapeHtml(formatDate(incidentDetail.createdAt))}</span>
                </div>
                ${incidentDetail.approvedByClinician ? `
                <div class="print-row">
                  <span class="print-label">Approved by:</span>
                  <span class="print-value">${escapeHtml(incidentDetail.approvedByClinician)}</span>
                </div>
                ` : ''}
                ${incidentDetail.approvedAt ? `
                <div class="print-row">
                  <span class="print-label">Approved at:</span>
                  <span class="print-value">${escapeHtml(formatDate(incidentDetail.approvedAt))}</span>
                </div>
                ` : ''}
                ${incidentDetail.returnToWorkDutyType ? `
                <div class="print-row">
                  <span class="print-label">Return to Work Duty Type:</span>
                  <span class="print-value">${escapeHtml(formatDutyTypeLabel(incidentDetail.returnToWorkDutyType))}</span>
                </div>
                ` : ''}
                ${incidentDetail.returnToWorkDate ? `
                <div class="print-row">
                  <span class="print-label">Return to Work Date:</span>
                  <span class="print-value">${escapeHtml(formatDate(incidentDetail.returnToWorkDate))}</span>
                </div>
                ` : ''}
              </div>

              <div class="print-section">
                <h2>Incident Details</h2>
                <div class="print-row">
                  <span class="print-label">Reason:</span>
                  <span class="print-value">${escapeHtml(incidentDetail.reason || 'No reason provided')}</span>
                </div>
              </div>
            </div>

            <div>
              <div class="print-section">
                <h2>Worker Information</h2>
                <div class="print-row">
                  <span class="print-label">Name:</span>
                  <span class="print-value">${escapeHtml(incidentDetail.workerName)}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Email:</span>
                  <span class="print-value">${escapeHtml(incidentDetail.workerEmail)}</span>
                </div>
                ${incidentDetail.workerGender ? `
                <div class="print-row">
                  <span class="print-label">Gender:</span>
                  <span class="print-value">${escapeHtml(incidentDetail.workerGender.charAt(0).toUpperCase() + incidentDetail.workerGender.slice(1))}</span>
                </div>
                ` : ''}
                ${incidentDetail.workerAge !== null && incidentDetail.workerAge !== undefined ? `
                <div class="print-row">
                  <span class="print-label">Age:</span>
                  <span class="print-value">${escapeHtml(String(incidentDetail.workerAge))} years old</span>
                </div>
                ` : ''}
                <div class="print-row">
                  <span class="print-label">Team:</span>
                  <span class="print-value">${escapeHtml(incidentDetail.teamName)}</span>
                </div>
                ${incidentDetail.siteLocation ? `
                <div class="print-row">
                  <span class="print-label">Site Location:</span>
                  <span class="print-value">${escapeHtml(incidentDetail.siteLocation)}</span>
                </div>
                ` : ''}
              </div>

              <div class="print-section">
                <h2>Assignment Information</h2>
                ${incidentDetail.assignedToWhs ? `
                <div class="print-row">
                  <span class="print-label">Assigned to WHS:</span>
                  <span class="print-value">Yes</span>
                </div>
                ` : ''}
                ${incidentDetail.whsApprovedBy ? `
                <div class="print-row">
                  <span class="print-label">Approved by WHS:</span>
                  <span class="print-value">${escapeHtml(incidentDetail.whsApprovedBy)}</span>
                </div>
                ` : ''}
                ${incidentDetail.whsApprovedAt ? `
                <div class="print-row">
                  <span class="print-label">WHS Approved At:</span>
                  <span class="print-value">${escapeHtml(formatDate(incidentDetail.whsApprovedAt))}</span>
                </div>
                ` : ''}
                ${incidentDetail.approvedByClinician ? `
                <div class="print-row">
                  <span class="print-label">Approved by Clinician:</span>
                  <span class="print-value">${escapeHtml(incidentDetail.approvedByClinician)}</span>
                </div>
                ` : ''}
                ${incidentDetail.approvedAt ? `
                <div class="print-row">
                  <span class="print-label">Clinician Approved At:</span>
                  <span class="print-value">${escapeHtml(formatDate(incidentDetail.approvedAt))}</span>
                </div>
                ` : ''}
              </div>
            </div>
          </div>
        </body>
      </html>
    `

    printWindow.document.open()
    printWindow.document.write(printContent)
    printWindow.document.close()

    setTimeout(() => {
      printWindow.focus()
      printWindow.print()
    }, 500)
  }

  if (!incidentId) {
    return (
      <DashboardLayout>
        <div className="case-detail-page-container">
          <div className="case-detail-error">
            <p>Incident ID is required</p>
            <button onClick={() => navigate(PROTECTED_ROUTES.SUPERVISOR.MY_INCIDENTS)}>
              Back to My Incidents
            </button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const severity = incidentDetail ? getSeverity(incidentDetail.type) : null
  const statusLabel = incidentDetail ? getCaseStatusLabel(incidentDetail.caseStatus) : ''
  const typeLabel = incidentDetail ? getTypeLabel(incidentDetail.type) : ''
  const reference = incidentDetail ? `#${incidentDetail.id.substring(0, 8).toUpperCase()}` : ''

  return (
    <DashboardLayout>
      <div className="case-detail-page-container">
        <div className="case-detail-modal">
          <div className="case-detail-header">
            <div className="case-header-main">
              <div className="case-header-title-section">
                <h2>Incident Details</h2>
                {incidentDetail && (
                  <div className="case-header-meta">
                    <div className="case-header-worker-info">
                      <Icons.UserIcon />
                      <span className="case-header-worker">{incidentDetail.workerName}</span>
                    </div>
                    {severity && (
                      <div className="case-header-priority-badge" style={{ 
                        background: `${severity.color}20`, 
                        color: severity.color,
                        border: `1px solid ${severity.color}40`
                      }}>
                        {severity.level}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="case-header-actions">
                <button
                  className="case-action-btn print-btn"
                  title="Print incident details"
                  onClick={handlePrint}
                  disabled={!incidentDetail}
                >
                  <Icons.PrintIcon />
                  <span>Print</span>
                </button>
              </div>
            </div>
            <button
              className="case-detail-close"
              onClick={() => navigate(PROTECTED_ROUTES.SUPERVISOR.MY_INCIDENTS)}
              title="Close"
            >
              <Icons.CloseIcon size={20} />
            </button>
          </div>

          {loading ? (
            <div className="case-detail-loading">
              <Loading message="Loading incident details..." size="medium" />
            </div>
          ) : error ? (
            <div className="case-detail-error">
              <p>{error}</p>
              <button onClick={fetchIncidentDetail}>Retry</button>
            </div>
          ) : incidentDetail ? (
            <div className="case-detail-content">
              <div className="case-detail-main-grid">
                <div className="case-detail-column">
                  <div className="case-info-section">
                    <h3 className="case-section-header">INCIDENT INFORMATION</h3>
                    <div className="case-info-divider"></div>
                    <div className="case-info-list">
                      <div className="case-info-row">
                        <span className="case-info-label">Reference:</span>
                        <span className="case-info-value">{reference}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Status:</span>
                        <span className="case-info-value status-text" style={{ color: getStatusColor(incidentDetail.statusCategory, incidentDetail.caseStatus) }}>
                          {statusLabel}
                        </span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Severity:</span>
                        <span className="case-info-value severity-text" style={{ color: severity?.color || '#6B7280' }}>
                          {severity?.level || 'N/A'}
                        </span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Type:</span>
                        <span className="case-info-value">{typeLabel}</span>
                      </div>
                      {incidentDetail.approvedByClinician && (
                        <div className="case-info-row">
                          <span className="case-info-label">Approved by:</span>
                          <span className="case-info-value" style={{ color: '#10B981', fontWeight: 600 }}>
                            {incidentDetail.approvedByClinician}
                          </span>
                        </div>
                      )}
                      {incidentDetail.approvedAt && (
                        <div className="case-info-row">
                          <span className="case-info-label">Approved at:</span>
                          <span className="case-info-value">{formatDate(incidentDetail.approvedAt)}</span>
                        </div>
                      )}
                      {incidentDetail.returnToWorkDutyType && (
                        <div className="case-info-row">
                          <span className="case-info-label">Return to Work Duty Type:</span>
                          <span className="case-info-value" style={{ color: getDutyTypeColor(), fontWeight: 600 }}>
                            {formatDutyTypeLabel(incidentDetail.returnToWorkDutyType)}
                          </span>
                        </div>
                      )}
                      {incidentDetail.returnToWorkDate && (
                        <div className="case-info-row">
                          <span className="case-info-label">Return to Work Date:</span>
                          <span className="case-info-value">{formatDate(incidentDetail.returnToWorkDate)}</span>
                        </div>
                      )}
                      <div className="case-info-row">
                        <span className="case-info-label">Start Date:</span>
                        <span className="case-info-value">{formatDate(incidentDetail.startDate)}</span>
                      </div>
                      {incidentDetail.endDate && (
                        <div className="case-info-row">
                          <span className="case-info-label">End Date:</span>
                          <span className="case-info-value">{formatDate(incidentDetail.endDate)}</span>
                        </div>
                      )}
                      <div className="case-info-row">
                        <span className="case-info-label">Created:</span>
                        <span className="case-info-value">{formatDate(incidentDetail.createdAt)}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Last Updated:</span>
                        <span className="case-info-value">{formatDate(incidentDetail.updatedAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="case-info-section">
                    <h3 className="case-section-header">INCIDENT DETAILS</h3>
                    <div className="case-info-divider"></div>
                    <div className="case-info-list">
                      <div className="case-info-row">
                        <span className="case-info-label">Reason:</span>
                        <span className="case-info-value">{incidentDetail.reason || 'No reason provided'}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Active:</span>
                        <span className="case-info-value">{incidentDetail.isActive ? 'Yes' : 'No'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Incident Photo Section */}
                  {incidentDetail.photoUrl && (
                    <IncidentPhoto photoUrl={incidentDetail.photoUrl} />
                  )}

                  {/* AI Analysis Section - Centralized Component */}
                  {incidentDetail.aiAnalysisResult && (
                    <AiAnalysis analysis={incidentDetail.aiAnalysisResult} />
                  )}
                </div>

                <div className="case-detail-column">
                  <div className="case-info-section">
                    <h3 className="case-section-header">WORKER INFORMATION</h3>
                    <div className="case-info-divider"></div>
                    <div className="case-info-list">
                      <div className="case-info-row">
                        <span className="case-info-label">Name:</span>
                        <span className="case-info-value">{incidentDetail.workerName}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Email:</span>
                        <span className="case-info-value">{incidentDetail.workerEmail}</span>
                      </div>
                      {incidentDetail.workerGender && (
                        <div className="case-info-row">
                          <span className="case-info-label">Gender:</span>
                          <span className="case-info-value">{incidentDetail.workerGender.charAt(0).toUpperCase() + incidentDetail.workerGender.slice(1)}</span>
                        </div>
                      )}
                      {incidentDetail.workerAge !== null && incidentDetail.workerAge !== undefined && (
                        <div className="case-info-row">
                          <span className="case-info-label">Age:</span>
                          <span className="case-info-value">{incidentDetail.workerAge} years old</span>
                        </div>
                      )}
                      <div className="case-info-row">
                        <span className="case-info-label">Team:</span>
                        <span className="case-info-value">{incidentDetail.teamName}</span>
                      </div>
                      {incidentDetail.siteLocation && (
                        <div className="case-info-row">
                          <span className="case-info-label">Site Location:</span>
                          <span className="case-info-value">{incidentDetail.siteLocation}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="case-info-section">
                    <h3 className="case-section-header">ASSIGNMENT INFORMATION</h3>
                    <div className="case-info-divider"></div>
                    <div className="case-info-list">
                      <div className="case-info-row">
                        <span className="case-info-label">Assigned to WHS:</span>
                        <span className="case-info-value">{incidentDetail.assignedToWhs ? 'Yes' : 'No'}</span>
                      </div>
                      {incidentDetail.whsApprovedBy && (
                        <div className="case-info-row">
                          <span className="case-info-label">Approved by WHS:</span>
                          <span className="case-info-value" style={{ color: '#10B981', fontWeight: 600 }}>
                            {incidentDetail.whsApprovedBy}
                          </span>
                        </div>
                      )}
                      {incidentDetail.whsApprovedAt && (
                        <div className="case-info-row">
                          <span className="case-info-label">WHS Approved At:</span>
                          <span className="case-info-value">{formatDate(incidentDetail.whsApprovedAt)}</span>
                        </div>
                      )}
                      {incidentDetail.approvedByClinician && (
                        <div className="case-info-row">
                          <span className="case-info-label">Approved by Clinician:</span>
                          <span className="case-info-value" style={{ color: '#10B981', fontWeight: 600 }}>
                            {incidentDetail.approvedByClinician}
                          </span>
                        </div>
                      )}
                      {incidentDetail.approvedAt && (
                        <div className="case-info-row">
                          <span className="case-info-label">Clinician Approved At:</span>
                          <span className="case-info-value">{formatDate(incidentDetail.approvedAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>


              {/* Case Progress Section */}
              <div className="case-progress-section">
                <div className="case-progress-header">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                  </svg>
                  <h3 className="case-section-header">Case Progress</h3>
                </div>
                <div className="case-info-divider"></div>
                <div className="case-progress-timeline">
                  {STATUS_STAGES.map((stage, index) => {
                    if (!incidentDetail) return null
                    
                    const currentStatus = (incidentDetail.caseStatus as CaseStatus) || 'new'
                    const currentIndex = getStatusIndex(currentStatus)
                    const statusIndex = getStatusIndex(stage.key)
                    const isActive = statusIndex <= currentIndex
                    const isCurrent = currentStatus === stage.key
                    const isClosed = stage.key === 'closed'

                    return (
                      <div key={stage.key} className="case-progress-step">
                        <div
                          className={`case-progress-circle ${isActive ? 'active' : ''} ${isCurrent ? 'current' : ''} ${isClosed && isCurrent ? 'closed' : ''}`}
                        >
                          <span className="case-progress-icon">{stage.icon}</span>
                        </div>
                        <div className={`case-progress-label ${isCurrent ? 'current-label' : ''}`}>
                          {stage.label}
                        </div>
                        {index < STATUS_STAGES.length - 1 && (
                          <div className={`case-progress-line ${isActive && !isClosed ? 'active' : ''}`}></div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  )
}

