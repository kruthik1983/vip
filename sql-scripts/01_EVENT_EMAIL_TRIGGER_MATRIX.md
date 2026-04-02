-- ============================================================================
-- VIRTUAL INTERVIEW PLATFORM - EVENT & EMAIL TRIGGER MATRIX (MVP)
-- ============================================================================
-- Complete mapping of all events, conditions, triggers, and email workflows
-- All timings in UTC
-- ============================================================================

-- ============================================================================
-- 1. ORGANIZATION ONBOARDING FLOW
-- ============================================================================

EVENT: ORG_REQUEST_SUBMITTED
TRIGGER: INSERT into organization_requests with status='SUBMITTED'
ACTION: Admin receives notification in dashboard (no email for MVP)
        Store event in audit_logs

EVENT: ORG_REQUEST_REVIEWED_ACCEPTED
TRIGGER: UPDATE organization_requests SET status='ACCEPTED' by admin
EMAIL TYPE: ORG_REQUEST_ACCEPTED
RECIPIENT: organization_email (from org_requests)
SEND IMMEDIATELY: timestamp = NOW()
IDEMPOTENCY: (org_request_id, notification_type, timestamp)
PAYLOAD:
  - Organization name
  - Admin login credentials (username, temp password)
  - Portal access link
  - Instructions for HR onboarding
AUDIT: Log reviewer ID, decision time, and decision

EVENT: ORG_REQUEST_REVIEWED_REJECTED
TRIGGER: UPDATE organization_requests SET status='REJECTED', rejection_reason=<text> by admin
EMAIL TYPE: ORG_REQUEST_REJECTED
RECIPIENT: organization_email (from org_requests)
SEND IMMEDIATELY: timestamp = NOW()
IDEMPOTENCY: (org_request_id, notification_type, timestamp)
PAYLOAD:
  - Organization name
  - Generic rejection message: "We've reviewed your request. Unfortunately, we cannot onboard at this time. For further details, please contact our support team."
  - Support email/phone
AUDIT: Log reviewer ID, decision time, rejection_reason

-- ============================================================================
-- 2. INTERVIEW CREATION & PUBLICATION FLOW
-- ============================================================================

EVENT: INTERVIEW_CREATED
TRIGGER: INSERT into interviews with status='DRAFT'
ACTION: Store in audit_logs (no email)

EVENT: INTERVIEW_PUBLISHED
TRIGGER: UPDATE interviews SET status='PUBLISHED', published_at=NOW()
CONDITIONS:
  - All slots must have interview_id populated
  - At least one assessment_question_set created with questions
  - Interview start/end times must be in future (>= NOW() + 24 hours for lock window)
ACTION: 
  - Lock timings via trigger (prevent future edits)
  - Store event in audit_logs
  - Generate unique candidate application form URL
  - NO EMAIL (internal HR action)

EVENT: INTERVIEW_LOCKED_AUTO
TRIGGER: Scheduled job runs every 30 minutes at :00 and :30
CONDITION: NOW() >= (interview.assessment_start_utc - INTERVAL '24 hours')
         AND interview.status = 'PUBLISHED'
         AND interview.locked_at IS NULL
ACTION:
  - UPDATE interviews SET status='LOCKED', locked_at=NOW()
  - Trigger audit log
  - NO EMAIL

-- ============================================================================
-- 3. CANDIDATE APPLICATION FLOW
-- ============================================================================

EVENT: CANDIDATE_APPLICATION_SUBMITTED
TRIGGER: INSERT into applications with status='APPLIED'
         INSERT 1-3 rows into application_slot_preferences
CONDITIONS:
  - interview.status = 'PUBLISHED'
  - current_time < (assessment_start_utc - INTERVAL '24 hours') -- application cutoff
  - resume file uploaded (PDF, <= 2MB, scanned for virus)
ACTION:
  - Create assessment_attempt placeholder (not yet started)
  - Create interview_session placeholder
  - Send email type: APPLICATION_RECEIVED
  - Schedule email type: ASSESSMENT_MAIL_2H_BEFORE (for 2 hours before assigned slot)
  - Trigger audit log

EMAIL TYPE: APPLICATION_RECEIVED
RECIPIENT: candidate_email (from applications)
SEND IMMEDIATELY: timestamp = NOW()
IDEMPOTENCY: (application_id, notification_type, timestamp)
PAYLOAD:
  - Candidate name
  - Job position applied for
  - Job description excerpt
  - Message: "Thank you for applying to [position]. We have received your application and will notify you with next steps within 24 hours."
  - Support email

