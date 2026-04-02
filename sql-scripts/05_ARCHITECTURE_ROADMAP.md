-- ============================================================================
-- VIRTUAL INTERVIEW PLATFORM - ARCHITECTURE & IMPLEMENTATION ROADMAP
-- ============================================================================

-- ============================================================================
-- 1. SYSTEM ARCHITECTURE OVERVIEW
-- ============================================================================

[ARCHITECTURAL LAYERS]

1. PRESENTATION LAYER (Frontend)
   - React/Vue.js SPA for responsive UI
   - Three role-based dashboards:
     * Admin Dashboard (onboarding, org management)
     * HR Dashboard (interview creation, candidate evaluation)
     * Candidate Portal (application, assessment, interview)
   - Real-time timer, webcam testing, device checks
   - Fullscreen enforcement, tab-switch warnings
   - Session management via secure token storage

2. API GATEWAY LAYER
   - REST API server (Node.js/Express or Python/FastAPI)
   - JWT-based authentication with role-based authorization (RBAC)
   - Request validation, rate limiting, CORS configuration
   - Logging & request tracing

3. APPLICATION LOGIC LAYER
   - Interview orchestration service
   - Assessment management service
   - Candidate session management service
   - Notification service (email queue)
   - Recording management service
   - AI integration service (for question/report generation)
   - HR evaluation & decision service

4. DATA LAYER
   - PostgreSQL (transactional DB)
     * All entities: organizations, interviews, applications, attempts, sessions
     * Relationships, constraints, audit logs
   - Object Storage (S3 or similar)
     * Resume files (encrypted, signed URLs for download)
     * Interview recordings (encrypted, retention policy)
   - Cache Layer (Redis, optional for MVP)
     * Session tokens, active interview state

5. EXTERNAL SERVICES
   - Email Service (SendGrid, AWS SES)
     * Transactional notifications with retry logic
   - AI Service (GPT API, custom service, or on-premise LLM)
     * Assessment question generation
     * Interview question generation
     * Report generation (strengths, weaknesses, recommendation)
   - Video Recording & Proctoring (Browser APIs + backend processing)
     * Webcam/mic capture via WebRTC
     * Tab-switch detection (JS-side)
     * Face detection (AI or third-party service)

[DEPLOYMENT ARCHITECTURE]

Client (Browser) -> CDN (static assets)
                \-> API Gateway (HTTPS)
                      |
                      +-> Auth Service (JWT validation)
                      |
                      +-> Application Servers (load-balanced, 3 instances min)
                      |
                      +-> Message Queue (for async jobs)
                      |
                      +-> Background Workers (3-5 workers for email, AI, record cleanup)
                      |
                      Database (PostgreSQL, multi-AZ)
                      |
                      Object Storage (S3 multi-region)
                      |
                      Cache (Redis for session/active state)
                      |
                      External APIs (Email, AI, video encoding)

-- ============================================================================
-- 2. TECHNOLOGY STACK RECOMMENDATIONS
-- ============================================================================

BACKEND:
  Language: Python 3.10+ OR Node.js 18+ OR Go 1.20+
  Framework: FastAPI (Python) OR Express (Node) OR Gin (Go)
  Database: PostgreSQL 14+ (primary)
  Cache: Redis 6.0+ (optional for MVP)
  Task Queue: Celery + Redis (Python) OR Bull (Node) OR similar
  ORM: SQLAlchemy (Python) OR TypeORM (Node)
  API Docs: FastAPI auto (Python) OR Swagger/OpenAPI (all)

FRONTEND:
  Language: TypeScript preferred (strong typing)
  Framework: React 18+ OR Vue 3+
  State Management: Redux Toolkit (React) OR Pinia (Vue)
  UI Library: Material-UI OR Ant Design OR TailwindCSS
  HTTP Client: Axios OR Fetch API with wrapper
  Web APIs: WebRTC (video/audio), getUserMedia (camera/mic)

