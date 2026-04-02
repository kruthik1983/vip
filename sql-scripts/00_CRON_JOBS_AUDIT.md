# Supabase Cron Jobs Audit & Enhancement Report

**Date:** March 25, 2026  
**Status:** REQUIRES CRITICAL FIXES + NEW JOBS

---

## 🚨 CRITICAL ISSUES FOUND

### 1. **job_transition_interview_statuses() - Incomplete**
**Status:** ❌ NOT PRODUCTION READY
**Lines:** 213-220, 210-220
**Problem:** Core interview lifecycle transitions are missing
- IN_PROGRESS transition query is blank
- CLOSED transition query is blank
- Blocks interview status progression

**Impact:** Interviews will never auto-transition from PUBLISHED → LOCKED → IN_PROGRESS → CLOSED

---

### 2. **job_assign_interview_slots_after_deadline() - Incomplete Matching**
**Status:** ❌ NOT PRODUCTION READY
**Lines:** 350+, 445+
**Problem:** Assessment and interview matching algorithms are incomplete
- Preference round loops have no body
- Missing join logic with `application_preferences` table
- Missing capacity calculation
- Missing update statements

**Impact:** Slot assignment will fail silently or assign incorrectly

---

### 3. **job_generate_assessment_credentials() - Incomplete**
**Status:** ⚠️ PARTIALLY BROKEN
**Lines:** 663-725
**Problem:** Interview session creation logic is completely missing
- No interview_sessions INSERT statement
- Unclear if both assessments AND interview credentials are generated
- Missing idempotency checks

**Impact:** Interview credentials may not be generated after assessment submission

---

### 4. **Excessive Cron Schedule - Performance Risk**
**Status:** ❌ DANGEROUS
**Current:** `* * * * *` (every minute)  
**Job:** `vip_expand_slot_capacity_threshold`
**Problem:** Running every minute will:
- Cause database contention
- Create unnecessary locks
- Waste compute resources

**Fix:** Change to `0 * * * *` (once per hour)

---

### 5. **Missing Assessment Validity Buffer**
**Status:** ❌ UX PROBLEM
**Location:** `job_generate_assessment_credentials()` line 665-727
**Problem:** 
```sql
session_valid_from = now()
session_valid_until = v_assessment_slot.slot_start_utc
```
Candidates get credentials only when assessment starts. Should allow 7-14 day window for completion.

---

### 6. **Missing Interview Validity Dates**
**Status:** ❌ INCOMPLETE
**Problem:** Interview session creation doesn't specify validity window
- Should allow access from some time before interview slot
- Should expire after interview slot ends

---

### 7. **No Transaction Isolation on Batch Operations**
**Status:** ⚠️ RACE CONDITION RISK
**Jobs Affected:** `assign_interview_slots`, `generate_credentials`, `expand_capacity`
**Problem:** 
- Large batches could lock simultaneously
- Concurrent runs might duplicate assignments
- No `SERIALIZABLE` or explicit locking

---

### 8. **Notification Retry Backoff is Sub-optimal**
**Status:** ⚠️ NOT IDEAL
**Current:** Linear backoff `5 * v_attempt` mins
- Attempt 1: 5 mins
- Attempt 2: 10 mins
- Attempt 3: 15 mins
- Attempt 4: 20 mins
- Attempt 5: 25 mins (>4 hours total)

**Better:** Exponential backoff with jitter

---

### 9. **No Dead Letter Queue for Failed Notifications**
**Status:** ❌ DATA LOSS RISK
**Problem:** After 5 attempts, failed notifications are marked FAILED and ignored
- No audit trail of permanent failures
- No admin alerting
- Lost messages

---

### 10. **Missing Pre-Condition Checks**
**Status:** ⚠️ SILENT FAILURES
**Problems:**
- `pg_cron` extension might not exist
- `pg_net` extension might not exist
- `app_runtime_settings` table might not exist
- `application_preferences` table existence not verified
- Multiple table joins with no existence checks

---

