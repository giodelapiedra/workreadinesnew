/**
 * Centralized API Client
 * 
 * Provides a scalable, maintainable way to handle all API requests
 * Features:
 * - Request/Response interceptors
 * - Automatic error handling
 * - Retry logic for failed requests
 * - Request cancellation
 * - Type-safe responses
 */

import { API_BASE_URL } from '../config/api'

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

  constructor(baseURL: string) {
    this.baseURL = baseURL
  }

  /**
   * Request interceptor - can be extended for auth tokens, etc.
   */
  private async interceptRequest(
    url: string,
    config: RequestConfig
  ): Promise<RequestInit> {
    // Create headers object - handle both Headers and plain object
    const headers = new Headers()
    
    // Copy existing headers from config
    if (config.headers) {
      if (config.headers instanceof Headers) {
        // If it's already a Headers object, copy all entries
        config.headers.forEach((value, key) => {
          headers.set(key, value)
        })
      } else if (typeof config.headers === 'object') {
        // If it's a plain object, set each header
        Object.entries(config.headers).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            headers.set(key, String(value))
          }
        })
      }
    }

    // MOBILE FALLBACK: If no Authorization header is set, try to get token from localStorage
    // This is needed because Safari on iOS often blocks cross-domain cookies
    if (!headers.has('Authorization')) {
      const token = localStorage.getItem('auth_token')
      if (token) {
        headers.set('Authorization', `Bearer ${token}`)
        console.log('[ApiClient] Using token from localStorage (mobile fallback)')
      } else {
        console.log('[ApiClient] No token in localStorage, no Authorization header will be sent')
      }
    } else {
      console.log('[ApiClient] Authorization header already present in request')
    }

    // CRITICAL: Explicitly preserve credentials for mobile cookie support
    return {
      ...config,
      headers,
      credentials: config.credentials || this.defaultConfig.credentials || 'include',
    }
  }

  /**
   * Response interceptor - handles common response logic
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
            message: 'Invalid response format',
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
      // Sanitize error message to prevent exposing sensitive data
      let errorMessage = 'Request failed'
      
      // Only expose safe error messages
      if (data?.error && typeof data.error === 'string') {
        // Sanitize: remove potential sensitive info
        errorMessage = data.error
          .replace(/password/gi, '[REDACTED]')
          .replace(/token/gi, '[REDACTED]')
          .replace(/secret/gi, '[REDACTED]')
          .replace(/key/gi, '[REDACTED]')
      } else if (data?.message && typeof data.message === 'string') {
        errorMessage = data.message
      } else if (response.statusText) {
        errorMessage = response.statusText
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
        // CRITICAL: Ensure credentials is always 'include' for cookie support (especially mobile)
        const finalConfig: RequestInit = {
          ...interceptedConfig,
          credentials: 'include', // Always include credentials for cross-domain cookies
          signal,
        }
        
        // Execute request with timeout
        const response = await Promise.race([
          fetch(fullUrl, finalConfig),
          this.createTimeout(timeout),
        ]) as Response

        clearTimeout(timeoutId)

        // Intercept response
        const result = await this.interceptResponse<T>(response)
        
        // MOBILE FIX: If we get a 401 (Unauthorized), it might be a cookie timing issue
        // Retry with increasing delays for mobile cookie processing
        if (result.error?.status === 401 && attempt < 2) {
          // Wait longer for cookies to be processed (mobile browsers need more time)
          // First retry: 1.5s, Second retry: 2.5s
          const delay = attempt === 0 ? 1500 : 2500
          await this.sleep(delay)
          // Retry with incremented attempt
          return this.executeRequest<T>(url, config, attempt + 1)
        }
        
        return result
      } catch (error: any) {
        clearTimeout(timeoutId)
        throw error
      }
    } catch (error: any) {
      // Handle abort errors (timeout or manual cancellation)
      if (error.name === 'AbortError' || error.message?.includes('timeout')) {
        return {
          data: null,
          error: {
            message: error.message || 'Request cancelled or timed out',
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

      // Return error response
      return {
        data: null,
        error: {
          message: error.message || 'Network error',
          status: 0,
        },
      }
    }
  }

  /**
   * Check if error is retryable
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
   * GET request
   */
  async get<T = any>(url: string, config?: RequestConfig): Promise<ApiResult<T>> {
    return this.executeRequest<T>(url, {
      ...this.defaultConfig,
      ...config,
      method: 'GET',
    })
  }

  /**
   * POST request
   */
  async post<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig
  ): Promise<ApiResult<T>> {
    return this.executeRequest<T>(
      url,
      {
        ...this.defaultConfig,
        ...config,
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined,
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
export function getApiErrorMessage(result: ApiErrorResponse): string {
  return result.error.message || 'An error occurred'
}

