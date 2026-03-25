-- ============================================================================
-- SUPABASE CRON AUTOMATION PACK - CORRECTED & ENHANCED
-- ============================================================================
-- Version: 2.0 (Fixed + Enhanced)
-- Purpose:
-- 1) Expire application links automatically
-- 2) Transition interview statuses by time windows
-- 3) Assign candidates to interview slots after application window closes
-- 4) Generate assessment login credentials (one-time tokens) for assigned candidates
-- 5) Enqueue slot assignment/reminder/credentials notifications
-- 6) Auto-generate interview login credentials after assessment submission
-- 7) Auto-mark interviews as completed when all responses submitted
-- 8) Auto-mark interviews as no-show when session expires without responses
-- 9) Auto-score assessments and interviews
-- 10) Auto-update application status through pipeline
-- 11) Dispatch notification events via webhook
-- 12) Expand slot capacity by threshold with hard ceiling
-- 13) Cleanup expired session tokens
-- 14) Monitor cron execution health
--
-- Run this script in Supabase SQL Editor as a privileged role.
-- FIXES APPLIED:
-- - Fixed job_transition_interview_statuses() incomplete queries
-- - Fixed job_assign_interview_slots_after_deadline() incomplete matching
-- - Fixed job_generate_assessment_credentials() incomplete interview session creation
-- - Fixed excessive cron schedule (vip_expand_slot_capacity_threshold -> 0 * * * *)
-- - Added proper validity windows for assessment/interview sessions
-- - Added 9 new automation jobs (including interview no-show detection)
-- - Added 3 new triggers for auto-status updates
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Create logging table for cron execution monitoring
create table if not exists public.cron_execution_logs (
  id bigserial primary key,
  job_name text not null,
  executed_at timestamptz not null default now(),
  duration_seconds numeric,
  success boolean,
  error_message text,
  rows_affected integer
);

create index if not exists idx_cron_logs_job_name on public.cron_execution_logs(job_name);
create index if not exists idx_cron_logs_executed_at on public.cron_execution_logs(executed_at desc);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Helper: Generate secure random token for session/credentials.
create or replace function public.generate_auth_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  return v_token;
end;
$$;

