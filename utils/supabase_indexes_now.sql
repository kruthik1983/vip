-- ============================================================================
-- VIP INDEXES ONLY (SAFE NOW)
-- Apply this first in Supabase SQL Editor
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_applications_interview_status
  ON applications(interview_id, status);

CREATE INDEX IF NOT EXISTS idx_notification_events_pending_schedule
  ON notification_events(status, scheduled_send_at)
  WHERE status = 'PENDING';

-- ============================================================================
-- END
-- ============================================================================
