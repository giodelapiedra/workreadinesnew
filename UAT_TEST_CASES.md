# User Acceptance Testing (UAT) - Test Case Design for System Evaluation

**System:** Work Readiness Management System  
**Document Version:** 1.0  
**Date:** December 2024

## Introduction

This document outlines structured test cases for User Acceptance Testing (UAT) of the Work Readiness Management System. The test cases cover key system modules including Login & Access Control (Email and Quick Login), Worker Incident Reporting, Team Leader Incident Approval, Clinician Case Management, Daily Check-in, Schedule Management, Analytics & Reporting, and User Interface & Accessibility.

---

## Test Case Template

| Field | Description |
|-------|-------------|
| **Test Case ID** | Unique identifier (e.g., UAT-001) |
| **Test Scenario** | Short description of the feature being tested |
| **Pre-Conditions** | Requirements before executing the test |
| **Test Steps** | Step-by-step procedure |
| **Test Data** | Input values required |
| **Expected Result** | What the system should do |
| **Actual Result** | What happened when tested (to be filled during UAT) |
| **Status** | Pass/Fail |
| **Remarks** | Notes, screenshots, or issues found |

---

## Sample Test Cases

### Module 1: Login and Access Control

#### UAT-001: Verify Successful Email Login
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-001 |
| **Test Scenario** | Verify successful login with valid email and password |
| **Pre-Conditions** | User has valid account credentials (email and password) |
| **Test Steps** | 1. Navigate to login page (/login)<br>2. Ensure "Email Login" tab is selected<br>3. Enter valid email address<br>4. Enter valid password<br>5. Click "Continue" button |
| **Test Data** | Email: worker@test.com<br>Password: Test@123456 |
| **Expected Result** | User is redirected to their role-specific dashboard (e.g., /dashboard/worker for worker role). Success toast message "Login successful! Redirecting..." is displayed |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-002: Verify Login Failure with Wrong Password
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-002 |
| **Test Scenario** | Verify login failure when incorrect password is entered |
| **Pre-Conditions** | User has valid account with known email |
| **Test Steps** | 1. Navigate to login page<br>2. Select "Email Login" tab<br>3. Enter valid email address<br>4. Enter incorrect password<br>5. Click "Continue" button |
| **Test Data** | Email: worker@test.com<br>Password: WrongPass123 |
| **Expected Result** | System displays error toast message "Invalid email or password" and user remains on login page |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-003: Verify Email Format Validation
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-003 |
| **Test Scenario** | Verify login form validates email format |
| **Pre-Conditions** | User is on login page |
| **Test Steps** | 1. Navigate to login page<br>2. Select "Email Login" tab<br>3. Enter invalid email format (e.g., "notanemail")<br>4. Enter any password<br>5. Click "Continue" button |
| **Test Data** | Email: notanemail<br>Password: Test@123456 |
| **Expected Result** | System displays error toast message "Please enter a valid email address" before form submission |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-004: Verify Quick Login with 6-Digit Code
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-004 |
| **Test Scenario** | Verify successful login using 6-digit quick login code |
| **Pre-Conditions** | User has valid 6-digit quick login code assigned |
| **Test Steps** | 1. Navigate to login page<br>2. Click "Quick Login" tab<br>3. Enter 6-digit code<br>4. Click "Continue" button |
| **Test Data** | Quick Login Code: 123456 |
| **Expected Result** | User is redirected to their role-specific dashboard. Success toast message "Login successful! Redirecting..." is displayed |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-005: Verify Quick Login with Lastname-Number Format
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-005 |
| **Test Scenario** | Verify successful login using lastname-number format PIN |
| **Pre-Conditions** | User has valid PIN in format "lastname-number" |
| **Test Steps** | 1. Navigate to login page<br>2. Click "Quick Login" tab<br>3. Enter PIN in format "lastname-number"<br>4. Click "Continue" button |
| **Test Data** | Quick Login Code: delapiedra-232939 |
| **Expected Result** | User is redirected to their role-specific dashboard. Success toast message "Login successful! Redirecting..." is displayed |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-006: Verify Quick Login Format Validation
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-006 |
| **Test Scenario** | Verify quick login form validates code format |
| **Pre-Conditions** | User is on login page, Quick Login tab selected |
| **Test Steps** | 1. Navigate to login page<br>2. Click "Quick Login" tab<br>3. Enter invalid format (e.g., "abc123")<br>4. Click "Continue" button |
| **Test Data** | Quick Login Code: abc123 |
| **Expected Result** | System displays error toast message "Please enter a valid quick login code (6 digits or lastname-number format, e.g., delapiedra-232939)". Continue button is disabled |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-007: Verify Role-Based Dashboard Access
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-007 |
| **Test Scenario** | Verify user is redirected to correct dashboard based on their role |
| **Pre-Conditions** | User has valid credentials for specific role (Worker, Team Leader, Clinician, Admin, Executive) |
| **Test Steps** | 1. Login with worker credentials<br>2. Verify dashboard URL is /dashboard/worker<br>3. Verify worker-specific menu items are visible<br>4. Logout<br>5. Login with team leader credentials<br>6. Verify dashboard URL is /dashboard/team-leader<br>7. Verify team leader-specific menu items are visible |
| **Test Data** | Worker: worker@test.com / Test@123456<br>Team Leader: teamleader@test.com / Test@123456 |
| **Expected Result** | Worker redirected to /dashboard/worker with menu items: My Tasks, My Schedule, Daily Check-in, Report Incident, My Accidents. Team Leader redirected to /dashboard/team-leader with menu items: Pending Incidents, Team Members, Worker Schedules, etc. |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-008: Verify Unauthorized Route Access Prevention
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-008 |
| **Test Scenario** | Verify worker cannot access admin-only routes |
| **Pre-Conditions** | Worker user is logged in |
| **Test Steps** | 1. Login as worker<br>2. Manually navigate to /dashboard/admin/users<br>3. Observe system response |
| **Test Data** | Worker credentials: worker@test.com / Test@123456 |
| **Expected Result** | System redirects to worker dashboard (/dashboard/worker) or displays access denied. Admin routes are not accessible |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

