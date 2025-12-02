import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { PUBLIC_ROUTES, hasRouteAccess } from '../config/routes'
import { useNotifications } from '../hooks/useNotifications'
import { getUserInitials as getUserInitialsFromUtils, getAvatarColor, getWorkerNameFromNotification, getWorkerEmailFromNotification } from '../utils/avatarUtils'
import { getProfileImageUrl } from '../utils/imageUtils'
import { ROLES } from '../types/roles'
import type { UserRole } from '../types/roles'
import './TopNavbar.css'

interface TopNavbarProps {
  onToggleSidebar: () => void
  sidebarOpen: boolean
}

// Search menu items - same structure as Sidebar
interface SearchMenuItem {
  id: string
  label: string
  path: string
  roles: string[]
  group?: string
}

const SEARCH_MENU_ITEMS: SearchMenuItem[] = [
  { id: 'home', label: 'Home', path: '/dashboard', roles: [ROLES.WORKER, ROLES.SUPERVISOR, ROLES.TEAM_LEADER, ROLES.WHS_CONTROL_CENTER, ROLES.EXECUTIVE, ROLES.CLINICIAN], group: 'Overview' },
  { id: 'my-tasks', label: 'My Tasks', path: '/dashboard/worker', roles: [ROLES.WORKER], group: 'Overview' },
  { id: 'worker-calendar', label: 'My Schedule', path: '/dashboard/worker/calendar', roles: [ROLES.WORKER], group: 'Schedule' },
  { id: 'worker-appointments', label: 'Appointments', path: '/dashboard/worker/appointments', roles: [ROLES.WORKER], group: 'Schedule' },
  { id: 'check-in-records', label: 'Check-In Records', path: '/dashboard/worker/check-in-records', roles: [ROLES.WORKER], group: 'Records' },
  { id: 'my-accidents', label: 'My Accidents', path: '/dashboard/worker/my-accidents', roles: [ROLES.WORKER], group: 'Records' },
  { id: 'report-incident', label: 'Report Incident', path: '/dashboard/worker/report-incident', roles: [ROLES.WORKER], group: 'Actions' },
  { id: 'team-dashboard', label: 'Team Dashboard', path: '/dashboard/team-leader', roles: [ROLES.TEAM_LEADER], group: 'Overview' },
  { id: 'team-members', label: 'Team Members', path: '/dashboard/team-leader/team-members', roles: [ROLES.TEAM_LEADER], group: 'Team Management' },
  { id: 'worker-schedules', label: 'Worker Schedules', path: '/dashboard/team-leader/worker-schedules', roles: [ROLES.TEAM_LEADER], group: 'Team Management' },
  { id: 'worker-readiness', label: 'Worker Readiness', path: '/dashboard/team-leader/readiness', roles: [ROLES.TEAM_LEADER], group: 'Analytics' },
  { id: 'check-in-analytics', label: 'Check-In Analytics', path: '/dashboard/team-leader/analytics', roles: [ROLES.TEAM_LEADER], group: 'Analytics' },
  { id: 'team-leader-calendar', label: 'Worker Schedules Calendar', path: '/dashboard/team-leader/calendar', roles: [ROLES.TEAM_LEADER], group: 'Views' },
  { id: 'team-leader-logs', label: 'Activity Logs', path: '/dashboard/team-leader/logs', roles: [ROLES.TEAM_LEADER], group: 'Logs' },
  { id: 'supervisor-dashboard', label: 'Supervisor Dashboard', path: '/dashboard/supervisor', roles: [ROLES.SUPERVISOR], group: 'Overview' },
  { id: 'manage-team', label: 'Manage Team', path: '/dashboard/supervisor/teams', roles: [ROLES.SUPERVISOR], group: 'Team Management' },
  { id: 'incident-management', label: 'Incident Management', path: '/dashboard/supervisor/incidents', roles: [ROLES.SUPERVISOR], group: 'Incidents' },
  { id: 'my-incidents', label: 'My Submitted Incidents', path: '/dashboard/supervisor/my-incidents', roles: [ROLES.SUPERVISOR], group: 'Incidents' },
  { id: 'supervisor-analytics', label: 'Analytics', path: '/dashboard/supervisor/analytics', roles: [ROLES.SUPERVISOR], group: 'Analytics' },
  { id: 'whs-dashboard', label: 'WHS Dashboard', path: '/dashboard/whs-control-center', roles: [ROLES.WHS_CONTROL_CENTER], group: 'Overview' },
  { id: 'whs-record-cases', label: 'Record Cases', path: '/dashboard/whs-control-center/record-cases', roles: [ROLES.WHS_CONTROL_CENTER], group: 'Cases' },
  { id: 'whs-analytics', label: 'Analytics', path: '/dashboard/whs-control-center/analytics', roles: [ROLES.WHS_CONTROL_CENTER], group: 'Analytics' },
  { id: 'executive-dashboard', label: 'Executive Dashboard', path: '/dashboard/executive', roles: [ROLES.EXECUTIVE], group: 'Overview' },
  { id: 'executive-safety-engagement', label: 'Overall Safety Engagement', path: '/dashboard/executive/safety-engagement', roles: [ROLES.EXECUTIVE], group: 'Overview' },
  { id: 'executive-hierarchy', label: 'Organization Hierarchy', path: '/dashboard/executive/hierarchy', roles: [ROLES.EXECUTIVE], group: 'Overview' },
  { id: 'clinician-dashboard', label: 'Clinician Dashboard', path: '/dashboard/clinician', roles: [ROLES.CLINICIAN], group: 'Overview' },
  { id: 'clinician-tasks', label: 'My Tasks', path: '/dashboard/clinician/tasks', roles: [ROLES.CLINICIAN], group: 'Work Management' },
  { id: 'clinician-my-cases', label: 'My Cases', path: '/dashboard/clinician/my-cases', roles: [ROLES.CLINICIAN], group: 'Work Management' },
  { id: 'clinician-appointments', label: 'Appointments', path: '/dashboard/clinician/appointments', roles: [ROLES.CLINICIAN], group: 'Work Management' },
  { id: 'clinician-voice-recording', label: 'Clinician Transcription', path: '/dashboard/clinician/voice-recording', roles: [ROLES.CLINICIAN], group: 'Documentation' },
  { id: 'clinician-clinical-notes', label: 'Clinical Notes', path: '/dashboard/clinician/clinical-notes', roles: [ROLES.CLINICIAN], group: 'Documentation' },
  { id: 'clinician-calendar', label: 'Calendar', path: '/dashboard/clinician/calendar', roles: [ROLES.CLINICIAN], group: 'Views' },
  { id: 'clinician-analytics', label: 'Analytics', path: '/dashboard/clinician/analytics', roles: [ROLES.CLINICIAN], group: 'Views' },
  { id: 'admin-dashboard', label: 'Admin Dashboard', path: '/dashboard/admin', roles: [ROLES.ADMIN], group: 'Overview' },
  { id: 'admin-manage-members', label: 'Manage Members', path: '/dashboard/admin/users', roles: [ROLES.ADMIN], group: 'User Management' },
  { id: 'admin-team-view', label: 'Team View', path: '/dashboard/admin/team-view', roles: [ROLES.ADMIN], group: 'User Management' },
  { id: 'admin-clinician-view', label: 'Clinician View', path: '/dashboard/admin/clinician-view', roles: [ROLES.ADMIN], group: 'User Management' },
  { id: 'admin-analytics', label: 'Analytics', path: '/dashboard/admin/analytics', roles: [ROLES.ADMIN], group: 'Analytics' },
  { id: 'profile', label: 'Profile', path: '/dashboard/profile', roles: [ROLES.WORKER, ROLES.SUPERVISOR, ROLES.TEAM_LEADER, ROLES.WHS_CONTROL_CENTER, ROLES.EXECUTIVE, ROLES.CLINICIAN, ROLES.ADMIN], group: 'Settings' },
  { id: 'notifications', label: 'Notifications', path: '/dashboard/notifications', roles: [ROLES.TEAM_LEADER, ROLES.WHS_CONTROL_CENTER, ROLES.CLINICIAN, ROLES.WORKER, ROLES.SUPERVISOR, ROLES.ADMIN], group: 'Settings' },
]

