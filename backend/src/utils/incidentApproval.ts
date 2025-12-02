/**
 * Centralized Incident Approval Utilities
 * 
 * Provides reusable, pure functions for incident approval workflow
 * Ensures consistency, proper validation, and audit trail
 * 
 * @module utils/incidentApproval
 */

import { getAdminClient } from './adminClient.js'
import { formatUserDataForNotification } from './notificationUtils.js'

/**
 * Approval status types
 */
export type ApprovalStatus = 'pending_approval' | 'approved' | 'rejected' | 'auto_approved'

/**
 * Incident data for creation
 */
export interface CreateIncidentData {
  userId: string
  teamId: string
  incidentType: string
  incidentDate: string
  description: string
  severity: string
  location?: string
  photoUrl?: string | null
  aiAnalysis?: any
}

/**
 * Create incident with pending approval status
 * Does NOT create exception - waits for Team Leader approval
 * 
 * @param data - Incident data
 * @returns Created incident
 */
export async function createPendingIncident(data: CreateIncidentData) {
  const adminClient = getAdminClient()

  // Prepare incident data - only include fields that exist in database
  const incidentData: any = {
    user_id: data.userId,
    team_id: data.teamId,
    incident_type: data.incidentType,
    incident_date: data.incidentDate,
    description: data.description,
    severity: data.severity,
    photo_url: data.photoUrl || null,
    approval_status: 'pending_approval' as ApprovalStatus,
  }

  // Only include ai_analysis_result if it's provided and valid
  if (data.aiAnalysis) {
    // Store as JSON string if it's an object
    if (typeof data.aiAnalysis === 'object') {
      incidentData.ai_analysis_result = JSON.stringify(data.aiAnalysis)
    } else {
      incidentData.ai_analysis_result = data.aiAnalysis
    }
  } else {
    incidentData.ai_analysis_result = null
  }

  const { data: incident, error } = await adminClient
    .from('incidents')
    .insert([incidentData])
    .select()
    .single()

  if (error) {
    console.error('[createPendingIncident] Database error:', error)
    console.error('[createPendingIncident] Incident data attempted:', incidentData)
    throw new Error(`Failed to create incident: ${error.message}`)
  }

  if (!incident) {
    throw new Error('Failed to create incident: No data returned from database')
  }

  return incident
}

/**
 * Get pending incidents for a team
 * 
 * @param teamId - Team ID
 * @returns Array of pending incidents with worker details
 */
export async function getPendingIncidentsForTeam(teamId: string) {
  const adminClient = getAdminClient()

  const { data: incidents, error } = await adminClient
    .from('incidents')
    .select(`
      *,
      users!incidents_user_id_fkey(
        id, email, first_name, last_name, full_name,
        gender, date_of_birth, profile_image_url
      )
    `)
    .eq('team_id', teamId)
    .eq('approval_status', 'pending_approval')
    .order('incident_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch pending incidents: ${error.message}`)
  }

  return incidents || []
}

/**
 * Approve incident and create exception
 * 
 * @param params - Approval parameters
 * @returns Created exception and updated incident
 */
