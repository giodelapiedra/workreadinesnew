import React, { useState, useEffect, Fragment, useCallback, useRef } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { 
  hasActiveException as checkActiveException,
  getActiveException,
  getExceptionTypeLabel,
  type WorkerException as SharedWorkerException
} from '../../../utils/exceptionUtils'
import { getUserInitials, getAvatarColor } from '../../../utils/avatarUtils'
import { getTodayDateString } from '../../../shared/date'
import './WorkerSchedules.css'

interface Worker {
  id: string
  email: string
  first_name?: string
  last_name?: string
  full_name?: string
}

interface WorkerSchedule {
  id: string
  worker_id: string
  scheduled_date?: string | null // NULL for recurring schedules
  day_of_week?: number | null // 0-6 for recurring schedules, NULL for single-date
  effective_date?: string | null // Start date for recurring schedules
  expiry_date?: string | null // End date for recurring schedules
  start_time: string
  end_time: string
  check_in_window_start?: string
  check_in_window_end?: string
  requires_daily_checkin?: boolean
  daily_checkin_start_time?: string
  daily_checkin_end_time?: string
  project_id?: string
  notes?: string
  is_active: boolean
  created_at: string
  users?: Worker
}

// Use the shared WorkerException type from utils directly
type WorkerException = SharedWorkerException

// Type for schedule update payload
interface ScheduleUpdatePayload {
  start_time: string
  end_time: string
  check_in_window_start: string | null
  check_in_window_end: string | null
  requires_daily_checkin: boolean
  daily_checkin_start_time: string | null
  daily_checkin_end_time: string | null
  project_id: string | null
  notes: string | null
  is_active: boolean
  day_of_week?: number | null
  scheduled_date?: string | null
  effective_date?: string | null
  expiry_date?: string | null
}