EXTERNAL INTEGRATIONS:
  Email: SendGrid API (transactional) OR AWS SES
  File Storage: AWS S3 OR Google Cloud Storage
  Video Processing: FFmpeg (open-source) OR AWS MediaConvert
  AI Models: Ollama (self-hosted, local/private) OR Anthropic Claude OR Hugging Face
  Monitoring: DataDog OR New Relic OR Prometheus + Grafana
  Logging: ELK Stack (Elasticsearch/Logstash/Kibana) OR Datadog

TESTING:
  Unit Tests: PyTest (Python) OR Jest (Node)
  Integration Tests: Testcontainers + PostgreSQL
  Load Testing: Apache JMeter OR K6
  API Testing: Postman OR Insomnia OR Hoppscotch

DEPLOYMENT:
  Containerization: Docker + Docker Compose (dev), Kubernetes (prod)
  CI/CD: GitHub Actions OR Jenkins OR GitLab CI
  Hosting: AWS ECS/EKS OR Google Cloud Run OR Azure Container Instances
  IaC: Terraform OR CloudFormation

-- ============================================================================
-- 3. DATA SECURITY & COMPLIANCE CHECKLIST
-- ============================================================================

ENCRYPTION:
  - ✓ TLS 1.2+ for all data in transit
  - ✓ AES-256 for data at rest (DB, S3)
  - ✓ Password hashing: bcrypt or Argon2 (not MD5/SHA1)
  - ✓ PII fields encrypted in database (resume, email, phone)

AUTHENTICATION & AUTHORIZATION:
  - ✓ JWT-based stateless auth (no server-side sessions needed, scalable)
  - ✓ Refresh tokens with rotation
  - ✓ Role-based access control (RBAC): ADMIN, ORG_ADMIN, HR, (no CANDIDATE role for security)
  - ✓ Multi-factor auth (MFA) for admin/org_admin (future phase)

DATA PROTECTION:
  - ✓ Audit logs for all sensitive actions (who, what, when, from where)
  - ✓ Recording retention policy: auto-delete after 180 days
  - ✓ Data minimization: only collect PII needed (name, email, phone, resume)
  - ✓ Consent management: explicit recording & processing consents
  - ✓ GDPR right-to-be-forgotten (delete candidate data & recordings on request)

NETWORK SECURITY:
  - ✓ CORS configuration (restrict domains)
  - ✓ CSRF token for state-changing requests
  - ✓ Rate limiting per IP/user
  - ✓ API key rotation for internal services
  - ✓ Private database (no public internet access)
  - ✓ WAF (Web Application Firewall) on API gateway

SESSION SECURITY:
  - ✓ Candidate assessment/interview tokens: single-use, expiring within 2 hours
  - ✓ Session invalidation on logout or timeout
  - ✓ Secure cookies: HttpOnly, Secure, SameSite flags

CODE SECURITY:
  - ✓ Dependency scanning (OWASP Top 10)
  - ✓ Code review process (peer reviews)
  - ✓ SAST (Static Application Security Testing)
  - ✓ Secrets management (no hardcoded keys, use env vars/vaults)

INCIDENT RESPONSE:
  - ✓ Logging & monitoring for security events
  - ✓ Alerting for unauthorized access attempts, data exfiltration
  - ✓ Incident response plan & contact escalation

-- ============================================================================
-- 4. IMPLEMENTATION ROADMAP (PHASES)
-- ============================================================================

