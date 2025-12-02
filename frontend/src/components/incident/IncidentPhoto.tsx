/**
 * IncidentPhoto Component
 * 
 * Reusable component for displaying incident photos
 * Used across: Worker My Accidents, WHS Control Center, Clinician Cases
 * 
 * Features:
 * - Lazy loading image
 * - Click to view full size
 * - Error handling (hides if image fails to load)
 * - Responsive design
 * - Backend proxy support for R2 images
 * 
 * ✅ Backend now returns proxy URLs, so no URL conversion needed here
 */

import { API_BASE_URL } from '../../config/api'
import './IncidentPhoto.css'

interface IncidentPhotoProps {
  photoUrl: string
  altText?: string
}

export function IncidentPhoto({ photoUrl, altText = 'Incident photo' }: IncidentPhotoProps) {
  // Backend returns proxy URLs (e.g., /incident-photo/:incidentId)
  // We just need to prepend API_BASE_URL if it's a relative URL
  const getFullUrl = (url: string): string => {
    if (!url) return ''
    
    // If it's a relative URL (starts with /), prepend API base URL
    if (url.startsWith('/')) {
      return `${API_BASE_URL}${url}`
    }
    
    // For absolute URLs (http/https), use directly
    // This is a fallback for legacy URLs
    return url
  }

  const fullUrl = getFullUrl(photoUrl)

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    // Hide the entire section if image fails to load
    const target = e.currentTarget
    const section = target.closest('.incident-photo-section')
    if (section) {
      (section as HTMLElement).style.display = 'none'
    }
  }

  const handleViewFullSize = () => {
    window.open(fullUrl, '_blank')
  }

  return (
    <div className="case-info-section incident-photo-section">
      <h3 className="case-section-header">INCIDENT PHOTO</h3>
      <div className="case-info-divider"></div>
      <div className="incident-photo-container">
        <div className="incident-photo-wrapper">
          <img 
            src={fullUrl}
            alt={altText}
            className="incident-photo-image"
            onClick={handleViewFullSize}
            onError={handleImageError}
            loading="lazy"
          />
          <button
            className="incident-photo-fullsize-btn"
            onClick={handleViewFullSize}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
            View Full Size
          </button>
        </div>
      </div>
    </div>
  )
}

