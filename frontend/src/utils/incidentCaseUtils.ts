/**
 * Incident Case Utilities
 * Centralized helpers for handling incident case data
 */

export interface IncidentCase {
  id: string
  exception_type: string
  reason: string
  start_date: string
  end_date?: string
  caseStatus?: string | null  // From backend - camelCase
  status?: string  // Mapped display status
  teamName?: string  // From backend - camelCase
  team_name?: string  // Fallback for compatibility
  priority?: string
  isActive: boolean  // From backend - camelCase
  is_active?: boolean  // Fallback for compatibility
  case_status?: string  // Fallback for compatibility
}

/**
 * Get the case status from an incident, handling multiple field formats
 */
export function getCaseStatus(incident: IncidentCase): string | null {
  return incident.caseStatus || incident.case_status || incident.status || null
}

/**
 * Get the active status from an incident, handling multiple field formats
 */
export function getIsActive(incident: IncidentCase): boolean {
  return incident.isActive === true || incident.is_active === true
}

/**
 * Get the team name from an incident, handling multiple field formats
 */
export function getTeamName(incident: IncidentCase): string | null {
  return incident.teamName || incident.team_name || null
}

/**
 * Check if an incident case is active
 * A case is active if:
 * 1. isActive is true, OR
 * 2. caseStatus exists and is not 'CLOSED'
 * This includes cases with status: NEW CASE, TRIAGED, ASSESSED, IN REHAB, RETURN TO WORK, etc.
 */
export function isIncidentActive(incident: IncidentCase): boolean {
  const isActive = getIsActive(incident)
  const caseStatus = getCaseStatus(incident)
  const hasActiveStatus = caseStatus && caseStatus.toUpperCase() !== 'CLOSED'
  
  return isActive || !!hasActiveStatus
}

/**
 * Get the CSS class for incident status badge
 */
export function getIncidentStatusClass(incident: IncidentCase): 'active' | 'closed' {
  const caseStatus = getCaseStatus(incident)
  return caseStatus && caseStatus.toUpperCase() !== 'CLOSED' ? 'active' : 'closed'
}

/**
 * Filter active incidents from an array
 */
export function filterActiveIncidents(incidents: IncidentCase[]): IncidentCase[] {
  return incidents.filter(isIncidentActive)
}

/**
 * Count active incidents
 */
export function countActiveIncidents(incidents: IncidentCase[]): number {
  return filterActiveIncidents(incidents).length
}