[PHASE 1: FOUNDATION & AUTH (Weeks 1-2)]
  MVP Scope: Admin + Org Onboarding

  Tasks:
    1. Setup development environment (Docker, DB, Redis)
    2. Implement database schema (DDL from 00_DATABASE_SCHEMA.sql)
    3. Build authentication & authorization layer
       - Admin self-registration
       - Org request submission + admin review/approve/reject
       - JWT token generation & validation
       - RBAC middleware for endpoints
    4. Create basic UI layouts (login, dashboard shells)
    5. Implement role-based dashboards (admin, org_admin, hr)
    6. Setup logging, audit logs, error handling

  Deliverables:
    - Deployed test instance with admin + 2 test orgs
    - API endpoints: /auth/*, /admin/*, /organizations/*
    - Org onboarding email workflow (SMTP/SendGrid configured)
    - 80%+ unit test coverage for auth layer

  Success Criteria:
    - Admin can onboard organization
    - Org receives acceptance/rejection email
    - Org admin can login and access dashboard

[PHASE 2: INTERVIEW SETUP (Weeks 3-4)]
  Focus: HR Interview Creation Wizard

  Tasks:
    1. Implement interview creation endpoints
       - Job creation
       - Interview template (timings, duration)
       - Interview slots (UTC batches)
    2. Build assessment question management
       - Add/edit/delete questions
       - Multiple choice options
       - Option validation (exactly 1 correct)
       - AI-generated question option (mock/stub for now)
    3. Build interview fallback questions
    4. Implement interview state machine (DRAFT -> PUBLISHED -> LOCKED)
    5. Create HR dashboard for interview management
    6. Generate public application form URL

  Deliverables:
    - HR can create end-to-end interview with assessment + fallback questions
    - Published interview generates candidate application form link
    - Slot assignment batch job (mock for now, real logic in Phase 3)
    - 70%+ unit test coverage for interview logic

  Success Criteria:
    - HR can publish interview
    - Application form URL is live and publicly accessible
    - Cannot edit interview after publish (DB constraint enforced)

[PHASE 3: CANDIDATE ONBOARDING (Weeks 5-6)]
  Focus: Candidate Application & Assessment Session

  Tasks:
    1. Build candidate application form (public, no auth)
       - Form fields: name, email, phone, resume upload (PDF validation)
       - Slot preference selection (max 3)
       - Form submission & data storage
    2. Implement slot assignment batch job
       - Runs at (assessment_start - 25 hours)
       - Matches candidates to slots based on preferences
       - Sends SLOT_ASSIGNED & ASSESSMENT_REMINDER_24H emails
       - Email scheduling logic
    3. Build assessment login & session management
       - Login window: (slot_start - 2h) to (slot_start)
       - Session token validation
       - Prevent re-access after assessment completed
    4. Implement assessment attempt workflow
       - Load randomized questions
       - Recording start (mock video capture for MVP)
       - Scoring logic (positive scoring only)
       - Session timeout handling
    5. Build assessment UI (timed, fullscreen warning, option selection)

  Deliverables:
    - Candidate can apply (up to 3 slot preferences)
    - Candidates receive automated emails (apply confirmation, slot assignment, 24h reminder)
    - Candidate can login and start assessment
    - Assessment scored & recorded
    - 65%+ unit test coverage
    - Background job queue operational (email notifications, slot assignment)

  Success Criteria:
    - Full candidate application flow works end-to-end
    - Assessment submission calculates score correctly
    - Candidate cannot re-enter assessment
    - All email triggers fire at correct times

[PHASE 4: INTERVIEW SESSION & RECORDING (Weeks 7-8)]
  Focus: Interview AI Integration + Recording

  Tasks:
    1. Implement interview session management
       - Session token validation & window (slot_start to 80 min after)
       - Consent screen (video, audio, data processing)
       - Webcam/microphone testing
    2. Build AI question generation integration
       - Call AI service for next question (async/streaming)
       - Fallback to predefined questions on AI timeout
       - Store Q&A transcript
       - Implement answer submission & next question flow
    3. Implement recording service
       - Capture video/audio via WebRTC
       - Save to object storage (S3)
       - Encrypt files
       - Track retention deadline (180 days)
    4. Build proctoring flag capture (client-side logging)
       - Tab-switch detection
       - Full-screen monitoring
       - (Face detection: optional, defer if complex)
    5. Implement interview UI (timed, live video, Q&A display, end button)
    6. Test AI service failover to fallback questions

  Deliverables:
    - End-to-end interview session (start -> consent -> Q&A -> exit)
    - Recording captured and stored
    - Proctoring flags logged
    - Interview transcript saved
    - Fallback questions working when AI fails
    - 60%+ unit test coverage

  Success Criteria:
    - Candidate can complete interview within 40-minute window
    - Recording file created and encrypted
    - All Q&A pairs logged
    - AI question generation working (or gracefully falling back)

[PHASE 5: AI REPORTS & HR EVALUATION (Weeks 9-10)]
  Focus: AI Report Generation + HR Decision Workflow

  Tasks:
    1. Implement AI report generation service
       - Assessment report: score, correct/incorrect breakdown
       - Interview report: transcript summary, strengths, weaknesses, hire_recommendation
       - Async job (triggered after interview completion)
       - Fallback heuristic if AI service down
    2. Build HR candidate detail view
       - Display assessment score, questions, correct answers
       - Display interview transcript (read-only)
       - Display proctoring flags (informational)
       - Display interview recording (video player)
       - Display AI report (strengths, weaknesses, recommendation)
       - Resume preview (PDF)
    3. Implement HR decision workflow
       - Individual candidate accept/reject
       - Bulk candidate decision (checkbox + decision button)
       - Decision notes (optional)
       - Store hr_decisions in DB
    4. Implement Excel export
       - Fixed columns (see 03_EXCEL_EXPORT_SCORING_RULES.md)
       - Format: .xlsx with styling
       - Audit log download events
    5. Implement interview close workflow
       - Mark interview as CLOSED
       - Trigger final decision emails (CANDIDATE_DECISION_ACCEPTED/REJECTED)

  Deliverables:
    - HR can view complete candidate packet (assessment, interview, AI report, recording)
    - HR can make individual or bulk decisions
    - Excel export working with all required columns
    - Final decision emails sent to all candidates
    - 60%+ unit test coverage

  Success Criteria:
    - HR can review candidate and make decision
    - Excel export contains all required data
    - Candidates receive final decision emails
    - Audit logs show all decision actions

[PHASE 6: HARDENING & PRODUCTION READINESS (Weeks 11-12)]
  Focus: Security, Performance, Monitoring, Documentation

  Tasks:
    1. Security hardening
       - Penetration testing
       - Code security review
       - Dependency vulnerability scanning
       - SSL/TLS certificate setup
       - CORS, CSRF, rate limiting configuration
       - Secrets management (env vars, vault)
    2. Performance optimization
       - Database query optimization
       - API response time targets (< 500ms p95)
       - Load testing (1000 concurrent sessions)
       - CDN setup for static assets
       - Caching strategy (Redis)
    3. Monitoring & alerting
       - Application performance monitoring (APM)
       - Error rate tracking
       - Email delivery logging & retry alerts
       - Recording file size monitored (cost control)
       - Uptime monitoring
    4. Automated retention policy
       - Recording auto-delete after 180 days
       - Verification of deletion in logs
    5. Comprehensive testing
       - End-to-end test scenarios (full happy path)
       - Failure scenarios (network loss, AI down, etc.)
       - Data migration scripts (future upgrades)
    6. Documentation
       - API documentation (Swagger)
       - Deployment runbook
       - Operational procedures (troubleshooting, scaling)
       - Security practices guide
       - User guides (admin, HR, candidate)

  Deliverables:
    - Production-ready deployment (on AWS / GCP / Azure)
    - All security controls implemented
    - Monitoring & alerting configured
    - Load test results: 1000 concurrent + acceptable latency
    - Documentation complete
    - Beta user testing with 2-3 customer orgs

  Success Criteria:
    - System passes security audit
    - Sustainable uptime 99.5%+
    - Support team can operate platform independently

-- ============================================================================
-- 5. CRITICAL PATH & DEPENDENCIES
-- ============================================================================

Phase 1 (Auth) must complete before Phase 2 (cannot publish interview without auth)
Phase 2 (Interview Setup) must complete before Phase 3 (cannot apply without interview)
Phase 3 (Application) must complete before Phase 4 (cannot interview without assessment)
Phase 4 (Interview) must complete before Phase 5 (need interview data for reports)
Phase 5 (Reports) must complete before Phase 6 (need to validate all data in prod)

External Dependencies:
  - Email service account (SendGrid/SES) needed by end of Phase 3
  - Object storage (S3) needed by Phase 4
  - AI service API key needed by Phase 4
  - Video processing pipeline needed by Phase 5

-- ============================================================================
-- 6. TEAM COMPOSITION (ESTIMATED)
-- ============================================================================

RECOMMENDED TEAM:
  - 1 Engineering Manager
  - 2 Backend Engineers (one lead on auth/DB, one on services)
  - 1 Frontend Engineer
  - 1 DevOps/Infrastructure Engineer
  - 1 QA Engineer
  - 0.5 Product Manager / Business Analyst

ESTIMATED EFFORT: 12 weeks full-time (can be accelerated with more people, but coordination overhead increases)

-- ============================================================================
-- 7. RISK MITIGATION
-- ============================================================================

RISK: AI question generation fails repeatedly
  Mitigation: Implement robust fallback to predefined question bank; rate-limit AI calls; cache generated questions

RISK: Recording files are large; storage cost spirals
  Mitigation: Set default quality/bitrate limits; compress recordings; enforce 180-day retention strictly

RISK: Email delivery delays; candidates don't receive notifications
  Mitigation: Reliable email provider (SendGrid has 99%+ uptime); queue with retries; dashboard notification fallback

RISK: Network loss during assessment/interview; candidate gets stuck
  Mitigation: Session resume functionality; grace period for reconnect; clear error messages to candidate

RISK: Scaling issues; candidate session tokens collide or timeout unpredictably
  Mitigation: Use UUID for tokens; Redis for fast session lookup; load test before go-live

RISK: HR forgets to close interview; candidates don't get final decision emails
  Mitigation: Auto-close interview at end_utc; email scheduler retry if not yet sent

-- ============================================================================
-- 8. FUTURE ENHANCEMENTS (POST-MVP)
-- ============================================================================

Phase 7 (Advanced Features):
  - Multi-language support (i18n)
  - AI-powered resume screening (auto-rejection for unqualified candidates)
  - Video interview analysis (emotion/engagement detection)
  - Predictive hiring score (ensemble of assessment + interview + resume)
  - Candidate feedback survey (post-interview)
  - Interview scheduling automation (timezone-aware calendar)
  - Bulk email campaigns (job postings to candidate pool)
  - Integration with ATS (Workable, Lever, SmartRecruiters)
  - Two-stage approval workflow (HR + Hiring Manager decision)
  - Team-based interviews (multiple interviewers per candidate)
  - Scheduled interview rounds (allow days between assessment and interview)

-- ============================================================================
-- 9. DEPLOYMENT CHECKLIST
-- ============================================================================

Pre-Launch (1 week before):
  [ ] Database backup strategy tested
  [ ] DNS records configured (A record, SSL cert)
  [ ] Email service rate limits configured (burst capacity)
  [ ] S3 buckets created with encryption + retention policies
  [ ] Monitoring & alerting rules deployed & tested
  [ ] Incident response pagerduty/slack configured
  [ ] Load balancer health checks working
  [ ] CDN cache invalidation scripts ready
  [ ] Admin escalation contact list in place
  [ ] Runbook for all common operational tasks
  [ ] Rollback procedure tested
  [ ] Beta test cycle complete (no P1 bugs)

Launch Day (Go-Live):
  [ ] All services started in correct order (DB, cache, queue, API, workers)
  [ ] Smoke tests run successfully
  [ ] Admin can complete onboarding flow
  [ ] HR can publish interview
  [ ] Candidate can apply and submit assessment
  [ ] All email triggers working (check spam folder)
  [ ] Recording files being stored
  [ ] Monitoring dashboard live and healthy
  [ ] Status page updated
  [ ] Support team on standby
  [ ] Post-launch call scheduled (15 min after launch)

-- ============================================================================
-- 10. INFRASTRUCTURE & COSTS (ESTIMATED)
-- ============================================================================

AWS OR GCP:
  - Compute (3 API servers, 3 workers, DB, Redis): ~$2000-3000/month
  - Data transfer & storage (recordings, resumes): ~$500-1500/month (depends on usage)
  - Email service (SendGrid/SES): $0-200/month
  - AI service (Ollama self-hosted or external API): varies by model and infrastructure
  - Monitoring & logging: $300-500/month
  - CDN: $100-300/month
  - TOTAL: ~$3400-7500/month (scales with user base)

-- ============================================================================
-- END OF ARCHITECTURE & ROADMAP
-- ============================================================================