EVENT: SLOT_ASSIGNMENT_BATCH_JOB
TRIGGER: Scheduled job runs ONCE at (assessment_start_utc - INTERVAL '25 hours') UTC
CONDITIONS:
  - Find all applications with status='APPLIED' for this interview
  - Match application_slot_preferences to available interview_slots (considering max_candidates and preference_rank)
  - Assign one slot per application (greedy: rank 1, then rank 2, then rank 3)
  - If no slot available for a candidate, set assigned_slot_id=NULL and status stays 'APPLIED' (no email)

ACTION (if slot assigned):
  - UPDATE applications SET assigned_slot_id=<slot_id>, status='SLOT_ASSIGNED', slot_assigned_at=NOW()
  - Increment interview_slots.assigned_candidates
  - Create notification event: SLOT_ASSIGNED (scheduled 2 hours before slot)
  - Trigger audit log

EMAIL TYPE: SLOT_ASSIGNED (same as ASSESSMENT_MAIL_2H_BEFORE)
RECIPIENT: candidate_email
SEND AT: scheduled_send_at = slot_start_utc - INTERVAL '2 hours'
IDEMPOTENCY: (application_id, notification_type, scheduled_send_at)
PAYLOAD:
  - Candidate name
  - Job position
  - Assessment date/time (in UTC + timezone label)
  - Assessment duration: 20 minutes
  - Login credentials: (username, temporary password)
  - Assessment access link (NOT LIVE YET - will activate at slot_start - 2h)
  - Assessment instructions:
    * You will have 20 minutes for MCQ assessment
    * Followed immediately by 40-minute interview round
    * Webcam + microphone testing required for interview
    * Consent required for recording
    * Must maintain full-screen throughout
    * Tab-switching will be logged (informational only)
  - System requirements checklist
  - Support contact

EVENT: ASSESSMENT_REMINDER_24H
TRIGGER: Scheduled job runs ONCE at (slot_start_utc - INTERVAL '24 hours') UTC
CONDITIONS:
  - Find all applications with status='SLOT_ASSIGNED' where assigned_slot_id.slot_start_utc = NOW() + INTERVAL '24 hours'

EMAIL TYPE: ASSESSMENT_REMINDER_24H
RECIPIENT: candidate_email
SEND AT: NOW()
IDEMPOTENCY: (application_id, notification_type, "24h_before_slot")
PAYLOAD:
  - Candidate name
  - Job position
  - Assessment date/time (in UTC)
  - Reminder message: "Your assessment is scheduled for [date/time UTC]. Please ensure you have a quiet environment, webcam, and microphone working."
  - Link to test device (video call simulator)
  - Support contact

-- ============================================================================
-- 4. ASSESSMENT SESSION FLOW
-- ============================================================================

EVENT: CANDIDATE_ASSESSMENT_LOGIN_ATTEMPT
TRIGGER: Candidate navigates to assessment link with session token
CONDITION CHECK (must all pass):
  1. session_token exists in assessment_attempts table
  2. NOW() >= (assigned_slot.slot_start_utc - INTERVAL '2 hours')
  3. NOW() < (assigned_slot.slot_start_utc)
  4. assessment_attempt.status NOT IN ('COMPLETED', 'NO_SHOW', 'FAILED_PARTIAL')
  5. session_valid_until > NOW()

VALIDATION PASS:
  - Serve assessment UI with instructions
  - Require checkbox: "I have read and understand all guidelines"
  - Display fullscreen + tab-switch warnings
  - Sync with recording start (if enabled)

VALIDATION FAIL:
  - Return 403 with reason code:
    * LOGIN_WINDOW_NOT_OPEN: "Assessment access opens at [slot_start - 2h UTC]"
    * LOGIN_WINDOW_CLOSED: "Assessment access closed at [slot_start UTC]"
    * SESSION_EXPIRED: "Your session token has expired"
    * ALREADY_COMPLETED: "You have already completed this assessment"
  - Trigger audit log with attempt details

EVENT: ASSESSMENT_STARTED
TRIGGER: Candidate clicks "Start Assessment" after guidelines checkbox
ACTION:
  - UPDATE assessment_attempts SET started_at=NOW(), status='ASSESSMENT_IN_PROGRESS'
  - Start timer (20 minutes)
  - Load UNIQUE randomized question set for this candidate from assessment_question_sets
  - Start webcam proctoring (tab-switch logging, face detection)
  - Trigger audit log

