# Notification Webhook Setup Guide

This guide covers setting up the notification webhook to send candidate emails for slot assignments and credentials.

## Architecture

```
Cron Job: job_dispatch_pending_notifications
    ↓ (every 2 minutes)
PostgreSQL net.http_post()
    ↓
Next.js API: /api/notifications/send-notification
    ↓
Nodemailer + SMTP
    ↓
Candidate Email
```

## Environment Variables

Add these to your `.env.local` file:

### Email Configuration (SMTP)

```
# SMTP Server Settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@vip-platform.com

# For Gmail:
# - Enable 2FA on your account
# - Create an App Password: https://myaccount.google.com/apppasswords
# - Use the 16-character password above
```

### Webhook Security

```
# Generate a secure token for webhook authentication
# $ openssl rand -hex 32
NOTIFICATION_WEBHOOK_TOKEN=your-secure-random-token-here

# Public app URL (for email links)
NEXT_PUBLIC_APP_URL=https://your-vip-platform.com
```

### Supabase Configuration

```
# (Already configured in your existing setup)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Deployment Steps

### Step 1: Configure Environment Variables

Update your `.env.local` or deployment platform (Vercel, etc.):

```bash
# Set all environment variables from the section above
```

### Step 2: Configure Database Settings in Supabase

Run these SQL commands in Supabase SQL Editor:

```sql
-- Set the webhook URL (replace with your actual URL)
ALTER DATABASE postgres SET 
  app.settings.notification_webhook_url = 
  'https://your-vip-platform.com/api/notifications/send-notification';

-- Set the webhook token (must match NOTIFICATION_WEBHOOK_TOKEN env var)
ALTER DATABASE postgres SET 
  app.settings.notification_webhook_token = 
  'your-secure-random-token-here';
```

### Step 3: Deploy Cron Jobs SQL

If not already done, deploy the cron jobs:

```sql
-- Run the entire utils/supabase_cron_jobs.sql file in Supabase SQL Editor
```

### Step 4: Verify Setup

```sql
-- Check cron jobs are registered
SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE 'vip_%';

-- Should show: vip_dispatch_notifications (*/2 * * * *)

-- Test notification dispatch manually
SELECT public.job_dispatch_pending_notifications(5, 5);

-- Check notification_events for PENDING status
SELECT id, notification_type, status, scheduled_send_at 
FROM notification_events 
WHERE status = 'PENDING' 
ORDER BY created_at DESC LIMIT 5;
```

## Email Templates

Four email types are automatically sent:

### 1. SLOT_ASSIGNED
- Sent when candidate is assigned both assessment and interview slots
- Contains: Assessment date/time, Interview date/time
- Purpose: Confirmation and coordination

### 2. ASSESSMENT_CREDENTIALS
- Sent 5 minutes after slots are assigned (by `job_generate_assessment_credentials`)
- Contains: Assessment start time, one-time login token/link
- Purpose: Provide access to take the assessment

### 3. ASSESSMENT_REMINDER_24H
- Sent 24 hours before assessment starts
- Contains: Assessment date/time, technical checklist, login link
- Purpose: Remind candidate and prepare for session

### 4. INTERVIEW_CREDENTIALS
- Sent after assessment is submitted (triggered automatically)
- Contains: Interview start time, one-time login token/link
- Purpose: Provide access to take the interview

## Testing

### Local Testing with Mock Mode

If `SMTP_HOST` is not set, all emails are logged to console:

```
Server log:
[EMAIL-MOCK] Assessment credentials email to candidate@example.com for John Doe. Token: a1b2c3d4...
```

### Staging Testing with Real Email

1. Set valid SMTP credentials
2. Create a test application programmatically or in UI
3. Manually trigger the dispatch job:

```sql
SELECT public.job_dispatch_pending_notifications(50, 5);
```

4. Check email inbox for test emails

### Production Monitoring

Monitor these tables in Supabase:

```sql
-- View pending notifications
SELECT id, notification_type, recipient_email, status, scheduled_send_at
FROM notification_events
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC;

-- View delivery history  
SELECT ne.notification_type, nd.status, nd.response_message, nd.sent_at
FROM notification_deliveries nd
JOIN notification_events ne ON nd.notification_event_id = ne.id
WHERE nd.sent_at > now() - interval '24 hours'
ORDER BY nd.sent_at DESC;

-- View failed notifications (for alerting)
SELECT ne.id, ne.notification_type, ne.recipient_email, ne.scheduled_send_at
FROM notification_events ne
WHERE ne.status = 'FAILED'
ORDER BY ne.created_at DESC;
```

## Troubleshooting

### Emails not sending?

1. **Check webhook is configured:**
   ```sql
   SELECT current_setting('app.settings.notification_webhook_url', true);
   SELECT current_setting('app.settings.notification_webhook_token', true);
   ```

2. **Check cron job is running:**
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'vip_dispatch_notifications';
   SELECT * FROM cron.job_run_details WHERE jobid = <id> ORDER BY start_time DESC LIMIT 5;
   ```

3. **Check API logs:**
   - Vercel: Deployment > Functions > Logs
   - Local: `npm run dev` console output

4. **Test webhook directly:**
   ```bash
   curl -X POST https://your-vip-platform.com/api/notifications/send-notification \
     -H "Authorization: Bearer your-secure-random-token-here" \
     -H "Content-Type: application/json" \
     -d '{
       "eventId": 1,
       "notificationType": "ASSESSMENT_CREDENTIALS",
       "applicationId": 1,
       "organizationId": 1,
       "recipientEmail": "test@example.com",
       "recipientName": "Test User",
       "idempotencyKey": "test-key"
     }'
   ```

### SMTP authentication fails?

- **Gmail**: Use App Password (16 chars), not your main password
- **Office 365**: Check if 2FA is enabled
- **Custom SMTP**: Verify port (usually 587 TLS or 465 SSL)

### Tokens not in emails?

- Check `assessment_attempts.session_token` exists for the application
- Check `interview_sessions.session_token` exists
- Verify `job_generate_assessment_credentials()` is running

## Email Customization

To customize email templates, edit `lib/candidate-emails.ts`:

- Logo/branding: Update `SMTP_FROM` and email HTML
- Links: Update `NEXT_PUBLIC_APP_URL`
- Subject lines: Modify `subject:` fields
- Content: Edit HTML templates in email functions

## Security Best Practices

1. **Token Security**
   - Rotate `NOTIFICATION_WEBHOOK_TOKEN` regularly
   - Use secure random generation: `openssl rand -hex 32`
   - Store in environment variables, never in code

2. **Email Security**
   - Use TLS/SSL for SMTP (port 587 or 465)
   - Never log tokens or sensitive data
   - Use idempotency keys to prevent duplicates

3. **Rate Limiting**
   - Webhook handles up to 50 notifications per run
   - Cron runs every 2 minutes (max 1500 emails/hour)
   - Exponential backoff on failures

## Support

For issues:
1. Check server logs (console or platform-specific logs)
2. Verify all environment variables are set
3. Run diagnostic SQL queries above
4. Test webhook with curl command
