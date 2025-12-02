import { useState, useEffect, useCallback, useMemo } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { Avatar } from '../../../components/Avatar'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { calculateAge } from '../../../shared/date'
import { validateBirthday } from '../../../utils/validationUtils'
import { getTodayDateString } from '../../../shared/date'
import './TeamMembers.css'

interface TeamMember {
  id: string
  user_id: string
  team_id: string
  phone: string | null
  created_at: string
  updated_at: string
  users: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    full_name: string | null
    role: string
    profile_image_url?: string | null
  } | null
}

interface TeamData {
  id: string
  name: string
  site_location: string | null
  team_leader_id: string
  supervisor_id: string | null
}

export function TeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [team, setTeam] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [itemsPerPage, setItemsPerPage] = useState(20)
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null)
  const [showViewModal, setShowViewModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [showSuccessToast, setShowSuccessToast] = useState(false)
  const [successToastMessage, setSuccessToastMessage] = useState('')
  const [updating, setUpdating] = useState(false)
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [showExceptionModal, setShowExceptionModal] = useState(false)
  const [showTransferConfirm, setShowTransferConfirm] = useState(false)
  const [transferConfirmData, setTransferConfirmData] = useState<{
    workerName: string
    targetTeamName: string
  } | null>(null)
  const [showRemoveExceptionConfirm, setShowRemoveExceptionConfirm] = useState(false)
  const [showExceptionErrorDialog, setShowExceptionErrorDialog] = useState(false)
  const [exceptionErrorDialogMessage, setExceptionErrorDialogMessage] = useState('')
  const [exceptions, setExceptions] = useState<Record<string, any>>({})
  const [currentException, setCurrentException] = useState<any>(null)
  const [availableTeams, setAvailableTeams] = useState<Array<{ id: string; name: string; site_location?: string; display_name: string; team_leader?: { name: string } }>>([])
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [exceptionError, setExceptionError] = useState('')
  const [editForm, setEditForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
  })
  const [addForm, setAddForm] = useState({
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
  const [exceptionForm, setExceptionForm] = useState({
    exception_type: 'transfer',
    reason: '',
    start_date: getTodayDateString(),
    end_date: '',
    transfer_to_team_id: '',
  })

  // Debounce search query
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery)
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fetch team members
  useEffect(() => {
    let isMounted = true

    const fetchTeamMembers = async () => {
      try {
        setLoading(true)
        setError('')

        // Build query parameters for backend filtering
        const params = new URLSearchParams()
        if (roleFilter !== 'all') {
          params.append('role', roleFilter)
        }
        if (debouncedSearchQuery.trim()) {
          params.append('search', debouncedSearchQuery.trim())
        }
        params.append('page', currentPage.toString())
        params.append('limit', itemsPerPage.toString())

        const queryString = params.toString()
        const result = await apiClient.get<{
          team: TeamData | null
          members: TeamMember[]
          totalRecords: number
        }>(queryString ? `${API_ROUTES.TEAMS.BASE}?${queryString}` : API_ROUTES.TEAMS.BASE)

        if (isApiError(result)) {
          throw new Error(getApiErrorMessage(result) || 'Failed to fetch team members')
        }

        const data = result.data
        
        if (isMounted) {
          setTeam(data.team || null)
          
          // Backend already handles filtering, pagination, and deduplication
          const members = data.members || []
          setMembers(members)
          setTotalRecords(data.totalRecords || members.length)
        }
      } catch (err: any) {
        console.error('Error fetching team members:', err)
        if (isMounted) {
          setError(err.message || 'Failed to load team members')
          setMembers([])
          setTotalRecords(0)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchTeamMembers()

    return () => {
      isMounted = false
    }
  }, [currentPage, roleFilter, debouncedSearchQuery, refreshKey, itemsPerPage])
  
  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [roleFilter, debouncedSearchQuery])

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.team-members-actions-dropdown')) {
        setOpenDropdownId(null)
      }
    }

    if (openDropdownId) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openDropdownId])

  const handleRefresh = useCallback(() => {
    setCurrentPage(1)
    setRefreshKey(prev => prev + 1)
  }, [])

  const fetchExceptions = useCallback(async () => {
    try {
      const result = await apiClient.get<{ exceptions: any[] }>(API_ROUTES.TEAMS.EXCEPTIONS)
      if (!isApiError(result)) {
        const data = result.data
        const exceptionsMap: Record<string, any> = {}
        data.exceptions?.forEach((ex: any) => {
          exceptionsMap[ex.user_id] = ex
        })
        setExceptions(exceptionsMap)
      }
    } catch (error) {
      console.error('Error fetching exceptions:', error)
    }
  }, [])

  // OPTIMIZATION: Fetch exceptions when members are loaded or when refresh is triggered
  useEffect(() => {
    if (members.length > 0) {
      fetchExceptions()
    }
  }, [refreshKey, fetchExceptions]) // Refetch when refreshKey changes (triggers on refresh)

  // Helper function to initialize exception form (extracted to avoid duplication)
  const initializeExceptionForm = useCallback((exception: any | null) => {
    if (exception) {
      setExceptionForm({
        exception_type: exception.exception_type,
        reason: exception.reason || '',
        start_date: exception.start_date,
        end_date: exception.end_date || '',
        transfer_to_team_id: '',
      })
    } else {
      setExceptionForm({
        exception_type: 'transfer',
        reason: '',
        start_date: getTodayDateString(),
        end_date: '',
        transfer_to_team_id: '',
      })
    }
  }, [])

  const handleManageException = useCallback(async (member: TeamMember) => {
    setSelectedMember(member)
    setExceptionError('')
    setLoadingTeams(true)

    // Load available teams for transfer
    try {
      const teamsResult = await apiClient.get<{ teams: any[] }>(API_ROUTES.TEAMS.ALL)
      if (!isApiError(teamsResult)) {
        const teamsData = teamsResult.data
        // Filter out current team
        const filteredTeams = (teamsData.teams || []).filter((t: any) => t.id !== team?.id)
        setAvailableTeams(filteredTeams)
      }
    } catch (error) {
      console.error('Error loading teams:', error)
    } finally {
      setLoadingTeams(false)
    }

    // Check if worker has existing exception
    try {
      const result = await apiClient.get<{ exception: any }>(
        API_ROUTES.TEAMS.MEMBER_EXCEPTION(member.id)
      )

      if (!isApiError(result)) {
        const data = result.data
        if (data.exception) {
          setCurrentException(data.exception)
          // SECURITY: If assigned to WHS, show error and don't allow modification
          if (data.exception.assigned_to_whs) {
            setExceptionError('Cannot modify exception: This exception has been assigned to WHS and must be closed by WHS first before it can be modified.')
          }
          initializeExceptionForm(data.exception)
        } else {
          setCurrentException(null)
          initializeExceptionForm(null)
        }
      } else {
        setCurrentException(null)
        initializeExceptionForm(null)
      }
    } catch (error) {
      console.error('Error loading exception:', error)
      setCurrentException(null)
      initializeExceptionForm(null)
    }

    setShowExceptionModal(true)
  }, [team, initializeExceptionForm])

  const handleSaveException = useCallback(async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault()
    if (!selectedMember) return

    setExceptionError('')

    // SECURITY: Prevent saving if exception is assigned to WHS (already checked when opening modal, but double-check for security)
    if (currentException?.assigned_to_whs) {
      setExceptionError('Cannot modify exception: This exception has been assigned to WHS and must be closed by WHS first before it can be modified.')
      return
    }

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
  }, [selectedMember, exceptionForm, currentException, availableTeams, handleRefresh, fetchExceptions])

  const proceedWithSaveException = useCallback(async () => {
    if (!selectedMember) return

    setExceptionError('')

    // SECURITY: Prevent saving if exception is assigned to WHS (already checked when opening modal, but double-check for security)
    if (currentException?.assigned_to_whs) {
      setExceptionError('Cannot modify exception: This exception has been assigned to WHS and must be closed by WHS first before it can be modified.')
      return
    }

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
      const result = await apiClient.post<{ transferred?: boolean }>(
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
          setExceptionError('An active exception with this type already exists. Please remove the existing exception first or choose a different exception type.')
        } else {
          setExceptionError(errorMessage)
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
      
      // Refresh members list
      handleRefresh()
      
      // Reload exceptions
      await fetchExceptions()
      
      // Trigger dashboard refresh by dispatching custom event
      window.dispatchEvent(new CustomEvent('exceptionUpdated'))
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to save exception'
      // Check if error is about duplicate exception
      if (errorMessage.toLowerCase().includes('already') || errorMessage.toLowerCase().includes('duplicate')) {
        setExceptionError('An active exception with this type already exists. Please remove the existing exception first or choose a different exception type.')
      } else {
        setExceptionError(errorMessage)
      }
    }
  }, [selectedMember, exceptionForm, currentException, handleRefresh, fetchExceptions])

  const handleConfirmTransfer = useCallback(async () => {
    setShowTransferConfirm(false)
    await proceedWithSaveException()
  }, [proceedWithSaveException])

  const handleCancelTransfer = useCallback(() => {
    setShowTransferConfirm(false)
    setTransferConfirmData(null)
  }, [])

  const handleRemoveException = useCallback(() => {
    if (!currentException || !selectedMember) return
    setShowRemoveExceptionConfirm(true)
  }, [currentException, selectedMember])

  const handleConfirmRemoveException = useCallback(async () => {
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
      handleRefresh()
      
      // Reload exceptions
      await fetchExceptions()
      
      // Trigger dashboard refresh by dispatching custom event
      window.dispatchEvent(new CustomEvent('exceptionUpdated'))
    } catch (err: any) {
      setExceptionError(err.message || 'Failed to remove exception')
    }
  }, [currentException, selectedMember, handleRefresh, fetchExceptions])

  const handleCancelRemoveException = useCallback(() => {
    setShowRemoveExceptionConfirm(false)
  }, [])

  const handleEdit = useCallback(() => {
    if (!selectedMember) return
    
    setEditForm({
      first_name: selectedMember.users?.first_name || '',
      last_name: selectedMember.users?.last_name || '',
      phone: selectedMember.phone || '',
    })
    setShowEditModal(true)
  }, [selectedMember])

  // Use centralized validation utility
  // Note: validateBirthday is imported from utils/validationUtils

  const handleAddMember = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError('')

    // Validate inputs
    if (!addForm.email || !addForm.password || !addForm.first_name || !addForm.last_name) {
      setAddError('All required fields must be filled')
      return
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(addForm.email)) {
      setAddError('Invalid email format')
      return
    }

    // Validate password length
    if (addForm.password.length < 6) {
      setAddError('Password must be at least 6 characters')
      return
    }

    // Validate name length
    if (addForm.first_name.length > 100 || addForm.last_name.length > 100) {
      setAddError('Name fields must be less than 100 characters')
      return
    }

    // Validate phone format (optional but if provided, should be reasonable)
    if (addForm.phone && addForm.phone.length > 20) {
      setAddError('Phone number is too long')
      return
    }

    // Validate birthday from dropdowns
    if (!birthMonth || !birthDay || !birthYear) {
      setBirthdayError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      setAddError('Date of Birth is required')
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
      setAddError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      return
    }
    
    if (birthDate >= today) {
      setBirthdayError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      setAddError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      return
    }
    
    // Check minimum age (18 years old)
    const age = calculateAge(dateStr)
    if (age === null) {
      setBirthdayError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      setAddError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      return
    }
    if (age < 18) {
      setBirthdayError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      setAddError('It looks like you entered the wrong info. Please be sure to use your real birthday.')
      return
    }

    try {
      setAdding(true)
      const result = await apiClient.post<{ message: string }>(
        API_ROUTES.TEAMS.MEMBERS,
        {
          email: addForm.email.trim(),
          password: addForm.password,
          first_name: addForm.first_name.trim(),
          last_name: addForm.last_name.trim(),
          phone: addForm.phone.trim() || null,
          role: addForm.role,
          gender: addForm.gender || undefined,
          date_of_birth: dateStr,
        }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to add team member')
      }

      // Reset form and close modal
      setAddForm({
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
      setAddError('')
      handleRefresh()
      setSuccessToastMessage('Team member successfully added')
      setShowSuccessToast(true)
      setTimeout(() => setShowSuccessToast(false), 3000)
    } catch (err: any) {
      console.error('Error adding team member:', err)
      setAddError(err.message || 'Failed to add team member')
    } finally {
      setAdding(false)
    }
  }, [addForm, handleRefresh])

  const handleUpdate = useCallback(async () => {
    if (!selectedMember) return

    // Validate inputs
    const trimmedFirstName = editForm.first_name.trim()
    const trimmedLastName = editForm.last_name.trim()
    const trimmedPhone = editForm.phone.trim()

    if (!trimmedFirstName || !trimmedLastName) {
      alert('First name and last name are required')
      return
    }

    // Validate name length (security: prevent extremely long strings)
    if (trimmedFirstName.length > 100 || trimmedLastName.length > 100) {
      alert('Name fields must be less than 100 characters')
      return
    }

    // Validate phone format (optional but if provided, should be reasonable)
    if (trimmedPhone && trimmedPhone.length > 20) {
      alert('Phone number is too long')
      return
    }

    try {
      setUpdating(true)
      const result = await apiClient.patch<{ message: string }>(
        API_ROUTES.TEAMS.MEMBER(selectedMember.id),
        {
          first_name: trimmedFirstName,
          last_name: trimmedLastName,
          phone: trimmedPhone || null,
          // Role is NOT sent - backend will not update it
        }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to update team member')
      }

      setShowEditModal(false)
      setSelectedMember(null)
      handleRefresh()
    } catch (err: any) {
      console.error('Error updating team member:', err)
      alert(err.message || 'Failed to update team member')
    } finally {
      setUpdating(false)
    }
  }, [selectedMember, editForm, handleRefresh])

  const handleDelete = useCallback(async () => {
    if (!selectedMember) return

    if (!deletePassword.trim()) {
      setDeleteError('Password is required to delete team member')
      return
    }

    try {
      setDeleting(true)
      setDeleteError('')
      // Use centralized apiClient for consistent error handling
      // Note: DELETE with body is supported by apiClient
      const result = await apiClient.delete<{ message?: string }>(
        API_ROUTES.TEAMS.MEMBER(selectedMember.id),
        {
          body: JSON.stringify({ password: deletePassword }),
        }
      )
      
      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to delete team member')
      }

      setShowDeleteModal(false)
      setSelectedMember(null)
      setDeletePassword('')
      setDeleteError('')
      
      // Show success toast
      setShowSuccessToast(true)
      setTimeout(() => {
        setShowSuccessToast(false)
      }, 3000)
      
      handleRefresh()
    } catch (err: any) {
      console.error('Error deleting team member:', err)
      setDeleteError(err.message || 'Failed to delete team member')
    } finally {
      setDeleting(false)
    }
  }, [selectedMember, deletePassword, handleRefresh])


  const getAvatarColor = useCallback((name: string) => {
    const colors = [
      '#EF4444', '#F59E0B', '#10B981', '#3B82F6', 
      '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
    ]
    const index = name.charCodeAt(0) % colors.length
    return colors[index]
  }, [])

  const getInitials = useCallback((member: TeamMember) => {
    if (member.users?.first_name && member.users?.last_name) {
      return `${member.users.first_name[0]}${member.users.last_name[0]}`.toUpperCase()
    }
    if (member.users?.full_name) {
      const parts = member.users.full_name.trim().split(' ')
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      }
      return member.users.full_name.substring(0, 2).toUpperCase()
    }
    if (member.users?.email) {
      return member.users.email.substring(0, 2).toUpperCase()
    }
    return 'U'
  }, [])

  const getMemberName = useCallback((member: TeamMember) => {
    if (member.users?.full_name) return member.users.full_name
    if (member.users?.first_name && member.users?.last_name) {
      return `${member.users.first_name} ${member.users.last_name}`
    }
    return member.users?.email || 'Unknown'
  }, [])

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }, [])

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

  return (
    <DashboardLayout>
      <div className="team-members">
        {/* Header */}
        <div className="team-members-header">
          <div>
            <h1 className="team-members-title">Team Members</h1>
            <p className="team-members-subtitle">
              {team ? `Manage members of ${team.name}` : 'View and manage your team members'}
            </p>
          </div>
          <button className="team-members-add-btn" onClick={() => setShowAddModal(true)}>
            + Add Team Member
          </button>
        </div>

        {/* Toolbar */}
        <div className="team-members-toolbar">
          <div className="team-members-toolbar-left">
            <div className="team-members-search">
              <svg className="team-members-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              <input
                type="text"
                className="team-members-search-input"
                placeholder="Search members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button className="team-members-refresh-btn" title="Refresh" onClick={handleRefresh}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
          </div>
          <div className="team-members-toolbar-right">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="team-members-pagination-info">
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
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button 
                className="team-members-pagination-btn"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                title="Previous page"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
              <span className="team-members-page-number">
                Page {currentPage} of {totalPages || 1}
              </span>
              <button 
                className="team-members-pagination-btn"
                disabled={currentPage >= totalPages || totalPages === 0}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                title="Next page"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="team-members-filters">
          <select
            className="team-members-filter-select"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value)
              setCurrentPage(1)
            }}
          >
            <option value="all">All Members</option>
            <option value="worker">Workers</option>
          </select>
        </div>

        {/* Table */}
        <div className="team-members-table-container">
          {loading ? (
            <Loading message="Loading team members..." size="medium" />
          ) : error ? (
            <div className="team-members-error">
              <p>{error}</p>
            </div>
          ) : members.length === 0 ? (
            <div className="team-members-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ margin: '0 auto 16px', color: '#94A3B8' }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <p style={{ fontWeight: 500, color: '#0F172A', marginBottom: '4px' }}>No team members found</p>
              <p style={{ fontSize: '13px', color: '#64748B' }}>
                {searchQuery || roleFilter !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Team members will appear here once they are added to your team'}
              </p>
            </div>
          ) : (
            <table className="team-members-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" />
                  </th>
                  <th>Member Name</th>
                  <th>Member ID</th>
                  <th>Email Address</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const memberName = getMemberName(member)
                  
                  return (
                    <tr key={member.id} className="team-members-table-row">
                      <td>
                        <input type="checkbox" />
                      </td>
                      <td>
                        <div className="team-members-member-info">
                          <Avatar
                            userId={member.user_id}
                            profileImageUrl={member.users?.profile_image_url}
                            firstName={member.users?.first_name}
                            lastName={member.users?.last_name}
                            email={member.users?.email}
                            size="sm"
                            showTooltip
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span className="team-members-member-name">{memberName}</span>
                            {exceptions[member.user_id] && (
                              <span 
                                className="team-members-exception-badge"
                                title={`Exception: ${exceptions[member.user_id].exception_type?.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Exception'}${exceptions[member.user_id].reason ? ` - ${exceptions[member.user_id].reason}` : ''}`}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                  <line x1="12" y1="9" x2="12" y2="13"></line>
                                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                </svg>
                                Exception
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="team-members-member-id">{member.user_id.substring(0, 8).toUpperCase()}</td>
                      <td className="team-members-email">{member.users?.email || 'N/A'}</td>
                      <td className="team-members-phone">{member.phone || 'N/A'}</td>
                      <td>
                        <span className="team-members-role-badge">
                          {member.users?.role?.toUpperCase() || 'N/A'}
                        </span>
                      </td>
                      <td>
                        <div className="team-members-actions">
                          <div className="team-members-actions-dropdown">
                            <div className="team-members-actions-header">
                              <span className="team-members-actions-label">Actions</span>
                              <button
                                className="team-members-actions-trigger"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setOpenDropdownId(openDropdownId === member.id ? null : member.id)
                                }}
                                title="Actions"
                              >
                                <span className="team-members-actions-dots">⋮</span>
                              </button>
                            </div>
                            {openDropdownId === member.id && (
                              <div className="team-members-actions-menu">
                                <button
                                  className="team-members-action-item"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedMember(member)
                                    handleEdit()
                                    setOpenDropdownId(null)
                                  }}
                                >
                                  <span className="team-members-action-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                    </svg>
                                  </span>
                                  <span className="team-members-action-text">Edit</span>
                                </button>
                                <button
                                  className="team-members-action-item"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedMember(member)
                                    setShowViewModal(true)
                                    setOpenDropdownId(null)
                                  }}
                                >
                                  <span className="team-members-action-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                      <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                  </span>
                                  <span className="team-members-action-text">View Details</span>
                                </button>
                                <button
                                  className={`team-members-action-item ${exceptions[member.user_id] ? 'has-exception' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleManageException(member)
                                    setOpenDropdownId(null)
                                  }}
                                >
                                  <span className="team-members-action-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                      <line x1="12" y1="9" x2="12" y2="13"></line>
                                      <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                    </svg>
                                  </span>
                                  <span className="team-members-action-text">Exception</span>
                                </button>
                                <button
                                  className="team-members-action-item team-members-action-item-danger"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedMember(member)
                                    setShowDeleteModal(true)
                                    setOpenDropdownId(null)
                                  }}
                                >
                                  <span className="team-members-action-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <polyline points="3 6 5 6 21 6"></polyline>
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                      <line x1="10" y1="11" x2="10" y2="17"></line>
                                      <line x1="14" y1="11" x2="14" y2="17"></line>
                                    </svg>
                                  </span>
                                  <span className="team-members-action-text">Delete</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* View Member Details Modal */}
        {showViewModal && selectedMember && (
          <div className="team-members-modal-overlay" onClick={() => setShowViewModal(false)}>
            <div className="team-members-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="team-members-modal-header">
                <div>
                  <h2 className="team-members-modal-title">Member Details</h2>
                  <p className="team-members-modal-subtitle">{getMemberName(selectedMember)}</p>
                </div>
                <button 
                  className="team-members-modal-close"
                  onClick={() => setShowViewModal(false)}
                  aria-label="Close modal"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              <div className="team-members-modal-body">
                <div className="team-members-details-grid">
                  <div className="team-members-detail-section">
                    <h3 className="team-members-detail-section-title">Personal Information</h3>
                    <div className="team-members-detail-item">
                      <span className="team-members-detail-label">Name:</span>
                      <span className="team-members-detail-value">{getMemberName(selectedMember)}</span>
                    </div>
                    <div className="team-members-detail-item">
                      <span className="team-members-detail-label">Email:</span>
                      <span className="team-members-detail-value">{selectedMember.users?.email || 'N/A'}</span>
                    </div>
                    <div className="team-members-detail-item">
                      <span className="team-members-detail-label">Phone:</span>
                      <span className="team-members-detail-value">{selectedMember.phone || 'N/A'}</span>
                    </div>
                    <div className="team-members-detail-item">
                      <span className="team-members-detail-label">Role:</span>
                      <span className="team-members-detail-value">{selectedMember.users?.role?.toUpperCase() || 'N/A'}</span>
                    </div>
                  </div>

                  <div className="team-members-detail-section">
                    <h3 className="team-members-detail-section-title">Team Information</h3>
                    <div className="team-members-detail-item">
                      <span className="team-members-detail-label">Team:</span>
                      <span className="team-members-detail-value">{team?.name || 'N/A'}</span>
                    </div>
                    <div className="team-members-detail-item">
                      <span className="team-members-detail-label">Site Location:</span>
                      <span className="team-members-detail-value">{team?.site_location || 'N/A'}</span>
                    </div>
                    <div className="team-members-detail-item">
                      <span className="team-members-detail-label">Member ID:</span>
                      <span className="team-members-detail-value">{selectedMember.user_id}</span>
                    </div>
                  </div>

                  <div className="team-members-detail-section">
                    <h3 className="team-members-detail-section-title">Timeline</h3>
                    <div className="team-members-detail-item">
                      <span className="team-members-detail-label">Added:</span>
                      <span className="team-members-detail-value">{formatDate(selectedMember.created_at)}</span>
                    </div>
                    <div className="team-members-detail-item">
                      <span className="team-members-detail-label">Last Updated:</span>
                      <span className="team-members-detail-value">{formatDate(selectedMember.updated_at)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="team-members-modal-footer">
                <button 
                  className="team-members-modal-close-btn"
                  onClick={() => setShowViewModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteModal && selectedMember && (
          <div className="team-members-modal-overlay" onClick={() => !deleting && setShowDeleteModal(false)}>
            <div className="team-members-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="team-members-modal-header">
                <div>
                  <h2 className="team-members-modal-title">Delete Team Member</h2>
                  <p className="team-members-modal-subtitle">This action cannot be undone</p>
                </div>
                <button 
                  className="team-members-modal-close"
                  onClick={() => !deleting && setShowDeleteModal(false)}
                  aria-label="Close modal"
                  disabled={deleting}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              <div className="team-members-modal-body">
                <div style={{ padding: '20px 0' }}>
                  <p style={{ marginBottom: '16px', color: '#0F172A' }}>
                    Are you sure you want to delete <strong>{getMemberName(selectedMember)}</strong> from your team?
                  </p>
                  <div style={{ 
                    backgroundColor: '#FEF2F2', 
                    border: '1px solid #FEE2E2', 
                    borderRadius: '8px', 
                    padding: '12px',
                    marginTop: '16px',
                    marginBottom: '20px'
                  }}>
                    <p style={{ fontSize: '13px', color: '#991B1B', margin: 0, fontWeight: '500' }}>
                      ⚠️ Warning: This will permanently delete:
                    </p>
                    <ul style={{ fontSize: '13px', color: '#991B1B', margin: '8px 0 0 20px', padding: 0 }}>
                      <li>The team member record</li>
                      <li>All worker schedules associated with this member</li>
                    </ul>
                  </div>
                  
                  <div className="team-members-form-group">
                    <label className="team-members-form-label">
                      Enter your password to confirm deletion *
                    </label>
                    <input
                      type="password"
                      className="team-members-form-input"
                      value={deletePassword}
                      onChange={(e) => {
                        setDeletePassword(e.target.value)
                        setDeleteError('')
                      }}
                      placeholder="Enter your password"
                      disabled={deleting}
                      autoFocus
                    />
                    {deleteError && (
                      <p style={{ fontSize: '12px', color: '#EF4444', margin: '4px 0 0 0' }}>
                        {deleteError}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="team-members-modal-footer">
                <button 
                  className="team-members-modal-close-btn"
                  onClick={() => {
                    if (!deleting) {
                      setShowDeleteModal(false)
                      setDeletePassword('')
                      setDeleteError('')
                    }
                  }}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button 
                  className="team-members-modal-delete-btn"
                  onClick={handleDelete}
                  disabled={deleting || !deletePassword.trim()}
                  style={{
                    backgroundColor: '#EF4444',
                    color: 'white',
                    border: 'none',
                  }}
                >
                  {deleting ? 'Deleting...' : 'Delete Member'}
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
                {addError && (
                  <div style={{ 
                    backgroundColor: '#FEF2F2', 
                    border: '1px solid #FEE2E2', 
                    borderRadius: '8px', 
                    padding: '12px',
                    marginBottom: '20px'
                  }}>
                    <p style={{ fontSize: '13px', color: '#991B1B', margin: 0 }}>
                      {addError}
                    </p>
                  </div>
                )}

                <form onSubmit={handleAddMember}>
                  <div className="team-members-form-group">
                    <label className="team-members-form-label">Email *</label>
                    <input
                      type="email"
                      className="team-members-form-input"
                      value={addForm.email}
                      onChange={(e) => {
                        setAddForm({ ...addForm, email: e.target.value })
                        setAddError('')
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
                      value={addForm.password}
                      onChange={(e) => {
                        setAddForm({ ...addForm, password: e.target.value })
                        setAddError('')
                      }}
                      placeholder="Enter password (min. 6 characters)"
                      disabled={adding}
                      minLength={6}
                      required
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="team-members-form-group" style={{ flex: 1 }}>
                      <label className="team-members-form-label">First Name *</label>
                      <input
                        type="text"
                        className="team-members-form-input"
                        value={addForm.first_name}
                        onChange={(e) => {
                          setAddForm({ ...addForm, first_name: e.target.value })
                          setAddError('')
                        }}
                        placeholder="Enter first name"
                        disabled={adding}
                        maxLength={100}
                        required
                      />
                    </div>

                    <div className="team-members-form-group" style={{ flex: 1 }}>
                      <label className="team-members-form-label">Last Name *</label>
                      <input
                        type="text"
                        className="team-members-form-input"
                        value={addForm.last_name}
                        onChange={(e) => {
                          setAddForm({ ...addForm, last_name: e.target.value })
                          setAddError('')
                        }}
                        placeholder="Enter last name"
                        disabled={adding}
                        maxLength={100}
                        required
                      />
                    </div>
                  </div>

                  <div className="team-members-form-group">
                    <label className="team-members-form-label">Phone Number (Optional)</label>
                    <input
                      type="tel"
                      className="team-members-form-input"
                      value={addForm.phone}
                      onChange={(e) => {
                        setAddForm({ ...addForm, phone: e.target.value })
                        setAddError('')
                      }}
                      placeholder="e.g., +1 (555) 123-4567"
                      disabled={adding}
                      maxLength={20}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="team-members-form-group" style={{ flex: 1 }}>
                      <label className="team-members-form-label">Gender <span className="required">*</span></label>
                      <select
                        className="team-members-form-input"
                        value={addForm.gender}
                        onChange={(e) => {
                          setAddForm({ ...addForm, gender: e.target.value as 'male' | 'female' | '' })
                          setAddError('')
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
                      setAddError('')
                      setAddForm({
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
                  disabled={adding || !addForm.email || !addForm.password || !addForm.first_name || !addForm.last_name}
                >
                  {adding ? 'Adding...' : 'Add Team Member'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Exception Modal */}
        {showExceptionModal && selectedMember && (
          <>
            <div className="sidebar-overlay" onClick={() => setShowExceptionModal(false)}></div>
            <div className="sidebar-panel">
              <div className="sidebar-header">
                <div>
                  <h3>Manage Exception</h3>
                  <p style={{ fontSize: '13px', color: '#64748B', margin: '4px 0 0 0' }}>{getMemberName(selectedMember)}</p>
                </div>
                <button 
                  className="sidebar-close"
                  onClick={() => setShowExceptionModal(false)}
                  aria-label="Close sidebar"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <div className="sidebar-body">
                {exceptionError && (
                  <div className="error-message" style={{ margin: '0 0 16px 0' }}>
                    {exceptionError}
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
                          {availableTeams.map((teamOption) => (
                            <option key={teamOption.id} value={teamOption.id}>
                              {teamOption.display_name} {teamOption.team_leader && `(Leader: ${teamOption.team_leader.name})`}
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
                <button 
                  type="button" 
                  onClick={() => setShowExceptionModal(false)} 
                  className="cancel-btn"
                >
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

        {/* Edit Member Modal */}
        {showEditModal && selectedMember && (
          <>
            <div className="sidebar-overlay" onClick={() => setShowEditModal(false)}></div>
            <div className="sidebar-panel">
              <div className="sidebar-header">
                <div>
                  <h3>Edit Team Member</h3>
                  <p style={{ fontSize: '13px', color: '#64748B', margin: '4px 0 0 0' }}>{getMemberName(selectedMember)}</p>
                </div>
                <button 
                  className="sidebar-close"
                  onClick={() => setShowEditModal(false)}
                  aria-label="Close sidebar"
                  disabled={updating}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              <div className="sidebar-body">
                <div className="team-members-edit-form">
                  <div className="team-members-form-group">
                    <label className="team-members-form-label">First Name *</label>
                    <input
                      type="text"
                      className="team-members-form-input"
                      value={editForm.first_name}
                      onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                      placeholder="Enter first name"
                      disabled={updating}
                      maxLength={100}
                      required
                    />
                  </div>

                  <div className="team-members-form-group">
                    <label className="team-members-form-label">Last Name *</label>
                    <input
                      type="text"
                      className="team-members-form-input"
                      value={editForm.last_name}
                      onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                      placeholder="Enter last name"
                      disabled={updating}
                      maxLength={100}
                      required
                    />
                  </div>

                  <div className="team-members-form-group">
                    <label className="team-members-form-label">Phone</label>
                    <input
                      type="text"
                      className="team-members-form-input"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                      placeholder="Enter phone number"
                      disabled={updating}
                      maxLength={20}
                    />
                  </div>

                  <div className="team-members-form-group">
                    <label className="team-members-form-label">Role</label>
                    <input
                      type="text"
                      className="team-members-form-input"
                      value={selectedMember.users?.role?.toUpperCase() || 'N/A'}
                      disabled
                      style={{ background: '#F8FAFC', color: '#64748B', cursor: 'not-allowed' }}
                    />
                    <p style={{ fontSize: '11px', color: '#94A3B8', margin: '4px 0 0 0' }}>
                      Role cannot be changed
                    </p>
                  </div>

                  <div className="team-members-form-note">
                    <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>
                      Email: {selectedMember.users?.email || 'N/A'} (cannot be changed)
                    </p>
                  </div>
                </div>
              </div>

              <div className="sidebar-footer">
                <button 
                  className="team-members-modal-close-btn"
                  onClick={() => setShowEditModal(false)}
                  disabled={updating}
                >
                  Cancel
                </button>
                <button 
                  className="team-members-modal-save-btn"
                  onClick={handleUpdate}
                  disabled={updating || !editForm.first_name.trim() || !editForm.last_name.trim()}
                >
                  {updating ? 'Updating...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </>
        )}

      </div>

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
    </DashboardLayout>
  )
}

