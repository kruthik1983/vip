-- ============================================================================
-- VIP SCHEMA OPTIMIZATION PATCH (Supabase / Postgres)
-- Generated from: 00_DATABASE_SCHEMA.sql
-- Focus: indexing, constraints, RLS performance/safety
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) INDEX OPTIMIZATIONS
-- --------------------------------------------------------------------------
-- Missing or high-value indexes for FK joins, status filtering, and dashboards.

CREATE INDEX IF NOT EXISTS idx_organization_requests_organization_id
  ON organization_requests(organization_id);

CREATE INDEX IF NOT EXISTS idx_applications_assigned_slot_id
  ON applications(assigned_slot_id);

CREATE INDEX IF NOT EXISTS idx_assessment_responses_question_id
  ON assessment_responses(question_id);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_assessment_attempt_id
  ON interview_sessions(assessment_attempt_id);

CREATE INDEX IF NOT EXISTS idx_interview_responses_fallback_question_id
  ON interview_responses(fallback_question_id);

CREATE INDEX IF NOT EXISTS idx_ai_reports_interview_session_id
  ON ai_reports(interview_session_id);

CREATE INDEX IF NOT EXISTS idx_hr_decisions_decided_by
  ON hr_decisions(decided_by);

CREATE INDEX IF NOT EXISTS idx_notification_events_application_id
  ON notification_events(application_id);

CREATE INDEX IF NOT EXISTS idx_notification_events_organization_id
  ON notification_events(organization_id);

CREATE INDEX IF NOT EXISTS idx_notification_events_organization_request_id
  ON notification_events(organization_request_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type_entity_id
  ON audit_logs(entity_type, entity_id);

-- Composite index for candidate list pages by interview + status
CREATE INDEX IF NOT EXISTS idx_applications_interview_status
  ON applications(interview_id, status);

-- Composite + partial index for pending notification job polling
CREATE INDEX IF NOT EXISTS idx_notification_events_pending_schedule
  ON notification_events(status, scheduled_send_at)
  WHERE status = 'PENDING';

-- Add integrity constraints that are deterministic and safe at DB level.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_interviews_assessment_window'
  ) THEN
    ALTER TABLE interviews
      ADD CONSTRAINT chk_interviews_assessment_window
      CHECK (assessment_end_utc > assessment_start_utc);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_interviews_interview_window'
  ) THEN
    ALTER TABLE interviews
      ADD CONSTRAINT chk_interviews_interview_window
      CHECK (interview_end_utc > interview_start_utc);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_interviews_phase_bounds'
  ) THEN
    ALTER TABLE interviews
      ADD CONSTRAINT chk_interviews_phase_bounds
      CHECK (
        assessment_start_utc <= interview_start_utc
        AND assessment_end_utc <= interview_end_utc
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_interview_slots_window'
  ) THEN
    ALTER TABLE interview_slots
      ADD CONSTRAINT chk_interview_slots_window
      CHECK (slot_end_utc > slot_start_utc);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_applications_resume_size_non_negative'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT chk_applications_resume_size_non_negative
      CHECK (resume_file_size IS NULL OR resume_file_size >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_assessment_attempts_score_range'
  ) THEN
    ALTER TABLE assessment_attempts
      ADD CONSTRAINT chk_assessment_attempts_score_range
      CHECK (score IS NULL OR (score >= 0 AND score <= 100));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_assessment_attempts_session_window'
  ) THEN
    ALTER TABLE assessment_attempts
      ADD CONSTRAINT chk_assessment_attempts_session_window
      CHECK (session_valid_until > session_valid_from);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_interview_sessions_score_range'
  ) THEN
    ALTER TABLE interview_sessions
      ADD CONSTRAINT chk_interview_sessions_score_range
      CHECK (score IS NULL OR (score >= 0 AND score <= 100));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_interview_sessions_session_window'
  ) THEN
    ALTER TABLE interview_sessions
      ADD CONSTRAINT chk_interview_sessions_session_window
      CHECK (session_valid_until > session_valid_from);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_recordings_file_size_non_negative'
  ) THEN
    ALTER TABLE recordings
      ADD CONSTRAINT chk_recordings_file_size_non_negative
      CHECK (file_size IS NULL OR file_size >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_recordings_duration_non_negative'
  ) THEN
    ALTER TABLE recordings
      ADD CONSTRAINT chk_recordings_duration_non_negative
      CHECK (duration_seconds IS NULL OR duration_seconds >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_notification_deliveries_attempt_positive'
  ) THEN
    ALTER TABLE notification_deliveries
      ADD CONSTRAINT chk_notification_deliveries_attempt_positive
      CHECK (attempt_number IS NULL OR attempt_number >= 1);
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 3) RLS PERFORMANCE + SAFETY HELPERS
-- --------------------------------------------------------------------------
-- Existing users policy references users table recursively. Move checks to
-- security definer helpers and use (select auth.uid()) pattern for performance.

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role
  FROM public.users u
  WHERE u.auth_id = (select auth.uid())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.organization_id
  FROM public.users u
  WHERE u.auth_id = (select auth.uid())
  LIMIT 1;
$$;

DROP POLICY IF EXISTS "Users see own organization" ON users;
CREATE POLICY "Users see own organization" ON users
  FOR SELECT
  USING (
    auth_id = (select auth.uid())
    OR (select public.current_user_role()) = 'ADMIN'
  );

DROP POLICY IF EXISTS "HR sees own org interviews" ON interviews;
CREATE POLICY "HR sees own org interviews" ON interviews
  FOR SELECT
  USING (
    organization_id = (select public.current_user_org_id())
    OR (select public.current_user_role()) = 'ADMIN'
  );

-- Optional hardening (enable intentionally after validating service-role flows):
-- ALTER TABLE users FORCE ROW LEVEL SECURITY;
-- ALTER TABLE interviews FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- END PATCH
-- ============================================================================
