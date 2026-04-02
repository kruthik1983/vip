-- ============================================================================
-- VIRTUAL INTERVIEW PLATFORM - STATE MACHINES & STATUS FLOW
-- ============================================================================

-- ============================================================================
-- 1. ORGANIZATION REQUEST STATE MACHINE
-- ============================================================================

[ORG_ONBOARDING]

States:
  - SUBMITTED: Initial state; request filed by organization
  - UNDER_REVIEW: Admin has viewed, may request clarifications
  - ACCEPTED: Admin approved; organization created, credentials sent
  - REJECTED: Admin declined; rejection reason sent

Transitions:
  SUBMITTED -> UNDER_REVIEW
    Trigger: Admin clicks "Review" (log action with admin_user_id)
    Validation: Request must have required fields

  UNDER_REVIEW -> ACCEPTED
    Trigger: Admin clicks "Approve"
    Validation: All required fields populated
    Side effects:
      - CREATE organization record
      - CREATE org_admin user record with credentials
      - Send ORG_REQUEST_ACCEPTED email
      - Audit log: org_created

  UNDER_REVIEW -> SUBMITTED
    Trigger: Admin clicks "Request more info" (loops back)
    Validation: Email candidate for clarification
    Side effects: Audit log

  UNDER_REVIEW -> REJECTED
    Trigger: Admin clicks "Reject", fills rejection_reason
    Validation: rejection_reason is not empty
    Side effects:
      - Send ORG_REQUEST_REJECTED email
      - Audit log: org_request_rejected

  ACCEPTED -> ACCEPTED (idempotent)
    Trigger: Admin re-approves same request (should not happen but safe)
    Validation: Check if organization already exists
    Side effects: No duplicate org created

  REJECTED -> REJECTED (idempotent)
    Trigger: Cannot transition from REJECTED back

Terminal states: ACCEPTED, REJECTED (no further changes)

-- ============================================================================
-- 2. INTERVIEW STATE MACHINE
-- ============================================================================

[INTERVIEW_LIFECYCLE]

States:
  - DRAFT: Interview being created/edited by HR; no candidates yet
  - PUBLISHED: Interview published; application form is live; slots assigned to candidates
  - LOCKED: Interview locked 24 hours before assessment start; no HR edits allowed
  - IN_PROGRESS: Assessment has started
  - CLOSED: Interview completed; HR decisions finalized

Transitions:
  DRAFT -> DRAFT (no-op)
    HR can edit any field, create/edit questions, add slots, etc.
    Editable fields: title, assessment_duration_minutes, interview_duration_minutes,
                    assessment_start/end_utc, interview_start/end_utc, questions, fallback questions

  DRAFT -> PUBLISHED
    Trigger: HR clicks "Publish Interview"
    Validation:
      - At least one interview_slot exists
      - At least one assessment_question_set with >= 1 questions
      - assessment_start_utc > NOW() + INTERVAL '24 hours' (24-hour buffer for app cutoff + lock)
      - interview_start_utc >= assessment_end_utc
    Side effects:
      - published_at = NOW()
      - Generate candidate application form URL
      - Audit log: interview_published
      - Trigger: Start candidate application window (application cutoff = assessment_start - 24h)
      - NO email yet

  PUBLISHED -> PUBLISHED (idempotent)
    Trigger: HR views dashboard (no change)

  PUBLISHED -> LOCKED (auto via trigger)
    Trigger: Scheduled job runs at assessment_start_utc - INTERVAL '24 hours'
    Validation: status must be PUBLISHED
    Side effects:
      - locked_at = NOW()
      - DB trigger: prevent all timing edits
      - Job action: Assign candidates to slots (if not already assigned)
      - Job action: Send ASSESSMENT_REMINDER_24H emails (if configured)
      - Audit log: interview_locked

  LOCKED -> LOCKED (no-op)
    HR cannot edit timings; can only view

  LOCKED -> IN_PROGRESS
    Trigger: Auto-transition at assessment_start_utc
    Validation: status = LOCKED
    Side effects:
      - assessed_started_at = NOW()
      - Assessment session tokens become valid
      - Audit log: interview_in_progress

  IN_PROGRESS -> CLOSED
    Trigger: Manual: HR clicks "Close Interview" after last interview session ended
            OR Auto: assessment_end_utc + INTERVAL '1 day' has passed
    Validation:
      - All applications with assigned slots have status in ('COMPLETED', 'NO_SHOW', 'FAILED_PARTIAL')
      - All hr_decisions resolved
    Side effects:
      - closed_at = NOW()
      - Generate final bulk report
      - Send all pending CANDIDATE_DECISION emails
      - Audit log: interview_closed

  CLOSED -> CLOSED (idempotent)
    Interview is archived; no further changes

