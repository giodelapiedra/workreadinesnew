import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { calculateAge, getTodayDateString } from '../../../shared/date'
import { validateBirthday } from '../../../utils/validationUtils'
import './TeamLeaderDashboard.css'
import '../../../styles/simpleModal.css'

interface TeamMember {
  id: string
  user_id: string
  phone?: string
  users?: {
    id: string
    email: string
    first_name?: string
    last_name?: string
    full_name?: string
    role: string
    phone?: string
  }
}

interface Team {
  id: string
  name: string
  site_location?: string
  team_leader_id: string
}

interface Supervisor {
  id: string
  email: string
  first_name?: string
  last_name?: string
  full_name?: string
}

interface TeamData {
  team: Team
  supervisor?: Supervisor | null
  members: TeamMember[]
  statistics: {
    totalMembers: number
    activeWorkers: number
    totalExemptions: number
    totalCases: number
  }
}

export function TeamLeaderDashboard() {
  const { user, business_name } = useAuth()
  const [teamData, setTeamData] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)
  const [totalRecords, setTotalRecords] = useState(0)
  const [showAddModal, setShowAddModal] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showTeamSetupModal, setShowTeamSetupModal] = useState(false)
  const [showExceptionModal, setShowExceptionModal] = useState(false)
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null)
  const [error, setError] = useState('')
  const [exceptions, setExceptions] = useState<Record<string, any>>({})
  const [workersWithSchedules, setWorkersWithSchedules] = useState<Set<string>>(new Set())

  // Form states
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    phone: '',
    role: 'worker',
    gender: '' as 'male' | 'female' | '',
    date_of_birth: '',
  })
  const [birthMonth, setBirthMonth] = useState('')
  const [birthDay, setBirthDay] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [birthdayError, setBirthdayError] = useState('')
  
  const [teamSetupData, setTeamSetupData] = useState({
    name: '',
    site_location: '',
  })
  
  const [exceptionForm, setExceptionForm] = useState({
    exception_type: 'transfer',
    reason: '',
    start_date: getTodayDateString(),
    end_date: '',
    transfer_to_team_id: '',
  })
  const [currentException, setCurrentException] = useState<any>(null)
  const [availableTeams, setAvailableTeams] = useState<Array<{ id: string; name: string; site_location?: string; display_name: string; team_leader?: { name: string } }>>([])
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  const [showSuccessToast, setShowSuccessToast] = useState(false)
  const [successToastMessage, setSuccessToastMessage] = useState('')
  const [showTransferConfirm, setShowTransferConfirm] = useState(false)
  const [transferConfirmData, setTransferConfirmData] = useState<{
    workerName: string
    targetTeamName: string
  } | null>(null)
  const [showExceptionErrorDialog, setShowExceptionErrorDialog] = useState(false)
  const [exceptionErrorDialogMessage, setExceptionErrorDialogMessage] = useState('')
  const [showRemoveExceptionConfirm, setShowRemoveExceptionConfirm] = useState(false)

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearchQuery])

  // Helper function to reload exceptions (extracted to avoid duplication)
  const reloadExceptions = useCallback(async () => {
    try {
      const exResult = await apiClient.get<{ exceptions: any[] }>(API_ROUTES.TEAMS.EXCEPTIONS)
      if (!isApiError(exResult)) {
        const exData = exResult.data
        const exceptionsMap: Record<string, any> = {}
        exData.exceptions?.forEach((ex: any) => {
          exceptionsMap[ex.user_id] = ex
        })
        setExceptions(exceptionsMap)
      }
    } catch (error) {
      console.error('Error reloading exceptions:', error)
    }
  }, [])

  // Shared function to load team data and exceptions (extracted to avoid duplication)
  const loadTeamDataAndExceptions = useCallback(async () => {
      try {
        const params = new URLSearchParams()
        if (debouncedSearchQuery.trim()) {
          params.append('search', debouncedSearchQuery.trim())
        }
        params.append('page', currentPage.toString())
        params.append('limit', itemsPerPage.toString())

        const queryString = params.toString()

        // OPTIMIZATION: Fetch all data in parallel instead of sequential
        const [teamResult, exceptionsResult] = await Promise.all([
          apiClient.get<TeamData>(queryString ? `${API_ROUTES.TEAMS.BASE}?${queryString}` : API_ROUTES.TEAMS.BASE),
          apiClient.get<{ exceptions: any[] }>(API_ROUTES.TEAMS.EXCEPTIONS),
        ])

        if (isApiError(teamResult)) {
          throw new Error(getApiErrorMessage(teamResult) || 'Failed to fetch team data')
        }

        const data = teamResult.data
        const exceptionsData = !isApiError(exceptionsResult) ? exceptionsResult.data : { exceptions: [] }
        
          // Check if team data is valid
          if (!data || !data.team) {
            setTeamData(null)
            setShowTeamSetupModal(true)
            setError('')
            return
          }

          // Process exceptions data
          const exceptions = exceptionsData.exceptions || []
          const exceptionsMap: Record<string, any> = {}
          exceptions.forEach((ex: any) => {
            exceptionsMap[ex.user_id] = ex
          })
          setExceptions(exceptionsMap)

          // Extract workers with schedules from team data statistics
          if (data.statistics && data.statistics.activeWorkers) {
            const workersWithSchedule = new Set<string>()
            data.members?.forEach((member: any) => {
              if (member.has_active_schedule) {
                workersWithSchedule.add(member.user_id)
              }
            })
            setWorkersWithSchedules(workersWithSchedule)
          }

          setTeamData(data)
          setTotalRecords((data as any).totalRecords || data.members?.length || 0)
          setShowTeamSetupModal(false)
          setError('')
    } catch (err: any) {
      console.error('[TeamLeaderDashboard] Error loading data:', err)
      setError(err.message || 'Failed to load team data')
      setTeamData(null)
      setShowTeamSetupModal(false)
    }
  }, [debouncedSearchQuery, currentPage, itemsPerPage])

  useEffect(() => {
    let isMounted = true
    
    const loadAllData = async () => {
      if (!user) {
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        await loadTeamDataAndExceptions()
      } catch (err: any) {
        if (isMounted) {
          console.error('[TeamLeaderDashboard] Error loading data:', err)
          setError(err.message || 'Failed to load team data')
          setTeamData(null)
          setShowTeamSetupModal(false)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    if (user) {
      loadAllData()
    } else {
      setLoading(false)
    }

    return () => {
      isMounted = false
    }
  }, [currentPage, debouncedSearchQuery, itemsPerPage, loadTeamDataAndExceptions])

  // OPTIMIZATION: Debounced fetch to prevent duplicate calls (only fetches team data, not exceptions)
  const fetchTeamDataDebounced = useCallback(async () => {
    // Prevent duplicate calls within 100ms
    if (fetchTeamData.pending) {
      return fetchTeamData.pending
    }

    const promise = (async () => {
      try {
        setError('')
        // Build query parameters for pagination (reuse same logic as loadTeamDataAndExceptions)
        const params = new URLSearchParams()
        if (debouncedSearchQuery.trim()) {
          params.append('search', debouncedSearchQuery.trim())
        }
        params.append('page', currentPage.toString())
        params.append('limit', itemsPerPage.toString())

        const queryString = params.toString()
        const result = await apiClient.get<TeamData>(
          queryString ? `${API_ROUTES.TEAMS.BASE}?${queryString}` : API_ROUTES.TEAMS.BASE
        )

        if (isApiError(result)) {
          throw new Error(getApiErrorMessage(result) || 'Failed to fetch team data')
        }

        const data = result.data
        
        // If no team exists, show create team modal
        if (!data.team || data.team === null) {
          setTeamData(null)
          setShowTeamSetupModal(true)
          setTotalRecords(0)
        } else {
          setTeamData(data)
          setTotalRecords((data as any).totalRecords || data.members?.length || 0)
          setShowTeamSetupModal(false)
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load team data')
      } finally {
        fetchTeamData.pending = null
      }
    })()

    fetchTeamData.pending = promise
    return promise
  }, [currentPage, debouncedSearchQuery, itemsPerPage])

  const fetchTeamData = fetchTeamDataDebounced as typeof fetchTeamDataDebounced & { pending: Promise<void> | null }
  fetchTeamData.pending = null

  const handleTeamSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!teamSetupData.name || teamSetupData.name.trim() === '') {
      setError('Team name is required')
      return
    }

    try {
      // Check if team exists to decide between POST (create) or PATCH (update)
      const checkResult = await apiClient.get<{ team: Team | null }>(API_ROUTES.TEAMS.BASE)
      const checkData = !isApiError(checkResult) ? checkResult.data : { team: null }
      const method = (!checkData.team || checkData.team === null) ? 'POST' : 'PATCH'

      const result = method === 'POST'
        ? await apiClient.post<{ message: string }>(API_ROUTES.TEAMS.BASE, teamSetupData)
        : await apiClient.patch<{ message: string }>(API_ROUTES.TEAMS.BASE, teamSetupData)

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || `Failed to ${method === 'POST' ? 'create' : 'update'} team`)
      }

      setShowTeamSetupModal(false)
      setTeamSetupData({ name: '', site_location: '' })
      await fetchTeamData()
    } catch (err: any) {
      setError(err.message || 'Failed to setup team')
    }
  }

  // Use centralized validation utility
  // Note: validateBirthday is imported from utils/validationUtils

  const handleAddMember = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault()
    }
    setError('')
    setAdding(true)

    // Validate birthday from dropdowns
    if (!birthMonth || !birthDay || !birthYear) {
      setBirthdayError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      setError('Date of Birth is required')
      return
    }

    // Construct date string from dropdowns
    const dateStr = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`
    const birthDate = new Date(dateStr)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    // Validate date
    if (isNaN(birthDate.getTime())) {
      setBirthdayError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      setError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      return
    }
    
    if (birthDate >= today) {
      setBirthdayError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      setError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      return
    }
    
    // Check minimum age (18 years old)
    const age = calculateAge(dateStr)
    if (age === null) {
      setBirthdayError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      setError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      return
    }
    if (age < 18) {
      setBirthdayError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      setError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      return
    }

    try {
      const result = await apiClient.post<{ message: string }>(
        API_ROUTES.TEAMS.MEMBERS,
        {
          email: formData.email.trim(),
          password: formData.password,
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim(),
          phone: formData.phone.trim() || null,
          role: formData.role,
          gender: formData.gender || undefined,
          date_of_birth: dateStr,
        }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to add team member')
      }

      // Reset form and close modal
      setFormData({
        email: '',
        password: '',
        first_name: '',
        last_name: '',
        phone: '',
        role: 'worker',
        gender: '',
        date_of_birth: '',
      })
      setBirthMonth('')
      setBirthDay('')
      setBirthYear('')
      setBirthdayError('')
      setShowAddModal(false)
      await fetchTeamData()
      setSuccessToastMessage('Team member successfully added')
      setShowSuccessToast(true)
      setTimeout(() => setShowSuccessToast(false), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to add team member')
    } finally {
      setAdding(false)
    }
  }

  const handleEditMember = useCallback((member: TeamMember) => {
    setSelectedMember(member)
    
    // If full_name exists but first_name/last_name are missing, try to split full_name
    let firstName = member.users?.first_name || ''
    let lastName = member.users?.last_name || ''
    
    if ((!firstName || !lastName) && member.users?.full_name) {
      const fullNameParts = member.users.full_name.trim().split(' ')
      if (fullNameParts.length > 0) {
        firstName = firstName || fullNameParts[0] || ''
        lastName = lastName || fullNameParts.slice(1).join(' ') || ''
      }
    }
    
    setFormData({
      email: member.users?.email || '',
      password: '',
      first_name: firstName,
      last_name: lastName,
      phone: member.phone || '',
      role: member.users?.role || 'worker', // For display only, not editable
      gender: '' as 'male' | 'female' | '',
      date_of_birth: '',
    })
    setShowEditModal(true)
  }, [])

  const handleUpdateMember = useCallback(async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault()
    if (!selectedMember) return

    // Validate inputs
    const trimmedFirstName = formData.first_name.trim()
    const trimmedLastName = formData.last_name.trim()
    const trimmedPhone = formData.phone.trim()

    if (!trimmedFirstName || !trimmedLastName) {
      setError('First name and last name are required')
      return
    }

    // Validate name length (security: prevent extremely long strings)
    if (trimmedFirstName.length > 100 || trimmedLastName.length > 100) {
      setError('Name fields must be less than 100 characters')
      return
    }

    // Validate phone format (optional but if provided, should be reasonable)
    if (trimmedPhone && trimmedPhone.length > 20) {
      setError('Phone number is too long')
      return
    }

    setError('')

    try {
      const result = await apiClient.patch<{ message: string }>(
        API_ROUTES.TEAMS.MEMBER(selectedMember.id),
        {
          first_name: trimmedFirstName,
          last_name: trimmedLastName,
          phone: trimmedPhone || null,
          // Role is NOT sent - backend will not update it (security)
        }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to update team member')
      }

      setShowEditModal(false)
      setSelectedMember(null)
      // Refresh team data directly
      const refreshResult = await apiClient.get<TeamData>(API_ROUTES.TEAMS.BASE)
      if (!isApiError(refreshResult) && refreshResult.data.team) {
        setTeamData(refreshResult.data)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update team member')
    }
  }, [selectedMember, formData])


  const handleManageException = async (member: TeamMember) => {
    setSelectedMember(member)
    setError('')
    setLoadingTeams(true)

    // Load available teams for transfer (only teams under same supervisor)
    try {
      const teamsResult = await apiClient.get<{ teams: any[] }>(API_ROUTES.TEAMS.ALL)
      if (!isApiError(teamsResult)) {
        const teamsData = teamsResult.data
        // Backend already filters by supervisor_id, but also filter out current team as safety
        const filteredTeams = (teamsData.teams || []).filter((t: any) => t.id !== teamData?.team?.id)
        setAvailableTeams(filteredTeams)
      }
    } catch (error) {
      console.error('Error loading teams:', error)
    } finally {
      setLoadingTeams(false)
    }

    // Check if worker has existing exception
    const defaultExceptionForm = {
      exception_type: 'transfer' as const,
      reason: '',
      start_date: getTodayDateString(),
      end_date: '',
      transfer_to_team_id: '',
    }

    try {
      const result = await apiClient.get<{ exception: any }>(
        API_ROUTES.TEAMS.MEMBER_EXCEPTION(member.id)
      )

      if (!isApiError(result)) {
        const data = result.data
        if (data.exception) {
          setCurrentException(data.exception)
          setExceptionForm({
            exception_type: data.exception.exception_type,
            reason: data.exception.reason || '',
            start_date: data.exception.start_date,
            end_date: data.exception.end_date || '',
            transfer_to_team_id: '',
          })
        } else {
          setCurrentException(null)
          setExceptionForm(defaultExceptionForm)
        }
      } else {
        setCurrentException(null)
        setExceptionForm(defaultExceptionForm)
      }
    } catch (error) {
      console.error('Error loading exception:', error)
      setCurrentException(null)
      setExceptionForm(defaultExceptionForm)
    }

    setShowExceptionModal(true)
  }

  const handleSaveException = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault()
    if (!selectedMember) return

    // Show confirmation modal for transfer
    if (exceptionForm.exception_type === 'transfer') {
      const targetTeam = availableTeams.find(t => t.id === exceptionForm.transfer_to_team_id)
      const targetTeamName = targetTeam?.name || 'the selected team'
      const workerName = selectedMember.users?.full_name || 
                        (selectedMember.users?.first_name && selectedMember.users?.last_name 
                          ? `${selectedMember.users.first_name} ${selectedMember.users.last_name}`
                          : selectedMember.users?.email || 'this worker')
      
      setTransferConfirmData({ workerName, targetTeamName })
      setShowTransferConfirm(true)
      return
    }

    await proceedWithSaveException()
  }

  const proceedWithSaveException = async () => {
    if (!selectedMember) return

    setError('')

    // VALIDATION: If updating existing exception, prevent update if exception type is the same
    // User must remove the exception first if they want to change the exception type
    if (currentException) {
      const isSameExceptionType = currentException.exception_type === exceptionForm.exception_type
      
      // If exception type is the same, prevent update - user must remove exception first
      if (isSameExceptionType) {
        setExceptionErrorDialogMessage('Cannot update exception with the same type. Please remove the existing exception first, then create a new one with the desired type.')
        setShowExceptionErrorDialog(true)
        return
      }
    }

    try {
      const result = await apiClient.post<{ message: string; transferred?: boolean }>(
        API_ROUTES.TEAMS.MEMBER_EXCEPTION(selectedMember.id),
        {
          exception_type: exceptionForm.exception_type,
          reason: exceptionForm.reason || null,
          start_date: exceptionForm.start_date,
          end_date: exceptionForm.end_date || null,
          transfer_to_team_id: exceptionForm.exception_type === 'transfer' ? exceptionForm.transfer_to_team_id : null,
        }
      )

      if (isApiError(result)) {
        const errorMessage = getApiErrorMessage(result) || 'Failed to save exception'
        // Check if error is about duplicate exception
        if (errorMessage.toLowerCase().includes('already') || errorMessage.toLowerCase().includes('duplicate')) {
          setError('An active exception with this type already exists. Please remove the existing exception first or choose a different exception type.')
        } else {
          setError(errorMessage)
        }
        return
      }

      setShowExceptionModal(false)
      setSelectedMember(null)
      
      // If transferred, show success message
      if (result.data.transferred) {
        setSuccessToastMessage('Worker has been transferred to the new team successfully!')
        setShowSuccessToast(true)
        setTimeout(() => setShowSuccessToast(false), 3000)
      } else if (currentException) {
        // Update existing exception
        setSuccessToastMessage('Exception updated successfully')
        setShowSuccessToast(true)
        setTimeout(() => setShowSuccessToast(false), 3000)
      } else {
        // Create new exception
        setSuccessToastMessage('Exception created successfully')
        setShowSuccessToast(true)
        setTimeout(() => setShowSuccessToast(false), 3000)
      }
      
      // Reload team data to reflect changes (worker moved to new team if transfer)
      await fetchTeamData()
      
      // Reload exceptions
      await reloadExceptions()
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to save exception'
      // Check if error is about duplicate exception
      if (errorMessage.toLowerCase().includes('already') || errorMessage.toLowerCase().includes('duplicate')) {
        setError('An active exception with this type already exists. Please remove the existing exception first or choose a different exception type.')
      } else {
        setError(errorMessage)
      }
    }
  }

  const handleConfirmTransfer = async () => {
    setShowTransferConfirm(false)
    await proceedWithSaveException()
  }

  const handleCancelTransfer = () => {
    setShowTransferConfirm(false)
    setTransferConfirmData(null)
  }

  const handleRemoveException = () => {
    if (!currentException || !selectedMember) return
    setShowRemoveExceptionConfirm(true)
  }

  const handleConfirmRemoveException = async () => {
    if (!currentException || !selectedMember) return
    setShowRemoveExceptionConfirm(false)

    try {
      const result = await apiClient.delete<{ reactivatedSchedules: number }>(
        `${API_ROUTES.TEAMS.EXCEPTIONS}/${currentException.id}`
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to remove exception')
      }

      const data = result.data
      
      // Show success message with schedule reactivation info
      if (data.reactivatedSchedules > 0) {
        setSuccessToastMessage(`Exception removed successfully. ${data.reactivatedSchedules} schedule(s) were automatically reactivated.`)
      } else {
        setSuccessToastMessage('Exception removed successfully.')
      }
      setShowSuccessToast(true)
      setTimeout(() => setShowSuccessToast(false), 3000)

      setShowExceptionModal(false)
      setSelectedMember(null)
      await fetchTeamData()
      
      // Reload exceptions
      await reloadExceptions()
    } catch (err: any) {
      setError(err.message || 'Failed to remove exception')
    }
  }

  const handleCancelRemoveException = () => {
    setShowRemoveExceptionConfirm(false)
  }

  const getInitials = (firstName?: string, lastName?: string, fullName?: string, email?: string) => {
    // Try to use first_name and last_name first
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
    }
    // Fallback to full_name if available
    const name = fullName || (firstName && lastName ? `${firstName} ${lastName}` : '') || ''
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    }
    if (email) {
      return email.substring(0, 2).toUpperCase()
    }
    return '??'
  }

  const getAvatarColor = (name: string) => {
    const colors = [
      '#EF4444', '#F59E0B', '#10B981', '#3B82F6', 
      '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
    ]
    const index = name.charCodeAt(0) % colors.length
    return colors[index]
  }


  // Backend already handles filtering and pagination, so we just use the members from API
  const filteredMembers = teamData?.members || []

  // Calculate pagination info
  const totalPages = useMemo(() => {
    return Math.ceil(totalRecords / itemsPerPage) || 1
  }, [totalRecords, itemsPerPage])
  
  const startRecord = useMemo(() => {
    return totalRecords > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0
  }, [currentPage, itemsPerPage, totalRecords])
  
  const endRecord = useMemo(() => {
    return Math.min(currentPage * itemsPerPage, totalRecords)
  }, [currentPage, itemsPerPage, totalRecords])

  if (loading) {
    return (
      <DashboardLayout>
        <div className="team-leader-dashboard-simple">
          <Loading message="Loading team data..." size="medium" />
        </div>
      </DashboardLayout>
    )
  }

  // If no team exists, show create team modal
  if (!teamData && !loading) {
    if (error) {
      return (
        <DashboardLayout>
          <div className="team-leader-dashboard-simple">
            <div className="team-leader-error">
              <p>{error || 'Failed to load team data. Please try refreshing the page.'}</p>
          </div>
        </div>
        </DashboardLayout>
      )
    }
    // Show modal for creating team (no dashboard content until team is created)
    return (
      <DashboardLayout>
        <div className="team-leader-dashboard-simple">
          {/* Create Team Modal - mandatory when no team exists */}
          {showTeamSetupModal && (
            <div className="modal-overlay" onClick={() => {}}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Create Your Team</h3>
                </div>
                {error && (
                  <div className="error-message" style={{ margin: '0 24px 16px 24px' }}>
                    {error}
                  </div>
                )}
                <form onSubmit={handleTeamSetup} className="member-form">
                  <div className="form-group">
                    <label>Team Name *</label>
                    <input
                      type="text"
                      required
                      value={teamSetupData.name}
                      onChange={(e) => setTeamSetupData({ ...teamSetupData, name: e.target.value })}
                      placeholder="Enter your team name (e.g., Team Delta)"
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label>Site Location (Optional)</label>
                    <input
                      type="text"
                      value={teamSetupData.site_location}
                      onChange={(e) => setTeamSetupData({ ...teamSetupData, site_location: e.target.value })}
                      placeholder="e.g., Pilbara Site A"
                    />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="submit-btn">
                      Create Team
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </DashboardLayout>
    )
  }

  // Type guard: teamData must exist at this point
  if (!teamData) {
    return null
  }

  return (
    <DashboardLayout>
      <div className="team-leader-dashboard-simple">
      {/* Header */}
        <div className="team-leader-header">
          <div>
            <h1 className="team-leader-title">Team Members</h1>
            <p className="team-leader-subtitle">
              {business_name ? `${business_name} • Manage your team roster and assignments.` : 'Manage your team roster and assignments.'}
            </p>
          </div>
          <button className="team-leader-add-btn" onClick={() => setShowAddModal(true)}>
            + Add Team Member
          </button>
        </div>

      {/* Statistics Cards */}
        <div className="team-leader-stats">
          <div className="team-leader-stat-card">
            <div className="team-leader-stat-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <div className="team-leader-stat-content">
            <div className="team-leader-stat-value">{teamData.statistics.totalMembers}</div>
            <div className="team-leader-stat-label">Total Members</div>
            </div>
        </div>
          <div className="team-leader-stat-card">
            <div className="team-leader-stat-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
            </div>
            <div className="team-leader-stat-content">
            <div className="team-leader-stat-value team-leader-stat-green">{teamData.statistics.activeWorkers}</div>
            <div className="team-leader-stat-label">Active Workers</div>
            </div>
        </div>
          <div className="team-leader-stat-card">
            <div className="team-leader-stat-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </div>
            <div className="team-leader-stat-content">
            <div className="team-leader-stat-value">{teamData.statistics.totalCases}</div>
            <div className="team-leader-stat-label">Total Cases</div>
            </div>
        </div>
          <div className="team-leader-stat-card">
            <div className="team-leader-stat-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1 12l9.29 8.14a1 1 0 0 0 1.42 0l9.29-8.14a1 1 0 0 0 0-1.42l-9.29-8.14a1 1 0 0 0-1.42 0z"></path>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <line x1="12" y1="2" x2="12" y2="22"></line>
              </svg>
            </div>
            <div className="team-leader-stat-content">
            <div className="team-leader-stat-value">{teamData.statistics.totalExemptions}</div>
            <div className="team-leader-stat-label">Total Exemptions</div>
            </div>
      </div>
          </div>

          {/* Search Bar and Pagination */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div className="team-leader-search" style={{ flex: 1, minWidth: '200px' }}>
            <svg className="team-leader-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
            <input
              type="text"
              placeholder="Search members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="team-leader-search-input"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#64748B' }}>
              {totalRecords > 0 ? `${startRecord}-${endRecord} of ${totalRecords}` : '0 members'}
            </span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value))
                setCurrentPage(1)
              }}
              style={{
                padding: '6px 8px',
                border: '1px solid #E2E8F0',
                borderRadius: '6px',
                fontSize: '13px',
                backgroundColor: 'white',
                color: '#0F172A',
                cursor: 'pointer',
              }}
              title="Items per page"
            >
              <option value="10">10 per page</option>
              <option value="20">20 per page</option>
              <option value="50">50 per page</option>
              <option value="100">100 per page</option>
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                style={{
                  padding: '6px 8px',
                  border: '1px solid #E2E8F0',
                  borderRadius: '6px',
                  backgroundColor: currentPage === 1 ? '#F8FAFC' : 'white',
                  color: currentPage === 1 ? '#94A3B8' : '#0F172A',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Previous page"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
              <span style={{ fontSize: '13px', color: '#0F172A', minWidth: '80px', textAlign: 'center' }}>
                Page {currentPage} of {totalPages || 1}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages || totalPages === 0}
                style={{
                  padding: '6px 8px',
                  border: '1px solid #E2E8F0',
                  borderRadius: '6px',
                  backgroundColor: (currentPage >= totalPages || totalPages === 0) ? '#F8FAFC' : 'white',
                  color: (currentPage >= totalPages || totalPages === 0) ? '#94A3B8' : '#0F172A',
                  cursor: (currentPage >= totalPages || totalPages === 0) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Next page"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </div>
          </div>
        </div>

          {/* Error Message */}
          {error && (
          <div className="team-leader-error">
            <p>{error}</p>
            <button onClick={() => setError('')} className="team-leader-error-close">×</button>
            </div>
          )}

          {/* Team Members List */}
        <div className="team-leader-members-list">
            {filteredMembers.length === 0 ? (
            <div className="team-leader-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ margin: '0 auto 16px', color: '#94A3B8' }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <p style={{ fontWeight: 500, color: '#0F172A', marginBottom: '4px' }}>
                {searchQuery ? 'No members match your search' : 'No team members found'}
              </p>
              <p style={{ fontSize: '13px', color: '#64748B' }}>
                {searchQuery 
                  ? 'Try adjusting your search query'
                  : 'Click "+ Add Team Member" to add your first worker.'}
              </p>
              </div>
          ) : (
            <div className="team-leader-members-table-container">
              {filteredMembers.map((member) => {
                const memberName = (() => {
                        if (member.users?.first_name && member.users?.last_name) {
                          return `${member.users.first_name} ${member.users.last_name}`
                        }
                        if (member.users?.full_name) {
                          return member.users.full_name
                        }
                        if (member.users?.email) {
                          return member.users.email
                        }
                        return 'Unknown'
                })()
                const initials = getInitials(member.users?.first_name, member.users?.last_name, member.users?.full_name, member.users?.email)
                const avatarColor = getAvatarColor(memberName)
                
                return (
                  <div key={member.id} className="team-leader-member-card">
                    <div className="team-leader-member-avatar" style={{ backgroundColor: avatarColor }}>
                      {initials}
                    </div>
                    <div className="team-leader-member-info">
                      <div className="team-leader-member-name">{memberName}</div>
                      <div className="team-leader-member-role">
                        <span className={`team-leader-role-badge ${member.users?.role === 'supervisor' ? 'role-supervisor' : 'role-worker'}`}>
                        {member.users?.role === 'supervisor' ? 'Supervisor' : 'Worker'}
                      </span>
                      {member.users?.role === 'worker' && (
                          <span className={workersWithSchedules.has(member.user_id) ? 'team-leader-active-badge' : 'team-leader-inactive-badge'}>
                            {workersWithSchedules.has(member.user_id) ? 'Active' : 'Inactive'}
                      </span>
                      )}
                      {exceptions[member.user_id] && (
                          <span className="team-leader-exception-badge">
                            ⚠️ Exception
                        </span>
                      )}
                    </div>
                      <div className="team-leader-member-contact">
                        {member.users?.email || 'N/A'}
                        {member.phone && ` • ${member.phone}`}
                    </div>
                  </div>
                    <div className="team-leader-member-actions">
                      <div className="team-leader-actions-dropdown">
                        <div className="team-leader-actions-header">
                          <span className="team-leader-actions-label">Actions</span>
                    <button
                            className="team-leader-actions-trigger"
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenDropdownId(openDropdownId === member.id ? null : member.id)
                            }}
                            title="Actions"
                    >
                            <span className="team-leader-actions-dots">⋮</span>
                    </button>
                        </div>
                        {openDropdownId === member.id && (
                          <div className="team-leader-actions-menu">
                    <button
                              className="team-leader-action-item"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleEditMember(member)
                                setOpenDropdownId(null)
                              }}
                            >
                              <span className="team-leader-action-icon">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                              </span>
                              <span className="team-leader-action-text">Edit</span>
                    </button>
                    <button
                              className={`team-leader-action-item ${exceptions[member.user_id] ? 'has-exception' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleManageException(member)
                                setOpenDropdownId(null)
                              }}
                            >
                              <span className="team-leader-action-icon">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                  <line x1="12" y1="9" x2="12" y2="13"></line>
                                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                </svg>
                              </span>
                              <span className="team-leader-action-text">Exception</span>
                            </button>
                          </div>
                        )}
                      </div>
                  </div>
                </div>
                )
              })}
            </div>
            )}
          </div>

      {/* Success Toast Notification */}
      {showSuccessToast && (
        <div className="success-toast">
          <div className="success-toast-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>{successToastMessage || 'Action completed successfully'}</span>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddModal && (
        <div 
          className="team-members-modal-overlay"
          onClick={() => !adding && setShowAddModal(false)}
        >
          <div 
            className="team-members-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="team-members-modal-header">
              <div>
                <h2 className="team-members-modal-title">Add Team Member</h2>
                <p className="team-members-modal-subtitle">Create a new team member account</p>
              </div>
              <button 
                className="team-members-modal-close"
                onClick={() => !adding && setShowAddModal(false)}
                aria-label="Close modal"
                disabled={adding}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="team-members-modal-body">
              {error && (
                <div style={{ 
                  backgroundColor: '#FEF2F2', 
                  border: '1px solid #FEE2E2', 
                  borderRadius: '8px', 
                  padding: '12px',
                  marginBottom: '20px'
                }}>
                  <p style={{ fontSize: '13px', color: '#991B1B', margin: 0 }}>
                    {error}
                  </p>
                </div>
              )}

              <form>
                <div className="team-members-form-group">
                  <label className="team-members-form-label">Email *</label>
                  <input
                    type="email"
                    className="team-members-form-input"
                    value={formData.email}
                    onChange={(e) => {
                      setFormData({ ...formData, email: e.target.value })
                      setError('')
                    }}
                    placeholder="Enter email address"
                    disabled={adding}
                    required
                  />
                </div>

                <div className="team-members-form-group">
                  <label className="team-members-form-label">Password *</label>
                  <input
                    type="password"
                    className="team-members-form-input"
                    value={formData.password}
                    onChange={(e) => {
                      setFormData({ ...formData, password: e.target.value })
                      setError('')
                    }}
                    placeholder="Enter password (min. 6 characters)"
                    minLength={6}
                    disabled={adding}
                    required
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <div className="team-members-form-group" style={{ flex: 1 }}>
                    <label className="team-members-form-label">First Name *</label>
                    <input
                      type="text"
                      className="team-members-form-input"
                      value={formData.first_name}
                      onChange={(e) => {
                        setFormData({ ...formData, first_name: e.target.value })
                        setError('')
                      }}
                      placeholder="Enter first name"
                      maxLength={100}
                      disabled={adding}
                      required
                    />
                  </div>

                  <div className="team-members-form-group" style={{ flex: 1 }}>
                    <label className="team-members-form-label">Last Name *</label>
                    <input
                      type="text"
                      className="team-members-form-input"
                      value={formData.last_name}
                      onChange={(e) => {
                        setFormData({ ...formData, last_name: e.target.value })
                        setError('')
                      }}
                      placeholder="Enter last name"
                      maxLength={100}
                      disabled={adding}
                      required
                    />
                  </div>
                </div>

                <div className="team-members-form-group">
                  <label className="team-members-form-label">Phone Number (Optional)</label>
                  <input
                    type="tel"
                    className="team-members-form-input"
                    value={formData.phone}
                    onChange={(e) => {
                      setFormData({ ...formData, phone: e.target.value })
                      setError('')
                    }}
                    placeholder="e.g., +1 (555) 123-4567"
                    maxLength={20}
                    disabled={adding}
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <div className="team-members-form-group" style={{ flex: 1 }}>
                    <label className="team-members-form-label">Gender <span className="required">*</span></label>
                    <select
                      className="team-members-form-input"
                      value={formData.gender}
                      onChange={(e) => {
                        setFormData({ ...formData, gender: e.target.value as 'male' | 'female' | '' })
                        setError('')
                      }}
                      disabled={adding}
                      required
                    >
                      <option value="">Select Gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>

                  <div className="team-members-form-group" style={{ flex: 1 }}>
                    <label className="team-members-form-label">
                      Birthday <span className="required">*</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: '4px', cursor: 'help' }}>
                        <title>Select birthday</title>
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                      </svg>
                    </label>
                    {birthdayError && (
                      <div className="birthday-error-message" style={{ marginBottom: '12px' }}>
                        {birthdayError}
                      </div>
                    )}
                    <div className="birthday-selects">
                      <select
                        value={birthMonth}
                        onChange={(e) => {
                          setBirthMonth(e.target.value)
                          const validation = validateBirthday(e.target.value, birthDay, birthYear)
                          setBirthdayError(validation.error)
                        }}
                        className="team-members-form-input birthday-select"
                        disabled={adding}
                        required
                      >
                        <option value="">Month</option>
                        {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, index) => (
                          <option key={month} value={String(index + 1)}>{month}</option>
                        ))}
                      </select>
                      <select
                        value={birthDay}
                        onChange={(e) => {
                          setBirthDay(e.target.value)
                          const validation = validateBirthday(birthMonth, e.target.value, birthYear)
                          setBirthdayError(validation.error)
                        }}
                        className="team-members-form-input birthday-select"
                        disabled={adding}
                        required
                      >
                        <option value="">Day</option>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                          <option key={day} value={String(day)}>{day}</option>
                        ))}
                      </select>
                      <select
                        value={birthYear}
                        onChange={(e) => {
                          setBirthYear(e.target.value)
                          const validation = validateBirthday(birthMonth, birthDay, e.target.value)
                          setBirthdayError(validation.error)
                        }}
                        className="team-members-form-input birthday-select"
                        disabled={adding}
                        required
                      >
                        <option value="">Year</option>
                        {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map(year => (
                          <option key={year} value={String(year)}>{year}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </form>
            </div>

            <div className="team-members-modal-footer">
              <button 
                className="team-members-modal-close-btn"
                onClick={() => {
                  if (!adding) {
                    setShowAddModal(false)
                    setError('')
                    setFormData({
                      email: '',
                      password: '',
                      first_name: '',
                      last_name: '',
                      phone: '',
                      role: 'worker',
                      gender: '',
                      date_of_birth: '',
                    })
                    setBirthMonth('')
                    setBirthDay('')
                    setBirthYear('')
                    setBirthdayError('')
                  }
                }}
                disabled={adding}
              >
                Cancel
              </button>
              <button
                className="team-members-modal-save-btn"
                onClick={handleAddMember}
                disabled={adding || !formData.email || !formData.password || !formData.first_name || !formData.last_name || !formData.gender || !birthMonth || !birthDay || !birthYear}
              >
                {adding ? 'Adding...' : 'Add Team Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Member Sidebar */}
      {showEditModal && selectedMember && (
        <>
          <div className="sidebar-overlay" onClick={() => setShowEditModal(false)}></div>
          <div className="sidebar-panel">
            <div className="sidebar-header">
              <h3>Edit Team Member</h3>
              <button className="sidebar-close" onClick={() => setShowEditModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="sidebar-body">
              <form className="member-form">
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={formData.email} disabled />
              </div>
              <div className="form-group">
                <label>First Name *</label>
                <input
                  type="text"
                  required
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Last Name *</label>
                <input
                  type="text"
                  required
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Role</label>
                <input
                  type="text"
                  value={formData.role?.toUpperCase() || 'N/A'}
                  disabled
                  style={{ background: '#F8FAFC', color: '#64748B', cursor: 'not-allowed' }}
                />
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '4px 0 0 0' }}>
                  Role cannot be changed
                </p>
              </div>
              </form>
            </div>
            <div className="sidebar-footer">
                <button type="button" onClick={() => setShowEditModal(false)} className="cancel-btn">
                  Cancel
                </button>
              <button type="button" onClick={handleUpdateMember} className="submit-btn">
                  Update Member
                </button>
              </div>
          </div>
        </>
      )}

      {/* Create Team Modal - for first time login */}
      {showTeamSetupModal && (
        <div className="modal-overlay" onClick={() => {}}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Your Team</h3>
            </div>
            {error && (
              <div className="error-message" style={{ margin: '0 24px 16px 24px' }}>
                {error}
              </div>
            )}
            <form onSubmit={handleTeamSetup} className="member-form">
              <div className="form-group">
                <label>Team Name *</label>
                <input
                  type="text"
                  required
                  value={teamSetupData.name}
                  onChange={(e) => setTeamSetupData({ ...teamSetupData, name: e.target.value })}
                  placeholder="Enter your team name (e.g., Team Delta)"
                />
              </div>
              <div className="form-group">
                <label>Site Location (Optional)</label>
                <input
                  type="text"
                  value={teamSetupData.site_location}
                  onChange={(e) => setTeamSetupData({ ...teamSetupData, site_location: e.target.value })}
                  placeholder="e.g., Pilbara Site A"
                />
              </div>
              <div className="form-actions">
                <button type="submit" className="submit-btn">
                  Create Team
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Exception Sidebar */}
      {showExceptionModal && selectedMember && (
        <>
          <div className="sidebar-overlay" onClick={() => setShowExceptionModal(false)}></div>
          <div className="sidebar-panel">
            <div className="sidebar-header">
              <h3>Manage Exception - {(() => {
                if (selectedMember.users?.first_name && selectedMember.users?.last_name) {
                  return `${selectedMember.users.first_name} ${selectedMember.users.last_name}`
                }
                if (selectedMember.users?.full_name) {
                  return selectedMember.users.full_name
                }
                return selectedMember.users?.email || 'Worker'
              })()}</h3>
              <button className="sidebar-close" onClick={() => setShowExceptionModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="sidebar-body">
            {error && (
                <div className="error-message" style={{ margin: '0 0 16px 0' }}>
                {error}
              </div>
            )}
            {currentException && (
              <>
                {/* Warning if assigned to WHS */}
                {currentException.assigned_to_whs && (
                  <div style={{
                      margin: '0 0 16px 0',
                    padding: '12px',
                    backgroundColor: '#FEE2E2',
                    borderRadius: '6px',
                    borderLeft: '4px solid #EF4444',
                  }}>
                    <p style={{ margin: 0, fontWeight: '600', color: '#991B1B', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      Exception Assigned to WHS
                    </p>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.875em', color: '#7F1D1D' }}>
                      This exception has been assigned to WHS Case Manager. You cannot modify or remove it until WHS closes the case.
                    </p>
                  </div>
                )}
                {/* Regular active exception info */}
              <div style={{
                    margin: '0 0 16px 0',
                padding: '12px',
                backgroundColor: '#fef3c7',
                borderRadius: '6px',
                borderLeft: '4px solid #f59e0b',
              }}>
                <p style={{ margin: 0, fontWeight: '600', color: '#92400e' }}>
                  Current Exception Active
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.9em', color: '#78350f' }}>
                  Type: {currentException.exception_type?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Unknown'}
                  {currentException.reason && ` • ${currentException.reason}`}
                </p>
              </div>
              </>
            )}
              <form className="member-form">
              <div className="form-group">
                <label>Exception Type *</label>
                <select
                  value={exceptionForm.exception_type}
                  onChange={(e) => setExceptionForm({ ...exceptionForm, exception_type: e.target.value, transfer_to_team_id: '' })}
                  required
                  disabled={currentException?.assigned_to_whs}
                >
                  <option value="transfer">Transfer</option>
                  <option value="accident">Accident</option>
                  <option value="injury">Injury</option>
                  <option value="medical_leave">Medical Leave</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {exceptionForm.exception_type === 'transfer' && (
                <div className="form-group">
                  <label>Transfer To Team *</label>
                  {loadingTeams ? (
                    <p>Loading teams...</p>
                  ) : availableTeams.length === 0 ? (
                    <p style={{ color: '#ef4444', fontSize: '0.9em' }}>No other teams available for transfer</p>
                  ) : (
                    <select
                      value={exceptionForm.transfer_to_team_id}
                      onChange={(e) => setExceptionForm({ ...exceptionForm, transfer_to_team_id: e.target.value })}
                      required
                      disabled={currentException?.assigned_to_whs}
                    >
                      <option value="">-- Select Team --</option>
                      {availableTeams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.display_name} {team.team_leader && `(Leader: ${team.team_leader.name})`}
                        </option>
                      ))}
                    </select>
                  )}
                  <small style={{ color: '#6b7280', marginTop: '4px', display: 'block' }}>
                    Select the team where this worker will be transferred to.
                  </small>
                </div>
              )}
              <div className="form-group">
                <label>Reason (Optional)</label>
                <textarea
                  value={exceptionForm.reason}
                  onChange={(e) => setExceptionForm({ ...exceptionForm, reason: e.target.value })}
                  placeholder="Enter reason for exception..."
                  rows={3}
                  disabled={currentException?.assigned_to_whs}
                />
              </div>
              <div className="form-group">
                <label>Start Date *</label>
                <input
                  type="date"
                  value={exceptionForm.start_date}
                  onChange={(e) => setExceptionForm({ ...exceptionForm, start_date: e.target.value })}
                  required
                  disabled={currentException?.assigned_to_whs}
                />
              </div>
              <div className="form-group">
                <label>End Date (Optional - leave empty for indefinite)</label>
                <input
                  type="date"
                  value={exceptionForm.end_date}
                  onChange={(e) => setExceptionForm({ ...exceptionForm, end_date: e.target.value })}
                  min={exceptionForm.start_date}
                  disabled={currentException?.assigned_to_whs}
                />
                <small style={{ color: '#6b7280', marginTop: '4px', display: 'block' }}>
                  If no end date is set, the exception will remain active until manually removed.
                </small>
              </div>
              </form>
            </div>
            <div className="sidebar-footer">
                {currentException && (
                  <button
                    type="button"
                    onClick={handleRemoveException}
                    className="cancel-btn"
                    style={{ 
                      backgroundColor: currentException?.assigned_to_whs ? '#9CA3AF' : '#ef4444', 
                      color: 'white', 
                      marginRight: 'auto',
                      cursor: currentException?.assigned_to_whs ? 'not-allowed' : 'pointer',
                      opacity: currentException?.assigned_to_whs ? 0.6 : 1
                    }}
                    disabled={currentException?.assigned_to_whs}
                    title={currentException?.assigned_to_whs ? 'Cannot remove: Exception assigned to WHS' : 'Remove exception'}
                  >
                    Remove Exception
                  </button>
                )}
                <button type="button" onClick={() => setShowExceptionModal(false)} className="cancel-btn">
                  Cancel
                </button>
                <button 
                type="button" 
                onClick={handleSaveException}
                  className="submit-btn"
                  disabled={currentException?.assigned_to_whs}
                  style={{
                    opacity: currentException?.assigned_to_whs ? 0.6 : 1,
                    cursor: currentException?.assigned_to_whs ? 'not-allowed' : 'pointer'
                  }}
                  title={currentException?.assigned_to_whs ? 'Cannot update: Exception assigned to WHS' : ''}
                >
                  {currentException ? 'Update Exception' : 'Create Exception'}
                </button>
              </div>
          </div>
        </>
      )}

      {/* Transfer Confirmation Modal */}
      {showTransferConfirm && transferConfirmData && (
        <div className="transfer-confirm-modal-overlay" onClick={handleCancelTransfer}>
          <div className="transfer-confirm-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="transfer-confirm-modal-header">
              <div className="transfer-confirm-modal-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                  <path d="M2 17l10 5 10-5"></path>
                  <path d="M2 12l10 5 10-5"></path>
                </svg>
              </div>
              <h3>Confirm Transfer</h3>
            </div>
            <div className="transfer-confirm-modal-body">
              <p>Are you sure you want to transfer this worker to the selected team?</p>
              <div className="transfer-confirm-info">
                <div className="transfer-confirm-info-row">
                  <span className="transfer-confirm-info-label">Worker:</span>
                  <span className="transfer-confirm-info-value">{transferConfirmData.workerName}</span>
                </div>
                <div className="transfer-confirm-info-row">
                  <span className="transfer-confirm-info-label">Target Team:</span>
                  <span className="transfer-confirm-info-value">{transferConfirmData.targetTeamName}</span>
                </div>
              </div>
            </div>
            <div className="transfer-confirm-modal-footer">
              <button className="transfer-confirm-cancel-btn" onClick={handleCancelTransfer}>
                Cancel
              </button>
              <button className="transfer-confirm-submit-btn" onClick={handleConfirmTransfer}>
                Confirm Transfer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Exception Confirmation Modal */}
      {showRemoveExceptionConfirm && currentException && selectedMember && (
        <div className="transfer-confirm-modal-overlay" onClick={handleCancelRemoveException}>
          <div className="transfer-confirm-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="transfer-confirm-modal-header">
              <div className="transfer-confirm-modal-icon" style={{ background: '#fee2e2', color: '#dc2626' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></path>
                </svg>
              </div>
              <h3>Remove Exception</h3>
            </div>
            <div className="transfer-confirm-modal-body">
              <p>Are you sure you want to remove this exception?</p>
              <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '8px' }}>
                All the worker schedules will be activated again.
              </p>
              <div className="transfer-confirm-info">
                <div className="transfer-confirm-info-row">
                  <span className="transfer-confirm-info-label">Worker:</span>
                  <span className="transfer-confirm-info-value">
                    {selectedMember.users?.full_name || 
                     (selectedMember.users?.first_name && selectedMember.users?.last_name 
                       ? `${selectedMember.users.first_name} ${selectedMember.users.last_name}`
                       : selectedMember.users?.email || 'N/A')}
                  </span>
                </div>
                <div className="transfer-confirm-info-row">
                  <span className="transfer-confirm-info-label">Exception Type:</span>
                  <span className="transfer-confirm-info-value">
                    {currentException.exception_type?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'N/A'}
                  </span>
                </div>
              </div>
            </div>
            <div className="transfer-confirm-modal-footer">
              <button className="transfer-confirm-cancel-btn" onClick={handleCancelRemoveException}>
                Cancel
              </button>
              <button 
                className="transfer-confirm-submit-btn" 
                onClick={handleConfirmRemoveException}
                style={{ background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)' }}
              >
                Remove Exception
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exception Error Dialog */}
      {showExceptionErrorDialog && (
        <div className="transfer-confirm-modal-overlay" onClick={() => setShowExceptionErrorDialog(false)}>
          <div className="transfer-confirm-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="transfer-confirm-modal-header">
              <div className="transfer-confirm-modal-icon" style={{ background: '#fee2e2', color: '#dc2626' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              </div>
              <h3>Cannot Update Exception</h3>
            </div>
            <div className="transfer-confirm-modal-body">
              <p style={{ fontSize: '15px', lineHeight: '1.6', color: '#374151' }}>
                {exceptionErrorDialogMessage}
              </p>
            </div>
            <div className="transfer-confirm-modal-footer">
              <button 
                className="transfer-confirm-submit-btn" 
                onClick={() => setShowExceptionErrorDialog(false)}
                style={{ width: '100%', background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exception Error Dialog */}
      {showExceptionErrorDialog && (
        <div className="transfer-confirm-modal-overlay" onClick={() => setShowExceptionErrorDialog(false)}>
          <div className="transfer-confirm-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="transfer-confirm-modal-header">
              <div className="transfer-confirm-modal-icon" style={{ background: '#fee2e2', color: '#dc2626' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              </div>
              <h3>Cannot Update Exception</h3>
            </div>
            <div className="transfer-confirm-modal-body">
              <p style={{ fontSize: '15px', lineHeight: '1.6', color: '#374151' }}>
                {exceptionErrorDialogMessage}
              </p>
            </div>
            <div className="transfer-confirm-modal-footer">
              <button 
                className="transfer-confirm-submit-btn" 
                onClick={() => setShowExceptionErrorDialog(false)}
                style={{ width: '100%', background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </DashboardLayout>
  )
}
