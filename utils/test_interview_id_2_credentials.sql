-- ============================================================================
-- TEST PACK: interview_id = 2
-- Purpose:
-- 1) Seed fresh SLOT_ASSIGNED applications for interview 2
-- 2) Run credential generation job (assessment + interview immediate)
-- 3) Run dispatch job
-- 4) Verify events, sessions, and duplicate-protection behavior
--
-- Run in Supabase SQL Editor as a role with insert/update permissions.
-- ============================================================================

-- Safety: use a temp table to track only records created by this script.
create temporary table if not exists tmp_test_apps_int2 (
  application_id bigint primary key,
  candidate_email text not null
) on commit drop;

truncate table tmp_test_apps_int2;

-- Seed 3 fresh applications for interview 2 with both slots pre-assigned.
do $$
declare
  v_interview_id bigint := 2;
  v_assessment_slot_id bigint;
  v_interview_slot_id bigint;
  v_ts_suffix text;
begin
  if not exists (select 1 from interviews i where i.id = v_interview_id) then
    raise exception 'Interview % does not exist', v_interview_id;
  end if;

  select s.id
    into v_assessment_slot_id
    from assessment_slots s
   where s.interview_id = v_interview_id
   order by s.slot_start_utc asc nulls last, s.id asc
   limit 1;

  select s.id
    into v_interview_slot_id
    from interview_slots s
   where s.interview_id = v_interview_id
   order by s.slot_start_utc asc nulls last, s.id asc
   limit 1;

  if v_assessment_slot_id is null then
    raise exception 'No assessment_slots found for interview %', v_interview_id;
  end if;

  if v_interview_slot_id is null then
    raise exception 'No interview_slots found for interview %', v_interview_id;
  end if;

  v_ts_suffix := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');

  with seeded as (
    insert into applications (
      interview_id,
      candidate_name,
      candidate_email,
      status,
      assigned_assessment_slot_id,
      assigned_interview_slot_id,
      assessment_slot_assigned_at,
      interview_slot_assigned_at,
      created_at,
      updated_at
    )
    select
      v_interview_id,
      format('QA Int2 Candidate %s', gs.n),
      format('qa-int2-%s-%s@example.com', v_ts_suffix, gs.n),
      'SLOT_ASSIGNED',
      v_assessment_slot_id,
      v_interview_slot_id,
      now(),
      now(),
      now(),
      now()
    from generate_series(1, 3) as gs(n)
    returning id, candidate_email
  )
  insert into tmp_test_apps_int2 (application_id, candidate_email)
  select id, candidate_email
  from seeded;
end;
$$;

-- Confirm seed set.
select
  a.id,
  a.interview_id,
  a.status,
  a.assigned_assessment_slot_id,
  a.assigned_interview_slot_id,
  a.candidate_email,
  a.created_at
from applications a
join tmp_test_apps_int2 t on t.application_id = a.id
order by a.id;

-- Generate credentials immediately (assessment + interview).
select public.job_generate_assessment_credentials() as generation_result;

-- Verify both session records were created for seeded apps.
select
  t.application_id,
  aa.id as assessment_attempt_id,
  aa.session_token as assessment_token,
  aa.session_valid_from as assessment_valid_from,
  aa.session_valid_until as assessment_valid_until,
  isess.id as interview_session_id,
  isess.session_token as interview_token,
  isess.session_valid_from as interview_valid_from,
  isess.session_valid_until as interview_valid_until
from tmp_test_apps_int2 t
left join assessment_attempts aa on aa.application_id = t.application_id
left join interview_sessions isess on isess.application_id = t.application_id
order by t.application_id;

-- Verify events before dispatch.
select
  ne.notification_type,
  ne.status,
  count(*) as total
from notification_events ne
join tmp_test_apps_int2 t on t.application_id = ne.application_id
group by ne.notification_type, ne.status
order by ne.notification_type, ne.status;

-- Dispatch pending events now.
select public.job_dispatch_pending_notifications(100, 5) as dispatch_result;

-- Verify event + delivery states after dispatch.
select
  ne.application_id,
  ne.notification_type,
  ne.status as event_status,
  nd.status as delivery_status,
  nd.attempt_number,
  nd.response_message,
  nd.sent_at
from notification_events ne
join tmp_test_apps_int2 t on t.application_id = ne.application_id
left join notification_deliveries nd on nd.notification_event_id = ne.id
order by ne.application_id, ne.notification_type, nd.attempt_number desc;

-- Trigger the assessment-submission trigger on one seeded app.
-- Expected: no duplicate interview credentials event because interview session already exists.
update assessment_attempts aa
   set submitted_at = coalesce(aa.submitted_at, now())
 where aa.application_id = (
   select t.application_id
   from tmp_test_apps_int2 t
   order by t.application_id
   limit 1
 );

-- Duplicate-protection check: should be exactly 1 INTERVIEW_CREDENTIALS event per seeded app.
select
  ne.application_id,
  count(*) as interview_credentials_event_count
from notification_events ne
join tmp_test_apps_int2 t on t.application_id = ne.application_id
where ne.notification_type = 'INTERVIEW_CREDENTIALS'
group by ne.application_id
order by ne.application_id;

-- Optional cleanup helper (run manually only if desired):
-- delete from applications a where exists (
--   select 1 from tmp_test_apps_int2 t where t.application_id = a.id
-- );
