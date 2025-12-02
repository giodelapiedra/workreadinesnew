import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { DashboardLayout } from '../../../components/DashboardLayout'
import { Loading } from '../../../components/Loading'
import { CaseDetailModal } from './CaseDetailModal'
import { apiClient, isApiError, getApiErrorMessage } from '../../../lib/apiClient'
import { API_ROUTES } from '../../../config/apiRoutes'
import './MyTasks.css'

interface TaskCase {
  id: string
  caseNumber: string
  workerId: string
  workerName: string
  workerEmail: string
  workerInitials: string
  teamId: string
  teamName: string
  siteLocation: string
  supervisorId: string | null
  supervisorName: string
  teamLeaderId: string | null
  teamLeaderName: string
  type: string
  reason: string
  startDate: string
  endDate: string | null
  status: 'ACTIVE' | 'CLOSED' | 'IN REHAB'
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  isActive: boolean
  isInRehab: boolean
  createdAt: string
  updatedAt: string
  taskStatus?: 'todo' | 'in_progress' | 'revisions' | 'completed' // For Kanban board
  progress?: number // For rehabilitation plans
}

type TaskStatus = 'todo' | 'in_progress' | 'revisions' | 'completed'
type ViewMode = 'board' | 'list'

const TYPE_LABELS: Record<string, string> = {
  injury: 'Injury',
  accident: 'Accident',
  medical_leave: 'Medical Leave',
  other: 'Other',
}

const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
  HIGH: { bg: '#FEE2E2', color: '#EF4444' },
  MEDIUM: { bg: '#DBEAFE', color: '#3B82F6' },
  LOW: { bg: '#F3F4F6', color: '#6B7280' },
}

// Debounce hook for search optimization
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

const ITEMS_PER_PAGE = 20 // Limit items per column for performance

