/**
 * Image URL Utilities
 * Centralized handling of profile image URLs with security and optimization
 */

import { API_BASE_URL } from '../config/api'
import { API_ROUTES } from '../config/apiRoutes'

/**
 * Get profile image URL with proxy fallback
 * Security: Uses backend proxy for R2 images to avoid CORS issues
 * Performance: Stable cache key to prevent unnecessary reloads
 * 
 * @param profileImageUrl - The stored profile image URL from database
 * @param userId - User ID for proxy endpoint
 * @returns Optimized image URL or null
 */
export function getProfileImageUrl(
  profileImageUrl: string | null | undefined,
  userId: string | null | undefined
): string | null {
  if (!profileImageUrl) return null
  
  // If it's a data URL (base64), use proxy endpoint to serve it
  // Create stable cache key from data URL hash to prevent unnecessary reloads
  if (profileImageUrl.startsWith('data:') && userId) {
    // Generate stable hash from data URL (first 20 chars of base64 part)
    // This ensures same image = same URL, preventing flicker on navigation
    const base64Part = profileImageUrl.split(',')[1] || ''
    const hash = base64Part.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '')
    return `${API_BASE_URL}${API_ROUTES.AUTH.PROFILE_IMAGE_PROXY(userId)}?h=${hash}`
  }
  
  // Security: Validate URL format to prevent XSS
  try {
    new URL(profileImageUrl)
  } catch {
    // If it's not a valid URL and not a data URL, return null
    console.error('[ImageUtils] Invalid URL format:', profileImageUrl)
    return null
  }
  
  // If URL contains R2 public domain, use proxy as fallback
  // This works even if DNS hasn't propagated and avoids CORS issues
  if (profileImageUrl.includes('.r2.dev') && userId) {
    // Use proxy endpoint that serves images through backend
    // Extract timestamp from filename for cache busting
    // Format: profile-{uuid}-{timestamp}-{random}.{ext}
    const timestampMatch = profileImageUrl.match(/-(\d+)-[a-z0-9]+\.(jpg|jpeg|png|gif|webp)$/i)
    const timestamp = timestampMatch ? timestampMatch[1] : Date.now()
    
    return `${API_BASE_URL}${API_ROUTES.AUTH.PROFILE_IMAGE_PROXY(userId)}?v=${timestamp}`
  }
  
  // For other URLs (custom domains, CDN), use directly
  // Extract timestamp from filename for cache busting
  const timestampMatch = profileImageUrl.match(/-(\d+)-[a-z0-9]+\.(jpg|jpeg|png|gif|webp)$/i)
  const timestamp = timestampMatch ? timestampMatch[1] : ''
  
  if (timestamp) {
    const separator = profileImageUrl.includes('?') ? '&' : '?'
    return `${profileImageUrl}${separator}v=${timestamp}`
  }
  
  return profileImageUrl
}

/**
 * Check if image URL is from R2 storage
 * Used for conditional logic (e.g., different caching strategies)
 */
export function isR2Url(url: string | null | undefined): boolean {
  if (!url) return false
  return url.includes('.r2.dev') || url.includes('r2.cloudflarestorage.com')
}

/**
 * Validate image file on client side before upload
 * Security: Client-side validation as first line of defense
 * Note: Server-side validation is still required
 */
export interface ImageValidation {
  valid: boolean
  error?: string
}

export function validateImageFile(file: File): ImageValidation {
  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: 'Invalid file type. Please upload a JPG, PNG, GIF, or WebP image.'
    }
  }

  // Validate file size (5MB max)
  const maxSize = 5 * 1024 * 1024
  if (file.size > maxSize) {
    return {
      valid: false,
      error: 'File size exceeds 5MB. Please choose a smaller image.'
    }
  }

  // Validate file extension
  const extension = file.name.split('.').pop()?.toLowerCase()
  const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp']
  if (!extension || !allowedExtensions.includes(extension)) {
    return {
      valid: false,
      error: 'Invalid file extension. Allowed: jpg, jpeg, png, gif, webp'
    }
  }

  return { valid: true }
}

