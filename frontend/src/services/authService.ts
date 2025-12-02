/**
 * Auth Service
 * Centralized authentication API calls
 */

import { apiClient } from '../lib/apiClient'
import type { ApiResult } from '../lib/apiClient'
import { API_ROUTES } from '../config/apiRoutes'

export interface LoginRequest {
  email: string
  password: string
}

export interface QuickLoginRequest {
  quick_login_code: string
}

export interface RegisterRequest {
  email: string
  password: string
  first_name: string
  last_name: string
  role: string
  phone?: string
  business_name?: string
  business_registration_number?: string
  gender: 'male' | 'female'
  date_of_birth: string
}

export interface UpdateProfileRequest {
  first_name?: string
  last_name?: string
  email?: string
  password?: string
  business_name?: string
  business_registration_number?: string
  gender?: 'male' | 'female'
  date_of_birth?: string
}

export interface ChangePasswordRequest {
  old_password: string
  new_password: string
}

export interface GeneratePinResponse {
  message: string
  pin: string
}

export interface UserResponse {
  user: {
    id: string
    email: string
    role: string
    first_name: string
    last_name: string
    full_name: string
    phone?: string
    business_name?: string
    business_registration_number?: string
  }
}

export const authService = {
  /**
   * Login with email and password
   */
  async login(data: LoginRequest): Promise<ApiResult<UserResponse>> {
    return apiClient.post<UserResponse>(API_ROUTES.AUTH.LOGIN, data)
  },

  /**
   * Quick login with code
   */
  async quickLogin(data: QuickLoginRequest): Promise<ApiResult<UserResponse>> {
    return apiClient.post<UserResponse>(API_ROUTES.AUTH.QUICK_LOGIN, data)
  },

  /**
   * Register new user
   */
  async register(data: RegisterRequest): Promise<ApiResult<UserResponse>> {
    return apiClient.post<UserResponse>(API_ROUTES.AUTH.REGISTER, data)
  },

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<ApiResult<UserResponse>> {
    return apiClient.get<UserResponse>(API_ROUTES.AUTH.ME, {
      headers: { 'Cache-Control': 'no-cache' },
    })
  },

  /**
   * Logout
   */
  async logout(): Promise<ApiResult<{ message: string }>> {
    return apiClient.post<{ message: string }>(API_ROUTES.AUTH.LOGOUT)
  },

  /**
   * Refresh token
   */
  async refresh(): Promise<ApiResult<UserResponse>> {
    return apiClient.post<UserResponse>(API_ROUTES.AUTH.REFRESH)
  },

  /**
   * Update user profile
   */
  async updateProfile(data: UpdateProfileRequest): Promise<ApiResult<UserResponse>> {
    return apiClient.patch<UserResponse>(API_ROUTES.AUTH.PROFILE, data)
  },

  /**
   * Change password
   */
  async changePassword(data: ChangePasswordRequest): Promise<ApiResult<{ message: string }>> {
    return apiClient.patch<{ message: string }>(API_ROUTES.AUTH.PASSWORD, data)
  },

  /**
   * Verify password
   */
  async verifyPassword(password: string): Promise<ApiResult<{ verified: boolean }>> {
    return apiClient.post<{ verified: boolean }>(API_ROUTES.AUTH.VERIFY_PASSWORD, { password })
  },

  /**
   * Generate quick login PIN
   */
  async generatePin(): Promise<ApiResult<GeneratePinResponse>> {
    return apiClient.patch<GeneratePinResponse>(API_ROUTES.AUTH.PIN, {})
  },
}

