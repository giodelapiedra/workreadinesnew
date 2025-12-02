# 📅 Date Utils Consolidation Plan

## 🔍 Current Situation

### Frontend - DUPLICATION DETECTED ❌

**OLD (utils folder):**
- `utils/dateTime.ts` - formatTime, formatDate, formatDateDisplay, formatDateWithWeekday, normalizeTime
- `utils/dateUtils.ts` - getTodayDateString, getStartOfWeekDateString
- `utils/ageUtils.ts` - calculateAge, formatAge

**NEW (shared folder - CENTRALIZED):**
- `shared/date/date.ts` - getTodayDateString, getStartOfWeekDateString, formatDate, formatDateDisplay, formatDateWithWeekday, formatTime, normalizeTime
- `shared/date/age.ts` - calculateAge (probably)
- `shared/date/index.ts` - exports

**Problem:** 
- `PendingIncidents.tsx` uses `shared/date` ✅ (correct)
- Most other files use `utils/dateTime` or `utils/dateUtils` ❌ (old)

---

### Backend - NO DUPLICATION ✅

**Backend utils are properly separated:**
- `utils/dateTime.ts` - date/time parsing & formatting (parseTime, compareTime, formatDateString, parseDateString, normalizeDate, isDateInRange)
- `utils/dateUtils.ts` - date string generation (getTodayDateString, getTodayDate, getStartOfWeekDateString, getFirstDayOfMonthString, dateToDateString, isValidDateString)
- `utils/ageUtils.ts` - age calculations (calculateAge, validateMinimumAge, MINIMUM_AGE)

**Backend is fine - no changes needed!**

---

## 🎯 Action Plan

### Step 1: Verify shared/date has everything
- ✅ Check `shared/date/age.ts` has `calculateAge`
- ✅ Check `shared/date/index.ts` exports everything

### Step 2: Update all frontend imports
Replace all imports from:
- `utils/dateTime` → `shared/date`
- `utils/dateUtils` → `shared/date`
- `utils/ageUtils` → `shared/date`

### Step 3: Delete old utils files
- ❌ Delete `frontend/src/utils/dateTime.ts`
- ❌ Delete `frontend/src/utils/dateUtils.ts`
- ❌ Delete `frontend/src/utils/ageUtils.ts`

---

## 📊 Files to Update

Based on grep results, these files need import updates:

### Using `utils/dateTime`:
- WorkerDashboard.tsx
- WorkerCalendar.tsx
- WorkerAppointments.tsx
- DailyCheckIn.tsx
- CheckInRecords.tsx
- AccidentDetail.tsx
- WhsCaseDetail.tsx
- RecordCases.tsx
- SupervisorAnalytics.tsx
- WorkerStreakDetail.tsx
- ClinicianAnalytics.tsx
- AppointmentManagement.tsx
- ClinicianView.tsx

### Using `utils/dateUtils`:
- ReportIncident.tsx
- WorkerSchedules.tsx
- TeamMembers.tsx
- TeamLeaderDashboard.tsx
- IncidentManagement.tsx
- OverallSafetyEngagement.tsx
- ClinicianDashboard.tsx
- CaseDetailModal.tsx
- CaseDetail.tsx
- AppointmentManagement.tsx
- AdminAnalytics.tsx

### Using `utils/ageUtils`:
- validationUtils.ts
- TeamMembers.tsx
- TeamLeaderDashboard.tsx
- SupervisorTeams.tsx
- SupervisorDashboard.tsx
- Profile.tsx
- ExecutiveDashboard.tsx
- Register.tsx

---

## ✅ Already Using `shared/date`:
- PendingIncidents.tsx ✅

---

## 🚀 Next Steps

1. Verify `shared/date/age.ts` has `calculateAge`
2. Update all imports to use `shared/date`
3. Delete old utils files
4. Test everything works

