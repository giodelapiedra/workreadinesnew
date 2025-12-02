import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { parseNotes } from '../../../utils/notesParser'
import { formatDutyTypeLabel } from '../../../utils/dutyTypeUtils'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { getTodayDateString } from '../../../shared/date'
import type { AiAnalysisResult, IncidentData } from '../../../components/incident/types'
import { IncidentPhoto, AiAnalysis } from '../../../components/incident'
import './CaseDetail.css'

type CaseStatus = 'new' | 'triaged' | 'assessed' | 'in_rehab' | 'return_to_work' | 'closed'

// Backend response interfaces for type safety
interface ClinicianCaseResponse {
  id: string
  caseNumber: string
  workerId: string
  workerName: string
  workerEmail: string
  workerInitials: string
  workerGender?: string | null
  workerAge?: number | null
  teamId: string
  teamName: string
  siteLocation: string
  supervisorName?: string
  teamLeaderName?: string
  type: string
  reason: string
  startDate: string
  endDate?: string | null
  status: string
  priority: string
  isActive: boolean
  isInRehab: boolean
  caseStatus: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  return_to_work_duty_type?: string | null
  return_to_work_date?: string | null
  phone?: string | null
  incidentPhotoUrl?: string | null  // ✅ Properly typed
  incidentAiAnalysis?: any | null    // ✅ Properly typed
}

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

