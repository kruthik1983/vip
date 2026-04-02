-- ============================================================================
-- VIRTUAL INTERVIEW PLATFORM - REST API ENDPOINTS (MVP)
-- ============================================================================
-- All timestamps in UTC ISO 8601 format
-- All IDs are integers (auto-increment)
-- Auth: Bearer token (JWT) with role-based access control
-- ============================================================================

-- ============================================================================
-- 1. AUTHENTICATION & USER MANAGEMENT
-- ============================================================================

POST /auth/admin-register
  [PUBLIC - first-time admin only]
  Body:
    {
      "username": "admin_user",
      "email": "admin@platform.com",
      "password": "SecureP@ss123",
      "first_name": "Admin",
      "last_name": "User"
    }
  Response (201):
    {
      "id": 1,
      "username": "admin_user",
      "email": "admin@platform.com",
      "role": "ADMIN",
      "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
      "token_expires_at": "2024-12-25T10:00:00Z"
    }

POST /auth/login
  [PUBLIC]
  Body:
    {
      "email": "user@example.com",
      "password": "password123"
    }
  Response (200):
    {
      "id": 1,
      "username": "org_hr_user",
      "email": "user@example.com",
      "role": "ORG_ADMIN|HR",
      "organization_id": 5,
      "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
      "token_expires_at": "2024-12-25T10:00:00Z"
    }
  Error (401):
    { "error": "Invalid email or password" }

POST /auth/logout
  [AUTHENTICATED]
  Response (200):
    { "message": "Logged out successfully" }

GET /users/profile
  [AUTHENTICATED]
  Response (200):
    {
      "id": 1,
      "username": "user",
      "email": "user@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "role": "HR",
      "organization_id": 5,
      "created_at": "2024-01-01T00:00:00Z",
      "last_login": "2024-12-15T10:30:00Z"
    }

-- ============================================================================
-- 2. ORGANIZATION ONBOARDING (ADMIN FLOW)
-- ============================================================================

POST /admin/organization-requests
  [PUBLIC - org fills onboarding form]
  Body:
    {
      "organization_name": "TechCorp Inc",
      "organization_email": "hr@techcorp.com",
      "contact_person": "Jane Smith",
      "phone": "+1-800-123-4567",
      "website": "https://techcorp.com",
      "employees_count": 500
    }
  Response (201):
    {
      "id": 1,
      "organization_name": "TechCorp Inc",
      "status": "SUBMITTED",
      "created_at": "2024-12-15T10:00:00Z"
    }

GET /admin/organization-requests
  [ADMIN only]
  Query params:
    - status: SUBMITTED|UNDER_REVIEW|ACCEPTED|REJECTED (optional)
    - limit: 20
    - offset: 0
  Response (200):
    {
      "total": 5,
      "requests": [
        {
          "id": 1,
          "organization_name": "TechCorp Inc",
          "contact_person": "Jane Smith",
          "status": "SUBMITTED",
          "created_at": "2024-12-15T10:00:00Z",
          "reviewed_at": null,
          "reviewed_by": null
        }
      ]
    }

GET /admin/organization-requests/:id
  [ADMIN only]
  Response (200):
    {
      "id": 1,
      "organization_name": "TechCorp Inc",
      "organization_email": "hr@techcorp.com",
      "contact_person": "Jane Smith",
      "phone": "+1-800-123-4567",
      "website": "https://techcorp.com",
      "employees_count": 500,
      "status": "SUBMITTED",
      "created_at": "2024-12-15T10:00:00Z",
      "reviewed_at": null,
      "reviewed_by": null
    }

PUT /admin/organization-requests/:id/accept
  [ADMIN only]
  Body: {} (no body required)
  Response (200):
    {
      "id": 1,
      "status": "ACCEPTED",
      "organization_id": 10,
      "org_admin_username": "techcorp_admin",
      "org_admin_temp_password": "TempP@ss123456",
      "portal_link": "https://platform.com/dashboard",
      "message": "Organization onboarded successfully"
    }
  Side effects:
    - Sends ORG_REQUEST_ACCEPTED email to organization_email
    - Creates organization, org_admin user with temp credentials
    - Audit log entry