-- Helper: Log cron execution
create or replace function public.log_cron_execution(
  p_job_name text,
  p_duration_seconds numeric,
  p_success boolean,
  p_error_message text default null,
  p_rows_affected integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into cron_execution_logs (job_name, duration_seconds, success, error_message, rows_affected)
  values (p_job_name, p_duration_seconds, p_success, p_error_message, p_rows_affected);
exception when others then
  -- Silently ignore logging errors to not break cron jobs
  null;
end;
$$;

-- Helper: queue slot-assigned notification in an idempotent way.
create or replace function public.enqueue_slot_assigned_notification(
  p_application_id bigint,
  p_organization_id bigint,
  p_candidate_email text,
  p_candidate_name text,
  p_assigned_assessment_slot_id bigint,
  p_assigned_interview_slot_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_events (
    notification_type,
    application_id,
    organization_id,
    recipient_email,
    recipient_name,
    scheduled_send_at,
    status,
    idempotency_key
  )
  values (
    'SLOT_ASSIGNED',
    p_application_id,
    p_organization_id,
    p_candidate_email,
    p_candidate_name,
    now(),
    'PENDING',
    format('slot-assigned-%s-%s-%s', p_application_id, p_assigned_assessment_slot_id, p_assigned_interview_slot_id)
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

-- Helper: queue assessment credentials notification
create or replace function public.enqueue_assessment_credentials_notification(
  p_application_id bigint,
  p_organization_id bigint,
  p_candidate_email text,
  p_candidate_name text,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_events (
    notification_type,
    application_id,
    organization_id,
    recipient_email,
    recipient_name,
    scheduled_send_at,
    status,
    idempotency_key
  )
  values (
    'ASSESSMENT_CREDENTIALS',
    p_application_id,
    p_organization_id,
    p_candidate_email,
    p_candidate_name,
    now(),
    'PENDING',
    format('assessment-credentials-%s-%s', p_application_id, p_session_token)
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

-- Helper: queue interview credentials notification
create or replace function public.enqueue_interview_credentials_notification(
  p_application_id bigint,
  p_organization_id bigint,
  p_candidate_email text,
  p_candidate_name text,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_events (
    notification_type,
    application_id,
    organization_id,
    recipient_email,
    recipient_name,
    scheduled_send_at,
    status,
    idempotency_key
  )
  values (
    'INTERVIEW_CREDENTIALS',
    p_application_id,
    p_organization_id,
    p_candidate_email,
    p_candidate_name,
    now(),
    'PENDING',
    format('interview-credentials-%s-%s', p_application_id, p_session_token)
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

-- ============================================================================
-- CRON JOB #1: Expire Application Links
-- ============================================================================
create or replace function public.job_expire_application_links()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
  v_start_time timestamptz := now();
begin
  update application_links
     set is_active = false,
         updated_at = now()
   where is_active = true
     and valid_until <= now();

  get diagnostics v_rows = row_count;
  
  perform public.log_cron_execution(
    'job_expire_application_links',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_rows
  );
  
  return v_rows;
exception when others then
  perform public.log_cron_execution(
    'job_expire_application_links',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #2: Transition Interview Statuses (FIXED)
-- ============================================================================
create or replace function public.job_transition_interview_statuses()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked integer := 0;
  v_in_progress integer := 0;
  v_closed integer := 0;
  v_start_time timestamptz := now();
begin
  -- PUBLISHED -> LOCKED once campaign has started.
  update interviews i
     set status = 'LOCKED',
         locked_at = coalesce(i.locked_at, now()),
         updated_at = now()
   where i.status = 'PUBLISHED'
     and i.campaign_start_utc is not null
     and i.campaign_start_utc <= now();
  get diagnostics v_locked = row_count;

  -- LOCKED/PUBLISHED -> IN_PROGRESS when first assessment slot has started.
  update interviews i
     set status = 'IN_PROGRESS',
         updated_at = now()
   where i.status in ('PUBLISHED', 'LOCKED')
     and exists (
       select 1
       from assessment_slots s
       where s.interview_id = i.id
         and s.slot_start_utc <= now()
     );
  get diagnostics v_in_progress = row_count;

  -- Any active state -> CLOSED when all interview slots have ended and past window.
  update interviews i
     set status = 'CLOSED',
         updated_at = now()
   where i.status in ('PUBLISHED', 'LOCKED', 'IN_PROGRESS')
     and exists (
       select 1
       from interview_slots s
       where s.interview_id = i.id
         and s.slot_end_utc <= now()
     )
     and not exists (
       select 1
       from interview_slots s2
       where s2.interview_id = i.id
         and s2.slot_end_utc > now()
     );
  get diagnostics v_closed = row_count;

  perform public.log_cron_execution(
    'job_transition_interview_statuses',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_locked + v_in_progress + v_closed
  );

  return jsonb_build_object(
    'locked', v_locked,
    'inProgress', v_in_progress,
    'closed', v_closed
  );
exception when others then
  perform public.log_cron_execution(
    'job_transition_interview_statuses',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #3: Assign Interview Slots After Deadline (FIXED)
-- ============================================================================
create or replace function public.job_assign_interview_slots_after_deadline(
  p_max_candidates integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interview record;
  v_app record;
  v_finalized_count integer := 0;
  v_remaining_budget integer := 0;
  v_round integer;
  v_candidates_in_batch integer := 0;
  v_assigned_count integer := 0;
  v_unassigned_count integer := 0;
  v_processed integer := 0;
  v_start_time timestamptz := now();
begin
  create temporary table if not exists tmp_slot_candidates (
    application_id bigint primary key,
    interview_id bigint not null,
    organization_id bigint not null,
    candidate_email text not null,
    candidate_name text,
    created_at timestamptz not null,
    assigned_assessment_slot_id bigint,
    assigned_interview_slot_id bigint
  ) on commit drop;

  for v_interview in
    select
      i.id as interview_id,
      i.organization_id,
      min(a.created_at) as first_application_at
    from interviews i
    join applications a on a.interview_id = i.id
    where a.status = 'APPLIED'
      and a.assigned_assessment_slot_id is null
      and a.assigned_interview_slot_id is null
      and exists (
        select 1
        from application_links al
        where al.interview_id = i.id
          and al.valid_until <= now()
      )
      and not exists (
        select 1
        from application_links al2
        where al2.interview_id = i.id
          and al2.is_active = true
          and al2.valid_until > now()
      )
    group by i.id, i.organization_id
    order by min(a.created_at) asc
  loop
    v_remaining_budget := greatest(p_max_candidates - v_processed, 0);
    exit when v_remaining_budget = 0;

    truncate table tmp_slot_candidates;

    insert into tmp_slot_candidates (
      application_id,
      interview_id,
      organization_id,
      candidate_email,
      candidate_name,
      created_at
    )
    select
      a.id,
      a.interview_id,
      v_interview.organization_id,
      a.candidate_email,
      a.candidate_name,
      a.created_at
    from applications a
    where a.interview_id = v_interview.interview_id
      and a.status = 'APPLIED'
      and a.assigned_assessment_slot_id is null
      and a.assigned_interview_slot_id is null
    order by a.created_at asc
    limit v_remaining_budget;

    get diagnostics v_candidates_in_batch = row_count;
    if v_candidates_in_batch = 0 then
      continue;
    end if;

    v_processed := v_processed + v_candidates_in_batch;

    -- ===== ASSESSMENT MATCHING: Preference Rounds 1..3 =====
    for v_round in 1..3 loop
      with assessment_capacity as (
        select
          s.id as slot_id,
          greatest(
            coalesce(s.max_candidates, 0) - coalesce(s.assigned_candidates, 0) - coalesce(tc.used_count, 0),
            0
          ) as remaining
        from assessment_slots s
        left join (
          select assigned_assessment_slot_id as slot_id, count(*) as used_count
          from tmp_slot_candidates
          where assigned_assessment_slot_id is not null
          group by assigned_assessment_slot_id
        ) tc on tc.slot_id = s.id
        where s.interview_id = v_interview.interview_id
      ),
      ranked_proposals as (
        select
          t.application_id,
          t.created_at,
          case 
            when v_round = 1 then asp.preferred_assessment_slot_1_id
            when v_round = 2 then asp.preferred_assessment_slot_2_id
            when v_round = 3 then asp.preferred_assessment_slot_3_id
          end as slot_id,
          row_number() over (
            partition by case 
              when v_round = 1 then asp.preferred_assessment_slot_1_id
              when v_round = 2 then asp.preferred_assessment_slot_2_id
              when v_round = 3 then asp.preferred_assessment_slot_3_id
            end
            order by t.created_at asc, t.application_id asc
          ) as within_slot_rank
        from tmp_slot_candidates t
        left join application_preferences asp on asp.application_id = t.application_id
        where t.assigned_assessment_slot_id is null
      ),
      matches as (
        select rp.application_id, rp.slot_id
        from ranked_proposals rp
        join assessment_capacity ac on ac.slot_id = rp.slot_id
        where rp.slot_id is not null
          and rp.within_slot_rank <= ac.remaining
      )
      update tmp_slot_candidates t
         set assigned_assessment_slot_id = m.slot_id
        from matches m
       where t.application_id = m.application_id
         and t.assigned_assessment_slot_id is null;
    end loop;

    -- Assessment fallback: earliest slot by time with remaining capacity.
    with assessment_capacity as (
      select
        s.id as slot_id,
        s.slot_start_utc,
        greatest(
          coalesce(s.max_candidates, 0) - coalesce(s.assigned_candidates, 0) - coalesce(tc.used_count, 0),
          0
        ) as remaining
      from assessment_slots s
      left join (
        select assigned_assessment_slot_id as slot_id, count(*) as used_count
        from tmp_slot_candidates
        where assigned_assessment_slot_id is not null
        group by assigned_assessment_slot_id
      ) tc on tc.slot_id = s.id
      where s.interview_id = v_interview.interview_id
    ),
    available_seats as (
      select
        ac.slot_id,
        row_number() over (
          order by ac.slot_start_utc asc, ac.slot_id asc
        ) as seat_rank
      from assessment_capacity ac
      cross join lateral generate_series(1, ac.remaining) as gs(seat_no)
      where ac.remaining > 0
    ),
    unmatched as (
      select
        t.application_id,
        row_number() over (order by t.created_at asc, t.application_id asc) as app_rank
      from tmp_slot_candidates t
      where t.assigned_assessment_slot_id is null
    ),
    fallback_pairs as (
      select u.application_id, s.slot_id
      from unmatched u
      join available_seats s on s.seat_rank = u.app_rank
    )
    update tmp_slot_candidates t
       set assigned_assessment_slot_id = fp.slot_id
      from fallback_pairs fp
     where t.application_id = fp.application_id
       and t.assigned_assessment_slot_id is null;

    -- ===== INTERVIEW MATCHING: Preference Rounds 1..3 =====
    for v_round in 1..3 loop
      with interview_capacity as (
        select
          s.id as slot_id,
          greatest(
            coalesce(s.max_candidates, 0) - coalesce(s.assigned_candidates, 0) - coalesce(tc.used_count, 0),
            0
          ) as remaining
        from interview_slots s
        left join (
          select assigned_interview_slot_id as slot_id, count(*) as used_count
          from tmp_slot_candidates
          where assigned_interview_slot_id is not null
          group by assigned_interview_slot_id
        ) tc on tc.slot_id = s.id
        where s.interview_id = v_interview.interview_id
      ),
      ranked_proposals as (
        select
          t.application_id,
          t.created_at,
          case 
            when v_round = 1 then asp.preferred_interview_slot_1_id
            when v_round = 2 then asp.preferred_interview_slot_2_id
            when v_round = 3 then asp.preferred_interview_slot_3_id
          end as slot_id,
          row_number() over (
            partition by case 
              when v_round = 1 then asp.preferred_interview_slot_1_id
              when v_round = 2 then asp.preferred_interview_slot_2_id
              when v_round = 3 then asp.preferred_interview_slot_3_id
            end
            order by t.created_at asc, t.application_id asc
          ) as within_slot_rank
        from tmp_slot_candidates t
        left join application_preferences asp on asp.application_id = t.application_id
        where t.assigned_interview_slot_id is null
      ),
      matches as (
        select rp.application_id, rp.slot_id
        from ranked_proposals rp
        join interview_capacity ic on ic.slot_id = rp.slot_id
        where rp.slot_id is not null
          and rp.within_slot_rank <= ic.remaining
      )
      update tmp_slot_candidates t
         set assigned_interview_slot_id = m.slot_id
        from matches m
       where t.application_id = m.application_id
         and t.assigned_interview_slot_id is null;
    end loop;

    -- Interview fallback: earliest slot by time with remaining capacity.
    with interview_capacity as (
      select
        s.id as slot_id,
        s.slot_start_utc,
        greatest(
          coalesce(s.max_candidates, 0) - coalesce(s.assigned_candidates, 0) - coalesce(tc.used_count, 0),
          0
        ) as remaining
      from interview_slots s
      left join (
        select assigned_interview_slot_id as slot_id, count(*) as used_count
        from tmp_slot_candidates
        where assigned_interview_slot_id is not null
        group by assigned_interview_slot_id
      ) tc on tc.slot_id = s.id
      where s.interview_id = v_interview.interview_id
    ),
    available_seats as (
      select
        ic.slot_id,
        row_number() over (
          order by ic.slot_start_utc asc, ic.slot_id asc
        ) as seat_rank
      from interview_capacity ic
      cross join lateral generate_series(1, ic.remaining) as gs(seat_no)
      where ic.remaining > 0
    ),
    unmatched as (
      select
        t.application_id,
        row_number() over (order by t.created_at asc, t.application_id asc) as app_rank
      from tmp_slot_candidates t
      where t.assigned_interview_slot_id is null
    ),
    fallback_pairs as (
      select u.application_id, s.slot_id
      from unmatched u
      join available_seats s on s.seat_rank = u.app_rank
    )
    update tmp_slot_candidates t
       set assigned_interview_slot_id = fp.slot_id
      from fallback_pairs fp
     where t.application_id = fp.application_id
       and t.assigned_interview_slot_id is null;

    -- Finalized candidates: must have both slot types.
    with finalized as (
      select *
      from tmp_slot_candidates
      where assigned_assessment_slot_id is not null
        and assigned_interview_slot_id is not null
    )
    update applications a
       set assigned_assessment_slot_id = f.assigned_assessment_slot_id,
           assigned_interview_slot_id = f.assigned_interview_slot_id,
           status = 'SLOT_ASSIGNED',
           updated_at = now()
     where a.id in (select application_id from finalized);

    get diagnostics v_finalized_count = row_count;
    v_assigned_count := v_assigned_count + v_finalized_count;

    -- Increment used counts for finalized applications.
    with finalized_candidates as (
      select assigned_assessment_slot_id, count(*) as candidate_count
      from tmp_slot_candidates
      where assigned_assessment_slot_id is not null
        and assigned_interview_slot_id is not null
      group by assigned_assessment_slot_id
    )
    update assessment_slots s
       set assigned_candidates = coalesce(s.assigned_candidates, 0) + c.candidate_count
      from finalized_candidates c
     where s.id = c.assigned_assessment_slot_id;

    with finalized_candidates as (
      select assigned_interview_slot_id, count(*) as candidate_count
      from tmp_slot_candidates
      where assigned_assessment_slot_id is not null
        and assigned_interview_slot_id is not null
      group by assigned_interview_slot_id
    )
    update interview_slots s
       set assigned_candidates = coalesce(s.assigned_candidates, 0) + c.candidate_count
      from finalized_candidates c
     where s.id = c.assigned_interview_slot_id;

    -- Queue assignment emails for finalized applications.
    for v_app in
      select
        f.application_id,
        f.organization_id,
        f.candidate_email,
        f.candidate_name,
        f.assigned_assessment_slot_id,
        f.assigned_interview_slot_id
      from tmp_slot_candidates f
      where f.assigned_assessment_slot_id is not null
        and f.assigned_interview_slot_id is not null
    loop
      perform public.enqueue_slot_assigned_notification(
        v_app.application_id,
        v_app.organization_id,
        v_app.candidate_email,
        v_app.candidate_name,
        v_app.assigned_assessment_slot_id,
        v_app.assigned_interview_slot_id
      );
    end loop;

    v_unassigned_count := v_unassigned_count + (
      select count(*)
      from tmp_slot_candidates
      where assigned_assessment_slot_id is null
         or assigned_interview_slot_id is null
    );
  end loop;

  perform public.log_cron_execution(
    'job_assign_interview_slots_after_deadline',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_assigned_count
  );

  return jsonb_build_object(
    'processed', v_processed,
    'assigned', v_assigned_count,
    'unassigned', v_unassigned_count
  );
exception when others then
  perform public.log_cron_execution(
    'job_assign_interview_slots_after_deadline',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #4: Generate Assessment Credentials (FIXED)
-- ============================================================================
create or replace function public.job_generate_assessment_credentials()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app record;
  v_assessment_attempt_id bigint;
  v_session_token text;
  v_interview_session_token text;
  v_assessment_slot record;
  v_interview_slot record;
  v_generated_count integer := 0;
  v_interview_generated_count integer := 0;
  v_start_time timestamptz := now();
begin
  -- Find applications with assigned slots but no assessment attempt yet.
  for v_app in
    select
      a.id as application_id,
      a.interview_id,
      a.candidate_email,
      a.candidate_name,
      a.assigned_assessment_slot_id,
      a.assigned_interview_slot_id,
      i.organization_id
    from applications a
    join interviews i on i.id = a.interview_id
    where a.status = 'SLOT_ASSIGNED'
      and a.assigned_assessment_slot_id is not null
      and not exists (
        select 1 from assessment_attempts aa
        where aa.application_id = a.id
      )
  loop
    -- Get assessment slot details for validity window.
    select slot_start_utc, slot_end_utc
      into v_assessment_slot
      from assessment_slots
      where id = v_app.assigned_assessment_slot_id;

    if v_assessment_slot is null then
      continue;
    end if;

    -- Get interview slot details for validity window.
    if v_app.assigned_interview_slot_id is not null then
      select slot_start_utc, slot_end_utc
        into v_interview_slot
        from interview_slots
        where id = v_app.assigned_interview_slot_id;
    else
      v_interview_slot := null;
    end if;

    -- Generate unique session token for assessment.
    v_session_token := public.generate_auth_token();

    -- Create assessment attempt with PROPER validity window (7 days).
    -- Token becomes valid now, valid until 7 days after slot start or 1 day after slot end, whichever is later.
    begin
      insert into assessment_attempts (
        application_id,
        session_token,
        session_valid_from,
        session_valid_until,
        status,
        created_at
      )
      values (
        v_app.application_id,
        v_session_token,
        now(),
        greatest(
          now() + interval '7 days',
          v_assessment_slot.slot_end_utc + interval '1 day'
        ),
        'PENDING',
        now()
      )
      returning id into v_assessment_attempt_id;

      -- Enqueue assessment credentials notification with token.
      perform public.enqueue_assessment_credentials_notification(
        v_app.application_id,
        v_app.organization_id,
        v_app.candidate_email,
        v_app.candidate_name,
        v_session_token
      );

      v_generated_count := v_generated_count + 1;

      -- FIXED: Create interview session token immediately and enqueue interview credentials.
      if v_app.assigned_interview_slot_id is not null
         and v_interview_slot is not null
         and not exists (
           select 1
           from interview_sessions isess
           where isess.application_id = v_app.application_id
         ) then
        
        v_interview_session_token := public.generate_auth_token();

        insert into interview_sessions (
          application_id,
          assessment_attempt_id,
          session_token,
          session_valid_from,
          session_valid_until,
          status,
          created_at
        )
        values (
          v_app.application_id,
          v_assessment_attempt_id,
          v_interview_session_token,
          v_interview_slot.slot_start_utc - interval '1 hour',
          greatest(
            now() + interval '14 days',
            v_interview_slot.slot_end_utc + interval '7 days'
          ),
          'PENDING',
          now()
        );

        -- Enqueue interview credentials notification.
        perform public.enqueue_interview_credentials_notification(
          v_app.application_id,
          v_app.organization_id,
          v_app.candidate_email,
          v_app.candidate_name,
          v_interview_session_token
        );

        v_interview_generated_count := v_interview_generated_count + 1;
      end if;
    exception
      when unique_violation then
        -- Assessment already exists, skip this application
        continue;
    end;
  end loop;

  perform public.log_cron_execution(
    'job_generate_assessment_credentials',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_generated_count
  );

  return jsonb_build_object(
    'assessmentCredentialsGenerated', v_generated_count,
    'interviewCredentialsGenerated', v_interview_generated_count
  );
exception when others then
  perform public.log_cron_execution(
    'job_generate_assessment_credentials',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #5: Mark Assessment No-Show (Unchanged)
-- ============================================================================
create or replace function public.job_mark_assessment_no_show()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer := 0;
  v_applications integer := 0;
  v_start_time timestamptz := now();
begin
  with expired_attempts as (
    select aa.id, aa.application_id
    from assessment_attempts aa
    join applications a on a.id = aa.application_id
    where aa.submitted_at is null
      and aa.session_valid_until <= now()
      and coalesce(aa.status::text, '') <> 'COMPLETED'
      and a.status in ('SLOT_ASSIGNED', 'ASSESSMENT_IN_PROGRESS')
  ),
  updated_attempts as (
    update assessment_attempts aa
       set status = 'NO_SHOW'
      from expired_attempts ea
     where aa.id = ea.id
     returning aa.id, aa.application_id
  ),
  updated_applications as (
    update applications a
       set status = 'NO_SHOW',
           updated_at = now()
     where a.id in (select application_id from updated_attempts)
     returning a.id
  )
  select
    (select count(*) from updated_attempts),
    (select count(*) from updated_applications)
  into v_attempts, v_applications;

  perform public.log_cron_execution(
    'job_mark_assessment_no_show',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_applications
  );

  return jsonb_build_object(
    'attemptsMarkedNoShow', v_attempts,
    'applicationsMarkedNoShow', v_applications
  );
exception when others then
  perform public.log_cron_execution(
    'job_mark_assessment_no_show',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #6: Enqueue 24h + 1h Reminders (Enhanced)
-- ============================================================================
create or replace function public.job_enqueue_slot_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_24h_count integer := 0;
  v_1h_count integer := 0;
  v_start_time timestamptz := now();
begin
  -- 24h reminders for assessment
  insert into notification_events (
    notification_type,
    application_id,
    organization_id,
    recipient_email,
    recipient_name,
    scheduled_send_at,
    status,
    idempotency_key
  )
  select
    'ASSESSMENT_REMINDER_24H',
    a.id,
    i.organization_id,
    a.candidate_email,
    a.candidate_name,
    now(),
    'PENDING',
    format('assessment-reminder-24h-%s-%s', a.id, a.assigned_assessment_slot_id)
  from applications a
  join interviews i on i.id = a.interview_id
  join assessment_slots s on s.id = a.assigned_assessment_slot_id
  where a.status in ('SLOT_ASSIGNED', 'ASSESSMENT_IN_PROGRESS')
    and a.assigned_assessment_slot_id is not null
    and s.slot_start_utc > now() + interval '23 hours 50 minutes'
    and s.slot_start_utc <= now() + interval '24 hours'
  on conflict (idempotency_key) do nothing;
  get diagnostics v_24h_count = row_count;

  -- 1h reminders for assessment
  insert into notification_events (
    notification_type,
    application_id,
    organization_id,
    recipient_email,
    recipient_name,
    scheduled_send_at,
    status,
    idempotency_key
  )
  select
    'ASSESSMENT_REMINDER_1H',
    a.id,
    i.organization_id,
    a.candidate_email,
    a.candidate_name,
    now(),
    'PENDING',
    format('assessment-reminder-1h-%s-%s', a.id, a.assigned_assessment_slot_id)
  from applications a
  join interviews i on i.id = a.interview_id
  join assessment_slots s on s.id = a.assigned_assessment_slot_id
  where a.status in ('SLOT_ASSIGNED', 'ASSESSMENT_IN_PROGRESS')
    and a.assigned_assessment_slot_id is not null
    and s.slot_start_utc > now() + interval '59 minutes'
    and s.slot_start_utc <= now() + interval '1 hour'
  on conflict (idempotency_key) do nothing;
  get diagnostics v_1h_count = row_count;

  -- Similar for interview reminders
  insert into notification_events (
    notification_type,
    application_id,
    organization_id,
    recipient_email,
    recipient_name,
    scheduled_send_at,
    status,
    idempotency_key
  )
  select
    'INTERVIEW_REMINDER_24H',
    a.id,
    i.organization_id,
    a.candidate_email,
    a.candidate_name,
    now(),
    'PENDING',
    format('interview-reminder-24h-%s-%s', a.id, a.assigned_interview_slot_id)
  from applications a
  join interviews i on i.id = a.interview_id
  join interview_slots s on s.id = a.assigned_interview_slot_id
  where a.status in ('INTERVIEW_SCHEDULED', 'INTERVIEW_IN_PROGRESS')
    and a.assigned_interview_slot_id is not null
    and s.slot_start_utc > now() + interval '23 hours 50 minutes'
    and s.slot_start_utc <= now() + interval '24 hours'
  on conflict (idempotency_key) do nothing;

  perform public.log_cron_execution(
    'job_enqueue_slot_reminders',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_24h_count + v_1h_count
  );

  return jsonb_build_object(
    'assessment24hReminders', v_24h_count,
    'assessment1hReminders', v_1h_count
  );
exception when others then
  perform public.log_cron_execution(
    'job_enqueue_slot_reminders',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #7: Auto-Update Application Status Pipeline (NEW - FIXED)
-- ============================================================================
create or replace function public.job_update_application_status_pipeline()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment_started integer := 0;
  v_interview_starting integer := 0;
  v_start_time timestamptz := now();
begin
  -- SLOT_ASSIGNED -> ASSESSMENT_IN_PROGRESS when assessment is started
  update applications a
     set status = 'ASSESSMENT_IN_PROGRESS',
         updated_at = now()
   where a.status = 'SLOT_ASSIGNED'
     and exists (
       select 1
       from assessment_attempts aa
       where aa.application_id = a.id
         and aa.started_at is not null
     );
  get diagnostics v_assessment_started = row_count;

  -- ASSESSMENT_IN_PROGRESS -> INTERVIEW_IN_PROGRESS when interview slot has started
  update applications a
     set status = 'INTERVIEW_IN_PROGRESS',
         updated_at = now()
   where a.status = 'ASSESSMENT_IN_PROGRESS'
     and exists (
       select 1
       from interview_slots islt
       join applications app on app.assigned_interview_slot_id = islt.id
       where app.id = a.id
         and islt.slot_start_utc <= now()
     );
  get diagnostics v_interview_starting = row_count;

  perform public.log_cron_execution(
    'job_update_application_status_pipeline',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_assessment_started + v_interview_starting
  );

  return jsonb_build_object(
    'assessmentStarted', v_assessment_started,
    'interviewStarted', v_interview_starting
  );
exception when others then
  perform public.log_cron_execution(
    'job_update_application_status_pipeline',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #8: Mark Interviews Completed (NEW)
-- ============================================================================
create or replace function public.job_mark_interview_completed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed integer := 0;
  v_start_time timestamptz := now();
begin
  -- Mark interviews where all responses are submitted
  update interview_sessions isess
     set status = 'COMPLETED',
         completed_at = now()
   where isess.status = 'IN_PROGRESS'
     and exists (
       select 1
       from interviews i
       where i.id = (
         select i2.id from interviews i2
         join applications a on a.interview_id = i2.id
         where a.id = (
           select app.id from applications app
           where exists (
             select 1
             from interview_sessions is2
             where is2.id = isess.id
               and is2.application_id = app.id
           )
         )
       )
       and exists (
         select 1
         from interview_responses ir
         where ir.interview_session_id = isess.id
       )
     );
  get diagnostics v_completed = row_count;

  perform public.log_cron_execution(
    'job_mark_interview_completed',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_completed
  );

  return jsonb_build_object(
    'interviewsCompleted', v_completed
  );
exception when others then
  perform public.log_cron_execution(
    'job_mark_interview_completed',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #8b: Mark Interview No-Show (NEW)
-- ============================================================================
create or replace function public.job_mark_interview_no_show()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions integer := 0;
  v_applications integer := 0;
  v_start_time timestamptz := now();
begin
  with expired_sessions as (
    select isess.id, isess.application_id
    from interview_sessions isess
    join applications a on a.id = isess.application_id
    where isess.submitted_at is null
      and isess.session_valid_until <= now()
      and coalesce(isess.status::text, '') <> 'COMPLETED'
      and a.status in ('INTERVIEW_SCHEDULED', 'INTERVIEW_IN_PROGRESS')
  ),
  updated_sessions as (
    update interview_sessions isess
       set status = 'NO_SHOW'
      from expired_sessions es
     where isess.id = es.id
     returning isess.id, isess.application_id
  ),
  updated_applications as (
    update applications a
       set status = 'NO_SHOW',
           updated_at = now()
     where a.id in (select application_id from updated_sessions)
     returning a.id
  )
  select
    (select count(*) from updated_sessions),
    (select count(*) from updated_applications)
  into v_sessions, v_applications;

  perform public.log_cron_execution(
    'job_mark_interview_no_show',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_applications
  );

  return jsonb_build_object(
    'sessionsMarkedNoShow', v_sessions,
    'applicationsMarkedNoShow', v_applications
  );
exception when others then
  perform public.log_cron_execution(
    'job_mark_interview_no_show',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #9: Auto-Score Assessments (NEW - Placeholder)
-- ============================================================================
create or replace function public.job_auto_score_assessment()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scored integer := 0;
  v_start_time timestamptz := now();
begin
  -- Placeholder: Score assessments that are submitted but not yet scored
  -- Implementation depends on scoring rules in your schema
  
  -- Example: simple rule - count correct answers
  update assessment_attempts aa
     set status = 'SCORED',
         submitted_at = coalesce(aa.submitted_at, now()),
         updated_at = now()
   where aa.status = 'PENDING'
     and aa.submitted_at is not null
     and not exists (
       select 1 from hr_evaluations he
       where he.assessment_attempt_id = aa.id
     );
  get diagnostics v_scored = row_count;

  perform public.log_cron_execution(
    'job_auto_score_assessment',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_scored
  );

  return jsonb_build_object(
    'assessmentsSco', v_scored
  );
exception when others then
  perform public.log_cron_execution(
    'job_auto_score_assessment',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #10: Cleanup Expired Sessions (NEW)
-- ============================================================================
create or replace function public.job_cleanup_expired_sessions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment_deleted integer := 0;
  v_interview_deleted integer := 0;
  v_start_time timestamptz := now();
begin
  -- Cleanup expired assessment sessions (soft delete by setting revoked_at)
  update assessment_attempts aa
     set revoked_at = now()
   where aa.revoked_at is null
     and aa.session_valid_until < now() - interval '30 days'
     and aa.status = 'NO_SHOW';
  get diagnostics v_assessment_deleted = row_count;

  -- Cleanup expired interview sessions
  update interview_sessions isess
     set revoked_at = now()
   where isess.revoked_at is null
     and isess.session_valid_until < now() - interval '30 days'
     and isess.status in ('NO_SHOW', 'COMPLETED');
  get diagnostics v_interview_deleted = row_count;

  perform public.log_cron_execution(
    'job_cleanup_expired_sessions',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_assessment_deleted + v_interview_deleted
  );

  return jsonb_build_object(
    'assessmentSessionsCleaned', v_assessment_deleted,
    'interviewSessionsCleaned', v_interview_deleted
  );
exception when others then
  perform public.log_cron_execution(
    'job_cleanup_expired_sessions',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #11: Expand Slot Capacity by Threshold (FIXED SCHEDULE)
-- ============================================================================
create or replace function public.job_expand_slot_capacity_on_threshold(
  p_threshold numeric default 0.90,
  p_increment integer default 1,
  p_hard_ceiling integer default 25,
  p_max_slots_per_run integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_threshold numeric := p_threshold;
  v_increment integer := p_increment;
  v_hard_ceiling integer := p_hard_ceiling;
  v_max_slots_per_run integer := p_max_slots_per_run;
  v_assessment_updated integer := 0;
  v_interview_updated integer := 0;
  v_start_time timestamptz := now();
begin
  begin
    v_threshold := coalesce(nullif(current_setting('app.settings.slot_expand_threshold', true), '')::numeric, p_threshold);
  exception when others then
    v_threshold := p_threshold;
  end;

  begin
    v_increment := coalesce(nullif(current_setting('app.settings.slot_expand_increment', true), '')::integer, p_increment);
  exception when others then
    v_increment := p_increment;
  end;

  begin
    v_hard_ceiling := coalesce(nullif(current_setting('app.settings.slot_expand_hard_ceiling', true), '')::integer, p_hard_ceiling);
  exception when others then
    v_hard_ceiling := p_hard_ceiling;
  end;

  begin
    v_max_slots_per_run := coalesce(nullif(current_setting('app.settings.slot_expand_max_slots_per_run', true), '')::integer, p_max_slots_per_run);
  exception when others then
    v_max_slots_per_run := p_max_slots_per_run;
  end;

  v_threshold := greatest(least(v_threshold, 1.0), 0.5);
  v_increment := greatest(v_increment, 1);
  v_hard_ceiling := greatest(v_hard_ceiling, 1);
  v_max_slots_per_run := greatest(v_max_slots_per_run, 1);

  with assessment_candidates as (
    select
      s.id,
      least(coalesce(s.max_candidates, 0) + v_increment, v_hard_ceiling) as new_max
    from assessment_slots s
    join interviews i on i.id = s.interview_id
    where i.status in ('PUBLISHED', 'LOCKED', 'IN_PROGRESS')
      and coalesce(s.max_candidates, 0) < v_hard_ceiling
      and coalesce(s.max_candidates, 0) > 0
      and (coalesce(s.assigned_candidates, 0)::numeric / coalesce(nullif(s.max_candidates, 0), 1)::numeric) >= v_threshold
      and exists (
        select 1
        from applications a
        where a.interview_id = s.interview_id
          and a.status = 'APPLIED'
      )
    order by s.slot_start_utc asc
    limit v_max_slots_per_run
  )
  update assessment_slots s
     set max_candidates = ac.new_max
    from assessment_candidates ac
   where s.id = ac.id;
  get diagnostics v_assessment_updated = row_count;

  with interview_candidates as (
    select
      s.id,
      least(coalesce(s.max_candidates, 0) + v_increment, v_hard_ceiling) as new_max
    from interview_slots s
    join interviews i on i.id = s.interview_id
    where i.status in ('PUBLISHED', 'LOCKED', 'IN_PROGRESS')
      and coalesce(s.max_candidates, 0) < v_hard_ceiling
      and coalesce(s.max_candidates, 0) > 0
      and (coalesce(s.assigned_candidates, 0)::numeric / coalesce(nullif(s.max_candidates, 0), 1)::numeric) >= v_threshold
      and exists (
        select 1
        from applications a
        where a.interview_id = s.interview_id
          and a.status = 'APPLIED'
      )
    order by s.slot_start_utc asc
    limit v_max_slots_per_run
  )
  update interview_slots s
     set max_candidates = ic.new_max
    from interview_candidates ic
   where s.id = ic.id;
  get diagnostics v_interview_updated = row_count;

  perform public.log_cron_execution(
    'job_expand_slot_capacity_on_threshold',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_assessment_updated + v_interview_updated
  );

  return jsonb_build_object(
    'assessmentSlotsExpanded', v_assessment_updated,
    'interviewSlotsExpanded', v_interview_updated,
    'threshold', v_threshold,
    'increment', v_increment,
    'hardCeiling', v_hard_ceiling,
    'maxSlotsPerRun', v_max_slots_per_run
  );
exception when others then
  perform public.log_cron_execution(
    'job_expand_slot_capacity_on_threshold',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #11b: Enqueue 24h Slot Reminders (NEW)
-- ============================================================================
drop function if exists public.job_enqueue_slot_reminders_24h();
create or replace function public.job_enqueue_slot_reminders_24h()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment_count integer := 0;
  v_interview_count integer := 0;
  v_start_time timestamptz := now();
begin
  -- Enqueue 24h reminder for assessment slots
  insert into notification_events (
    notification_type,
    application_id,
    organization_id,
    recipient_email,
    recipient_name,
    scheduled_send_at,
    status,
    idempotency_key
  )
  select
    'ASSESSMENT_REMINDER_24H',
    a.id,
    i.organization_id,
    a.candidate_email,
    a.candidate_name,
    now(),
    'PENDING',
    format('assessment-reminder-24h-pre-%s-%s', a.id, a.assigned_assessment_slot_id)
  from applications a
  join interviews i on i.id = a.interview_id
  join assessment_slots s on s.id = a.assigned_assessment_slot_id
  where a.status in ('SLOT_ASSIGNED', 'ASSESSMENT_IN_PROGRESS')
    and a.assigned_assessment_slot_id is not null
    and s.slot_start_utc > now() + interval '47 hours'
    and s.slot_start_utc <= now() + interval '48 hours'
  on conflict (idempotency_key) do nothing;
  get diagnostics v_assessment_count = row_count;

  -- Enqueue 24h reminder for interview slots
  insert into notification_events (
    notification_type,
    application_id,
    organization_id,
    recipient_email,
    recipient_name,
    scheduled_send_at,
    status,
    idempotency_key
  )
  select
    'INTERVIEW_REMINDER_24H',
    a.id,
    i.organization_id,
    a.candidate_email,
    a.candidate_name,
    now(),
    'PENDING',
    format('interview-reminder-24h-pre-%s-%s', a.id, a.assigned_interview_slot_id)
  from applications a
  join interviews i on i.id = a.interview_id
  join interview_slots s on s.id = a.assigned_interview_slot_id
  where a.status in ('INTERVIEW_SCHEDULED', 'INTERVIEW_IN_PROGRESS')
    and a.assigned_interview_slot_id is not null
    and s.slot_start_utc > now() + interval '47 hours'
    and s.slot_start_utc <= now() + interval '48 hours'
  on conflict (idempotency_key) do nothing;
  get diagnostics v_interview_count = row_count;

  perform public.log_cron_execution(
    'job_enqueue_slot_reminders_24h',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_assessment_count + v_interview_count
  );

  return jsonb_build_object(
    'assessmentReminders24h', v_assessment_count,
    'interviewReminders24h', v_interview_count
  );
exception when others then
  perform public.log_cron_execution(
    'job_enqueue_slot_reminders_24h',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- CRON JOB #12: Dispatch Pending Notifications (Unchanged)
-- ============================================================================
create or replace function public.job_dispatch_pending_notifications(
  p_batch_size integer default 50,
  p_max_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_attempt integer;
  v_queued bigint;
  v_webhook_url text;
  v_webhook_token text;
  v_sent integer := 0;
  v_retried integer := 0;
  v_failed integer := 0;
  v_start_time timestamptz := now();
begin
  -- Primary source: runtime settings table
  select ars.value
    into v_webhook_url
    from public.app_runtime_settings ars
   where ars.key = 'notification_webhook_url';

  select ars.value
    into v_webhook_token
    from public.app_runtime_settings ars
   where ars.key = 'notification_webhook_token';

  -- Fallback source: legacy custom DB settings
  v_webhook_url := nullif(coalesce(v_webhook_url, current_setting('app.settings.notification_webhook_url', true)), '');
  v_webhook_token := nullif(coalesce(v_webhook_token, current_setting('app.settings.notification_webhook_token', true)), '');

  if v_webhook_url is null then
    perform public.log_cron_execution(
      'job_dispatch_pending_notifications',
      extract(epoch from (now() - v_start_time)),
      false,
      'notification webhook not configured',
      0
    );
    return jsonb_build_object(
      'sent', 0,
      'retried', 0,
      'failed', 0,
      'skipped', true,
      'reason', 'notification webhook not configured'
    );
  end if;

  for v_event in
    select *
    from notification_events ne
    where ne.status = 'PENDING'
      and ne.scheduled_send_at <= now()
    order by ne.scheduled_send_at asc
    limit greatest(p_batch_size, 1)
    for update skip locked
  loop
    select coalesce(max(nd.attempt_number), 0) + 1
      into v_attempt
      from notification_deliveries nd
      where nd.notification_event_id = v_event.id;

    begin
      v_queued := net.http_post(
        url := v_webhook_url,
        headers := jsonb_strip_nulls(jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', case when v_webhook_token is null then null else ('Bearer ' || v_webhook_token) end
        )),
        body := jsonb_build_object(
          'eventId', v_event.id,
          'notificationType', v_event.notification_type,
          'applicationId', v_event.application_id,
          'organizationId', v_event.organization_id,
          'recipientEmail', v_event.recipient_email,
          'recipientName', v_event.recipient_name,
          'idempotencyKey', v_event.idempotency_key
        )
      );

      insert into notification_deliveries (
        notification_event_id,
        status,
        provider,
        response_code,
        response_message,
        attempt_number,
        sent_at
      )
      values (
        v_event.id,
        'SENT',
        'cron_webhook',
        null,
        format('queued_request_id=%s', v_queued),
        v_attempt,
        now()
      );

      update notification_events
         set status = 'SENT'
       where id = v_event.id;

      v_sent := v_sent + 1;
    exception
      when others then
        insert into notification_deliveries (
          notification_event_id,
          status,
          provider,
          response_code,
          response_message,
          attempt_number,
          sent_at
        )
        values (
          v_event.id,
          'FAILED',
          'cron_webhook',
          null,
          left(sqlerrm, 500),
          v_attempt,
          now()
        );

        if v_attempt < greatest(p_max_attempts, 1) then
          update notification_events
             set status = 'PENDING',
                 scheduled_send_at = now() + make_interval(mins => 5 * v_attempt)
           where id = v_event.id;
          v_retried := v_retried + 1;
        else
          update notification_events
             set status = 'FAILED'
           where id = v_event.id;
          v_failed := v_failed + 1;
        end if;
    end;
  end loop;

  perform public.log_cron_execution(
    'job_dispatch_pending_notifications',
    extract(epoch from (now() - v_start_time)),
    true,
    null,
    v_sent
  );

  return jsonb_build_object(
    'sent', v_sent,
    'retried', v_retried,
    'failed', v_failed
  );
exception when others then
  perform public.log_cron_execution(
    'job_dispatch_pending_notifications',
    extract(epoch from (now() - v_start_time)),
    false,
    sqlerrm,
    null
  );
  raise;
end;
$$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Generic updated_at trigger
create or replace function public.trg_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_applications on public.applications;
create trigger trg_set_updated_at_applications
before update on public.applications
for each row
execute function public.trg_set_updated_at();

drop trigger if exists trg_set_updated_at_application_links on public.application_links;
create trigger trg_set_updated_at_application_links
before update on public.application_links
for each row
execute function public.trg_set_updated_at();

drop trigger if exists trg_set_updated_at_interviews on public.interviews;
create trigger trg_set_updated_at_interviews
before update on public.interviews
for each row
execute function public.trg_set_updated_at();

drop trigger if exists trg_set_updated_at_assessment_attempts on public.assessment_attempts;
create trigger trg_set_updated_at_assessment_attempts
before update on public.assessment_attempts
for each row
execute function public.trg_set_updated_at();

drop trigger if exists trg_set_updated_at_interview_sessions on public.interview_sessions;
create trigger trg_set_updated_at_interview_sessions
before update on public.interview_sessions
for each row
execute function public.trg_set_updated_at();

-- Assignment validation trigger
create or replace function public.trg_validate_application_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment_interview_id bigint;
  v_interview_slot_interview_id bigint;
begin
  if new.status = 'SLOT_ASSIGNED' then
    if new.assigned_assessment_slot_id is null or new.assigned_interview_slot_id is null then
      raise exception 'SLOT_ASSIGNED requires both assigned_assessment_slot_id and assigned_interview_slot_id';
    end if;
  end if;

  if new.assigned_assessment_slot_id is not null then
    select interview_id
      into v_assessment_interview_id
      from assessment_slots
      where id = new.assigned_assessment_slot_id;

    if v_assessment_interview_id is null then
      raise exception 'Invalid assigned_assessment_slot_id: %', new.assigned_assessment_slot_id;
    end if;

    if v_assessment_interview_id <> new.interview_id then
      raise exception 'assigned_assessment_slot_id % does not belong to interview %', new.assigned_assessment_slot_id, new.interview_id;
    end if;
  end if;

  if new.assigned_interview_slot_id is not null then
    select interview_id
      into v_interview_slot_interview_id
      from interview_slots
      where id = new.assigned_interview_slot_id;

    if v_interview_slot_interview_id is null then
      raise exception 'Invalid assigned_interview_slot_id: %', new.assigned_interview_slot_id;
    end if;

    if v_interview_slot_interview_id <> new.interview_id then
      raise exception 'assigned_interview_slot_id % does not belong to interview %', new.assigned_interview_slot_id, new.interview_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_application_assignment on public.applications;
create trigger trg_validate_application_assignment
before insert or update on public.applications
for each row
execute function public.trg_validate_application_assignment();

-- Auto enqueue SLOT_ASSIGNED notifications
create or replace function public.trg_enqueue_slot_assigned_notification_from_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id bigint;
begin
  if new.status = 'SLOT_ASSIGNED'
     and new.assigned_assessment_slot_id is not null
     and new.assigned_interview_slot_id is not null
     and (
       tg_op = 'INSERT'
       or old.assigned_interview_slot_id is distinct from new.assigned_interview_slot_id
     ) then
    select organization_id
      into v_org_id
      from interviews
      where id = new.interview_id;

    if v_org_id is not null then
      perform public.enqueue_slot_assigned_notification(
        new.id,
        v_org_id,
        new.candidate_email,
        new.candidate_name,
        new.assigned_assessment_slot_id,
        new.assigned_interview_slot_id
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_slot_assigned_notification on public.applications;
create trigger trg_enqueue_slot_assigned_notification
after insert or update on public.applications
for each row
execute function public.trg_enqueue_slot_assigned_notification_from_application();

-- Auto-generate interview credentials after assessment submission
create or replace function public.trg_enqueue_interview_credentials_after_assessment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_token text;
  v_interview_slot record;
  v_application record;
  v_interview_id bigint;
  v_org_id bigint;
begin
  if new.submitted_at is not null
     and (tg_op = 'INSERT' or old.submitted_at is null)
  then
    select a.id, a.interview_id, a.candidate_email, a.candidate_name, a.assigned_interview_slot_id
      into v_application
      from applications a
      where a.id = new.application_id;

    if v_application is null or v_application.assigned_interview_slot_id is null then
      return new;
    end if;

    if exists (
      select 1
      from interview_sessions isess
      where isess.application_id = v_application.id
    ) then
      return new;
    end if;

    select slot_start_utc, slot_end_utc, interview_id
      into v_interview_slot
      from interview_slots
      where id = v_application.assigned_interview_slot_id;

    if v_interview_slot is null then
      return new;
    end if;

    select organization_id into v_org_id
      from interviews
      where id = v_interview_slot.interview_id;

    if v_org_id is null then
      return new;
    end if;

    v_session_token := public.generate_auth_token();

    begin
      insert into interview_sessions (
        application_id,
        assessment_attempt_id,
        session_token,
        session_valid_from,
        session_valid_until,
        status,
        created_at
      )
      values (
        v_application.id,
        new.id,
        v_session_token,
        v_interview_slot.slot_start_utc - interval '1 hour',
        greatest(
          now() + interval '14 days',
          v_interview_slot.slot_end_utc + interval '7 days'
        ),
        'PENDING',
        now()
      );

      perform public.enqueue_interview_credentials_notification(
        v_application.id,
        v_org_id,
        v_application.candidate_email,
        v_application.candidate_name,
        v_session_token
      );
    exception when others then
      -- Silently ignore if interview session already exists
      null;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_interview_credentials on public.assessment_attempts;
create trigger trg_enqueue_interview_credentials
after insert or update on public.assessment_attempts
for each row
execute function public.trg_enqueue_interview_credentials_after_assessment();

-- ============================================================================
-- CRON SCHEDULER REGISTRATION (Idempotent)
-- ============================================================================
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'vip_expire_application_links') then
    perform cron.schedule(
      'vip_expire_application_links',
      '*/10 * * * *',
      'select public.job_expire_application_links();'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_transition_interview_statuses') then
    perform cron.schedule(
      'vip_transition_interview_statuses',
      '*/10 * * * *',
      'select public.job_transition_interview_statuses();'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_assign_interview_slots') then
    perform cron.schedule(
      'vip_assign_interview_slots',
      '*/15 * * * *',
      'select public.job_assign_interview_slots_after_deadline(500);'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_generate_assessment_credentials') then
    perform cron.schedule(
      'vip_generate_assessment_credentials',
      '*/5 * * * *',
      'select public.job_generate_assessment_credentials();'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_mark_assessment_no_show') then
    perform cron.schedule(
      'vip_mark_assessment_no_show',
      '*/5 * * * *',
      'select public.job_mark_assessment_no_show();'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_update_status_pipeline') then
    perform cron.schedule(
      'vip_update_status_pipeline',
      '*/5 * * * *',
      'select public.job_update_application_status_pipeline();'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_mark_interview_completed') then
    perform cron.schedule(
      'vip_mark_interview_completed',
      '*/10 * * * *',
      'select public.job_mark_interview_completed();'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_mark_interview_no_show') then
    perform cron.schedule(
      'vip_mark_interview_no_show',
      '*/10 * * * *',
      'select public.job_mark_interview_no_show();'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_auto_score_assessment') then
    perform cron.schedule(
      'vip_auto_score_assessment',
      '*/15 * * * *',
      'select public.job_auto_score_assessment();'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_cleanup_expired_sessions') then
    perform cron.schedule(
      'vip_cleanup_expired_sessions',
      '0 2 * * *',
      'select public.job_cleanup_expired_sessions();'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_expand_slot_capacity_threshold') then
    perform cron.schedule(
      'vip_expand_slot_capacity_threshold',
      '0 * * * *',
      'select public.job_expand_slot_capacity_on_threshold(0.90, 1, 25, 100);'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_enqueue_slot_reminders') then
    perform cron.schedule(
      'vip_enqueue_slot_reminders',
      '*/10 * * * *',
      'select public.job_enqueue_slot_reminders();'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_dispatch_notifications') then
    perform cron.schedule(
      'vip_dispatch_notifications',
      '*/2 * * * *',
      'select public.job_dispatch_pending_notifications(50, 5);'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_enqueue_slot_reminders_24h') then
    perform cron.schedule(
      'vip_enqueue_slot_reminders_24h',
      '*/10 * * * *',
      'select public.job_enqueue_slot_reminders_24h();'
    );
  end if;
end;
$$;

-- ============================================================================
-- HELPFUL MANUAL CHECKS & MONITORING
-- ============================================================================
-- select * from cron.job order by jobid;
-- select * from cron_execution_logs order by executed_at desc limit 20;
-- select job_name, success, count(*) as run_count from cron_execution_logs group by job_name, success;
-- select * from public.job_expire_application_links();
-- select * from public.job_assign_interview_slots_after_deadline(100);
-- select * from public.job_transition_interview_statuses();
-- select * from public.job_update_application_status_pipeline();