EVENT: ASSESSMENT_SUBMITTED
TRIGGER: Candidate clicks "Submit" OR timer reaches 20 minutes
ACTION:
  - UPDATE assessment_attempts SET submitted_at=NOW(), status='COMPLETED'
  - Calculate score from assessment_responses (positive scoring only; correct / total_questions * 100)
  - UPDATE assessment_attempts SET score=<calculated_percentage>
  - Save all proctoring flags (informational only; not auto-fail)
  - Stop recording
  - Generate AI_REPORT with assessment_score
  - Immediately transition to interview round (no email, direct UI flow)
  - Trigger audit log

EVENT: ASSESSMENT_ABANDONED_OR_NO_SHOW
TRIGGER: Timer expires with no submission OR candidate doesn't start within 15 min of window opening
ACTION:
  - UPDATE applications SET status='NO_SHOW'
  - UPDATE assessment_attempts SET status='NO_SHOW'
  - Block any further attempts
  - Trigger audit log
  - NO EMAIL (candidate will see status in dashboard later)

-- ============================================================================
-- 5. INTERVIEW SESSION FLOW
-- ============================================================================

EVENT: CANDIDATE_INTERVIEW_PRECHECK
TRIGGER: Assessment completed; candidate auto-redirected to interview prep
ACTION:
  - Display device checklist (webcam, microphone, internet)
  - Require consent checkboxes:
    1. "I consent to video recording"
    2. "I consent to audio recording"
    3. "I understand recording will be stored for evaluation"
  - Require checkbox: "I have read and understand interview guidelines"
  - Create consents records (one per checkbox)

EVENT: INTERVIEW_STARTED
TRIGGER: Candidate clicks "Start Interview" after all consent checkboxes
ACTION:
  - INSERT into interview_sessions (session_token, session_valid_from, session_valid_until)
  - session_valid_from = NOW()
  - session_valid_until = NOW() + INTERVAL '80 minutes' (40-min interview + 40-min buffer)
  - UPDATE applications SET status='INTERVIEW_IN_PROGRESS'
  - Start recording (video + audio)
  - Load first AI-generated or fallback interview question
  - Start 40-minute timer
  - Trigger audit log

EVENT: INTERVIEW_QUESTION_GENERATED
TRIGGER: AI service successfully generates next question
ACTION:
  - INSERT into interview_responses (question_text, asked_at)
  - Display question UI
  - Start question timer (no hard per-question limit; for analytics)

EVENT: INTERVIEW_QUESTION_GENERATION_FAILED
TRIGGER: AI service times out or returns error after 3 retries
ACTION:
  - Fall back to predefined interview_fallback_questions
  - Load next fallback question in sequence
  - Continue interview flow (no interruption, no error shown to candidate)
  - Log fallback usage in interview_sessions

EVENT: INTERVIEW_ANSWERED
TRIGGER: Candidate submits answer via text/voice input
ACTION:
  - INSERT into interview_responses (candidate_answer, answered_at, question_duration_seconds)
  - Generate next question (AI or fallback)

EVENT: INTERVIEW_SUBMITTED_EARLY
TRIGGER: Candidate clicks "End Interview" before 40 minutes
ACTION:
  - UPDATE interview_sessions SET ended_at=NOW(), status='COMPLETED'
  - Calculate interview_sessions.duration_seconds
  - Stop recording
  - Generate AI_REPORT (transcript + strengths/weaknesses + hire_recommendation)
  - Generate complete candidate packet
  - Trigger audit log
  - NO EMAIL (HR reviews in dashboard)

EVENT: INTERVIEW_TIMEOUT
TRIGGER: Timer reaches 40 minutes
ACTION:
  - Auto-submit interview (same as INTERVIEW_SUBMITTED_EARLY)

EVENT: INTERVIEW_COMPLETED
TRIGGER: Interview session saved with status='COMPLETED'
ACTION:
  - UPDATE applications SET status='COMPLETED'
  - Update retention_until on recordings (180 days from now)
  - Generate final consolidated AI_REPORT
  - Revoke all session tokens (prevent re-access)
  - Block any further UI access to assessment/interview
  - Trigger audit log
  - NO EMAIL to candidate (will get result mail later)