Editable fields by status:
  - DRAFT:     All fields
  - PUBLISHED: Question text, fallback questions (but not timings)
  - LOCKED:    Read-only (no edits allowed)
  - IN_PROGRESS: Read-only
  - CLOSED:    Read-only

-- ============================================================================
-- 3. APPLICATION STATE MACHINE
-- ============================================================================

[CANDIDATE_APPLICATION_LIFECYCLE]

States:
  - APPLIED: Candidate submitted application form with resume and slot preferences
  - SLOT_PREFERRED: Candidate has matched preferences (implicit, used in batch assignment)
  - SLOT_ASSIGNED: Candidate assigned to a final assessment slot
  - INVITED: Credentials sent; awaiting assessment join (deprecated for MVP, merged with SLOT_ASSIGNED)
  - ASSESSMENT_IN_PROGRESS: Candidate started assessment
  - INTERVIEW_IN_PROGRESS: Candidate in interview
  - COMPLETED: Candidate finished both rounds; awaiting HR decision
  - ACCEPTED: HR approved candidate
  - REJECTED: HR rejected candidate (or FINAL_REJECT after system failures)
  - NO_SHOW: Candidate did not start/join assessment
  - FAILED_PARTIAL: Candidate started but abandoned (assessment or interview)

Priority (for terminal state flow):
  - NO_SHOW > FAILED_PARTIAL > REJECTED > ACCEPTED (once terminal, no change)

