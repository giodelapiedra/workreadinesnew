/**
 * Centralized Photo URL Utilities
 * 
 * Handles conversion between R2 storage URLs and backend proxy URLs
 * to avoid DNS resolution issues with R2 public URLs
 */

/**
 * Convert R2 storage URL to backend proxy URL
 * 
 * @param r2Url - Direct R2 URL (e.g., https://pub-xxx.r2.dev/incidents/userId/file.jpg)
 * @param incidentId - Incident ID for the photo
 * @param rolePrefix - Role-specific API prefix (e.g., 'worker', 'clinician', 'whs')
 * @returns Proxy URL that will be served through backend
 */
export function getIncidentPhotoProxyUrl(r2Url: string | null, incidentId: string, rolePrefix: string = 'worker'): string | null {
  if (!r2Url || !incidentId) {
    return null
  }
  
  // If it's already a proxy URL, return as-is
  if (r2Url.includes('/incident-photo/')) {
    return r2Url
  }
  
  // If it's an R2 URL, convert to proxy URL
  // This avoids DNS resolution issues with R2 public URLs
  if (r2Url.includes('.r2.dev') || r2Url.includes('r2.cloudflarestorage.com')) {
    return `/api/${rolePrefix}/incident-photo/${incidentId}`
  }
  
  // For other URLs, return as-is
  return r2Url
}

/**
 * Extract file path from R2 URL
 * 
 * @param r2Url - R2 URL
 * @returns File path within bucket
 */
export function extractR2FilePath(r2Url: string): string | null {
  if (!r2Url) {
    return null
  }
  
  // Format: https://pub-xxx.r2.dev/incidents/userId/filename.jpg
  // Or: https://bucket.accountId.r2.dev/incidents/userId/filename.jpg
  if (r2Url.includes('.r2.dev/')) {
    const urlParts = r2Url.split('.r2.dev/')
    if (urlParts.length > 1) {
      return urlParts[1]
    }
  }
  
  // Format: https://account.r2.cloudflarestorage.com/bucket/incidents/userId/filename.jpg
  if (r2Url.includes('r2.cloudflarestorage.com')) {
    const urlParts = r2Url.split('r2.cloudflarestorage.com/')
    if (urlParts.length > 1) {
      // Remove bucket name from path
      const pathWithBucket = urlParts[1]
      const pathParts = pathWithBucket.split('/')
      if (pathParts.length > 1) {
        return pathParts.slice(1).join('/')
      }
    }
  }
  
  return null
}

/**
 * Check if URL is an R2 storage URL
 */
export function isR2Url(url: string | null): boolean {
  if (!url) return false
  return url.includes('.r2.dev') || url.includes('r2.cloudflarestorage.com')
}

/**
 * Get content type from file extension
 */
export function getContentTypeFromFilePath(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase()
  const contentTypeMap: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
  }
  return contentTypeMap[extension || ''] || 'image/jpeg'
}

