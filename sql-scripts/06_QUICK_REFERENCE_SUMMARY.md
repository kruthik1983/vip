-- ============================================================================
-- VIRTUAL INTERVIEW PLATFORM - QUICK REFERENCE & PROJECT SUMMARY
-- ============================================================================
-- Last Updated: March 23, 2026
-- Status: Complete Schema-Ready Requirements
-- ============================================================================

-- ============================================================================
-- PROJECT OVERVIEW
-- ============================================================================

PROJECT NAME: Virtual Interview Platform (AI-Powered)
VISION: Multi-tenant SaaS platform enabling organizations to conduct 2-round AI-assisted
        interviews (Assessment + Interview) with built-in proctoring, recording, and
        AI-generated evaluation reports.

TARGET USERS:
  - Admin: Platform admin controlling onboarding
  - Organizations: HR teams creating and managing interviews
  - Candidates: Job applicants taking assessments + interviews

MVP SCOPE:
  ✓ Organization onboarding (request + admin approval)
  ✓ Interview creation wizard (3-step form)
  ✓ Candidate application with slot preferences (up to 3 options)
  ✓ Timed assessment (20 min, MCQ, randomized questions per candidate)
  ✓ Timed interview (40 min, open-ended Q&A with AI generation + fallback)
  ✓ Recording + proctoring (webcam/mic + tab-switch logging)
  ✓ AI-generated report (strengths, weaknesses, hire recommendation)
  ✓ HR decision workflow (individual + bulk)
  ✓ Excel export (17 fixed columns)
  ✓ Email notifications (11 email types, scheduled & triggered)
  ✓ Audit logging (all sensitive actions)

POST-MVP (NOT IN SCOPE NOW):
  - Postponement / rescheduling (MVP: no postponement)
  - Multiple hiring decision stages (MVP: single HR decision only)
  - Integration with external ATS
  - Candidate retry/rescheduling
  - Resume screening / AI shortlisting
  - Team-based interviews
  - Time zone smart scheduling (MVP: UTC only)

-- ============================================================================
-- DOCUMENT MAP
-- ============================================================================

00_DATABASE_SCHEMA.sql
  └─ Complete PostgreSQL DDL
  └─ All tables, enums, constraints, triggers, views
  └─ Audit log system
  └─ Index optimization
  └─ Foreign keys enforcing data integrity
  └─ Use: Feed directly to PostgreSQL; run as migration

01_EVENT_EMAIL_TRIGGER_MATRIX.md
  └─ All 20+ events in system (org request, interview publish, candidate apply, etc.)
  └─ Email types (11 types: APPLICATION_RECEIVED, SLOT_ASSIGNED, decision, etc.)
  └─ Exact trigger conditions (time-based, status-based)
  └─ Email payloads (fields, dynamic content, templates)
  └─ Email scheduling & retry logic
  └─ Notification queue processing (background job details)
  └─ Use: Reference for testing email workflows; implement job scheduler per spec

02_STATE_MACHINES.md
  └─ 7 state machines:
     1. Organization request (SUBMITTED -> ACCEPTED/REJECTED)
     2. Interview (DRAFT -> PUBLISHED -> LOCKED -> IN_PROGRESS -> CLOSED)
     3. Application (APPLIED -> SLOT_ASSIGNED -> ... -> COMPLETED -> ACCEPTED/REJECTED)
     4. Assessment attempt (implicit -> IN_PROGRESS -> COMPLETED/NO_SHOW/FAILED)
     5. Interview session (implicit -> IN_PROGRESS -> COMPLETED)
     6. Notification event (PENDING -> SENT/FAILED or retry loop)
     7. HR decision (implicit -> ACCEPT/REJECT)
  └─ Terminal states (immutable endpoints)
  └─ Transition validation & side effects
  └─ Use: Implement state validation in services; test all valid transitions

03_EXCEL_EXPORT_SCORING_RULES.md
  └─ 17 fixed Excel columns (candidate name, email, job, assessment score, etc.)
  └─ Excel formatting guidelines (frozen headers, conditional formatting, filters)
  └─ Assessment scoring (positive scoring only: correct/total * 100)
  └─ Interview scoring (AI-generated percentage + recommendation)
  └─ Scoring validation & edge cases
  └─ Data retention policy (180-day auto-delete for recordings)
  └─ Use: Implement Excel export endpoint; define scoring service

