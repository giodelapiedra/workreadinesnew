/**
 * Notification Utilities
 * 
 * Provides utility functions for formatting data in notifications
 * Uses centralized formatUserFullName for consistency
 * 
 * @module utils/notificationUtils
 */

import { formatUserFullName } from './userUtils.js'
import { getAdminClient } from './adminClient.js'

/**
 * Format user data for inclusion in notification data
 * Uses centralized formatUserFullName utility for consistency
 * 
 * @param user - User object with id, email, first_name, last_name, full_name, profile_image_url
 * @returns Formatted user data object for notification
 */
export function formatUserDataForNotification(user: {
  id: string
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  profile_image_url?: string | null
}): {
  worker_id?: string
  worker_name?: string
  worker_email?: string
  worker_profile_image_url?: string | null
} {
  const workerName = formatUserFullName(user)

  return {
    worker_id: user.id,
    worker_name: workerName,
    worker_email: user.email || undefined,
    worker_profile_image_url: user.profile_image_url || null,
  }
}

/**
 * Send check-in notification to Team Leader
 * Centralized function to avoid duplication
 * 
 * @param params - Notification parameters
 */
export async function sendCheckInNotificationToTeamLeader(params: {
  teamLeaderId: string
  workerId: string
  workerName: string
  workerEmail: string
  teamId: string
  teamName: string
  checkInId: string
  checkInDate: string
  checkInTime: string
  painLevel: number
  fatigueLevel: number
  sleepQuality: number
  stressLevel: number
  additionalNotes: string | null
  predictedReadiness: 'Green' | 'Yellow' | 'Red'
  incidentId?: string
}) {
  const adminClient = getAdminClient()

  // Determine notification content based on readiness level
  let notificationTitle = '✅ Worker Check-In Submitted'
  let notificationMessage = ''
  let notificationType = 'worker_check_in'

  if (params.predictedReadiness === 'Green') {
    notificationMessage = `${params.workerName} has checked in and is ready to work (Green status).`
  } else if (params.predictedReadiness === 'Yellow') {
    notificationMessage = `${params.workerName} has checked in with minor concerns (Yellow status). Please monitor.`
  } else {
    notificationTitle = '⚠️ Check-In Requires Approval'
    notificationMessage = `${params.workerName} submitted a check-in indicating they are not fit to work (Red status). Please review and approve or reject.`
    notificationType = 'incident_pending_approval'
  }

  const notificationData: any = {
    check_in_id: params.checkInId,
    worker_id: params.workerId,
    worker_name: params.workerName,
    worker_email: params.workerEmail,
    team_id: params.teamId,
    team_name: params.teamName,
    check_in_date: params.checkInDate,
    check_in_time: params.checkInTime,
    pain_level: params.painLevel,
    fatigue_level: params.fatigueLevel,
    sleep_quality: params.sleepQuality,
    stress_level: params.stressLevel,
    additional_notes: params.additionalNotes,
    predicted_readiness: params.predictedReadiness,
  }

  // Add incident_id for Red status
  if (params.incidentId) {
    notificationData.incident_id = params.incidentId
  }

  const notification = {
    user_id: params.teamLeaderId,
    type: notificationType,
    title: notificationTitle,
    message: notificationMessage,
    data: notificationData,
    is_read: false,
  }

  const { error } = await adminClient
    .from('notifications')
    .insert([notification])

  if (error) {
    console.error('[sendCheckInNotificationToTeamLeader] Error creating notification:', error)
    throw new Error(`Failed to send notification: ${error.message}`)
  }

  console.log(`[sendCheckInNotificationToTeamLeader] Notification sent to team leader ${params.teamLeaderId} (${params.predictedReadiness} status)`)
}

