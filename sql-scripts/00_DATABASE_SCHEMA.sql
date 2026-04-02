-- ============================================================================
-- VIRTUAL INTERVIEW PLATFORM - SUPABASE SCHEMA (MVP)
-- ============================================================================
-- Simplified PostgreSQL schema for Supabase with RLS-ready structure
-- Timezone: UTC only throughout
-- Uses Supabase conventions (clean, simple, RLS-friendly)
-- ============================================================================

-- Enable extensions for Supabase
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ENUMS & TYPES
-- ============================================================================

CREATE TYPE user_role AS ENUM ('ADMIN', 'ORG_ADMIN', 'HR');
CREATE TYPE org_request_status AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED');
CREATE TYPE interview_status AS ENUM ('DRAFT', 'PUBLISHED', 'LOCKED', 'IN_PROGRESS', 'CLOSED');
CREATE TYPE application_status AS ENUM ('APPLIED', 'SLOT_ASSIGNED', 'ASSESSMENT_IN_PROGRESS', 'INTERVIEW_IN_PROGRESS', 'COMPLETED', 'ACCEPTED', 'REJECTED', 'NO_SHOW', 'FAILED_PARTIAL');
CREATE TYPE notification_type AS ENUM ('ORG_REQUEST_ACCEPTED', 'ORG_REQUEST_REJECTED', 'APPLICATION_RECEIVED', 'SLOT_ASSIGNED', 'ASSESSMENT_CREDENTIALS', 'ASSESSMENT_REMINDER_24H', 'INTERVIEW_CREDENTIALS', 'CANDIDATE_DECISION_ACCEPTED', 'CANDIDATE_DECISION_REJECTED');
CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TYPE hire_recommendation AS ENUM ('STRONG_YES', 'YES', 'MAYBE', 'NO', 'STRONG_NO');
CREATE TYPE hr_decision AS ENUM ('ACCEPT', 'REJECT');
CREATE TYPE proctoring_flag_severity AS ENUM ('INFO', 'WARNING');

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Organizations
CREATE TABLE organizations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  website TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Organization Requests (for onboarding)
CREATE TABLE organization_requests (
  id BIGSERIAL PRIMARY KEY,
  organization_name TEXT NOT NULL,
  organization_email TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  employees_count INT,
  status org_request_status DEFAULT 'SUBMITTED',
  rejection_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Users (admin, org users, HR) - linked to Supabase Auth
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  auth_id UUID UNIQUE,  -- Links to Supabase Auth table
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  role user_role NOT NULL,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_organization_id ON users(organization_id);
CREATE INDEX idx_users_email ON users(email);

-- Jobs (positions within organization)
CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  position_title TEXT NOT NULL,
  job_description TEXT NOT NULL,
  skills_required JSONB,  -- Array of skills
  ctc_min DECIMAL(12, 2),
  ctc_max DECIMAL(12, 2),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_jobs_organization_id ON jobs(organization_id);

-- Interviews
CREATE TABLE interviews (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assessment_duration_minutes INT DEFAULT 20,
  interview_duration_minutes INT DEFAULT 40,
  campaign_start_utc TIMESTAMPTZ,  -- Admin-provided interview window start (Part 1)
  campaign_end_utc TIMESTAMPTZ,    -- Admin-provided interview window end (Part 1)
  status interview_status DEFAULT 'DRAFT',
  published_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_interviews_organization_id ON interviews(organization_id);
CREATE INDEX idx_interviews_job_id ON interviews(job_id);
CREATE INDEX idx_interviews_status ON interviews(status);

-- Assessment Slots (separate from interview slots)
CREATE TABLE assessment_slots (
  id BIGSERIAL PRIMARY KEY,
  interview_id BIGINT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  slot_start_utc TIMESTAMPTZ NOT NULL,
  slot_end_utc TIMESTAMPTZ NOT NULL,
  max_candidates INT DEFAULT 10,
  assigned_candidates INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_assessment_slots_interview_id ON assessment_slots(interview_id);

-- Interview Slots (separate from assessment slots)
CREATE TABLE interview_slots (
  id BIGSERIAL PRIMARY KEY,
  interview_id BIGINT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  slot_start_utc TIMESTAMPTZ NOT NULL,
  slot_end_utc TIMESTAMPTZ NOT NULL,
  max_candidates INT DEFAULT 10,
  assigned_candidates INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_interview_slots_interview_id ON interview_slots(interview_id);

-- Assessment Question Sets (per interview)
CREATE TABLE assessment_question_sets (
  id BIGSERIAL PRIMARY KEY,
  interview_id BIGINT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  is_ai_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_assessment_question_sets_interview_id ON assessment_question_sets(interview_id);

-- Assessment Questions with Options (simplified: options as JSONB)
CREATE TABLE assessment_questions (
  id BIGSERIAL PRIMARY KEY,
  question_set_id BIGINT NOT NULL REFERENCES assessment_question_sets(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_order INT NOT NULL,
  options JSONB NOT NULL,  -- Array of {label, text, is_correct}
  correct_option_label TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_assessment_questions_question_set_id ON assessment_questions(question_set_id);

-- Interview Fallback Questions
CREATE TABLE interview_fallback_questions (
  id BIGSERIAL PRIMARY KEY,
  interview_id BIGINT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  difficulty_level TEXT NOT NULL,  -- EASY, MEDIUM, HARD
  question_order INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_interview_fallback_questions_interview_id ON interview_fallback_questions(interview_id);

-- Application Links (published candidate application URLs)
CREATE TABLE application_links (
  id BIGSERIAL PRIMARY KEY,
  interview_id BIGINT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  application_token UUID NOT NULL UNIQUE,
  application_link TEXT NOT NULL,
  application_form_config JSONB NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CHECK (valid_until > valid_from)
);

CREATE INDEX idx_application_links_interview_id ON application_links(interview_id);
CREATE INDEX idx_application_links_token ON application_links(application_token);
CREATE UNIQUE INDEX idx_application_links_one_active_per_interview
  ON application_links(interview_id)
  WHERE is_active = TRUE;

-- Applications (candidate applications)
CREATE TABLE applications (
  id BIGSERIAL PRIMARY KEY,
  interview_id BIGINT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  candidate_name TEXT NOT NULL,
  candidate_email TEXT NOT NULL,
  candidate_phone TEXT,
  candidate_photo_path TEXT,
  resume_file_path TEXT,
  resume_file_size INT,  -- in bytes
  status application_status DEFAULT 'APPLIED',
  assigned_slot_id BIGINT REFERENCES interview_slots(id) ON DELETE SET NULL,
  slot_assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_applications_interview_id ON applications(interview_id);
CREATE INDEX idx_applications_candidate_email ON applications(candidate_email);
CREATE UNIQUE INDEX ux_applications_interview_email_ci ON applications(interview_id, lower(candidate_email));
CREATE INDEX idx_applications_status ON applications(status);

-- Candidate Slot Preferences (3 assessment + 3 interview slots, ordered by preference)
CREATE TABLE application_slot_preferences (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  slot_type TEXT NOT NULL CHECK (slot_type IN ('assessment', 'interview')),  -- 'assessment' or 'interview'
  preference_rank INT NOT NULL CHECK (preference_rank IN (1, 2, 3)),
  preferred_assessment_slot_id BIGINT REFERENCES assessment_slots(id) ON DELETE CASCADE,  -- Used when slot_type='assessment'
  preferred_interview_slot_id BIGINT REFERENCES interview_slots(id) ON DELETE CASCADE,     -- Used when slot_type='interview'
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  -- Constraint: exactly one slot ID should be set based on slot_type
  CHECK (
    (slot_type = 'assessment' AND preferred_assessment_slot_id IS NOT NULL AND preferred_interview_slot_id IS NULL)
    OR
    (slot_type = 'interview' AND preferred_interview_slot_id IS NOT NULL AND preferred_assessment_slot_id IS NULL)
  )
);

-- Unique constraint: one assessment preference per rank, one interview preference per rank
CREATE UNIQUE INDEX idx_application_slot_preferences_rank 
  ON application_slot_preferences(application_id, slot_type, preference_rank);

-- Assessment Attempts
CREATE TABLE assessment_attempts (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  status application_status,
  total_questions INT,
  correct_answers INT DEFAULT 0,
  score DECIMAL(5, 2),  -- percentage
  duration_seconds INT,
  session_token TEXT UNIQUE NOT NULL,
  session_valid_from TIMESTAMPTZ NOT NULL,
  session_valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_assessment_attempts_application_id ON assessment_attempts(application_id);
CREATE INDEX idx_assessment_attempts_session_token ON assessment_attempts(session_token);

-- Assessment Responses
CREATE TABLE assessment_responses (
  id BIGSERIAL PRIMARY KEY,
  assessment_attempt_id BIGINT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES assessment_questions(id) ON DELETE CASCADE,
  selected_option_label TEXT,
  is_correct BOOLEAN,
  answered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_assessment_responses_attempt_id ON assessment_responses(assessment_attempt_id);

-- Interview Sessions
CREATE TABLE interview_sessions (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  assessment_attempt_id BIGINT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  status application_status,
  total_questions_asked INT DEFAULT 0,
  score DECIMAL(5, 2),
  duration_seconds INT,
  session_token TEXT UNIQUE NOT NULL,
  session_valid_from TIMESTAMPTZ NOT NULL,
  session_valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_interview_sessions_application_id ON interview_sessions(application_id);
CREATE INDEX idx_interview_sessions_session_token ON interview_sessions(session_token);

-- Interview Responses (Q&A transcript)
CREATE TABLE interview_responses (
  id BIGSERIAL PRIMARY KEY,
  interview_session_id BIGINT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  is_fallback_question BOOLEAN DEFAULT FALSE,
  fallback_question_id BIGINT REFERENCES interview_fallback_questions(id) ON DELETE SET NULL,
  candidate_answer TEXT NOT NULL,
  asked_at TIMESTAMPTZ NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL,
  question_duration_seconds INT
);

CREATE INDEX idx_interview_responses_session_id ON interview_responses(interview_session_id);

-- Recordings (video/audio files)
CREATE TABLE recordings (
  id BIGSERIAL PRIMARY KEY,
  interview_session_id BIGINT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  recording_type TEXT NOT NULL,  -- INTERVIEW, PROCTORING
  file_path TEXT NOT NULL,
  file_size INT,
  mime_type TEXT,
  is_encrypted BOOLEAN DEFAULT TRUE,
  duration_seconds INT,
  retention_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recordings_interview_session_id ON recordings(interview_session_id);
CREATE INDEX idx_recordings_retention_until ON recordings(retention_until);

-- Proctoring Flags
CREATE TABLE proctoring_flags (
  id BIGSERIAL PRIMARY KEY,
  assessment_attempt_id BIGINT REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  interview_session_id BIGINT REFERENCES interview_sessions(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL,
  severity proctoring_flag_severity DEFAULT 'INFO',
  description TEXT,
  triggered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_proctoring_flags_attempt_id ON proctoring_flags(assessment_attempt_id);
CREATE INDEX idx_proctoring_flags_session_id ON proctoring_flags(interview_session_id);

-- AI Reports
CREATE TABLE ai_reports (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  interview_session_id BIGINT REFERENCES interview_sessions(id),
  report_type TEXT NOT NULL,  -- ASSESSMENT, INTERVIEW
  transcript_summary TEXT,
  score DECIMAL(5, 2),
  strengths JSONB,  -- Array of strings
  weaknesses JSONB,  -- Array of strings
  hire_recommendation hire_recommendation,
  detailed_analysis TEXT,
  generated_at TIMESTAMPTZ NOT NULL,
  generated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_reports_application_id ON ai_reports(application_id);

-- HR Decisions
CREATE TABLE hr_decisions (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  decision hr_decision NOT NULL,
  decided_by BIGINT NOT NULL REFERENCES users(id),
  decided_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_hr_decisions_application_id ON hr_decisions(application_id);

-- Consents (GDPR/recording consent)
CREATE TABLE consents (
  id BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL,  -- VIDEO_RECORDING, AUDIO_RECORDING, DATA_PROCESSING
  consent_given BOOLEAN NOT NULL,
  policy_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consents_application_id ON consents(application_id);

-- Notification Events
CREATE TABLE notification_events (
  id BIGSERIAL PRIMARY KEY,
  notification_type notification_type NOT NULL,
  application_id BIGINT REFERENCES applications(id) ON DELETE CASCADE,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  organization_request_id BIGINT REFERENCES organization_requests(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  scheduled_send_at TIMESTAMPTZ NOT NULL,
  status notification_status DEFAULT 'PENDING',
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notification_events_scheduled_send_at ON notification_events(scheduled_send_at);
CREATE INDEX idx_notification_events_status ON notification_events(status);

-- Notification Deliveries (send logs)
CREATE TABLE notification_deliveries (
  id BIGSERIAL PRIMARY KEY,
  notification_event_id BIGINT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  status notification_status NOT NULL,
  provider TEXT NOT NULL,
  response_code INT,
  response_message TEXT,
  attempt_number INT DEFAULT 1,
  sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notification_deliveries_event_id ON notification_deliveries(notification_event_id);

-- Audit Logs
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id),
  actor_role user_role NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id BIGINT,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_actor_user_id ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
-- Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE proctoring_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Note: RLS Policies should be defined in application layer or auth service
-- Examples below (comment out if implementing in application):

-- Users can only see their own organization data
CREATE POLICY "Users see own organization" ON users
  FOR SELECT USING (
    auth.uid()::text = auth_id::text OR 
    (SELECT role FROM users WHERE auth_id = auth.uid()) = 'ADMIN'
  );

-- HR can only see their organization's interviews
CREATE POLICY "HR sees own org interviews" ON interviews
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE auth_id = auth.uid()
    )
  );

-- Candidates can only see their own applications via session token (handled in app)
-- Prevent deletion of important records
CREATE POLICY "Admins can delete" ON interviews
  FOR DELETE USING (
    (SELECT role FROM users WHERE auth_id = auth.uid()) = 'ADMIN'
  );

-- ============================================================================
-- BUSINESS RULES & CONSTRAINTS (Application Layer)
-- ============================================================================
-- Note: The following checks are better enforced in the application layer
-- but basic constraints are listed here for reference

-- Ensure slot times don't exceed interview window (enforce in app)
-- Ensure assessment before interview dates (enforce in app)
-- Ensure interview edit lock 24h before start (enforce in app)
-- Ensure no retry for NO_SHOW/FAILED_PARTIAL (enforce in app)
-- Ensure session tokens expire after valid_until (enforce in app)
-- Ensure recording auto-delete after retention_until (via scheduled job)

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to mark interviews as locked (24h before assessment)
CREATE OR REPLACE FUNCTION mark_interviews_locked()
RETURNS void AS $$
BEGIN
  UPDATE interviews
  SET status = 'LOCKED', locked_at = CURRENT_TIMESTAMP
  WHERE status = 'PUBLISHED'
    AND assessment_start_utc <= CURRENT_TIMESTAMP + INTERVAL '24 hours'
    AND locked_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to assign candidates to slots (25h before assessment)
CREATE OR REPLACE FUNCTION assign_candidates_to_slots()
RETURNS void AS $$
BEGIN
  -- Logic: match applications with preferences to available slots
  -- This should be run as a scheduled job via Supabase Edge Functions
  -- or application backend service
  NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to mark no-show candidates
CREATE OR REPLACE FUNCTION mark_no_show_candidates()
RETURNS void AS $$
BEGIN
  UPDATE applications
  SET status = 'NO_SHOW'
  WHERE id IN (
    SELECT a.id FROM applications a
    JOIN interview_slots s ON a.assigned_slot_id = s.id
    WHERE a.status = 'SLOT_ASSIGNED'
      AND CURRENT_TIMESTAMP > s.slot_start_utc
      AND NOT EXISTS (
        SELECT 1 FROM assessment_attempts aa
        WHERE aa.application_id = a.id AND aa.started_at IS NOT NULL
      )
  );
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old recordings
CREATE OR REPLACE FUNCTION delete_expired_recordings()
RETURNS void AS $$
BEGIN
  DELETE FROM recordings
  WHERE retention_until <= CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS (for fast dashboard queries)
-- ============================================================================

CREATE VIEW candidate_performance_summary AS
SELECT
  a.id AS application_id,
  a.candidate_name,
  a.candidate_email,
  i.id AS interview_id,
  j.position_title,
  a.created_at AS applied_at,
  (SELECT score FROM assessment_attempts WHERE application_id = a.id LIMIT 1) AS assessment_score,
  (SELECT score FROM interview_sessions WHERE application_id = a.id LIMIT 1) AS interview_score,
  (SELECT hire_recommendation FROM ai_reports WHERE application_id = a.id AND report_type = 'INTERVIEW' LIMIT 1) AS hire_recommendation,
  (SELECT decision FROM hr_decisions WHERE application_id = a.id LIMIT 1) AS final_decision,
  a.status
FROM applications a
LEFT JOIN interviews i ON a.interview_id = i.id
LEFT JOIN jobs j ON i.job_id = j.id
ORDER BY a.created_at DESC;

CREATE VIEW interview_status_dashboard AS
SELECT
  i.id AS interview_id,
  i.title,
  j.position_title,
  COUNT(DISTINCT a.id) AS total_applications,
  COUNT(DISTINCT CASE WHEN a.status IN ('COMPLETED', 'ACCEPTED', 'REJECTED') THEN a.id END) AS completed,
  COUNT(DISTINCT CASE WHEN a.status = 'ACCEPTED' THEN a.id END) AS accepted,
  COUNT(DISTINCT CASE WHEN a.status = 'REJECTED' THEN a.id END) AS rejected,
  i.assessment_start_utc,
  i.status
FROM interviews i
LEFT JOIN jobs j ON i.job_id = j.id
LEFT JOIN applications a ON i.id = a.interview_id
GROUP BY i.id, i.title, j.position_title, i.assessment_start_utc, i.status;

-- ============================================================================
-- MIGRATION NOTES
-- ============================================================================
-- This schema is designed for Supabase and uses:
-- - Simple, clean table structures
-- - BIGSERIAL for IDs (safer for growth)
-- - JSONB for flexible nested data (skills, options, analysis)
-- - RLS policies for row-level security
-- - Helper functions for scheduled jobs (run via pg_cron or Supabase Edge Functions)
--
-- To deploy with Supabase CLI:
-- 1. supabase migrations new init_schema
-- 2. Copy this file contents to migrations/TIMESTAMP_init_schema.sql
-- 3. supabase db push
--
-- To enable RLS policies in production:
-- 1. Uncomment RLS policies above
-- 2. Create additional policies as needed in your Supabase dashboard
-- 3. Update auth.uid() references with your actual auth provider setup
--
-- Scheduled jobs (run in application or Edge Functions):
-- - mark_interviews_locked() - every 30 min
-- - assign_candidates_to_slots() - custom timing per interview
-- - mark_no_show_candidates() - every 1 hour after slot start times
-- - delete_expired_recordings() - daily at 02:00 UTC
--
-- ============================================================================
-- END OF SCHEMA
-- ============================================================================




















































-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.ai_reports (
  id bigint NOT NULL DEFAULT nextval('ai_reports_id_seq'::regclass),
  application_id bigint NOT NULL,
  interview_session_id bigint,
  report_type text NOT NULL,
  transcript_summary text,
  score numeric,
  strengths jsonb,
  weaknesses jsonb,
  hire_recommendation USER-DEFINED,
  detailed_analysis text,
  generated_at TIMESTAMPTZ NOT NULL,
  generated_by text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ai_reports_pkey PRIMARY KEY (id),
  CONSTRAINT ai_reports_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id),
  CONSTRAINT ai_reports_interview_session_id_fkey FOREIGN KEY (interview_session_id) REFERENCES public.interview_sessions(id)
);
CREATE TABLE public.application_slot_preferences (
  id bigint NOT NULL DEFAULT nextval('application_slot_preferences_id_seq'::regclass),
  application_id bigint NOT NULL,
  preference_rank integer NOT NULL CHECK (preference_rank = ANY (ARRAY[1, 2, 3])),
  preferred_slot_id bigint NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT application_slot_preferences_pkey PRIMARY KEY (id),
  CONSTRAINT application_slot_preferences_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id),
  CONSTRAINT application_slot_preferences_preferred_slot_id_fkey FOREIGN KEY (preferred_slot_id) REFERENCES public.interview_slots(id)
);
CREATE TABLE public.applications (
  id bigint NOT NULL DEFAULT nextval('applications_id_seq'::regclass),
  interview_id bigint NOT NULL,
  candidate_name text NOT NULL,
  candidate_email text NOT NULL,
  candidate_phone text,
  candidate_photo_path text,
  resume_file_path text,
  resume_file_size integer CHECK (resume_file_size IS NULL OR resume_file_size >= 0),
  status USER-DEFINED DEFAULT 'APPLIED'::application_status,
  assigned_slot_id bigint,
  slot_assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT applications_pkey PRIMARY KEY (id),
  CONSTRAINT applications_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interviews(id),
  CONSTRAINT applications_assigned_slot_id_fkey FOREIGN KEY (assigned_slot_id) REFERENCES public.interview_slots(id)
);
CREATE TABLE public.assessment_attempts (
  id bigint NOT NULL DEFAULT nextval('assessment_attempts_id_seq'::regclass),
  application_id bigint NOT NULL,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  status USER-DEFINED,
  total_questions integer,
  correct_answers integer DEFAULT 0,
  score numeric CHECK (score IS NULL OR score >= 0::numeric AND score <= 100::numeric),
  duration_seconds integer,
  session_token text NOT NULL UNIQUE,
  session_valid_from TIMESTAMPTZ NOT NULL,
  session_valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assessment_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT assessment_attempts_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id)
);
CREATE TABLE public.assessment_question_sets (
  id bigint NOT NULL DEFAULT nextval('assessment_question_sets_id_seq'::regclass),
  interview_id bigint NOT NULL,
  is_ai_generated boolean DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assessment_question_sets_pkey PRIMARY KEY (id),
  CONSTRAINT assessment_question_sets_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interviews(id)
);
CREATE TABLE public.assessment_questions (
  id bigint NOT NULL DEFAULT nextval('assessment_questions_id_seq'::regclass),
  question_set_id bigint NOT NULL,
  question_text text NOT NULL,
  question_order integer NOT NULL,
  options jsonb NOT NULL,
  correct_option_label text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assessment_questions_pkey PRIMARY KEY (id),
  CONSTRAINT assessment_questions_question_set_id_fkey FOREIGN KEY (question_set_id) REFERENCES public.assessment_question_sets(id)
);
CREATE TABLE public.assessment_responses (
  id bigint NOT NULL DEFAULT nextval('assessment_responses_id_seq'::regclass),
  assessment_attempt_id bigint NOT NULL,
  question_id bigint NOT NULL,
  selected_option_label text,
  is_correct boolean,
  answered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assessment_responses_pkey PRIMARY KEY (id),
  CONSTRAINT assessment_responses_assessment_attempt_id_fkey FOREIGN KEY (assessment_attempt_id) REFERENCES public.assessment_attempts(id),
  CONSTRAINT assessment_responses_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.assessment_questions(id)
);
CREATE TABLE public.assessment_slots (
  id bigint NOT NULL DEFAULT nextval('assessment_slots_id_seq'::regclass),
  interview_id bigint NOT NULL,
  slot_start_utc TIMESTAMPTZ NOT NULL,
  slot_end_utc TIMESTAMPTZ NOT NULL,
  max_candidates integer DEFAULT 10,
  assigned_candidates integer DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assessment_slots_pkey PRIMARY KEY (id),
  CONSTRAINT assessment_slots_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interviews(id)
);
CREATE TABLE public.audit_logs (
  id bigint NOT NULL DEFAULT nextval('audit_logs_id_seq'::regclass),
  actor_user_id bigint,
  actor_role USER-DEFINED NOT NULL,
  action_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id bigint,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id)
);
CREATE TABLE public.consents (
  id bigint NOT NULL DEFAULT nextval('consents_id_seq'::regclass),
  application_id bigint NOT NULL,
  consent_type text NOT NULL,
  consent_given boolean NOT NULL,
  policy_version text NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL,
  ip_address inet,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT consents_pkey PRIMARY KEY (id),
  CONSTRAINT consents_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id)
);
CREATE TABLE public.hr_decisions (
  id bigint NOT NULL DEFAULT nextval('hr_decisions_id_seq'::regclass),
  application_id bigint NOT NULL UNIQUE,
  decision USER-DEFINED NOT NULL,
  decided_by bigint NOT NULL,
  decided_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  notes text,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT hr_decisions_pkey PRIMARY KEY (id),
  CONSTRAINT hr_decisions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id),
  CONSTRAINT hr_decisions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id)
);
CREATE TABLE public.interview_fallback_questions (
  id bigint NOT NULL DEFAULT nextval('interview_fallback_questions_id_seq'::regclass),
  interview_id bigint NOT NULL,
  question_text text NOT NULL,
  difficulty_level text NOT NULL,
  question_order integer NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT interview_fallback_questions_pkey PRIMARY KEY (id),
  CONSTRAINT interview_fallback_questions_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interviews(id)
);
CREATE TABLE public.interview_responses (
  id bigint NOT NULL DEFAULT nextval('interview_responses_id_seq'::regclass),
  interview_session_id bigint NOT NULL,
  question_text text NOT NULL,
  is_fallback_question boolean DEFAULT false,
  fallback_question_id bigint,
  candidate_answer text NOT NULL,
  asked_at TIMESTAMPTZ NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL,
  question_duration_seconds integer,
  CONSTRAINT interview_responses_pkey PRIMARY KEY (id),
  CONSTRAINT interview_responses_interview_session_id_fkey FOREIGN KEY (interview_session_id) REFERENCES public.interview_sessions(id),
  CONSTRAINT interview_responses_fallback_question_id_fkey FOREIGN KEY (fallback_question_id) REFERENCES public.interview_fallback_questions(id)
);
CREATE TABLE public.interview_sessions (
  id bigint NOT NULL DEFAULT nextval('interview_sessions_id_seq'::regclass),
  application_id bigint NOT NULL,
  assessment_attempt_id bigint NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  status USER-DEFINED,
  total_questions_asked integer DEFAULT 0,
  score numeric CHECK (score IS NULL OR score >= 0::numeric AND score <= 100::numeric),
  duration_seconds integer,
  session_token text NOT NULL UNIQUE,
  session_valid_from TIMESTAMPTZ NOT NULL,
  session_valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT interview_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT interview_sessions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id),
  CONSTRAINT interview_sessions_assessment_attempt_id_fkey FOREIGN KEY (assessment_attempt_id) REFERENCES public.assessment_attempts(id)
);
CREATE TABLE public.interview_slots (
  id bigint NOT NULL DEFAULT nextval('interview_slots_id_seq'::regclass),
  interview_id bigint NOT NULL,
  slot_start_utc TIMESTAMPTZ NOT NULL,
  slot_end_utc TIMESTAMPTZ NOT NULL,
  max_candidates integer DEFAULT 10,
  assigned_candidates integer DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT interview_slots_pkey PRIMARY KEY (id),
  CONSTRAINT interview_slots_interview_id_fkey FOREIGN KEY (interview_id) REFERENCES public.interviews(id)
);
CREATE TABLE public.interviews (
  id bigint NOT NULL DEFAULT nextval('interviews_id_seq'::regclass),
  organization_id bigint NOT NULL,
  job_id bigint NOT NULL,
  title text NOT NULL,
  assessment_duration_minutes integer DEFAULT 20,
  interview_duration_minutes integer DEFAULT 40,
  status USER-DEFINED DEFAULT 'DRAFT'::interview_status,
  published_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  campaign_start_utc TIMESTAMPTZ,
  campaign_end_utc TIMESTAMPTZ,
  CONSTRAINT interviews_pkey PRIMARY KEY (id),
  CONSTRAINT interviews_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT interviews_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id)
);
CREATE TABLE public.jobs (
  id bigint NOT NULL DEFAULT nextval('jobs_id_seq'::regclass),
  organization_id bigint NOT NULL,
  position_title text NOT NULL,
  job_description text NOT NULL,
  skills_required jsonb,
  ctc_min numeric,
  ctc_max numeric,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT jobs_pkey PRIMARY KEY (id),
  CONSTRAINT jobs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.notification_deliveries (
  id bigint NOT NULL DEFAULT nextval('notification_deliveries_id_seq'::regclass),
  notification_event_id bigint NOT NULL,
  status USER-DEFINED NOT NULL,
  provider text NOT NULL,
  response_code integer,
  response_message text,
  attempt_number integer DEFAULT 1 CHECK (attempt_number IS NULL OR attempt_number >= 1),
  sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id),
  CONSTRAINT notification_deliveries_notification_event_id_fkey FOREIGN KEY (notification_event_id) REFERENCES public.notification_events(id)
);
CREATE TABLE public.notification_events (
  id bigint NOT NULL DEFAULT nextval('notification_events_id_seq'::regclass),
  notification_type USER-DEFINED NOT NULL,
  application_id bigint,
  organization_id bigint,
  organization_request_id bigint,
  recipient_email text NOT NULL,
  recipient_name text,
  scheduled_send_at TIMESTAMPTZ NOT NULL,
  status USER-DEFINED DEFAULT 'PENDING'::notification_status,
  idempotency_key text NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_events_pkey PRIMARY KEY (id),
  CONSTRAINT notification_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT notification_events_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id),
  CONSTRAINT notification_events_organization_request_id_fkey FOREIGN KEY (organization_request_id) REFERENCES public.organization_requests(id)
);
CREATE TABLE public.organization_requests (
  id bigint NOT NULL DEFAULT nextval('organization_requests_id_seq'::regclass),
  organization_name text NOT NULL,
  organization_email text NOT NULL,
  contact_person text NOT NULL,
  phone text,
  website text,
  employees_count integer,
  status USER-DEFINED DEFAULT 'SUBMITTED'::org_request_status,
  rejection_reason text,
  reviewed_at TIMESTAMPTZ,
  organization_id bigint,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT organization_requests_pkey PRIMARY KEY (id),
  CONSTRAINT organization_requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.organizations (
  id bigint NOT NULL DEFAULT nextval('organizations_id_seq'::regclass),
  name text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  phone text,
  website text,
  is_active boolean DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT organizations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.proctoring_flags (
  id bigint NOT NULL DEFAULT nextval('proctoring_flags_id_seq'::regclass),
  assessment_attempt_id bigint,
  interview_session_id bigint,
  flag_type text NOT NULL,
  severity USER-DEFINED DEFAULT 'INFO'::proctoring_flag_severity,
  description text,
  triggered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT proctoring_flags_pkey PRIMARY KEY (id),
  CONSTRAINT proctoring_flags_assessment_attempt_id_fkey FOREIGN KEY (assessment_attempt_id) REFERENCES public.assessment_attempts(id),
  CONSTRAINT proctoring_flags_interview_session_id_fkey FOREIGN KEY (interview_session_id) REFERENCES public.interview_sessions(id)
);
CREATE TABLE public.recordings (
  id bigint NOT NULL DEFAULT nextval('recordings_id_seq'::regclass),
  interview_session_id bigint NOT NULL,
  recording_type text NOT NULL,
  file_path text NOT NULL,
  file_size integer CHECK (file_size IS NULL OR file_size >= 0),
  mime_type text,
  is_encrypted boolean DEFAULT true,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  retention_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT recordings_pkey PRIMARY KEY (id),
  CONSTRAINT recordings_interview_session_id_fkey FOREIGN KEY (interview_session_id) REFERENCES public.interview_sessions(id)
);
CREATE TABLE public.users (
  id bigint NOT NULL DEFAULT nextval('users_id_seq'::regclass),
  auth_id uuid UNIQUE,
  email text NOT NULL UNIQUE,
  first_name text,
  last_name text,
  role USER-DEFINED NOT NULL,
  organization_id bigint,
  is_active boolean DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);