04_REST_API_ENDPOINTS.md
  └─ 50+ endpoints across 15 resource groups:
     1. Auth (register, login, profile)
     2. Organization onboarding (admin)
     3. Organization management (users, jobs)
     4. Interview creation & management
     5. Interview slots & questions (assessments + fallback)
     6. Application form (public)
     7. Assessment session (candidate)
     8. Interview session (candidate)
     9. HR dashboard & evaluation
     10. Excel export
     11. Proctoring monitoring
     12. Notification logs
     13. Audit logs
  └─ Each endpoint specifies: method, path, auth level, request body, response, side effects
  └─ Error codes & validation rules
  └─ Use: Build API layer directly from spec; use for API testing

05_ARCHITECTURE_ROADMAP.md
  └─ System architecture (5 layers)
  └─ Technology stack recommendations (Python/Node backend, React/Vue frontend)
  └─ Security & compliance checklist (encryption, auth, GDPR, audit)
  └─ 6-phase implementation roadmap (12 weeks, ~5 person team)
     Phase 1: Auth & org onboarding (Weeks 1-2)
     Phase 2: Interview setup (Weeks 3-4)
     Phase 3: Candidate onboarding & application (Weeks 5-6)
     Phase 4: Interview session & recording (Weeks 7-8)
     Phase 5: AI reports & HR evaluation (Weeks 9-10)
     Phase 6: Hardening & production readiness (Weeks 11-12)
  └─ Risk mitigation, future enhancements, deployment checklist
  └─ Infrastructure costs (~$3400-7500/month on AWS)
  └─ Use: Plan engineering sprints; resource allocation; go-live checklist

THIS FILE (Executive Summary)
  └─ Quick reference of key decisions
  └─ Terminology & conventions
  └─ Implementation priorities
  └─ Known gaps & open questions
  └─ Use: Onboard new team members; verify scope alignment

-- ============================================================================
-- KEY DECISIONS & REQUIREMENTS (LOCKED)
-- ============================================================================

TIMING:
  ✓ Assessment: 20 minutes (MCQ, timed, no negative marking)
  ✓ Interview: 40 minutes (open-ended, timed, AI-generated + fallback)
  ✓ Login window: 2 hours before slot start (single-use session token)
  ✓ Application cutoff: 24 hours before assessment start
  ✓ Edit lock: 24 hours before assessment start (all fields frozen)
  ✓ Reminder mail: Only T-24h (not T-3h)
  ✓ Recording retention: 180 days then auto-delete
  ✓ Slot assignment: Automatic batch job 25 hours before assessment

CANDIDATE FLOW:
  1. Apply for job (via public form, up to 3 slot preferences)
  2. Receive confirmation mail immediately
  3. Receive slot assignment mail (2 hours before assigned slot)
  4. Receive reminder mail (24 hours before)
  5. Access assessment via login link (slot_start - 2h to slot_start)
  6. Take assessment (20 min, randomized questions)
  7. Take interview immediately after (40 min, dynamic + fallback questions)
  8. Submit interview; receive decision mail later (after HR closes interview)

HR FLOW:
  1. Create job position
  2. Create interview (3-step wizard: job info + assessment config + interview setup)
  3. Publish interview (application form goes live)
  4. Monitor applications & slot assignment
  5. At interview close: review all candidates (assessment score + interview transcript + AI report + proctoring flags)
  6. Accept/reject candidates (individual or bulk)
  7. Close interview (triggers final decision emails to all candidates)
  8. Export candidates to Excel

ADMIN FLOW:
  1. Receive organization request
  2. Review details
  3. Approve (sends credentials) or reject (sends reason)

TENANCY:
  ✓ Multi-tenant: One organization can have multiple HR users
  ✓ Data isolation: All org data siloed in queries (organization_id filter everywhere)
  ✓ No subdomain strategy in MVP (all use main platform URL)

AUTHENTICATION:
  ✓ Admin + Org Admin + HR: Email/password + JWT token
  ✓ Candidates: System-generated username/temporary password + session token (single-use per assessment/interview)
  ✓ No external auth (Google/Microsoft) in MVP

