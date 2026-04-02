-- ============================================================================
-- VIRTUAL INTERVIEW PLATFORM - EXCEL EXPORT & SCORING RULES
-- ============================================================================

-- ============================================================================
-- 1. EXCEL EXPORT COLUMNS (Fixed Columns for MVP)
-- ============================================================================

COLUMN ORDER & DEFINITIONS:

1. Candidate Name
   Source: applications.candidate_name
   Type: Text
   Format: "John Doe"

2. Candidate Email
   Source: applications.candidate_email
   Type: Email
   Format: "john.doe@example.com"

3. Candidate Phone
   Source: applications.candidate_phone
   Type: Text
   Format: "+1-800-123-4567"

4. Job Position
   Source: jobs.position_title
   Type: Text
   Format: "Senior Software Engineer"

5. Application Date (UTC)
   Source: applications.created_at
   Type: DateTime
   Format: "2024-12-15 10:30:00" (ISO 8601, UTC)

6. Assigned Assessment Slot (UTC)
   Source: interview_slots.slot_start_utc
   Type: DateTime
   Format: "2024-12-20 14:00:00" (ISO 8601, UTC)
   Null handling: "Not Assigned" if no slot (rare for exported candidates)

7. Assessment Score (%)
   Source: assessment_attempts.score
   Type: Decimal
   Format: "87.50" (percentage, 2 decimals)
   Null handling: "N/A" if not completed

8. Assessment Duration (seconds)
   Source: assessment_attempts.duration_seconds
   Type: Integer
   Format: "1200" (seconds)
   Null handling: "0" if not started or "N/A" if no attempt

9. Interview Score (%)
   Source: interview_sessions.score
   Type: Decimal
   Format: "82.00" (percentage, 2 decimals)
   Null handling: "N/A" if not completed

10. Interview Duration (seconds)
    Source: interview_sessions.duration_seconds
    Type: Integer
    Format: "2400" (seconds)
    Null handling: "0" if not started or "N/A" if no interview

11. AI Hire Recommendation
    Source: ai_reports.hire_recommendation (for interview report)
    Type: Text (enum)
    Format: "STRONG_YES" | "YES" | "MAYBE" | "NO" | "STRONG_NO"
    Null handling: "Pending" if report not generated

12. HR Decision
    Source: hr_decisions.decision
    Type: Text (enum)
    Format: "ACCEPT" | "REJECT" | "Pending"
    Null handling: "Pending" if not decided

13. HR Notes
    Source: hr_decisions.notes
    Type: Text
    Format: "Candidate showed good problem-solving skills. Strong communication."
    Null handling: "" (empty cell)

14. Resume File Name
    Source: applications.resume_file_path
    Type: Text
    Format: "john_doe_resume.pdf"
    Null handling: "Not Uploaded"

15. Interview Recording File Name
    Source: recordings.file_path (filtered by recording_type='INTERVIEW')
    Type: Text
    Format: "interview_app_12345_session_67890.mp4"
    Null handling: "Not Available"

16. Proctoring Flags Count
    Source: COUNT(proctoring_flags.*) for this attempt
    Type: Integer
    Format: "5"
    Null handling: "0" (no flags = clean session)

17. Application Status
    Source: applications.status
    Type: Text (enum)
    Format: "COMPLETED" | "ACCEPTED" | "REJECTED" | "NO_SHOW" | "FAILED_PARTIAL"

18. Proctoring Flags Details (Optional, expanded row)
    Source: proctoring_flags.flag_type, severity, triggered_at
    Type: Text
    Format: "TAB_SWITCH (INFO, 2024-12-20 14:15:30); FACE_ABSENT (WARNING, 2024-12-20 14:16:00)"
    Null handling: "None"

-- ============================================================================
-- EXCEL FORMATTING (Best Practices)
-- ============================================================================

FILE METADATA:
  - File name: "[job_position]_candidates_[export_date].xlsx"
  - Example: "Senior_Software_Engineer_candidates_2024-12-20.xlsx"
  - Sheet name: "Candidates"
  - Created by: [HR username]
  - Creation timestamp: ISO 8601 UTC

SPREADSHEET LAYOUT:
  - Row 1: Header row (frozen)
  - Columns: Frozen left 3 columns (candidate name, email, phone) for horizontal scroll
  - Font: Calibri, 11pt
  - Header: Bold, Background light blue
  - Row height: Auto-fit content
  - Column width: Auto-fit columns

CONDITIONAL FORMATTING (Optional for visual scanning):
  - Assessment Score >= 80: Green background
  - Assessment Score 60-79: Yellow background
  - Assessment Score < 60: Red background
  - HR Decision = ACCEPT: Green font
  - HR Decision = REJECT: Red font
  - HR Decision = Pending: Gray font

FILTERS ENABLED:
  - Auto-filter on header row (so HR can filter by status, decision, score, etc.)

EXPORT SECURITY:
  - No sensitive data in file name or metadata
  - File contains no passwords or tokens
  - Recommend: Save to secure folder; delete after hiring round complete
  - Audit log: "Excel export created by [user] at [timestamp]"

-- ============================================================================
-- 2. ASSESSMENT SCORING RULES (Positive Scoring Only, MVP)
-- ============================================================================

ASSESSMENT QUESTION TYPE: Multiple Choice (4 options: A, B, C, D)

SCORING CALCULATION:
  Score (%) = (Correct Answers / Total Questions) * 100

EXAMPLE:
  - Total Questions: 10
  - Correct Answers: 8
  - Score = (8 / 10) * 100 = 80.00%

NO NEGATIVE MARKING:
  - Each incorrect answer: 0 points (not -1 or penalty)
  - Each skipped/blank answer: 0 points
  - Scoring formula never subtracts

