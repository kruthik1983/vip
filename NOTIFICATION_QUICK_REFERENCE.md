# Notification System: Quick Reference

## Architecture Overview

```
PostgreSQL/Supabase Cron Job
    ↓
SELECT * FROM notification_events WHERE status = 'PENDING'
    ↓
FOR EACH notification:
    - Build payload
    - Call net.http_post()
    ↓
Next.js Webhook
    /api/notifications/send-notification
    - Validate Bearer token
    - Fetch application/interview/slot details
    - Query session token
    ↓
Candidate Email Function
    lib/candidate-emails.ts
    - Format email message
    - Call nodemailer
    - Update status in DB
    ↓
SMTP Server
    - Deliver email to candidate inbox
```

## File Locations

| Component | File | Language | Size |
|-----------|------|----------|------|
| Email Templates | `lib/candidate-emails.ts` | TypeScript | ~190 lines |
| Webhook Handler | `app/api/notifications/send-notification/route.ts` | TypeScript | ~230 lines |
| Cron Jobs | `utils/supabase_cron_jobs.sql` | PL/pgSQL | ~300 lines |
| Setup Guide | `NOTIFICATION_SETUP.md` | Markdown | ~310 lines |
| This Checklist | `DEPLOYMENT_CHECKLIST.md` | Markdown | ~280 lines |

## 4 Notification Types

| Type | Trigger | Email Purpose | Token |
|------|---------|---------------|-------|
| `SLOT_ASSIGNED` | After assessment/interview slot assigned | Confirm dates and times | None |
| `ASSESSMENT_CREDENTIALS` | 30 min after SLOT_ASSIGNED | One-time login link + checklist | ✓ In URL |
| `ASSESSMENT_REMINDER_24H` | 24 hours before assessment | Prep reminder + link + checklist | ✓ In URL |
| `INTERVIEW_CREDENTIALS` | After assessment submission | One-time login link + format + prep | ✓ In URL |

## Environment Variables Required

**Development (.env.local)**
```env
# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@vip.com

# Webhook Security
NOTIFICATION_WEBHOOK_TOKEN=your-secure-token-32-chars

# Application URL (for token links in emails)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Production**: Same variables set in deployment platform (Vercel env vars, AWS Secrets Manager, etc.)

## Testing the System

### 1. Local Mock Mode (No Email Sent)
```bash
npm run dev
# Check console logs for "[EMAIL-MOCK]" messages
# All emails logged to terminal, not sent
```

### 2. Local Staging Mode (Real Email)
```bash
# Set SMTP in .env.local
npm run dev
# Trigger manually via SQL:
# SELECT public.job_dispatch_pending_notifications(5, 5);
# Check inbox for real emails
```

### 3. Production Testing
```bash
# Set real SMTP in production environment
# Create test application via UI
# Wait for cron job to run (2 min)
# Check inbox for emails
```

## Quick Troubleshooting

### "Webhook returned 401 Unauthorized"
```sql
-- Check token mismatch
SELECT current_setting('app.settings.notification_webhook_token', true);
-- Compare with .env NOTIFICATION_WEBHOOK_TOKEN
```

### "Email not received"
```sql
-- Check notification status
SELECT * FROM notification_events 
WHERE status = 'FAILED' 
ORDER BY created_at DESC LIMIT 5;

-- Check delivery logs
SELECT * FROM notification_deliveries 
WHERE status = 'FAILED' 
ORDER BY sent_at DESC LIMIT 5;
```

### "net.http_post returned 500"
```
1. Check webhook handler logs (Next.js console)
2. Look for SQL errors in response_message
3. Verify application/slot records exist in database
```

### "SMTP Connect Error"
```
1. Verify SMTP credentials in .env
2. Check firewall/network allows outgoing 587
3. Test with telnet: telnet smtp.gmail.com 587
```

## Common Code Changes

### Customize Email Subject
File: `lib/candidate-emails.ts`
```typescript
// Change this line in sendAssessmentCredentialsEmail():
subject: `Your Assessment Access - ${params.interviewTitle}`,
// To:
subject: `${params.interviewTitle} - Assessment Login`,
```

### Change Email Template HTML
File: `lib/candidate-emails.ts`
```typescript
// Edit the html property in transporter.sendMail()
html: `<h2>Custom HTML</h2>...`
```

### Add New Webhook Notification Type
File: `app/api/notifications/send-notification/route.ts`
1. Add to notification_type enum (database schema)
2. Add case in switch statement:
```typescript
case "MY_NEW_TYPE":
    // Fetch data
    // Call appropriate email function
    break;