SECURITY BASELINE:
  ✓ Consent + audit logs + encrypted storage + 180-day retention policy
  ✓ Proctoring: Informational only (not auto-fail, but HR can view & override decision)
  ✓ Webcam strict proctoring: Guidelines + consent + fullscreen warning + tab-switch logs + live face detection

RETRY POLICY:
  ✓ No retry if candidate misses assessment or abandons it
  ✓ Hard fail; no reschedule option in MVP

HIRING WORKFLOW:
  ✓ Single-stage (HR makes final decision; no Hiring Manager approval layer)
  ✓ Bulk decision support (HR can accept/reject multiple at once)

INTERVIEW FALLBACK:
  ✓ If AI stops generating questions before 40 min, switch to predefined fallback bank
  ✓ Continue fallback questions until end of timer or candidate ends interview

RESUME FORMAT:
  ✓ PDF only, max 2MB

CANDIDATES EXCEL EXPORT:
  ✓ 17 fixed columns (see 03_EXCEL_EXPORT_SCORING_RULES.md)
  ✓ Format: .xlsx, frozen header row, auto-fit columns, filters enabled

-- ============================================================================
-- TECHNOLOGY STACK SUMMARY
-- ============================================================================

RECOMMEND:
  Backend: FastAPI (Python) or Express (Node.js) [high productivity, good test support]
  Frontend: React 18+ with TypeScript [strong typing, component reusability]
  Database: PostgreSQL 14+ [ACID, JSON support, full-text search]
  Cache: Redis [fast session / token lookup]
  Message Queue: Celery + Redis (Python) or Bull (Node)
  Email: SendGrid or AWS SES
  Object Storage: AWS S3 [versioning, retention policies, signing]
  AI Service: Ollama (self-hosted) or Anthropic Claude [proven for Q generation]
  Video Processing: FFmpeg [open-source, cost-effective]
  Containerization: Docker + Kubernetes
  Monitoring: Datadog or New Relic
  CI/CD: GitHub Actions or GitLab CI
  Hosting: AWS ECS/EKS, GCP Cloud Run, or Azure Container Instances

-- ============================================================================
-- CRITICAL IMPLEMENTATION CHECKLIST
-- ============================================================================

MUST HAVE (MVP):
  [ ] PostgreSQL schema deployed with all constraints
  [ ] Auth service (login, JWT, RBAC)
  [ ] Org request + admin approval workflow
  [ ] Interview creation wizard (publish -> slots -> assessment qs -> fallback q)
  [ ] Candidate application form (public, slot preference selection)
  [ ] Slot assignment batch job (runs 25 hours before assessment)
  [ ] Assessment session (randomized questions, scoring, recording)
  [ ] Interview session (AI question generation + fallback, recording, transcript)
  [ ] HR dashboard (view assessment + interview + AI report)
  [ ] HR decision workflow (individual + bulk accept/reject)
  [ ] Excel export (17 columns, formatted .xlsx)
  [ ] Email notifications (11 types, scheduled + triggered)
  [ ] Proctoring flags (logged, informational for HR)
  [ ] Audit logging (sensitive actions)
  [ ] Consent management (recording + data processing)

SHOULD HAVE (MVP if budget allows):
  [ ] Face detection (webcam proctoring)
  [ ] AI report generation (automatic summarization)
  [ ] Admin dashboard (org metrics, email delivery logs)
  [ ] Candidate portal (view application status, download offer letter later)
  [ ] Email template customization (per org)

NICE TO HAVE (POST-MVP):
  [ ] Video playback speed / scrubbing
  [ ] Interview transcription (not just Q&A storage)
  [ ] Candidate feedback survey
  [ ] Analytics dashboard (passing rate, time avg, recommendation accuracy)
  [ ] Multi-language support (i18n)
  [ ] Calendar integration (candidate scheduling)

-- ============================================================================
-- KNOWN GAPS & OPEN QUESTIONS (FOR FUTURE CLARIFICATION)
-- ============================================================================

