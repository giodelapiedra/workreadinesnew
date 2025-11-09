import { getAdminClient } from './adminClient'

/**
 * Generates a unique 6-digit quick login code
 * Retries if code already exists (very unlikely)
 */
export async function generateUniqueQuickLoginCode(): Promise<string> {
  const adminClient = getAdminClient()
  const maxAttempts = 10
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generate 6-digit code (100000-999999)
    // Using random ensures good distribution
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    
    // Check if code already exists
    const { data: existing } = await adminClient
      .from('users')
      .select('id')
      .eq('quick_login_code', code)
      .single()
    
    if (!existing) {
      console.log(`[generateUniqueQuickLoginCode] Generated unique code: ${code}`)
      return code
    }
    
    // If code exists, try again
    console.warn(`[generateUniqueQuickLoginCode] Code ${code} already exists, retrying... (attempt ${attempt + 1}/${maxAttempts})`)
  }
  
  // Fallback: use timestamp-based code if all attempts fail (extremely rare)
  const timestampCode = Date.now().toString().slice(-6)
  console.warn(`[generateUniqueQuickLoginCode] Using fallback timestamp code: ${timestampCode}`)
  return timestampCode
}

/**
 * Validates quick login code format
 * Must be exactly 6 digits
 */
export function isValidQuickLoginCode(code: string): boolean {
  if (!code || typeof code !== 'string') {
    return false
  }
  const codeRegex = /^\d{6}$/
  return codeRegex.test(code.trim())
}