export function MyTasks() {
  const [cases, setCases] = useState<TaskCase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300) // Debounce search
  const [sortBy, setSortBy] = useState<'priority' | 'date' | 'worker'>('priority')
  const [viewMode, setViewMode] = useState<ViewMode>('board')
  const [taskStatuses, setTaskStatuses] = useState<Record<string, TaskStatus>>({})
  const [columnPages, setColumnPages] = useState<Record<TaskStatus, number>>({
    todo: 1,
    in_progress: 1,
    revisions: 1,
    completed: 1,
  })
  const [selectedPriority, setSelectedPriority] = useState<string>('all')
  const [selectedType, setSelectedType] = useState<string>('all')
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)

  // Load cases
  useEffect(() => {
    let isMounted = true

    const fetchCases = async () => {
      try {
        setLoading(true)
        setError('')

        const result = await apiClient.get<{ cases: TaskCase[] }>(
          `${API_ROUTES.CLINICIAN.CASES}?status=all&limit=500&_t=${Date.now()}`,
          { headers: { 'Cache-Control': 'no-cache' } }
        )

        if (isApiError(result)) {
          throw new Error(getApiErrorMessage(result) || 'Failed to fetch cases')
        }

        const data = result.data

        if (isMounted) {
          // Task statuses are managed in component state (session-only)
          // Removed localStorage usage for consistency with cookie-based app
          const statuses: Record<string, TaskStatus> = {}
          
          // Fetch rehabilitation plans to get progress
          try {
            const plansResult = await apiClient.get<{ plans: any[] }>(
              `${API_ROUTES.CLINICIAN.REHABILITATION_PLANS}?status=all`
            )
            
            let rehabPlansMap = new Map()
            if (!isApiError(plansResult)) {
              const plansData = plansResult.data
              plansData.plans?.forEach((plan: any) => {
                rehabPlansMap.set(plan.exceptionId, plan.progress || 0)
              })
            }
            
            // Assign default task status based on case status
            const casesWithStatus = (data.cases || []).map((caseItem: any) => {
              let taskStatus: TaskStatus = 'todo'
              
              // Get caseStatus from notes (if available)
              const caseStatusFromNotes = (caseItem as any).caseStatus
              
              // Check if case is closed (by status or caseStatus from notes)
              const isClosed = caseItem.status === 'CLOSED' || 
                               caseItem.status === 'closed' ||
                               caseStatusFromNotes === 'closed'
              
              // If closed, always set to completed
              if (isClosed) {
                taskStatus = 'completed'
                statuses[caseItem.id] = 'completed'
              }
              // BUSINESS RULE: If return_to_work, assign to "Revisions" (Return to Work) column
              else if (caseStatusFromNotes === 'return_to_work' || caseItem.status === 'RETURN TO WORK') {
                taskStatus = 'revisions'
                statuses[caseItem.id] = 'revisions'
              }
              // BUSINESS RULE: If assessed, assign to "In Review" column
              else if (caseStatusFromNotes === 'assessed' || caseItem.status === 'ASSESSED') {
                taskStatus = 'in_progress'
                statuses[caseItem.id] = 'in_progress'
              }
              // Check if status was saved
              else if (statuses[caseItem.id]) {
                taskStatus = statuses[caseItem.id]
              } else {
                // Assign default based on case status
                if (caseItem.status === 'IN REHAB') {
                  taskStatus = 'in_progress'
                } else if (caseItem.status === 'ACTIVE') {
                  taskStatus = 'todo'
                }
              }
              
              // Get progress from rehab plan if available
              let progress = 0
              if (caseItem.status === 'CLOSED') {
                progress = 100
              } else if (rehabPlansMap.has(caseItem.id)) {
                progress = rehabPlansMap.get(caseItem.id)
              } else if (caseItem.isInRehab) {
                progress = 60 // Default for rehab without plan data
              }
              
              return {
                ...caseItem,
                taskStatus,
                progress,
              }
            })
            
            setCases(casesWithStatus)
            setTaskStatuses(statuses)
          } catch (planErr) {
            console.error('Error fetching rehabilitation plans:', planErr)
            // Fallback without rehab plan progress
            const casesWithStatus = (data.cases || []).map((caseItem: any) => {
              let taskStatus: TaskStatus = 'todo'
              
              // Get caseStatus from notes (if available)
              const caseStatusFromNotes = (caseItem as any).caseStatus
              
              // Check if case is closed (by status or caseStatus from notes)
              const isClosed = caseItem.status === 'CLOSED' || 
                               caseItem.status === 'closed' ||
                               caseStatusFromNotes === 'closed'
              
              // If closed, always set to completed
              if (isClosed) {
                taskStatus = 'completed'
                statuses[caseItem.id] = 'completed'
              }
              // BUSINESS RULE: If return_to_work, assign to "Revisions" (Return to Work) column
              else if (caseStatusFromNotes === 'return_to_work' || caseItem.status === 'RETURN TO WORK') {
                taskStatus = 'revisions'
                statuses[caseItem.id] = 'revisions'
              }
              // BUSINESS RULE: If assessed, assign to "In Review" column
              else if (caseStatusFromNotes === 'assessed' || caseItem.status === 'ASSESSED') {
                taskStatus = 'in_progress'
                statuses[caseItem.id] = 'in_progress'
              }
              else if (statuses[caseItem.id]) {
                taskStatus = statuses[caseItem.id]
              } else {
                if (caseItem.status === 'IN REHAB') {
                  taskStatus = 'in_progress'
                }
              }
              
              return {
                ...caseItem,
                taskStatus,
                progress: isClosed ? 100 : (caseItem.isInRehab ? 60 : 0),
              }
            })
            setCases(casesWithStatus)
            setTaskStatuses(statuses)
          }
        }
      } catch (err: any) {
        console.error('Error fetching cases:', err)
        if (isMounted) {
          setError(err.message || 'Failed to load cases')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchCases()

    return () => {
      isMounted = false
    }
  }, [])

  // Update task status (session-only, no localStorage)
  const updateTaskStatus = useCallback((caseId: string, newStatus: TaskStatus) => {
    const updatedStatuses = { ...taskStatuses, [caseId]: newStatus }
    setTaskStatuses(updatedStatuses)
    
    // Update case in state
    setCases(prevCases =>
      prevCases.map(c => (c.id === caseId ? { ...c, taskStatus: newStatus } : c))
    )
  }, [taskStatuses])

  // Get avatar color (memoized)
  const getAvatarColor = useCallback((name: string) => {
    const colors = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6']
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }, [])

  // Format date (memoized)
  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }, [])

  // Filter and sort cases (optimized with debounced search)
  const filteredAndSortedCases = useMemo(() => {
    let filtered = cases

    // Priority filter
    if (selectedPriority !== 'all') {
      filtered = filtered.filter(c => c.priority === selectedPriority.toUpperCase())
    }

    // Type filter
    if (selectedType !== 'all') {
      filtered = filtered.filter(c => c.type === selectedType)
    }

    // Search filter (using debounced value)
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase()
      filtered = filtered.filter(
        c =>
          c.caseNumber.toLowerCase().includes(query) ||
          c.workerName.toLowerCase().includes(query) ||
          c.teamName.toLowerCase().includes(query) ||
          (TYPE_LABELS[c.type] || c.type).toLowerCase().includes(query)
      )
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      if (sortBy === 'priority') {
        const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 }
        return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0)
      } else if (sortBy === 'date') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      } else {
        return a.workerName.localeCompare(b.workerName)
      }
    })

    return filtered
  }, [cases, debouncedSearch, sortBy, selectedPriority, selectedType])

  // Group cases by task status and apply pagination
  const casesByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, TaskCase[]> = {
      todo: [],
      in_progress: [],
      revisions: [],
      completed: [],
    }

    filteredAndSortedCases.forEach(c => {
      const status = c.taskStatus || 'todo'
      grouped[status].push(c)
    })

    // Apply pagination per column
    const paginated: Record<TaskStatus, { items: TaskCase[], total: number, hasMore: boolean }> = {
      todo: { items: [], total: 0, hasMore: false },
      in_progress: { items: [], total: 0, hasMore: false },
      revisions: { items: [], total: 0, hasMore: false },
      completed: { items: [], total: 0, hasMore: false },
    }

    Object.keys(grouped).forEach((status) => {
      const statusKey = status as TaskStatus
      const items = grouped[statusKey]
      const page = columnPages[statusKey]
      const start = 0
      const end = page * ITEMS_PER_PAGE
      paginated[statusKey] = {
        items: items.slice(start, end),
        total: items.length,
        hasMore: items.length > end,
      }
    })

    return { grouped, paginated }
  }, [filteredAndSortedCases, columnPages])

  // Load more for a column
  const loadMore = useCallback((status: TaskStatus) => {
    setColumnPages(prev => ({
      ...prev,
      [status]: prev[status] + 1,
    }))
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent, caseId: string) => {
    e.dataTransfer.setData('caseId', caseId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault()
    const caseId = e.dataTransfer.getData('caseId')
    if (caseId) {
      updateTaskStatus(caseId, targetStatus)
    }
  }, [updateTaskStatus])

  // Format date for print
  const formatDateForPrint = useCallback((dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: '2-digit', 
      day: '2-digit', 
      year: 'numeric' 
    })
  }, [])

  // Print function
  const handlePrint = useCallback(() => {
    const printWindow = window.open('', '_blank', 'width=800,height=600')
    if (!printWindow) {
      alert('Please allow popups to print this document')
      return
    }

    const printDate = new Date().toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })

    // Group tasks by status for print
    const tasksByStatus = {
      todo: filteredAndSortedCases.filter(c => (c.taskStatus || 'todo') === 'todo'),
      in_progress: filteredAndSortedCases.filter(c => (c.taskStatus || 'todo') === 'in_progress'),
      revisions: filteredAndSortedCases.filter(c => (c.taskStatus || 'todo') === 'revisions'),
      completed: filteredAndSortedCases.filter(c => (c.taskStatus || 'todo') === 'completed'),
    }

    const statusLabels: Record<string, string> = {
      todo: 'To Do',
      in_progress: 'In Review',
      revisions: 'Return to Work',
      completed: 'Completed',
    }

    // Generate task rows HTML
    const generateTaskRows = (tasks: TaskCase[]) => {
      if (tasks.length === 0) {
        return '<div class="print-task-empty">No tasks</div>'
      }
      return tasks.map(task => {
        const priorityStyle = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.MEDIUM
        const progress = task.progress || (task.status === 'CLOSED' ? 100 : task.isInRehab ? 60 : 0)
        return `
          <div class="print-task-row">
            <div class="print-task-main">
              <div class="print-task-header-row">
                <span class="print-task-case-number">${task.caseNumber}</span>
                <span class="print-task-priority" style="background: ${priorityStyle.bg}; color: ${priorityStyle.color};">
                  ${task.priority}
                </span>
              </div>
              <div class="print-task-worker">Worker: ${task.workerName}</div>
              <div class="print-task-details">
                <span>Type: ${TYPE_LABELS[task.type] || task.type}</span>
                <span>Team: ${task.teamName || 'N/A'}</span>
                <span>Created: ${formatDateForPrint(task.createdAt)}</span>
              </div>
              ${progress > 0 ? `
              <div class="print-task-progress">
                <span>Progress: ${progress}%</span>
                <div class="print-progress-bar">
                  <div class="print-progress-fill" style="width: ${progress}%"></div>
                </div>
              </div>
              ` : ''}
            </div>
          </div>
        `
      }).join('')
    }

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>My Tasks Report</title>
          <style>
            @media print {
              @page {
                margin: 1.5cm;
                size: A4;
              }
            }
            * {
              box-sizing: border-box;
            }
            body {
              font-family: 'Arial', 'Helvetica', sans-serif;
              padding: 0;
              margin: 0;
              color: #000;
              font-size: 12px;
              line-height: 1.5;
            }
            .print-header {
              border-bottom: 3px solid #000;
              padding-bottom: 15px;
              margin-bottom: 25px;
            }
            .print-header h1 {
              margin: 0 0 8px 0;
              font-size: 28px;
              font-weight: bold;
              color: #000;
            }
            .print-header p {
              margin: 0;
              color: #666;
              font-size: 11px;
            }
            .print-stats {
              margin-bottom: 25px;
              padding: 12px;
              background: #f5f5f5;
              border-radius: 4px;
            }
            .print-stats-row {
              display: flex;
              gap: 20px;
              flex-wrap: wrap;
            }
            .print-stat-item {
              font-size: 12px;
            }
            .print-stat-label {
              font-weight: bold;
              color: #333;
            }
            .print-section {
              margin-bottom: 30px;
              page-break-inside: avoid;
            }
            .print-section h2 {
              font-size: 16px;
              font-weight: bold;
              margin: 0 0 12px 0;
              padding-bottom: 8px;
              border-bottom: 2px solid #333;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #000;
            }
            .print-task-row {
              margin-bottom: 12px;
              padding: 12px;
              border: 1px solid #ddd;
              border-radius: 4px;
              background: #fafafa;
              page-break-inside: avoid;
            }
            .print-task-main {
              width: 100%;
            }
            .print-task-header-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 8px;
            }
            .print-task-case-number {
              font-weight: bold;
              font-size: 14px;
              color: #000;
            }
            .print-task-priority {
              padding: 4px 8px;
              border-radius: 4px;
              font-size: 10px;
              font-weight: 600;
              text-transform: uppercase;
            }
            .print-task-worker {
              font-weight: 500;
              color: #333;
              margin-bottom: 6px;
            }
            .print-task-details {
              display: flex;
              gap: 16px;
              font-size: 11px;
              color: #666;
              margin-bottom: 8px;
              flex-wrap: wrap;
            }
            .print-task-progress {
              margin-top: 8px;
            }
            .print-task-progress span {
              font-size: 11px;
              color: #666;
              display: block;
              margin-bottom: 4px;
            }
            .print-progress-bar {
              width: 100%;
              height: 8px;
              background: #e0e0e0;
              border-radius: 4px;
              overflow: hidden;
            }
            .print-progress-fill {
              height: 100%;
              background: #3B82F6;
              border-radius: 4px;
              transition: width 0.3s;
            }
            .print-task-empty {
              padding: 20px;
              text-align: center;
              color: #999;
              font-style: italic;
              border: 1px dashed #ddd;
              border-radius: 4px;
            }
            @media print {
              .no-print {
                display: none !important;
              }
              body {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body>
          <div class="print-header">
            <h1>My Tasks Report</h1>
            <p>Printed on: ${printDate} | Total Tasks: ${filteredAndSortedCases.length}</p>
          </div>

          <div class="print-stats">
            <div class="print-stats-row">
              <div class="print-stat-item">
                <span class="print-stat-label">To Do:</span> ${tasksByStatus.todo.length}
              </div>
              <div class="print-stat-item">
                <span class="print-stat-label">In Review:</span> ${tasksByStatus.in_progress.length}
              </div>
              <div class="print-stat-item">
                <span class="print-stat-label">Return to Work:</span> ${tasksByStatus.revisions.length}
              </div>
              <div class="print-stat-item">
                <span class="print-stat-label">Completed:</span> ${tasksByStatus.completed.length}
              </div>
            </div>
          </div>

          ${Object.entries(tasksByStatus).map(([status, tasks]) => `
            <div class="print-section">
              <h2>${statusLabels[status]} (${tasks.length})</h2>
              ${generateTaskRows(tasks)}
            </div>
          `).join('')}
        </body>
      </html>
    `

    printWindow.document.write(printContent)
    printWindow.document.close()

    setTimeout(() => {
      printWindow.focus()
      printWindow.print()
    }, 500)
  }, [filteredAndSortedCases, formatDateForPrint])

  if (loading) {
    return (
      <DashboardLayout>
        <Loading message="Loading tasks..." size="medium" />
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="tasks-error">
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="my-tasks-container">
        {/* Header */}
        <div className="tasks-header">
          <div>
            <h1 className="tasks-title">My Tasks</h1>
            <p className="tasks-subtitle">Manage and track your tasks efficiently.</p>
          </div>
          <div className="tasks-header-actions">
            <button
              className="tasks-print-btn"
              onClick={handlePrint}
              title="Print tasks"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
              <span>Print</span>
            </button>
            <div className="tasks-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              <input
                type="text"
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="tasks-sort">
              <label>Sort by:</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
                <option value="priority">Priority</option>
                <option value="date">Date</option>
                <option value="worker">Worker</option>
              </select>
            </div>
            <div className="tasks-filter">
              <label>Priority:</label>
              <select value={selectedPriority} onChange={(e) => setSelectedPriority(e.target.value)}>
                <option value="all">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="tasks-filter">
              <label>Type:</label>
              <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                <option value="all">All</option>
                <option value="injury">Injury</option>
                <option value="accident">Accident</option>
                <option value="medical_leave">Medical Leave</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="tasks-stats">
              <span className="tasks-count">{filteredAndSortedCases.length} tasks</span>
            </div>
          </div>
        </div>

        {/* View Mode Tabs */}
        <div className="tasks-view-tabs">
          <button
            className={viewMode === 'board' ? 'active' : ''}
            onClick={() => setViewMode('board')}
          >
            Board
          </button>
          <button
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
        </div>

        {/* Kanban Board */}
        {viewMode === 'board' && (
          <div className="kanban-board">
            {/* To Do Column */}
            <div
              className="kanban-column"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'todo')}
            >
              <div className="kanban-column-header">
                <div>
                  <h3>To Do</h3>
                  <span className="kanban-count">{casesByStatus.paginated.todo.total}</span>
                </div>
              </div>
              <div className="kanban-column-content">
                {casesByStatus.paginated.todo.items.map((caseItem) => (
                  <TaskCard
                    key={caseItem.id}
                    caseItem={caseItem}
                    onDragStart={handleDragStart}
                    onCardClick={setSelectedCaseId}
                    getAvatarColor={getAvatarColor}
                    formatDate={formatDate}
                  />
                ))}
                {casesByStatus.paginated.todo.items.length === 0 && (
                  <div className="kanban-empty">No tasks</div>
                )}
                {casesByStatus.paginated.todo.hasMore && (
                  <button
                    className="kanban-load-more"
                    onClick={() => loadMore('todo')}
                  >
                    Load more ({casesByStatus.paginated.todo.total - casesByStatus.paginated.todo.items.length} remaining)
                  </button>
                )}
              </div>
            </div>

            {/* In Progress Column */}
            <div
              className="kanban-column"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'in_progress')}
            >
              <div className="kanban-column-header">
                <div>
                  <h3>In Review</h3>
                  <span className="kanban-count">{casesByStatus.paginated.in_progress.total}</span>
                </div>
              </div>
              <div className="kanban-column-content">
                {casesByStatus.paginated.in_progress.items.map((caseItem) => (
                  <TaskCard
                    key={caseItem.id}
                    caseItem={caseItem}
                    onDragStart={handleDragStart}
                    onCardClick={setSelectedCaseId}
                    getAvatarColor={getAvatarColor}
                    formatDate={formatDate}
                  />
                ))}
                {casesByStatus.paginated.in_progress.items.length === 0 && (
                  <div className="kanban-empty">No tasks</div>
                )}
                {casesByStatus.paginated.in_progress.hasMore && (
                  <button
                    className="kanban-load-more"
                    onClick={() => loadMore('in_progress')}
                  >
                    Load more ({casesByStatus.paginated.in_progress.total - casesByStatus.paginated.in_progress.items.length} remaining)
                  </button>
                )}
              </div>
            </div>

            {/* Return to Work Column (formerly Revisions) */}
            <div
              className="kanban-column"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'revisions')}
            >
              <div className="kanban-column-header">
                <div>
                  <h3>Return to Work</h3>
                  <span className="kanban-count">{casesByStatus.paginated.revisions.total}</span>
                </div>
              </div>
              <div className="kanban-column-content">
                {casesByStatus.paginated.revisions.items.map((caseItem) => (
                  <TaskCard
                    key={caseItem.id}
                    caseItem={caseItem}
                    onDragStart={handleDragStart}
                    onCardClick={setSelectedCaseId}
                    getAvatarColor={getAvatarColor}
                    formatDate={formatDate}
                  />
                ))}
                {casesByStatus.paginated.revisions.items.length === 0 && (
                  <div className="kanban-empty">No tasks</div>
                )}
                {casesByStatus.paginated.revisions.hasMore && (
                  <button
                    className="kanban-load-more"
                    onClick={() => loadMore('revisions')}
                  >
                    Load more ({casesByStatus.paginated.revisions.total - casesByStatus.paginated.revisions.items.length} remaining)
                  </button>
                )}
              </div>
            </div>

            {/* Completed Column */}
            <div
              className="kanban-column"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'completed')}
            >
              <div className="kanban-column-header">
                <div>
                  <h3>Completed</h3>
                  <span className="kanban-count">{casesByStatus.paginated.completed.total}</span>
                </div>
              </div>
              <div className="kanban-column-content">
                {casesByStatus.paginated.completed.items.map((caseItem) => (
                  <TaskCard
                    key={caseItem.id}
                    caseItem={caseItem}
                    onDragStart={handleDragStart}
                    onCardClick={setSelectedCaseId}
                    getAvatarColor={getAvatarColor}
                    formatDate={formatDate}
                  />
                ))}
                {casesByStatus.paginated.completed.items.length === 0 && (
                  <div className="kanban-empty">No tasks</div>
                )}
                {casesByStatus.paginated.completed.hasMore && (
                  <button
                    className="kanban-load-more"
                    onClick={() => loadMore('completed')}
                  >
                    Load more ({casesByStatus.paginated.completed.total - casesByStatus.paginated.completed.items.length} remaining)
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <div className="tasks-list-view">
            {filteredAndSortedCases.length === 0 ? (
              <div className="tasks-empty">
                <p>No tasks found</p>
              </div>
            ) : (
              <div className="tasks-list">
                {filteredAndSortedCases.map((caseItem) => (
                  <TaskCard
                    key={caseItem.id}
                    caseItem={caseItem}
                    onCardClick={setSelectedCaseId}
                    getAvatarColor={getAvatarColor}
                    formatDate={formatDate}
                    listView
                  />
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Case Detail Modal */}
      <CaseDetailModal
        caseId={selectedCaseId}
        onClose={() => setSelectedCaseId(null)}
        onUpdate={async () => {
          // Refresh cases when status is updated
          try {
            // Fetch updated cases
            const result = await apiClient.get<{ cases: TaskCase[] }>(
              `${API_ROUTES.CLINICIAN.CASES}?status=all&limit=500`,
              { headers: { 'Cache-Control': 'no-cache' } }
            )
            
            if (!isApiError(result)) {
              const data = result.data
              // Use existing taskStatuses from state (session-only)
              const statuses = { ...taskStatuses }
              
              const casesWithStatus = (data.cases || []).map((caseItem: any) => {
                let taskStatus: TaskStatus = 'todo'
                
                const isClosed = caseItem.status === 'CLOSED' || 
                                 caseItem.status === 'closed' ||
                                 (caseItem as any).caseStatus === 'closed'
                
                if (isClosed) {
                  taskStatus = 'completed'
                  statuses[caseItem.id] = 'completed'
                } else if (statuses[caseItem.id]) {
                  taskStatus = statuses[caseItem.id]
                } else {
                  if (caseItem.status === 'IN REHAB') {
                    taskStatus = 'in_progress'
                  } else if (caseItem.status === 'ACTIVE') {
                    taskStatus = 'todo'
                  }
                }
                
                return {
                  ...caseItem,
                  taskStatus,
                  progress: isClosed ? 100 : (caseItem.isInRehab ? 60 : 0),
                }
              })
              
              setCases(casesWithStatus)
              setTaskStatuses(statuses)
            }
          } catch (err) {
            console.error('Error refreshing cases:', err)
            // Fallback to reload if refresh fails
            window.location.reload()
          }
        }}
      />
    </DashboardLayout>
  )
}

interface TaskCardProps {
  caseItem: TaskCase
  onDragStart?: (e: React.DragEvent, caseId: string) => void
  onCardClick?: (caseId: string) => void
  getAvatarColor: (name: string) => string
  formatDate: (date: string) => string
  listView?: boolean
}

const TaskCard = memo(function TaskCard({ caseItem, onDragStart, onCardClick, getAvatarColor, formatDate, listView }: TaskCardProps) {
  const priorityStyle = PRIORITY_COLORS[caseItem.priority] || PRIORITY_COLORS.MEDIUM
  const avatarColor = getAvatarColor(caseItem.workerName)
  const progress = caseItem.progress || (caseItem.status === 'CLOSED' ? 100 : caseItem.isInRehab ? 60 : 0)

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't open modal if clicking on buttons or dragging
    if ((e.target as HTMLElement).closest('button')) return
    onCardClick?.(caseItem.id)
  }

  return (
    <div
      className={`task-card ${listView ? 'list-view' : ''}`}
      draggable={!listView}
      onDragStart={(e) => onDragStart?.(e, caseItem.id)}
      onClick={handleCardClick}
      style={{ cursor: listView ? 'default' : 'grab' }}
    >
      <div className="task-card-header">
        <span className="task-priority-badge" style={priorityStyle}>
          {caseItem.priority.toLowerCase()}
        </span>
        <button className="task-options-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="1"></circle>
            <circle cx="12" cy="5" r="1"></circle>
            <circle cx="12" cy="19" r="1"></circle>
          </svg>
        </button>
      </div>

      <div className="task-card-body">
        <div className="task-incident-type">
          Incident - {(TYPE_LABELS[caseItem.type] || caseItem.type).toLowerCase()}
        </div>
        <div className="task-case-number">{caseItem.caseNumber}</div>
        <div className="task-details">
          <div className="task-detail-item">
            <span className="task-label">Worker:</span>
            <span className="task-value">{caseItem.workerName}</span>
          </div>
          <div className="task-detail-item">
            <span className="task-label">Clinician:</span>
            <span className="task-value">Admin Clinician</span>
          </div>
          <div className="task-detail-item">
            <span className="task-label">Incident Severity:</span>
            <span className="task-value">medical_treatment</span>
          </div>
        </div>

        {progress > 0 && (
          <div className="task-progress">
            <div className="task-progress-bar">
              <div
                className="task-progress-fill"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <span className="task-progress-text">{progress}%</span>
          </div>
        )}
      </div>

      <div className="task-card-footer">
        <div className="task-assigned-avatar" style={{ backgroundColor: avatarColor }}>
          {caseItem.workerInitials}
        </div>
        <div className="task-date">{formatDate(caseItem.createdAt)}</div>
      </div>
    </div>
  )
})