PUT /admin/organization-requests/:id/reject
  [ADMIN only]
  Body:
    {
      "rejection_reason": "Company registration not verified"
    }
  Response (200):
    {
      "id": 1,
      "status": "REJECTED",
      "rejection_reason": "Company registration not verified"
    }
  Side effects:
    - Sends ORG_REQUEST_REJECTED email to organization_email
    - Audit log entry

-- ============================================================================
-- 3. ORGANIZATION & USER MANAGEMENT (ORG_ADMIN)
-- ============================================================================

GET /organizations/:id
  [ORG_ADMIN of that org, ADMIN]
  Response (200):
    {
      "id": 5,
      "name": "TechCorp Inc",
      "email": "hr@techcorp.com",
      "phone": "+1-800-123-4567",
      "website": "https://techcorp.com",
      "created_at": "2024-01-01T00:00:00Z",
      "is_active": true
    }

POST /organizations/:id/users
  [ORG_ADMIN of that org]
  Body:
    {
      "email": "hr_user@techcorp.com",
      "first_name": "John",
      "last_name": "Smith",
      "role": "HR"
    }
  Response (201):
    {
      "id": 15,
      "email": "hr_user@techcorp.com",
      "first_name": "John",
      "last_name": "Smith",
      "role": "HR",
      "temp_password": "TempP@ss7891",
      "message": "User created. Temporary password has been sent to email."
    }
  Side effects:
    - No email sent in MVP (or send to admin)
    - Audit log entry

GET /organizations/:id/users
  [ORG_ADMIN of that org]
  Response (200):
    {
      "total": 3,
      "users": [
        {
          "id": 5,
          "email": "org_admin@techcorp.com",
          "first_name": "Jane",
          "last_name": "Smith",
          "role": "ORG_ADMIN",
          "created_at": "2024-01-01T00:00:00Z"
        },
        {
          "id": 15,
          "email": "hr_user@techcorp.com",
          "first_name": "John",
          "last_name": "Smith",
          "role": "HR",
          "created_at": "2024-12-15T10:00:00Z"
        }
      ]
    }

-- ============================================================================
-- 4. JOB POSITIONS
-- ============================================================================

POST /organizations/:org_id/jobs
  [ORG_ADMIN, HR of that org]
  Body:
    {
      "position_title": "Senior Software Engineer",
      "job_description": "We are looking for...",
      "skills_required": ["Python", "PostgreSQL", "AWS", "Django"],
      "ctc_min": 80000,
      "ctc_max": 120000
    }
  Response (201):
    {
      "id": 10,
      "organization_id": 5,
      "position_title": "Senior Software Engineer",
      "job_description": "We are looking for...",
      "skills_required": ["Python", "PostgreSQL", "AWS", "Django"],
      "ctc_min": 80000,
      "ctc_max": 120000,
      "created_at": "2024-12-15T10:00:00Z",
      "created_by": 5
    }

GET /organizations/:org_id/jobs
  [ORG_ADMIN, HR of that org]
  Response (200):
    {
      "total": 3,
      "jobs": [
        {
          "id": 10,
          "position_title": "Senior Software Engineer",
          "ctc_min": 80000,
          "ctc_max": 120000,
          "created_at": "2024-12-15T10:00:00Z"
        }
      ]
    }

GET /organizations/:org_id/jobs/:job_id
  [ORG_ADMIN, HR of that org]
  Response (200): (full job object)

-- ============================================================================
-- 5. INTERVIEW CREATION & MANAGEMENT
-- ============================================================================

POST /organizations/:org_id/interviews
  [HR of that org]
  Body:
    {
      "job_id": 10,
      "title": "Senior Engineer Round 1 & 2",
      "assessment_duration_minutes": 20,
      "interview_duration_minutes": 40,
      "assessment_start_utc": "2024-12-20T14:00:00Z",
      "assessment_end_utc": "2024-12-20T19:00:00Z",
      "interview_start_utc": "2024-12-20T14:20:00Z",
      "interview_end_utc": "2024-12-20T19:20:00Z"
    }
  Response (201):
    {
      "id": 5,
      "job_id": 10,
      "title": "Senior Engineer Round 1 & 2",
      "status": "DRAFT",
      "assessment_start_utc": "2024-12-20T14:00:00Z",
      "created_at": "2024-12-15T10:00:00Z",
      "created_by": 15
    }

