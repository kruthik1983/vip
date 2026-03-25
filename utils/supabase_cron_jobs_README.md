# Supabase Cron Jobs Setup

This project now includes a cron automation pack:

- SQL file: `utils/supabase_cron_jobs.sql`

## What It Automates

1. Expire application links after `valid_until`
2. Transition interview statuses (`PUBLISHED` -> `LOCKED` -> `IN_PROGRESS` -> `CLOSED`)
3. Assign candidates to interview slots after application window closes
4. **Generate one-time assessment login credentials** and send to candidates after slot assignment
5. Mark expired unsubmitted assessments as `NO_SHOW`
5. Enqueue slot-assigned notifications and 24h reminder notifications
6. **Auto-generate interview credentials** after assessment submission
7. Dispatch queued notifications through a webhook endpoint with retry handling
8. Expand slot capacity dynamically when occupancy crosses threshold
9. Trigger-based integrity and automation on application writes

## Deployment Steps

1. Open Supabase Dashboard -> SQL Editor.
2. Paste contents of `utils/supabase_cron_jobs.sql`.
3. Run the script as a privileged role.

## Configure Notification Dispatch Webhook

The dispatcher function reads DB settings:

```sql
alter database postgres set app.settings.notification_webhook_url = 'https://<project-ref>.functions.supabase.co/send-notification';
alter database postgres set app.settings.notification_webhook_token = '<edge-function-service-token>';
```

If the URL is not configured, dispatch job will no-op safely.

## Verify Jobs

```sql
select * from cron.job order by jobid;
```

Expected job names:

- `vip_expire_application_links`
- `vip_transition_interview_statuses`
- `vip_assign_interview_slots`
- `vip_generate_assessment_credentials`
- `vip_mark_assessment_no_show`
- `vip_expand_slot_capacity_threshold`
- `vip_enqueue_slot_reminders_24h`
- `vip_dispatch_notifications`

## Manual Function Tests

```sql
select public.job_expire_application_links();
select public.job_transition_interview_statuses();
select public.job_assign_interview_slots_after_deadline(100);
select public.job_generate_assessment_credentials();
select public.job_mark_assessment_no_show();
select public.job_expand_slot_capacity_on_threshold(0.90, 1, 25, 100);
select public.job_enqueue_slot_reminders_24h();
select public.job_dispatch_pending_notifications(20, 5);
```

## Capacity Auto-Scaling Notes

- `pg_cron` minimum frequency is 1 minute (not 1 second).
- Capacity expansion job runs every minute and only increases up to hard ceiling.
- It updates slots with high occupancy and pending applicant demand.

Optional runtime settings:

```sql
alter database postgres set app.settings.slot_expand_threshold = '0.90';
alter database postgres set app.settings.slot_expand_increment = '1';
alter database postgres set app.settings.slot_expand_hard_ceiling = '25';
alter database postgres set app.settings.slot_expand_max_slots_per_run = '100';
```

## Assessment & Interview Credentials Flow

### Assessment Credentials (After Slot Assignment)

1. Cron job `job_generate_assessment_credentials()` runs every **5 minutes**
2. For each application with `SLOT_ASSIGNED` status but no assessment attempt:
   - Generates a secure random `session_token`
   - Creates `assessment_attempts` record with token and validity window
   - Enqueues `ASSESSMENT_CREDENTIALS` notification with the token
3. Candidate receives email with one-time login link using the token
4. Candidate accesses assessment with this token (valid until assessment slot starts)

### Interview Credentials (After Assessment Submission)

1. Trigger `trg_enqueue_interview_credentials_after_assessment()` on assessment_attempts update
2. When assessment is submitted (submitted_at is set):
   - Generates a secure random `session_token`
   - Creates `interview_sessions` record with token and validity window
   - Enqueues `INTERVIEW_CREDENTIALS` notification with the token
3. Candidate receives email with one-time login link using the token
4. Candidate accesses interview with this token (valid until interview slot starts)

### Notification Types

New notification types now in use:

- `ASSESSMENT_CREDENTIALS`: Sent after slot assignment with assessment login token
- `INTERVIEW_CREDENTIALS`: Sent after assessment submission with interview login token
- `SLOT_ASSIGNED`: Sent when slots are assigned (existing)
- `ASSESSMENT_REMINDER_24H`: Sent 24h before assessment (existing)

## Slot Assignment Model

This cron pack uses dual final assignment columns from your current schema:

- `applications.assigned_assessment_slot_id`
- `applications.assigned_interview_slot_id`

It attempts preference-based assignment for both slot types and only commits application assignment when both are allocated.

## Triggers Added

1. `updated_at` maintenance trigger for:
	- `applications`
	- `application_links`
	- `interviews`
	- `jobs`
	- `organizations`
	- `users`
	- `hr_decisions`
2. Assignment integrity trigger on `applications`:
	- Ensures `SLOT_ASSIGNED` has both assignment ids
	- Validates assigned slot ids belong to the same interview
3. Notification trigger on `applications`:
	- Auto-enqueues `SLOT_ASSIGNED` event when assignment transition happens
	- Uses idempotent key, so repeated updates do not create duplicate events
