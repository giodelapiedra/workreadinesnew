import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import { buildUrl } from '../../../utils/queryBuilder'
import loadingSvg from '../../../assets/loading.svg'
import './VoiceRecordingPage.css'

interface TranscriptionAnalysis {
  summary: string
  keyPoints: string[]
  clinicalNotes: string
  recommendations: string[]
  actionItems: string[]
}

type AudioSource = 'microphone' | 'system' | 'both'

interface Appointment {
  id: string
  caseId: string
  caseNumber: string
  workerId: string
  workerName: string
  workerEmail: string
  appointmentDate: string
  appointmentTime: string
  status: string
}

export function VoiceRecordingPage() {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [transcription, setTranscription] = useState('')
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [analysis, setAnalysis] = useState<TranscriptionAnalysis | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [recordingTime, setRecordingTime] = useState(0)
  const [hasRecorded, setHasRecorded] = useState(false)
  const [showTranscriptionDetails, setShowTranscriptionDetails] = useState(false)
  const [audioSource, setAudioSource] = useState<AudioSource>('microphone')
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [selectedAppointment, setSelectedAppointment] = useState<string>('')
  const [clientName, setClientName] = useState('')
  const [loadingAppointments, setLoadingAppointments] = useState(false)
  const [clinicalNotes, setClinicalNotes] = useState('')
  const [showStartRecordingModal, setShowStartRecordingModal] = useState(false)
  const [showSuccessToast, setShowSuccessToast] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [activeTab, setActiveTab] = useState<'context' | 'transcript'>('transcript')
  const [showTranscriptionModeDropdown, setShowTranscriptionModeDropdown] = useState(false)
  const [transcriptionMode, setTranscriptionMode] = useState<'transcribing' | 'dictating' | 'upload'>('transcribing')
  const [noteContent, setNoteContent] = useState('')
  const [audioLevel, setAudioLevel] = useState(0) // For audio level indicators
  const [showAudioSourceModal, setShowAudioSourceModal] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [noteHistory, setNoteHistory] = useState<string[]>([]) // For undo/redo
  const [noteHistoryIndex, setNoteHistoryIndex] = useState(-1) // Current position in history
  const [showMicDropdown, setShowMicDropdown] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)

  // Helper function to cleanup streams
  const cleanupStreams = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop())
      micStreamRef.current = null
    }
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach(track => track.stop())
      systemStreamRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      cleanupStreams()
    }
  }, [cleanupStreams])

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause()
      setIsPaused(true)
      
      // Pause timer
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume()
      setIsPaused(false)
      
      // Resume timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 1000)
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setIsPaused(false)
      
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  // Handle system stream end - defined before startRecording to avoid initialization error
  const handleSystemStreamEnd = useCallback(() => {
    if (isRecording) {
      stopRecording()
      setError('System audio stream ended. Recording stopped.')
    }
  }, [isRecording, stopRecording])

  const startRecording = useCallback(async (source?: AudioSource) => {
    if (!selectedAppointment) {
      setError('Please select an appointment first')
      return
    }

    // Use provided source or fall back to current audioSource state
    const currentSource = source || audioSource

    try {
      setError('')
      audioChunksRef.current = []
      setIsRecording(false)

      let micStream: MediaStream | null = null
      let systemStream: MediaStream | null = null

      // Get microphone stream if needed
      if (currentSource === 'microphone' || currentSource === 'both') {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            } 
          })
          micStreamRef.current = micStream
        } catch (err: any) {
          console.error('Error accessing microphone:', err)
          throw new Error('Failed to access microphone. Please check permissions.')
        }
      }

      // Get system audio stream if needed
      if (currentSource === 'system' || currentSource === 'both') {
        try {
          // Some browsers require video: true even if we only want audio
          // We'll stop the video tracks immediately after getting the stream
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true, // Required by some browsers
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
            } as MediaTrackConstraints
          })
          
          // Stop video tracks immediately (we only need audio)
          displayStream.getVideoTracks().forEach(track => {
            track.stop()
          })
          
          // Check if we have audio tracks
          const audioTracks = displayStream.getAudioTracks()
          if (audioTracks.length === 0) {
            // Clean up microphone stream if it was opened
            if (micStream) {
              micStream.getTracks().forEach(track => track.stop())
              micStreamRef.current = null
            }
            displayStream.getTracks().forEach(track => track.stop())
            throw new Error('No audio track available. Please make sure to select "Share tab audio" or "Share system audio" in the browser dialog.')
          }
          
          // Create a new stream with only audio tracks
          systemStream = new MediaStream(audioTracks)
          systemStreamRef.current = systemStream
          
          // Handle when user stops sharing (closes the share dialog)
          audioTracks.forEach(track => {
            track.onended = () => {
              handleSystemStreamEnd()
            }
          })
        } catch (err: any) {
          console.error('Error accessing system audio:', err)
          // Clean up microphone stream if it was opened
          if (micStream) {
            micStream.getTracks().forEach(track => track.stop())
            micStreamRef.current = null
          }
          
          // Provide more specific error messages
          if (err.name === 'NotSupportedError' || err.name === 'NotAllowedError') {
            throw new Error('System audio capture is not supported in this browser. Please use "Microphone Only" or "Both" options instead.')
          } else if (err.name === 'AbortError') {
            throw new Error('System audio access was cancelled. Please try again.')
          } else {
            throw err instanceof Error ? err : new Error('Failed to access system audio. Please select "Share tab audio" or "Share system audio" in the browser dialog.')
          }
        }
      }

      // Combine streams if both are selected
      if (currentSource === 'both' && micStream && systemStream) {
        const audioContext = new AudioContext()
        const micSource = audioContext.createMediaStreamSource(micStream)
        const systemSource = audioContext.createMediaStreamSource(systemStream)
        const destination = audioContext.createMediaStreamDestination()
        
        micSource.connect(destination)
        systemSource.connect(destination)
        
        streamRef.current = destination.stream
      } else if (micStream) {
        streamRef.current = micStream
      } else if (systemStream) {
        streamRef.current = systemStream
      } else {
        throw new Error('No audio source selected')
      }

      // Create MediaRecorder with optimized settings for cost efficiency
      // Try to use optimized codec settings, fallback to default if not supported
      const getOptimalMimeType = (): string => {
        const options = [
          'audio/webm;codecs=opus', // Best compression for webm
          'audio/webm', // Fallback
          'audio/ogg;codecs=opus', // Alternative
          'audio/mp4', // Last resort
        ]
        
        for (const option of options) {
          if (MediaRecorder.isTypeSupported(option)) {
            return option
          }
        }
        return '' // Browser will use default
      }

      const mimeType = getOptimalMimeType()
      const mediaRecorderOptions: MediaRecorderOptions = mimeType 
        ? { mimeType }
        : {} // Let browser choose optimal format

      // OPTIMIZED: Use lower bitrate for speech (if supported by browser)
      // This significantly reduces file size while maintaining transcription quality
      const mediaRecorder = new MediaRecorder(streamRef.current, mediaRecorderOptions)

      mediaRecorderRef.current = mediaRecorder

      // Collect audio chunks
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      // Handle recording stop
      mediaRecorder.onstop = () => {
        if (micStream) {
          micStream.getTracks().forEach(track => track.stop())
          micStreamRef.current = null
        }
        if (systemStream) {
          systemStream.getTracks().forEach(track => track.stop())
          systemStreamRef.current = null
        }
        streamRef.current = null
        setHasRecorded(true)
      }

      // Start recording
      mediaRecorder.start(1000) // Collect data every second
      setIsRecording(true)
      setIsPaused(false)
      setRecordingTime(0)

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 1000)
    } catch (err: any) {
      console.error('Error starting recording:', err)
      setError(err.message || 'Failed to start recording. Please check permissions.')
      setIsRecording(false)
      cleanupStreams()
    }
  }, [audioSource, handleSystemStreamEnd, cleanupStreams, selectedAppointment])

  const confirmStartRecording = useCallback(async () => {
    setShowStartRecordingModal(false)
    await startRecording()
    
    // Show success toast
    setSuccessMessage('Recording started successfully')
    setShowSuccessToast(true)
    setTimeout(() => {
      setShowSuccessToast(false)
      setSuccessMessage('')
    }, 3000)
  }, [startRecording])

  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }, [])

  const estimatedCost = useMemo(() => {
    if (!recordingTime) return '0'
    const minutes = recordingTime / 60
    return (minutes * 0.006).toFixed(4) // $0.006 per minute
  }, [recordingTime])


  const handleSaveTranscription = useCallback(async (
    text: string, 
    analysisData: TranscriptionAnalysis | null,
    duration: number,
    cost: number,
    notes?: string,
    analysisCost?: number
  ) => {
    try {
      // Calculate audio file size (approximate)
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      const audioFileSize = audioBlob.size

      const result = await apiClient.post<{ message: string }>(
        API_ROUTES.CLINICIAN.TRANSCRIPTIONS,
        {
          transcription_text: text,
          analysis: analysisData,
          recording_duration_seconds: duration,
          estimated_cost: cost, // Whisper transcription cost
          analysis_cost: analysisCost || 0, // GPT-3.5-turbo analysis cost
          audio_file_size_bytes: audioFileSize,
          clinical_notes: notes || null,
          appointment_id: selectedAppointment || null,
        }
      )

      if (isApiError(result)) {
        console.error('Error saving transcription:', result.error)
        // Don't show error to user - saving is optional
      }
    } catch (err: any) {
      console.error('Error saving transcription:', err)
      // Don't show error to user - saving is optional
    }
  }, [selectedAppointment])

  const handleTranscribe = useCallback(async () => {
    if (audioChunksRef.current.length === 0) {
      setError('No audio recorded. Please record audio first.')
      return
    }

    try {
      setIsTranscribing(true)
      setError('')

      // Combine audio chunks into a single blob
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      
      // Create FormData
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')

      // Use centralized apiClient for FormData uploads
      // apiClient now supports FormData and handles Content-Type automatically
      const result = await apiClient.post<{ transcription: string; transcription_id?: string }>(
        API_ROUTES.CLINICIAN.TRANSCRIBE,
        formData
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Transcription failed')
      }

      const data = result.data
      const transcribedText = data.transcription || ''
      setTranscription(transcribedText)
      
      // Auto-save transcription after successful transcription
      if (transcribedText) {
        await handleSaveTranscription(transcribedText, null, recordingTime, parseFloat(estimatedCost), clinicalNotes, 0)
      }
    } catch (err: any) {
      console.error('Error transcribing audio:', err)
      setError(err.message || 'Failed to transcribe audio')
    } finally {
      setIsTranscribing(false)
    }
  }, [recordingTime, estimatedCost, handleSaveTranscription, clinicalNotes])

  const handleAnalyze = useCallback(async () => {
    if (!transcription.trim()) {
      setError('No transcription to analyze. Please transcribe audio first.')
      return
    }

    try {
      setIsAnalyzing(true)
      setError('')

      const result = await apiClient.post<{ analysis: TranscriptionAnalysis }>(
        API_ROUTES.CLINICIAN.ANALYZE_TRANSCRIPTION,
        { transcription: transcription }
      )

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Analysis failed')
      }

      const analysisData = result.data.analysis
      setAnalysis(analysisData)
      
      // Extract analysis cost from response if available
      const analysisCost = (result.data as any).analysisCost || (analysisData as any).estimatedCost || 0
      
      // Auto-save transcription with analysis (include both transcription and analysis costs)
      await handleSaveTranscription(transcription, analysisData, recordingTime, parseFloat(estimatedCost), clinicalNotes, analysisCost)
    } catch (err: any) {
      console.error('Error analyzing transcription:', err)
      setError(err.message || 'Failed to analyze transcription')
    } finally {
      setIsAnalyzing(false)
    }
  }, [transcription, recordingTime, estimatedCost, handleSaveTranscription, clinicalNotes])

  const handleClear = useCallback(() => {
    setTranscription('')
    setAnalysis(null)
    setError('')
    audioChunksRef.current = []
    setRecordingTime(0)
    setHasRecorded(false)
  }, [])

  // Helper to format date for details modal
  const formatDate = useCallback((dateString?: string) => {
    if (!dateString) return new Date().toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }, [])

  // Helper to format duration for details modal
  const formatDuration = useCallback((seconds: number | null) => {
    if (!seconds) return 'N/A'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }, [])

  // Fetch today's appointments
  const fetchTodayAppointments = useCallback(async () => {
    try {
      setLoadingAppointments(true)
      const result = await apiClient.get<{ appointments: Appointment[] }>(
        buildUrl(API_ROUTES.CLINICIAN.APPOINTMENTS, { date: 'today', status: 'all', limit: 100 })
      )

      if (isApiError(result)) {
        console.error('Error fetching appointments:', getApiErrorMessage(result))
        return
      }

      // Filter only confirmed/pending appointments for today (exclude completed, cancelled, declined)
      const todayAppts = (result.data.appointments || []).filter(
        (apt: Appointment) => apt.status === 'confirmed' || apt.status === 'pending'
      )
      setAppointments(todayAppts)
      
      // If currently selected appointment is no longer in the list (e.g., was completed), clear selection
      if (selectedAppointment && !todayAppts.find((apt: Appointment) => apt.id === selectedAppointment)) {
        setSelectedAppointment('')
        setClientName('')
      }
    } catch (err: any) {
      console.error('Error fetching appointments:', err)
      // Don't show error to user - just log it
    } finally {
      setLoadingAppointments(false)
    }
  }, [selectedAppointment])

  // Handle appointment selection
  const handleAppointmentSelect = useCallback((appointmentId: string) => {
    setSelectedAppointment(appointmentId)
    const appointment = appointments.find(apt => apt.id === appointmentId)
    if (appointment) {
      setClientName(appointment.workerName)
      // Update note content with appointment details if note is empty
      if (!noteContent && !transcription) {
        const appointmentDetails = `Patient: ${appointment.workerName}\nCase Number: ${appointment.caseNumber}\nDate: ${appointment.appointmentDate}\nTime: ${appointment.appointmentTime}\n\n`
        setNoteContent(appointmentDetails)
        // Initialize history with appointment details
        setNoteHistory([appointmentDetails])
        setNoteHistoryIndex(0)
      }
    } else {
      setClientName('')
    }
  }, [appointments, noteContent, transcription])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.vr-mic-dropdown-wrapper')) {
        setShowMicDropdown(false)
      }
      if (!target.closest('.vr-transcribe-dropdown-wrapper')) {
        setShowTranscriptionModeDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Fetch appointments on mount and refresh when window regains focus
  useEffect(() => {
    fetchTodayAppointments()
    
    // Refresh when window regains focus (user comes back from appointments page)
    const handleFocus = () => {
      fetchTodayAppointments()
    }
    window.addEventListener('focus', handleFocus)
    
    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, [fetchTodayAppointments])

  // Helper to get current date/time string
  const getCurrentDateTime = useCallback(() => {
    const now = new Date()
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    return `${dateStr} ${timeStr}`
  }, [])

  // Update note content when transcription changes (sync transcription to noteContent for editing)
  useEffect(() => {
    if (transcription) {
      // Sync transcription to noteContent for editing (only if noteContent is empty or matches)
      if (!noteContent || noteContent === transcription) {
        setNoteContent(transcription)
        // Initialize history when transcription is set
        setNoteHistory([transcription])
        setNoteHistoryIndex(0)
      }
    }
  }, [transcription, noteContent])

  // Handle note content changes for undo/redo
  // Use debounce to avoid adding every keystroke to history
  const noteChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const handleNoteChange = useCallback((newContent: string) => {
    setNoteContent(newContent)
    
    // Clear existing timeout
    if (noteChangeTimeoutRef.current) {
      clearTimeout(noteChangeTimeoutRef.current)
    }
    
    // Debounce: Add to history after 1 second of no typing
    noteChangeTimeoutRef.current = setTimeout(() => {
      setNoteHistory((prevHistory) => {
        const newHistory = prevHistory.slice(0, noteHistoryIndex + 1)
        newHistory.push(newContent)
        // Limit history to 50 items to prevent memory issues
        if (newHistory.length > 50) {
          newHistory.shift()
          return newHistory
        }
        return newHistory
      })
      setNoteHistoryIndex((prevIndex) => {
        const newIndex = Math.min(prevIndex + 1, 49) // Max 50 items
        return newIndex
      })
    }, 1000) // 1 second debounce
  }, [noteHistoryIndex])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (noteChangeTimeoutRef.current) {
        clearTimeout(noteChangeTimeoutRef.current)
      }
    }
  }, [])

  // Undo functionality
  const handleUndo = useCallback(() => {
    setNoteHistory((prevHistory) => {
      if (noteHistoryIndex > 0) {
        const newIndex = noteHistoryIndex - 1
        setNoteHistoryIndex(newIndex)
        setNoteContent(prevHistory[newIndex])
      }
      return prevHistory
    })
  }, [noteHistoryIndex])

  // Redo functionality
  const handleRedo = useCallback(() => {
    setNoteHistory((prevHistory) => {
      if (noteHistoryIndex < prevHistory.length - 1) {
        const newIndex = noteHistoryIndex + 1
        setNoteHistoryIndex(newIndex)
        setNoteContent(prevHistory[newIndex])
      }
      return prevHistory
    })
  }, [noteHistoryIndex])

  // Save note/transcription functionality
  const handleSaveNote = useCallback(async () => {
    if (!selectedAppointment || !transcription.trim()) {
      setError('Please select an appointment and add transcription content before saving')
      return
    }

    try {
      setSavingNote(true)
      setError('')

      // Save transcription with clinical notes
      // Extract analysis cost if analysis exists
      const analysisCostValue = analysis && (analysis as any).estimatedCost ? (analysis as any).estimatedCost : 0
      await handleSaveTranscription(
        transcription,
        analysis,
        recordingTime,
        parseFloat(estimatedCost),
        noteContent || clinicalNotes,
        analysisCostValue
      )

      // Update clinical notes state
      if (noteContent) {
        setClinicalNotes(noteContent)
      }

      // Show success message
      setSuccessMessage('Transcription saved successfully')
      setShowSuccessToast(true)
      setTimeout(() => {
        setShowSuccessToast(false)
        setSuccessMessage('')
      }, 3000)
    } catch (err: any) {
      console.error('Error saving transcription:', err)
      setError(err.message || 'Failed to save transcription')
    } finally {
      setSavingNote(false)
    }
  }, [selectedAppointment, transcription, analysis, recordingTime, estimatedCost, noteContent, clinicalNotes, handleSaveTranscription])

  // Handle transcription mode selection
  const handleTranscriptionModeSelect = useCallback((mode: 'transcribing' | 'dictating' | 'upload') => {
    setTranscriptionMode(mode)
    setShowTranscriptionModeDropdown(false)
    
    if (mode === 'transcribing') {
      // Show audio source selection modal first
      if (!isRecording && !hasRecorded) {
        setShowAudioSourceModal(true)
      } else if (hasRecorded) {
        // If already recorded, transcribe immediately
        handleTranscribe()
      }
    } else if (mode === 'dictating') {
      // Start dictation mode (similar to recording but different flow)
      if (!isRecording && !hasRecorded) {
        setShowAudioSourceModal(true)
      } else if (hasRecorded) {
        handleTranscribe()
      }
    } else if (mode === 'upload') {
      // Handle file upload
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'audio/*'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) {
          // Convert file to blob and process
          audioChunksRef.current = [file]
          setHasRecorded(true)
          handleTranscribe()
        }
      }
      input.click()
    }
  }, [hasRecorded, isRecording, handleTranscribe])

  const handleStartRecordingClick = useCallback(() => {
    if (!selectedAppointment) {
      setError('Please select an appointment first')
      return
    }
    setShowStartRecordingModal(true)
  }, [selectedAppointment])

  // Simulate audio levels when recording (not when paused)
  useEffect(() => {
    if (isRecording && !isPaused) {
      const interval = setInterval(() => {
        setAudioLevel(Math.floor(Math.random() * 5) + 1)
      }, 200)
      return () => clearInterval(interval)
    } else {
      setAudioLevel(0)
    }
  }, [isRecording, isPaused])

  return (
    <DashboardLayout>
      <div className="voice-recording-page-new">
        {/* New Header Design */}
        <div className="vr-header">
          <div className="vr-header-left">
            <div className="vr-patient-details">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              {selectedAppointment ? (
                <span>
                  {clientName} - {appointments.find(apt => apt.id === selectedAppointment)?.caseNumber || ''}
                </span>
              ) : (
                <span>Add patient details</span>
              )}
              {selectedAppointment && (
                <button 
                  className="vr-delete-btn"
                  onClick={() => {
                    setSelectedAppointment('')
                    setClientName('')
                    setTranscription('')
                    setNoteContent('')
                    setAnalysis(null)
                  }}
                  title="Clear patient details"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              )}
            </div>
            <div className="vr-header-info">
              <div className="vr-info-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <span>{getCurrentDateTime()}</span>
              </div>
            </div>
          </div>
          <div className="vr-header-right">
            <div className="vr-transcribe-controls">
              <div className="vr-transcribe-controls-inner">
                {!isRecording && !hasRecorded ? (
                  <div className="vr-transcribe-dropdown-wrapper">
                    <button 
                      className="vr-start-transcribe-btn"
                      onClick={() => setShowTranscriptionModeDropdown(!showTranscriptionModeDropdown)}
                      disabled={!selectedAppointment}
                    >
                      Start transcribing
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </button>
                    {showTranscriptionModeDropdown && (
                      <div className="vr-transcribe-dropdown">
                        <button 
                          className={`vr-transcribe-option ${transcriptionMode === 'transcribing' ? 'active' : ''}`}
                          onClick={() => handleTranscriptionModeSelect('transcribing')}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                          Transcribing
                        </button>
                        <button 
                          className={`vr-transcribe-option ${transcriptionMode === 'dictating' ? 'active' : ''}`}
                          onClick={() => handleTranscriptionModeSelect('dictating')}
                        >
                          Dictating
                        </button>
                        <button 
                          className={`vr-transcribe-option ${transcriptionMode === 'upload' ? 'active' : ''}`}
                          onClick={() => handleTranscriptionModeSelect('upload')}
                        >
                          Upload session audio
                        </button>
                      </div>
                    )}
                  </div>
                ) : isRecording ? (
                  <>
                    {isPaused ? (
                      <button 
                        className="vr-resume-recording-btn"
                        onClick={resumeRecording}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        Resume
                      </button>
                    ) : (
                      <button 
                        className="vr-pause-recording-btn"
                        onClick={pauseRecording}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="4" width="4" height="16"></rect>
                          <rect x="14" y="4" width="4" height="16"></rect>
                        </svg>
                        Pause
                      </button>
                    )}
                    <button 
                      className="vr-stop-recording-btn"
                      onClick={stopRecording}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2"></rect>
                      </svg>
                      Stop
                    </button>
                    <div className="vr-timer">
                      <span>{formatTime(recordingTime)}</span>
                      {isPaused && <span className="vr-timer-paused">(Paused)</span>}
                    </div>
                    {!isPaused && (
                      <>
                        <div className="vr-mic-icon">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                            <line x1="12" y1="19" x2="12" y2="23"></line>
                            <line x1="8" y1="23" x2="16" y2="23"></line>
                          </svg>
                        </div>
                        <div className="vr-audio-levels">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <div 
                              key={i} 
                              className={`vr-audio-dot ${audioLevel >= i ? 'active' : ''}`}
                            ></div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : hasRecorded ? (
                  <button 
                    className="vr-transcribe-btn"
                    onClick={handleTranscribe}
                    disabled={isTranscribing || isAnalyzing}
                  >
                    {isTranscribing ? (
                      <>
                        <svg className="vr-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"></circle>
                        </svg>
                        Transcribing...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2v20M2 12h20"></path>
                        </svg>
                        Transcribe
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="vr-error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{error}</span>
            <button
              className="vr-error-close"
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

        {/* Navigation Tabs */}
        <div className="vr-tabs">
          <button 
            className={`vr-tab ${activeTab === 'transcript' ? 'active' : ''}`}
            onClick={() => setActiveTab('transcript')}
          >
            Transcript
          </button>
          <button 
            className={`vr-tab ${activeTab === 'context' ? 'active' : ''}`}
            onClick={() => setActiveTab('context')}
          >
            Context
          </button>
        </div>

        {/* Main Content */}
        <div className="vr-main-content">
          {/* Appointment Selector - Hidden in header, shown in patient details */}
          {!selectedAppointment && (
            <div className="vr-appointment-selector">
              <label className="vr-label">
                Select Appointment <span className="vr-required">*</span>
              </label>
              <select
                value={selectedAppointment}
                onChange={(e) => handleAppointmentSelect(e.target.value)}
                disabled={loadingAppointments || isRecording || isTranscribing}
                className="vr-select"
              >
                <option value="">-- Select Appointment (Required) --</option>
                {appointments.map((apt) => (
                  <option key={apt.id} value={apt.id}>
                    {apt.workerName} - {apt.appointmentTime} ({apt.caseNumber})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Template and Input Section */}
          <div className="vr-content-header">
            <div className="vr-content-actions">
              <div className="vr-mic-dropdown-wrapper">
                <button 
                  className="vr-action-btn vr-mic-btn"
                  onClick={() => setShowMicDropdown(!showMicDropdown)}
                  title="Microphone options"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
                {showMicDropdown && (
                  <div className="vr-mic-dropdown">
                    <button 
                      className="vr-mic-option"
                      onClick={async () => {
                        setAudioSource('microphone')
                        setShowMicDropdown(false)
                        // Auto-start recording if appointment is selected
                        if (selectedAppointment) {
                          await startRecording('microphone')
                        } else {
                          setError('Please select an appointment first')
                        }
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                      </svg>
                      Microphone Only
                    </button>
                    <button 
                      className="vr-mic-option"
                      onClick={async () => {
                        setAudioSource('system')
                        setShowMicDropdown(false)
                        // Auto-start recording if appointment is selected
                        if (selectedAppointment) {
                          await startRecording('system')
                        } else {
                          setError('Please select an appointment first')
                        }
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
                        <line x1="6" y1="8" x2="18" y2="8"></line>
                        <line x1="6" y1="12" x2="18" y2="12"></line>
                        <line x1="6" y1="16" x2="12" y2="16"></line>
                      </svg>
                      System Audio
                    </button>
                    <button 
                      className="vr-mic-option"
                      onClick={async () => {
                        setAudioSource('both')
                        setShowMicDropdown(false)
                        // Auto-start recording if appointment is selected
                        if (selectedAppointment) {
                          await startRecording('both')
                        } else {
                          setError('Please select an appointment first')
                        }
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                        <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
                      </svg>
                      Both
                    </button>
                  </div>
                )}
              </div>
              <button 
                className="vr-action-btn" 
                onClick={handleUndo}
                disabled={noteHistoryIndex <= 0}
                title="Undo"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 7v6h6"></path>
                  <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path>
                </svg>
              </button>
              <button 
                className="vr-action-btn" 
                onClick={handleRedo}
                disabled={noteHistoryIndex >= noteHistory.length - 1}
                title="Redo"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 7v6h-6"></path>
                  <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"></path>
                </svg>
              </button>
              <button 
                className="vr-action-btn"
                onClick={() => {
                  const textToCopy = activeTab === 'transcript' ? transcription : (noteContent || transcription)
                  if (textToCopy) {
                    navigator.clipboard.writeText(textToCopy)
                    setSuccessMessage('Copied to clipboard')
                    setShowSuccessToast(true)
                    setTimeout(() => {
                      setShowSuccessToast(false)
                      setSuccessMessage('')
                    }, 2000)
                  }
                }}
                title="Copy"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="vr-note-area">
            {activeTab === 'transcript' && (
              <div className="vr-transcript-area">
                {transcription ? (
                  <>
                    <textarea
                      className="vr-note-textarea"
                      value={transcription}
                      onChange={(e) => {
                        setTranscription(e.target.value)
                        handleNoteChange(e.target.value)
                      }}
                      placeholder="Transcript will appear here..."
                      disabled={!selectedAppointment}
                    />
                    <div className="vr-transcript-actions">
                      <button
                        className="vr-save-note-btn"
                        onClick={handleSaveNote}
                        disabled={savingNote || !selectedAppointment || !transcription.trim()}
                      >
                        {savingNote ? (
                          <>
                            <svg className="vr-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"></circle>
                            </svg>
                            Saving...
                          </>
                        ) : (
                          <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                              <polyline points="17 21 17 13 7 13 7 21"></polyline>
                              <polyline points="7 3 7 8 15 8"></polyline>
                            </svg>
                            Save Changes
                          </>
                        )}
                      </button>
                      <button
                        className="vr-analyze-btn"
                        onClick={handleAnalyze}
                        disabled={isAnalyzing || !transcription.trim()}
                      >
                        {isAnalyzing ? (
                          <>
                            <svg className="vr-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"></circle>
                            </svg>
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M9 11l3 3L22 4"></path>
                              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                            </svg>
                            Analyze Transcription
                          </>
                        )}
                      </button>
                    </div>
                  </>
                ) : isTranscribing ? (
                  <div className="vr-note-empty vr-note-loading">
                    <img 
                      src={loadingSvg} 
                      alt="Transcribing..." 
                      className="vr-loading-animation"
                    />
                    <h2 className="vr-note-empty-title">Transcribing audio...</h2>
                    <p className="vr-note-empty-text">Please wait while we process your recording</p>
                  </div>
                ) : (
                  <div className="vr-note-empty">
                    <h2 className="vr-note-empty-title">No transcript available</h2>
                    <p className="vr-note-empty-text">Start transcribing to see the transcript here</p>
                  </div>
                )}
              </div>
            )}
            {activeTab === 'context' && (
              <div className="vr-context-area">
                <div className="vr-context-info">
                  <h3>Appointment Information</h3>
                  {selectedAppointment ? (
                    <div className="vr-context-details">
                      <div className="vr-context-item">
                        <span className="vr-context-label">Client:</span>
                        <span className="vr-context-value">{clientName}</span>
                      </div>
                      <div className="vr-context-item">
                        <span className="vr-context-label">Case Number:</span>
                        <span className="vr-context-value">
                          {appointments.find(apt => apt.id === selectedAppointment)?.caseNumber || 'N/A'}
                        </span>
                      </div>
                      <div className="vr-context-item">
                        <span className="vr-context-label">Date:</span>
                        <span className="vr-context-value">
                          {appointments.find(apt => apt.id === selectedAppointment)?.appointmentDate || 'N/A'}
                        </span>
                      </div>
                      <div className="vr-context-item">
                        <span className="vr-context-label">Time:</span>
                        <span className="vr-context-value">
                          {appointments.find(apt => apt.id === selectedAppointment)?.appointmentTime || 'N/A'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="vr-context-empty">Please select an appointment to view context</p>
                  )}
                </div>
                
                {/* AI Analysis Results */}
                {analysis && (
                  <div className="vr-analysis-section">
                    <h3>AI Analysis</h3>
                    <div className="vr-analysis-content">
                      {analysis.summary && (
                        <div className="vr-analysis-card">
                          <h4>Summary</h4>
                          <p>{analysis.summary}</p>
                        </div>
                      )}
                      
                      {analysis.keyPoints && analysis.keyPoints.length > 0 && (
                        <div className="vr-analysis-card">
                          <h4>Key Points</h4>
                          <ul>
                            {analysis.keyPoints.map((point, index) => (
                              <li key={index}>{point}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {analysis.clinicalNotes && (
                        <div className="vr-analysis-card">
                          <h4>Clinical Notes</h4>
                          <p>{analysis.clinicalNotes}</p>
                        </div>
                      )}
                      
                      {analysis.recommendations && analysis.recommendations.length > 0 && (
                        <div className="vr-analysis-card">
                          <h4>Recommendations</h4>
                          <ul>
                            {analysis.recommendations.map((rec, index) => (
                              <li key={index}>{rec}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {analysis.actionItems && analysis.actionItems.length > 0 && (
                        <div className="vr-analysis-card">
                          <h4>Action Items</h4>
                          <ul>
                            {analysis.actionItems.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modals and other components */}
        {/* Transcription Details Modal */}
        {showTranscriptionDetails && (transcription || analysis) && (
          <div className="voice-recording-details-modal-overlay" onClick={() => setShowTranscriptionDetails(false)}>
            <div className="voice-recording-details-modal" onClick={(e) => e.stopPropagation()}>
              <div className="voice-recording-details-modal-header">
                <h2>Transcription Details</h2>
                <button
                  className="voice-recording-details-modal-close"
                  onClick={() => setShowTranscriptionDetails(false)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <div className="voice-recording-details-modal-content">
                {transcription && (
                  <div className="voice-recording-details-section">
                    <h3>Transcription</h3>
                    <div className="voice-recording-details-transcription">
                      {transcription}
                    </div>
                  </div>
                )}
                {analysis && (
                  <div className="voice-recording-details-section">
                    <h3>Analysis</h3>
                    <div className="voice-recording-details-analysis">
                      {analysis.summary && (
                        <div className="voice-recording-details-analysis-item">
                          <h4>Summary</h4>
                          <p>{analysis.summary}</p>
                        </div>
                      )}
                      {analysis.keyPoints && analysis.keyPoints.length > 0 && (
                        <div className="voice-recording-details-analysis-item">
                          <h4>Key Points</h4>
                          <ul>
                            {analysis.keyPoints.map((point, index) => (
                              <li key={index}>{point}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {analysis.clinicalNotes && (
                        <div className="voice-recording-details-analysis-item">
                          <h4>Clinical Notes</h4>
                          <p>{analysis.clinicalNotes}</p>
                        </div>
                      )}
                      {analysis.recommendations && analysis.recommendations.length > 0 && (
                        <div className="voice-recording-details-analysis-item">
                          <h4>Recommendations</h4>
                          <ul>
                            {analysis.recommendations.map((rec, index) => (
                              <li key={index}>{rec}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {analysis.actionItems && analysis.actionItems.length > 0 && (
                        <div className="voice-recording-details-analysis-item">
                          <h4>Action Items</h4>
                          <ul>
                            {analysis.actionItems.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {clinicalNotes && (
                  <div className="voice-recording-details-section">
                    <h3>Clinical Notes</h3>
                    <div className="voice-recording-details-transcription">
                      {clinicalNotes}
                    </div>
                  </div>
                )}
              </div>
              <div className="voice-recording-details-modal-footer">
                <button
                  className="voice-recording-details-modal-btn"
                  onClick={() => setShowTranscriptionDetails(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Start Recording Confirmation Modal */}
        {showStartRecordingModal && (
          <div className="voice-recording-confirm-modal-overlay" onClick={() => setShowStartRecordingModal(false)}>
            <div className="voice-recording-confirm-modal" onClick={(e) => e.stopPropagation()}>
              <div className="voice-recording-confirm-modal-header">
                <div>
                  <h2 className="voice-recording-confirm-modal-title">Start Recording</h2>
                  <p className="voice-recording-confirm-modal-subtitle">Are you sure you want to start recording?</p>
                </div>
                <button 
                  className="voice-recording-confirm-modal-close"
                  onClick={() => setShowStartRecordingModal(false)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <div className="voice-recording-confirm-modal-body">
                <div className="voice-recording-confirm-modal-info">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <div>
                    <p><strong>Audio Source:</strong> {audioSource === 'microphone' ? 'Microphone Only' : audioSource === 'system' ? 'System Audio' : 'Both'}</p>
                    <p><strong>Client:</strong> {clientName || 'N/A'}</p>
                    <p><strong>Estimated Cost:</strong> ~$0.006 per minute</p>
                  </div>
                </div>
              </div>
              <div className="voice-recording-confirm-modal-footer">
                <button
                  className="voice-recording-confirm-modal-cancel-btn"
                  onClick={() => setShowStartRecordingModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="voice-recording-confirm-modal-confirm-btn"
                  onClick={confirmStartRecording}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                  </svg>
                  Start Recording
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Audio Source Selection Modal */}
        {showAudioSourceModal && (
          <div className="vr-audio-source-modal-overlay" onClick={() => setShowAudioSourceModal(false)}>
            <div className="vr-audio-source-modal" onClick={(e) => e.stopPropagation()}>
              <div className="vr-audio-source-modal-header">
                <h3>Select Audio Source</h3>
                <button 
                  className="vr-audio-source-modal-close"
                  onClick={() => setShowAudioSourceModal(false)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <div className="vr-audio-source-modal-body">
                <p className="vr-audio-source-modal-description">
                  Choose your audio source for recording
                </p>
                <div className="vr-audio-source-options">
                  <button
                    className={`vr-audio-source-option ${audioSource === 'microphone' ? 'active' : ''}`}
                    onClick={() => setAudioSource('microphone')}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                      <line x1="12" y1="19" x2="12" y2="23"></line>
                      <line x1="8" y1="23" x2="16" y2="23"></line>
                    </svg>
                    <div>
                      <div className="vr-audio-source-option-title">Microphone Only</div>
                      <div className="vr-audio-source-option-desc">Record your voice only</div>
                    </div>
                  </button>
                  <button
                    className={`vr-audio-source-option ${audioSource === 'system' ? 'active' : ''}`}
                    onClick={() => setAudioSource('system')}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
                      <line x1="6" y1="8" x2="18" y2="8"></line>
                      <line x1="6" y1="12" x2="18" y2="12"></line>
                      <line x1="6" y1="16" x2="12" y2="16"></line>
                    </svg>
                    <div>
                      <div className="vr-audio-source-option-title">System Audio</div>
                      <div className="vr-audio-source-option-desc">Record desktop/window audio (YouTube, etc.)</div>
                    </div>
                  </button>
                  <button
                    className={`vr-audio-source-option ${audioSource === 'both' ? 'active' : ''}`}
                    onClick={() => setAudioSource('both')}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                      <line x1="12" y1="19" x2="12" y2="23"></line>
                      <line x1="8" y1="23" x2="16" y2="23"></line>
                      <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
                    </svg>
                    <div>
                      <div className="vr-audio-source-option-title">Both</div>
                      <div className="vr-audio-source-option-desc">Record microphone and system audio</div>
                    </div>
                  </button>
                </div>
                {audioSource === 'system' || audioSource === 'both' ? (
                  <div className="vr-audio-source-info">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <span>When you start recording, select "Share tab audio" or "Share system audio" in the browser dialog to capture computer sounds.</span>
                  </div>
                ) : null}
              </div>
              <div className="vr-audio-source-modal-footer">
                <button
                  className="vr-audio-source-modal-cancel-btn"
                  onClick={() => setShowAudioSourceModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="vr-audio-source-modal-start-btn"
                  onClick={async () => {
                    setShowAudioSourceModal(false)
                    await startRecording()
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10"></circle>
                  </svg>
                  Start Recording
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Success Toast Notification */}
        {showSuccessToast && (
          <div className="voice-recording-success-toast">
            <div className="voice-recording-success-toast-content">
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