GET /organizations/:org_id/interviews
  [HR of that org]
  Query params:
    - status: DRAFT|PUBLISHED|LOCKED|IN_PROGRESS|CLOSED (optional)
    - limit: 20
    - offset: 0
  Response (200):
    {
      "total": 5,
      "interviews": [...]
    }

GET /organizations/:org_id/interviews/:interview_id
  [HR of that org]
  Response (200):
    {
      "id": 5,
      "job_id": 10,
      "title": "Senior Engineer Round 1 & 2",
      "status": "DRAFT",
      "assessment_start_utc": "2024-12-20T14:00:00Z",
      "assessment_end_utc": "2024-12-20T19:00:00Z",
      "interview_start_utc": "2024-12-20T14:20:00Z",
      "interview_end_utc": "2024-12-20T19:20:00Z",
      "assessment_duration_minutes": 20,
      "interview_duration_minutes": 40,
      "created_at": "2024-12-15T10:00:00Z",
      "published_at": null,
      "locked_at": null,
      "job": { "position_title": "Senior Software Engineer", ... }
    }

PUT /organizations/:org_id/interviews/:interview_id
  [HR of that org]
  [Only editable in DRAFT status]
  Body:
    {
      "title": "Updated title",
      "assessment_start_utc": "2024-12-21T14:00:00Z",
      ...
    }
  Response (200):
    { updated interview object }
  Error (400):
    { "error": "Cannot edit interview after PUBLISHED status" }

PUT /organizations/:org_id/interviews/:interview_id/publish
  [HR of that org]
  Body: {} (no body)
  Validation:
    - status = DRAFT
    - at least 1 assessment_question_set with >= 1 questions
    - at least 1 interview_slot
    - assessment_start_utc > NOW() + INTERVAL '24 hours'
  Response (200):
    {
      "id": 5,
      "status": "PUBLISHED",
      "published_at": "2024-12-15T10:00:00Z",
      "application_form_url": "https://platform.com/apply/interview/5?token=abc123xyz",
      "message": "Interview published. Application form is now live."
    }
  Side effects:
    - Trigger slot assignment batch job for assessment_start - 25h
    - Create application form with public link
    - Audit log entry

GET /organizations/:org_id/interviews/:interview_id/candidates
  [HR of that org]
  Response (200):
    {
      "total": 25,
      "candidates": [
        {
          "id": 100,
          "candidate_name": "John Doe",
          "candidate_email": "john@example.com",
          "status": "ASSESSMENT_IN_PROGRESS",
          "assigned_slot_start_utc": "2024-12-20T14:00:00Z",
          "assessment_score": 85.5,
          "interview_score": null,
          "ai_hire_recommendation": null,
          "hr_decision": null
        }
      ]
    }

-- ============================================================================
-- 6. INTERVIEW SLOTS
-- ============================================================================

POST /interviews/:interview_id/slots
  [HR who created interview]
  Body:
    {
      "slot_start_utc": "2024-12-20T14:00:00Z",
      "slot_end_utc": "2024-12-20T15:00:00Z",
      "max_candidates": 10
    }
  Response (201):
    {
      "id": 50,
      "interview_id": 5,
      "slot_start_utc": "2024-12-20T14:00:00Z",
      "slot_end_utc": "2024-12-20T15:00:00Z",
      "max_candidates": 10,
      "assigned_candidates": 0
    }

GET /interviews/:interview_id/slots
  [HR who created interview]
  Response (200):
    {
      "total": 5,
      "slots": [...]
    }

-- ============================================================================
-- 7. ASSESSMENT QUESTIONS & OPTIONS
-- ============================================================================

POST /interviews/:interview_id/assessment-question-sets
  [HR who created interview]
  Body:
    {
      "is_ai_generated": false
    }
  Response (201):
    {
      "id": 30,
      "interview_id": 5,
      "is_ai_generated": false,
      "created_at": "2024-12-15T10:00:00Z"
    }

