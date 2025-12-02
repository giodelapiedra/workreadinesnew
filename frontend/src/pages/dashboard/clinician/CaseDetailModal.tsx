import { useState, useEffect } from 'react'
import { Loading } from '../../../components/Loading'
import { parseNotes } from '../../../utils/notesParser'
import { formatDutyTypeLabel } from '../../../utils/dutyTypeUtils'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { getTodayDateString } from '../../../shared/date'
import type { AiAnalysisResult, IncidentData } from '../../../components/incident/types'
import { IncidentPhoto, AiAnalysis } from '../../../components/incident'
import './CaseDetailModal.css'

interface CaseDetailModalProps {
  caseId: string | null
  onClose: () => void
  onUpdate?: () => void
}

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
    caseManager?: {
      name: string
      email: string
    }
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
    aiAnalysis?: any | null
  }
  caseStatus: CaseStatus // Internal case status
  approvedBy?: string // Name of clinician who approved/closed the case
  approvedAt?: string // Date when case was approved/closed
  returnToWorkDutyType?: 'modified' | 'full' // Type of duty when returning to work
  returnToWorkDate?: string // Date when worker returns to work
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

// Helper functions
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

// Helper to parse notes JSON safely
// Removed: Using shared utility from notesParser.ts

// Helper to format incident type
const formatIncidentType = (type: string): string => {
  return type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')
}

// Reusable SVG Icons (to avoid duplication)
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
  UpdateIcon: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
    </svg>
  ),
  UserIcon: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  ),
  CheckIcon: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  ),
  AlertIcon: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
      <line x1="12" y1="9" x2="12" y2="13"></line>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
  ),
}