export async function approveIncident(params: {
  incidentId: string
  approvedBy: string
  notes?: string
}) {
  const adminClient = getAdminClient()

  // 1. Get incident with team info
  const { data: incident, error: fetchError } = await adminClient
    .from('incidents')
    .select('*, teams!inner(team_leader_id, supervisor_id)')
    .eq('id', params.incidentId)
    .single()

  if (fetchError || !incident) {
    throw new Error('Incident not found')
  }

  if (incident.approval_status !== 'pending_approval') {
    throw new Error(`Incident already processed (status: ${incident.approval_status})`)
  }

  // 2. Update incident status
  const { error: updateError } = await adminClient
    .from('incidents')
    .update({
      approval_status: 'approved' as ApprovalStatus,
      approved_by: params.approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq('id', params.incidentId)

  if (updateError) {
    throw new Error(`Failed to update incident: ${updateError.message}`)
  }

  // 3. Create exception
  const exceptionType = incident.incident_type === 'incident' ? 'accident' : 'other'

  const { data: exception, error: exceptionError } = await adminClient
    .from('worker_exceptions')
    .insert({
      user_id: incident.user_id,
      team_id: incident.team_id,
      exception_type: exceptionType,
      reason: `Approved incident: ${incident.description}`,
      start_date: incident.incident_date,
      end_date: null,
      is_active: true,
      created_by: params.approvedBy,
      notes: params.notes || null,
    })
    .select()
    .single()

  if (exceptionError) {
    throw new Error(`Failed to create exception: ${exceptionError.message}`)
  }

  // 4. Deactivate worker schedules
  try {
    const { error: deactivateError } = await adminClient
      .from('worker_schedules')
      .update({ is_active: false })
      .eq('worker_id', incident.user_id)
      .eq('is_active', true)

    if (deactivateError) {
      console.error('[approveIncident] Error deactivating schedules:', deactivateError)
      // Don't fail the approval if schedule deactivation fails
    }
  } catch (scheduleError: any) {
    console.error('[approveIncident] Error in schedule deactivation:', scheduleError)
    // Continue with approval
  }

  return { incident, exception }
}

/**
 * Reject incident (no exception created)
 * 
 * @param params - Rejection parameters
 * @returns true if successful
 */
export async function rejectIncident(params: {
  incidentId: string
  rejectedBy: string
  rejectionReason: string
}) {
  const adminClient = getAdminClient()

  if (!params.rejectionReason || params.rejectionReason.trim().length === 0) {
    throw new Error('Rejection reason is required')
  }

  // Get incident to verify status
  const { data: incident, error: fetchError } = await adminClient
    .from('incidents')
    .select('approval_status')
    .eq('id', params.incidentId)
    .single()

  if (fetchError || !incident) {
    throw new Error('Incident not found')
  }

  if (incident.approval_status !== 'pending_approval') {
    throw new Error(`Incident already processed (status: ${incident.approval_status})`)
  }

  // Update incident status
  const { error } = await adminClient
    .from('incidents')
    .update({
      approval_status: 'rejected' as ApprovalStatus,
      approved_by: params.rejectedBy,
      approved_at: new Date().toISOString(),
      rejection_reason: params.rejectionReason,
    })
    .eq('id', params.incidentId)

  if (error) {
    throw new Error(`Failed to reject incident: ${error.message}`)
  }

  return true
}

/**
 * Send notifications for pending incident (to Team Leader)
 * 
 * @param params - Notification parameters
 */
export async function notifyTeamLeaderPendingIncident(params: {
  teamLeaderId: string
  incidentId: string
  workerId: string
  workerName: string
  workerEmail: string
  workerProfileImageUrl?: string | null
  incidentType: string
  severity: string
  location?: string
}) {
  const adminClient = getAdminClient()

  const formattedUserData = formatUserDataForNotification({
    id: params.workerId,
    email: params.workerEmail,
    first_name: '',
    last_name: '',
    full_name: params.workerName,
    profile_image_url: params.workerProfileImageUrl || null,
  })

  console.log('[notifyTeamLeaderPendingIncident] Sending notification:', {
    teamLeaderId: params.teamLeaderId,
    incidentId: params.incidentId,
    workerId: params.workerId,
    workerName: params.workerName,
  })

  const { data, error } = await adminClient.from('notifications').insert({
    user_id: params.teamLeaderId,
    type: 'incident_approval_needed',
    title: 'Incident Approval Required',
    message: `${params.workerName} (Worker) reported ${params.incidentType === 'incident' ? 'an incident' : 'a near-miss'} with ${params.severity.toUpperCase()} severity${params.location ? ` at ${params.location}` : ''}. Please review and approve.`,
    data: {
      incident_id: params.incidentId,
      ...formattedUserData,
      incident_type: params.incidentType,
      severity: params.severity,
      location: params.location,
      reported_by: 'worker',
    },
    is_read: false,
  })

  if (error) {
    console.error('[notifyTeamLeaderPendingIncident] Error inserting notification:', error)
    throw new Error(`Failed to send notification to Team Leader: ${error.message}`)
  }

  console.log('[notifyTeamLeaderPendingIncident] Notification sent successfully:', data)
}

/**
 * Send notifications after approval
 * 
 * @param params - Notification parameters
 */
export async function notifyIncidentApproved(params: {
  workerId: string
  supervisorId: string | null
  incidentId: string
  exceptionId: string
  workerName: string
  teamLeaderName: string
}) {
  const adminClient = getAdminClient()

  const notifications: any[] = []

  // Notify worker
  notifications.push({
    user_id: params.workerId,
    type: 'incident_approved',
    title: 'Incident Report Approved',
    message: `Your incident report has been approved by ${params.teamLeaderName} (Team Leader). An exception has been created and you've been placed on medical leave.`,
    data: {
      incident_id: params.incidentId,
      exception_id: params.exceptionId,
      team_leader_name: params.teamLeaderName,
      approved_by: 'team_leader',
    },
    is_read: false,
  })

  // Notify supervisor if exists
  if (params.supervisorId) {
    notifications.push({
      user_id: params.supervisorId,
      type: 'system',
      title: 'New Exception Created',
      message: `${params.teamLeaderName} (Team Leader) approved incident report for ${params.workerName}. An exception has been created.`,
      data: {
        incident_id: params.incidentId,
        exception_id: params.exceptionId,
        worker_id: params.workerId,
        worker_name: params.workerName,
        team_leader_name: params.teamLeaderName,
        approved_by: 'team_leader',
      },
      is_read: false,
    })
  }

  console.log('[notifyIncidentApproved] Sending notifications:', {
    workerId: params.workerId,
    supervisorId: params.supervisorId,
    count: notifications.length,
  })

  const { data, error } = await adminClient.from('notifications').insert(notifications)
  
  if (error) {
    console.error('[notifyIncidentApproved] Error inserting notifications:', error)
    throw new Error(`Failed to send notifications: ${error.message}`)
  }

  console.log('[notifyIncidentApproved] Notifications sent successfully:', data)
}

/**
 * Send notification after rejection
 * 
 * @param params - Notification parameters
 */
export async function notifyIncidentRejected(params: {
  workerId: string
  incidentId: string
  rejectionReason: string
  teamLeaderName: string
}) {
  const adminClient = getAdminClient()

  console.log('[notifyIncidentRejected] Sending notification:', {
    workerId: params.workerId,
    incidentId: params.incidentId,
  })

  const { data, error } = await adminClient.from('notifications').insert({
    user_id: params.workerId,
    type: 'incident_rejected',
    title: 'Incident Report Rejected',
    message: `Your incident report was rejected by ${params.teamLeaderName} (Team Leader). Reason: ${params.rejectionReason}`,
    data: {
      incident_id: params.incidentId,
      rejection_reason: params.rejectionReason,
      team_leader_name: params.teamLeaderName,
      rejected_by: 'team_leader',
    },
    is_read: false,
  })

  if (error) {
    console.error('[notifyIncidentRejected] Error inserting notification:', error)
    throw new Error(`Failed to send notification: ${error.message}`)
  }

  console.log('[notifyIncidentRejected] Notification sent successfully:', data)
}