-- ============================================================================
-- 6. HR DECISION & OUTCOME FLOW
-- ============================================================================

EVENT: HR_REVIEWS_CANDIDATE
TRIGGER: HR navigates to candidate detail page in HR dashboard
CONDITIONS:
  - applications.status = 'COMPLETED'
  - Can view: assessment score, assessment MC responses, interview transcript, interview recording, proctoring flags, AI report

PAYLOAD AVAILABLE:
  - Assessment score (percentage)
  - Assessment details (questions, candidate answers, correct answers)
  - Interview transcript (Q&A pairs from interview_responses)
  - Interview recording (with playback)
  - Proctoring flags (informational; tab-switches, face absent, etc.)
  - AI-generated report: strengths, weaknesses, hire_recommendation
  - Candidate resume (PDF)
  - Application date/time

EVENT: HR_DECIDES_CANDIDATE (SINGLE)
TRIGGER: HR clicks "Accept" or "Reject" on individual candidate
ACTION:
  - INSERT into hr_decisions (application_id, decision='ACCEPT'|'REJECT', decided_by=<user_id>, decided_at=NOW(), notes=<optional>)
  - UPDATE applications SET status='ACCEPTED'|'REJECTED'
  - Store event in audit_logs
  - Trigger audit log
  - NO EMAIL YET (only sent in bulk workflow or at report end)

EVENT: HR_DECIDES_BULK (MULTIPLE)
TRIGGER: HR selects multiple candidates (checkboxes) and clicks "Bulk Decision"
ACTION:
  - For each selected candidate:
    - INSERT into hr_decisions with bulk_batch_id (for analytics)
    - UPDATE applications SET status='ACCEPTED'|'REJECTED'
  - Trigger audit log for each
  - NO EMAIL YET

EVENT: HR_EXPORTS_TO_EXCEL
TRIGGER: HR clicks "Download Candidate Report"
CONDITIONS:
  - interview.status in ('IN_PROGRESS', 'CLOSED')
  - Can export only candidates with status in ('ACCEPTED', 'REJECTED', 'COMPLETED')

EXPORT COLUMNS (fixed):
  1. Candidate Name
  2. Candidate Email
  3. Candidate Phone
  4. Job Position
  5. Application Date (UTC)
  6. Assigned Slot Start (UTC)
  7. Assessment Score (%)
  8. Assessment Duration (sec)
  9. Interview Score (%)
  10. Interview Duration (sec)
  11. AI Hire Recommendation
  12. HR Decision (ACCEPT/REJECT)
  13. HR Notes
  14. Resume File Name
  15. Interview Recording File Name
  16. Proctoring Flags Count
  17. Application Status

FORMAT: Excel .xlsx with filtered/frozen header row, auto-fit columns

EVENT: INTERVIEW_CLOSED (END OF HIRING)
TRIGGER: HR manually clicks "Close Interview" OR auto-close at interview_end_utc
ACTION:
  - UPDATE interviews SET status='CLOSED'
  - Find all applications with status='ACCEPTED' or 'REJECTED'
  - For each, create notification_events type: CANDIDATE_DECISION_ACCEPTED | CANDIDATE_DECISION_REJECTED
  - Schedule immediate send (NOW())
  - Trigger audit log

EMAIL TYPE: CANDIDATE_DECISION_ACCEPTED
RECIPIENT: candidate_email (only if hr_decisions.decision='ACCEPT')
SEND AT: NOW()
IDEMPOTENCY: (application_id, "ACCEPT_DECISION")
PAYLOAD:
  - Candidate name
  - Job position
  - Message: "Congratulations! We are excited to inform you that you have been selected for [position]. Our HR team will contact you shortly with next steps."
  - Next steps information (expected date for contact, expected offer timeline)
  - Support contact

EMAIL TYPE: CANDIDATE_DECISION_REJECTED
RECIPIENT: candidate_email (only if hr_decisions.decision='REJECT' OR status='NO_SHOW'|'FAILED_PARTIAL')
SEND AT: NOW()
IDEMPOTENCY: (application_id, "REJECT_DECISION")
PAYLOAD:
  - Candidate name
  - Job position
  - Message: "Thank you for your interest in the [position] role. We appreciate the time you spent with us. Unfortunately, we have decided to move forward with other candidates. We encourage you to apply for future openings that match your profile."
  - Feedback: (Generic - "We felt there was a better fit for this role")
  - Support contact