POST /assessment-question-sets/:question_set_id/questions
  [HR who created interview]
  Body:
    {
      "question_text": "What is Python?",
      "question_order": 1,
      "options": [
        { "option_label": "A", "option_text": "A programming language", "is_correct": true },
        { "option_label": "B", "option_text": "A type of snake", "is_correct": false },
        { "option_label": "C", "option_text": "A web framework", "is_correct": false },
        { "option_label": "D", "option_text": "All of the above", "is_correct": false }
      ]
    }
  Response (201):
    {
      "id": 120,
      "question_set_id": 30,
      "question_text": "What is Python?",
      "question_order": 1,
      "correct_option_id": 200,
      "options": [
        { "id": 200, "option_label": "A", "option_text": "A programming language", "is_correct": true },
        { "id": 201, "option_label": "B", "option_text": "A type of snake", "is_correct": false },
        ...
      ]
    }

GET /assessment-question-sets/:question_set_id/questions
  [HR who created interview]
  Response (200):
    {
      "total": 10,
      "questions": [...]
    }

PUT /assessment-questions/:question_id
  [HR who created interview]
  [Can edit even after interview PUBLISHED, but not after LOCKED]
  Body:
    {
      "question_text": "Updated question...",
      "options": [...]
    }
  Response (200): (updated question)

DELETE /assessment-questions/:question_id
  [HR who created interview]
  [Only if interview not LOCKED]
  Response (204)

-- ============================================================================
-- 8. INTERVIEW FALLBACK QUESTIONS
-- ============================================================================

POST /interviews/:interview_id/fallback-questions
  [HR who created interview]
  Body:
    {
      "question_text": "Tell me about a challenging project you worked on.",
      "difficulty_level": "MEDIUM",
      "question_order": 1
    }
  Response (201):
    {
      "id": 60,
      "interview_id": 5,
      "question_text": "Tell me about a challenging project you worked on.",
      "difficulty_level": "MEDIUM",
      "question_order": 1
    }

GET /interviews/:interview_id/fallback-questions
  [HR who created interview]
  Response (200):
    {
      "total": 8,
      "questions": [...]
    }

PUT /interviews/:interview_id/fallback-questions/:question_id
  [HR who created interview]
  [Can edit even after PUBLISHED, but not after LOCKED]
  Response (200)

DELETE /interviews/:interview_id/fallback-questions/:question_id
  [HR who created interview]
  [Only if interview not LOCKED]
  Response (204)

-- ============================================================================
-- 9. APPLICATION FORM (PUBLIC CANDIDATE SIDE)
-- ============================================================================

GET /interviews/:interview_id/application-form
  [PUBLIC - no auth required]
  Query params:
    - token: (optional, if link includes token for analytics)
  Response (200):
    {
      "interview_id": 5,
      "job_position": "Senior Software Engineer",
      "job_description": "We are looking for...",
      "skills_required": ["Python", "PostgreSQL", "AWS"],
      "available_slots": [
        {
          "slot_id": 50,
          "slot_start_utc": "2024-12-20T14:00:00Z",
          "slot_end_utc": "2024-12-20T15:00:00Z"
        },
        ...
      ],
      "form_fields": [
        { "name": "candidate_name", "type": "text", "required": true },
        { "name": "candidate_email", "type": "email", "required": true },
        { "name": "candidate_phone", "type": "tel", "required": false },
        { "name": "resume", "type": "file", "required": true, "accept": "application/pdf", "max_size": 2097152 },
        { "name": "slot_preferences", "type": "multi-select", "required": true, "max_options": 3 }
      ]
    }

POST /interviews/:interview_id/apply
  [PUBLIC]
  Body:
    {
      "candidate_name": "John Doe",
      "candidate_email": "john@example.com",
      "candidate_phone": "+1-800-123-4567",
      "resume_file": <binary PDF>,
      "slot_preferences": [50, 75, 100]  -- slot IDs
    }
  Response (201):
    {
      "id": 100,
      "interview_id": 5,
      "candidate_name": "John Doe",
      "candidate_email": "john@example.com",
      "status": "APPLIED",
      "created_at": "2024-12-15T10:00:00Z",
      "message": "Application submitted successfully. You will receive confirmation emails shortly."
    }
  Validation:
    - interview.status = PUBLISHED
    - NOW() < (interview.assessment_start_utc - INTERVAL '24 hours')
    - Resume: PDF only, <= 2MB
    - slot_preferences: 1-3 valid slot IDs from same interview
  Side effects:
    - Upload resume file to secure storage
    - Create application_slot_preferences entries
    - Send APPLICATION_RECEIVED email
    - Schedule SLOT_ASSIGNED email for (slot_start - 2h)
    - Audit log entry