### 11. **Incomplete Job Execution Monitoring**
**Status:** ❌ NO OBSERVABILITY
**Problem:** 
- No `cron_execution_logs` table
- No job success/failure metrics
- No timing information
- No way to detect hanging jobs

---

## 📋 MISSING CRON JOBS (HIGH PRIORITY)

### 1. **job_mark_interview_completed()**
**Purpose:** Auto-detect when all interview responses are submitted
**Trigger:** When should transition to INTERVIEW_COMPLETED
**Missing:** No auto-detection of interview completion

---

### 2. **job_auto_score_assessment()**
**Purpose:** Calculate assessment scores and pass/fail status
**Missing:** 
- No scoring logic
- No pass/fail threshold
- No status update to applications

---

### 3. **job_auto_score_interview()**
**Purpose:** Calculate interview scores from recorded responses
**Missing:**
- No scoring implementation
- No integration with scoring rules
- No grade assignment

---

### 4. **job_auto_generate_hr_decision()**
**Purpose:** Automatically create HR decision when candidate completes all assessments/interviews
**Missing:**
- No decision generation logic
- No status update
- No notification to hiring team

---

### 5. **job_update_application_status_pipeline()**
**Purpose:** Auto-transition application through states
**Missing:**
- APPLIED → SLOT_ASSIGNED (when slots assigned)
- SLOT_ASSIGNED → ASSESSMENT_IN_PROGRESS (when assessment started)
- ASSESSMENT_COMPLETED → INTERVIEW_IN_PROGRESS (when interview ready)
- INTERVIEW_COMPLETED → (waiting for HR review)

---

### 6. **job_cleanup_expired_sessions()**
**Purpose:** Remove expired assessment/interview session tokens
**Missing:**
- No cleanup of old session tokens
- Database bloat risk
- Security risk (old tokens still accessible)

---

### 7. **job_monitor_cron_execution()**
**Purpose:** Track cron job health and performance
**Missing:**
- No metrics tracking
- No failure detection
- No performance monitoring
- No admin alerting

---

### 8. **job_handle_notification_dead_letters()**
**Purpose:** Move permanently failed notifications to admin queue
**Missing:**
- No dead letter processing
- No admin alerts
- No manual retry mechanism

---

## 🎯 MISSING TRIGGERS

### 1. **trg_auto_update_app_status_on_assessment_complete**
**Purpose:** Auto-transition application to next status when assessment submitted
**Missing:**
```sql
-- Trigger on assessment_attempts AFTER submitted_at is set
-- Should update applications.status based on rules
```

---

### 2. **trg_auto_enqueue_reminders_on_slot_assignment**
**Purpose:** Queue 1h, 2h, 24h reminders automatically
**Missing:**
```sql
-- Trigger on applications WHEN status changes to SLOT_ASSIGNED
-- Should enqueue multiple reminder notifications
```

---

### 3. **trg_enqueue_post_interview_feedback**
**Purpose:** Send feedback/next-steps after interview completes
**Missing:**
```sql
-- Trigger when interview_sessions.completed_at is set
-- Should enqueue feedback notification
```

---

## 📊 CRON SCHEDULE ANALYSIS

| Job | Current | Recommended | Reason |
|-----|---------|-------------|--------|
| expire_links | `*/10` | `*/30` | Less urgent, can batch |
| transition_statuses | `*/10` | `*/5` | Should be frequent |
| assign_slots | `*/15` | `*/10` | Time-sensitive |
| assessment_credentials | `*/5` | `*/5` | ✅ Good |
| mark_no_show | `*/5` | `*/5` | ✅ Good |
| expand_capacity | `* * *` | `0 * * *` | 🚨 **TOO FREQUENT** |
| slot_reminders_24h | `*/10` | `0 * * *` | Less urgent |
| dispatch_notifications | `*/2` | `*/2` | ✅ Good |

---

## 🔧 REQUIRED FIXES (Priority Order)

