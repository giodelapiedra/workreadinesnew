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
  
  // Normalize URL - trim whitespace
  const normalizedUrl = r2Url.trim()
  
  // If it's already a proxy URL, return as-is
  if (normalizedUrl.includes('/incident-photo/')) {
    return normalizedUrl
  }
  
  // If it's an R2 URL (with or without protocol), convert to proxy URL
  // This avoids DNS resolution issues with R2 public URLs
  if (normalizedUrl.includes('.r2.dev') || normalizedUrl.includes('r2.cloudflarestorage.com')) {
    return `/api/${rolePrefix}/incident-photo/${incidentId}`
  }
  
  // For other URLs, return as-is
  return normalizedUrl
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
  
  // Normalize URL - add protocol if missing
  let normalizedUrl = r2Url.trim()
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`
  }
  
  // Format: https://pub-xxx.r2.dev/incidents/userId/filename.jpg
  // Or: https://bucket.accountId.r2.dev/incidents/userId/filename.jpg
  // Or: pub-xxx.r2.dev/incidents/userId/filename.jpg (without protocol)
  if (normalizedUrl.includes('.r2.dev/')) {
    const urlParts = normalizedUrl.split('.r2.dev/')
    if (urlParts.length > 1) {
      return urlParts[1]
    }
  }
  
  // Format: https://account.r2.cloudflarestorage.com/bucket/incidents/userId/filename.jpg
  if (normalizedUrl.includes('r2.cloudflarestorage.com')) {
    const urlParts = normalizedUrl.split('r2.cloudflarestorage.com/')
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

/**
 * Convert R2 storage URL to backend proxy URL for certificate images
 * 
 * @param r2Url - Direct R2 URL (e.g., https://pub-xxx.r2.dev/certificates/userId/imageId.png)
 * @returns Proxy URL that will be served through backend
 */
export function getCertificateImageProxyUrl(r2Url: string | null): string | null {
  if (!r2Url) {
    return null
  }
  
  // Normalize URL - trim whitespace
  const normalizedUrl = r2Url.trim()
  
  // If it's already a proxy URL, return as-is
  if (normalizedUrl.includes('/certificate-image/')) {
    return normalizedUrl
  }
  
  // If it's an R2 URL, convert to proxy URL
  if (normalizedUrl.includes('.r2.dev') || normalizedUrl.includes('r2.cloudflarestorage.com')) {
    // Extract the path after 'certificates/'
    // Format: https://pub-xxx.r2.dev/certificates/userId/imageId.png
    const match = normalizedUrl.match(/certificates\/([^\/]+)\/([^\/]+)/)
    if (match) {
      const userId = match[1]
      const imageId = match[2]
      return `/api/whs/certificate-image/${userId}/${imageId}`
    }
  }
  
  // For other URLs, return as-is
  return normalizedUrl
}