-- ============================================================================
-- 10. CANDIDATE ASSESSMENT SESSION
-- ============================================================================

POST /candidates/assessment-login
  [PUBLIC - requires session token from email]
  Body:
    {
      "session_token": "abc123xyz"
    }
  Response (200):
    {
      "assessment_id": 100,
      "interview_id": 5,
      "candidate_name": "John Doe",
      "job_position": "Senior Software Engineer",
      "assessment_start_utc": "2024-12-20T14:00:00Z",
      "assessment_end_utc": "2024-12-20T14:20:00Z",
      "duration_minutes": 20,
      "questions_count": 10,
      "message": "Assessment session is ready. Please read the guidelines and start.",
      "guidelines": "..."
    }
  Error (403):
    { "error": "LOGIN_WINDOW_NOT_OPEN", "message": "Assessment access opens at 2024-12-20T12:00:00Z" }

POST /candidates/assessment-start
  [AUTHENTICATED with session token]
  Body:
    {
      "session_token": "abc123xyz"
    }
  Response (200):
    {
      "assessment_attempt_id": 200,
      "questions": [
        {
          "id": 120,
          "question_text": "What is Python?",
          "question_order": 1,
          "options": [
            { "id": 200, "option_label": "A", "option_text": "A programming language" },
            { "id": 201, "option_label": "B", "option_text": "A type of snake" },
            { "id": 202, "option_label": "C", "option_text": "A web framework" },
            { "id": 203, "option_label": "D", "option_text": "All of the above" }
          ]
        },
        ...
      ],
      "timer_seconds": 1200  -- 20 minutes
    }
  Side effects:
    - INSERT assessment_attempt with status='ASSESSMENT_IN_PROGRESS', started_at=NOW()
    - Start proctoring (webcam, tab-switch logging)
    - Start recording (if enabled)

POST /candidates/assessment-answer
  [AUTHENTICATED with session token]
  Body:
    {
      "session_token": "abc123xyz",
      "assessment_attempt_id": 200,
      "question_id": 120,
      "selected_option_id": 200
    }
  Response (200):
    { "message": "Answer recorded" }
  Side effects:
    - INSERT assessment_responses

POST /candidates/assessment-submit
  [AUTHENTICATED with session token]
  Body:
    {
      "session_token": "abc123xyz",
      "assessment_attempt_id": 200
    }
  Response (200):
    {
      "assessment_attempt_id": 200,
      "score": 85.50,
      "total_questions": 10,
      "correct_answers": 8,
      "duration_seconds": 600,
      "message": "Assessment submitted successfully. Proceeding to interview round..."
    }
  Side effects:
    - UPDATE assessment_attempt: submitted_at=NOW(), status='COMPLETED', score=calculated
    - Stop recording
    - Generate AI_REPORT for assessment
    - Auto-transition to interview prep (no explicit start needed)

-- ============================================================================
-- 11. CANDIDATE INTERVIEW SESSION
-- ============================================================================

POST /candidates/interview-precheck
  [AUTHENTICATED with session token]
  Body:
    {
      "session_token": "abc123xyz",
      "assessment_attempt_id": 200
    }
  Response (200):
    {
      "interview_session_id": 300,
      "application_id": 100,
      "device_checklist": {
        "webcam": { "status": "checking", "message": "Please ensure webcam is enabled" },
        "microphone": { "status": "pending", "message": "Please test microphone" },
        "internet": { "status": "pending", "message": "Testing connection..." }
      },
      "consents_required": [
        { "id": 1, "title": "Video Recording Consent", "description": "I consent to have my interview recorded..." },
        { "id": 2, "title": "Audio Recording Consent", "description": "I consent to audio recording..." },
        { "id": 3, "title": "Data Processing Consent", "description": "I understand my data will be processed..." }
      ]
    }

