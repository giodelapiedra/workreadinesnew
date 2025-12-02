/**
 * Avatar Component
 * Centralized, reusable avatar component with automatic profile image support
 * Displays profile image or initials fallback
 */

import { useMemo } from 'react'
import { getProfileImageUrl } from '../utils/imageUtils'
import { getUserInitials } from '../utils/avatarUtils'
import './Avatar.css'

export interface AvatarProps {
  // User data
  userId?: string | null
  profileImageUrl?: string | null
  firstName?: string | null
  lastName?: string | null
  fullName?: string | null
  email?: string | null
  
  // Styling
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'circle' | 'square' | 'rounded'
  className?: string
  
  // Behavior
  showTooltip?: boolean
  onClick?: () => void
  loading?: 'lazy' | 'eager'
}

/**
 * Avatar Component - Centralized avatar display
 * 
 * Features:
 * - Automatic profile image loading
 * - Initials fallback
 * - Smart caching (timestamp-based)
 * - Multiple sizes
 * - Customizable styling
 * - Error handling with fallback
 * 
 * @example
 * <Avatar 
 *   userId={user.id}
 *   profileImageUrl={user.profile_image_url}
 *   firstName={user.first_name}
 *   lastName={user.last_name}
 *   size="md"
 * />
 */
export function Avatar({
  userId,
  profileImageUrl,
  firstName,
  lastName,
  fullName,
  email,
  size = 'md',
  variant = 'circle',
  className = '',
  showTooltip = false,
  onClick,
  loading = 'lazy',
}: AvatarProps) {
  
  // Get display name for tooltip
  const displayName = useMemo(() => {
    if (fullName) return fullName
    if (firstName && lastName) return `${firstName} ${lastName}`
    if (firstName) return firstName
    if (email) return email
    return 'User'
  }, [fullName, firstName, lastName, email])
  
  // Get initials for fallback
  const initials = useMemo(() => {
    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase()
    }
    if (fullName) {
      const parts = fullName.trim().split(' ')
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      }
      return fullName.substring(0, 2).toUpperCase()
    }
    if (email) {
      return getUserInitials(null, email)
    }
    return 'U'
  }, [firstName, lastName, fullName, email])
  
  // Get optimized image URL with cache busting
  const imageUrl = useMemo(() => {
    if (!profileImageUrl || !userId) return null
    return getProfileImageUrl(profileImageUrl, userId)
  }, [profileImageUrl, userId])
  
  // Handle image load error - fallback to initials
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.target as HTMLImageElement
    target.style.display = 'none'
    const parent = target.parentElement
    if (parent) {
      const fallback = document.createElement('div')
      fallback.className = 'avatar-fallback'
      fallback.textContent = initials
      parent.appendChild(fallback)
    }
  }
  
  // Build class names
  const avatarClasses = [
    'avatar',
    `avatar-${size}`,
    `avatar-${variant}`,
    onClick ? 'avatar-clickable' : '',
    className
  ].filter(Boolean).join(' ')
  
  return (
    <div 
      className={avatarClasses}
      onClick={onClick}
      title={showTooltip ? displayName : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={displayName}
          className="avatar-img"
          loading={loading === 'eager' ? 'eager' : 'lazy'}
          decoding={loading === 'eager' ? 'sync' : 'async'}
          onError={handleImageError}
        />
      ) : (
        <div className="avatar-fallback">
          {initials}
        </div>
      )}
    </div>
  )
}

/**
 * AvatarGroup Component - Display multiple avatars
 * 
 * @example
 * <AvatarGroup users={users} max={3} size="sm" />
 */
export interface AvatarGroupProps {
  users: Array<{
    id: string
    profile_image_url?: string | null
    first_name?: string | null
    last_name?: string | null
    email?: string | null
  }>
  max?: number
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export function AvatarGroup({ 
  users, 
  max = 3, 
  size = 'sm',
  className = '' 
}: AvatarGroupProps) {
  const displayUsers = users.slice(0, max)
  const remainingCount = users.length - max
  
  return (
    <div className={`avatar-group ${className}`}>
      {displayUsers.map((user) => (
        <Avatar
          key={user.id}
          userId={user.id}
          profileImageUrl={user.profile_image_url}
          firstName={user.first_name}
          lastName={user.last_name}
          email={user.email}
          size={size}
          showTooltip
        />
      ))}
      {remainingCount > 0 && (
        <div className={`avatar avatar-${size} avatar-circle avatar-count`}>
          <div className="avatar-fallback">
            +{remainingCount}
          </div>
        </div>
      )}
    </div>
  )
}

