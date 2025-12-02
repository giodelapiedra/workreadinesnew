import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient, isApiError, getApiErrorMessage } from '../lib/apiClient'
import { API_ROUTES } from '../config/apiRoutes'

export interface Notification {
  id: string
  type: string
  title: string
  message: string
  data?: {
    incident_id?: string
    case_number?: string
    worker_name?: string
    worker_email?: string
    worker_id?: string
    worker_profile_image_url?: string | null
    team_name?: string
    team_id?: string
    site_location?: string
    incident_type?: string
    supervisor_name?: string
    // For worker_not_fit_to_work notifications
    check_in_id?: string
    check_in_date?: string
    check_in_time?: string
    pain_level?: number
    fatigue_level?: number
    sleep_quality?: number
    stress_level?: number
    additional_notes?: string | null
    shift_start_time?: string | null
    shift_end_time?: string | null
    shift_type?: string
  }
  is_read: boolean
  created_at: string
  read_at: string | null
}

interface UseNotificationsOptions {
  limit?: number
  autoFetch?: boolean
  pollInterval?: number
}

interface UseNotificationsReturn {
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  error: string
  fetchNotifications: () => Promise<void>
  markAsRead: (notificationId: string) => Promise<void>
  markAllAsRead: () => Promise<void>
}

/**
 * Centralized notification hook for fetching and managing notifications
 * Supports WHS and Team Leader roles
 */
