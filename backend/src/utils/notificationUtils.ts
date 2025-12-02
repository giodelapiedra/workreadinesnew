/**
 * Notification Utilities
 * 
 * Provides utility functions for formatting data in notifications
 * 
 * @module utils/notificationUtils
 */

/**
 * Format user data for inclusion in notification data
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
  const workerName = user.full_name || 
                    (user.first_name && user.last_name 
                      ? `${user.first_name} ${user.last_name}`
                      : user.email || 'Unknown')

  return {
    worker_id: user.id,
    worker_name: workerName,
    worker_email: user.email || undefined,
    worker_profile_image_url: user.profile_image_url || null,
  }
}

