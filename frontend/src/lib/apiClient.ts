/**
 * Centralized API Client
 * 
 * Provides a scalable, maintainable way to handle all API requests
 * Features:
 * - Request/Response interceptors
 * - Automatic error handling (centralized)
 * - Retry logic for failed requests
 * - Request cancellation
 * - Type-safe responses
 * - Secure error sanitization
 */

import { API_BASE_URL } from '../config/api'
import { 
  sanitizeErrorMessage, 
  getStatusErrorMessage, 
  getNetworkErrorMessage,
  handleError
} from '../utils/errorHandler'

export interface ApiError {
  message: string
  status: number
  data?: any
}

export interface ApiResponse<T = any> {
  data: T
  error: null
}

export interface ApiErrorResponse {
  data: null
  error: ApiError
}

export type ApiResult<T = any> = ApiResponse<T> | ApiErrorResponse

export interface RequestConfig extends RequestInit {
  retries?: number
  retryDelay?: number
  timeout?: number
}

class ApiClient {
  private baseURL: string
  private defaultConfig: RequestConfig = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    retries: 0,
    retryDelay: 1000,
    timeout: 30000, // 30 seconds
  }
  // Request deduplication: Track pending requests to prevent duplicate API calls
  private pendingRequests = new Map<string, Promise<ApiResult<any>>>()

  constructor(baseURL: string) {
    this.baseURL = baseURL
  }

  /**
   * Generate a unique key for request deduplication
   * Includes URL, method, and config to ensure identical requests are deduplicated
   */
  private getRequestKey(url: string, method: string, config?: RequestConfig): string {
    // Create a stable key from URL, method, and relevant config
    const configKey = config
      ? JSON.stringify({
          headers: config.headers,
          body: config.body instanceof FormData ? '[FormData]' : config.body,
          signal: config.signal ? '[AbortSignal]' : undefined,
        })
      : ''
    return `${method}:${url}:${configKey}`
  }

  /**
   * Request interceptor - can be extended for auth tokens, etc.
   * Handles FormData by not setting Content-Type (browser will set it with boundary)
   */
  private async interceptRequest(
    url: string,
    config: RequestConfig
  ): Promise<RequestInit> {
    const headers = new Headers(config.headers)

    // Don't set Content-Type for FormData - browser will set it with boundary
    // This allows multipart/form-data uploads to work correctly
    if (config.body instanceof FormData) {
      // Remove Content-Type header if it's FormData - browser will set it automatically
      headers.delete('Content-Type')
    } else if (!headers.has('Content-Type')) {
      // Only set default Content-Type if not FormData and not already set
      headers.set('Content-Type', 'application/json')
    }

    // Add any default headers here
    // Example: if (token) headers.set('Authorization', `Bearer ${token}`)

    return {
      ...config,
      headers,
    }
  }

  /**
   * Response interceptor - handles common response logic
   * Security: All error handling is centralized and sanitized via errorHandler utility
   */
  private async interceptResponse<T>(
    response: Response
  ): Promise<ApiResult<T>> {
    // Handle different content types
    const contentType = response.headers.get('content-type') || ''
    
    let data: any = null
    
    if (contentType.includes('application/json')) {
      try {
        const text = await response.text()
        if (text?.trim()) {
          data = JSON.parse(text.replace(/^\uFEFF/, '').trim())
        }
      } catch (error) {
        // Only log in development to avoid exposing sensitive data in production
        if (import.meta.env.DEV) {
          console.error('[ApiClient] JSON parse error:', error)
        }
        return {
          data: null,
          error: {
            message: getStatusErrorMessage(response.status),
            status: response.status,
          },
        }
      }
    } else if (contentType.includes('text/')) {
      data = await response.text()
    } else {
      data = await response.blob()
    }

    // Handle error responses
    if (!response.ok) {
      // Centralized error message extraction with sanitization
      let errorMessage = getStatusErrorMessage(response.status)
      
      // Try to extract error message from response data (sanitized)
      if (data?.error && typeof data.error === 'string') {
        errorMessage = sanitizeErrorMessage(data.error)
      } else if (data?.message && typeof data.message === 'string') {
        errorMessage = sanitizeErrorMessage(data.message)
      } else if (response.statusText && response.statusText !== '') {
        errorMessage = sanitizeErrorMessage(response.statusText)
      }

      // Don't expose full error data in production
      const errorData = import.meta.env.DEV ? data : undefined

      return {
        data: null,
        error: {
          message: errorMessage,
          status: response.status,
          data: errorData, // Only include in development
        },
      }
    }

    return {
      data: data as T,
      error: null,
    }
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Create timeout promise
   */
  private createTimeout(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${timeout}ms`))
      }, timeout)
    })
  }

  /**
   * Validate and sanitize URL to prevent injection attacks
   */
  private sanitizeUrl(url: string): string {
    // Prevent protocol-relative URLs and javascript: schemes
    if (url.startsWith('//') || url.startsWith('javascript:') || url.startsWith('data:')) {
      throw new Error('Invalid URL scheme')
    }
    return url
  }

  /**
   * Execute request with retry logic
   */
  private async executeRequest<T>(
    url: string,
    config: RequestConfig,
    attempt: number = 0
  ): Promise<ApiResult<T>> {
    // Sanitize URL
    const sanitizedUrl = this.sanitizeUrl(url)
    const fullUrl = sanitizedUrl.startsWith('http') ? sanitizedUrl : `${this.baseURL}${sanitizedUrl}`
    const timeout = config.timeout ?? this.defaultConfig.timeout!
    const retries = config.retries ?? this.defaultConfig.retries!

    try {
      // Intercept request
      const interceptedConfig = await this.interceptRequest(url, config)

      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      // Combine abort signals
      const signal = config.signal
        ? this.combineSignals([config.signal, controller.signal])
        : controller.signal

      try {
        // Execute request with timeout
        const response = await Promise.race([
          fetch(fullUrl, { ...interceptedConfig, signal }),
          this.createTimeout(timeout),
        ]) as Response

        clearTimeout(timeoutId)

        // Intercept response
        return await this.interceptResponse<T>(response)
      } catch (error: any) {
        clearTimeout(timeoutId)
        throw error
      }
    } catch (error: any) {
      // Handle abort errors (timeout or manual cancellation)
      // Use centralized error handler for consistent messages
      if (error.name === 'AbortError' || error.message?.includes('timeout')) {
        return {
          data: null,
          error: {
            message: getNetworkErrorMessage(error),
            status: 0,
          },
        }
      }

      // Retry logic for network errors
      if (attempt < retries && this.isRetryableError(error)) {
        const delay = (config.retryDelay ?? this.defaultConfig.retryDelay!) * (attempt + 1)
        await this.sleep(delay)
        return this.executeRequest<T>(url, config, attempt + 1)
      }

      // Centralized fallback error message - secure and user-friendly
      const networkErrorMessage = getNetworkErrorMessage(error)
      
      return {
        data: null,
        error: {
          message: networkErrorMessage,
          status: 0,
        },
      }
    }
  }

  /**
   * Check if error is retryable
   * Network error messages use centralized errorHandler utility
   */
  private isRetryableError(error: any): boolean {
    // Retry on network errors, not on 4xx client errors
    return (
      error.message?.includes('Failed to fetch') ||
      error.message?.includes('NetworkError') ||
      error.message?.includes('timeout')
    )
  }

  /**
   * Combine multiple abort signals
   */
  private combineSignals(signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController()

    signals.forEach(signal => {
      if (signal.aborted) {
        controller.abort()
      } else {
        signal.addEventListener('abort', () => controller.abort())
      }
    })

    return controller.signal
  }

  /**
   * GET request with deduplication
   * If the same request is already pending, returns the existing promise
   * Note: Requests with abort signals are NOT deduplicated to preserve abort behavior
   */
  async get<T = any>(url: string, config?: RequestConfig): Promise<ApiResult<T>> {
    // Don't deduplicate requests with abort signals - each signal needs independent control
    const hasSignal = config?.signal !== undefined
    
    if (!hasSignal) {
      const requestKey = this.getRequestKey(url, 'GET', config)
      
      // If same request is pending, return that promise
      if (this.pendingRequests.has(requestKey)) {
        return this.pendingRequests.get(requestKey)!
      }
      
      const promise = this.executeRequest<T>(url, {
        ...this.defaultConfig,
        ...config,
        method: 'GET',
      })
      
      // Store promise for deduplication
      this.pendingRequests.set(requestKey, promise)
      
      // Clean up after request completes
      promise.finally(() => {
        this.pendingRequests.delete(requestKey)
      })
      
      return promise
    }
    
    // Request has signal - execute directly without deduplication
    return this.executeRequest<T>(url, {
      ...this.defaultConfig,
      ...config,
      method: 'GET',
    })
  }

  /**
   * POST request
   * Supports both JSON and FormData
   */
  async post<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig
  ): Promise<ApiResult<T>> {
    // Handle FormData - don't stringify, pass as-is
    // Content-Type will be set by browser with boundary
    const body = data instanceof FormData 
      ? data 
      : data 
        ? JSON.stringify(data) 
        : undefined

    return this.executeRequest<T>(
      url,
      {
        ...this.defaultConfig,
        ...config,
        method: 'POST',
        body,
      }
    )
  }

  /**
   * PUT request
   */
  async put<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig
  ): Promise<ApiResult<T>> {
    return this.executeRequest<T>(
      url,
      {
        ...this.defaultConfig,
        ...config,
        method: 'PUT',
        body: data ? JSON.stringify(data) : undefined,
      }
    )
  }

  /**
   * PATCH request
   */
  async patch<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig
  ): Promise<ApiResult<T>> {
    return this.executeRequest<T>(
      url,
      {
        ...this.defaultConfig,
        ...config,
        method: 'PATCH',
        body: data ? JSON.stringify(data) : undefined,
      }
    )
  }

  /**
   * DELETE request
   */
  async delete<T = any>(url: string, config?: RequestConfig): Promise<ApiResult<T>> {
    return this.executeRequest<T>(url, {
      ...this.defaultConfig,
      ...config,
      method: 'DELETE',
    })
  }
}

// Export singleton instance
export const apiClient = new ApiClient(API_BASE_URL)

// Export helper function to check if result is error
export function isApiError<T>(result: ApiResult<T>): result is ApiErrorResponse {
  return result.error !== null
}

// Export helper function to get error message
// Uses centralized error handler for consistent fallback
export function getApiErrorMessage(result: ApiErrorResponse): string {
  return result.error.message || handleError('An error occurred')
}