export function useNotifications(
  role: string | null | undefined,
  enabled: boolean = true,
  options: UseNotificationsOptions = {}
): UseNotificationsReturn {
  const { limit = 50, autoFetch = true, pollInterval = 30000 } = options

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const pollingIntervalRef = useRef<number | null>(null)
  const isFetchingRef = useRef(false)

  const fetchNotifications = useCallback(async () => {
    if (!role || !enabled) return
    
    // Prevent concurrent fetches
    if (isFetchingRef.current) return
    isFetchingRef.current = true

    try {
      setLoading(true)
      setError('')

      let endpoint = ''
      if (role === 'whs_control_center') {
        endpoint = `${API_ROUTES.WHS.BASE}/notifications?limit=${limit}`
      } else if (role === 'team_leader') {
        endpoint = `${API_ROUTES.TEAMS.BASE}/notifications?limit=${limit}`
      } else if (role === 'clinician') {
        endpoint = `${API_ROUTES.CLINICIAN.BASE}/notifications?limit=${limit}`
      } else if (role === 'worker') {
        endpoint = `${API_ROUTES.CHECKINS.BASE}/notifications?limit=${limit}`
      } else if (role === 'supervisor') {
        endpoint = `${API_ROUTES.SUPERVISOR.BASE}/notifications?limit=${limit}`
      } else {
        // Unknown role, skip fetch
        isFetchingRef.current = false
        return
      }

      const result = await apiClient.get<{
        notifications: Notification[]
        unreadCount: number
      }>(endpoint)

      if (isApiError(result)) {
        throw new Error(getApiErrorMessage(result) || 'Failed to fetch notifications')
      }

      const data = result.data
      setNotifications(data.notifications || [])
      setUnreadCount(data.unreadCount || 0)
    } catch (err: any) {
      setError(err.message || 'Failed to load notifications')
      console.error('Error fetching notifications:', err)
    } finally {
      setLoading(false)
      isFetchingRef.current = false
    }
  }, [role, enabled, limit])

  // Auto-fetch on mount and when role/enabled changes (but not fetchNotifications to avoid loops)
  useEffect(() => {
    if (autoFetch && enabled && role) {
      fetchNotifications()
    }
    // Only re-fetch when these specific dependencies change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, enabled, role, limit])

  // Polling effect (only if pollInterval > 0) - uses ref to avoid dependency issues
  useEffect(() => {
    // Clear any existing interval first
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }

    if (!autoFetch || !enabled || !role || pollInterval <= 0) {
      return
    }

    // Set up new polling interval
    pollingIntervalRef.current = window.setInterval(() => {
      if (role && enabled && !isFetchingRef.current) {
        fetchNotifications()
      }
    }, pollInterval)

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, enabled, role, pollInterval]) // Exclude fetchNotifications to prevent loop

  const markAsRead = useCallback(async (notificationId: string) => {
    if (!role || (role !== 'whs_control_center' && role !== 'team_leader' && role !== 'clinician' && role !== 'worker' && role !== 'supervisor')) return

    // Optimistic update - update UI immediately
    const notification = notifications.find(n => n.id === notificationId)
    if (!notification || notification.is_read) return // Already read or not found

    // Update UI immediately for better UX
    setNotifications(prev => prev.map(n => 
      n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
    ))
    setUnreadCount(prev => Math.max(0, prev - 1))

    try {
      let endpoint = ''
      if (role === 'whs_control_center') {
        endpoint = `${API_ROUTES.WHS.BASE}/notifications/${notificationId}/read`
      } else if (role === 'team_leader') {
        endpoint = `${API_ROUTES.TEAMS.BASE}/notifications/${notificationId}/read`
      } else if (role === 'clinician') {
        endpoint = `${API_ROUTES.CLINICIAN.BASE}/notifications/${notificationId}/read`
      } else if (role === 'worker') {
        endpoint = `${API_ROUTES.CHECKINS.BASE}/notifications/${notificationId}/read`
      } else if (role === 'supervisor') {
        endpoint = `${API_ROUTES.SUPERVISOR.BASE}/notifications/${notificationId}/read`
      } else {
        return
      }
      
      const result = await apiClient.patch<{ message: string }>(endpoint)

      if (isApiError(result)) {
        // Revert optimistic update if request failed
        setNotifications(prev => prev.map(n => 
          n.id === notificationId ? notification : n
        ))
        setUnreadCount(prev => prev + 1)
        throw new Error(getApiErrorMessage(result) || 'Failed to mark notification as read')
      }
    } catch (err) {
      console.error('Error marking notification as read:', err)
      // Revert optimistic update on error
      setNotifications(prev => prev.map(n => 
        n.id === notificationId ? notification : n
      ))
      setUnreadCount(prev => prev + 1)
    }
  }, [role, notifications])

  const markAllAsRead = useCallback(async () => {
    if (!role || (role !== 'whs_control_center' && role !== 'team_leader' && role !== 'clinician' && role !== 'worker' && role !== 'supervisor')) return

    // Optimistic update - update UI immediately
    const unreadNotifications = notifications.filter(n => !n.is_read)
    if (unreadNotifications.length === 0) return // No unread notifications

    const previousNotifications = [...notifications]
    const previousUnreadCount = unreadCount

    // Update UI immediately for better UX
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() })))
    setUnreadCount(0)

    try {
      let endpoint = ''
      if (role === 'whs_control_center') {
        endpoint = `${API_ROUTES.WHS.BASE}/notifications/read-all`
      } else if (role === 'team_leader') {
        endpoint = `${API_ROUTES.TEAMS.BASE}/notifications/read-all`
      } else if (role === 'clinician') {
        endpoint = `${API_ROUTES.CLINICIAN.BASE}/notifications/read-all`
      } else if (role === 'worker') {
        endpoint = `${API_ROUTES.CHECKINS.BASE}/notifications/read-all`
      } else if (role === 'supervisor') {
        endpoint = `${API_ROUTES.SUPERVISOR.BASE}/notifications/read-all`
      } else {
        return
      }
      
      const result = await apiClient.patch<{ message: string }>(endpoint)

      if (isApiError(result)) {
        // Revert optimistic update if request failed
        setNotifications(previousNotifications)
        setUnreadCount(previousUnreadCount)
        throw new Error(getApiErrorMessage(result) || 'Failed to mark all notifications as read')
      }
    } catch (err) {
      console.error('Error marking all as read:', err)
      // Revert optimistic update on error
      setNotifications(previousNotifications)
      setUnreadCount(previousUnreadCount)
    }
  }, [role, notifications, unreadCount])


  return {
    notifications,
    unreadCount,
    loading,
    error,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  }
}

