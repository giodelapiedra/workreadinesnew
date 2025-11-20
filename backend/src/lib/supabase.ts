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
      const maxRetries = 3
      const retryDelay = 1000 // 1 second
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout
          
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
          })
          
          clearTimeout(timeoutId)
          return response
        } catch (error: any) {
          const isLastAttempt = attempt === maxRetries
          const isNetworkError = 
            error.code === 'ECONNRESET' || 
            error.code === 'ETIMEDOUT' ||
            error.message?.includes('fetch failed') ||
            error.name === 'AbortError'
          
          if (isLastAttempt || !isNetworkError) {
            console.error(`[Supabase] Fetch failed after ${attempt} attempt(s):`, error.message || error.code)
            throw error
          }
          
          console.warn(`[Supabase] Network error (attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms...`)
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt))
        }
      }
      
      throw new Error('Failed to connect to Supabase after retries')
    }
  }
})

