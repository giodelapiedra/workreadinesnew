import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.')
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  global: {
    fetch: async (url, options = {}) => {
      const maxRetries = 5 // Increased retries for better reliability
      const retryDelay = 2000 // 2 seconds base delay
      const timeout = 30000 // 30 second timeout (increased for slow connections)
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), timeout)
          
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            // Add keepalive for better connection handling
            keepalive: true,
          })
          
          clearTimeout(timeoutId)
          
          // Check if response is ok
          if (!response.ok && response.status >= 500) {
            // Server error - retry
            if (attempt < maxRetries) {
              clearTimeout(timeoutId)
              const delay = retryDelay * attempt
              console.warn(`[Supabase] Server error ${response.status} (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`)
              await new Promise(resolve => setTimeout(resolve, delay))
              continue
            }
          }
          
          return response
        } catch (error: any) {
          const isLastAttempt = attempt === maxRetries
          const isNetworkError = 
            error.code === 'ECONNRESET' || 
            error.code === 'ETIMEDOUT' ||
            error.message?.includes('fetch failed') ||
            error.message?.includes('network') ||
            error.name === 'AbortError' ||
            error.cause?.code === 'ECONNRESET'
          
          if (isLastAttempt) {
            console.error(`[Supabase] Fetch failed after ${attempt} attempt(s):`, error.message || error.code)
            throw error
          }
          
          if (!isNetworkError) {
            // Non-network error - don't retry
            throw error
          }
          
          const delay = retryDelay * attempt // Exponential backoff
          console.warn(`[Supabase] Network error (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
      
      throw new Error('Failed to connect to Supabase after retries')
    }
  }
})

