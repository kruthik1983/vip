# Webhook Implementation Deployment Checklist

## Pre-Deployment (Local Testing)

- [ ] **Email Library Created**
  - File: `lib/candidate-emails.ts`
  - Functions: 4 email types (assessmentCredentials, interviewCredentials, slotAssignment, assessmentReminder)
  - Status: ✅ Complete

- [ ] **Webhook Handler Created**
  - File: `app/api/notifications/send-notification/route.ts`
  - Handles: Bearer token validation, notification routing, email sending
  - Status: ✅ Complete

- [ ] **Documentation Created**
  - File: `NOTIFICATION_SETUP.md`
  - Includes: Environment variables, deployment steps, troubleshooting
  - Status: ✅ Complete

- [ ] **Test Environment Variables**
  ```bash
  # Create .env.local with test values
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_USER=test@gmail.com
  SMTP_PASS=app-password
  SMTP_FROM=noreply@vip-test.com
  NOTIFICATION_WEBHOOK_TOKEN=test-token-12345
  NEXT_PUBLIC_APP_URL=http://localhost:3000
  ```

- [ ] **Local Testing**
  ```bash
  npm run dev
  # Create test application via UI or direct DB insert
  # Manually trigger: SELECT public.job_dispatch_pending_notifications(5, 5);
  # Check logs for email output
  ```

## Production Deployment Steps

### 1. Environment Setup

- [ ] **Deployment Platform (Vercel/AWS/etc.)**
  - Add all env variables from NOTIFICATION_SETUP.md
  - Secure sensitive values in secrets manager
  - Redeploy application