SCORE RANGE:
  - Minimum: 0%
  - Maximum: 100%
  - Precision: 2 decimal places (e.g., 87.50%)

RANDOM QUESTION SET PER CANDIDATE:
  - For each assessment_attempt, load questions from assessment_question_sets
  - Randomize question order (shuffle array before display)
  - Randomize option order (A/B/C/D) for each question (keep correct_option_id mapping)
  - Store randomized order in assessment_responses for audit trail

CALCULATION LOGIC (Pseudo-code):
  ```
  assessment_attempt.started_at = NOW();
  questions = assessment_question_sets.questions.shuffle();
  total_questions = questions.count();
  correct_count = 0;

  for each assessment_response:
    if (response.selected_option_id == question.correct_option_id):
      correct_count += 1;

  score = (correct_count / total_questions) * 100;
  assessment_attempt.score = ROUND(score, 2);
  assessment_attempt.submitted_at = NOW();
  assessment_attempt.duration_seconds = submitted_at - started_at;
  ```

-- ============================================================================
-- 3. INTERVIEW SCORING RULES (AI-Generated, MVP)
-- ============================================================================

INTERVIEW QUESTION TYPE: Open-ended text/voice responses

SCORING EVALUATION:
  - AI analyzes candidate's answers based on job competency framework
  - Outputs score as percentage (0-100%)
  - Precision: 2 decimal places

SCORE GENERATION (AI Service Call):
  Input:
    - interview_id (for context: job position, skills, level)
    - interview_responses (list of Q&A pairs)
    - candidate resume/bio (optional, for context)
  
  Output:
    - score: Decimal(5, 2) -- percentage
    - strengths: List[String] -- key strengths identified (3-5 bullet points)
    - weaknesses: List[String] -- improvement areas (2-3 bullet points)
    - hire_recommendation: ENUM -- STRONG_YES | YES | MAYBE | NO | STRONG_NO
    - detailed_analysis: String -- 2-3 paragraphs of commentary

RECOMMENDATION MAPPING (Suggested for MVP):
  - STRONG_YES: score >= 90% AND multiple strong competency matches
  - YES: score >= 75% AND most competencies met
  - MAYBE: score 50-74% OR mixed signals (strong in some, weak in others)
  - NO: score < 50% OR critical gaps in key skills
  - STRONG_NO: score < 30% OR major red flags

TIMING:
  - AI report generation triggered immediately after interview_session.status='COMPLETED'
  - Async job (not blocking candidate exit flow)
  - Report available in HR dashboard within ~5-10 minutes (configurable timeout)

-- ============================================================================
-- 4. ASSESSMENT + INTERVIEW COMBINED EVALUATION
-- ============================================================================

HR DECISION FRAMEWORK (for reference, not automated in MVP):
  While AI provides hire_recommendation, HR makes final decision based on holistic eval:

  Weights (example; can be customized per org):
    - Assessment Score: 30%
    - Interview Score: 50%
    - AI Hire Recommendation: 20%
    - Proctoring Flags (informational): ±5% adjustment (if concerns present)
    - Resume / Experience: Context (not auto-scored)

  Example Decision Flow:
    1. HR reviews candidate packet:
       - Assessment score: 85%
       - Interview score: 78%
       - AI recommendation: YES
       - Proctoring flags: 2 tab-switches (low severity)
    2. Weighted score: (85 * 0.3) + (78 * 0.5) + (AI:YES ≈ 75% * 0.2) = ~79%
    3. HR can override AI recommendation based on context/notes
    4. Final decision: ACCEPT or REJECT

  Note: MVP does not auto-calculate final score; HR sees all data and decides manually

-- ============================================================================
-- 5. DATA RETENTION & ARCHIVAL
-- ============================================================================

RECORDING RETENTION:
  - Retention until: created_at + INTERVAL '180 days'
  - Auto-delete job runs daily at 02:00 UTC
  - Before deletion: notify HR (24h notice); allow manual hold

ASSESSMENT/INTERVIEW TRANSCRIPTS:
  - Retained indefinitely in database (audit trail)
  - Exportable to Excel (see above)
  - Candidates can request deletion (GDPR right to be forgotten)

AI REPORTS:
  - Retained for 180 days (same as recordings)
  - Can be manually archived/exported before auto-delete

CANDIDATE APPLICATION FORM RESPONSES:
  - Retained indefinitely (for litigation/audit)
  - Encrypted if PII present

-- ============================================================================
-- 6. SCORING VALIDATION & EDGE CASES
-- ============================================================================

EDGE CASE: Assessment submitted with 0 correct answers
  - Score = 0%
  - Valid outcome; candidate can still proceed to interview
  - No auto-reject; HR can review and decide

EDGE CASE: Assessment question marked correct_option_id = NULL
  - This is a data integrity error
  - Validation: Prevent publication if any question has NULL correct_option_id
  - If somehow submitted: treat as no-score-for-this-question

EDGE CASE: Candidate submits assessment at 19:59 (just before 20-min timer)
  - Assessment counted as submitted
  - Score is final
  - Timer continues for interview round immediately

EDGE CASE: Interview AI service returns error during report generation
  - Fallback: Use basic heuristic scoring (question count + attempt analysis)
  - Log error to audit_logs
  - Alert ops to investigate
  - HR dashboard shows "Report pending" until manual intervention

EDGE CASE: Proctoring flags triggered but candidate still passed
  - Flags are informational only (not auto-fail)
  - HR can view flags in dashboard and assess risk
  - HR final decision is override-point (can REJECT despite good score)

-- ============================================================================
-- END OF EXPORT & SCORING RULES
-- ============================================================================
