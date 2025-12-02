import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { API_BASE_URL } from '../../../config/api'
import { API_ROUTES } from '../../../config/apiRoutes'
import { PROTECTED_ROUTES } from '../../../config/routes'
import { parseNotes } from '../../../utils/notesParser'
import { buildUrl } from '../../../utils/queryBuilder'
import './ClinicalNoteDetail.css'

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
  transcription?: Transcription
  notes?: string
  appointment?: Appointment
}

const Icons = {
  CloseIcon: ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  ),
}

export function ClinicalNoteDetail() {
  const { noteId } = useParams<{ noteId: string }>()
  const navigate = useNavigate()
  const [clinicalNote, setClinicalNote] = useState<ClinicalNote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingAnalysis, setEditingAnalysis] = useState(false)
  const [editedAnalysis, setEditedAnalysis] = useState<any>(null)
  const [savingAnalysis, setSavingAnalysis] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    if (noteId) {
      fetchClinicalNoteDetail()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId])

  const fetchClinicalNoteDetail = async () => {
    if (!noteId) return

    try {
      setLoading(true)
      setError('')

      // Fetch all transcriptions and find the matching one
      const transcriptionsUrl = buildUrl(API_ROUTES.CLINICIAN.TRANSCRIPTIONS, { limit: '100' })
      const transcriptionsResponse = await fetch(
        `${API_BASE_URL}${transcriptionsUrl}`,
        {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }
      )

      if (!transcriptionsResponse.ok) {
        throw new Error('Failed to fetch clinical note')
      }

      const transcriptionsData = await transcriptionsResponse.json()
      const transcriptions: Transcription[] = transcriptionsData.transcriptions || []
      
      // Find the transcription by ID (remove 'case-' prefix if present)
      const actualNoteId = noteId.startsWith('case-') ? noteId.substring(5) : noteId
      let transcription = transcriptions.find(t => t.id === actualNoteId)

      // If it's a case note, fetch from cases
      if (noteId.startsWith('case-')) {
        const casesResponse = await fetch(
          `${API_BASE_URL}${API_ROUTES.CLINICIAN.CASE(actualNoteId)}`,
          {
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          }
        )

        if (casesResponse.ok) {
          const caseData = await casesResponse.json()
          const caseItem = caseData.case

          if (caseItem) {
            // OPTIMIZATION: Use centralized notes parser
            const notesData = parseNotes(caseItem.notes)
            const clinicalNotesText = notesData?.clinical_notes || (caseItem.notes && !notesData ? caseItem.notes : '')

            const createdAt = new Date(caseItem.createdAt || caseItem.startDate)
            const dateStr = createdAt.toLocaleDateString('en-US', {
              month: '2-digit',
              day: '2-digit',
              year: 'numeric',
            })
            const timeStr = createdAt.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })

            const note: ClinicalNote = {
              id: `case-${caseItem.id}`,
              date: `${dateStr} ${timeStr}`,
              location: caseItem.siteLocation || 'N/A',
              client: caseItem.workerName || 'N/A',
              provider: 'Clinician',
              type: caseItem.type?.replace('_', ' ') || 'Case Note',
              status: 'Completed',
              caseNumber: caseItem.caseNumber,
              notes: clinicalNotesText,
            }

            setClinicalNote(note)
            setLoading(false)
            return
          }
        }
      }

      if (!transcription) {
        throw new Error('Clinical note not found')
      }

      // Fetch appointments to get case/client info
      const appointmentsUrl = buildUrl(API_ROUTES.CLINICIAN.APPOINTMENTS, {
        date: 'all',
        status: 'all',
        limit: '100'
      })
      const appointmentsResponse = await fetch(
        `${API_BASE_URL}${appointmentsUrl}`,
        {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }
      )

      let appointments: any[] = []
      if (appointmentsResponse.ok) {
        const appointmentsData = await appointmentsResponse.json()
        appointments = appointmentsData.appointments || []
      }

      // Fetch cases
      const casesUrl = buildUrl(API_ROUTES.CLINICIAN.CASES, { limit: '100' })
      const casesResponse = await fetch(
        `${API_BASE_URL}${casesUrl}`,
        {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }
      )

      let cases: any[] = []
      if (casesResponse.ok) {
        const casesData = await casesResponse.json()
        cases = casesData.cases || []
      }

      const casesMap = new Map(cases.map(c => [c.id, c]))

      const createdAt = new Date(transcription.created_at)
      const dateStr = createdAt.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
      })
      const timeStr = createdAt.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })

      // Find related appointment
      let relatedAppointment = null
      let relatedCase = null
      
      if ((transcription as any).appointment_id) {
        relatedAppointment = appointments.find(apt => apt.id === (transcription as any).appointment_id)
      } else {
        const transcriptionTime = createdAt.getTime()
        let closestDiff = Infinity
        
        appointments.forEach((apt) => {
          const aptDate = new Date(`${apt.appointmentDate}T${apt.appointmentTime}`)
          const diff = Math.abs(aptDate.getTime() - transcriptionTime)
          if (diff < closestDiff && diff < 24 * 60 * 60 * 1000) {
            closestDiff = diff
            relatedAppointment = apt
          }
        })
      }

      if (relatedAppointment?.caseId) {
        relatedCase = casesMap.get(relatedAppointment.caseId)
      }

      const status = transcription.analysis ? 'Completed' : 'Draft'
      const client = relatedCase?.workerName || relatedAppointment?.workerName || 'N/A'
      const location = relatedCase?.siteLocation || relatedAppointment?.siteLocation || 'N/A'
      const caseNumber = relatedCase?.caseNumber || relatedAppointment?.caseNumber
      const clinicalNotesText = (transcription as any).clinical_notes || ''

      const note: ClinicalNote = {
        id: transcription.id,
        date: `${dateStr} ${timeStr}`,
        location,
        client,
        provider: 'Clinician',
        type: 'Voice Transcription',
        status,
        caseNumber,
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

      setClinicalNote(note)
      setEditedAnalysis(transcription.analysis || null)
    } catch (err: any) {
      console.error('Error fetching clinical note detail:', err)
      setError(err.message || 'Failed to load clinical note details')
    } finally {
      setLoading(false)
    }
  }

  const validateAnalysis = useCallback((analysis: any): string | null => {
    if (!analysis) return null
    
    if (typeof analysis !== 'object' || Array.isArray(analysis)) {
      return 'Analysis must be a valid object'
    }

    if (analysis.summary && typeof analysis.summary !== 'string') {
      return 'Summary must be a string'
    }

    if (analysis.summary && analysis.summary.length > 5000) {
      return 'Summary too long. Maximum length is 5,000 characters'
    }

    if (analysis.keyPoints) {
      if (!Array.isArray(analysis.keyPoints)) {
        return 'Key points must be an array'
      }
      if (analysis.keyPoints.length > 100) {
        return 'Too many key points. Maximum is 100'
      }
      for (let i = 0; i < analysis.keyPoints.length; i++) {
        if (typeof analysis.keyPoints[i] !== 'string') {
          return `Key point ${i + 1} must be a string`
        }
        if (analysis.keyPoints[i].length > 1000) {
          return `Key point ${i + 1} too long. Maximum length is 1,000 characters`
        }
      }
    }

    return null
  }, [])

  const handleSaveAnalysis = useCallback(async () => {
    if (!clinicalNote?.transcription) return

    const validationError = validateAnalysis(editedAnalysis)
    if (validationError) {
      setSaveError(validationError)
      return
    }

    try {
      setSavingAnalysis(true)
      setSaveError('')
      setSaveSuccess(false)

      // SECURITY: Only send allowed fields to prevent validation errors
      const allowedFields = ['summary', 'keyPoints', 'recommendations', 'concerns', 'actionItems']
      const sanitizedAnalysis: any = {}
      
      if (editedAnalysis) {
        Object.keys(editedAnalysis).forEach(key => {
          if (allowedFields.includes(key)) {
            sanitizedAnalysis[key] = editedAnalysis[key]
          }
        })
      }

      const response = await fetch(
        `${API_BASE_URL}${API_ROUTES.CLINICIAN.TRANSCRIPTION(clinicalNote.transcription.id)}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysis: sanitizedAnalysis,
          }),
        }
      )

      if (!response.ok) {
        let errorData: any = null
        try {
          errorData = await response.json()
        } catch {
          errorData = { error: `HTTP ${response.status}: ${response.statusText}` }
        }
        throw new Error(errorData.error || 'Failed to save analysis')
      }

      const data = await response.json()
      const updatedAnalysis = data.transcription?.analysis || editedAnalysis
      
      setClinicalNote(prevNote => {
        if (!prevNote?.transcription) return prevNote
        return {
          ...prevNote,
          transcription: {
            ...prevNote.transcription,
            analysis: updatedAnalysis,
          },
        }
      })

      setEditingAnalysis(false)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: any) {
      console.error('Error saving analysis:', err)
      setSaveError(err.message || 'Failed to save analysis')
    } finally {
      setSavingAnalysis(false)
    }
  }, [clinicalNote, editedAnalysis, validateAnalysis])

  const handleCancelEdit = useCallback(() => {
    setEditedAnalysis(clinicalNote?.transcription?.analysis || null)
    setEditingAnalysis(false)
    setSaveError('')
  }, [clinicalNote])

  if (!noteId) {
    return (
      <DashboardLayout>
        <div className="clinical-note-detail-container">
          <div className="clinical-note-detail-error">
            <p>Note ID is required</p>
            <button onClick={() => navigate(PROTECTED_ROUTES.CLINICIAN.CLINICAL_NOTES)}>
              Back to Clinical Notes
            </button>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="clinical-note-detail-container">
        <div className="clinical-note-detail-page">
          {/* Header */}
          <div className="clinical-note-detail-header">
            <div className="clinical-note-header-main">
              <div className="clinical-note-header-title-section">
                <h2>Clinical Note Details</h2>
                {clinicalNote && (
                  <span className={`clinical-note-status-badge ${clinicalNote.status.toLowerCase()}`}>
                    {clinicalNote.status}
                  </span>
                )}
              </div>
            </div>
            <button 
              className="clinical-note-detail-close" 
              onClick={() => navigate(PROTECTED_ROUTES.CLINICIAN.CLINICAL_NOTES)} 
              title="Back to Clinical Notes"
            >
              <Icons.CloseIcon size={20} />
            </button>
          </div>

          {loading ? (
            <div className="clinical-note-detail-loading">
              <Loading message="Loading clinical note details..." size="medium" />
            </div>
          ) : error ? (
            <div className="clinical-note-detail-error">
              <p>{error}</p>
              <button onClick={fetchClinicalNoteDetail}>Retry</button>
            </div>
          ) : clinicalNote ? (
            <div className="clinical-note-detail-content">
              {saveSuccess && (
                <div className="clinical-note-success-alert">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Analysis saved successfully</span>
                </div>
              )}

              {/* Appointment Details Section */}
              {clinicalNote.appointment && (
                <div className="clinical-note-section">
                  <div className="clinical-note-section-header">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <h3>Appointment Information</h3>
                  </div>
                  <div className="clinical-note-info-grid">
                    <div className="clinical-note-info-item">
                      <span className="clinical-note-info-label">Date & Time</span>
                      <span className="clinical-note-info-value">
                        {new Date(`${clinicalNote.appointment.appointmentDate}T${clinicalNote.appointment.appointmentTime}`).toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })} at {new Date(`2000-01-01T${clinicalNote.appointment.appointmentTime}`).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                        })}
                      </span>
                    </div>
                    <div className="clinical-note-info-item">
                      <span className="clinical-note-info-label">Client</span>
                      <span className="clinical-note-info-value">{clinicalNote.appointment.workerName}</span>
                    </div>
                    <div className="clinical-note-info-item">
                      <span className="clinical-note-info-label">Email</span>
                      <span className="clinical-note-info-value">{clinicalNote.appointment.workerEmail || 'N/A'}</span>
                    </div>
                    <div className="clinical-note-info-item">
                      <span className="clinical-note-info-label">Location</span>
                      <span className="clinical-note-info-value">{clinicalNote.appointment.siteLocation}</span>
                    </div>
                    {clinicalNote.appointment.caseNumber && (
                      <div className="clinical-note-info-item">
                        <span className="clinical-note-info-label">Case Number</span>
                        <span className="clinical-note-info-value">{clinicalNote.appointment.caseNumber}</span>
                      </div>
                    )}
                    <div className="clinical-note-info-item">
                      <span className="clinical-note-info-label">Status</span>
                      <span className={`clinical-note-status-badge-small ${clinicalNote.appointment.status.toLowerCase()}`}>
                        {clinicalNote.appointment.status}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Transcription Section */}
              {clinicalNote.transcription && (
                <div className="clinical-note-section">
                  <div className="clinical-note-section-header">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                      <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    <h3>Transcription</h3>
                  </div>
                  <div className="clinical-note-transcription-box">
                    {clinicalNote.transcription.transcription_text}
                  </div>
                </div>
              )}

              {/* Analysis Section */}
              {clinicalNote.transcription && (
                <div className="clinical-note-section">
                  <div className="clinical-note-section-header">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                      <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    <h3>Analysis</h3>
                    {!editingAnalysis && clinicalNote.transcription.analysis && (
                      <button
                        className="clinical-note-edit-btn"
                        onClick={() => setEditingAnalysis(true)}
                        aria-label="Edit analysis"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        Edit
                      </button>
                    )}
                  </div>
                  
                  {saveError && (
                    <div className="clinical-note-error-message">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      {saveError}
                    </div>
                  )}

                  {editingAnalysis ? (
                    <div className="clinical-note-analysis-editor">
                      <div className="clinical-note-analysis-field">
                        <label>Summary</label>
                        <textarea
                          value={editedAnalysis?.summary || ''}
                          onChange={(e) => setEditedAnalysis({ ...editedAnalysis, summary: e.target.value })}
                          placeholder="Enter analysis summary..."
                          rows={3}
                          className="clinical-note-textarea"
                        />
                      </div>
                      <div className="clinical-note-analysis-field">
                        <label>Key Points</label>
                        <textarea
                          value={editedAnalysis?.keyPoints?.join('\n') || ''}
                          onChange={(e) => setEditedAnalysis({
                            ...editedAnalysis,
                            keyPoints: e.target.value.split('\n').filter(p => p.trim())
                          })}
                          placeholder="Enter key points (one per line)..."
                          rows={6}
                          className="clinical-note-textarea"
                        />
                      </div>
                      <div className="clinical-note-analysis-actions">
                        <button
                          className="clinical-note-btn-secondary"
                          onClick={handleCancelEdit}
                          disabled={savingAnalysis}
                        >
                          Cancel
                        </button>
                        <button
                          className="clinical-note-btn-primary"
                          onClick={handleSaveAnalysis}
                          disabled={savingAnalysis}
                        >
                          {savingAnalysis ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="clinical-note-analysis-display">
                      {clinicalNote.transcription.analysis ? (
                        <>
                          {clinicalNote.transcription.analysis.summary && (
                            <div className="clinical-note-analysis-item">
                              <strong>Summary:</strong>
                              <p>{clinicalNote.transcription.analysis.summary}</p>
                            </div>
                          )}
                          {clinicalNote.transcription.analysis.keyPoints && clinicalNote.transcription.analysis.keyPoints.length > 0 && (
                            <div className="clinical-note-analysis-item">
                              <strong>Key Points:</strong>
                              <ul>
                                {clinicalNote.transcription.analysis.keyPoints.map((point: string, idx: number) => (
                                  <li key={idx}>{point}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="clinical-note-empty-analysis">
                          <p>No analysis available. Click "Add Analysis" to add analysis.</p>
                          <button
                            className="clinical-note-btn-primary"
                            onClick={() => {
                              setEditedAnalysis({ summary: '', keyPoints: [] })
                              setEditingAnalysis(true)
                            }}
                          >
                            Add Analysis
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Clinical Notes Section */}
              {clinicalNote.notes && (
                <div className="clinical-note-section">
                  <div className="clinical-note-section-header">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                    <h3>Clinical Notes</h3>
                  </div>
                  <div className="clinical-note-notes-box">
                    {clinicalNote.notes}
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

