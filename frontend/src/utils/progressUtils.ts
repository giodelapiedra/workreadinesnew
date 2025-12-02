/**
 * Centralized utility for calculating worker daily progress
 * DRY: Single source of truth for progress calculation logic
 * 
 * @module utils/progressUtils
 */

/**
 * Calculates today's progress percentage based on check-in and warm-up status
 * 
 * Logic:
 * - If worker has active exception (only warm-up required):
 *   - Warm-up completed = 100%
 *   - Warm-up not completed = 0%
 * - If worker has active rehab plan (warm-up assigned):
 *   - Check-in + warm-up = 100%
 *   - Check-in only = 50%
 *   - No check-in = 0%
 * - If worker has NO active rehab plan (no warm-up assigned):
 *   - Check-in only = 100%
 *   - No check-in = 0%
 * 
 * @param checkedIn - Whether worker has completed check-in today
 * @param warmUpComplete - Whether worker has completed warm-up today (includes recovery plan day completion)
 * @param hasRehabPlan - Whether worker has an active rehabilitation plan
 * @param hasActiveException - Whether worker has an active exception (accident/injury)
 * @returns Progress percentage (0, 50, or 100)
 */
export function calculateDailyProgress(
  checkedIn: boolean,
  warmUpComplete: boolean,
  hasRehabPlan: boolean,
  hasActiveException: boolean
): number {
  // If exception exists, only warm-up is required
  if (hasActiveException) {
    // Warm-up completed = 100%, otherwise 0%
    return warmUpComplete ? 100 : 0
  }
  
  // No exception - normal logic
  if (!hasRehabPlan) {
    // No warm-up assigned - check-in alone is 100%
    return checkedIn ? 100 : 0
  }
  
  // Warm-up assigned - need both check-in and warm-up for 100%
  if (checkedIn && warmUpComplete) return 100
  if (checkedIn) return 50 // Check-in only = 50%
  return 0
}

/**
 * Gets progress message based on progress percentage and status
 * 
 * @param progress - Progress percentage (0, 50, or 100)
 * @param hasCheckedIn - Whether worker has checked in
 * @param hasActiveRehabPlan - Whether worker has active rehab plan
 * @returns User-friendly progress message
 */
export function getProgressMessage(
  progress: number,
  hasCheckedIn: boolean,
  hasActiveRehabPlan: boolean
): string {
  if (progress === 100) {
    return "🎉 Excellent! You've completed everything today!"
  }
  
  if (progress === 50) {
    return hasActiveRehabPlan
      ? "Keep up the great work! Complete your warm-up to reach 100%."
      : "Keep up the great work! One more task to complete."
  }
  
  if (hasCheckedIn && !hasActiveRehabPlan) {
    return "Great! You've completed your check-in."
  }
  
  return "Start your day by completing your check-in!"
}


