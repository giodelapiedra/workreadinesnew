/**
 * Check-ins Service
 * Centralized check-ins API calls
 */

import { apiClient } from '../lib/apiClient'
import type { ApiResult } from '../lib/apiClient'
import { API_ROUTES } from '../config/apiRoutes'
import { buildUrl, sanitizeId } from '../utils/queryBuilder'

export interface CheckInRequest {
  readiness_score: number
  pain_level?: number
  notes?: string
  warm_up_completed?: boolean
}

export interface CheckIn {
  id: string
  user_id: string
  readiness_score: number
  pain_level?: number
  notes?: string
  warm_up_completed: boolean
  check_in_time: string
  created_at: string
}

export const checkinsService = {
  /**
   * Submit check-in
   */
  async submitCheckIn(data: CheckInRequest): Promise<ApiResult<{ checkin: CheckIn }>> {
    return apiClient.post<{ checkin: CheckIn }>(API_ROUTES.CHECKINS.SUBMIT, data)
  },

  /**
   * Get today's check-in
   */
  async getTodayCheckIn(): Promise<ApiResult<{ checkin: CheckIn | null }>> {
    return apiClient.get<{ checkin: CheckIn | null }>(API_ROUTES.CHECKINS.TODAY)
  },

  /**
   * Get check-in history
   */
  async getCheckInHistory(params?: {
    limit?: number
    page?: number
    offset?: number
  }): Promise<ApiResult<{ 
    checkIns?: CheckIn[]
    checkins?: CheckIn[]
    total?: number
    pagination?: {
      page: number
      limit: number
      total: number
      totalPages: number
      hasNext: boolean
      hasPrev: boolean
    }
  }>> {
    const url = buildUrl(API_ROUTES.CHECKINS.HISTORY, params)
    return apiClient.get<{ 
      checkIns?: CheckIn[]
      checkins?: CheckIn[]
      total?: number
      pagination?: {
        page: number
        limit: number
        total: number
        totalPages: number
        hasNext: boolean
        hasPrev: boolean
      }
    }>(url)
  },

  /**
   * Get team check-ins
   */
  async getTeamCheckIns(params?: {
    date?: string
    team_id?: string
  }): Promise<ApiResult<{ checkins: CheckIn[] }>> {
    // Sanitize team_id if provided
    const sanitizedParams = params?.team_id
      ? { ...params, team_id: sanitizeId(params.team_id) }
      : params
    const url = buildUrl(API_ROUTES.CHECKINS.TEAM, sanitizedParams)
    return apiClient.get<{ checkins: CheckIn[] }>(url)
  },

  /**
   * Get check-in analytics
   */
  async getCheckInAnalytics(params?: {
    start_date?: string
    end_date?: string
    team_id?: string
  }): Promise<ApiResult<any>> {
    // Sanitize team_id if provided
    const sanitizedParams = params?.team_id
      ? { ...params, team_id: sanitizeId(params.team_id) }
      : params
    const url = buildUrl(API_ROUTES.CHECKINS.ANALYTICS, sanitizedParams)
    return apiClient.get(url)
  },

  /**
   * Mark warm-up as complete
   */
  async markWarmUpComplete(): Promise<ApiResult<{ message: string }>> {
    return apiClient.post<{ message: string }>(API_ROUTES.CHECKINS.WARM_UP)
  },
}