export function TopNavbar({ onToggleSidebar, sidebarOpen }: TopNavbarProps) {
  const { user, signOut, first_name, last_name, full_name, role, profile_image_url } = useAuth()
  const navigate = useNavigate()
  
  // Memoize profile image URL to prevent unnecessary recalculations and flicker
  const profileImageUrl = useMemo(() => {
    return getProfileImageUrl(profile_image_url, user?.id)
  }, [profile_image_url, user?.id])
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const notificationRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Use centralized notifications hook
  // Enable for WHS Control Center, Team Leaders, Clinicians, Workers, and Supervisors
  const notificationsEnabled = role === 'whs_control_center' || role === 'team_leader' || role === 'clinician' || role === 'worker' || role === 'supervisor'
  const {
    notifications,
    unreadCount,
    loading: notificationsLoading,
    fetchNotifications,
    markAsRead: markNotificationAsRead,
    markAllAsRead,
  } = useNotifications(role, notificationsEnabled, { limit: 50, pollInterval: 30000 })

  // Get searchable menu items for current role with access validation
  const searchableItems = useMemo(() => {
    if (!role) return []
    return SEARCH_MENU_ITEMS.filter(item => {
      // First check if role is in allowed roles
      if (!item.roles.includes(role)) return false
      // Double-check with route access control for security
      return hasRouteAccess(item.path, role as UserRole)
    })
  }, [role])

  // Filter search results - optimized with early returns
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return searchableItems.slice(0, 8) // Show top 8 items when no query
    
    const query = searchQuery.toLowerCase().trim()
    const results: typeof searchableItems = []
    
    // Early exit if query is too short or no items
    if (query.length < 1 || searchableItems.length === 0) return results
    
    // Optimized filtering with early break
    for (const item of searchableItems) {
      if (results.length >= 10) break // Limit to 10 results
      
      const labelMatch = item.label.toLowerCase().includes(query)
      const pathMatch = item.path.toLowerCase().includes(query)
      const groupMatch = item.group?.toLowerCase().includes(query) ?? false
      
      if (labelMatch || pathMatch || groupMatch) {
        results.push(item)
      }
    }
    
    return results
  }, [searchQuery, searchableItems])

  // Reset selected index when search results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchResults])

  // Secure navigation handler with access validation
  const handleSecureNavigation = useCallback((path: string) => {
    if (!role) {
      console.warn('[TopNavbar] Cannot navigate: role not loaded')
      return false
    }
    
    // Security check: Validate route access before navigation
    if (!hasRouteAccess(path, role as UserRole)) {
      console.error(
        `[TopNavbar] SECURITY: Navigation denied! User with role '${role}' ` +
        `attempted to navigate to '${path}' without access.`
      )
      return false
    }
    
    navigate(path)
    return true
  }, [navigate, role])

  // Keyboard shortcut handler (Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault()
        setShowSearch(true)
        setTimeout(() => {
          searchInputRef.current?.focus()
        }, 100)
      }
      if (event.key === 'Escape' && showSearch) {
        setShowSearch(false)
        setSearchQuery('')
      }
      if (showSearch && searchResults.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedIndex(prev => (prev + 1) % searchResults.length)
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedIndex(prev => (prev - 1 + searchResults.length) % searchResults.length)
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const selectedItem = searchResults[selectedIndex]
          if (selectedItem) {
            if (handleSecureNavigation(selectedItem.path)) {
              setShowSearch(false)
              setSearchQuery('')
            }
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showSearch, searchResults, selectedIndex, handleSecureNavigation])

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false)
      }
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false)
      }
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearch(false)
        setSearchQuery('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const getUserInitials = () => {
    if (first_name && last_name) {
      return `${first_name[0]}${last_name[0]}`.toUpperCase()
    }
    if (first_name) {
      return first_name[0].toUpperCase()
    }
    if (user?.email) {
      const parts = user.email.split('@')[0].split('.')
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      }
      return user.email[0].toUpperCase()
    }
    return 'U'
  }

  const getUserDisplayName = () => {
    return full_name || (first_name && last_name ? `${first_name} ${last_name}` : null) || first_name || user?.email?.split('@')[0] || 'User'
  }

  const handleSignOut = async () => {
    await signOut()
    navigate(PUBLIC_ROUTES.LOGIN)
  }

  return (
    <nav className={`top-navbar ${!sidebarOpen ? 'expanded' : ''}`}>
      <div className="top-navbar-left">
        {/* Sidebar Toggle Button */}
        <button 
          className="navbar-menu-toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {sidebarOpen ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </>
            ) : (
              <>
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </>
            )}
          </svg>
        </button>
        
        <div className="navbar-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
          </svg>
          <span className="navbar-brand">WorkReadiness</span>
        </div>
      </div>

      <div className="top-navbar-center">
        <div className="navbar-search" ref={searchRef}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="M21 21l-4.35-4.35"></path>
          </svg>
          <input 
            ref={searchInputRef}
            type="text" 
            placeholder="Search (Ctrl + K)" 
            className="navbar-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setShowSearch(true)}
            onClick={() => setShowSearch(true)}
          />
          {showSearch && (
            <div className="navbar-search-dropdown">
              {searchResults.length === 0 ? (
                <div className="navbar-search-empty">
                  <p>No results found</p>
                </div>
              ) : (
                <div className="navbar-search-results">
                  {searchResults.map((item, index) => (
                    <div
                      key={item.id}
                      className={`navbar-search-item ${index === selectedIndex ? 'selected' : ''}`}
                      onClick={() => {
                        if (handleSecureNavigation(item.path)) {
                          setShowSearch(false)
                          setSearchQuery('')
                        }
                      }}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <div className="navbar-search-item-label">{item.label}</div>
                      {item.group && (
                        <div className="navbar-search-item-group">{item.group}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {searchQuery.trim() && (
                <div className="navbar-search-footer">
                  <span>Press <kbd>Enter</kbd> to select, <kbd>Esc</kbd> to close</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="top-navbar-right">
        {/* Notifications */}
        {(role === 'whs_control_center' || role === 'team_leader' || role === 'clinician' || role === 'worker' || role === 'supervisor') && (
          <div className="navbar-notification-wrapper" ref={notificationRef}>
            <button 
              className="navbar-icon-btn navbar-notification-btn" 
              aria-label="Notifications"
              onClick={() => {
                setShowNotifications(!showNotifications)
                if (!showNotifications && notificationsEnabled) {
                  fetchNotifications()
                }
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
              {unreadCount > 0 && (
                <span className="navbar-notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>

            {showNotifications && (
              <div className="navbar-notifications-dropdown">
                <div className="navbar-notifications-header">
                  <h3>Notifications</h3>
                  <div className="navbar-notifications-header-actions">
                    {unreadCount > 0 && (
                      <button 
                        className="navbar-mark-all-read-btn"
                        onClick={markAllAsRead}
                      >
                        Mark all as read
                      </button>
                    )}
                    <button 
                      className="navbar-view-all-btn"
                      onClick={() => {
                        if (handleSecureNavigation('/dashboard/notifications')) {
                        setShowNotifications(false)
                        }
                      }}
                    >
                      View all
                    </button>
                  </div>
                </div>
                <div className="navbar-notifications-list">
                  {notificationsLoading ? (
                    <div className="navbar-notifications-loading">
                      <p>Loading notifications...</p>
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="navbar-notifications-empty">
                      <p>No notifications</p>
                    </div>
                  ) : (
                    notifications.map((notification) => {
                      // Get worker name and email for avatar
                      const workerName = getWorkerNameFromNotification(notification)
                      const workerEmail = getWorkerEmailFromNotification(notification)
                      
                      // Get user initials and color for avatar
                      const userInitials = getUserInitialsFromUtils(workerName, workerEmail)
                      const avatarColor = getAvatarColor(workerName || workerEmail)

                      return (
                      <div
                        key={notification.id}
                        className={`navbar-notification-item ${!notification.is_read ? 'unread' : ''}`}
                        onClick={() => {
                          if (!notification.is_read) {
                            markNotificationAsRead(notification.id)
                          }
                          // Navigate to relevant page based on notification type with security validation
                          let targetPath = '/dashboard/notifications' // Default fallback
                          
                          if (notification.type === 'incident_assigned') {
                            targetPath = '/dashboard/whs-control-center'
                          } else if (notification.type === 'case_assigned_to_clinician') {
                            targetPath = '/dashboard/clinician'
                          } else if (notification.type === 'case_closed') {
                            targetPath = role === 'supervisor' ? '/dashboard/supervisor' : '/dashboard/notifications'
                          } else if (notification.type === 'worker_not_fit_to_work') {
                            targetPath = '/dashboard/notifications'
                          } else if ((notification.data as any)?.appointment_id && role === 'worker') {
                            targetPath = '/dashboard/worker/appointments'
                          }
                          
                          // Secure navigation with access validation
                          if (handleSecureNavigation(targetPath)) {
                            setShowNotifications(false)
                          }
                        }}
                      >
                        <div className="navbar-notification-avatar" style={{ backgroundColor: avatarColor }}>
                          {userInitials}
                        </div>
                        <div className="navbar-notification-content">
                          <div className="navbar-notification-title">{notification.title}</div>
                          <div className="navbar-notification-message">{notification.message}</div>
                          {notification.data?.case_number && (
                            <div className="navbar-notification-case">
                              Case: <strong>{notification.data.case_number}</strong>
                            </div>
                          )}
                          {notification.data?.worker_name && notification.type === 'worker_not_fit_to_work' && (
                            <div className="navbar-notification-case" style={{ color: '#ef4444' }}>
                              Worker: <strong>{notification.data.worker_name}</strong>
                            </div>
                          )}
                          <div className="navbar-notification-time">
                            {new Date(notification.created_at).toLocaleString()}
                          </div>
                        </div>
                        {!notification.is_read && (
                          <div className="navbar-notification-dot"></div>
                        )}
                      </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Calendar */}
        <button className="navbar-icon-btn" aria-label="Calendar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </button>

        {/* Profile Menu */}
        <div className="navbar-profile" ref={menuRef}>
          <button 
            className="navbar-profile-btn"
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            aria-label="User menu"
          >
            <div className="navbar-profile-avatar">
              {profileImageUrl ? (
                <img 
                  src={profileImageUrl} 
                  alt="Profile" 
                  className="navbar-profile-avatar-img"
                  loading="eager"
                  decoding="sync"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.style.display = 'none'
                    const parent = target.parentElement
                    if (parent) {
                      parent.textContent = getUserInitials()
                    }
                  }}
                />
              ) : (
                getUserInitials()
              )}
            </div>
            <svg 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
              className={`navbar-profile-chevron ${showProfileMenu ? 'open' : ''}`}
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>

          {showProfileMenu && (
            <div className="navbar-profile-menu">
              <div className="navbar-profile-menu-header">
                <div className="navbar-profile-menu-avatar">
                  {profileImageUrl ? (
                    <img 
                      src={profileImageUrl} 
                      alt="Profile" 
                      className="navbar-profile-menu-avatar-img"
                      loading="eager"
                      decoding="sync"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                        const parent = target.parentElement
                        if (parent) {
                          parent.textContent = getUserInitials()
                        }
                      }}
                    />
                  ) : (
                    getUserInitials()
                  )}
                </div>
                <div className="navbar-profile-menu-info">
                  <div className="navbar-profile-menu-name">
                    {getUserDisplayName()}
                  </div>
                  <div className="navbar-profile-menu-email">
                    {user?.email || 'No email'}
                  </div>
                  <div className="navbar-profile-menu-role">
                    {role?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'User'}
                  </div>
                </div>
              </div>

              <div className="navbar-profile-menu-divider"></div>

              <div className="navbar-profile-menu-items">
                <button 
                  className="navbar-profile-menu-item"
                  onClick={() => {
                    setShowProfileMenu(false)
                    handleSecureNavigation('/dashboard/profile')
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                  <span>Profile</span>
                </button>

                <div className="navbar-profile-menu-divider"></div>

                <button 
                  className="navbar-profile-menu-item navbar-profile-menu-item-danger"
                  onClick={handleSignOut}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                  <span>Logout</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}

