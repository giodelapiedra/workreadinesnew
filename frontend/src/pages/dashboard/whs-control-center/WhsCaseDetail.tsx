import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { parseNotes } from '../../../utils/notesParser'
import { formatDutyTypeLabel } from '../../../utils/dutyTypeUtils'
import { formatDateDisplay } from '../../../shared/date'
import { getStatusStyle } from '../../../utils/caseStatus'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { IncidentPhoto, AiAnalysis } from '../../../components/incident'
import type { AiAnalysisResult } from '../../../components/incident'
import '../clinician/CaseDetail.css'

type CaseStatus = 'new' | 'triaged' | 'assessed' | 'in_rehab' | 'return_to_work' | 'closed'

interface CaseDetail {
  id: string
  caseNumber: string
  status: string
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  createdAt: string
  worker: {
    id: string
    name: string
    email: string
    phone: string
    role: string
    initials: string
    gender?: string | null
    age?: number | null
  }
  team: {
    teamName?: string
    teamLeaderName?: string
    supervisorName?: string
    siteLocation?: string
    clinician?: {
      name: string
      email: string
    }
  }
  incident: {
    number: string
    date: string
    type: string
    severity: string
    description: string
    photoUrl?: string | null
    aiAnalysis?: AiAnalysisResult | null
  }
  caseStatus: CaseStatus
  approvedBy?: string
  approvedAt?: string
  returnToWorkDutyType?: 'modified' | 'full'
  returnToWorkDate?: string
  clinicalNotes?: string
  clinicalNotesUpdatedAt?: string
}

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

const getStatusDisplayLabel = (status: CaseStatus): string => {
  return STATUS_STAGES.find(s => s.key === status)?.label || status.toUpperCase()
}

// Use centralized status style utility
// Map internal status to display status for getStatusStyle
const getStatusColor = (status: CaseStatus): string => {
  // Map internal status to display status
  const statusMap: Record<CaseStatus, string> = {
    'new': 'NEW CASE',
    'triaged': 'TRIAGED',
    'assessed': 'ASSESSED',
    'in_rehab': 'IN REHAB',
    'return_to_work': 'RETURN TO WORK',
    'closed': 'CLOSED',
  }
  const displayStatus = statusMap[status] || status.toUpperCase()
  const style = getStatusStyle(displayStatus)
  return style.color
}