1. AI QUESTION GENERATION
   - Question: Which AI service/model preferred? (GPT, Claude, custom?)
   - Question: What's acceptable quality threshold for generated questions?
   - Question: Should HR be able to edit AI-generated questions before publish?
  - Current decision: Ollama recommended; HR can edit in DRAFT phase only

2. RECORDING STORAGE
   - Question: Compress recordings to save cost?
   - Question: Acceptable bandwidth/quality tradeoff?
   - Question: CDN for playback or direct S3?
   - Current decision: Use sensible bitrate defaults; compress post-capture

3. FACE DETECTION SERVICE
   - Question: Use browser-based API (face_api.js) or backend service?
   - Question: Acceptable false-positive rate?
   - Question: Should face-absent continuously trigger or only periodic check?
   - Current decision: Optional; defer if engineering complexity high; log flags only

4. EMAIL PROVIDER SELECTION
   - Question: Transactional email volume expected (per month)?
   - Question: SLA requirements (delivery time < 5s)?
   - Question: Inbound webhook support needed for delivery status?
   - Current decision: SendGrid or AWS SES; implement retry queue for reliability

5. SCALING CONSIDERATIONS
   - Question: Expected concurrent candidates during peak assessment time?
   - Question: When to introduce Redis caching / database read replicas?
   - Question: When to implement API rate limiting per org?
   - Current decision: Design for 1000 concurrent sessions; optimize post-launch

6. COMPLIANCE & LEGAL
   - Question: Which jurisdictions must comply with (GDPR, CCPA, local)?
   - Question: Need legal review of consent templates?
   - Question: Data residency requirements (EU, US)?
   - Current decision: GDPR baseline (encryption, consent, right-to-delete); expand per customer

7. CANDIDATE COMMUNICATION
   - Question: Should Slack/SMS notifications supplement email?
   - Question: Multi-language support for emails?
   - Question: Whitelabel email domain per org?
   - Current decision: Email only MVP; SMS/Slack post-launch; whitelabel later

-- ============================================================================
-- TESTING STRATEGY
-- ============================================================================

UNIT TESTS (Target: 80%+ coverage):
  - Auth service (password hashing, token generation/validation)
  - Interview state machine (all valid transitions + invalid ones)
  - Assessment scoring logic
  - Notification event creation & scheduling
  - Email payload generation
  - Slot assignment algorithm

INTEGRATION TESTS:
  - Full org onboarding flow (request -> approval -> email -> login)
  - Full interview creation flow (create -> publish -> slots -> questions -> publish)
  - Full candidate flow (apply -> assigned -> assessment -> interview -> decision)
  - Email queue (create -> schedule -> send -> retry)
  - Database constraints (enforcing timing immutability, duplicate prevention)
  - File uploads (resume validation, virus scan, storage)

END-TO-END TESTS:
  - Candidate applies, takes assessment, takes interview, HR decides, email received
  - Time-based triggers (slot assignment at T-25h, reminders at T-24h, interview close at T+duration)
  - Error scenarios (network loss during interview, AI generation timeout, recording storage failure)

LOAD TESTS:
  - 1000 candidates logging in simultaneously
  - 500 interviews being created/published in parallel
  - Email queue processing 5000 events/hour
  - Database query performance (< 200ms p95)
  - Recording upload concurrency

SECURITY TESTS:
  - SQL injection (all inputs parameterized)
  - Cross-site scripting (output encoding)
  - CSRF token validation
  - JWT token expiration / refresh
  - Role-based access control (HR cannot see other org data)
  - Sensitive data not in logs / error messages

-- ============================================================================
-- DEPLOYMENT PIPELINE
-- ============================================================================

Local Dev:
  docker-compose up (DB + Redis + API + workers)
  npm run dev (frontend)
  http://localhost:3000

Staging:
  Deploy to staging branch
  Run full test suite + end-to-end tests
  Load test (100 concurrent)
  Security scan
  UAT by product team

Production:
  Deploy to main branch
  Zero-downtime deployment (blue-green or canary)
  Health checks
  Rollback plan ready
  Post-deployment validation

Monitoring:
  Application logs (ELK / Datadog)
  Performance metrics (APM)
  Email delivery logs (SendGrid webhook)
  Error rate alerts (> 1% = page)
  Uptime monitoring (99.5% SLA)

