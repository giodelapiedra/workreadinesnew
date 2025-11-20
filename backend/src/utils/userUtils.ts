import { getAdminClient } from './adminClient.js'

/**
 * Ensures a user record exists in the database.
 * If user exists in Supabase Auth but not in database, auto-creates a user record.
 * This is a shared utility to avoid code duplication across endpoints.
 * 
 * @param userId - The user ID from Supabase Auth
 * @param email - The user's email
 * @returns User data or null if creation failed
 */
export async function ensureUserRecordExists(userId: string, email: string): Promise<{
  id: string
  email: string
  role: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
} | null> {
  const adminClient = getAdminClient()
  
  // Check if user record exists
  const { data: existingUser, error: fetchError } = await adminClient
    .from('users')
    .select('id, email, role, first_name, last_name, full_name')
    .eq('id', userId)
    .single()
  
  if (existingUser && !fetchError) {
    return existingUser
  }
  
  // User doesn't exist in database - auto-create with default role
  if (fetchError && fetchError.code === 'PGRST116') {
    console.log(`[ensureUserRecordExists] User exists in Supabase Auth but not in database. Auto-creating user record: ${userId}`)
    
    // Use email prefix as name if not available
    const emailPrefix = email?.split('@')[0] || 'User'
    
    const { data: newUser, error: createError } = await adminClient
      .from('users')
      .insert([
        {
          id: userId,
          email: email,
          role: 'worker', // Default role
          first_name: emailPrefix,
          last_name: '', // Empty for auto-created users
          full_name: emailPrefix, // Set for backward compatibility
          created_at: new Date().toISOString(),
        },
      ])
      .select('id, email, role, first_name, last_name, full_name')
      .single()
    
    if (createError || !newUser) {
      console.error('[ensureUserRecordExists] Failed to auto-create user record:', createError)
      return null
    }
    
    console.log('[ensureUserRecordExists] User record auto-created successfully:', newUser.id)
    return newUser
  }
  
  // Other error occurred
  console.error('[ensureUserRecordExists] Error checking user existence:', fetchError)
  return null
}

/**
 * Format user's full name from first_name and last_name
 * @param user - User object with first_name, last_name, full_name, or email
 * @returns Formatted full name
 */
export function formatUserFullName(user: {
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  email?: string | null
}): string {
  if (user.full_name) {
    return user.full_name
  }
  
  if (user.first_name && user.last_name) {
    return `${user.first_name} ${user.last_name}`
  }
  
  if (user.first_name) {
    return user.first_name
  }
  
  if (user.email) {
    return user.email.split('@')[0]
  }
  
  return 'Unknown User'
}

/**
 * Generate user initials from name
 * @param name - Full name or email
 * @returns Initials (max 2 characters)
 */
export function getUserInitials(name: string): string {
  if (!name) {
    return '??'
  }
  
  const parts = name.trim().split(' ')
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2)
  }
  
  return name.substring(0, 2).toUpperCase()
}

/**
 * Format team leader data with consistent structure
 * @param teamLeader - Team leader user data
 * @returns Formatted team leader object
 */
export function formatTeamLeader(teamLeader: {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
}): {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  initials: string
} {
  const fullName = formatUserFullName(teamLeader)
  
  return {
    id: teamLeader.id,
    email: teamLeader.email,
    firstName: teamLeader.first_name || '',
    lastName: teamLeader.last_name || '',
    fullName,
    initials: getUserInitials(fullName),
  }
}