export function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { role } = useAuth()
  
  // SECURITY: Determine view context based on route
  // Backend enforces actual permissions - this is for UI/UX only
  const isAdminView = location.pathname.startsWith('/dashboard/admin/')
  const isReadOnly = isAdminView || role === 'admin'
  
  // SECURITY NOTE: Frontend checks are for UX only!
  // Backend MUST enforce role-based access control (RBAC)
  // Each API endpoint checks user permissions before returning data
  
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
  const [rehabPlan, setRehabPlan] = useState<any | null>(null)
  const [rehabProgress, setRehabProgress] = useState<any | null>(null)
  const [loadingRehab, setLoadingRehab] = useState(false)
  const [hasActiveRehabPlan, setHasActiveRehabPlan] = useState(false)
  const [editingClinicalNotes, setEditingClinicalNotes] = useState(false)
  const [clinicalNotesText, setClinicalNotesText] = useState('')
  const [savingClinicalNotes, setSavingClinicalNotes] = useState(false)
  
  const [editingAiAnalysis, setEditingAiAnalysis] = useState(false)
  const [aiAnalysisData, setAiAnalysisData] = useState<AiAnalysisResult | null>(null)
  const [savingAiAnalysis, setSavingAiAnalysis] = useState(false)

  // Cancellation guard to prevent state updates after unmount
  const isMountedRef = useRef(true)

  const fetchCaseDetail = useCallback(async () => {
    if (!caseId) return

    try {
      if (!isMountedRef.current) return
      setLoading(true)
      if (!isMountedRef.current) return
      setError('')

      // OPTIMIZED: Direct API call for single case instead of fetching all cases
      // Use admin endpoint if admin view, otherwise clinician endpoint
      const apiEndpoint = isAdminView 
        ? API_ROUTES.ADMIN.CLINICIAN_CASE(caseId)
        : API_ROUTES.CLINICIAN.CASE(caseId)
      
      const result = await apiClient.get<any>(apiEndpoint)

      if (isApiError(result)) {
        if (result.error?.status === 404) {
          throw new Error('Case not found or not authorized')
        }
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch case details')
      }

      const data = result.data
      // Admin endpoint returns case directly, clinician endpoint wraps it in { case: ... }
      const caseItem = isAdminView ? data : data.case

      if (!caseItem) {
        throw new Error('Case not found')
      }

      // Type assertion for better type safety
      const clinicianCase = caseItem as ClinicianCaseResponse
      
      // Admin endpoint returns different format - map it to expected format
      let mappedCaseItem: ClinicianCaseResponse
      if (isAdminView) {
        // Map admin response format to clinician format
        mappedCaseItem = {
          id: caseItem.id,
          caseNumber: caseItem.caseNumber,
          workerId: caseItem.worker?.id,
          workerName: caseItem.worker?.name,
          workerEmail: caseItem.worker?.email,
          workerInitials: caseItem.worker?.initials,
          workerGender: caseItem.worker?.gender,
          workerAge: caseItem.worker?.age,
          teamId: caseItem.team?.id || '',
          teamName: caseItem.team?.teamName || '',
          teamLeaderName: caseItem.team?.teamLeaderName,
          supervisorName: caseItem.team?.supervisorName,
          siteLocation: caseItem.team?.siteLocation || '',
          type: caseItem.incident?.type || '',
          reason: caseItem.incident?.description || '',
          startDate: caseItem.incident?.date || '',
          endDate: caseItem.incident?.endDate,
          status: caseItem.status,
          priority: caseItem.priority,
          isActive: true,
          isInRehab: false,
          createdAt: caseItem.createdAt,
          updatedAt: caseItem.updatedAt || caseItem.createdAt,
          caseStatus: caseItem.caseStatus,
          notes: null, // Admin endpoint doesn't return notes
          return_to_work_duty_type: caseItem.returnToWorkDutyType,
          return_to_work_date: caseItem.returnToWorkDate,
          phone: caseItem.worker?.phone,
          incidentPhotoUrl: caseItem.incident?.photoUrl || null,
          incidentAiAnalysis: caseItem.incident?.aiAnalysis || null,
        }
      } else {
        // Clinician endpoint already has correct format
        mappedCaseItem = clinicianCase
      }

      const notesData = parseNotes(mappedCaseItem.notes)
      
      let caseStatus: CaseStatus = 'new'
      
      // Admin endpoint returns caseStatus directly, clinician endpoint uses notes
      if (isAdminView && mappedCaseItem.caseStatus) {
        const adminCaseStatus = mappedCaseItem.caseStatus
        // Map admin caseStatus format to CaseStatus type
        if (adminCaseStatus === 'closed') caseStatus = 'closed'
        else if (adminCaseStatus === 'in_rehab') caseStatus = 'in_rehab'
        else if (adminCaseStatus === 'return_to_work') caseStatus = 'return_to_work'
        else if (adminCaseStatus === 'assessed') caseStatus = 'assessed'
        else if (adminCaseStatus === 'triaged') caseStatus = 'triaged'
        else caseStatus = 'new'
      } else if (mappedCaseItem.caseStatus) {
        caseStatus = mappedCaseItem.caseStatus as CaseStatus
      } else if (notesData?.case_status) {
        caseStatus = notesData.case_status as CaseStatus
      }
      
      // Fallback: determine from status string if caseStatus not set
      if (caseStatus === 'new') {
        if (mappedCaseItem.status === 'CLOSED') {
          caseStatus = 'closed'
        } else if (mappedCaseItem.status === 'IN REHAB') {
          caseStatus = 'in_rehab'
        } else if (mappedCaseItem.status === 'ACTIVE') {
          caseStatus = 'assessed'
        }
      }

      const approvedBy = notesData?.approved_by || (isAdminView ? caseItem.approvedBy : undefined)
      const approvedAt = notesData?.approved_at || (isAdminView ? caseItem.approvedAt : undefined)
      const returnToWorkDutyType = mappedCaseItem.return_to_work_duty_type as 'modified' | 'full' | undefined
      const returnToWorkDate = mappedCaseItem.return_to_work_date as string | undefined
      const clinicalNotes = isAdminView 
        ? (caseItem.clinicalNotes || '')
        : (notesData?.clinical_notes || '')
      const clinicalNotesUpdatedAt = isAdminView 
        ? caseItem.clinicalNotesUpdatedAt 
        : notesData?.clinical_notes_updated_at
      const displayStatus = getStatusDisplayLabel(caseStatus)

      const detail: CaseDetail = {
        id: mappedCaseItem.id,
        caseNumber: mappedCaseItem.caseNumber,
        status: displayStatus,
        priority: mappedCaseItem.priority as 'HIGH' | 'MEDIUM' | 'LOW',
        createdAt: mappedCaseItem.createdAt,
        worker: {
          id: mappedCaseItem.workerId,
          name: mappedCaseItem.workerName,
          email: mappedCaseItem.workerEmail,
          phone: mappedCaseItem.phone || 'N/A',
          role: 'WORKER',
          initials: mappedCaseItem.workerInitials,
          gender: mappedCaseItem.workerGender || null,
          age: mappedCaseItem.workerAge || null,
        },
        team: {
          teamName: mappedCaseItem.teamName,
          teamLeaderName: mappedCaseItem.teamLeaderName,
          supervisorName: mappedCaseItem.supervisorName,
          siteLocation: mappedCaseItem.siteLocation,
          clinician: undefined, // Not used in clinician view
          caseManager: undefined, // Not used in clinician view
        },
        incident: {
          number: mappedCaseItem.id,
          date: mappedCaseItem.startDate || mappedCaseItem.createdAt,
          type: mappedCaseItem.type,
          severity: 'MEDICAL TREATMENT', // Default severity for all cases
          description: mappedCaseItem.reason || 'No description provided',
          // ✅ SECURITY: These fields come from backend response after RBAC check
          photoUrl: mappedCaseItem.incidentPhotoUrl || null,
          aiAnalysis: mappedCaseItem.incidentAiAnalysis || null,
        },
        caseStatus,
        approvedBy,
        approvedAt,
        returnToWorkDutyType,
        returnToWorkDate,
        clinicalNotes,
        clinicalNotesUpdatedAt,
      }

      if (!isMountedRef.current) return
      setCaseDetail(detail)
    } catch (err: any) {
      if (!isMountedRef.current) return
      console.error('Error fetching case detail:', err)
      setError(err.message || 'Failed to load case details')
    } finally {
      if (isMountedRef.current) {
      setLoading(false)
    }
  }
  }, [caseId, isAdminView, apiClient, API_ROUTES, parseNotes, getStatusDisplayLabel])

  const fetchRehabilitationPlan = useCallback(async () => {
    if (!caseId) return

    try {
      if (!isMountedRef.current) return
      setLoadingRehab(true)
      
      // For admin view, skip rehabilitation plan fetch (or use admin endpoint if available)
      if (isAdminView) {
        // Admin can see rehab plan progress via the case detail endpoint
        // For now, skip fetching separate rehab plans
        if (isMountedRef.current) {
        setLoadingRehab(false)
        }
        return
      }
      
      // Get all rehabilitation plans to find the one for this case
      const result = await apiClient.get<{ plans: any[] }>(
        `${API_ROUTES.CLINICIAN.REHABILITATION_PLANS}?status=all`
      )

      if (!isMountedRef.current) return

      if (isApiError(result)) {
        return // No plan available
      }

      const plans = result.data.plans || []
      
      // Find plan for this case (caseId is the exception_id)
      const planForCase = plans.find((p: any) => p.exceptionId === caseId)
      
      // Check if there's an active plan for this case
      const activePlanForCase = plans.find((p: any) => p.exceptionId === caseId && p.status === 'active')
      if (!isMountedRef.current) return
      setHasActiveRehabPlan(!!activePlanForCase)
      
      if (planForCase) {
        if (!isMountedRef.current) return
        setRehabPlan(planForCase)
        
        // Fetch detailed progress
        const progressResult = await apiClient.get<any>(
          `${API_ROUTES.CLINICIAN.REHABILITATION_PLAN(planForCase.id)}/progress`
        )

        if (!isMountedRef.current) return

        if (!isApiError(progressResult)) {
          if (isMountedRef.current) {
          setRehabProgress(progressResult.data)
          }
        }
      }
    } catch (err: any) {
      if (!isMountedRef.current) return
      console.error('Error fetching rehabilitation plan:', err)
      // Don't show error, just no plan available
    } finally {
      if (isMountedRef.current) {
      setLoadingRehab(false)
    }
  }
  }, [caseId, isAdminView, apiClient, API_ROUTES])

  // Set mounted ref to true on mount and when caseId changes
  useEffect(() => {
    isMountedRef.current = true
  }, [caseId])

  useEffect(() => {
    if (caseId) {
      fetchCaseDetail()
      fetchRehabilitationPlan()
    }
  }, [caseId, fetchCaseDetail, fetchRehabilitationPlan])

  // Cleanup: mark component as unmounted only on component unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const formatDateLong = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    })
  }

  const handleStatusUpdate = async (newStatus: CaseStatus, returnToWorkInfo?: { dutyType: 'modified' | 'full', returnDate: string }) => {
    if (!caseId || !caseDetail || updating) return

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

      const statusLabel = STATUS_STAGES.find(s => s.key === newStatus)?.label || newStatus.toUpperCase()
      
      setCaseDetail(prev => {
        if (!prev) return null
        return {
          ...prev,
          caseStatus: newStatus,
          status: statusLabel,
        }
      })

      setUpdateAlert(`Case status updated to ${statusLabel}`)
      setTimeout(() => setUpdateAlert(null), 5000)

      await fetchCaseDetail()
      await fetchRehabilitationPlan() // Refresh active rehab plan check
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
        return { label: 'Mark as New', color: '#10B981', bg: '#D1FAE5', border: '#A7F3D0' }
      case 'triaged':
        return { label: 'Mark as Triaged', color: '#3B82F6', bg: '#DBEAFE', border: '#BFDBFE' }
      case 'assessed':
        return { label: 'Mark as Assessed', color: '#8B5CF6', bg: '#F3E8FF', border: '#E9D5FF' }
      case 'in_rehab':
        return { label: 'Start Rehabilitation', color: '#14B8A6', bg: '#F0FDFA', border: '#CCFBF1' }
      case 'return_to_work':
        return { label: 'Return to Work', color: '#F59E0B', bg: '#FFFBEB', border: '#FEF3C7' }
      case 'closed':
        return { label: 'Close Case', color: '#EF4444', bg: '#FEF2F2', border: '#FEE2E2' }
      default:
        return { label: STATUS_STAGES.find(s => s.key === status)?.label || getStatusDisplayLabel(status), color: '#3B82F6', bg: '#EFF6FF', border: '#DBEAFE' }
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

    // Rehabilitation Plan HTML
    let rehabPlanHtml = ''
    if (rehabPlan && rehabProgress) {
      const dailyProgressHtml = rehabProgress.dailyProgress.map((day: any) => {
        const isCompleted = day.status === 'completed'
        const isCurrent = day.status === 'current'
        const statusText = isCompleted ? '✓ Completed' : isCurrent ? '→ Current' : '○ Pending'
        return `
          <div class="print-rehab-day">
            <div class="print-rehab-day-header">
              <span class="print-rehab-day-number">Day ${day.dayNumber}</span>
              <span class="print-rehab-day-status">${statusText}</span>
            </div>
            <div class="print-rehab-day-date">${formatDateLong(day.date)}</div>
            ${isCompleted ? `<div class="print-rehab-day-progress">${day.exercisesCompleted} of ${day.totalExercises} exercises completed</div>` : ''}
          </div>
        `
      }).join('')

      rehabPlanHtml = `
        <div class="print-section">
          <h2>Rehabilitation Plan Progress</h2>
          <div class="print-rehab-plan-info">
            <div class="print-row">
              <span class="print-label">Plan Name:</span>
              <span class="print-value">${rehabProgress.plan.plan_name}</span>
            </div>
            <div class="print-row">
              <span class="print-label">Status:</span>
              <span class="print-value">${rehabProgress.plan.status === 'active' ? 'Active' : rehabProgress.plan.status}</span>
            </div>
            <div class="print-row">
              <span class="print-label">Overall Progress:</span>
              <span class="print-value">${rehabProgress.plan.progress}%</span>
            </div>
            <div class="print-row">
              <span class="print-label">Current Day:</span>
              <span class="print-value">Day ${rehabProgress.plan.currentDay} of ${rehabProgress.plan.duration}</span>
            </div>
            <div class="print-row">
              <span class="print-label">Days Completed:</span>
              <span class="print-value">${rehabProgress.plan.daysCompleted}</span>
            </div>
          </div>
          <div class="print-rehab-timeline">
            <h3 style="font-size: 14px; margin: 20px 0 10px 0; color: #333;">Daily Progress Timeline</h3>
            ${dailyProgressHtml}
          </div>
        </div>
      `
    }

    // Clinical Notes HTML
    const clinicalNotesHtml = caseDetail.clinicalNotes ? `
      <div class="print-section">
        <h2>Clinical Notes</h2>
        <div class="print-clinical-notes">
          ${caseDetail.clinicalNotes.split('\n').map(line => `<p class="print-notes-line">${line || '&nbsp;'}</p>`).join('')}
        </div>
        ${caseDetail.clinicalNotesUpdatedAt ? `
        <div class="print-notes-footer">
          Last updated: ${formatDate(caseDetail.clinicalNotesUpdatedAt)} ${new Date(caseDetail.clinicalNotesUpdatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </div>
        ` : ''}
      </div>
    ` : `
      <div class="print-section">
        <h2>Clinical Notes</h2>
        <div class="print-clinical-notes-empty">
          No clinical notes available
        </div>
      </div>
    `

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Case Details - ${caseDetail.caseNumber}</title>
          <style>
            @media print {
              @page {
                margin: 1.5cm;
                size: A4;
              }
            }
            * {
              box-sizing: border-box;
            }
            body {
              font-family: 'Arial', 'Helvetica', sans-serif;
              padding: 0;
              margin: 0;
              color: #000;
              font-size: 12px;
              line-height: 1.5;
            }
            .print-header {
              border-bottom: 3px solid #000;
              padding-bottom: 15px;
              margin-bottom: 25px;
            }
            .print-header h1 {
              margin: 0 0 8px 0;
              font-size: 28px;
              font-weight: bold;
              color: #000;
            }
            .print-header p {
              margin: 0;
              color: #666;
              font-size: 11px;
            }
            .print-section {
              margin-bottom: 30px;
              page-break-inside: avoid;
            }
            .print-section h2 {
              font-size: 16px;
              font-weight: bold;
              margin: 0 0 12px 0;
              padding-bottom: 8px;
              border-bottom: 2px solid #333;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #000;
            }
            .print-section h3 {
              font-size: 14px;
              font-weight: bold;
              margin: 15px 0 8px 0;
              color: #333;
            }
            .print-row {
              display: flex;
              padding: 6px 0;
              border-bottom: 1px solid #e0e0e0;
              min-height: 24px;
            }
            .print-row:last-child {
              border-bottom: none;
            }
            .print-label {
              font-weight: bold;
              width: 200px;
              color: #333;
              flex-shrink: 0;
            }
            .print-value {
              flex: 1;
              color: #000;
              word-wrap: break-word;
            }
            .print-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 40px;
              margin-bottom: 25px;
            }
            .print-timeline {
              margin-top: 25px;
            }
            .print-timeline h2 {
              margin-bottom: 15px;
            }
            .print-rehab-plan-info {
              margin-bottom: 20px;
            }
            .print-rehab-timeline {
              margin-top: 15px;
            }
            .print-rehab-day {
              margin-bottom: 12px;
              padding: 10px;
              border: 1px solid #ddd;
              border-radius: 4px;
              background: #f9f9f9;
            }
            .print-rehab-day-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 6px;
            }
            .print-rehab-day-number {
              font-weight: bold;
              color: #000;
            }
            .print-rehab-day-status {
              font-size: 11px;
              color: #666;
            }
            .print-rehab-day-date {
              font-size: 11px;
              color: #666;
              margin-bottom: 4px;
            }
            .print-rehab-day-progress {
              font-size: 11px;
              color: #666;
              margin-top: 4px;
            }
            .print-clinical-notes {
              background: #f8f8f8;
              border: 1px solid #ddd;
              padding: 15px;
              border-radius: 4px;
              margin-top: 10px;
              min-height: 100px;
            }
            .print-notes-line {
              margin: 0 0 8px 0;
              white-space: pre-wrap;
              word-wrap: break-word;
            }
            .print-notes-line:last-child {
              margin-bottom: 0;
            }
            .print-notes-footer {
              margin-top: 10px;
              font-size: 10px;
              color: #666;
              font-style: italic;
            }
            .print-clinical-notes-empty {
              padding: 20px;
              text-align: center;
              color: #999;
              font-style: italic;
              border: 1px dashed #ddd;
              border-radius: 4px;
            }
            @media print {
              .no-print {
                display: none !important;
              }
              body {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body>
          <div class="print-header">
            <h1>Case Details Report</h1>
            <p>Case Number: ${caseDetail.caseNumber} | Printed on: ${printDate}</p>
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
                ${caseDetail.returnToWorkDutyType ? `
                <div class="print-row">
                  <span class="print-label">Return to Work Duty Type:</span>
                  <span class="print-value">${formatDutyTypeLabel(caseDetail.returnToWorkDutyType)}</span>
                </div>
                ` : ''}
                ${caseDetail.returnToWorkDate ? `
                <div class="print-row">
                  <span class="print-label">Return to Work Date:</span>
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
                  <span class="print-label">Severity:</span>
                  <span class="print-value">${caseDetail.incident.severity}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Description:</span>
                  <span class="print-value">${caseDetail.incident.description || 'No description provided'}</span>
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
                  <span class="print-label">Phone:</span>
                  <span class="print-value">${caseDetail.worker.phone || 'N/A'}</span>
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
                  <span class="print-label">Case Manager:</span>
                  <span class="print-value">${caseDetail.team.caseManager?.name || 'N/A'}</span>
                </div>
                <div class="print-row">
                  <span class="print-label">Clinician:</span>
                  <span class="print-value">${caseDetail.team.clinician?.name || 'N/A'}</span>
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

          ${rehabPlanHtml}

          ${clinicalNotesHtml}
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
            <button onClick={() => navigate(PROTECTED_ROUTES.CLINICIAN.MY_CASES)}>
              Back to Cases
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
                {!isReadOnly && (
                  <button 
                    className="case-action-btn update-btn" 
                    onClick={() => setShowUpdateModal(true)}
                    disabled={updating}
                    title="Update case status"
                  >
                    <Icons.UpdateIcon />
                    <span>Update Status</span>
                  </button>
                )}
              </div>
            </div>
            <button 
              className="case-detail-close" 
              onClick={() => navigate(PROTECTED_ROUTES.CLINICIAN.MY_CASES)} 
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
                      {caseDetail.team.clinician && (
                        <div className="case-info-row">
                          <span className="case-info-label">Assigned Clinician:</span>
                          <span className="case-info-value" style={{ color: '#3B82F6', fontWeight: 600 }}>
                            {caseDetail.team.clinician.name}
                            {caseDetail.team.clinician.email && ` (${caseDetail.team.clinician.email})`}
                          </span>
                        </div>
                      )}
                      {(caseDetail.caseStatus === 'closed' || caseDetail.caseStatus === 'return_to_work') && caseDetail.approvedBy && (
                        <div className="case-info-row">
                          <span className="case-info-label">Approved by Clinician:</span>
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
                <IncidentPhoto 
                  photoUrl={caseDetail.incident.photoUrl} 
                />
              )}

              {/* AI Analysis Section - Editable for Clinician */}
              {caseDetail.incident.aiAnalysis && (
                <div className="case-info-section ai-analysis-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 className="case-section-header">
                      <span className="ai-analysis-header-content">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"></path>
                          <path d="M16 10v1a4 4 0 0 1-8 0v-1"></path>
                          <rect x="3" y="14" width="18" height="8" rx="2"></rect>
                          <line x1="7" y1="18" x2="7" y2="18"></line>
                          <line x1="12" y1="18" x2="12" y2="18"></line>
                          <line x1="17" y1="18" x2="17" y2="18"></line>
                        </svg>
                        AI ANALYSIS
                      </span>
                    </h3>
                    {!isReadOnly && !editingAiAnalysis && (
                      <button
                        onClick={() => {
                          setAiAnalysisData(caseDetail.incident.aiAnalysis as AiAnalysisResult)
                          setEditingAiAnalysis(true)
                        }}
                        style={{
                          padding: '6px 14px',
                          background: '#3B82F6',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        Edit Analysis
                      </button>
                    )}
                  </div>
                  <div className="case-info-divider"></div>
                  
                  {!editingAiAnalysis ? (
                    <div className="ai-analysis-container">
                      <div className="ai-analysis-content">
                        {/* Display Current AI Analysis */}
                        {(() => {
                          const analysis = caseDetail.incident.aiAnalysis as AiAnalysisResult
                          const getRiskLevelColors = (riskLevel: string) => {
                            const level = riskLevel.toLowerCase()
                            if (level === 'high') return { background: '#FEE2E2', color: '#DC2626' }
                            if (level === 'medium') return { background: '#FEF3C7', color: '#D97706' }
                            return { background: '#D1FAE5', color: '#059669' }
                          }
                          
                          return (
                            <>
                              {/* Risk Level Badge */}
                              {analysis.riskLevel && (
                                <div className="ai-analysis-risk-badge-container">
                                  <span 
                                    className="ai-analysis-risk-badge"
                                    style={getRiskLevelColors(analysis.riskLevel)}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                      <line x1="12" y1="9" x2="12" y2="13"></line>
                                      <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                    </svg>
                                    Risk Level: {analysis.riskLevel}
                                  </span>
                                </div>
                              )}

                              {/* Summary */}
                              {analysis.summary && (
                                <div className="ai-analysis-section-block">
                                  <h4 className="ai-analysis-section-title">Summary</h4>
                                  <p className="ai-analysis-summary-text">
                                    {analysis.summary}
                                  </p>
                                </div>
                              )}

                              {/* Injury Details */}
                              {(analysis.injuryType || analysis.bodyPart) && (
                                <div className="ai-analysis-details-grid">
                                  {analysis.injuryType && (
                                    <div className="ai-analysis-detail-card">
                                      <span className="ai-analysis-detail-label">Injury Type</span>
                                      <p className="ai-analysis-detail-value">{analysis.injuryType}</p>
                                    </div>
                                  )}
                                  {analysis.bodyPart && (
                                    <div className="ai-analysis-detail-card">
                                      <span className="ai-analysis-detail-label">Body Part</span>
                                      <p className="ai-analysis-detail-value">{analysis.bodyPart}</p>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Recommendations */}
                              {analysis.recommendations && analysis.recommendations.length > 0 && (
                                <div className="ai-analysis-section-block">
                                  <h4 className="ai-analysis-section-title">Recommendations</h4>
                                  <ul className="ai-analysis-recommendations-list">
                                    {analysis.recommendations.map((rec: string, index: number) => (
                                      <li key={index} className="ai-analysis-recommendation-item">
                                        <span className="ai-analysis-recommendation-number">
                                          {index + 1}
                                        </span>
                                        {rec}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '16px 0' }}>
                      {/* Editable Form for AI Analysis */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        
                        {/* Risk Level */}
                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>
                            Risk Level
                          </label>
                          <select
                            value={aiAnalysisData?.riskLevel || 'Low'}
                            onChange={(e) => setAiAnalysisData(prev => prev ? { ...prev, riskLevel: e.target.value } : null)}
                            style={{
                              width: '100%',
                              padding: '10px 14px',
                              fontSize: '14px',
                              border: '1px solid #E2E8F0',
                              borderRadius: '8px',
                              background: '#FFFFFF',
                            }}
                          >
                            <option value="Low">Low</option>
                            <option value="Medium">Medium</option>
                            <option value="High">High</option>
                          </select>
                        </div>
                        
                        {/* Summary */}
                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>
                            Summary
                          </label>
                          <textarea
                            value={aiAnalysisData?.summary || ''}
                            onChange={(e) => setAiAnalysisData(prev => prev ? { ...prev, summary: e.target.value } : null)}
                            rows={4}
                            style={{
                              width: '100%',
                              padding: '12px 14px',
                              fontSize: '14px',
                              border: '1px solid #E2E8F0',
                              borderRadius: '8px',
                              background: '#FFFFFF',
                              resize: 'vertical',
                              fontFamily: 'inherit',
                            }}
                          />
                        </div>
                        
                        {/* Injury Type */}
                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>
                            Injury Type
                          </label>
                          <input
                            type="text"
                            value={aiAnalysisData?.injuryType || ''}
                            onChange={(e) => setAiAnalysisData(prev => prev ? { ...prev, injuryType: e.target.value } : null)}
                            style={{
                              width: '100%',
                              padding: '10px 14px',
                              fontSize: '14px',
                              border: '1px solid #E2E8F0',
                              borderRadius: '8px',
                              background: '#FFFFFF',
                            }}
                          />
                        </div>
                        
                        {/* Body Part */}
                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>
                            Body Part
                          </label>
                          <input
                            type="text"
                            value={aiAnalysisData?.bodyPart || ''}
                            onChange={(e) => setAiAnalysisData(prev => prev ? { ...prev, bodyPart: e.target.value } : null)}
                            style={{
                              width: '100%',
                              padding: '10px 14px',
                              fontSize: '14px',
                              border: '1px solid #E2E8F0',
                              borderRadius: '8px',
                              background: '#FFFFFF',
                            }}
                          />
                        </div>
                        
                        {/* Recommendations */}
                        <div>
                          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>
                            Recommendations (one per line)
                          </label>
                          <textarea
                            value={aiAnalysisData?.recommendations?.join('\n') || ''}
                            onChange={(e) => setAiAnalysisData(prev => prev ? { 
                              ...prev, 
                              recommendations: e.target.value.split('\n').filter(line => line.trim() !== '') 
                            } : null)}
                            rows={6}
                            placeholder="Enter recommendations, one per line..."
                            style={{
                              width: '100%',
                              padding: '12px 14px',
                              fontSize: '14px',
                              border: '1px solid #E2E8F0',
                              borderRadius: '8px',
                              background: '#FFFFFF',
                              resize: 'vertical',
                              fontFamily: 'inherit',
                            }}
                          />
                        </div>
                        
                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                          <button
                            onClick={async () => {
                              if (!aiAnalysisData || !caseDetail.incident.photoUrl) return
                              
                              try {
                                setSavingAiAnalysis(true)
                                
                                // Extract incident ID from photo URL
                                const photoUrl = caseDetail.incident.photoUrl
                                const incidentIdMatch = photoUrl.match(/incident-photo\/([^?]+)/)
                                
                                if (!incidentIdMatch || !incidentIdMatch[1]) {
                                  throw new Error('Could not determine incident ID')
                                }
                                
                                const incidentId = incidentIdMatch[1]
                                
                                const result = await apiClient.patch<{ success: boolean, message: string }>(
                                  API_ROUTES.CLINICIAN.INCIDENT_AI_ANALYSIS(incidentId),
                                  { aiAnalysis: aiAnalysisData }
                                )
                                
                                if (isApiError(result)) {
                                  throw new Error(getApiErrorMessage(result) || 'Failed to save AI analysis')
                                }
                                
                                setCaseDetail(prev => {
                                  if (!prev) return null
                                  return {
                                    ...prev,
                                    incident: {
                                      ...prev.incident,
                                      aiAnalysis: aiAnalysisData
                                    }
                                  }
                                })
                                
                                setEditingAiAnalysis(false)
                                setUpdateAlert('AI analysis updated successfully')
                                setTimeout(() => setUpdateAlert(null), 5000)
                              } catch (err: any) {
                                console.error('Error saving AI analysis:', err)
                                setError(err.message || 'Failed to save AI analysis')
                                setTimeout(() => setError(''), 5000)
                              } finally {
                                setSavingAiAnalysis(false)
                              }
                            }}
                            disabled={savingAiAnalysis}
                            style={{
                              padding: '10px 20px',
                              background: '#3B82F6',
                              color: '#FFFFFF',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: savingAiAnalysis ? 'not-allowed' : 'pointer',
                              opacity: savingAiAnalysis ? 0.6 : 1,
                            }}
                          >
                            {savingAiAnalysis ? 'Saving...' : 'Save Analysis'}
                          </button>
                          <button
                            onClick={() => {
                              setEditingAiAnalysis(false)
                              setAiAnalysisData(null)
                            }}
                            disabled={savingAiAnalysis}
                            style={{
                              padding: '10px 20px',
                              background: '#F1F5F9',
                              color: '#475569',
                              border: '1px solid #E2E8F0',
                              borderRadius: '8px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: savingAiAnalysis ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
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

              {/* Clinical Notes Section */}
              {caseDetail && (
                <div className="case-info-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 className="case-section-header">CLINICAL NOTES</h3>
                    {!isReadOnly && !editingClinicalNotes && caseDetail.clinicalNotes && (
                      <button
                        onClick={() => {
                          setClinicalNotesText(caseDetail.clinicalNotes || '')
                          setEditingClinicalNotes(true)
                        }}
                        style={{
                          padding: '6px 12px',
                          fontSize: '13px',
                          background: '#F3F4F6',
                          color: '#374151',
                          border: '1px solid #D1D5DB',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        Edit
                      </button>
                    )}
                  </div>
                  <div className="case-info-divider"></div>
                  
                  {!isReadOnly && editingClinicalNotes ? (
                    <div style={{ padding: '16px 0' }}>
                      <textarea
                        value={clinicalNotesText}
                        onChange={(e) => setClinicalNotesText(e.target.value)}
                        placeholder="Enter clinical notes for this worker..."
                        style={{
                          width: '100%',
                          minHeight: '200px',
                          padding: '12px',
                          border: '1px solid #E5E7EB',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontFamily: 'inherit',
                          lineHeight: '1.5',
                          resize: 'vertical'
                        }}
                      />
                      <div style={{ display: 'flex', gap: '12px', marginTop: '12px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => {
                            setEditingClinicalNotes(false)
                            setClinicalNotesText(caseDetail.clinicalNotes || '')
                          }}
                          disabled={savingClinicalNotes}
                          style={{
                            padding: '8px 16px',
                            fontSize: '14px',
                            background: '#F3F4F6',
                            color: '#374151',
                            border: '1px solid #D1D5DB',
                            borderRadius: '6px',
                            cursor: savingClinicalNotes ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async () => {
                            if (!caseId) return
                            
                            try {
                              setSavingClinicalNotes(true)
                              
                              const result = await apiClient.patch<{ success: boolean, message: string, updatedAt?: string }>(
                                API_ROUTES.CLINICIAN.CASE_CLINICAL_NOTES(caseId),
                                { clinicalNotes: clinicalNotesText }
                              )
                              
                              if (isApiError(result)) {
                                throw new Error(getApiErrorMessage(result) || 'Failed to save clinical notes')
                              }
                              
                              setCaseDetail(prev => {
                                if (!prev) return null
                                return {
                                  ...prev,
                                  clinicalNotes: clinicalNotesText,
                                  clinicalNotesUpdatedAt: (result as any).updatedAt || new Date().toISOString()
                                }
                              })
                              
                              setEditingClinicalNotes(false)
                              setUpdateAlert('Clinical notes saved successfully')
                              setTimeout(() => setUpdateAlert(null), 5000)
                            } catch (err: any) {
                              console.error('Error saving clinical notes:', err)
                              setError(err.message || 'Failed to save clinical notes')
                              setTimeout(() => setError(''), 5000)
                            } finally {
                              setSavingClinicalNotes(false)
                            }
                          }}
                          disabled={savingClinicalNotes}
                          style={{
                            padding: '8px 16px',
                            fontSize: '14px',
                            background: '#3B82F6',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: savingClinicalNotes ? 'not-allowed' : 'pointer',
                            fontWeight: 500
                          }}
                        >
                          {savingClinicalNotes ? 'Saving...' : 'Save Notes'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '16px 0' }}>
                      {caseDetail.clinicalNotes ? (
                        <div>
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
                        </div>
                      ) : (
                        <div style={{
                          padding: '24px',
                          textAlign: 'center',
                          background: '#F8FAFC',
                          borderRadius: '8px',
                          border: '1px dashed #D1D5DB',
                          color: '#64748B'
                        }}>
                          <p style={{ margin: '0', fontSize: '14px', fontStyle: 'italic' }}>
                            No clinical notes available
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!isReadOnly && showUpdateModal && (
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
                          min={getTodayDateString()}
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
                            if (!returnToWorkData.returnDate) {
                              alert('Please select a return date')
                              return
                            }
                            
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
    </DashboardLayout>
  )
}
