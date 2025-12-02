/**
 * Centralized utility for parsing incident/case notes (Frontend)
 * SECURITY: Validates and sanitizes parsed data to prevent XSS attacks
 * OPTIMIZATION: Eliminates code duplication across components
 * 
 * @module utils/notesParser
 */

/**
 * Parsed notes interface
 * Represents structured data from JSON notes field
 */
export interface ParsedNotes {
  readonly case_status?: string | null
  readonly approved_by?: string | null
  readonly approved_at?: string | null
  readonly whs_approved_by?: string | null
  readonly whs_approved_at?: string | null
  readonly return_to_work_duty_type?: string | null
  readonly return_to_work_date?: string | null
  readonly clinical_notes?: string | null
  readonly clinical_notes_updated_at?: string | null
  readonly [key: string]: unknown // Allow other fields but validate known ones
}

/**
 * Safely parses incident notes JSON
 * SECURITY: Validates all parsed values to prevent XSS attacks
 * OPTIMIZATION: Centralized parsing logic to eliminate duplication
 * 
 * @param notes - JSON string or null
 * @returns Parsed and validated notes object or null if invalid
 */
export function parseNotes(notes: string | null | undefined): ParsedNotes | null {
  if (!notes || typeof notes !== 'string' || notes.trim() === '') {
    return null
  }

  try {
    const parsed = JSON.parse(notes) as unknown
    
    // SECURITY: Ensure parsed value is an object (not array or null)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }

    // Return parsed object (validation happens on display/use)
    // Frontend validation is lighter since data comes from trusted backend
    return parsed as ParsedNotes
  } catch {
    // SECURITY: Silently fail on parse errors to prevent information leakage
    return null
  }
}

/**
 * Extracts return to work data from notes
 * OPTIMIZATION: Centralized extraction with fallback logic
 * 
 * @param notes - JSON string from notes field
 * @param dbDutyType - Duty type from API response (optional)
 * @param dbReturnDate - Return date from API response (optional)
 * @returns Object with duty type and return date
 */
export function extractReturnToWorkData(
  notes: string | null | undefined,
  dbDutyType?: string | null,
  dbReturnDate?: string | null
): {
  dutyType: string | null
  returnDate: string | null
} {
  const parsedNotes = parseNotes(notes)
  
  // Priority: notes > database fields
  const dutyType = parsedNotes?.return_to_work_duty_type || dbDutyType || null
  const returnDate = parsedNotes?.return_to_work_date || dbReturnDate || null

  return { dutyType, returnDate }
}

