# 🗑️ Unused Files to Remove

## ❌ Frontend - Unused Components

### Supervisor Folder (NOT imported in App.tsx)
- `frontend/src/pages/dashboard/supervisor/TeamLeaderSchedules.tsx` ❌
- `frontend/src/pages/dashboard/supervisor/TeamLeaderSchedules.css` ❌
- `frontend/src/pages/dashboard/supervisor/TeamLeadersPerformance.tsx` ❌
- `frontend/src/pages/dashboard/supervisor/TeamLeadersPerformance.css` ❌

**Reason:** These components are NOT imported in `App.tsx`, NOT in routes, NOT in Sidebar. They are dead code.

---

## 📝 Documentation Files (Optional - can keep or remove)

These are analysis/documentation files that might come back from GitHub. You can keep them for reference or remove them:

### Root Level
- `FRONTEND_CLEANUP_SUMMARY.md`
- `FRONTEND_OPTIMIZATION_CHANGES.md`
- `WORKER_SCHEDULES_IMPLEMENTATION.md`
- `VERCEL_DEPLOYMENT_GUIDE.md`
- `URGENT_RUN_THIS_MIGRATION.md`
- `TEST_SESSION_FIX.md`
- `SYSTEM_WORKFLOW.md`
- `SESSION_ISOLATION_FIX.md`
- `SESSION_ISOLATION_AUDIT.md`
- `SESSION_CONFLICT_FIX.md`
- `SERVICE_ROLE_AUDIT.md`
- `SECURITY_AUDIT.md`
- `ROUTING_SECURITY_GUIDE.md`
- `ROUTING_IMPROVEMENTS_SUMMARY.md`
- `ROLE_BASED_ROUTING_FIX.md`
- `QUICK_FIX_FIRST_NAME_ERROR.md`
- `LOGOUT_AND_NAME_FIX.md`
- `FIRST_LAST_NAME_UPDATE.md`
- `FIX_CACHE_AND_ORPHANED_MEMBERS.md`
- `FIX_UNKNOWN_NAMES.md`
- `COOKIE_ISOLATION_EXPLAINED.md`
- `DAILY_CHECKIN_IMPLEMENTATION.md`
- `CACHE_AND_SECURITY_OPTIMIZATION.md`
- `AUTH_FLOW_FIX.md`
- `SECURITY_AUDIT_REPORT.md`
- `UAT_ACTIVITY_4_ROLES_AND_RESPONSIBILITIES.md`
- `UAT_TEST_CASES.md`

### Frontend Folder
- `frontend/FRONTEND_ANALYSIS.md`
- `frontend/FRONTEND_OPTIMIZATION_CHANGES.md`
- `frontend/src/components/incident/README.md`

### Backend Folder
- `backend/UNUSED_CODE_ANALYSIS.md`
- `backend/VPS_SETUP_GUIDE.md` (keep if you use VPS)
- `backend/QUICK_START.md` (keep if you use VPS)

---

## ✅ Files That ARE Used (DO NOT REMOVE)

### Backend Routes (all used in index.ts)
- ✅ `backend/src/routes/auth.ts`
- ✅ `backend/src/routes/teams.ts`
- ✅ `backend/src/routes/checkins.ts`
- ✅ `backend/src/routes/supervisor.ts`
- ✅ `backend/src/routes/schedules.ts`
- ✅ `backend/src/routes/whs.ts`
- ✅ `backend/src/routes/clinician.ts`
- ✅ `backend/src/routes/worker.ts`
- ✅ `backend/src/routes/admin.ts`
- ✅ `backend/src/routes/executive.ts`

### Backend Utils (all used)
- ✅ `backend/src/utils/adminClient.ts`
- ✅ `backend/src/utils/ageUtils.ts`
- ✅ `backend/src/utils/caseStatus.ts`
- ✅ `backend/src/utils/cursorPagination.ts`
- ✅ `backend/src/utils/dateTime.ts`
- ✅ `backend/src/utils/dateUtils.ts`
- ✅ `backend/src/utils/exceptionUtils.ts`
- ✅ `backend/src/utils/executiveHelpers.ts`
- ✅ `backend/src/utils/incidentApproval.ts` (NEW - used in teams.ts and worker.ts)
- ✅ `backend/src/utils/notesParser.ts`
- ✅ `backend/src/utils/notificationUtils.ts` (NEW - used in incidentApproval.ts)
- ✅ `backend/src/utils/openai.ts`
- ✅ `backend/src/utils/quickLoginCode.ts`
- ✅ `backend/src/utils/scheduleUtils.ts`
- ✅ `backend/src/utils/userCreation.ts`
- ✅ `backend/src/utils/userUtils.ts`
- ✅ `backend/src/utils/validationUtils.ts`

### Frontend Pages (all imported in App.tsx)
- ✅ All worker pages
- ✅ All supervisor pages (EXCEPT TeamLeaderSchedules & TeamLeadersPerformance)
- ✅ All team-leader pages (including NEW PendingIncidents)
- ✅ All clinician pages
- ✅ All admin pages
- ✅ All whs-control-center pages
- ✅ All executive pages

---

## 🎯 Action Items

1. **Delete unused supervisor components:**
   ```bash
   rm frontend/src/pages/dashboard/supervisor/TeamLeaderSchedules.tsx
   rm frontend/src/pages/dashboard/supervisor/TeamLeaderSchedules.css
   rm frontend/src/pages/dashboard/supervisor/TeamLeadersPerformance.tsx
   rm frontend/src/pages/dashboard/supervisor/TeamLeadersPerformance.css
   ```

2. **Update .gitignore** to prevent documentation files from being tracked (optional)

3. **Commit and push** to GitHub so these changes persist