POST /candidates/interview-start
  [AUTHENTICATED with session token]
  Body:
    {
      "session_token": "abc123xyz",
      "assessment_attempt_id": 200,
      "consent_ids": [1, 2, 3]
    }
  Validation:
    - All required consents provided (ids 1, 2, 3)
  Response (200):
    {
      "interview_session_id": 300,
      "first_question": {
        "question_id": "q1",
        "question_text": "Tell me about your experience...",
        "question_number": 1,
        "tip": "Speak clearly and take your time to answer."
      },
      "timer_seconds": 2400,  -- 40 minutes
      "recording_status": "live"
    }
  Side effects:
    - INSERT interview_session with session_token, started_at=NOW()
    - Start recording (video + audio)
    - Start proctoring
    - Create consents records
    - Load first question (AI-generated or fallback)

POST /candidates/interview-answer
  [AUTHENTICATED with session token]
  Body:
    {
      "session_token": "abc123xyz",
      "interview_session_id": 300,
      "question_id": "q1",
      "answer_text": "I have 8 years of experience in...",
      "answer_duration_seconds": 45
    }
  Response (200):
    {
      "next_question": {
        "question_id": "q2",
        "question_text": "Describe a challenging...",
        "question_number": 2
      }
    }
  Side effects:
    - INSERT interview_responses (question_text, candidate_answer, asked_at, answered_at)
    - Generate next question (AI or fallback)

POST /candidates/interview-submit
  [AUTHENTICATED with session token]
  Body:
    {
      "session_token": "abc123xyz",
      "interview_session_id": 300
    }
  Response (200):
    {
      "interview_session_id": 300,
      "status": "COMPLETED",
      "total_questions": 8,
      "duration_seconds": 1200,
      "message": "Thank you for completing the interview. Our team will review your responses and contact you soon.",
      "next_step": "You will receive an email with hiring decision within 3-5 business days."
    }
  Side effects:
    - UPDATE interview_session: ended_at=NOW(), status='COMPLETED'
    - UPDATE applications: status='COMPLETED'
    - Stop recording
    - Generate AI_REPORT for interview (async job)
    - Revoke session token
    - Block re-access

-- ============================================================================
-- 12. HR DASHBOARD & CANDIDATE EVALUATION
-- ============================================================================

GET /organizations/:org_id/interviews/:interview_id/candidates/:candidate_id
  [HR of that org]
  Response (200):
    {
      "application_id": 100,
      "candidate_name": "John Doe",
      "candidate_email": "john@example.com",
      "candidate_phone": "+1-800-123-4567",
      "resume_url": "https://platform.com/files/resume_100.pdf",
      "applied_at": "2024-12-15T10:00:00Z",
      "assigned_slot_start_utc": "2024-12-20T14:00:00Z",
      "status": "COMPLETED",
      "assessment": {
        "score": 85.50,
        "total_questions": 10,
        "correct_answers": 8,
        "duration_seconds": 600,
        "questions": [
          {
            "question_id": 120,
            "question_text": "What is Python?",
            "candidate_answer": "A programming language",
            "correct_answer": "A programming language",
            "is_correct": true
          },
          ...
        ],
        "proctoring_flags": [
          { "flag_type": "TAB_SWITCH", "severity": "INFO", "triggered_at": "2024-12-20T14:05:30Z" },
          { "flag_type": "FACE_ABSENT", "severity": "WARNING", "triggered_at": "2024-12-20T14:10:15Z" }
        ]
      },
      "interview": {
        "score": 78.00,
        "total_questions": 8,
        "duration_seconds": 1200,
        "transcript": [
          {
            "question": "Tell me about your experience...",
            "answer": "I have 8 years of experience in...",
            "duration_seconds": 45
          },
          ...
        ],
        "recording_url": "https://platform.com/recordings/interview_100_session_300.mp4"
      },
      "ai_report": {
        "strengths": [
          "Strong problem-solving skills",
          "Clear communication",
          "Good technical knowledge"
        ],
        "weaknesses": [
          "Limited experience with cloud infrastructure",
          "Could improve system design approach"
        ],
        "hire_recommendation": "YES",
        "detailed_analysis": "Candidate demonstrated solid technical expertise with Python and databases. Strengths in problem-solving but needs exposure to AWS-based architectures..."
      },
      "hr_decision": {
        "decision": null,  -- or "ACCEPT" / "REJECT"
        "decided_at": null,
        "decided_by": null,
        "notes": ""
      }
    }

