import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { parseNotes } from '../../../utils/notesParser'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { buildUrl } from '../../../utils/queryBuilder'
import './ClinicalNotes.css'

interface Transcription {
  id: string
  transcription_text: string
  analysis: any
  recording_duration_seconds: number | null
  estimated_cost: number | null
  audio_file_size_bytes: number | null
  created_at: string
  updated_at: string
}

interface Appointment {
  id: string
  appointmentDate: string
  appointmentTime: string
  workerName: string
  workerEmail: string
  siteLocation: string
  status: string
  caseId?: string
  caseNumber?: string
}

interface ClinicalNote {
  id: string
  date: string
  location: string
  client: string
  provider: string
  type: string
  status: string
  caseNumber?: string
  injuryType?: string
  transcription?: Transcription
  notes?: string
  appointment?: Appointment
}

// OPTIMIZATION: Memoized folder component to prevent unnecessary re-renders
interface FolderProps {
  caseNumber: string
  notes: ClinicalNote[]
  isExpanded: boolean
  onToggle: (caseNumber: string) => void
  onViewDetails: (note: ClinicalNote) => void
  onEdit: (note: ClinicalNote, e: React.MouseEvent) => void
  onDelete: (note: ClinicalNote, e: React.MouseEvent) => void
  formatDateTime: (date: Date) => string
}