Transitions:
  # Happy path
  APPLIED -> SLOT_ASSIGNED
    Trigger: Batch slot assignment job (runs at assessment_start_utc - INTERVAL '25 hours')
    Validation:
      - interview.status = PUBLISHED
      - candidate applied before cutoff (assessment_start_utc - INTERVAL '24 hours')
      - at least one valid slot matches preferences
    Side effects:
      - assigned_slot_id = <slot_id>
      - slot_assigned_at = NOW()
      - Increment interview_slots.assigned_candidates
      - Send SLOT_ASSIGNED email with credentials
      - Audit log: slot_assignment

  SLOT_ASSIGNED -> ASSESSMENT_IN_PROGRESS
    Trigger: Candidate logs in with valid session token and starts assessment
    Validation:
      - NOW() >= (assigned_slot.slot_start_utc - INTERVAL '2 hours')
      - NOW() < (assigned_slot.slot_start_utc)
      - assessment_attempt not already in progress
      - session token is valid and not expired
    Side effects:
      - INSERT assessment_attempt with started_at = NOW(), status = 'ASSESSMENT_IN_PROGRESS'
      - Update applications.status = 'ASSESSMENT_IN_PROGRESS'
      - Start recording (proctoring)

  ASSESSMENT_IN_PROGRESS -> INTERVIEW_IN_PROGRESS
    Trigger: Candidate submits assessment (or timer expires at 20 minutes)
    Validation:
      - assessment_attempt.submitted_at is set
      - assessment score calculated
      - consents recorded (video/audio)
    Side effects:
      - assessment_attempt.status = COMPLETED
      - INSERT interview_session with session_token
      - applications.status = 'INTERVIEW_IN_PROGRESS'
      - Start recording (interview)

  INTERVIEW_IN_PROGRESS -> COMPLETED
    Trigger: Candidate submits interview (or timer expires at 40 minutes)
    Validation:
      - interview_session.ended_at is set
      - interview_responses saved
      - AI report generated
    Side effects:
      - interview_session.status = COMPLETED
      - applications.status = 'COMPLETED'
      - Revoke all session tokens
      - Block re-access to assessment/interview UI
      - Audit log: interview_completed

  COMPLETED -> ACCEPTED
    Trigger: HR clicks "Accept" for this candidate
    Validation:
      - HR user has permission on organization
    Side effects:
      - INSERT hr_decisions (decision='ACCEPT', decided_by=<user_id>)
      - applications.status = 'ACCEPTED'
      - applications.updated_at = NOW()
      - Send CANDIDATE_DECISION_ACCEPTED email (on interview close or immediate)
      - Audit log: hr_decision_accept

  COMPLETED -> REJECTED
    Trigger: HR clicks "Reject" for this candidate
    Validation:
      - HR user has permission on organization
    Side effects:
      - INSERT hr_decisions (decision='REJECT', decided_by=<user_id>)
      - applications.status = 'REJECTED'
      - applications.updated_at = NOW()
      - Send CANDIDATE_DECISION_REJECTED email (on interview close or immediate)
      - Audit log: hr_decision_reject

  # Failure paths
  SLOT_ASSIGNED -> NO_SHOW
    Trigger: Candidate doesn't start assessment within 15 minutes of slot opening
            OR candidate logs in but doesn't submit within assessment window
    Validation:
      - NOW() > (assigned_slot.slot_start_utc + INTERVAL '15 minutes') and no assessment started
      - OR assessment_attempt.started_at is set but no submission within assessment window
    Side effects:
      - applications.status = 'NO_SHOW'
      - assessment_attempt.status = 'NO_SHOW'
      - Block any re-attempt
      - Audit log: no_show_detected
      - Send CANDIDATE_DECISION_REJECTED email (generic, no feedback)

  ASSESSMENT_IN_PROGRESS -> FAILED_PARTIAL
    Trigger: Candidate starts assessment but abandons (network loss, browser close, etc.)
             AND does not rejoin within session window
    Validation:
      - assessment_attempt.started_at is set
      - assessment_attempt.submitted_at is NULL
      - NOW() > (assessment_attempt.session_valid_until - INTERVAL '5 min')
    Side effects:
      - assessment_attempt.status = 'FAILED_PARTIAL'
      - applications.status = 'FAILED_PARTIAL'
      - Block interview_session creation
      - Audit log: assessment_abandoned
      - Send CANDIDATE_DECISION_REJECTED email (generic)

  INTERVIEW_IN_PROGRESS -> FAILED_PARTIAL
    Trigger: Candidate starts interview but abandons (network loss, etc.)
             AND does not rejoin within session window
    Validation:
      - interview_session.started_at is set
      - interview_session.ended_at is NULL
      - NOW() > (interview_session.session_valid_until - INTERVAL '5 min')
    Side effects:
      - interview_session.status = 'FAILED_PARTIAL'
      - applications.status = 'FAILED_PARTIAL'
      - Generate partial AI report (on transcript collected so far)
      - Audit log: interview_abandoned
      - Send CANDIDATE_DECISION_REJECTED email (generic)

  APPLIED -> * (no transition if application cutoff passed)
    If NOW() > (interview.assessment_start_utc - INTERVAL '24 hours'):
      - Application form is closed
      - Reject new submissions with message: "Applications closed"
      - Existing APPLIED applications that were never assigned: stay in APPLIED, not invited
      - Audit log: application_cutoff_enforcement

Terminal/Final states: ACCEPTED, REJECTED, NO_SHOW, FAILED_PARTIAL
  - Once in any final state, no further transition
  - HR can still view and add notes
  - Email already sent
  - Candidate access revoked

-- ============================================================================
-- 4. ASSESSMENT ATTEMPT STATE MACHINE
-- ============================================================================

[ASSESSMENT_ATTEMPT_LIFECYCLE]

States:
  - (implicit PENDING): Session token generated; awaits candidate login
  - ASSESSMENT_IN_PROGRESS: Candidate logged in and clicked "Start"
  - COMPLETED: Assessment submitted or timer expired
  - NO_SHOW: Candidate never started
  - FAILED_PARTIAL: Candidate started but abandoned