### Module 2: Worker Incident Reporting

#### UAT-009: Verify Worker Can Report Incident
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-009 |
| **Test Scenario** | Verify worker can successfully submit an incident report |
| **Pre-Conditions** | Worker is logged in, has no active exception, and navigates to Report Incident page |
| **Test Steps** | 1. Navigate to /dashboard/worker/report-incident<br>2. Select incident type: "incident"<br>3. Enter incident description<br>4. Enter location<br>5. Select severity: "medium"<br>6. Select date (defaults to today)<br>7. Upload incident photo (optional)<br>8. Click "Submit Report" button |
| **Test Data** | Incident Type: incident<br>Description: "Fell from ladder, minor injury to left arm"<br>Location: "Construction Site A"<br>Severity: medium<br>Date: (today's date)<br>Photo: test-incident.jpg (2MB, JPG format) |
| **Expected Result** | Incident is submitted successfully. System displays success toast message. Form is reset. Incident appears in "My Accidents" page with status "Pending Approval" |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-010: Verify Worker Cannot Report with Active Exception
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-010 |
| **Test Scenario** | Verify worker cannot submit incident report when they have an active exception |
| **Pre-Conditions** | Worker is logged in and has an active exception/case |
| **Test Steps** | 1. Navigate to /dashboard/worker/report-incident<br>2. Observe form state<br>3. Attempt to fill form and submit |
| **Test Data** | Worker with active exception from previous incident |
| **Expected Result** | Form is disabled or shows message: "You already have an active incident/exception. Please wait until your current case is closed before submitting a new report." Submit button is disabled |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-011: Verify Worker Cannot Report with Pending Incident
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-011 |
| **Test Scenario** | Verify worker cannot submit new incident when they have pending incident awaiting approval |
| **Pre-Conditions** | Worker has submitted an incident that is still pending Team Leader approval |
| **Test Steps** | 1. Navigate to /dashboard/worker/report-incident<br>2. Observe form state<br>3. Attempt to fill form and submit |
| **Test Data** | Worker with pending incident submitted yesterday |
| **Expected Result** | Form shows message: "You have a pending incident report awaiting Team Leader approval. Please wait for approval or rejection before submitting a new report." Submit button is disabled |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-012: Verify Incident Report Validation - Required Fields
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-012 |
| **Test Scenario** | Verify system validates required fields before submission |
| **Pre-Conditions** | Worker is on Report Incident page, can report |
| **Test Steps** | 1. Navigate to Report Incident page<br>2. Leave description empty<br>3. Leave location empty<br>4. Click "Submit Report" button |
| **Test Data** | Description: (empty)<br>Location: (empty) |
| **Expected Result** | System displays validation errors: "Please provide a description" and "Please provide the location". Form does not submit |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-013: Verify Photo Upload Validation - File Size
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-013 |
| **Test Scenario** | Verify system validates photo file size (max 5MB) |
| **Pre-Conditions** | Worker is on Report Incident page |
| **Test Steps** | 1. Navigate to Report Incident page<br>2. Fill required fields<br>3. Upload photo larger than 5MB<br>4. Observe system response |
| **Test Data** | Photo: large-image.jpg (6MB) |
| **Expected Result** | System displays error message "Photo size must be less than 5MB". Photo is not uploaded |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-014: Verify Photo Upload Validation - File Type
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-014 |
| **Test Scenario** | Verify system only accepts image files |
| **Pre-Conditions** | Worker is on Report Incident page |
| **Test Steps** | 1. Navigate to Report Incident page<br>2. Fill required fields<br>3. Upload non-image file (e.g., PDF, DOC)<br>4. Observe system response |
| **Test Data** | File: document.pdf |
| **Expected Result** | System displays error message "Please upload an image file". File is not uploaded |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-015: Verify AI Analysis of Incident
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-015 |
| **Test Scenario** | Verify AI analysis can be generated for incident report |
| **Pre-Conditions** | Worker is on Report Incident page, can report, has filled description and location |
| **Test Steps** | 1. Navigate to Report Incident page<br>2. Fill description and location<br>3. Upload incident photo (optional)<br>4. Click "Analyze Incident" button<br>5. Wait for analysis to complete<br>6. Review AI-generated analysis |
| **Test Data** | Description: "Fell from ladder, injured left arm"<br>Location: "Construction Site A"<br>Photo: injury-photo.jpg (showing visible injury) |
| **Expected Result** | AI analysis displays with: summary, risk level (low/medium/high/critical), recommendations array, severity assessment, follow-up actions, advice. If photo included, image analysis is also shown |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-016: Verify Worker Can View Their Incident History
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-016 |
| **Test Scenario** | Verify worker can view list of their submitted incidents |
| **Pre-Conditions** | Worker is logged in and has submitted at least one incident |
| **Test Steps** | 1. Navigate to /dashboard/worker/my-accidents<br>2. View list of incidents<br>3. Click on an incident to view details |
| **Test Data** | Worker account with 3 submitted incidents (1 pending, 1 approved, 1 rejected) |
| **Expected Result** | Page displays list of all worker's incidents with: incident type, date, status (Pending Approval/Approved/Rejected), severity. Clicking an incident shows full details including photos and AI analysis |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

### Module 3: Team Leader Incident Approval

#### UAT-017: Verify Team Leader Can View Pending Incidents
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-017 |
| **Test Scenario** | Verify team leader can see pending incidents from their team members |
| **Pre-Conditions** | Team leader is logged in. At least one worker has submitted a pending incident |
| **Test Steps** | 1. Navigate to /dashboard/team-leader/pending-incidents<br>2. Verify "Pending" tab is active<br>3. View list of pending incidents<br>4. Verify incident details are displayed |
| **Test Data** | Team with 2 workers who have submitted 3 pending incidents |
| **Expected Result** | Page displays all pending incidents from team members. Each incident shows: worker name, incident type, date, description, severity, photo (if available), AI analysis (if available), and status "Pending Approval" |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-018: Verify Team Leader Can Approve Incident
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-018 |
| **Test Scenario** | Verify team leader can approve a pending incident |
| **Pre-Conditions** | Team leader is on Pending Incidents page with at least one pending incident |
| **Test Steps** | 1. Navigate to Pending Incidents page<br>2. Click on a pending incident to view details<br>3. Click "Approve" button<br>4. Enter approval notes (optional)<br>5. Confirm approval |
| **Test Data** | Pending incident from worker with valid details<br>Approval Notes: "Approved - case will be created" |
| **Expected Result** | Incident status changes to "Approved". Case is created and assigned to WHS Control Center. Team leader receives success message "Incident approved successfully! Worker has been notified." Incident moves to "Approved" tab |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-019: Verify Team Leader Can Reject Incident
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-019 |
| **Test Scenario** | Verify team leader can reject an invalid incident |
| **Pre-Conditions** | Team leader is on Pending Incidents page with at least one pending incident |
| **Test Steps** | 1. Navigate to Pending Incidents page<br>2. Click on a pending incident to view details<br>3. Click "Reject" button<br>4. Enter rejection reason (required)<br>5. Confirm rejection |
| **Test Data** | Pending incident that is invalid or incomplete<br>Rejection Reason: "Insufficient details provided. Please resubmit with more information." |
| **Expected Result** | Incident status changes to "Rejected". Worker is notified. Team leader receives success message "Incident rejected successfully! Worker has been notified." Incident moves to "Rejected" tab. No case is created |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-020: Verify Rejection Reason is Required
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-020 |
| **Test Scenario** | Verify team leader must provide rejection reason |
| **Pre-Conditions** | Team leader is viewing a pending incident |
| **Test Steps** | 1. Navigate to Pending Incidents page<br>2. Click on a pending incident<br>3. Click "Reject" button<br>4. Leave rejection reason empty<br>5. Attempt to confirm rejection |
| **Test Data** | Rejection Reason: (empty) |
| **Expected Result** | System displays error "Rejection reason is required". Rejection cannot be confirmed |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-021: Verify Team Leader Can View Approved/Rejected Incidents
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-021 |
| **Test Scenario** | Verify team leader can view approved and rejected incidents in separate tabs |
| **Pre-Conditions** | Team leader is logged in. Has approved and rejected incidents |
| **Test Steps** | 1. Navigate to /dashboard/team-leader/pending-incidents<br>2. Click "Approved" tab<br>3. View approved incidents<br>4. Click "Rejected" tab<br>5. View rejected incidents |
| **Test Data** | Team with 2 approved incidents and 1 rejected incident |
| **Expected Result** | "Approved" tab shows all approved incidents with approval date and notes. "Rejected" tab shows all rejected incidents with rejection reason and date |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

### Module 4: Daily Check-in

#### UAT-022: Verify Worker Can Submit Daily Check-in
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-022 |
| **Test Scenario** | Verify worker can successfully submit daily check-in |
| **Pre-Conditions** | Worker is logged in, has not checked in today, and navigates to Daily Check-in page |
| **Test Steps** | 1. Navigate to /dashboard/worker/daily-checkin<br>2. Set pain level (0-10 slider)<br>3. Set fatigue level (0-10 slider)<br>4. Set sleep quality (hours, 0-24)<br>5. Set stress level (0-10 slider)<br>6. Enter additional notes (optional)<br>7. Click "Submit Check-in" button |
| **Test Data** | Pain Level: 2<br>Fatigue Level: 3<br>Sleep Quality: 7 hours<br>Stress Level: 1<br>Additional Notes: "Feeling good, ready for work" |
| **Expected Result** | Check-in is submitted successfully. System displays success toast. Predicted readiness level (Green/Yellow/Red) is calculated and displayed. Check-in appears in check-in records with timestamp |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-023: Verify Worker Cannot Submit Duplicate Check-in
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-023 |
| **Test Scenario** | Verify system prevents duplicate check-in submission on same day |
| **Pre-Conditions** | Worker has already submitted check-in for today |
| **Test Steps** | 1. Navigate to Daily Check-in page<br>2. Observe page state<br>3. Attempt to submit another check-in |
| **Test Data** | Worker who submitted check-in at 8:00 AM, attempting again at 2:00 PM same day |
| **Expected Result** | Page displays message indicating check-in already submitted for today. Submit button is disabled or form shows "Already checked in" status with check-in time displayed |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-024: Verify Readiness Level Calculation
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-024 |
| **Test Scenario** | Verify system calculates readiness level based on input values |
| **Pre-Conditions** | Worker is on Daily Check-in page |
| **Test Steps** | 1. Navigate to Daily Check-in page<br>2. Set low values (pain: 0, fatigue: 0, stress: 0, sleep: 8 hours)<br>3. Observe predicted readiness<br>4. Set high values (pain: 8, fatigue: 9, stress: 8, sleep: 4 hours)<br>5. Observe predicted readiness |
| **Test Data** | Low values: Pain 0, Fatigue 0, Stress 0, Sleep 8<br>High values: Pain 8, Fatigue 9, Stress 8, Sleep 4 |
| **Expected Result** | Low values show "Green" readiness level. High values show "Red" readiness level. Medium values show "Yellow" readiness level. Readiness indicator updates in real-time as sliders are adjusted |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-025: Verify Check-in Records Display
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-025 |
| **Test Scenario** | Verify worker can view their check-in history |
| **Pre-Conditions** | Worker is logged in and has submitted multiple check-ins |
| **Test Steps** | 1. Navigate to /dashboard/worker/check-in-records<br>2. View list of check-in records<br>3. Verify dates, times, and responses are displayed |
| **Test Data** | Worker with 10 check-in records from past 2 weeks |
| **Expected Result** | Page displays chronological list of check-ins with: date, time, pain level, fatigue level, sleep quality, stress level, readiness level (Green/Yellow/Red), and additional notes. Records are sortable and filterable |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

### Module 5: Clinician Case Management

#### UAT-026: Verify Clinician Can View Assigned Cases
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-026 |
| **Test Scenario** | Verify clinician can see cases assigned to them |
| **Pre-Conditions** | Clinician is logged in. At least one case is assigned to this clinician |
| **Test Steps** | 1. Navigate to /dashboard/clinician/my-cases<br>2. View list of assigned cases<br>3. Verify case details are displayed |
| **Test Data** | Clinician with 5 assigned cases in various statuses (NEW CASE, ACTIVE, TRIAGED, ASSESSED, IN REHAB) |
| **Expected Result** | Page displays all cases assigned to clinician. Each case shows: case number, worker name, team name, type, status, priority (HIGH/MEDIUM/LOW), start date, and site location. Cases are paginated |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-027: Verify Clinician Can Search Cases
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-027 |
| **Test Scenario** | Verify clinician can search cases by name, company, position, phone, or email |
| **Pre-Conditions** | Clinician is on My Cases page with multiple cases |
| **Test Steps** | 1. Navigate to /dashboard/clinician/my-cases<br>2. Enter search query in search box<br>3. Wait for search results (debounced)<br>4. Verify filtered results |
| **Test Data** | Search Query: "John" (worker name) |
| **Expected Result** | Search results filter to show only cases matching the query. Search is debounced (waits 500ms after typing stops). Results update automatically |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-028: Verify Clinician Can Filter Active Cases Only
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-028 |
| **Test Scenario** | Verify clinician can toggle "Active" filter to show only active cases |
| **Pre-Conditions** | Clinician is on My Cases page |
| **Test Steps** | 1. Navigate to /dashboard/clinician/my-cases<br>2. Click "Active" toggle button<br>3. Verify filtered results<br>4. Click "Active" toggle again<br>5. Verify all cases are shown |
| **Test Data** | Clinician with 5 active cases and 3 closed cases |
| **Expected Result** | When "Active" is toggled ON, only active cases are displayed. When toggled OFF, all cases (active and closed) are displayed. Toggle button shows checkmark when active |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-029: Verify Clinician Can View Case Details
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-029 |
| **Test Scenario** | Verify clinician can view full case details |
| **Pre-Conditions** | Clinician is on My Cases page with at least one case |
| **Test Steps** | 1. Navigate to /dashboard/clinician/my-cases<br>2. Click on a case from the list<br>3. View case detail page |
| **Test Data** | Case ID: case-123 (Active case) |
| **Expected Result** | Case detail page displays: full worker information, case history, incident details, status, priority, dates, team information, supervisor/team leader info, and all clinical notes |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

### Module 6: Schedule Management

#### UAT-030: Verify Worker Can View Their Schedule
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-030 |
| **Test Scenario** | Verify worker can view their assigned schedule |
| **Pre-Conditions** | Worker is logged in. Team leader has assigned schedule to worker |
| **Test Steps** | 1. Navigate to /dashboard/worker/calendar<br>2. View schedule calendar<br>3. Click on a scheduled day to view details |
| **Test Data** | Worker with schedule for next 2 weeks (Monday-Friday, 8 AM - 5 PM) |
| **Expected Result** | Calendar displays worker's schedule with dates, times, and shift details. Schedule is color-coded and easy to read. Shows shift type (morning/afternoon/night/flexible) |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-031: Verify Team Leader Can Assign Schedule to Worker
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-031 |
| **Test Scenario** | Verify team leader can assign schedule to a team member |
| **Pre-Conditions** | Team leader is logged in and navigates to Worker Schedules page |
| **Test Steps** | 1. Navigate to /dashboard/team-leader/worker-schedules<br>2. Select a worker from team<br>3. Click "Assign Schedule" or similar action<br>4. Select date range<br>5. Enter shift times and type<br>6. Click "Save" button |
| **Test Data** | Worker: John Doe<br>Date Range: Dec 1-15, 2024<br>Shift Type: morning<br>Shift: 8:00 AM - 5:00 PM, Monday-Friday |
| **Expected Result** | Schedule is assigned successfully. Worker receives notification. Schedule appears in worker's calendar. Team leader sees confirmation message |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

### Module 7: User Interface & Accessibility

#### UAT-032: Verify Responsive Design on Mobile Device
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-032 |
| **Test Scenario** | Verify system is usable on mobile devices (responsive design) |
| **Pre-Conditions** | System is accessed via mobile browser (Chrome/Safari on phone) |
| **Test Steps** | 1. Open system on mobile device<br>2. Navigate to login page<br>3. Login as worker<br>4. Navigate through key pages (Dashboard, Daily Check-in, Report Incident)<br>5. Test form submission on mobile |
| **Test Data** | Mobile device: iPhone 12 or Android equivalent<br>Browser: Safari/Chrome mobile |
| **Expected Result** | All pages are properly displayed on mobile. Text is readable, buttons are tappable, forms are usable. No horizontal scrolling required. Sidebar menu is collapsible |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-033: Verify Navigation Menu Functionality
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-033 |
| **Test Scenario** | Verify sidebar navigation menu works correctly |
| **Pre-Conditions** | User is logged in and viewing dashboard |
| **Test Steps** | 1. Click on sidebar menu items<br>2. Verify page navigation<br>3. Verify active menu item is highlighted<br>4. Test menu collapse/expand (on mobile) |
| **Test Data** | Worker user with access to: Dashboard, My Schedule, Daily Check-in, Report Incident, My Accidents |
| **Expected Result** | Clicking menu items navigates to correct pages. Active page is highlighted. Menu can be collapsed/expanded. Only role-appropriate menu items are visible |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-034: Verify Form Validation Messages
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-034 |
| **Test Scenario** | Verify form validation displays clear error messages |
| **Pre-Conditions** | User is on a form page (e.g., Report Incident, Daily Check-in) |
| **Test Steps** | 1. Leave required fields empty<br>2. Enter invalid data (e.g., invalid email format)<br>3. Submit form<br>4. Observe validation messages |
| **Test Data** | Report Incident form with empty description and location fields |
| **Expected Result** | Clear validation messages appear: "Please provide a description" and "Please provide the location" for empty fields. Messages are visible and easy to understand. Form does not submit |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

#### UAT-035: Verify Loading States and Error Handling
| Field | Details |
|-------|---------|
| **Test Case ID** | UAT-035 |
| **Test Scenario** | Verify system displays loading indicators and handles errors gracefully |
| **Pre-Conditions** | User is logged in |
| **Test Steps** | 1. Submit a form (e.g., incident report)<br>2. Observe loading indicator<br>3. Simulate network error (disable internet)<br>4. Attempt to submit form<br>5. Observe error message |
| **Test Data** | Incident report submission with network interruption |
| **Expected Result** | Loading spinner/indicator appears during submission. Network error displays user-friendly message. System does not crash. User can retry after fixing connection |
| **Actual Result** | _To be filled during testing_ |
| **Status** | _Pass / Fail_ |
| **Remarks** | _Screenshots, notes, or issues_ |

---

## Test Execution Summary Template

| Module | Total Test Cases | Passed | Failed | Not Executed | Pass Rate |
|--------|----------------|--------|--------|--------------|-----------|
| Login and Access Control | 8 | _ | _ | _ | _% |
| Worker Incident Reporting | 8 | _ | _ | _ | _% |
| Team Leader Incident Approval | 5 | _ | _ | _ | _% |
| Daily Check-in | 4 | _ | _ | _ | _% |
| Clinician Case Management | 4 | _ | _ | _ | _% |
| Schedule Management | 2 | _ | _ | _ | _% |
| User Interface & Accessibility | 4 | _ | _ | _ | _% |
| **TOTAL** | **35** | _ | _ | _ | _% |

---

## Notes for Testers

1. **Test Data Preparation**: Ensure test accounts are created for each role (Worker, Team Leader, Clinician, Admin, Executive) before starting UAT. Test accounts should have proper team assignments.

2. **Quick Login Codes**: For Quick Login testing, ensure test users have valid 6-digit codes or PINs (lastname-number format) assigned.

3. **Screenshots**: Capture screenshots for all test cases, especially for failed tests, UI validation, and workflow demonstrations.

4. **Defect Logging**: Log all defects found during testing in the defect tracking system with detailed information including: steps to reproduce, expected vs actual result, screenshots, browser/device info.

5. **Environment**: All tests should be executed in the UAT environment, not production.

6. **Test Execution Order**: Execute test cases in sequence within each module for better workflow understanding. Some test cases depend on previous ones (e.g., UAT-010 requires an active exception to be created first).

7. **Incident Types**: System supports two incident types: "incident" and "near_miss". Test both types.

8. **Severity Levels**: System supports four severity levels: "low", "medium", "high", "critical". Test all levels.

9. **Case Statuses**: Clinician cases can have statuses: NEW CASE, ACTIVE, TRIAGED, ASSESSED, IN REHAB, RETURN TO WORK, CLOSED. Test status transitions.

10. **Photo Upload**: Maximum photo size is 5MB. Supported formats: JPG, PNG, GIF, WEBP. Test with various file sizes and formats.

---

**Document End**