```
3. Add email function to `lib/candidate-emails.ts`

### Change Cron Frequency
File: `utils/supabase_cron_jobs.sql`
```sql
-- Current: ASSESS credentials every 5 min
SELECT cron.alter_job('id_from_cron.job', schedule => '*/5 * * * *');

-- Every 1 minute:
SELECT cron.alter_job('id', schedule => '* * * * *');

-- Every 30 min:
SELECT cron.alter_job('id', schedule => '*/30 * * * *');
```

## Database Schema References

### notification_events table
```sql
CREATE TABLE notification_events (
  id BIGSERIAL PRIMARY KEY,
  notification_type TEXT, -- ASSESSMENT_CREDENTIALS, etc
  organization_id INT8 REFERENCES organizations,
  application_id INT8 REFERENCES applications,
  recipient_email TEXT,
  recipient_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'PENDING', -- PENDING, SENT, FAILED
  idempotency_key TEXT UNIQUE -- Prevents duplicate sends
);
```

### notification_deliveries table
```sql
CREATE TABLE notification_deliveries (
  id BIGSERIAL PRIMARY KEY,
  notification_event_id BIGINT REFERENCES notification_events,
  status TEXT, -- SUCCESS, FAILED, RETRY
  message_id TEXT, -- From nodemailer
  response_message TEXT, -- Error details
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
```

### assessment_attempts table
```sql
CREATE TABLE assessment_attempts (
  id BIGSERIAL PRIMARY KEY,
  application_id INT8,
  session_token TEXT UNIQUE, -- One-time login token
  session_valid_from TIMESTAMPTZ,
  session_valid_until TIMESTAMPTZ
);
```

### interview_sessions table
```sql
CREATE TABLE interview_sessions (
  id BIGSERIAL PRIMARY KEY,
  application_id INT8,
  session_token TEXT UNIQUE, -- One-time login token
  session_valid_from TIMESTAMPTZ,
  session_valid_until TIMESTAMPTZ
);
```

## Critical Configuration

### Before Production:
1. ✅ SMTP credentials tested and working
2. ✅ Webhook token is 32+ random characters
3. ✅ Database settings synchronized:
   ```sql
   ALTER DATABASE postgres SET app.settings.notification_webhook_url = '...';
   ALTER DATABASE postgres SET app.settings.notification_webhook_token = '...';
   ```
4. ✅ Cron jobs deployed and visible in `cron.job`
5. ✅ Sample application created and processed successfully

### SPF/DKIM (Email Deliverability)
If using custom domain:
```
SPF Record: v=spf1 include:sendgrid.net ~all
DKIM: Add DKIM key from email provider
DMARC: v=DMARC1; p=quarantine; rua=mailto:admin@domain.com
```

## Performance Metrics

- **Email Send Latency**: 2-5 seconds
- **Cron Run Frequency**: Every 2 minutes (adjustable)
- **Notifications Per Run**: Up to 50
- **Throughput**: ~1500 emails/hour (at 2-min intervals)
- **SMTP Timeout**: 30 seconds

## When to Scale

- **< 100 emails/day**: Gmail SMTP sufficient
- **100-5K emails/day**: Use SendGrid or AWS SES
- **> 5K emails/day**: Consider dedicated SMTP or queue system

---

**Last Updated**: 2026-03-24  
**Maintained By**: VIP Platform Team  
**Questions?** See `NOTIFICATION_SETUP.md` for detailed docs
