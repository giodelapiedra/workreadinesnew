/**
 * Executive Service
 * Centralized executive API calls
 * Security: All IDs are sanitized, uses centralized utilities
 */

import { apiClient, isApiError, getApiErrorMessage } from '../lib/apiClient'
import type { ApiResult } from '../lib/apiClient'
import { API_ROUTES } from '../config/apiRoutes'
import { buildUrl, sanitizeId } from '../utils/queryBuilder'

export interface CreateUserRequest {
  email: string
  password: string
  role: 'supervisor' | 'clinician' | 'whs_control_center'
  first_name: string
  last_name: string
  gender?: 'male' | 'female'
  date_of_birth?: string
  // business_name and business_registration_number are automatically inherited from executive
}

export interface User {
  id: string
  email: string
  role: string
  first_name: string
  last_name: string
  full_name: string
  business_name?: string
  business_registration_number?: string
  created_at: string
}

export interface UsersResponse {
  success: boolean
  users: User[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface StatsResponse {
  success: boolean
  stats: {
    supervisor: number
    clinician: number
    whs_control_center: number
    total: number
  }
}

export interface SafetyEngagementResponse {
  success: boolean
  overallSafetyEngagement: number
  checkInCompletion: number
  readinessBreakdown: {
    green: number
    amber: number
    red: number
    pending: number
  }
  totalWorkers: number
  activeWorkers: number
  period: {
    startDate: string
    endDate: string
  }
  dailyTrends: Array<{
    date: string
    engagement: number
  }>
}

export interface UpdateUserRequest {
  email?: string
  role?: 'supervisor' | 'clinician' | 'whs_control_center'
  first_name?: string
  last_name?: string
  password?: string
  business_name?: string
  business_registration_number?: string
}

export const executiveService = {
  /**
   * Create a new user (supervisor, clinician, or whs_control_center)
   */
  async createUser(data: CreateUserRequest) {
    return apiClient.post<{ success: boolean; message: string; user: User }>(
      API_ROUTES.EXECUTIVE.USERS,
      data
    )
  },

  /**
   * Get single user by ID
   * Security: ID is sanitized to prevent injection attacks
   */
  async getUser(id: string): Promise<ApiResult<{ success: boolean; user: User }>> {
    const sanitizedId = sanitizeId(id)
    return apiClient.get<{ success: boolean; user: User }>(
      API_ROUTES.EXECUTIVE.USER(sanitizedId)
    )
  },

  /**
   * Update user
   * Security: ID is sanitized to prevent injection attacks
   */
  async updateUser(id: string, data: UpdateUserRequest): Promise<ApiResult<{ success: boolean; message: string; user: User }>> {
    const sanitizedId = sanitizeId(id)
    return apiClient.patch<{ success: boolean; message: string; user: User }>(
      API_ROUTES.EXECUTIVE.USER(sanitizedId),
      data
    )
  },

  /**
   * Delete user
   * Security: ID is sanitized to prevent injection attacks
   */
  async deleteUser(id: string): Promise<ApiResult<{ success: boolean; message: string }>> {
    const sanitizedId = sanitizeId(id)
    return apiClient.delete<{ success: boolean; message: string }>(
      API_ROUTES.EXECUTIVE.USER(sanitizedId)
    )
  },

  /**
   * Get all users with optional filtering and pagination
   * Uses centralized buildUrl utility for consistent query parameter handling
   */
  async getUsers(params?: {
    role?: 'supervisor' | 'clinician' | 'whs_control_center'
    search?: string
    page?: number
    limit?: number
  }): Promise<ApiResult<UsersResponse>> {
    const url = buildUrl(API_ROUTES.EXECUTIVE.USERS, params)
    return apiClient.get<UsersResponse>(url)
  },

  /**
   * Get user statistics
   */
  async getStats(): Promise<ApiResult<StatsResponse>> {
    return apiClient.get<StatsResponse>(API_ROUTES.EXECUTIVE.STATS)
  },

  /**
   * Get Overall Safety Engagement (Work Readiness)
   * Uses centralized buildUrl utility for consistent query parameter handling
   */
  async getSafetyEngagement(params?: {
    startDate?: string
    endDate?: string
  }): Promise<ApiResult<SafetyEngagementResponse>> {
    const url = buildUrl(API_ROUTES.EXECUTIVE.SAFETY_ENGAGEMENT, params)
    return apiClient.get<SafetyEngagementResponse>(url)
  },
}