Transitions:
  (implicit) -> ASSESSMENT_IN_PROGRESS
    Trigger: Candidate logs in and clicks "Start Assessment"

  ASSESSMENT_IN_PROGRESS -> COMPLETED
    Trigger: Candidate clicks "Submit" OR timer reaches 20 minutes

  ASSESSMENT_IN_PROGRESS -> FAILED_PARTIAL
    Trigger: Session expires or candidate abandons

Terminal: COMPLETED, NO_SHOW, FAILED_PARTIAL

-- ============================================================================
-- 5. INTERVIEW SESSION STATE MACHINE
-- ============================================================================

[INTERVIEW_SESSION_LIFECYCLE]

States:
  - (implicit PENDING): Session token generated; awaits candidate start
  - INTERVIEW_IN_PROGRESS: Candidate clicked "Start Interview"
  - COMPLETED: Interview submitted or timer expired; recording finalized

Transitions:
  (implicit) -> INTERVIEW_IN_PROGRESS
    Trigger: Candidate passed consent checks and clicked "Start Interview"

  INTERVIEW_IN_PROGRESS -> COMPLETED
    Trigger: Candidate clicked "End Interview" OR timer reached 40 minutes
             OR candidate abandoned (session expired)

Terminal: COMPLETED (always terminal; no retry)

-- ============================================================================
-- 6. NOTIFICATION EVENT STATE MACHINE
-- ============================================================================

[NOTIFICATION_EVENT_LIFECYCLE]

States:
  - PENDING: Queued; awaiting scheduled_send_at or immediate dispatch
  - SENT: Successfully delivered via email provider
  - FAILED: Permanent failure after max retries
  - RETRIED: In retry loop (implicit; status cycles PENDING -> retry -> PENDING)

Transitions:
  PENDING -> SENT
    Trigger: Background job sends email; provider returns 2xx response
    Side effects:
      - INSERT notification_deliveries (status='SENT')
      - Update notification_events.status = 'SENT'

  PENDING -> FAILED
    Trigger: Background job exhausts 5 retry attempts; all failed
    Side effects:
      - INSERT notification_deliveries (status='FAILED', attempt_number=5)
      - Update notification_events.status = 'FAILED'
      - Audit log to alert ops

  (retry loop)
    PENDING + attempt_number < 5 -> PENDING (rescheduled)
    Trigger: Background job fails to send; reschedules
    Side effects:
      - scheduled_send_at = NOW() + INTERVAL '5 minutes' * attempt_number
      - INSERT notification_deliveries (status='FAILED', attempt_number=n)
      - Status stays PENDING

Terminal: SENT, FAILED

-- ============================================================================
-- 7. HR DECISION STATE MACHINE
-- ============================================================================

[HR_DECISION_LIFECYCLE]

States:
  - (implicit): No record exists; application.status = 'COMPLETED'
  - PENDING: (implicit; no hr_decision record)
  - ACCEPT: HTR approved; hr_decision.decision = 'ACCEPT'
  - REJECT: HR rejected; hr_decision.decision = 'REJECT'

Transitions:
  (no decision) -> ACCEPT
    Trigger: HR clicks "Accept"
    Validation: application.status = 'COMPLETED'
    Side effects:
      - INSERT hr_decisions (decision='ACCEPT')
      - UPDATE applications.status = 'ACCEPTED'
      - Email scheduled or sent

  (no decision) -> REJECT
    Trigger: HR clicks "Reject"
    Validation: application.status = 'COMPLETED'
    Side effects:
      - INSERT hr_decisions (decision='REJECT')
      - UPDATE applications.status = 'REJECTED'
      - Email scheduled or sent

  ACCEPT -> ACCEPT (idempotent)
    HR views decision again; no change

  REJECT -> REJECT (idempotent)
    HR views decision again; no change

Terminal: ACCEPT, REJECT (cannot flip back-and-forth)

-- ============================================================================
-- END OF STATE MACHINES
-- ============================================================================
