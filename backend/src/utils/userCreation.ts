/**
 * Centralized User Creation Utility
 * Provides reusable functions for creating users across different roles
 * Ensures consistency, security, and proper validation
 */

import bcrypt from 'bcrypt'
import { supabase } from '../lib/supabase.js'
import { getAdminClient } from './adminClient.js'

export interface CreateUserInput {
  email: string
  password: string
  role: string
  first_name: string
  last_name: string
  business_name?: string
  business_registration_number?: string
}

export interface CreateUserResult {
  success: boolean
  user?: any
  error?: string
  details?: string
}

/**
 * Validates user creation input
 */
export function validateUserInput(input: CreateUserInput): { valid: boolean; error?: string } {
  const { email, password, role, first_name, last_name, business_name, business_registration_number } = input

  // Validate required fields
  if (!email || !password) {
    return { valid: false, error: 'Email and password are required' }
  }

  if (!first_name || !last_name) {
    return { valid: false, error: 'First name and last name are required' }
  }

  // Trim and validate names
  const trimmedFirstName = first_name.trim()
  const trimmedLastName = last_name.trim()
  const trimmedEmail = email.trim().toLowerCase()

  if (!trimmedFirstName || !trimmedLastName) {
    return { valid: false, error: 'First name and last name cannot be empty' }
  }

  // Validate role
  const validRoles = ['worker', 'supervisor', 'whs_control_center', 'executive', 'clinician', 'team_leader', 'admin']
  if (!role || !validRoles.includes(role)) {
    return { valid: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }
  }

  // Supervisor-specific validation
  // Supervisors MUST have business_name and business_registration_number
  // These are automatically inherited from the executive when created by an executive
  if (role === 'supervisor') {
    if (!business_name || typeof business_name !== 'string' || !business_name.trim()) {
      return { valid: false, error: 'Business Name is required for supervisors. It should be automatically inherited from the executive.' }
    }
    if (!business_registration_number || typeof business_registration_number !== 'string' || !business_registration_number.trim()) {
      return { valid: false, error: 'Business Registration Number is required for supervisors. It should be automatically inherited from the executive.' }
    }
  }

  // Password validation
  if (password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters' }
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmedEmail)) {
    return { valid: false, error: 'Invalid email format' }
  }

  return { valid: true }
}

/**
 * Creates a user account (centralized function)
 * Handles auth user creation, password hashing, and database insertion
 */
export async function createUserAccount(input: CreateUserInput): Promise<CreateUserResult> {
  try {
    // Validate input
    const validation = validateUserInput(input)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const { email, password, role, first_name, last_name, business_name, business_registration_number } = input

    // Normalize inputs
    const trimmedFirstName = first_name.trim()
    const trimmedLastName = last_name.trim()
    const trimmedEmail = email.trim().toLowerCase()
    const fullName = `${trimmedFirstName} ${trimmedLastName}`.trim()

    const adminClient = getAdminClient()

    // Check if user already exists
    const { data: existingUser } = await adminClient
      .from('users')
      .select('email')
      .eq('email', trimmedEmail)
      .single()

    if (existingUser) {
      return { success: false, error: 'User with this email already exists' }
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: trimmedEmail,
      password,
      email_confirm: true,
    })

    if (authError || !authData.user) {
      if (authError?.message?.includes('already registered') || 
          authError?.message?.includes('User already registered')) {
        return { success: false, error: 'User with this email already exists in auth system' }
      }
      console.error('Supabase Auth error:', authError)
      return { 
        success: false, 
        error: 'Failed to create user', 
        details: authError?.message 
      }
    }

    // Hash password with bcrypt
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(password, saltRounds)

    // Prepare user data
    const userInsertData: any = {
      id: authData.user.id,
      email: trimmedEmail,
      role: role,
      first_name: trimmedFirstName,
      last_name: trimmedLastName,
      full_name: fullName,
      password_hash: hashedPassword,
      created_at: new Date().toISOString(),
    }

    // Handle business info based on role
    // For supervisors: business_name and business_registration_number are REQUIRED (automatically inherited from executive)
    // For other roles: business info is optional but will be inherited if provided
    if (role === 'supervisor') {
      // Supervisors must have business info (validated above, automatically inherited from executive)
      userInsertData.business_name = business_name!.trim()
      userInsertData.business_registration_number = business_registration_number!.trim()
    } else {
      // Other roles: business info is optional
      userInsertData.business_name = business_name?.trim() || null
      userInsertData.business_registration_number = business_registration_number?.trim() || null
    }

    // Create user record in database
    const { data: userData, error: dbError } = await adminClient
      .from('users')
      .insert([userInsertData])
      .select('id, email, role, first_name, last_name, full_name, business_name, business_registration_number')
      .single()

    if (dbError) {
      console.error('Database insert error:', dbError)
      // Clean up auth user if database insert fails
      await supabase.auth.admin.deleteUser(authData.user.id)
      return { 
        success: false, 
        error: 'Failed to create user record', 
        details: dbError.message 
      }
    }

    if (!userData) {
      // Clean up auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      return { success: false, error: 'Failed to create user record' }
    }

    return {
      success: true,
      user: userData,
    }
  } catch (error: any) {
    console.error('[createUserAccount] Error:', error)
    return { 
      success: false, 
      error: 'Internal server error', 
      details: error.message 
    }
  }
}