const ClinicalNotesFolder = memo(({ 
  caseNumber, 
  notes, 
  isExpanded, 
  onToggle, 
  onViewDetails, 
  onEdit, 
  onDelete,
  formatDateTime 
}: FolderProps) => {
  const isUnassigned = caseNumber === 'Unassigned'
  
  // Get client name and injury type from first note (all notes in folder share same case)
  const firstNote = notes[0]
  const clientName = firstNote?.client || 'N/A'
  const injuryType = firstNote?.injuryType || null
  
  return (
    <div className="clinical-notes-folder">
      <div 
        className="clinical-notes-folder-header"
        onClick={() => onToggle(caseNumber)}
      >
        <div className="clinical-notes-folder-header-content">
          <svg 
            className={`clinical-notes-folder-icon ${isExpanded ? 'expanded' : ''}`}
            width="20" 
            height="20" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <div className="clinical-notes-folder-info">
            <div className="clinical-notes-folder-name">
              {isUnassigned ? 'Unassigned Notes' : caseNumber}
            </div>
            <div className="clinical-notes-folder-meta">
              {!isUnassigned && (
                <>
                  {clientName !== 'N/A' && (
                    <span className="clinical-notes-folder-client">{clientName}</span>
                  )}
                  {injuryType && (
                    <span className="clinical-notes-folder-injury">{injuryType}</span>
                  )}
                </>
              )}
              <span className="clinical-notes-folder-count">
              {notes.length} {notes.length === 1 ? 'note' : 'notes'}
              </span>
            </div>
          </div>
        </div>
        <svg 
          className={`clinical-notes-folder-chevron ${isExpanded ? 'expanded' : ''}`}
          width="20" 
          height="20" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      
      {isExpanded && (
        <div className="clinical-notes-folder-content">
          <div className="clinical-notes-table-container">
            <table className="clinical-notes-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Location</th>
                  <th>Client</th>
                  <th>Provider</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th style={{ width: '120px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <tr
                    key={note.id}
                    className={note.status === 'Draft' ? 'clinical-notes-row-draft' : ''}
                    onClick={() => onViewDetails(note)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{note.date}</td>
                    <td>{note.location}</td>
                    <td>{note.client}</td>
                    <td>
                      {note.provider}
                      {note.status === 'Draft' && (
                        <div className="clinical-notes-draft-info">
                          Draft started by: {note.provider}
                        </div>
                      )}
                    </td>
                    <td>{note.type}</td>
                    <td>
                      <span className={`clinical-notes-status ${note.status.toLowerCase()}`}>
                        {note.status}
                      </span>
                      {note.status === 'Draft' && note.transcription && (
                        <div className="clinical-notes-draft-date">
                          {formatDateTime(new Date(note.transcription.created_at))}
                        </div>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="clinical-notes-actions">
                        <button
                          className="clinical-notes-action-btn edit-btn"
                          onClick={(e) => onEdit(note, e)}
                          title="Edit clinical note"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                        </button>
                        <button
                          className="clinical-notes-action-btn delete-btn"
                          onClick={(e) => onDelete(note, e)}
                          title="Delete clinical note"
                          disabled={note.id.startsWith('case-')}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
})

ClinicalNotesFolder.displayName = 'ClinicalNotesFolder'

export function ClinicalNotes() {
  const navigate = useNavigate()
  const [clinicalNotes, setClinicalNotes] = useState<ClinicalNote[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [deleteConfirmNote, setDeleteConfirmNote] = useState<ClinicalNote | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteSuccess, setDeleteSuccess] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  
  // OPTIMIZATION: Prevent duplicate API calls
  const isFetchingRef = useRef(false)
  const pendingFetchRef = useRef<Promise<void> | null>(null)

  // OPTIMIZATION: Format date/time once and reuse
  const formatDateTime = useCallback((date: Date): string => {
    const dateStr = date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    })
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    return `${dateStr} ${timeStr}`
  }, [])

  // Fetch transcriptions and combine with appointments/cases
  const fetchClinicalNotes = useCallback(async () => {
    // OPTIMIZATION: Return pending promise if already fetching
    if (isFetchingRef.current && pendingFetchRef.current) {
      return pendingFetchRef.current
    }

    const fetchPromise = (async () => {
      try {
        isFetchingRef.current = true
        setLoading(true)
        setError('')

        // OPTIMIZATION: Fetch all APIs in parallel instead of sequentially
        // Use centralized buildUrl utility for consistent query parameter handling
        // Note: Backend has max limit of 100 for transcriptions, so we'll fetch in batches if needed
        const [transcriptionsResult, appointmentsResult, casesResult] = await Promise.all([
          apiClient.get<{ transcriptions: Transcription[]; total: number }>(buildUrl(API_ROUTES.CLINICIAN.TRANSCRIPTIONS, { limit: 100, offset: 0 })),
          apiClient.get<{ appointments: Appointment[] }>(buildUrl(API_ROUTES.CLINICIAN.APPOINTMENTS, { date: 'all', status: 'all', limit: 1000 })),
          apiClient.get<{ cases: any[] }>(buildUrl(API_ROUTES.CLINICIAN.CASES, { limit: 1000 })),
        ])

        if (isApiError(transcriptionsResult)) {
          throw new Error(getApiErrorMessage(transcriptionsResult) || 'Failed to fetch transcriptions')
        }

        const transcriptions: Transcription[] = transcriptionsResult.data.transcriptions || []
        
        // OPTIMIZATION: Remove duplicates by transcription ID (using Set for O(1) lookup)
        const seenIds = new Set<string>()
        const uniqueTranscriptions = transcriptions.filter((transcription) => {
          if (seenIds.has(transcription.id)) {
            return false // Duplicate found, skip
          }
          seenIds.add(transcription.id)
          return true
        })

        // OPTIMIZATION: Handle responses
        const appointmentsData = !isApiError(appointmentsResult) ? appointmentsResult.data : { appointments: [] }
        const casesData = !isApiError(casesResult) ? casesResult.data : { cases: [] }

        const appointments: any[] = appointmentsData.appointments || []
        const cases: any[] = casesData.cases || []

        // OPTIMIZATION: Use Maps for O(1) lookups instead of O(n) find operations
        const appointmentsMap = new Map(appointments.map(apt => [apt.id, apt]))
        const casesMap = new Map(cases.map(c => [c.id, c]))

        // OPTIMIZATION: Pre-compute appointment date/time for fallback matching
        const appointmentTimeMap = new Map(
          appointments.map(apt => {
            const aptDate = new Date(`${apt.appointmentDate}T${apt.appointmentTime}`)
            return [apt.id, { appointment: apt, time: aptDate.getTime() }]
          })
        )

        // Combine transcriptions with appointment/case data
        // Use uniqueTranscriptions instead of transcriptions to avoid duplicates
        const notes: ClinicalNote[] = uniqueTranscriptions.map((transcription) => {
          const createdAt = new Date(transcription.created_at)
          const transcriptionTime = createdAt.getTime()

          // OPTIMIZATION: Use appointment_id directly (O(1) lookup)
          let relatedAppointment = null
          const appointmentId = (transcription as any).appointment_id
          
          if (appointmentId) {
            relatedAppointment = appointmentsMap.get(appointmentId)
          } else {
            // Fallback: Find appointment closest to transcription time (only if no appointment_id)
            let closestDiff = Infinity
            let closestAppointment = null
            
            for (const [aptId, { appointment, time }] of appointmentTimeMap) {
              const diff = Math.abs(time - transcriptionTime)
              if (diff < closestDiff && diff < 24 * 60 * 60 * 1000) { // Within 24 hours
                closestDiff = diff
                closestAppointment = appointment
              }
            }
            relatedAppointment = closestAppointment
          }

          // OPTIMIZATION: O(1) case lookup
          const relatedCase = relatedAppointment?.caseId ? casesMap.get(relatedAppointment.caseId) : null

          const status = transcription.analysis ? 'Completed' : 'Draft'
          const client = relatedCase?.workerName || relatedAppointment?.workerName || 'N/A'
          const location = relatedCase?.siteLocation || relatedAppointment?.siteLocation || 'N/A'
          const caseNumber = relatedCase?.caseNumber || relatedAppointment?.caseNumber
          const injuryType = relatedCase?.exception_type || relatedCase?.type || relatedAppointment?.exceptionType || null
          const clinicalNotesText = (transcription as any).clinical_notes || ''

          return {
            id: transcription.id,
            date: formatDateTime(createdAt),
            location,
            client,
            provider: 'Clinician',
            type: 'Voice Transcription',
            status,
            caseNumber,
            injuryType: injuryType ? injuryType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : undefined,
            transcription,
            notes: clinicalNotesText || undefined,
            appointment: relatedAppointment ? {
              id: relatedAppointment.id,
              appointmentDate: relatedAppointment.appointmentDate,
              appointmentTime: relatedAppointment.appointmentTime,
              workerName: relatedAppointment.workerName || client,
              workerEmail: relatedAppointment.workerEmail || '',
              siteLocation: relatedAppointment.siteLocation || location,
              status: relatedAppointment.status || 'completed',
              caseId: relatedAppointment.caseId,
              caseNumber: relatedAppointment.caseNumber || caseNumber,
            } : undefined,
          }
        })

        // Clinical Notes page should ONLY show transcriptions from voice-recording
        // Case notes without transcriptions should NOT appear here
        // Users must create a transcription first via voice-recording page

        // OPTIMIZATION: Remove duplicate notes by ID (additional safety check)
        const notesMap = new Map<string, ClinicalNote>()
        notes.forEach((note) => {
          // Keep the most recent note if duplicates exist
          const existing = notesMap.get(note.id)
          if (!existing) {
            notesMap.set(note.id, note)
          } else {
            const existingDate = new Date(existing.transcription?.created_at || existing.date).getTime()
            const currentDate = new Date(note.transcription?.created_at || note.date).getTime()
            if (currentDate > existingDate) {
              notesMap.set(note.id, note)
            }
          }
        })

        // Convert back to array and sort by created_at timestamp
        const uniqueNotes = Array.from(notesMap.values())
        uniqueNotes.sort((a, b) => {
          const dateA = new Date(a.transcription?.created_at || a.date).getTime()
          const dateB = new Date(b.transcription?.created_at || b.date).getTime()
          return dateB - dateA
        })

        setClinicalNotes(uniqueNotes)
      } catch (err: any) {
        console.error('Error fetching clinical notes:', err)
        setError(err.message || 'Failed to fetch clinical notes')
      } finally {
        setLoading(false)
        isFetchingRef.current = false
        pendingFetchRef.current = null
      }
    })()
    
    pendingFetchRef.current = fetchPromise
    return fetchPromise
  }, [formatDateTime])

  // OPTIMIZATION: Memoize filtered notes to prevent unnecessary re-renders
  const filteredNotes = useMemo(() => {
    if (!searchTerm) return clinicalNotes
    const searchLower = searchTerm.toLowerCase()
    return clinicalNotes.filter((note) => {
      return (
        note.client.toLowerCase().includes(searchLower) ||
        note.type.toLowerCase().includes(searchLower) ||
        note.location.toLowerCase().includes(searchLower) ||
        note.caseNumber?.toLowerCase().includes(searchLower) ||
        note.date.toLowerCase().includes(searchLower)
      )
    })
  }, [clinicalNotes, searchTerm])

  // Group notes by case number with deduplication
  const groupedNotes = useMemo(() => {
    // OPTIMIZATION: Use Set to track seen note IDs within groups to prevent duplicates
    const groups = new Map<string, { notes: ClinicalNote[], seenIds: Set<string> }>()
    
    filteredNotes.forEach((note) => {
      const caseKey = note.caseNumber || 'Unassigned'
      
      if (!groups.has(caseKey)) {
        groups.set(caseKey, { notes: [], seenIds: new Set() })
      }
      
      const group = groups.get(caseKey)!
      
      // Skip if this note ID already exists in this group
      if (!group.seenIds.has(note.id)) {
        group.seenIds.add(note.id)
        group.notes.push(note)
      }
    })

    // Sort notes within each group by date (newest first)
    groups.forEach((group) => {
      group.notes.sort((a, b) => {
        const dateA = new Date(a.transcription?.created_at || a.date).getTime()
        const dateB = new Date(b.transcription?.created_at || b.date).getTime()
        return dateB - dateA
      })
    })

    // Convert to array and sort by case number (Unassigned last)
    const sortedGroups = Array.from(groups.entries()).map(([caseNumber, group]) => [caseNumber, group.notes] as [string, ClinicalNote[]])
    sortedGroups.sort((a, b) => {
      if (a[0] === 'Unassigned') return 1
      if (b[0] === 'Unassigned') return -1
      return b[0].localeCompare(a[0]) // Newest case numbers first
    })

    return sortedGroups
  }, [filteredNotes])

  // Toggle folder expansion
  const toggleFolder = useCallback((caseNumber: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(caseNumber)) {
        newSet.delete(caseNumber)
      } else {
        newSet.add(caseNumber)
      }
      return newSet
    })
  }, [])

  // OPTIMIZATION: Keep folders closed by default to avoid loading all data at once
  // Folders will remain closed until user manually expands them

  // OPTIMIZATION: Navigate to detail page instead of modal
  const handleViewDetailsMemo = useCallback((note: ClinicalNote) => {
    navigate(`${PROTECTED_ROUTES.CLINICIAN.CLINICAL_NOTES}/${note.id}`)
  }, [navigate])

  // Handle edit - navigate to detail page in edit mode
  const handleEdit = useCallback((note: ClinicalNote, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row click
    navigate(`${PROTECTED_ROUTES.CLINICIAN.CLINICAL_NOTES}/${note.id}`)
  }, [navigate])

  // Handle delete
  const handleDelete = useCallback((note: ClinicalNote, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row click
    setDeleteConfirmNote(note)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirmNote) return

    // Only allow deletion of transcription notes (not case notes)
    if (deleteConfirmNote.id.startsWith('case-')) {
      setError('Cannot delete case notes. Please delete from the case detail page.')
      setDeleteConfirmNote(null)
      return
    }

    try {
      setDeleting(true)
      setError('')

      // Use centralized apiClient for consistent error handling
      const result = await apiClient.delete<{ message?: string }>(
        API_ROUTES.CLINICIAN.TRANSCRIPTION(deleteConfirmNote.id)
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to delete clinical note')
      }

      // Remove from local state
      setClinicalNotes(prev => prev.filter(note => note.id !== deleteConfirmNote.id))
      
      setDeleteSuccess(true)
      setTimeout(() => setDeleteSuccess(false), 3000)
      setDeleteConfirmNote(null)
    } catch (err: any) {
      console.error('Error deleting clinical note:', err)
      setError(err.message || 'Failed to delete clinical note')
      setDeleteConfirmNote(null)
    } finally {
      setDeleting(false)
    }
  }, [deleteConfirmNote])

  // OPTIMIZATION: Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup: Cancel any pending operations
      isFetchingRef.current = false
      pendingFetchRef.current = null
    }
  }, [])

  // Fetch on mount
  useEffect(() => {
    fetchClinicalNotes()
  }, [fetchClinicalNotes])

  return (
    <DashboardLayout>
      <div className="clinical-notes-page">
        {/* Breadcrumb */}
        <div className="clinical-notes-breadcrumb">
          <span>Reports</span>
          <span className="breadcrumb-separator">&gt;&gt;</span>
          <span>Clinical Notes</span>
        </div>

        {/* Header */}
        <div className="clinical-notes-header">
          <h1 className="clinical-notes-title">Details</h1>
        </div>

        {/* Success Message */}
        {deleteSuccess && (
          <div className="clinical-notes-success">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Clinical note deleted successfully</span>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="clinical-notes-error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{error}</span>
            <button
              className="clinical-notes-error-close"
              onClick={() => setError('')}
              aria-label="Close error"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}

        {/* Search Bar */}
        <div className="clinical-notes-search-container">
          <div className="clinical-notes-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
            <input
              type="text"
              placeholder="Search clinical notes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="clinical-notes-search-input"
            />
          </div>
        </div>

        {/* Folder Structure */}
        {loading ? (
          <Loading message="Loading clinical notes..." size="medium" />
        ) : groupedNotes.length === 0 ? (
          <div className="clinical-notes-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#94A3B8' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <p style={{ fontWeight: 500, color: '#0F172A', marginBottom: '4px' }}>No clinical notes found</p>
            <p style={{ fontSize: '14px', color: '#64748B' }}>
              {searchTerm ? 'Try adjusting your search' : 'Clinical notes will appear here once created'}
            </p>
          </div>
        ) : (
          <div className="clinical-notes-folder-container">
            {groupedNotes.map(([caseNumber, notes]) => (
              <ClinicalNotesFolder
                key={caseNumber}
                caseNumber={caseNumber}
                notes={notes}
                isExpanded={expandedFolders.has(caseNumber)}
                onToggle={toggleFolder}
                onViewDetails={handleViewDetailsMemo}
                onEdit={handleEdit}
                onDelete={handleDelete}
                formatDateTime={formatDateTime}
              />
            ))}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirmNote && (
          <div className="clinical-notes-modal-overlay" onClick={() => setDeleteConfirmNote(null)}>
            <div className="clinical-notes-delete-modal" onClick={(e) => e.stopPropagation()}>
              <div className="clinical-notes-delete-header">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#EF4444' }}>
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="8" x2="12" y2="12"></line>
                          <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                <h3>Delete Clinical Note?</h3>
                <p>Are you sure you want to delete this clinical note? This action cannot be undone.</p>
              </div>
              <div className="clinical-notes-delete-info">
                <div className="clinical-notes-delete-detail">
                  <span className="label">Client:</span>
                  <span className="value">{deleteConfirmNote.client}</span>
                </div>
                <div className="clinical-notes-delete-detail">
                  <span className="label">Date:</span>
                  <span className="value">{deleteConfirmNote.date}</span>
                      </div>
                <div className="clinical-notes-delete-detail">
                  <span className="label">Type:</span>
                  <span className="value">{deleteConfirmNote.type}</span>
                        </div>
                        </div>
              <div className="clinical-notes-delete-actions">
                          <button
                  className="clinical-notes-btn-cancel"
                  onClick={() => setDeleteConfirmNote(null)}
                  disabled={deleting}
                          >
                            Cancel
                          </button>
                          <button
                  className="clinical-notes-btn-delete"
                  onClick={confirmDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                            </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  )
}
