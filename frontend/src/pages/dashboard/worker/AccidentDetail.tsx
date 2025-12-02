import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { parseNotes } from '../../../utils/notesParser'
import { formatDutyTypeLabel } from '../../../utils/dutyTypeUtils'
import { formatDateDisplay } from '../../../shared/date'
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

const getStatusColor = (status: CaseStatus): string => {
  switch (status) {
    case 'closed':
      return '#6B7280'
    case 'triaged':
    case 'assessed':
    case 'in_rehab':
    case 'return_to_work':
      return '#EF4444'
    default:
      return '#EF4444'
  }
}

// Removed: Using shared utility from notesParser.ts

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
}

export function AccidentDetail() {
  const { caseId } = useParams<{ caseId: string }>()
  const navigate = useNavigate()
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rehabPlan, setRehabPlan] = useState<any | null>(null)
  const [rehabProgress, setRehabProgress] = useState<any | null>(null)
  const [loadingRehab, setLoadingRehab] = useState(false)
  const [warmUpData, setWarmUpData] = useState<{
    today: { completed: boolean; date: string | null }
    history: Array<{ date: string; completed: boolean }>
  } | null>(null)
  const [loadingWarmUp, setLoadingWarmUp] = useState(false)

  useEffect(() => {
    if (caseId) {
      fetchCaseDetail()
      fetchRehabilitationPlan()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])

  useEffect(() => {
    if (caseDetail?.worker?.id) {
      fetchWarmUpData(caseDetail.worker.id)
    }
  }, [caseDetail?.worker?.id])

  const fetchCaseDetail = async () => {
    if (!caseId) return

    try {
      setLoading(true)
      setError('')

      // OPTIMIZED: Direct API call for single case
      const result = await apiClient.get<{ case: any }>(API_ROUTES.WORKER.CASE(caseId))

      if (isApiError(result)) {
        if (result.error.status === 404) {
          // SECURITY: Unauthorized access - redirect to My Accidents
          console.warn('[AccidentDetail] Unauthorized access attempt or case not found. Redirecting...')
          navigate(PROTECTED_ROUTES.WORKER.MY_ACCIDENTS)
          return
        }
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch case details')
      }

      const caseItem = result.data.case

      if (!caseItem) {
        // SECURITY: Case not found - redirect to My Accidents
        console.warn('[AccidentDetail] Case data not found. Redirecting...')
        navigate(PROTECTED_ROUTES.WORKER.MY_ACCIDENTS)
        return
      }

      const notesData = parseNotes(caseItem.notes)
      
      let caseStatus: CaseStatus = 'new'
      
      if (caseItem.caseStatus) {
        caseStatus = caseItem.caseStatus as CaseStatus
      } else if (notesData?.case_status) {
        caseStatus = notesData.case_status as CaseStatus
      }
      
      if (caseStatus === 'new') {
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
          gender: (caseItem as any).workerGender || null,
          age: (caseItem as any).workerAge || null,
        },
        team: {
          teamName: caseItem.teamName,
          teamLeaderName: caseItem.teamLeaderName,
          supervisorName: caseItem.supervisorName,
          siteLocation: caseItem.siteLocation,
        },
        incident: {
          number: caseItem.id,
          date: caseItem.startDate || caseItem.createdAt,
          type: caseItem.type,
          severity: 'MEDICAL TREATMENT',
          description: caseItem.reason || 'No description provided',
          photoUrl: caseItem.incidentPhotoUrl || null,
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

  const fetchRehabilitationPlan = async () => {
    if (!caseId) return

    try {
      setLoadingRehab(true)
      
      // Fetch rehabilitation plan progress for this case (exception_id)
      // NOTE: 404 is EXPECTED when no plan exists - clinician hasn't created one yet
      const progressResult = await apiClient.get<any>(
        `${API_ROUTES.CHECKINS.REHABILITATION_PLAN_PROGRESS}?exception_id=${caseId}`
      )

      if (isApiError(progressResult)) {
        // 404 = No plan exists yet (EXPECTED - clinician hasn't created one)
        // This is NOT an error - just means no rehab plan has been created
        if (progressResult.error.status === 404) {
          // Silently return - no rehab plan exists yet
          // This is normal behavior, not an error
          setRehabPlan(null)
          setRehabProgress(null)
          return
        }
        // Only log non-404 errors (actual problems)
        if (progressResult.error.status !== 404) {
          console.warn('[AccidentDetail] Error fetching rehab plan:', progressResult.error)
        }
        return
      }

      const progressData = progressResult.data
      
      if (progressData && progressData.plan) {
        // Set plan data (using progress data structure)
        setRehabPlan({
          id: progressData.plan.id,
          exceptionId: caseId,
          status: progressData.plan.status,
        })
        
        // Set progress data
        setRehabProgress(progressData)
      } else {
        // No plan data in response
        setRehabPlan(null)
        setRehabProgress(null)
      }
    } catch (err: any) {
      // Only log unexpected errors, not 404s
      // 404 errors are handled above and won't reach here
      console.error('[AccidentDetail] Unexpected error fetching rehabilitation plan:', err)
    } finally {
      setLoadingRehab(false)
    }
  }

  const fetchWarmUpData = async (workerId: string) => {
    if (!workerId) return

    try {
      setLoadingWarmUp(true)
      
      // Get today's date string
      const today = new Date()
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      
      // Fetch warm-up data from dashboard endpoint which includes warm-up status
      const dashboardResult = await apiClient.get<{
        warmUp: { completed: boolean }
      }>(API_ROUTES.CHECKINS.DASHBOARD)

      const todayCompleted = !isApiError(dashboardResult) && dashboardResult.data.warmUp?.completed || false
      
      setWarmUpData({
        today: {
          completed: todayCompleted,
          date: todayStr
        },
        history: [] // Can be populated later if needed
      })
    } catch (err: any) {
      console.error('Error fetching warm-up data:', err)
      setWarmUpData({
        today: { completed: false, date: null },
        history: []
      })
    } finally {
      setLoadingWarmUp(false)
    }
  }

  const formatDateLong = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    })
  }

  const getDisplayStatus = (): string => {
    if (!caseDetail) return ''
    return caseDetail.status || getStatusDisplayLabel(caseDetail.caseStatus)
  }

  const getStatusIndex = (status: CaseStatus): number => {
    return STATUS_ORDER.indexOf(status)
  }

  const isStatusActive = (statusKey: CaseStatus): boolean => {
    if (!caseDetail) return false
    const currentIndex = getStatusIndex(caseDetail.caseStatus)
    const statusIndex = getStatusIndex(statusKey)
    return statusIndex <= currentIndex
  }

  const isStatusCurrent = (statusKey: CaseStatus): boolean => {
    return caseDetail?.caseStatus === statusKey
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
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
    const displayStatus = getDisplayStatus()
    const formattedIncidentType = formatIncidentType(caseDetail.incident.type)
    const caseProgressHtml = STATUS_STAGES.map((stage) => {
      const isActive = isStatusActive(stage.key)
      const isCurrent = isStatusCurrent(stage.key)
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
            .print-clinical-notes {
              padding: 16px;
              background: #F8FAFC;
              border: 1px solid #E5E7EB;
              border-radius: 8px;
              white-space: pre-wrap;
              font-size: 14px;
              line-height: 1.6;
              color: #0F172A;
              margin-top: 10px;
              min-height: 100px;
            }
            .print-clinical-notes-updated {
              margin-top: 8px;
              font-size: 12px;
              color: #64748B;
            }
            @media print {
              .no-print {
                display: none !important;
              }
              .print-clinical-notes {
                background: #FFFFFF;
                border: 1px solid #000;
              }
            }
          </style>
        </head>
        <body>
          <div class="print-header">
            <h1>Accident Case Details</h1>
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
              </div>

              <div class="print-section">
                <h2>Incident Details</h2>
                <div class="print-row">
                  <span class="print-label">Start Date:</span>
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
              </div>
            </div>
          </div>

          <div class="print-section print-timeline">
            <h2>Case Progress</h2>
            ${caseProgressHtml}
          </div>

          ${caseDetail.clinicalNotes ? `
          <div class="print-section">
            <h2>Clinical Notes</h2>
            <div class="print-clinical-notes">
              ${caseDetail.clinicalNotes
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/\n/g, '<br>')
                .replace(/\r/g, '')}
            </div>
            ${caseDetail.clinicalNotesUpdatedAt ? `
            <div class="print-clinical-notes-updated">
              Last updated: ${formatDate(caseDetail.clinicalNotesUpdatedAt)} ${new Date(caseDetail.clinicalNotesUpdatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </div>
            ` : ''}
          </div>
          ` : ''}
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
            <button onClick={() => navigate(PROTECTED_ROUTES.WORKER.MY_ACCIDENTS)}>
              Back to My Accidents
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
                <h2>Accident Case Details</h2>
                {caseDetail && (
                  <div className="case-header-meta">
                    <div className="case-header-worker-info">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
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
              onClick={() => navigate(PROTECTED_ROUTES.WORKER.MY_ACCIDENTS)} 
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
                          {getDisplayStatus()}
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
                        <span className="case-info-label">Case Status:</span>
                        {caseDetail.caseStatus === 'new' ? (
                          <span className="case-info-badge" style={{ background: '#FEF3C7', color: '#D97706' }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"></circle>
                              <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            PENDING WHS REVIEW
                          </span>
                        ) : caseDetail.caseStatus === 'triaged' ? (
                          <span className="case-info-badge" style={{ background: '#DBEAFE', color: '#2563EB' }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                            </svg>
                            TRIAGED BY WHS
                          </span>
                        ) : caseDetail.caseStatus === 'assessed' || caseDetail.caseStatus === 'in_rehab' ? (
                          <span className="case-info-badge" style={{ background: '#D1FAE5', color: '#059669' }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                              <polyline points="22 4 12 14.01 9 11.01"></polyline>
                            </svg>
                            ASSIGNED TO CLINICIAN
                          </span>
                        ) : caseDetail.caseStatus === 'return_to_work' || caseDetail.caseStatus === 'closed' ? (
                        <span className="case-info-badge approved">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                            APPROVED BY CLINICIAN
                        </span>
                        ) : (
                          <span className="case-info-badge" style={{ background: '#F3F4F6', color: '#6B7280' }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"></circle>
                              <line x1="12" y1="8" x2="12" y2="12"></line>
                              <line x1="12" y1="16" x2="12.01" y2="16"></line>
                            </svg>
                            IN PROGRESS
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Incident Photo - Full Width Section */}
              {caseDetail.incident.photoUrl && (
                <IncidentPhoto 
                  photoUrl={caseDetail.incident.photoUrl} 
                />
              )}

              {/* AI Analysis - Full Width Section */}
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
                    const isActive = isStatusActive(stage.key)
                    const isCurrent = isStatusCurrent(stage.key)
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

              {/* Rehabilitation Plan Progress Section */}
              {loadingRehab ? (
                <div className="case-info-section">
                  <h3 className="case-section-header">REHABILITATION PLAN PROGRESS</h3>
                  <div className="case-info-divider"></div>
                  <div style={{ padding: '20px', textAlign: 'center' }}>
                    <Loading message="Loading rehabilitation plan..." size="small" />
                  </div>
                </div>
              ) : rehabPlan && rehabProgress ? (
                <div className="case-info-section">
                  <h3 className="case-section-header">REHABILITATION PLAN PROGRESS</h3>
                  <div className="case-info-divider"></div>
                  
                  {/* Plan Details */}
                  <div style={{ marginBottom: '24px', padding: '16px', background: '#F8FAFC', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '600', color: '#0F172A' }}>
                          {rehabProgress.plan.plan_name}
                        </h4>
                        <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#64748B' }}>
                          {rehabProgress.plan.workerName} • {rehabProgress.plan.caseNumber}
                        </p>
                      </div>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        background: '#D1FAE5',
                        color: '#059669'
                      }}>
                        {rehabProgress.plan.status === 'active' ? 'Active' : rehabProgress.plan.status}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '24px', marginBottom: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '12px', color: '#64748B' }}>Overall Progress</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                          <div style={{ flex: 1, height: '8px', background: '#E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${rehabProgress.plan.progress}%`, background: '#8B5CF6', borderRadius: '4px' }}></div>
                          </div>
                          <span style={{ fontSize: '14px', fontWeight: '600', color: '#0F172A', minWidth: '45px' }}>
                            {rehabProgress.plan.progress}%
                          </span>
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: '13px', color: '#64748B' }}>
                      Day {rehabProgress.plan.currentDay} of {rehabProgress.plan.duration} ({rehabProgress.plan.daysCompleted} completed) • 
                      <span style={{ marginLeft: '4px', fontWeight: '500', color: '#8B5CF6' }}>Current: Day {rehabProgress.plan.currentDay}</span>
                    </div>
                  </div>

                  {/* Daily Progress Timeline */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                      </svg>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#0F172A' }}>Daily Progress Timeline</h4>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
                      {rehabProgress.dailyProgress.map((day: any) => {
                        const isCompleted = day.status === 'completed'
                        const isCurrent = day.status === 'current'
                        
                        return (
                          <div
                            key={day.dayNumber}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '12px 16px',
                              borderRadius: '8px',
                              background: isCompleted ? '#ECFDF5' : isCurrent ? '#FEF3C7' : '#F8FAFC',
                              border: isCurrent ? '1px solid #FCD34D' : '1px solid transparent',
                            }}
                          >
                            <div style={{ 
                              width: '32px', 
                              height: '32px', 
                              borderRadius: '50%', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center',
                              marginRight: '12px',
                              background: isCompleted ? '#10B981' : isCurrent ? '#F59E0B' : '#E2E8F0',
                              color: isCompleted || isCurrent ? '#FFFFFF' : '#64748B',
                              fontWeight: '600',
                              fontSize: '14px',
                              flexShrink: 0
                            }}>
                              {isCompleted ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                              ) : (
                                day.dayNumber
                              )}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                <span style={{ fontSize: '13px', fontWeight: '600', color: '#0F172A' }}>
                                  {formatDateLong(day.date)}
                                </span>
                                <span style={{ 
                                  fontSize: '12px', 
                                  fontWeight: '500',
                                  color: isCompleted ? '#10B981' : isCurrent ? '#F59E0B' : '#64748B'
                                }}>
                                  {isCompleted ? 'Completed' : isCurrent ? 'Current' : 'Pending'}
                                </span>
                              </div>
                              {isCompleted && (
                                <div style={{ fontSize: '12px', color: '#64748B' }}>
                                  {day.exercisesCompleted} of {day.totalExercises} exercise{day.totalExercises !== 1 ? 's' : ''} completed
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Clinical Notes Section - VIEW ONLY (Always shown, at the bottom) */}
              {caseDetail && (
                <div className="case-info-section">
                  <h3 className="case-section-header">CLINICAL NOTES</h3>
                  <div className="case-info-divider"></div>
                  <div style={{ padding: '16px 0' }}>
                    {caseDetail.clinicalNotes ? (
                      <>
                        <div style={{
                          padding: '16px',
                          background: '#F8FAFC',
                          borderRadius: '8px',
                          border: '1px solid #E5E7EB',
                          whiteSpace: 'pre-wrap',
                          fontSize: '14px',
                          lineHeight: '1.6',
                          color: '#0F172A',
                          minHeight: '100px'
                        }}>
                          {caseDetail.clinicalNotes}
                        </div>
                        {caseDetail.clinicalNotesUpdatedAt && (
                          <div style={{
                            marginTop: '8px',
                            fontSize: '12px',
                            color: '#64748B',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"></circle>
                              <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            Last updated: {formatDate(caseDetail.clinicalNotesUpdatedAt)} {new Date(caseDetail.clinicalNotesUpdatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{
                        padding: '24px',
                        background: '#F8FAFC',
                        borderRadius: '8px',
                        border: '1px solid #E5E7EB',
                        textAlign: 'center'
                      }}>
                        <p style={{
                          margin: 0,
                          fontSize: '14px',
                          color: '#64748B'
                        }}>
                          No clinical notes available
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  )
}