-- ============================================================================
-- SUCCESS CRITERIA (MVP DEFINITION COMPLETE)
-- ============================================================================

A. FUNCTIONAL COMPLETENESS:
   [ ] All 5 workflows end-to-end working (org onboarding, interview creation, assessment, interview, HR decision)
   [ ] All 11 email types sent at correct times with correct content
   [ ] All state machines validated; no invalid transitions possible
   [ ] Excel export contains all 17 columns with correct data
   [ ] Audit log captures all sensitive actions
   [ ] Proctoring flags captured and visible to HR

B. PERFORMANCE:
   [ ] API response time < 500ms (p95)
   [ ] Page load time < 2s (frontend)
   [ ] Email send latency < 5 seconds
   [ ] Assessment submission under 5s
   [ ] Concurrent session support: 1000 assessments simultaneously

C. RELIABILITY:
   [ ] 99.5% uptime
   [ ] Automatic retry for email (5 attempts)
   [ ] Fallback to predefined questions when AI fails
   [ ] Database backups automated (daily, geo-redundant)
   [ ] Graceful degradation (system continues even if recording fails)

D. SECURITY:
   [ ] No production data in logs
   [ ] All sensitive data encrypted
   [ ] JWT tokens expire correctly
   [ ] RBAC enforced; org isolation verified
   [ ] GDPR compliance: data deletion working
   [ ] Consent logged with timestamp & version

E. USABILITY:
   [ ] Admin onboarding takes < 10 minutes
   [ ] HR interview creation wizard < 15 minutes
   [ ] Candidate application < 5 minutes
   [ ] HR decision review < 2 minutes per candidate
   [ ] Error messages clear & actionable

-- ============================================================================
-- HANDOFF CRITERIA (When Ready to Code)
-- ============================================================================

ALL OF THE FOLLOWING TRUE:
  [ ] All 5 requirement documents reviewed and approved by stakeholders
  [ ] Technology stack decided & team agreed
  [ ] Development environment (Docker, DB, IDE) set up
  [ ] GitHub/GitLab repo created with CI/CD configured
  [ ] Database schema (00_DATABASE_SCHEMA.sql) ready to deploy
  [ ] API endpoint list (04_REST_API_ENDPOINTS.md) finalized
  [ ] Acceptance criteria written for each user story
  [ ] Designer completed wireframes (admin, HR, candidate portals)
  [ ] Email templates drafted (11 types)
  [ ] Staging environment provisioned
  [ ] Monitoring & alerting infrastructure ready
  [ ] Legal review of consent language complete
  [ ] Budget & resources allocated

-- ============================================================================
-- DOCUMENT MAINTENANCE
-- ============================================================================

REVIEW FREQUENCY:
  - Database schema: Only on major version change (copy to migrations/)
  - Event matrix: When adding new email type or workflow
  - State machines: When adding new state or transition
  - API endpoints: When adding new endpoint or changing signature
  - Architecture: Quarterly tech stack review
  - Roadmap: Sprint planning (update burn-down)

VERSION CONTROL:
  All docs in Git alongside code
  Change log: Document major requirement changes
  Approval: Product lead signs off on changes

-- ============================================================================
-- FINAL NOTES
-- ============================================================================

This schema-ready package is designed to be a complete blueprint for a 12-week MVP build.
It covers:
  - Database design (normalized, indexed, constrained)
  - Event flow (all triggers, timing, side effects)
  - State management (immutable states, valid transitions)
  - API specification (50+ endpoints, all request/response bodies)
  - Email workflows (11 types, templates, scheduling, retry)
  - Scoring logic (positive scoring, AI reports)
  - Architecture (scalable, secure, maintainable)
  - Implementation plan (6 phases, milestones, team composition)

NEXT STEPS:
  1. Share all 5 documents with engineering team + product
  2. Convert database schema to migration files (using Alembic / Sequelize / etc.)
  3. Create GitHub issues from API endpoints (one issue per endpoint)
  4. Finalize email templates (use Handlebars / Jinja2 templating)
  5. Start Phase 1: Auth + Org Onboarding
  6. Daily standup on progress against roadmap

Good luck with implementation!

-- ============================================================================
-- END OF QUICK REFERENCE
-- ============================================================================
