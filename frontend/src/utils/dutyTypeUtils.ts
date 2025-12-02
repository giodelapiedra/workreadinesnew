/**
 * Utility functions for formatting return to work duty types
 * SECURITY: Centralized validation and formatting to prevent XSS and ensure consistency
 * 
 * @module utils/dutyTypeUtils
 */

/**
 * Valid duty type values
 */
export type DutyType = 'modified' | 'full'

/**
 * Valid duty types array for validation
 */
const VALID_DUTY_TYPES: readonly DutyType[] = ['modified', 'full'] as const

/**
 * Validates and normalizes duty type input
 * SECURITY: Whitelist approach to prevent injection attacks
 * @param input - Input string to validate
 * @returns Validated duty type or null if invalid
 */
export function validateDutyType(input: string | null | undefined): DutyType | null {
  if (!input || typeof input !== 'string') {
    return null
  }
  
  const normalized = input.trim().toLowerCase()
  return VALID_DUTY_TYPES.includes(normalized as DutyType) ? (normalized as DutyType) : null
}

/**
 * Formats duty type for display
 * OPTIMIZATION: Centralized formatting to avoid duplication
 * @param dutyType - Duty type string to format
 * @returns Formatted label for display
 */
export function formatDutyTypeLabel(dutyType: string | null | undefined): string {
  const validated = validateDutyType(dutyType)
  
  if (!validated) {
    return 'N/A'
  }
  
  return validated === 'modified' ? 'Modified Duties' : 'Full Duties'
}

/**
 * Gets the display color for duty type badge
 * @returns Hex color code for duty type badges
 */
export function getDutyTypeColor(): string {
  return '#3B82F6' // Blue color for duty type badges
}