-- ============================================================================
-- 7. NOTIFICATION DELIVERY & RETRY LOGIC
-- ============================================================================

NOTIFICATION QUEUE PROCESSING (Background Job - Every 5 minutes):
  1. Query notification_events WHERE status='PENDING' AND scheduled_send_at <= NOW()
  2. For each event:
     a. Validate recipient email is not in bounce/block list
     b. Build email (subject, body, headers)
     c. Send via email provider (SES / SendGrid / similar)
     d. If success (2xx status):
        - INSERT notification_deliveries with status='SENT'
        - UPDATE notification_events SET status='SENT'
     e. If failure (5xx, timeout, or rate limit):
        - INSERT notification_deliveries with status='FAILED'
        - If attempt_number < 5:
          - Reschedule: notification_events.scheduled_send_at = NOW() + INTERVAL '5 minutes' * attempt_number
          - Set status='PENDING'
        - Else:
          - UPDATE notification_events SET status='FAILED'
          - Log permanent failure to audit_logs

IDEMPOTENCY:
  - All notification_events have idempotency_key = HASH(application_id + notification_type + timestamp_bucket)
  - Check UNIQUE constraint on idempotency_key before INSERT
  - Prevents duplicate sends if request is retried

-- ============================================================================
-- 8. SCHEDULED BACKGROUND JOBS
-- ============================================================================

JOB: auto_lock_interviews
SCHEDULE: Every 30 minutes at :00 and :30
CONDITION: NOW() >= (interview.assessment_start_utc - INTERVAL '24 hours')
          AND interview.status = 'PUBLISHED'
ACTION: UPDATE interviews SET status='LOCKED' (via trigger above)

JOB: auto_assign_candidate_slots
SCHEDULE: ONCE at (interview.assessment_start_utc - INTERVAL '25 hours') for each interview
ACTION: Match applications to slots based on preferences and capacity

JOB: send_24h_reminders
SCHEDULE: Every 30 minutes at :00 and :30
CONDITION: NOW() = (assigned_slot.slot_start_utc - INTERVAL '24 hours') ± 5 min
ACTION: Send ASSESSMENT_REMINDER_24H email

JOB: process_notification_queue
SCHEDULE: Every 5 minutes
ACTION: Send pending notifications with retry logic (see above)

JOB: auto_delete_old_recordings
SCHEDULE: Daily at 02:00 UTC
CONDITION: recordings.retention_until <= NOW()
ACTION: Delete recording files from storage, remove DB records

JOB: detect_no_show_candidates
SCHEDULE: Every 30 minutes after assessment_start_utc
CONDITION: assessments that started BUT never submitted within assessment grace period
ACTION: Mark as NO_SHOW (see above)

JOB: generate_final_reports
SCHEDULE: Every 1 hour
CONDITION: interview_sessions with status='COMPLETED' and no ai_report yet
ACTION: Call AI service for report generation

-- ============================================================================
-- 9. ERROR HANDLING & EDGE CASES
-- ============================================================================

EDGE CASE: Candidate loses internet during assessment
HANDLING:
  - Session remains active until session_valid_until expires (2 hours from start)
  - If candidate logs back in within window: resume assessment (same attempt_id)
  - If not rejoined by end of assessment window: mark NO_SHOW

EDGE CASE: Candidate loses internet during interview
HANDLING:
  - Session remains active until session_valid_until expires (80 minutes from start)
  - If candidate logs back in within window: resume interview (same session_id, continue from last question)
  - If not rejoined by end: auto-close interview, generate report on transcript so far

EDGE CASE: Assessment question generation fails completely (after retries)
HANDLING:
  - Immediately switch to fallback questions
  - Continue uninterrupted for candidate
  - No error UI; seamless transition
  - Log issue for debugging

EDGE CASE: HR tries to edit interview timing after PUBLISHED
HANDLING:
  - DB trigger blocks UPDATE
  - Return error: "Interview timings are locked and cannot be edited after publication."

EDGE CASE: Candidate applies after auto-close window
HANDLING:
  - Reject application form submission
  - Show message: "Applications for this interview have closed as it starts within 24 hours."

EDGE CASE: Recording storage fails during interview
HANDLING:
  - Continue interview (don't block candidate)
  - Log failure to audit_logs
  - Alert ops team
  - Attempt retry upload after interview completes
  - If persistent failure: flag in HR dashboard with message

-- ============================================================================
-- END OF EVENT MATRIX
-- ============================================================================