const formatIncidentType = (type: string): string => {
  return type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')
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

export function WhsCaseDetail() {
  const { caseId } = useParams<{ caseId: string }>()
  const navigate = useNavigate()
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (caseId) {
      fetchCaseDetail()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])

  const fetchCaseDetail = async () => {
    if (!caseId) return

    try {
      setLoading(true)
      setError('')

      const result = await apiClient.get<{ case: any }>(
        API_ROUTES.WHS.CASE(caseId)
      )

      if (isApiError(result)) {
        if (result.error?.status === 404) {
          throw new Error('Case not found or not authorized')
        }
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch case details')
      }

      const data = result.data
      const caseItem = data.case

      if (!caseItem) {
        throw new Error('Case not found')
      }

      const notesData = parseNotes(caseItem.notes)
      
      // Use caseStatus from backend (already parsed), with fallback for legacy data
      let caseStatus: CaseStatus = (caseItem.caseStatus as CaseStatus) || (notesData?.case_status as CaseStatus) || 'new'
      
      // Fallback for legacy status field if caseStatus not available
      if (caseStatus === 'new' && caseItem.status) {
        if (caseItem.status === 'CLOSED') {
          caseStatus = 'closed'
        } else if (caseItem.status === 'IN REHAB') {
          caseStatus = 'in_rehab'
        } else if (caseItem.status === 'ACTIVE') {
          caseStatus = 'assessed'
        }
      }

      const approvedBy = notesData?.approved_by
      const approvedAt = notesData?.approved_at
      const returnToWorkDutyType = caseItem.return_to_work_duty_type as 'modified' | 'full' | undefined
      const returnToWorkDate = caseItem.return_to_work_date as string | undefined
      const clinicalNotes = notesData?.clinical_notes || ''
      const clinicalNotesUpdatedAt = notesData?.clinical_notes_updated_at
      const displayStatus = getStatusDisplayLabel(caseStatus)

      const detail: CaseDetail = {
        id: caseItem.id,
        caseNumber: caseItem.caseNumber,
        status: displayStatus,
        priority: caseItem.priority,
        createdAt: caseItem.createdAt,
        worker: {
          id: caseItem.workerId,
          name: caseItem.workerName,
          email: caseItem.workerEmail,
          phone: caseItem.phone || 'N/A',
          role: 'WORKER',
          initials: caseItem.workerInitials,
          gender: caseItem.workerGender || null,
          age: caseItem.workerAge || null,
        },
        team: {
          teamName: caseItem.teamName,
          teamLeaderName: caseItem.teamLeaderName,
          supervisorName: caseItem.supervisorName,
          siteLocation: caseItem.siteLocation,
          clinician: caseItem.clinicianName ? {
            name: caseItem.clinicianName,
            email: '',
          } : undefined,
        },
        incident: {
          number: caseItem.id,
          date: caseItem.startDate || caseItem.createdAt,
          type: caseItem.type,
          severity: 'MEDICAL TREATMENT',
          description: caseItem.reason || 'No description provided',
          photoUrl: caseItem.incidentPhotoUrl || null,
          incidentId: (caseItem as any).incidentId || (caseItem as any).incident?.incidentId || null,
          aiAnalysis: caseItem.incidentAiAnalysis || null,
        },
        caseStatus,
        approvedBy,
        approvedAt,
        returnToWorkDutyType,
        returnToWorkDate,
        clinicalNotes,
        clinicalNotesUpdatedAt,
      }

      setCaseDetail(detail)
    } catch (err: any) {
      console.error('Error fetching case detail:', err)
      setError(err.message || 'Failed to load case details')
    } finally {
      setLoading(false)
    }
  }

  // Use centralized date formatting utility
  const formatDate = (dateString: string) => {
    // formatDateDisplay returns "Jan 15, 2024" format
    // For MM/DD/YYYY format, we'll use a custom formatter
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString('en-US', { 
      month: '2-digit', 
      day: '2-digit', 
      year: 'numeric' 
    })
  }

  const getPriorityStyle = (priority: string) => {
    switch (priority) {
      case 'HIGH':
        return { bg: '#FEE2E2', color: '#EF4444' }
      case 'MEDIUM':
        return { bg: '#FEF3C7', color: '#F59E0B' }
      case 'LOW':
        return { bg: '#DBEAFE', color: '#3B82F6' }
      default:
        return { bg: '#F3F4F6', color: '#6B7280' }
    }
  }

  const handlePrint = () => {
    if (!caseDetail) return

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
      minute: '2-digit'
    })
    const displayStatus = caseDetail.status
    const formattedIncidentType = formatIncidentType(caseDetail.incident.type)
    const caseProgressHtml = STATUS_STAGES.map((stage) => {
      const isActive = STATUS_ORDER.indexOf(caseDetail.caseStatus) >= STATUS_ORDER.indexOf(stage.key)
      const isCurrent = caseDetail.caseStatus === stage.key
      const statusText = isCurrent ? '✓ Current' : isActive ? '✓ Completed' : '○ Pending'
      return `
        <div class="print-row">
          <span class="print-label">${stage.label}:</span>
          <span class="print-value">${statusText}</span>
        </div>
      `
    }).join('')

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Case Details - ${caseDetail.caseNumber}</title>
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
            .print-timeline {
              margin-top: 20px;
            }
            .print-timeline h2 {
              margin-bottom: 15px;
            }
          </style>
        </head>
        <body>
          <div class="print-header">
            <h1>Case Details</h1>
            <p>Printed on: ${printDate}</p>
          </div>

          <div class="print-grid">
            <div>
              <div class="print-section">
                <h2>Case Information</h2>
                <div class="print-row">
                  <span class="print-label">Case Number:</span>
                  <span class="print-value">${caseDetail.caseNumber}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Status:</span>
                  <span class="print-value">${displayStatus}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Priority:</span>
                  <span class="print-value">${caseDetail.priority}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Incident Type:</span>
                  <span class="print-value">${formattedIncidentType}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Created:</span>
                  <span class="print-value">${formatDate(caseDetail.createdAt)}</span>
                </div>
                ${caseDetail.approvedBy ? `
                <div class="print-row">
                  <span class="print-label">Approved by:</span>
                  <span class="print-value">${caseDetail.approvedBy}</span>
                </div>
                ` : ''}
                ${caseDetail.approvedAt ? `
                <div class="print-row">
                  <span class="print-label">Approved at:</span>
                  <span class="print-value">${formatDate(caseDetail.approvedAt)}</span>
                </div>
                ` : ''}
                ${caseDetail.caseStatus === 'return_to_work' && caseDetail.returnToWorkDutyType ? `
                <div class="print-row">
                  <span class="print-label">Duty Type:</span>
                  <span class="print-value">${formatDutyTypeLabel(caseDetail.returnToWorkDutyType)}</span>
                </div>
                ` : ''}
                ${caseDetail.caseStatus === 'return_to_work' && caseDetail.returnToWorkDate ? `
                <div class="print-row">
                  <span class="print-label">Return Date:</span>
                  <span class="print-value">${formatDate(caseDetail.returnToWorkDate)}</span>
                </div>
                ` : ''}
              </div>

              <div class="print-section">
                <h2>Incident Details</h2>
                <div class="print-row">
                  <span class="print-label">Start Date:</span>
                  <span class="print-value">${formatDate(caseDetail.incident.date)}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">End Date:</span>
                  <span class="print-value">${formatDate(caseDetail.incident.date)}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Reason:</span>
                  <span class="print-value">${caseDetail.incident.description || 'No reason provided'}</span>
                </div>
              </div>
            </div>

            <div>
              <div class="print-section">
                <h2>Worker Information</h2>
                <div class="print-row">
                  <span class="print-label">Name:</span>
                  <span class="print-value">${caseDetail.worker.name}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Email:</span>
                  <span class="print-value">${caseDetail.worker.email}</span>
                </div>
                ${caseDetail.worker.gender ? `
                <div class="print-row">
                  <span class="print-label">Gender:</span>
                  <span class="print-value">${caseDetail.worker.gender.charAt(0).toUpperCase() + caseDetail.worker.gender.slice(1)}</span>
                </div>
                ` : ''}
                ${caseDetail.worker.age !== null && caseDetail.worker.age !== undefined ? `
                <div class="print-row">
                  <span class="print-label">Age:</span>
                  <span class="print-value">${caseDetail.worker.age} years old</span>
                </div>
                ` : ''}
                <div class="print-row">
                  <span class="print-label">Team:</span>
                  <span class="print-value">${caseDetail.team.teamName || 'N/A'}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Team Leader:</span>
                  <span class="print-value">${caseDetail.team.teamLeaderName || 'N/A'}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Site Location:</span>
                  <span class="print-value">${caseDetail.team.siteLocation || 'N/A'}</span>
                </div>
              </div>

              <div class="print-section">
                <h2>Supervisor Information</h2>
                <div class="print-row">
                  <span class="print-label">Supervisor:</span>
                  <span class="print-value">${caseDetail.team.supervisorName || 'N/A'}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Last Updated:</span>
                  <span class="print-value">${formatDate(caseDetail.createdAt)}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Assignment Status:</span>
                  <span class="print-value">APPROVED BY WHS REVIEW</span>
                </div>
              </div>
            </div>
          </div>

          <div class="print-section print-timeline">
            <h2>Case Progress</h2>
            ${caseProgressHtml}
          </div>
        </body>
      </html>
    `

    printWindow.document.write(printContent)
    printWindow.document.close()

    setTimeout(() => {
      printWindow.focus()
      printWindow.print()
    }, 500)
  }

  if (!caseId) {
    return (
      <DashboardLayout>
        <div className="case-detail-page-container">
          <div className="case-detail-error">
            <p>Case ID is required</p>
            <button onClick={() => navigate(PROTECTED_ROUTES.WHS_CONTROL_CENTER.DASHBOARD)}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="case-detail-page-container">
        <div className="case-detail-modal">
          <div className="case-detail-header">
            <div className="case-header-main">
              <div className="case-header-title-section">
                <h2>Case Details</h2>
                {caseDetail && (
                  <div className="case-header-meta">
                    <div className="case-header-worker-info">
                      <Icons.UserIcon />
                      <span className="case-header-worker">{caseDetail.worker.name}</span>
                    </div>
                    <div className="case-header-priority-badge" style={getPriorityStyle(caseDetail.priority)}>
                      {caseDetail.priority}
                    </div>
                  </div>
                )}
              </div>
              <div className="case-header-actions">
                <button 
                  className="case-action-btn print-btn" 
                  title="Print case details"
                  onClick={handlePrint}
                  disabled={!caseDetail}
                >
                  <Icons.PrintIcon />
                  <span>Print</span>
                </button>
              </div>
            </div>
            <button 
              className="case-detail-close" 
              onClick={() => navigate(PROTECTED_ROUTES.WHS_CONTROL_CENTER.DASHBOARD)} 
              title="Close"
            >
              <Icons.CloseIcon size={20} />
            </button>
          </div>

          {loading ? (
            <div className="case-detail-loading">
              <Loading message="Loading case details..." size="medium" />
            </div>
          ) : error ? (
            <div className="case-detail-error">
              <p>{error}</p>
              <button onClick={fetchCaseDetail}>Retry</button>
            </div>
          ) : caseDetail ? (
            <div className="case-detail-content">
              <div className="case-detail-main-grid">
                <div className="case-detail-column">
                  <div className="case-info-section">
                    <h3 className="case-section-header">CASE INFORMATION</h3>
                    <div className="case-info-divider"></div>
                    <div className="case-info-list">
                      <div className="case-info-row">
                        <span className="case-info-label">Case Number:</span>
                        <span className="case-info-value">{caseDetail.caseNumber}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Status:</span>
                        <span className="case-info-value status-text" style={{ color: getStatusColor(caseDetail.caseStatus) }}>
                          {caseDetail.status}
                        </span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Severity:</span>
                        <span className="case-info-value severity-text" style={{ color: caseDetail.priority === 'HIGH' ? '#EF4444' : caseDetail.priority === 'MEDIUM' ? '#F59E0B' : '#6B7280' }}>
                          {caseDetail.priority}
                        </span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Incident Type:</span>
                        <span className="case-info-value">{formatIncidentType(caseDetail.incident.type)}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Created:</span>
                        <span className="case-info-value">{formatDate(caseDetail.createdAt)}</span>
                      </div>
                      {(caseDetail.caseStatus === 'closed' || caseDetail.caseStatus === 'return_to_work') && caseDetail.approvedBy && (
                        <div className="case-info-row">
                          <span className="case-info-label">Approved by:</span>
                          <span className="case-info-value" style={{ color: '#10B981', fontWeight: 600 }}>
                            {caseDetail.approvedBy}
                          </span>
                        </div>
                      )}
                      {(caseDetail.caseStatus === 'closed' || caseDetail.caseStatus === 'return_to_work') && caseDetail.approvedAt && (
                        <div className="case-info-row">
                          <span className="case-info-label">Approved at:</span>
                          <span className="case-info-value">{formatDate(caseDetail.approvedAt)}</span>
                        </div>
                      )}
                      {caseDetail.returnToWorkDutyType && (
                        <div className="case-info-row">
                          <span className="case-info-label">Return to Work Duty Type:</span>
                          <span className="case-info-value" style={{ 
                            color: '#3B82F6', 
                            fontWeight: 600,
                            textTransform: 'capitalize'
                          }}>
                            {formatDutyTypeLabel(caseDetail.returnToWorkDutyType)}
                          </span>
                        </div>
                      )}
                      {caseDetail.returnToWorkDate && (
                        <div className="case-info-row">
                          <span className="case-info-label">Return to Work Date:</span>
                          <span className="case-info-value">{formatDate(caseDetail.returnToWorkDate)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="case-info-section">
                    <h3 className="case-section-header">INCIDENT DETAILS</h3>
                    <div className="case-info-divider"></div>
                    <div className="case-info-list">
                      <div className="case-info-row">
                        <span className="case-info-label">Start Date:</span>
                        <span className="case-info-value">{formatDate(caseDetail.incident.date)}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">End Date:</span>
                        <span className="case-info-value">{formatDate(caseDetail.incident.date)}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Reason:</span>
                        <span className="case-info-value">{caseDetail.incident.description || 'No reason provided'}</span>
                      </div>
                  </div>
                </div>
                </div>

                <div className="case-detail-column">
                  <div className="case-info-section">
                    <h3 className="case-section-header">WORKER INFORMATION</h3>
                    <div className="case-info-divider"></div>
                    <div className="case-info-list">
                      <div className="case-info-row">
                        <span className="case-info-label">Name:</span>
                        <span className="case-info-value">{caseDetail.worker.name}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Email:</span>
                        <span className="case-info-value">{caseDetail.worker.email}</span>
                      </div>
                      {caseDetail.worker.gender && (
                        <div className="case-info-row">
                          <span className="case-info-label">Gender:</span>
                          <span className="case-info-value">{caseDetail.worker.gender.charAt(0).toUpperCase() + caseDetail.worker.gender.slice(1)}</span>
                        </div>
                      )}
                      {caseDetail.worker.age !== null && caseDetail.worker.age !== undefined && (
                        <div className="case-info-row">
                          <span className="case-info-label">Age:</span>
                          <span className="case-info-value">{caseDetail.worker.age} years old</span>
                        </div>
                      )}
                      <div className="case-info-row">
                        <span className="case-info-label">Team:</span>
                        <span className="case-info-value">{caseDetail.team.teamName || 'N/A'}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Team Leader:</span>
                        <span className="case-info-value">{caseDetail.team.teamLeaderName || 'N/A'}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Site Location:</span>
                        <span className="case-info-value">{caseDetail.team.siteLocation || 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="case-info-section">
                    <h3 className="case-section-header">SUPERVISOR INFORMATION</h3>
                    <div className="case-info-divider"></div>
                    <div className="case-info-list">
                      <div className="case-info-row">
                        <span className="case-info-label">Supervisor:</span>
                        <span className="case-info-value">{caseDetail.team.supervisorName || 'N/A'}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Last Updated:</span>
                        <span className="case-info-value">{formatDate(caseDetail.createdAt)}</span>
                      </div>
                      <div className="case-info-row">
                        <span className="case-info-label">Assignment Status:</span>
                        {!caseDetail.team.clinician ? (
                          <span className="case-info-badge" style={{ background: '#FEF3C7', color: '#D97706' }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"></circle>
                              <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            NOT ASSIGNED
                          </span>
                        ) : (
                          <span className="case-info-badge" style={{ background: '#D1FAE5', color: '#059669' }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                            ASSIGNED TO CLINICIAN
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Incident Photo - Centralized Component */}
              {caseDetail.incident.photoUrl && (
                <IncidentPhoto 
                  photoUrl={caseDetail.incident.photoUrl} 
                />
              )}

              {/* AI Analysis - Centralized Component */}
              {caseDetail.incident.aiAnalysis && (
                <AiAnalysis analysis={caseDetail.incident.aiAnalysis} />
              )}

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
                    const isActive = STATUS_ORDER.indexOf(caseDetail.caseStatus) >= STATUS_ORDER.indexOf(stage.key)
                    const isCurrent = caseDetail.caseStatus === stage.key
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