- [ ] **Email Configuration**
  - [ ] Choose email provider:
    - **Option A: Gmail** (for testing/small scale)
      - Enable 2FA
      - Generate App Password
      - Set SMTP_HOST=smtp.gmail.com, PORT=587
    - **Option B: SendGrid** (recommended for production)
      - Create account and API key
      - Set SMTP credentials from settings
    - **Option C: AWS SES**
      - Verify sender domain
      - Get SMTP credentials
  - [ ] Test SMTP connection locally
  - [ ] Update `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

- [ ] **Webhook Token**
  - [ ] Generate secure token: `openssl rand -hex 32`
  - [ ] Set `NOTIFICATION_WEBHOOK_TOKEN` in deployment
  - [ ] Keep token secure (do not commit to git)

- [ ] **App URL Configuration**
  - [ ] Set `NEXT_PUBLIC_APP_URL` to production domain
  - [ ] Verify it's accessible from external networks

### 2. Database Configuration

- [ ] **Update Supabase Settings (in Supabase SQL Editor)**
  ```sql
  ALTER DATABASE postgres SET 
    app.settings.notification_webhook_url = 
    'https://your-production-domain.com/api/notifications/send-notification';
    
  ALTER DATABASE postgres SET 
    app.settings.notification_webhook_token = 
    'your-secure-random-token-here';
  ```

- [ ] **Verify Settings**
  ```sql
  SELECT current_setting('app.settings.notification_webhook_url', true);
  SELECT current_setting('app.settings.notification_webhook_token', true);
  ```

### 3. Cron Jobs

- [ ] **Deploy Cron SQL (if not done)**
  - Run `utils/supabase_cron_jobs.sql` in Supabase SQL Editor
  - Verify all 7 jobs registered:
    ```sql
    SELECT jobname FROM cron.job WHERE jobname LIKE 'vip_%' ORDER BY jobname;
    ```

- [ ] **Verify Dispatcher Job**
  ```sql
  SELECT * FROM cron.job WHERE jobname = 'vip_dispatch_notifications';
  -- Should show: */2 * * * * schedule
  ```

### 4. Monitoring & Testing

- [ ] **Create Test Application**
  - Manually create an application in database or via UI
  - Ensure it has both assessment and interview slots assigned
  - Status should be 'SLOT_ASSIGNED'

- [ ] **Manual Dispatch Test**
  ```sql
  SELECT public.job_dispatch_pending_notifications(5, 5);
  ```
  - Check response for success/failure
  - Monitor API logs for webhook execution

- [ ] **Verify Email Delivery**
  - Check inbox for test email
  - Verify all 4 email types if possible:
    - [ ] SLOT_ASSIGNED email
    - [ ] ASSESSMENT_CREDENTIALS email
    - [ ] ASSESSMENT_REMINDER_24H email
    - [ ] INTERVIEW_CREDENTIALS email

- [ ] **Check Database Records**
  ```sql
  -- View recent notifications
  SELECT id, notification_type, status, created_at 
  FROM notification_events 
  WHERE created_at > now() - interval '1 hour'
  ORDER BY created_at DESC;
  
  -- View delivery logs
  SELECT ne.notification_type, nd.status, nd.response_message, nd.sent_at
  FROM notification_deliveries nd
  JOIN notification_events ne ON nd.notification_event_id = ne.id
  WHERE nd.sent_at > now() - interval '1 hour'
  ORDER BY nd.sent_at DESC;
  ```

### 5. Monitoring Setup

- [ ] **Application Logs**
  - [ ] Set up log aggregation (Sentry, LogRocket, etc.)
  - [ ] Monitor for "[NOTIFICATION_ERROR]" messages
  - [ ] Alert on repeated failures

- [ ] **Database Monitoring**
  - [ ] Set up alert for FAILED notifications:
    ```sql
    -- Run hourly
    SELECT COUNT(*) FROM notification_events 
    WHERE status = 'FAILED' AND created_at > now() - interval '1 hour';
    -- Alert if count > 5
    ```

- [ ] **Cron Job Health (optional)**
  ```sql
  -- Monitor execution
  SELECT jobid, jobname, last_run_status, last_run_duration
  FROM cron.job_run_details
  WHERE jobname = 'vip_dispatch_notifications'
  ORDER BY start_time DESC LIMIT 10;
  ```

### 6. Post-Deployment

- [ ] **Verify Automated Flows**
  - [ ] Create new application via UI
  - [ ] Wait for slots assignment (15 minutes)
  - [ ] Verify ASSESSMENT_CREDENTIALS email received (5+ min after assignment)
  - [ ] Submit assessment
  - [ ] Verify INTERVIEW_CREDENTIALS email received

- [ ] **Document Configuration**
  - [ ] Record SMTP provider and settings location
  - [ ] Document webhook token rotation schedule
  - [ ] Note production email sender address for SPF/DKIM

- [ ] **Team Communication**
  - [ ] Notify team that notifications are live
  - [ ] Share NOTIFICATION_SETUP.md for troubleshooting
  - [ ] Schedule training on scaling capacity if needed

## Rollback Plan

If deployment fails:

1. **Remove Webhook Configuration**
   ```sql
   ALTER DATABASE postgres RESET app.settings.notification_webhook_url;
   ALTER DATABASE postgres RESET app.settings.notification_webhook_token;
   ```

2. **Revert Application** 
   - Redeploy previous version

3. **Status**: Cron jobs will safely skip (webhook not configured)

## Scaling Considerations

- **Email Volume**: ~100/hour/interview (adjustable via cron frequency)
- **SMTP Rate Limits**: Gmail=100/hour, SendGrid=varies
- **Notification Batching**: Dispatcher processes 50 per run every 2 minutes
- **Retry Logic**: Exponential backoff (5, 10, 15, 20, 25 min)

## Cost Estimates (Monthly)

- **Gmail**: Free (limited to 500/day)
- **SendGrid**: ~$10 for 5K emails
- **AWS SES**: ~$0.10 per 1K emails
- **Custom SMTP**: Depends on provider

---

**Status**: Ready to deploy
**Last Updated**: 2026-03-24
**Owner**: VIP Team
