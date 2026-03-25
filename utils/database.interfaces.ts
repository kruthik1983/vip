export type TimestampString = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
    [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type UserRole = "ADMIN" | "ORG_ADMIN" | "HR";
export type OrgRequestStatus = "SUBMITTED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED";
export type InterviewStatus = "DRAFT" | "PUBLISHED" | "LOCKED" | "IN_PROGRESS" | "CLOSED";
export type ApplicationStatus =
    | "APPLIED"
    | "SLOT_ASSIGNED"
    | "ASSESSMENT_IN_PROGRESS"
    | "INTERVIEW_IN_PROGRESS"
    | "COMPLETED"
    | "ACCEPTED"
    | "REJECTED"
    | "NO_SHOW"
    | "FAILED_PARTIAL";
export type NotificationType =
    | "ORG_REQUEST_ACCEPTED"
    | "ORG_REQUEST_REJECTED"
    | "APPLICATION_RECEIVED"
    | "SLOT_ASSIGNED"
    | "ASSESSMENT_REMINDER_24H"
    | "CANDIDATE_DECISION_ACCEPTED"
    | "CANDIDATE_DECISION_REJECTED";
export type NotificationStatus = "PENDING" | "SENT" | "FAILED";
export type HireRecommendation = "STRONG_YES" | "YES" | "MAYBE" | "NO" | "STRONG_NO";
export type HrDecision = "ACCEPT" | "REJECT";
export type ProctoringFlagSeverity = "INFO" | "WARNING";

export interface AssessmentQuestionOption {
    label: string;
    text: string;
    is_correct: boolean;
}

export interface Organization {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    website: string | null;
    is_active: boolean | null;
    created_at: TimestampString | null;
    updated_at: TimestampString | null;
}

export interface OrganizationRequest {
    id: number;
    organization_name: string;
    organization_email: string;
    contact_person: string;
    phone: string | null;
    website: string | null;
    employees_count: number | null;
    status: OrgRequestStatus | null;
    rejection_reason: string | null;
    reviewed_at: TimestampString | null;
    organization_id: number | null;
    created_at: TimestampString | null;
}

export interface User {
    id: number;
    auth_id: string | null;
    email: string;
    first_name: string | null;
    last_name: string | null;
    role: UserRole;
    organization_id: number | null;
    is_active: boolean | null;
    last_login: TimestampString | null;
    created_at: TimestampString | null;
    updated_at: TimestampString | null;
}

export interface Job {
    id: number;
    organization_id: number;
    position_title: string;
    job_description: string;
    skills_required: JsonValue | null;
    ctc_min: number | null;
    ctc_max: number | null;
    created_at: TimestampString | null;
    updated_at: TimestampString | null;
}

export interface Interview {
    id: number;
    organization_id: number;
    job_id: number;
    title: string;
    assessment_duration_minutes: number | null;
    interview_duration_minutes: number | null;
    campaign_start_utc: TimestampString | null;
    campaign_end_utc: TimestampString | null;
    assessment_start_utc: TimestampString;
    assessment_end_utc: TimestampString;
    interview_start_utc: TimestampString;
    interview_end_utc: TimestampString;
    status: InterviewStatus | null;
    published_at: TimestampString | null;
    locked_at: TimestampString | null;
    created_at: TimestampString | null;
    updated_at: TimestampString | null;
}

export interface InterviewSlot {
    id: number;
    interview_id: number;
    slot_start_utc: TimestampString;
    slot_end_utc: TimestampString;
    max_candidates: number | null;
    assigned_candidates: number | null;
    created_at: TimestampString | null;
}

export interface AssessmentQuestionSet {
    id: number;
    interview_id: number;
    is_ai_generated: boolean | null;
    created_at: TimestampString | null;
}

export interface AssessmentQuestion {
    id: number;
    question_set_id: number;
    question_text: string;
    question_order: number;
    options: AssessmentQuestionOption[];
    correct_option_label: string;
    created_at: TimestampString | null;
}

export interface InterviewFallbackQuestion {
    id: number;
    interview_id: number;
    question_text: string;
    difficulty_level: string;
    question_order: number;
    created_at: TimestampString | null;
}

export interface Application {
    id: number;
    interview_id: number;
    candidate_name: string;
    candidate_email: string;
    candidate_phone: string | null;
    resume_file_path: string | null;
    candidate_photo_path: string | null;
    resume_file_size: number | null;
    status: ApplicationStatus | null;
    assigned_slot_id: number | null;
    slot_assigned_at: TimestampString | null;
    created_at: TimestampString | null;
    updated_at: TimestampString | null;
}

export interface ApplicationSlotPreference {
    id: number;
    application_id: number;
    preference_rank: 1 | 2 | 3;
    preferred_slot_id: number;
    created_at: TimestampString | null;
}

export interface AssessmentAttempt {
    id: number;
    application_id: number;
    started_at: TimestampString | null;
    submitted_at: TimestampString | null;
    status: ApplicationStatus | null;
    total_questions: number | null;
    correct_answers: number | null;
    score: number | null;
    duration_seconds: number | null;
    session_token: string;
    session_valid_from: TimestampString;
    session_valid_until: TimestampString;
    created_at: TimestampString | null;
}

export interface AssessmentResponse {
    id: number;
    assessment_attempt_id: number;
    question_id: number;
    selected_option_label: string | null;
    is_correct: boolean | null;
    answered_at: TimestampString | null;
}

export interface InterviewSession {
    id: number;
    application_id: number;
    assessment_attempt_id: number;
    started_at: TimestampString | null;
    ended_at: TimestampString | null;
    status: ApplicationStatus | null;
    total_questions_asked: number | null;
    score: number | null;
    duration_seconds: number | null;
    session_token: string;
    session_valid_from: TimestampString;
    session_valid_until: TimestampString;
    created_at: TimestampString | null;
}

export interface InterviewResponse {
    id: number;
    interview_session_id: number;
    question_text: string;
    is_fallback_question: boolean | null;
    fallback_question_id: number | null;
    candidate_answer: string;
    asked_at: TimestampString;
    answered_at: TimestampString;
    question_duration_seconds: number | null;
}

export interface Recording {
    id: number;
    interview_session_id: number;
    recording_type: string;
    file_path: string;
    file_size: number | null;
    mime_type: string | null;
    is_encrypted: boolean | null;
    duration_seconds: number | null;
    retention_until: TimestampString;
    created_at: TimestampString | null;
}

export interface ProctoringFlag {
    id: number;
    assessment_attempt_id: number | null;
    interview_session_id: number | null;
    flag_type: string;
    severity: ProctoringFlagSeverity | null;
    description: string | null;
    triggered_at: TimestampString | null;
}

export interface AiReport {
    id: number;
    application_id: number;
    interview_session_id: number | null;
    report_type: string;
    transcript_summary: string | null;
    score: number | null;
    strengths: JsonValue | null;
    weaknesses: JsonValue | null;
    hire_recommendation: HireRecommendation | null;
    detailed_analysis: string | null;
    generated_at: TimestampString;
    generated_by: string;
    created_at: TimestampString | null;
}

export interface HrDecisionRecord {
    id: number;
    application_id: number;
    decision: HrDecision;
    decided_by: number;
    decided_at: TimestampString | null;
    notes: string | null;
    updated_at: TimestampString | null;
}

export interface Consent {
    id: number;
    application_id: number;
    consent_type: string;
    consent_given: boolean;
    policy_version: string;
    consented_at: TimestampString;
    ip_address: string | null;
    created_at: TimestampString | null;
}

export interface NotificationEvent {
    id: number;
    notification_type: NotificationType;
    application_id: number | null;
    organization_id: number | null;
    organization_request_id: number | null;
    recipient_email: string;
    recipient_name: string | null;
    scheduled_send_at: TimestampString;
    status: NotificationStatus | null;
    idempotency_key: string;
    created_at: TimestampString | null;
}

export interface NotificationDelivery {
    id: number;
    notification_event_id: number;
    status: NotificationStatus;
    provider: string;
    response_code: number | null;
    response_message: string | null;
    attempt_number: number | null;
    sent_at: TimestampString | null;
}

export interface AuditLog {
    id: number;
    actor_user_id: number | null;
    actor_role: UserRole;
    action_type: string;
    entity_type: string;
    entity_id: number | null;
    old_values: JsonValue | null;
    new_values: JsonValue | null;
    ip_address: string | null;
    created_at: TimestampString | null;
}

export interface CandidatePerformanceSummary {
    application_id: number;
    candidate_name: string;
    candidate_email: string;
    interview_id: number | null;
    position_title: string | null;
    applied_at: TimestampString | null;
    assessment_score: number | null;
    interview_score: number | null;
    hire_recommendation: HireRecommendation | null;
    final_decision: HrDecision | null;
    status: ApplicationStatus | null;
}

export interface InterviewStatusDashboard {
    interview_id: number;
    title: string;
    position_title: string | null;
    total_applications: number | null;
    completed: number | null;
    accepted: number | null;
    rejected: number | null;
    assessment_start_utc: TimestampString;
    status: InterviewStatus | null;
}

export interface DatabaseTables {
    organizations: Organization;
    organization_requests: OrganizationRequest;
    users: User;
    jobs: Job;
    interviews: Interview;
    interview_slots: InterviewSlot;
    assessment_question_sets: AssessmentQuestionSet;
    assessment_questions: AssessmentQuestion;
    interview_fallback_questions: InterviewFallbackQuestion;
    applications: Application;
    application_slot_preferences: ApplicationSlotPreference;
    assessment_attempts: AssessmentAttempt;
    assessment_responses: AssessmentResponse;
    interview_sessions: InterviewSession;
    interview_responses: InterviewResponse;
    recordings: Recording;
    proctoring_flags: ProctoringFlag;
    ai_reports: AiReport;
    hr_decisions: HrDecisionRecord;
    consents: Consent;
    notification_events: NotificationEvent;
    notification_deliveries: NotificationDelivery;
    audit_logs: AuditLog;
}

export interface DatabaseViews {
    candidate_performance_summary: CandidatePerformanceSummary;
    interview_status_dashboard: InterviewStatusDashboard;
}