POST /organizations/:org_id/interviews/:interview_id/candidates/:candidate_id/decide
  [HR of that org]
  Body:
    {
      "decision": "ACCEPT",  -- or "REJECT"
      "notes": "Strong technical skills, good culture fit"
    }
  Response (200):
    {
      "application_id": 100,
      "hr_decision": {
        "decision": "ACCEPT",
        "decided_at": "2024-12-20T15:00:00Z",
        "decided_by": 15,
        "notes": "Strong technical skills, good culture fit"
      }
    }
  Side effects:
    - INSERT hr_decisions
    - UPDATE applications.status = 'ACCEPTED'|'REJECTED'
    - Audit log entry
    - Email scheduled for later (on interview close)

POST /organizations/:org_id/interviews/:interview_id/bulk-decide
  [HR of that org]
  Body:
    {
      "candidates": [
        { "candidate_id": 100, "decision": "ACCEPT", "notes": "" },
        { "candidate_id": 102, "decision": "REJECT", "notes": "Does not meet skill requirements" }
      ]
    }
  Response (200):
    {
      "total_processed": 2,
      "accepted": 1,
      "rejected": 1,
      "message": "Bulk decision processed successfully"
    }
  Side effects:
    - For each candidate: INSERT hr_decisions, UPDATE applications
    - Audit log entries for each

-- ============================================================================
-- 13. EXCEL EXPORT
-- ============================================================================

GET /organizations/:org_id/interviews/:interview_id/export-candidates
  [HR of that org]
  Query params:
    - format: "xlsx" (only format supported in MVP)
    - include_proctoring_flags: true|false (optional, default false)
  Response: (Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
    (Binary Excel file)
  Filename: Senior_Software_Engineer_candidates_2024-12-20.xlsx
  Side effects:
    - Audit log: "Excel export downloaded by [user]"

-- ============================================================================
-- 14. PROCTORING & MONITORING
-- ============================================================================

POST /candidates/proctoring-flag
  [AUTHENTICATED, sent from browser/client]
  Body:
    {
      "session_token": "abc123xyz",
      "assessment_attempt_id": 200,  -- OR interview_session_id: 300
      "flag_type": "TAB_SWITCH",  -- or other types
      "severity": "INFO",
      "description": "User switched tabs at 14:05:30"
    }
  Response (200):
    { "message": "Flag recorded" }
  Side effects:
    - INSERT proctoring_flags
    - Send alert to monitoring service (if configured)

-- ============================================================================
-- 15. NOTIFICATION & AUDIT
-- ============================================================================

GET /admin/audit-logs
  [ADMIN only]
  Query params:
    - action_type: ORGANIZATION_CREATED|INTERVIEW_PUBLISHED|DECISION_MADE|... (optional)
    - start_date: ISO 8601 (optional)
    - end_date: ISO 8601 (optional)
    - limit: 50
    - offset: 0
  Response (200):
    {
      "total": 150,
      "logs": [
        {
          "id": 1,
          "actor_user_id": 5,
          "actor_role": "ORG_ADMIN",
          "action_type": "INTERVIEW_PUBLISHED",
          "entity_type": "INTERVIEW",
          "entity_id": 5,
          "old_values": { "status": "DRAFT" },
          "new_values": { "status": "PUBLISHED" },
          "created_at": "2024-12-15T10:00:00Z"
        }
      ]
    }

GET /organizations/:org_id/notification-logs
  [ORG_ADMIN, HR of that org]
  Response (200):
    {
      "total": 50,
      "notifications": [
        {
          "id": 1,
          "notification_type": "APPLICATION_RECEIVED",
          "recipient_email": "john@example.com",
          "scheduled_send_at": "2024-12-15T10:00:00Z",
          "status": "SENT",
          "sent_at": "2024-12-15T10:00:15Z",
          "provider": "SENDGRID",
          "response_code": 202
        }
      ]
    }

-- ============================================================================
-- END OF API ENDPOINTS
-- ============================================================================