### P0 - BLOCKING
- [ ] Complete `job_transition_interview_statuses()` IN_PROGRESS/CLOSED queries
- [ ] Complete `job_assign_interview_slots_after_deadline()` preference round logic
- [ ] Fix `vip_expand_slot_capacity_threshold` schedule to `0 * * * *`
- [ ] Complete `job_generate_assessment_credentials()` interview session creation

### P1 - HIGH PRIORITY
- [ ] Add explicit validity windows for assessment_attempts (7-14 days)
- [ ] Add explicit validity windows for interview_sessions (before-to-after slot)
- [ ] Add transaction isolation (`SERIALIZABLE`) to batch operations
- [ ] Add extension existence checks at start of script
- [ ] Create `job_mark_interview_completed()` cron job
- [ ] Create `job_cleanup_expired_sessions()` cron job
- [ ] Improve notification retry backoff (exponential + jitter)

### P2 - MEDIUM PRIORITY
- [ ] Create `job_auto_score_assessment()` cron job
- [ ] Create `job_auto_score_interview()` cron job
- [ ] Create `job_auto_generate_hr_decision()` cron job
- [ ] Create `job_update_application_status_pipeline()` cron job
- [ ] Create `job_monitor_cron_execution()` cron job
- [ ] Add dead letter queue and monitoring for failed notifications
- [ ] Add pre-interview and post-interview reminders
- [ ] Create missing triggers for auto-status-updates

### P3 - ENHANCEMENTS
- [ ] Add rate limiting to webhook dispatch
- [ ] Add circuit breaker for webhook timeouts
- [ ] Add job execution metrics table and dashboard
- [ ] Add alert thresholds for job failures
- [ ] Add graceful handling of resource exhaustion
- [ ] Add comprehensive logging to all cron jobs

---

## 📈 EXPECTED PIPELINE FLOW (Currently Broken)

```
Application Submitted
    ↓
Application Link Expires (job_expire_application_links) ✅
    ↓
Slot Assignment (job_assign_interview_slots) ⚠️ INCOMPLETE
    ↓
Generate Assessment Credentials (job_generate_assessment_credentials) ⚠️ INCOMPLETE
    ↓
Send Assessment Credentials Email ✅
    ↓
Candidate Takes Assessment ✅
    ↓
Assessment Submitted ✅
    ↓
Generate Interview Credentials ⚠️ INCOMPLETE
Auto-Update Status to ASSESSMENT_COMPLETED ❌ MISSING
    ↓
Candidate Takes Interview ✅
    ↓
Interview Submitted ✅
    ↓
Mark Interview Completed ❌ MISSING
Auto-Score Assessment ❌ MISSING
Auto-Score Interview ❌ MISSING
Auto-Generate HR Decision ❌ MISSING
    ↓
HR Reviews Decision ✅
    ↓
Send Final Outcome ✅
```

---

## 🔐 Security Concerns

1. **Session Token Expiration:** Assessment tokens expire at slot START, not slot END
   - Candidates can't access if delayed
   - Should expire 2-7 days after slot

2. **No Session Revocation:** Tokens can't be invalidated early
   - Rejected candidates still have valid tokens
   - Should add `revoked_at` column

3. **No Rate Limiting on Webhooks:** Could be exploited
   - Add `X-RateLimit-*` header checks
   - Add request throttling per org

4. **Notification Tokens in Logs:** Session tokens logged in `notification_deliveries`
   - Should be hashed, not stored plaintext
   - PII concern

---

## 📝 Recommended Next Steps

1. **Immediate (This Sprint):**
   - Fix critical incomplete functions
   - Fix excessive cron schedule
   - Add transaction isolation
   - Add extension existence checks

2. **Week 1:**
   - Implement missing job: `job_mark_interview_completed`
   - Implement missing job: `job_cleanup_expired_sessions`
   - Implement missing job: `job_auto_score_assessment`
   - Add status pipeline automation

3. **Week 2:**
   - Implement remaining missing jobs
   - Add triggers for auto-updates
   - Improve notification retry logic
   - Add dead letter queue

4. **Ongoing:**
   - Add monitoring and alerting
   - Add performance metrics
   - Security audit of token handling
   - Load testing of cron jobs