export function WorkerSchedules() {
  const [schedules, setSchedules] = useState<WorkerSchedule[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [exceptions, setExceptions] = useState<WorkerException[]>([]) // Track active exceptions
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<WorkerSchedule | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [showDeactivateConfirmModal, setShowDeactivateConfirmModal] = useState(false)
  const [scheduleToDeactivate, setScheduleToDeactivate] = useState<WorkerSchedule | null>(null)
  const [showSuccessToast, setShowSuccessToast] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [showCreateConfirmModal, setShowCreateConfirmModal] = useState(false)
  const [pendingSubmit, setPendingSubmit] = useState<(() => void) | null>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const today = getTodayDateString()
  
  const [useRange, setUseRange] = useState(false) // Toggle between single date and date range
  const [selectedDays, setSelectedDays] = useState<number[]>([]) // Selected days of week (0=Sunday, 1=Monday, ..., 6=Saturday)
  const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set()) // Track which workers are expanded
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null) // Selected worker for sidebar
  const [sidebarMode, setSidebarMode] = useState<'view' | 'create' | 'edit'>('view') // Sidebar mode
  
  const [formData, setFormData] = useState({
    worker_ids: [] as string[],
    scheduled_date: today,
    start_date: today,
    end_date: '',
    days_of_week: [] as number[],
    start_time: '08:00',
    end_time: '17:00',
    check_in_window_start: '',
    check_in_window_end: '',
    requires_daily_checkin: false,
    daily_checkin_start_time: '',
    daily_checkin_end_time: '',
    project_id: '',
    notes: '',
    is_active: true,
  })

  const DAYS_OF_WEEK = [
    { value: 0, label: 'Sunday', short: 'Sun' },
    { value: 1, label: 'Monday', short: 'Mon' },
    { value: 2, label: 'Tuesday', short: 'Tue' },
    { value: 3, label: 'Wednesday', short: 'Wed' },
    { value: 4, label: 'Thursday', short: 'Thu' },
    { value: 5, label: 'Friday', short: 'Fri' },
    { value: 6, label: 'Saturday', short: 'Sat' },
  ]
  
  const [selectedWorkersForBulk, setSelectedWorkersForBulk] = useState<Set<string>>(new Set())
  
  // Search and pagination for workers
  const [workerSearchQuery, setWorkerSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(workerSearchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [workerSearchQuery])

  useEffect(() => {
    loadWorkers()
    loadSchedules()
    loadExceptions()
  }, [])

  const loadExceptions = async () => {
    try {
      const result = await apiClient.get<{ exceptions: WorkerException[] }>(API_ROUTES.TEAMS.EXCEPTIONS)
      if (isApiError(result)) throw new Error(getApiErrorMessage(result) || 'Failed to fetch exceptions')
      const data = result.data
      // Only store active exceptions
      setExceptions((data.exceptions || []).filter((exc: WorkerException) => exc.is_active))
    } catch (error) {
      console.error('Error loading exceptions:', error)
      // Don't fail if exceptions fail to load
    }
  }

  // Memoized helper functions using the shared utility
  const hasActiveException = useCallback((workerId: string, scheduleDate?: string | null): boolean => {
    const checkDate = scheduleDate ? new Date(scheduleDate) : new Date()
    return checkActiveException(exceptions, workerId, checkDate)
  }, [exceptions])

  const getWorkerActiveException = useCallback((workerId: string): WorkerException | undefined => {
    return getActiveException(exceptions, workerId)
  }, [exceptions])

  // Helper function to get worker status (Active/Inactive/Exception)
  const getWorkerStatus = useCallback((workerId: string): { status: 'active' | 'inactive' | 'exception', label: string } => {
    // Check if worker has active exception
    if (hasActiveException(workerId)) {
      const activeException = getWorkerActiveException(workerId)
      const exceptionTypeLabel = activeException ? getExceptionTypeLabel(activeException.exception_type) : 'Exception'
      return { status: 'exception', label: exceptionTypeLabel }
    }
    
    // Check if worker has any active schedules
    const hasActiveSchedule = schedules.some(s => s.worker_id === workerId && s.is_active)
    
    if (hasActiveSchedule) {
      return { status: 'active', label: 'Active' }
    }
    
    return { status: 'inactive', label: 'Inactive' }
  }, [hasActiveException, getWorkerActiveException, schedules])

  // Optimized toast notification with auto-hide
  const showToast = useCallback((message: string) => {
    // Clear existing timeout
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current)
    }
    setSuccessMessage(message)
    setShowSuccessToast(true)
    toastTimeoutRef.current = setTimeout(() => {
      setShowSuccessToast(false)
      toastTimeoutRef.current = null
    }, 4000) // Auto-hide after 4 seconds
  }, [])

  // Cleanup toast timeout on unmount
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [])

  const loadWorkers = async () => {
    try {
      const result = await apiClient.get<{ team: any; members: Worker[] }>(API_ROUTES.TEAMS.BASE)
      if (isApiError(result)) throw new Error(getApiErrorMessage(result) || 'Failed to fetch team')
      const data = result.data
      
      // Get workers from team members
      const workersList = (data.members || [])
        .filter((member: any) => member.users?.role === 'worker')
        .map((member: any) => ({
          id: member.users.id,
          email: member.users.email,
          first_name: member.users.first_name,
          last_name: member.users.last_name,
          full_name: member.users.full_name || 
                    (member.users.first_name && member.users.last_name 
                      ? `${member.users.first_name} ${member.users.last_name}`
                      : member.users.email),
        }))
      
      setWorkers(workersList)
    } catch (error) {
      console.error('Error loading workers:', error)
      setError('Failed to load workers')
    }
  }

  const loadSchedules = async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<{ schedules: WorkerSchedule[] }>(API_ROUTES.SCHEDULES.WORKERS)
      if (isApiError(result)) throw new Error(getApiErrorMessage(result) || 'Failed to fetch schedules')
      const data = result.data
      setSchedules(data.schedules || [])
      setError('')
    } catch (error) {
      console.error('Error loading schedules:', error)
      setError('Failed to load schedules')
    } finally {
      setLoading(false)
    }
  }

  const handleAddSchedule = () => {
    // Check if any selected workers have active exceptions
    if (selectedWorkersForBulk.size > 0) {
      const workersWithExceptions: string[] = []
      selectedWorkersForBulk.forEach(workerId => {
        if (hasActiveException(workerId)) {
          const worker = workers.find(w => w.id === workerId)
          const workerName = worker?.full_name || worker?.email || workerId
          const activeException = getWorkerActiveException(workerId)
          const exceptionTypeLabel = activeException ? getExceptionTypeLabel(activeException.exception_type) : 'exception'
          workersWithExceptions.push(`${workerName} (${exceptionTypeLabel})`)
        }
      })
      
      if (workersWithExceptions.length > 0) {
        setError(`Cannot create schedule: The following worker(s) have active exceptions:\n\n${workersWithExceptions.join('\n')}\n\nPlease remove or close the exceptions first before creating schedules.`)
        return
      }
    }
    
    setEditingSchedule(null)
    setUseRange(false) // Default to single date mode
    setSelectedDays([])
    
    // Calculate end_date as 30 days from today by default
    const endDate = new Date()
    endDate.setDate(endDate.getDate() + 30)
    
    // If workers are already selected, use them; otherwise open modal with no selection
    setFormData({
      worker_ids: selectedWorkersForBulk.size > 0 ? Array.from(selectedWorkersForBulk) : [],
      scheduled_date: today,
      start_date: today,
      end_date: endDate.toISOString().split('T')[0],
      days_of_week: [],
      start_time: '08:00',
      end_time: '17:00',
      check_in_window_start: '',
      check_in_window_end: '',
      requires_daily_checkin: false,
      daily_checkin_start_time: '',
      daily_checkin_end_time: '',
      project_id: '',
      notes: '',
      is_active: true,
    })
    setShowModal(true)
  }
  
  // Filter workers based on search
  const filteredWorkers = workers.filter(worker => {
    if (!debouncedSearchQuery) return true
    const query = debouncedSearchQuery.toLowerCase()
    return (
      worker.full_name?.toLowerCase().includes(query) ||
      worker.email.toLowerCase().includes(query) ||
      worker.first_name?.toLowerCase().includes(query) ||
      worker.last_name?.toLowerCase().includes(query)
    )
  })

  const handleEditSchedule = (schedule: WorkerSchedule) => {
    // Prevent editing if worker has active exception
    if (hasActiveException(schedule.worker_id, schedule.scheduled_date)) {
      const activeException = getWorkerActiveException(schedule.worker_id)
      const exceptionTypeLabel = activeException ? getExceptionTypeLabel(activeException.exception_type) : 'exemption'
      setError(`Cannot edit schedule: Worker has an active ${exceptionTypeLabel} exception. Please remove or close the exception first.`)
      return
    }

    setEditingSchedule(schedule)
    
    // Check if this is a recurring schedule (has day_of_week) or single-date schedule
    const isRecurring = schedule.day_of_week !== null && schedule.day_of_week !== undefined
    
    setUseRange(isRecurring) // Set to true if recurring, false if single-date
    setSelectedDays(isRecurring ? [schedule.day_of_week!] : [])
    
    setFormData({
      worker_ids: [schedule.worker_id], // Single worker for editing
      scheduled_date: schedule.scheduled_date || today,
      start_date: schedule.effective_date || schedule.scheduled_date || today,
      end_date: schedule.expiry_date || '',
      days_of_week: isRecurring ? [schedule.day_of_week!] : [],
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      check_in_window_start: schedule.check_in_window_start || '',
      check_in_window_end: schedule.check_in_window_end || '',
      requires_daily_checkin: schedule.requires_daily_checkin || false,
      daily_checkin_start_time: schedule.daily_checkin_start_time || '',
      daily_checkin_end_time: schedule.daily_checkin_end_time || '',
      project_id: schedule.project_id || '',
      notes: schedule.notes || '',
      is_active: schedule.is_active,
    })
    // Don't open modal - sidebar will handle the edit form
  }

  const handleToggleScheduleStatus = async (schedule: WorkerSchedule) => {
    const newStatus = !schedule.is_active
    const action = newStatus ? 'activate' : 'deactivate'
    
    // Check if worker has active exception when trying to activate
    if (newStatus && hasActiveException(schedule.worker_id, schedule.scheduled_date)) {
      const activeException = getWorkerActiveException(schedule.worker_id)
      const exceptionTypeLabel = activeException ? getExceptionTypeLabel(activeException.exception_type) : 'exception'
      setError(`Cannot activate schedule: Worker has an active ${exceptionTypeLabel} exception. Please remove or close the exception first before activating schedules.`)
      return
    }
    
    // Show confirmation modal for deactivation
    if (!newStatus) {
      setScheduleToDeactivate(schedule)
      setShowDeactivateConfirmModal(true)
      return
    }

    // For activation, proceed directly
    await performToggleScheduleStatus(schedule, newStatus, action)
  }

  const performToggleScheduleStatus = async (schedule: WorkerSchedule, newStatus: boolean, action: string) => {
    try {
      const result = await apiClient.put<{ message: string }>(
        `${API_ROUTES.SCHEDULES.WORKER_SCHEDULE(schedule.id)}`,
        { is_active: newStatus }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || `Failed to ${action} schedule`)
      }

      // Show success toast using optimized function
      showToast(`Schedule ${action}d successfully`)

      loadSchedules()
      loadExceptions() // Reload exceptions after schedule change
    } catch (error: any) {
      console.error(`Error ${action}ing schedule:`, error)
      setError(error.message || `Failed to ${action} schedule`)
    }
  }

  const toggleDaySelection = (dayValue: number) => {
    setSelectedDays(prev => {
      if (prev.includes(dayValue)) {
        return prev.filter(d => d !== dayValue)
      } else {
        return [...prev, dayValue].sort()
      }
    })
  }

  // Helper function to normalize time format (HH:MM or HH:MM:SS -> HH:MM)
  const normalizeTime = (timeStr: string | null | undefined): string => {
    if (!timeStr) return ''
    // Remove seconds if present (HH:MM:SS -> HH:MM)
    return timeStr.split(':').slice(0, 2).join(':')
    }

  // Helper function to add one hour to a time string (HH:MM format)
  const addOneHour = (timeStr: string): string => {
    const [hours, minutes] = timeStr.split(':').map(Number)
    const newHours = (hours + 1) % 24
    return `${newHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  }

  // Confirmation handler for schedule creation
  const handleConfirmCreate = useCallback(() => {
    setShowCreateConfirmModal(false)
    if (pendingSubmit) {
      pendingSubmit()
      setPendingSubmit(null)
    }
  }, [pendingSubmit])

  const handleCancelCreate = useCallback(() => {
    setShowCreateConfirmModal(false)
    setPendingSubmit(null)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (editingSchedule) {
      // Single worker edit - ALL schedules can be edited individually (even bulk-created)
      if (!formData.start_time || !formData.end_time) {
        setError('Please fill in all required fields')
        return
      }

      // Validate schedule type
      const isRecurringSchedule = editingSchedule?.day_of_week !== null && editingSchedule?.day_of_week !== undefined
      const isRecurringMode = useRange && selectedDays.length > 0
      
      if (isRecurringSchedule || isRecurringMode) {
        // Recurring schedule: need start_date and at least one day selected
        if (!formData.start_date) {
          setError('Start date is required for recurring schedules')
          return
        }
        if (selectedDays.length === 0 && !isRecurringSchedule) {
          // Allow empty if keeping existing recurring schedule day
          setError('Please select at least one day of the week for recurring schedule')
          return
        }
      } else {
        // Single-date schedule: need scheduled_date
        if (!formData.scheduled_date) {
          setError('Scheduled date is required')
          return
        }
      }

      if (formData.requires_daily_checkin && (!formData.daily_checkin_start_time || !formData.daily_checkin_end_time)) {
        setError('Daily check-in start and end times are required when daily check-in is enabled')
        return
      }
      
      // Validate that daily check-in end time is after start time
      if (formData.requires_daily_checkin && formData.daily_checkin_start_time && formData.daily_checkin_end_time) {
        const [startH, startM] = formData.daily_checkin_start_time.split(':').map(Number)
        const [endH, endM] = formData.daily_checkin_end_time.split(':').map(Number)
        const startMinutes = startH * 60 + startM
        const endMinutes = endH * 60 + endM
        
        if (endMinutes <= startMinutes) {
          setError('Daily check-in end time must be after start time. Please use 24-hour format (e.g., 08:00, 09:00, not 08:00 am)')
          return
        }
      }

      try {
        const updateData: ScheduleUpdatePayload = {
          start_time: normalizeTime(formData.start_time),
          end_time: normalizeTime(formData.end_time),
          check_in_window_start: normalizeTime(formData.check_in_window_start) || null,
          check_in_window_end: normalizeTime(formData.check_in_window_end) || null,
          requires_daily_checkin: formData.requires_daily_checkin,
          daily_checkin_start_time: normalizeTime(formData.daily_checkin_start_time) || null,
          daily_checkin_end_time: normalizeTime(formData.daily_checkin_end_time) || null,
          project_id: formData.project_id || null,
          notes: formData.notes || null,
          is_active: formData.is_active,
        }
        
        // Handle schedule type: single-date vs recurring
        // Check if editing a recurring schedule (has day_of_week) OR user selected recurring mode
        const isRecurringEdit = editingSchedule?.day_of_week !== null && editingSchedule?.day_of_week !== undefined
        const isRecurringMode = useRange && selectedDays.length > 0
        
        // Always ensure day_of_week is sent when editing recurring schedule
        if (isRecurringEdit || isRecurringMode) {
          // Editing as recurring schedule - allow changing day_of_week
          // If user selected new days, use those; otherwise keep existing
          const newDayOfWeek = selectedDays.length > 0 ? selectedDays[0] : editingSchedule?.day_of_week
          
          if (newDayOfWeek !== null && newDayOfWeek !== undefined) {
            updateData.day_of_week = newDayOfWeek
          }
          updateData.scheduled_date = null
          updateData.effective_date = formData.start_date || null
          updateData.expiry_date = formData.end_date || null
        } else if (editingSchedule && editingSchedule.scheduled_date) {
          // Editing as single-date schedule
          updateData.scheduled_date = formData.scheduled_date
          updateData.day_of_week = null
          updateData.effective_date = null
          updateData.expiry_date = null
        }

        const result = await apiClient.put<{ message: string }>(
          API_ROUTES.SCHEDULES.WORKER_SCHEDULE(editingSchedule.id),
          updateData
        )

        if (isApiError(result)) {
          throw new Error(getApiErrorMessage(result) || 'Failed to update schedule')
        }

        showToast('Schedule updated successfully')
        setSidebarMode('view')
        setEditingSchedule(null)
        // Force reload to get updated data
        setSchedules([])
        loadSchedules()
        loadExceptions() // Reload exceptions after schedule update
      } catch (error: any) {
        console.error('Error updating schedule:', error)
        setError(error.message || 'Failed to update schedule')
      }
    } else {
      // Bulk create for multiple workers
      if (!formData.worker_ids.length || !formData.start_time || !formData.end_time) {
        setError('Please select at least one worker and fill in all required fields')
        return
      }

      // Check if any selected workers have active exceptions
      const workersWithExceptions: string[] = []
      formData.worker_ids.forEach(workerId => {
        if (hasActiveException(workerId)) {
          const worker = workers.find(w => w.id === workerId)
          const workerName = worker?.full_name || worker?.email || workerId
          const activeException = getWorkerActiveException(workerId)
          const exceptionTypeLabel = activeException ? getExceptionTypeLabel(activeException.exception_type) : 'exception'
          workersWithExceptions.push(`${workerName} (${exceptionTypeLabel})`)
        }
      })
      
      if (workersWithExceptions.length > 0) {
        setError(`Cannot create schedule: The following worker(s) have active exceptions:\n${workersWithExceptions.join('\n')}\n\nPlease remove or close the exceptions first before creating schedules.`)
        return
      }

      // Validate date selection
      if (!useRange && !formData.scheduled_date) {
        setError('Please select a date')
        return
      }

      if (useRange && (!formData.start_date || !formData.end_date || selectedDays.length === 0)) {
        setError('Please select start date, end date, and at least one day of the week')
        return
      }

      if (formData.requires_daily_checkin && (!formData.daily_checkin_start_time || !formData.daily_checkin_end_time)) {
        setError('Daily check-in start and end times are required when daily check-in is enabled')
        return
      }

      // Validate that daily check-in end time is after start time
      if (formData.requires_daily_checkin && formData.daily_checkin_start_time && formData.daily_checkin_end_time) {
        if (formData.daily_checkin_end_time <= formData.daily_checkin_start_time) {
          setError('Daily check-in end time must be after start time. Please use 24-hour format (e.g., 08:00, 09:00, not 08:00 am)')
          return
        }
      }

      // Show confirmation modal before creating
      setPendingSubmit(() => async () => {
        setCreating(true)
        setError('')

      try {
        let successCount = 0
        let errorCount = 0
        const errors: string[] = []

        // Create schedule for each selected worker
        for (const workerId of formData.worker_ids) {
          try {
            const scheduleData: any = {
              worker_id: workerId,
              start_time: normalizeTime(formData.start_time),
              end_time: normalizeTime(formData.end_time),
              check_in_window_start: normalizeTime(formData.check_in_window_start) || null,
              check_in_window_end: normalizeTime(formData.check_in_window_end) || null,
              requires_daily_checkin: formData.requires_daily_checkin,
              daily_checkin_start_time: normalizeTime(formData.daily_checkin_start_time) || null,
              daily_checkin_end_time: normalizeTime(formData.daily_checkin_end_time) || null,
              project_id: formData.project_id || null,
              notes: formData.notes || null,
              is_active: formData.is_active,
            }

            // Add date selection based on mode
            if (useRange) {
              scheduleData.start_date = formData.start_date
              scheduleData.end_date = formData.end_date
              scheduleData.days_of_week = selectedDays
            } else {
              scheduleData.scheduled_date = formData.scheduled_date
            }

            const result = await apiClient.post<{ count?: number }>(
              API_ROUTES.SCHEDULES.WORKERS,
              scheduleData
            )

            if (isApiError(result)) {
              throw new Error(getApiErrorMessage(result) || 'Failed to create schedule')
            }
            // If bulk creation, count the number of schedules created
            const createdCount = result.data?.count || 1
            successCount += createdCount
          } catch (error: any) {
            errorCount++
            const workerName = workers.find(w => w.id === workerId)?.full_name || workerId
            errors.push(`${workerName}: ${error.message}`)
            console.error(`Error creating schedule for worker ${workerId}:`, error)
          }
        }

        if (errorCount === 0) {
          const scheduleText = successCount === 1 ? 'schedule' : 'schedules'
          showToast(`Successfully created ${successCount} ${scheduleText}`)
        } else if (successCount > 0) {
          showToast(`Created ${successCount} schedule(s), but ${errorCount} worker(s) failed`)
          setError(`Some workers failed:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`)
        } else {
          throw new Error(`Failed to create schedules:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? '\n...' : ''}`)
        }

        setSidebarMode('view')
        setSelectedWorkersForBulk(new Set()) // Clear selection after creation
        loadSchedules()
        loadExceptions() // Reload exceptions after schedule creation
      } catch (error: any) {
        console.error('Error creating schedules:', error)
        setError(error.message || 'Failed to create schedules')
      } finally {
        setCreating(false)
      }
      })
      setShowCreateConfirmModal(true)
      return
    }
  }

  const getWorkerName = (schedule: WorkerSchedule) => {
    if (schedule.users) {
      return schedule.users.full_name || 
             (schedule.users.first_name && schedule.users.last_name 
               ? `${schedule.users.first_name} ${schedule.users.last_name}`
               : schedule.users.email)
    }
    return 'Unknown Worker'
  }

  return (
    <DashboardLayout>
      <div className="worker-schedules-container">
        <div className="worker-schedules-header">
          <div className="header-content">
            <div>
              <h1>Worker Schedules</h1>
              <p className="subtitle">Manage individual schedules for workers in your team</p>
            </div>
          </div>
        </div>

        {error && !showModal && <div className="error-message">{error}</div>}

        {/* Worker Selection Section */}
        <div className="worker-selection-section">
          <div className="section-header">
            <div className="section-header-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <div>
                <h2>Worker Details</h2>
                <p className="section-subtitle">Manage worker schedules and view details</p>
              </div>
            </div>
            <div className="header-actions">
              <div className="search-wrapper">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <path d="m21 21-4.35-4.35"></path>
                </svg>
                <input
                  type="text"
                  placeholder="Search by name or email..."
                  value={workerSearchQuery}
                  onChange={(e) => setWorkerSearchQuery(e.target.value)}
                  className="worker-search-input-table"
                />
              </div>
              {selectedWorkersForBulk.size > 0 && (
                <>
                  <button
                    onClick={() => setSelectedWorkersForBulk(new Set())}
                    className="btn-text-small"
                  >
                    Clear ({selectedWorkersForBulk.size})
                  </button>
                  <button
                    onClick={handleAddSchedule}
                    className="btn-primary"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Create Schedule ({selectedWorkersForBulk.size})
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Workers Table */}
          <div className="workers-table-container">
            <table className="workers-table">
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>
                    <input
                      type="checkbox"
                      checked={filteredWorkers.length > 0 && filteredWorkers.every(w => selectedWorkersForBulk.has(w.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const newSelection = new Set(selectedWorkersForBulk)
                          filteredWorkers.forEach(w => newSelection.add(w.id))
                          setSelectedWorkersForBulk(newSelection)
                        } else {
                          const newSelection = new Set(selectedWorkersForBulk)
                          filteredWorkers.forEach(w => newSelection.delete(w.id))
                          setSelectedWorkersForBulk(newSelection)
                        }
                      }}
                    />
                  </th>
                  <th>Name</th>
                  <th>Email address</th>
                  <th>Phone Number</th>
                  <th>Status</th>
                  <th style={{ width: '100px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="no-data">
                      {workerSearchQuery ? `No workers found matching "${debouncedSearchQuery}"` : 'No workers available'}
                    </td>
                  </tr>
                ) : (
                  filteredWorkers.map((worker) => {
                    const workerStatus = getWorkerStatus(worker.id)
                    return (
                      <tr 
                        key={worker.id} 
                        className={selectedWorkersForBulk.has(worker.id) ? 'selected' : ''}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedWorkersForBulk.has(worker.id)}
                            onChange={() => {
                              const newSelection = new Set(selectedWorkersForBulk)
                              if (selectedWorkersForBulk.has(worker.id)) {
                                newSelection.delete(worker.id)
                              } else {
                                newSelection.add(worker.id)
                              }
                              setSelectedWorkersForBulk(newSelection)
                            }}
                          />
                        </td>
                        <td className="worker-name-cell">
                          <div className="worker-info-cell">
                            <div className="worker-avatar-small">
                              {(worker.full_name || worker.email).charAt(0).toUpperCase()}
                            </div>
                            <span>{worker.full_name || worker.email}</span>
                          </div>
                        </td>
                        <td>{worker.email}</td>
                        <td>-</td>
                        <td>
                          <span 
                            className={`status-badge status-${workerStatus.status}`}
                            title={workerStatus.status === 'exception' 
                              ? `Worker has an active ${workerStatus.label} exception` 
                              : workerStatus.status === 'active'
                              ? 'Worker has active schedules'
                              : 'Worker has no active schedules'}
                          >
                            {workerStatus.status === 'exception' && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                <line x1="12" y1="9" x2="12" y2="13"></line>
                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                              </svg>
                            )}
                            {workerStatus.status === 'active' && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                              </svg>
                            )}
                            {workerStatus.status === 'inactive' && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                              </svg>
                            )}
                            {workerStatus.label}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn-view-details"
                            onClick={() => setSelectedWorker(worker)}
                            title="View Worker Details"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                              <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                            <span>View</span>
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal - Cleaner Design */}
        {showModal && (
          <div className="modal-overlay" onClick={() => {
            if (!creating) {
              setShowModal(false)
              if (!editingSchedule) {
                setSelectedWorkersForBulk(new Set())
              }
            }
          }}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h2>{editingSchedule ? 'Edit Schedule' : 'Create Schedule'}</h2>
                  {!editingSchedule && formData.worker_ids.length > 1 && (
                    <p className="modal-subtitle">Creating schedule for {formData.worker_ids.length} workers</p>
                  )}
                </div>
                <button 
                  className="modal-close" 
                  onClick={() => {
                    if (!creating) {
                      setShowModal(false)
                      if (!editingSchedule) {
                        setSelectedWorkersForBulk(new Set())
                      }
                    }
                  }}
                  disabled={creating}
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="schedule-form">
                {editingSchedule ? (
                  // Single worker for editing
                  <div className="form-group">
                    <label>Worker</label>
                    <input
                      type="text"
                      value={getWorkerName({ users: workers.find(w => w.id === editingSchedule.worker_id) } as any)}
                      disabled
                      className="form-input disabled"
                    />
                  </div>
                ) : (
                  // Multiple workers for bulk create
                  <div className="form-group">
                    <label>Selected Workers ({formData.worker_ids.length})</label>
                    <div className="selected-workers-list">
                      {formData.worker_ids.length === 0 ? (
                        <p className="no-selection">No workers selected</p>
                      ) : (
                        <div className="selected-workers-tags">
                          {formData.worker_ids.map((workerId) => {
                            const worker = workers.find(w => w.id === workerId)
                            return (
                              <span key={workerId} className="worker-tag">
                                {worker?.full_name || worker?.email || workerId}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Date Selection Mode Toggle (only for new schedules) */}
                {!editingSchedule && (
                  <div className="form-group">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={useRange}
                        onChange={(e) => {
                          setUseRange(e.target.checked)
                          if (e.target.checked) {
                            setSelectedDays([1, 2, 3, 4, 5]) // Default to Mon-Fri
                          } else {
                            setSelectedDays([])
                          }
                        }}
                      />
                      <span>Create recurring schedule (select days of week)</span>
                    </label>
                  </div>
                )}

                {/* Show schedule type indicator when editing */}
                {editingSchedule && (
                  <div className="form-group">
                    <div className="schedule-type-indicator">
                      {editingSchedule.day_of_week !== null && editingSchedule.day_of_week !== undefined ? (
                        <span className="schedule-badge recurring">
                          📅 Recurring: {DAYS_OF_WEEK.find(d => d.value === editingSchedule.day_of_week)?.label} 
                          {editingSchedule.effective_date && editingSchedule.expiry_date && (
                            <span> ({new Date(editingSchedule.effective_date).toLocaleDateString()} - {new Date(editingSchedule.expiry_date).toLocaleDateString()})</span>
                          )}
                        </span>
                      ) : (
                        <span className="schedule-badge single">📆 Single Date: {editingSchedule.scheduled_date && new Date(editingSchedule.scheduled_date).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                )}

                {(!editingSchedule && !useRange) || (editingSchedule && !useRange) ? (
                <div className="form-group">
                  <label>Date *</label>
                  <input
                    type="date"
                    value={formData.scheduled_date}
                    onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                    required
                    className="form-input"
                  />
                </div>
                ) : (useRange || (editingSchedule && editingSchedule.day_of_week !== null && editingSchedule.day_of_week !== undefined)) ? (
                  <>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Start Date *</label>
                        <input
                          type="date"
                          value={formData.start_date}
                          onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                          required
                          className="form-input"
                        />
                      </div>
                      <div className="form-group">
                        <label>End Date {editingSchedule ? '' : '*'}</label>
                        <input
                          type="date"
                          value={formData.end_date}
                          onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                          required={!editingSchedule}
                          className="form-input"
                        />
                        {editingSchedule && (
                          <small className="field-help">Leave empty for ongoing schedule</small>
                        )}
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Days of Week *</label>
                      <div className="days-selector">
                        {DAYS_OF_WEEK.map((day) => {
                          const isSelected = selectedDays.includes(day.value)
                          return (
                            <button
                              key={day.value}
                              type="button"
                              className={`day-button ${isSelected ? 'selected' : ''}`}
                              onClick={() => toggleDaySelection(day.value)}
                            >
                              {day.short}
                            </button>
                          )
                        })}
                      </div>
                      <small className="field-help">
                        {selectedDays.length === 0 
                          ? 'Select at least one day' 
                          : `Selected: ${selectedDays.map(d => DAYS_OF_WEEK.find(day => day.value === d)?.label).join(', ')}`}
                      </small>
                    </div>
                  </>
                ) : null}

                <div className="form-row">
                  <div className="form-group">
                    <label>Start Time *</label>
                    <input
                      type="time"
                      value={formData.start_time}
                      onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                      required
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label>End Time *</label>
                    <input
                      type="time"
                      value={formData.end_time}
                      onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                      required
                      className="form-input"
                    />
                  </div>
                </div>

                {/* Daily Check-In Requirement Section */}
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.requires_daily_checkin}
                      onChange={(e) => {
                        const isEnabled = e.target.checked
                        setFormData({ 
                          ...formData, 
                          requires_daily_checkin: isEnabled,
                          daily_checkin_start_time: isEnabled ? (formData.daily_checkin_start_time || '08:00') : '',
                          daily_checkin_end_time: isEnabled ? (formData.daily_checkin_end_time || '09:00') : '',
                          // Clear check-in window when daily check-in is enabled (to avoid confusion)
                          check_in_window_start: isEnabled ? '' : formData.check_in_window_start,
                          check_in_window_end: isEnabled ? '' : formData.check_in_window_end,
                        })
                      }}
                    />
                    <span>Require Daily Check-In</span>
                  </label>
                  <small className="field-help">
                    If enabled, workers must complete daily check-in within the specified time range
                  </small>
                </div>

                {formData.requires_daily_checkin ? (
                  <div className="form-row">
                    <div className="form-group">
                      <label>Daily Check-In Start Time *</label>
                      <input
                        type="time"
                        value={formData.daily_checkin_start_time}
                        onChange={(e) => {
                          const newStart = e.target.value
                          setFormData({ 
                            ...formData, 
                            daily_checkin_start_time: newStart,
                            // Auto-adjust end time if it's before or equal to start time
                            daily_checkin_end_time: formData.daily_checkin_end_time && formData.daily_checkin_end_time <= newStart
                              ? addOneHour(newStart)
                              : formData.daily_checkin_end_time
                          })
                        }}
                        required={formData.requires_daily_checkin}
                        className="form-input"
                      />
                      <small className="field-help">When daily check-in window opens (24-hour format, e.g., 08:00)</small>
                    </div>

                    <div className="form-group">
                      <label>Daily Check-In End Time *</label>
                      <input
                        type="time"
                        value={formData.daily_checkin_end_time}
                        onChange={(e) => {
                          const newEnd = e.target.value
                          setFormData({ 
                            ...formData, 
                            daily_checkin_end_time: newEnd
                          })
                        }}
                        required={formData.requires_daily_checkin}
                        className="form-input"
                      />
                      <small className="field-help">When daily check-in window closes (must be after start time)</small>
                    </div>
                  </div>
                ) : (
                <div className="form-row">
                  <div className="form-group">
                    <label>Check-In Window Start <span className="optional">(Optional)</span></label>
                    <input
                      type="time"
                      value={formData.check_in_window_start}
                      onChange={(e) => setFormData({ ...formData, check_in_window_start: e.target.value })}
                      className="form-input"
                    />
                      <small className="field-help">Custom check-in window start (leave empty to auto-calculate based on shift)</small>
                  </div>

                  <div className="form-group">
                    <label>Check-In Window End <span className="optional">(Optional)</span></label>
                    <input
                      type="time"
                      value={formData.check_in_window_end}
                      onChange={(e) => setFormData({ ...formData, check_in_window_end: e.target.value })}
                      className="form-input"
                    />
                      <small className="field-help">Custom check-in window end (leave empty to auto-calculate based on shift)</small>
                  </div>
                </div>
                )}

                <div className="form-group">
                  <label>Notes <span className="optional">(Optional)</span></label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="form-input"
                    rows={3}
                    placeholder="Add notes about this schedule..."
                  />
                </div>

                {editingSchedule && (
                  <div className="form-group">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      />
                      <span>Active Schedule</span>
                    </label>
                  </div>
                )}

                {error && <div className="form-error">{error}</div>}

                <div className="form-actions">
                  <button 
                    type="button" 
                    onClick={() => {
                      if (!creating) {
                        setShowModal(false)
                        if (!editingSchedule) {
                          setSelectedWorkersForBulk(new Set())
                        }
                      }
                    }} 
                    className="btn-secondary"
                    disabled={creating}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="btn-primary"
                    disabled={creating || (!editingSchedule && formData.worker_ids.length === 0)}
                  >
                    {creating ? (
                      <>
                        <span className="spinner"></span>
                        Creating...
                      </>
                    ) : editingSchedule ? (
                      'Update Schedule'
                    ) : (
                      `Create ${formData.worker_ids.length} Schedule${formData.worker_ids.length !== 1 ? 's' : ''}`
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Worker Details Sidebar */}
        {selectedWorker && (
          <>
            <div className="sidebar-overlay" onClick={() => setSelectedWorker(null)}></div>
            <div className="worker-sidebar-panel">
              <div className="worker-sidebar-header">
                <h3>Worker Details</h3>
                <button
                  className="sidebar-close"
                  onClick={() => setSelectedWorker(null)}
                  aria-label="Close sidebar"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              {sidebarMode === 'view' && (
                <>
                  <div className="worker-sidebar-body">
                {/* Worker Information */}
                <div className="worker-sidebar-section">
                  <div className="worker-sidebar-section-header">
                    <h4>Worker Details</h4>
                  </div>
                  <div className="worker-details-card">
                    <div className="worker-details-avatar" style={{ backgroundColor: getAvatarColor(selectedWorker.full_name || selectedWorker.email) }}>
                      {getUserInitials(selectedWorker.full_name || null, selectedWorker.email || null)}
                    </div>
                    <div className="worker-details-info">
                      <div className="worker-details-name">{selectedWorker.full_name || selectedWorker.email}</div>
                      <div className="worker-details-email">{selectedWorker.email}</div>
                      <div className="worker-details-stats">
                        <div className="worker-details-stat">
                          <span className="worker-details-stat-label">Total Schedules</span>
                          <span className="worker-details-stat-value">{schedules.filter(s => s.worker_id === selectedWorker.id).length}</span>
                        </div>
                        <div className="worker-details-stat">
                          <span className="worker-details-stat-label">Active</span>
                          <span className="worker-details-stat-value active">
                            {schedules.filter(s => s.worker_id === selectedWorker.id && s.is_active).length}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                    {/* Worker Schedules */}
                    <div className="worker-sidebar-section">
                      <div className="worker-sidebar-section-header">
                        <h4>Schedules</h4>
                        <button
                          className="worker-sidebar-add-btn"
                          onClick={() => {
                                // Check if worker has active exception
                                if (hasActiveException(selectedWorker.id)) {
                                  const activeException = getWorkerActiveException(selectedWorker.id)
                              const exceptionTypeLabel = activeException ? getExceptionTypeLabel(activeException.exception_type) : 'exception'
                              setError(`Cannot create schedule: Worker has an active ${exceptionTypeLabel} exception. Please remove or close the exception first before creating schedules.`)
                              return
                            }
                            
                            setFormData({
                              worker_ids: [selectedWorker.id],
                              scheduled_date: today,
                              start_date: today,
                              end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                              days_of_week: [],
                              start_time: '08:00',
                              end_time: '17:00',
                              check_in_window_start: '',
                              check_in_window_end: '',
                              requires_daily_checkin: false,
                              daily_checkin_start_time: '',
                              daily_checkin_end_time: '',
                              project_id: '',
                              notes: '',
                              is_active: true,
                            })
                            setEditingSchedule(null)
                            setUseRange(false)
                            setSelectedDays([])
                            setSidebarMode('create')
                          }}
                          title={hasActiveException(selectedWorker.id) 
                            ? `Cannot create schedule: Worker has an active exception` 
                            : "Create new schedule"}
                          disabled={hasActiveException(selectedWorker.id)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                          </svg>
                        </button>
                      </div>
                      <div className="worker-sidebar-schedules">
                    {(() => {
                      const workerSchedules = schedules.filter(s => s.worker_id === selectedWorker.id)
                      if (workerSchedules.length === 0) {
                        return (
                          <div className="worker-sidebar-empty">
                            <p>No schedules found</p>
                            <button
                              className="worker-sidebar-create-btn"
                              onClick={() => {
                                // Check if worker has active exception
                                if (hasActiveException(selectedWorker.id)) {
                                  const activeException = getWorkerActiveException(selectedWorker.id)
                                  const exceptionTypeLabel = activeException ? getExceptionTypeLabel(activeException.exception_type) : 'exception'
                                  setError(`Cannot create schedule: Worker has an active ${exceptionTypeLabel} exception. Please remove or close the exception first before creating schedules.`)
                                  return
                                }
                                
                                setFormData({
                                  worker_ids: [selectedWorker.id],
                                  scheduled_date: today,
                                  start_date: today,
                                  end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                                  days_of_week: [],
                                  start_time: '08:00',
                                  end_time: '17:00',
                                  check_in_window_start: '',
                                  check_in_window_end: '',
                                  requires_daily_checkin: false,
                                  daily_checkin_start_time: '',
                                  daily_checkin_end_time: '',
                                  project_id: '',
                                  notes: '',
                                  is_active: true,
                                })
                                setEditingSchedule(null)
                                setUseRange(false)
                                setSelectedDays([])
                                setSidebarMode('create')
                              }}
                              disabled={hasActiveException(selectedWorker.id)}
                            >
                              Create Schedule
                            </button>
                          </div>
                        )
                      }
                      return workerSchedules.map((schedule) => (
                        <div key={schedule.id} className="worker-sidebar-schedule-item">
                          <div className="worker-sidebar-schedule-header">
                            <div className="worker-sidebar-schedule-info">
                              <div className="worker-sidebar-schedule-date">
                                {schedule.scheduled_date ? (
                                  new Date(schedule.scheduled_date).toLocaleDateString('en-US', { 
                                    month: 'short', 
                                    day: 'numeric', 
                                    year: 'numeric' 
                                  })
                                ) : schedule.day_of_week !== null && schedule.day_of_week !== undefined ? (
                                  DAYS_OF_WEEK.find(d => d.value === schedule.day_of_week)?.label || 'Recurring'
                                ) : (
                                  'No date'
                                )}
                              </div>
                              <div className="worker-sidebar-schedule-time">
                                {schedule.start_time} - {schedule.end_time}
                              </div>
                            </div>
                            <div className="worker-sidebar-schedule-actions">
                              <button
                                className="worker-sidebar-edit-btn"
                                onClick={() => {
                                  if (hasActiveException(schedule.worker_id, schedule.scheduled_date)) {
                                    const activeException = getWorkerActiveException(schedule.worker_id)
                                    const exceptionTypeLabel = activeException ? getExceptionTypeLabel(activeException.exception_type) : 'exception'
                                    setError(`Cannot edit schedule: Worker has an active ${exceptionTypeLabel} exception. Please remove or close the exception first.`)
                                    return
                                  }
                                  handleEditSchedule(schedule)
                                  // Ensure sidebar is open and switch to edit mode
                                  const worker = workers.find(w => w.id === schedule.worker_id)
                                  if (worker) {
                                    setSelectedWorker(worker)
                                  }
                                  setSidebarMode('edit')
                                }}
                                disabled={hasActiveException(schedule.worker_id, schedule.scheduled_date)}
                                title="Edit schedule"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                              </button>
                              <button
                                className="worker-sidebar-toggle-btn"
                                onClick={() => {
                                  if (!schedule.is_active && hasActiveException(schedule.worker_id, schedule.scheduled_date)) {
                                    const activeException = getWorkerActiveException(schedule.worker_id)
                                    const exceptionTypeLabel = activeException ? getExceptionTypeLabel(activeException.exception_type) : 'exception'
                                    setError(`Cannot activate schedule: Worker has an active ${exceptionTypeLabel} exception. Please remove or close the exception first before activating schedules.`)
                                    return
                                  }
                                  handleToggleScheduleStatus(schedule)
                                }}
                                disabled={!schedule.is_active && hasActiveException(schedule.worker_id, schedule.scheduled_date)}
                                title={schedule.is_active ? 'Deactivate schedule' : 'Activate schedule'}
                              >
                                {schedule.is_active ? (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                    <line x1="1" y1="1" x2="23" y2="23"></line>
                                  </svg>
                                ) : (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                  </svg>
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="worker-sidebar-schedule-status">
                            <span className={`schedule-status-badge ${schedule.is_active ? 'active' : 'inactive'}`}>
                              {schedule.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          {schedule.notes && (
                            <div className="worker-sidebar-schedule-notes">
                              {schedule.notes}
                            </div>
                          )}
                        </div>
                      ))
                    })()}
                    </div>
                    </div>

                    {/* Active Exception */}
                    {(() => {
                      const activeException = getWorkerActiveException(selectedWorker.id)
                      if (activeException) {
                        return (
                          <div className="worker-sidebar-section">
                            <div className="worker-sidebar-section-header">
                              <h4>Active Exception</h4>
                            </div>
                            <div className="worker-sidebar-exception">
                              <div className="worker-sidebar-exception-type">
                                {getExceptionTypeLabel(activeException.exception_type)}
                              </div>
                              <div className="worker-sidebar-exception-dates">
                                {new Date(activeException.start_date).toLocaleDateString()} - {activeException.end_date ? new Date(activeException.end_date).toLocaleDateString() : 'Ongoing'}
                              </div>
                              {activeException.reason && (
                                <div className="worker-sidebar-exception-reason">
                                  {activeException.reason}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      }
                      return null
                    })()}
                  </div>
                </>
              )}

              {(sidebarMode === 'create' || sidebarMode === 'edit') && (
                <div className="worker-sidebar-form-body">
                  <form onSubmit={handleSubmit} className="schedule-form-sidebar">
                    {/* Worker Info Section */}
                    <div className="form-section">
                      <div className="form-section-header">
                        <h4>Worker Information</h4>
                      </div>
                      {editingSchedule ? (
                        <div className="form-group">
                          <label className="form-label">Worker</label>
                          <input
                            type="text"
                            value={getWorkerName({ users: workers.find(w => w.id === editingSchedule.worker_id) } as any)}
                            disabled
                            className="form-input disabled"
                          />
                        </div>
                      ) : (
                        <div className="form-group">
                          <label className="form-label">Worker</label>
                          <input
                            type="text"
                            value={selectedWorker?.full_name || selectedWorker?.email || ''}
                            disabled
                            className="form-input disabled"
                          />
                        </div>
                      )}
                    </div>

                    {/* Schedule Type Section */}
                    {!editingSchedule && (
                      <div className="form-section">
                        <div className="form-section-header">
                          <h4>Schedule Type</h4>
                        </div>
                        <div className="form-group">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={useRange}
                              onChange={(e) => {
                                setUseRange(e.target.checked)
                                if (e.target.checked) {
                                  setSelectedDays([1, 2, 3, 4, 5])
                                } else {
                                  setSelectedDays([])
                                }
                              }}
                            />
                            <span>Recurring Schedule</span>
                          </label>
                          <small className="field-help">Enable to create a schedule that repeats on specific days of the week</small>
                        </div>
                      </div>
                    )}

                    {editingSchedule && (
                      <div className="form-section">
                        <div className="form-section-header">
                          <h4>Schedule Type</h4>
                        </div>
                        <div className="form-group">
                          <div className="schedule-type-indicator">
                            {editingSchedule.day_of_week !== null && editingSchedule.day_of_week !== undefined ? (
                              <span className="schedule-badge recurring">
                                📅 Recurring: {DAYS_OF_WEEK.find(d => d.value === editingSchedule.day_of_week)?.label} 
                                {editingSchedule.effective_date && editingSchedule.expiry_date && (
                                  <span> ({new Date(editingSchedule.effective_date).toLocaleDateString()} - {new Date(editingSchedule.expiry_date).toLocaleDateString()})</span>
                                )}
                              </span>
                            ) : (
                              <span className="schedule-badge single">📆 Single Date: {editingSchedule.scheduled_date && new Date(editingSchedule.scheduled_date).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Date & Time Section */}
                    <div className="form-section">
                      <div className="form-section-header">
                        <h4>Date & Time</h4>
                      </div>

                    {(!editingSchedule && !useRange) || (editingSchedule && !useRange) ? (
                    <div className="form-group">
                      <label className="form-label">Date <span className="required">*</span></label>
                      <input
                        type="date"
                        value={formData.scheduled_date}
                        onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                        required
                        className="form-input"
                      />
                    </div>
                    ) : (useRange || (editingSchedule && editingSchedule.day_of_week !== null && editingSchedule.day_of_week !== undefined)) ? (
                      <>
                        <div className="form-row">
                          <div className="form-group">
                            <label className="form-label">Start Date <span className="required">*</span></label>
                            <input
                              type="date"
                              value={formData.start_date}
                              onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                              required
                              className="form-input"
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">End Date {editingSchedule ? '' : <span className="required">*</span>}</label>
                            <input
                              type="date"
                              value={formData.end_date}
                              onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                              required={!editingSchedule}
                              className="form-input"
                            />
                            {editingSchedule && (
                              <small className="field-help">Leave empty for ongoing schedule</small>
                            )}
                          </div>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Days of Week <span className="required">*</span></label>
                          <div className="days-selector">
                            {DAYS_OF_WEEK.map((day) => {
                              const isSelected = selectedDays.includes(day.value)
                              return (
                                <button
                                  key={day.value}
                                  type="button"
                                  className={`day-button ${isSelected ? 'selected' : ''}`}
                                  onClick={() => toggleDaySelection(day.value)}
                                >
                                  {day.short}
                                </button>
                              )
                            })}
                          </div>
                          <small className="field-help">
                            {selectedDays.length === 0 
                              ? 'Select at least one day' 
                              : `Selected: ${selectedDays.map(d => DAYS_OF_WEEK.find(day => day.value === d)?.label).join(', ')}`}
                          </small>
                        </div>
                      </>
                    ) : null}

                      <div className="form-row">
                        <div className="form-group">
                          <label className="form-label">Start Time <span className="required">*</span></label>
                          <input
                            type="time"
                            value={formData.start_time}
                            onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                            required
                            className="form-input"
                          />
                        </div>

                        <div className="form-group">
                          <label className="form-label">End Time <span className="required">*</span></label>
                          <input
                            type="time"
                            value={formData.end_time}
                            onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                            required
                            className="form-input"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Check-In Settings Section */}
                    <div className="form-section">
                      <div className="form-section-header">
                        <h4>Check-In Settings</h4>
                      </div>
                      <div className="form-group">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.requires_daily_checkin}
                            onChange={(e) => {
                              const isEnabled = e.target.checked
                              setFormData({ 
                                ...formData, 
                                requires_daily_checkin: isEnabled,
                                daily_checkin_start_time: isEnabled ? (formData.daily_checkin_start_time || '08:00') : '',
                                daily_checkin_end_time: isEnabled ? (formData.daily_checkin_end_time || '09:00') : '',
                                check_in_window_start: isEnabled ? '' : formData.check_in_window_start,
                                check_in_window_end: isEnabled ? '' : formData.check_in_window_end,
                              })
                            }}
                          />
                          <span>Require Daily Check-In</span>
                        </label>
                        <small className="field-help">
                          If enabled, workers must complete daily check-in within the specified time range
                        </small>
                      </div>

                      {formData.requires_daily_checkin ? (
                        <div className="form-row">
                          <div className="form-group">
                            <label className="form-label">Daily Check-In Start Time <span className="required">*</span></label>
                            <input
                              type="time"
                              value={formData.daily_checkin_start_time}
                              onChange={(e) => {
                                const newStart = e.target.value
                                setFormData({ 
                                  ...formData, 
                                  daily_checkin_start_time: newStart,
                                  daily_checkin_end_time: formData.daily_checkin_end_time && formData.daily_checkin_end_time <= newStart
                                    ? addOneHour(newStart)
                                    : formData.daily_checkin_end_time
                                })
                              }}
                              required={formData.requires_daily_checkin}
                              className="form-input"
                            />
                            <small className="field-help">When daily check-in window opens</small>
                          </div>

                          <div className="form-group">
                            <label className="form-label">Daily Check-In End Time <span className="required">*</span></label>
                            <input
                              type="time"
                              value={formData.daily_checkin_end_time}
                              onChange={(e) => {
                                const newEnd = e.target.value
                                setFormData({ 
                                  ...formData, 
                                  daily_checkin_end_time: newEnd
                                })
                              }}
                              required={formData.requires_daily_checkin}
                              className="form-input"
                            />
                            <small className="field-help">When daily check-in window closes</small>
                          </div>
                        </div>
                      ) : (
                        <div className="form-row">
                          <div className="form-group">
                            <label className="form-label">Check-In Window Start <span className="optional">(Optional)</span></label>
                            <input
                              type="time"
                              value={formData.check_in_window_start}
                              onChange={(e) => setFormData({ ...formData, check_in_window_start: e.target.value })}
                              className="form-input"
                            />
                            <small className="field-help">Custom check-in window start (leave empty to auto-calculate)</small>
                          </div>

                          <div className="form-group">
                            <label className="form-label">Check-In Window End <span className="optional">(Optional)</span></label>
                            <input
                              type="time"
                              value={formData.check_in_window_end}
                              onChange={(e) => setFormData({ ...formData, check_in_window_end: e.target.value })}
                              className="form-input"
                            />
                            <small className="field-help">Custom check-in window end (leave empty to auto-calculate)</small>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Additional Information Section */}
                    <div className="form-section">
                      <div className="form-section-header">
                        <h4>Additional Information</h4>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Notes <span className="optional">(Optional)</span></label>
                        <textarea
                          value={formData.notes}
                          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                          className="form-input"
                          rows={3}
                          placeholder="Add notes about this schedule..."
                        />
                      </div>

                      {editingSchedule && (
                        <div className="form-group">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={formData.is_active}
                              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                            />
                            <span>Active Schedule</span>
                          </label>
                          <small className="field-help">Toggle to activate or deactivate this schedule</small>
                        </div>
                      )}
                    </div>

                    {error && <div className="form-error">{error}</div>}

                    <div className="form-actions-sidebar">
                      <button 
                        type="button" 
                        onClick={() => {
                          setSidebarMode('view')
                          setEditingSchedule(null)
                          setError('')
                        }} 
                        className="btn-secondary"
                        disabled={creating}
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit" 
                        className="btn-primary"
                        disabled={creating || (!editingSchedule && formData.worker_ids.length === 0)}
                      >
                        {creating ? (
                          <>
                            <span className="spinner"></span>
                            Creating...
                          </>
                        ) : editingSchedule ? (
                          'Update Schedule'
                        ) : (
                          'Create Schedule'
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </>
        )}

        {/* Create Schedule Confirmation Modal */}
        {showCreateConfirmModal && (
          <div className="confirm-modal-overlay" onClick={handleCancelCreate}>
            <div className="confirm-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="confirm-modal-header">
                <div className="confirm-modal-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 11l3 3L22 4"></path>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                  </svg>
                </div>
                <h3>Create Schedule</h3>
              </div>
              <div className="confirm-modal-body">
                <p>Are you sure you want to create this schedule?</p>
                <div className="confirm-schedule-info">
                  <div className="confirm-info-row">
                    <span className="confirm-info-label">Workers:</span>
                    <span className="confirm-info-value">
                      {formData.worker_ids.length} worker{formData.worker_ids.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {useRange ? (
                    <>
                      <div className="confirm-info-row">
                        <span className="confirm-info-label">Date Range:</span>
                        <span className="confirm-info-value">
                          {formData.start_date} to {formData.end_date}
                        </span>
                      </div>
                      <div className="confirm-info-row">
                        <span className="confirm-info-label">Days:</span>
                        <span className="confirm-info-value">
                          {selectedDays.map(d => {
                            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
                            return days[d]
                          }).join(', ')}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="confirm-info-row">
                      <span className="confirm-info-label">Date:</span>
                      <span className="confirm-info-value">{formData.scheduled_date}</span>
                    </div>
                  )}
                  <div className="confirm-info-row">
                    <span className="confirm-info-label">Time:</span>
                    <span className="confirm-info-value">
                      {formData.start_time} - {formData.end_time}
                    </span>
                  </div>
                </div>
              </div>
              <div className="confirm-modal-footer">
                <button
                  className="confirm-cancel-btn"
                  onClick={handleCancelCreate}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  className="confirm-submit-btn"
                  onClick={handleConfirmCreate}
                  disabled={creating}
                >
                  {creating ? 'Creating...' : 'Yes, Create Schedule'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Deactivate Confirmation Modal */}
        {showDeactivateConfirmModal && scheduleToDeactivate && (
          <div className="confirm-modal-overlay" onClick={() => setShowDeactivateConfirmModal(false)}>
            <div className="confirm-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="confirm-modal-header">
                <div className="confirm-modal-icon close-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </div>
                <h3>Deactivate Schedule</h3>
              </div>
              <div className="confirm-modal-body">
                <p>Are you sure you want to deactivate this schedule?</p>
                <div className="confirm-schedule-info">
                  <div className="confirm-info-row">
                    <span className="confirm-info-label">Worker:</span>
                    <span className="confirm-info-value">
                      {getWorkerName({ users: workers.find(w => w.id === scheduleToDeactivate.worker_id) } as any)}
                    </span>
                  </div>
                  <div className="confirm-info-row">
                    <span className="confirm-info-label">Date:</span>
                    <span className="confirm-info-value">
                      {scheduleToDeactivate.scheduled_date ? (
                        new Date(scheduleToDeactivate.scheduled_date).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })
                      ) : scheduleToDeactivate.day_of_week !== null && scheduleToDeactivate.day_of_week !== undefined ? (
                        DAYS_OF_WEEK.find(d => d.value === scheduleToDeactivate.day_of_week)?.label || 'Recurring'
                      ) : (
                        'No date'
                      )}
                    </span>
                  </div>
                  <div className="confirm-info-row">
                    <span className="confirm-info-label">Time:</span>
                    <span className="confirm-info-value">
                      {scheduleToDeactivate.start_time} - {scheduleToDeactivate.end_time}
                    </span>
                  </div>
                </div>
              </div>
              <div className="confirm-modal-footer">
                <button
                  className="confirm-cancel-btn"
                  onClick={() => {
                    setShowDeactivateConfirmModal(false)
                    setScheduleToDeactivate(null)
                  }}
                >
                  Cancel
                </button>
                <button
                  className="confirm-submit-btn close-submit-btn"
                  onClick={() => {
                    if (scheduleToDeactivate) {
                      performToggleScheduleStatus(scheduleToDeactivate, false, 'deactivate')
                      setShowDeactivateConfirmModal(false)
                      setScheduleToDeactivate(null)
                    }
                  }}
                >
                  Yes, Deactivate
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Success Toast Notification */}
        {showSuccessToast && (
          <div className="success-toast">
            <div className="success-toast-content">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>{successMessage}</span>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
