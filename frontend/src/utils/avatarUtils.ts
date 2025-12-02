/**
 * Get user initials from name or email
 */
export function getUserInitials(name: string | undefined | null, email: string | undefined | null): string {
  if (name) {
    const parts = name.trim().split(' ')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    }
    return name.substring(0, 2).toUpperCase()
  }
  if (email) {
    const parts = email.split('@')[0].split('.')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    }
    return email.substring(0, 2).toUpperCase()
  }
  return 'U'
}

/**
 * Get avatar color based on name/email
 */
export function getAvatarColor(name: string | undefined | null): string {
  if (!name) return '#6366F1'
  const colors = [
    '#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#F59E0B',
    '#10B981', '#06B6D4', '#3B82F6', '#F97316', '#84CC16'
  ]
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

/**
 * Extract worker name from notification data
 */
export function getWorkerNameFromNotification(notification: any): string | null {
  return notification.data?.worker_name || 
         notification.data?.workerName ||
         notification.message?.match(/Worker: ([^.]*)/)?.[1]?.trim() ||
         null
}

/**
 * Extract worker email from notification data
 */
export function getWorkerEmailFromNotification(notification: any): string | null {
  return notification.data?.worker_email || 
         notification.data?.workerEmail ||
         null
}

/**
 * Format user's full name from user object
 * @param user - User object with full_name, first_name, last_name, or email
 * @returns Formatted full name
 */
export function formatUserFullName(user: {
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}): string {
  if (user.full_name) return user.full_name
  if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name}`
  return user.email || 'Unknown'
}