export function CaseDetailModal({ caseId, onClose, onUpdate }: CaseDetailModalProps) {
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [updateAlert, setUpdateAlert] = useState<string | null>(null)
  const [showReturnToWorkModal, setShowReturnToWorkModal] = useState(false)
  const [returnToWorkData, setReturnToWorkData] = useState({
    dutyType: 'modified' as 'modified' | 'full',
    returnDate: ''
  })
  const [hasActiveRehabPlan, setHasActiveRehabPlan] = useState(false)

  useEffect(() => {
    if (caseId) {
      fetchCaseDetail()
      checkActiveRehabPlans()
    }
  }, [caseId])

  const fetchCaseDetail = async () => {
    if (!caseId) return

    try {
      setLoading(true)
      setError('')

      // Fetch single case detail using detail endpoint
      const result = await apiClient.get<{ case: any }>(
        `${API_ROUTES.CLINICIAN.CASES}/${caseId}`,
        { headers: { 'Cache-Control': 'no-cache' } }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch case details')
      }

      const data = result.data
      const caseItem = data.case

      if (!caseItem) {
        throw new Error('Case not found')
      }

      // Parse notes once
      const notesData = parseNotes(caseItem.notes)
      
      // Get case_status from API response (from notes field) or fallback
      let caseStatus: CaseStatus = 'new'
      
      // Priority 1: Use caseStatus from API (already extracted from notes)
      if ((caseItem as any).caseStatus) {
        caseStatus = (caseItem as any).caseStatus
      }
      // Priority 2: Try to get from notes field
      else if (notesData?.case_status) {
        caseStatus = notesData.case_status as CaseStatus
      }
      
      // Priority 3: Determine from status field if still not found
      if (caseStatus === 'new') {
        if (caseItem.status === 'CLOSED') {
          caseStatus = 'closed'
        } else if (caseItem.status === 'IN REHAB') {
          caseStatus = 'in_rehab'
        } else if (caseItem.status === 'ACTIVE') {
          caseStatus = 'assessed'
        }
      }

      // Get approval information from notes
      const approvedBy = notesData?.approved_by
      const approvedAt = notesData?.approved_at

      // Get return to work information from caseItem (database columns)
      const returnToWorkDutyType = (caseItem as any).return_to_work_duty_type as 'modified' | 'full' | undefined
      const returnToWorkDate = (caseItem as any).return_to_work_date as string | undefined

      // Get the display status label
      const displayStatus = getStatusDisplayLabel(caseStatus)

      // Format case detail
      const detail: CaseDetail = {
        id: caseItem.id,
        caseNumber: caseItem.caseNumber,
        status: displayStatus, // Use the display label
        priority: caseItem.priority,
        createdAt: caseItem.createdAt,
        worker: {
          id: caseItem.workerId,
          name: caseItem.workerName,
          email: caseItem.workerEmail,
          phone: (caseItem as any).workerPhone || (caseItem as any).phone || 'N/A',
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
          caseManager: {
            name: 'Admin Case_manager',
            email: 'admin_case_manager@test.com',
          },
          clinician: {
            name: 'Admin Clinician',
            email: 'admin_clinician@test.com',
          },
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
      }

      setCaseDetail(detail)
    } catch (err: any) {
      console.error('Error fetching case detail:', err)
      setError(err.message || 'Failed to load case details')
    } finally {
      setLoading(false)
    }
  }

  const checkActiveRehabPlans = async () => {
    if (!caseId) return

    try {
      // Get all rehabilitation plans to check for active ones
      const result = await apiClient.get<{ plans: any[] }>(
        `${API_ROUTES.CLINICIAN.REHABILITATION_PLANS}?status=active`
      )

      if (isApiError(result)) {
        setHasActiveRehabPlan(false)
        return
      }

      const plans = result.data.plans || []
      // Check if there's an active plan for this case
      const activePlanForCase = plans.find((p: any) => p.exceptionId === caseId)
      setHasActiveRehabPlan(!!activePlanForCase)
    } catch (err: any) {
      console.error('Error checking active rehabilitation plans:', err)
      setHasActiveRehabPlan(false)
    }
  }

  const handleStatusUpdate = async (newStatus: CaseStatus, returnToWorkInfo?: { dutyType: 'modified' | 'full', returnDate: string }) => {
    if (!caseId || !caseDetail || updating) return

    // If return_to_work, show modal first
    if (newStatus === 'return_to_work' && !returnToWorkInfo) {
      setShowReturnToWorkModal(true)
      return
    }

    try {
      setUpdating(true)
      setError('')
      setShowUpdateModal(false)
      setShowReturnToWorkModal(false)

      const requestBody: any = { status: newStatus }
      if (newStatus === 'return_to_work' && returnToWorkInfo) {
        requestBody.return_to_work_duty_type = returnToWorkInfo.dutyType
        requestBody.return_to_work_date = returnToWorkInfo.returnDate
      }

      const result = await apiClient.patch<{ message: string }>(
        `${API_ROUTES.CLINICIAN.CASE(caseId)}/status`,
        requestBody
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to update case status')
      }

      // Status is saved on backend, no need for localStorage
      // Update local state with new status
      const statusLabel = STATUS_STAGES.find(s => s.key === newStatus)?.label || newStatus.toUpperCase()
      
      // Update caseDetail with new status everywhere
      setCaseDetail(prev => {
        if (!prev) return null
        return {
          ...prev,
          caseStatus: newStatus,
          status: statusLabel, // Update the displayed status too
        }
      })

      // Show success alert
      setUpdateAlert(`Case status updated to ${statusLabel}`)
      
      // Auto-hide alert after 5 seconds
      setTimeout(() => setUpdateAlert(null), 5000)

      // Refresh case data to get latest from server
      await fetchCaseDetail()
      
      // Refresh active rehabilitation plan check
      await checkActiveRehabPlans()

      // Call onUpdate callback to refresh parent
      onUpdate?.()
    } catch (err: any) {
      console.error('Error updating case status:', err)
      setError(err.message || 'Failed to update case status')
      alert(err.message || 'Failed to update case status')
    } finally {
      setUpdating(false)
    }
  }

  const getAvailableNextStatuses = (): CaseStatus[] => {
    if (!caseDetail) return []
    
    // BUSINESS RULE: If case is "return_to_work", only allow "closed" or keep as "return_to_work"
    if (caseDetail.caseStatus === 'return_to_work') {
      return ['closed'] // Only allow changing to closed
    }
    
    // BUSINESS RULE: If there are active rehabilitation plans, exclude return_to_work and closed
    let availableStatuses = STATUS_ORDER.filter(status => status !== caseDetail.caseStatus)
    
    if (hasActiveRehabPlan) {
      availableStatuses = availableStatuses.filter(status => 
        status !== 'return_to_work' && status !== 'closed'
      )
    }
    
    return availableStatuses
  }
  
  const getDisplayStatus = (): string => {
    if (!caseDetail) return ''
    return caseDetail.status || getStatusDisplayLabel(caseDetail.caseStatus)
  }

  const getStatusButtonConfig = (status: CaseStatus) => {
    switch (status) {
      case 'new':
        return {
          label: 'Mark as New',
          color: '#10B981',
          bg: '#D1FAE5',
          border: '#A7F3D0'
        }
      case 'triaged':
        return {
          label: 'Mark as Triaged',
          color: '#3B82F6',
          bg: '#DBEAFE',
          border: '#BFDBFE'
        }
      case 'assessed':
        return {
          label: 'Mark as Assessed',
          color: '#8B5CF6',
          bg: '#F3E8FF',
          border: '#E9D5FF'
        }
      case 'in_rehab':
        return {
          label: 'Start Rehabilitation',
          color: '#14B8A6',
          bg: '#F0FDFA',
          border: '#CCFBF1'
        }
      case 'return_to_work':
        return {
          label: 'Return to Work',
          color: '#F59E0B',
          bg: '#FFFBEB',
          border: '#FEF3C7'
        }
      case 'closed':
        return {
          label: 'Close Case',
          color: '#EF4444',
          bg: '#FEF2F2',
          border: '#FEE2E2'
        }
      default:
        return {
          label: STATUS_STAGES.find(s => s.key === status)?.label || getStatusDisplayLabel(status),
          color: '#3B82F6',
          bg: '#EFF6FF',
          border: '#DBEAFE'
        }
    }
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

    // Create a print-friendly window
    const printWindow = window.open('', '_blank', 'width=800,height=600')
    if (!printWindow) {
      alert('Please allow popups to print this document')
      return
    }

    // Pre-compute values for print template
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

    // Create print-friendly HTML
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
            @media print {
              .no-print {
                display: none !important;
              }
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

    // Wait for content to load, then trigger print
    setTimeout(() => {
      printWindow.focus()
      printWindow.print()
      // Optionally close the window after printing
      // Note: Some browsers may block this, so it's commented out
      // printWindow.close()
    }, 500)
  }

  if (!caseId) return null

  return (
    <div className="case-detail-overlay" onClick={onClose}>
      <div className="case-detail-modal" onClick={(e) => e.stopPropagation()}>
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
            <button 
              className="case-action-btn update-btn" 
              onClick={() => setShowUpdateModal(true)}
              disabled={updating}
                title="Update case status"
              >
                <Icons.UpdateIcon />
                <span>Update Status</span>
            </button>
          </div>
          </div>
          <button className="case-detail-close" onClick={onClose} title="Close modal">
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
            {/* Update Alert */}
            {updateAlert && (
              <div className="case-update-alert">
                <Icons.CheckIcon />
                <span>{updateAlert}</span>
                <button className="alert-close" onClick={() => setUpdateAlert(null)}>
                  <Icons.CloseIcon size={16} />
                </button>
              </div>
            )}

            {/* Active Rehabilitation Plan Warning */}
            {hasActiveRehabPlan && (
              <div className="case-update-alert" style={{ 
                backgroundColor: '#FEF3C7', 
                borderColor: '#FCD34D',
                color: '#92400E'
              }}>
                <Icons.AlertIcon />
                <span>Active rehabilitation plans exist. Please complete or cancel all active rehabilitation plans before marking the case as "Return to Work" or "Closed".</span>
              </div>
            )}

            {/* Two Column Layout */}
            <div className="case-detail-main-grid">
              {/* Left Column */}
              <div className="case-detail-column">
                {/* Case Information */}
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
                    {/* Show return to work information if it exists, even when status is closed */}
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

                {/* Incident Details */}
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

              {/* Right Column */}
              <div className="case-detail-column">
                {/* Worker Information */}
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

                {/* Supervisor Information */}
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
                      <span className="case-info-badge approved">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        APPROVED BY WHS REVIEW
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Incident Photo Section */}
            {caseDetail.incident.photoUrl && (
              <IncidentPhoto photoUrl={caseDetail.incident.photoUrl} />
            )}

            {/* AI Analysis Section */}
            {caseDetail.incident.aiAnalysis && (
              <AiAnalysis analysis={caseDetail.incident.aiAnalysis} />
            )}

            {/* Case Progress Timeline */}
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

            {/* Update Status Modal */}
            {showUpdateModal && (
              <div className="status-update-overlay" onClick={() => setShowUpdateModal(false)}>
                <div className="status-update-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="status-update-header">
                    <h3>Update Case Status</h3>
                    <button className="status-update-close" onClick={() => setShowUpdateModal(false)}>
                      <Icons.CloseIcon size={20} />
                    </button>
                  </div>
                  <div className="status-update-content">
                    <p className="status-update-instruction">Select new status for this case:</p>
                    {hasActiveRehabPlan && (
                      <div style={{
                        padding: '12px 16px',
                        backgroundColor: '#FEF3C7',
                        border: '1px solid #FCD34D',
                        borderRadius: '8px',
                        marginBottom: '16px',
                        color: '#92400E',
                        fontSize: '14px'
                      }}>
                        <strong>Note:</strong> Active rehabilitation plans exist. "Return to Work" and "Close Case" options are disabled until all active plans are completed or cancelled.
                      </div>
                    )}
                    <div className="status-update-options">
                      {getAvailableNextStatuses().map((status) => {
                          const config = getStatusButtonConfig(status)
                          return (
                            <button
                              key={status}
                              className="status-option-btn"
                              style={{
                                color: config.color,
                                borderColor: config.border,
                                backgroundColor: config.bg,
                              }}
                              onClick={() => handleStatusUpdate(status)}
                              disabled={updating}
                            >
                              {config.label}
                            </button>
                          )
                        })}
                    </div>
                    <div className="status-update-footer">
                      <button 
                        className="status-update-cancel" 
                        onClick={() => setShowUpdateModal(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Return to Work Modal */}
            {showReturnToWorkModal && (
              <div className="status-update-overlay" onClick={() => setShowReturnToWorkModal(false)}>
                <div className="status-update-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="status-update-header">
                    <h3>Return to Work</h3>
                    <button className="status-update-close" onClick={() => setShowReturnToWorkModal(false)}>
                      <Icons.CloseIcon size={20} />
                    </button>
                  </div>
                  <div className="status-update-content">
                    <p className="status-update-instruction">Please provide return to work details:</p>
                    
                    <div style={{ marginBottom: '20px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, color: '#374151' }}>
                        Duty Type *
                      </label>
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <label style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '8px', 
                          padding: '12px 16px', 
                          border: `2px solid ${returnToWorkData.dutyType === 'modified' ? '#3B82F6' : '#E5E7EB'}`,
                          borderRadius: '8px',
                          cursor: 'pointer',
                          backgroundColor: returnToWorkData.dutyType === 'modified' ? '#EFF6FF' : '#FFFFFF',
                          transition: 'all 0.2s'
                        }}>
                          <input
                            type="radio"
                            name="dutyType"
                            value="modified"
                            checked={returnToWorkData.dutyType === 'modified'}
                            onChange={(e) => setReturnToWorkData({ ...returnToWorkData, dutyType: 'modified' })}
                            style={{ cursor: 'pointer' }}
                          />
                          <span>Modified Duties</span>
                        </label>
                        <label style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '8px', 
                          padding: '12px 16px', 
                          border: `2px solid ${returnToWorkData.dutyType === 'full' ? '#3B82F6' : '#E5E7EB'}`,
                          borderRadius: '8px',
                          cursor: 'pointer',
                          backgroundColor: returnToWorkData.dutyType === 'full' ? '#EFF6FF' : '#FFFFFF',
                          transition: 'all 0.2s'
                        }}>
                          <input
                            type="radio"
                            name="dutyType"
                            value="full"
                            checked={returnToWorkData.dutyType === 'full'}
                            onChange={(e) => setReturnToWorkData({ ...returnToWorkData, dutyType: 'full' })}
                            style={{ cursor: 'pointer' }}
                          />
                          <span>Full Duties</span>
                        </label>
                      </div>
                    </div>

                    <div style={{ marginBottom: '20px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, color: '#374151' }}>
                        Date of when this occurs *
                      </label>
                      <input
                        type="date"
                        value={returnToWorkData.returnDate}
                        onChange={(e) => setReturnToWorkData({ ...returnToWorkData, returnDate: e.target.value })}
                        min={getTodayDateString()} // SECURITY: Prevent selecting past dates
                        required
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          border: '1px solid #E5E7EB',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontFamily: 'inherit'
                        }}
                      />
                      <p style={{ fontSize: '12px', color: '#6B7280', margin: '4px 0 0 0' }}>
                        Select a future date for return to work
                      </p>
                    </div>

                    <div className="status-update-footer">
                      <button 
                        className="status-update-cancel" 
                        onClick={() => {
                          setShowReturnToWorkModal(false)
                          setReturnToWorkData({ dutyType: 'modified', returnDate: '' })
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="status-option-btn"
                        style={{
                          color: '#F59E0B',
                          borderColor: '#FEF3C7',
                          backgroundColor: '#FFFBEB',
                        }}
                        onClick={() => {
                          // SECURITY: Client-side validation before API call
                          if (!returnToWorkData.returnDate) {
                            alert('Please select a return date')
                            return
                          }
                          
                          // OPTIMIZATION: Validate date is not in the past
                          const selectedDate = new Date(returnToWorkData.returnDate)
                          const today = new Date()
                          today.setHours(0, 0, 0, 0)
                          selectedDate.setHours(0, 0, 0, 0)
                          
                          if (selectedDate < today) {
                            alert('Return date cannot be in the past')
                            return
                          }
                          
                          handleStatusUpdate('return_to_work', returnToWorkData)
                        }}
                        disabled={updating || !returnToWorkData.returnDate}
                      >
                        {updating ? 'Updating...' : 'Confirm Return to Work'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

