-- ============================================================================
-- SUPABASE CRON AUTOMATION PACK
-- ============================================================================
-- Purpose:
-- 1) Expire application links automatically
-- 2) Transition interview statuses by time windows
-- 3) Assign candidates to interview slots after application window closes
-- 4) Generate assessment login credentials (one-time tokens) for assigned candidates
-- 5) Enqueue slot assignment/reminder/credentials notifications
-- 6) Auto-generate interview login credentials after assessment submission
-- 7) Dispatch notification events via webhook
-- 8) Expand slot capacity by threshold with hard ceiling
--
-- Run this script in Supabase SQL Editor as a privileged role.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

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

-- Helper: queue assessment credentials notification (one-time login token for assessment).
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

-- Helper: queue interview credentials notification (one-time login token for interview).
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

-- 1) Deactivate expired application links.
create or replace function public.job_expire_application_links()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  update application_links
     set is_active = false,
         updated_at = now()
   where is_active = true
     and valid_until <= now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- 2) Transition interview lifecycle statuses.
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

  -- LOCKED/PUBLISHED -> IN_PROGRESS when any interview slot has started.
  update interviews i
     set status = 'IN_PROGRESS',
         updated_at = now()
   where i.status in ('PUBLISHED', 'LOCKED')
     and exists (
       select 1
       from interview_slots s
       where s.interview_id = i.id
         and s.slot_start_utc <= now()
         and s.slot_end_utc > now()
     );
  get diagnostics v_in_progress = row_count;

  -- Any active state -> CLOSED when all interview slots have ended.
  update interviews i
     set status = 'CLOSED',
         updated_at = now()
   where i.status in ('PUBLISHED', 'LOCKED', 'IN_PROGRESS')
     and exists (
       select 1 from interview_slots s where s.interview_id = i.id
     )
     and not exists (
       select 1
       from interview_slots s
       where s.interview_id = i.id
         and s.slot_end_utc > now()
     );
  get diagnostics v_closed = row_count;

  return jsonb_build_object(
    'locked', v_locked,
    'inProgress', v_in_progress,
    'closed', v_closed
  );
end;
$$;

-- 3) Assign assessment + interview slots after application window closes.
-- Algorithm:
-- - Deferred-acceptance style, by preference rounds (1 -> 2 -> 3) with slot capacities.
-- - Deterministic priority: earlier application created_at first.
-- - Fallback fills remaining unmatched candidates into earliest available slots.
-- - Final commit is atomic per candidate: both assessment and interview slot must exist.
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
begin
  create temporary table if not exists tmp_slot_candidates (
    application_id bigint primary key,
    interview_id bigint not null,
    organization_id bigint not null,
    candidate_email text not null,
    candidate_name text,
    created_at TIMESTAMPTZ not null,
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

    -- ===== ASSESSMENT MATCHING: preference rounds 1..3 =====
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
          asp.preferred_assessment_slot_id as slot_id,
          row_number() over (
            partition by asp.preferred_assessment_slot_id
            order by t.created_at asc, t.application_id asc
          ) as within_slot_rank
        from tmp_slot_candidates t
        join application_slot_preferences asp
          on asp.application_id = t.application_id
         and asp.slot_type = 'assessment'
         and asp.preference_rank = v_round
         and asp.preferred_assessment_slot_id is not null
        where t.assigned_assessment_slot_id is null
      ),
      winners as (
        select rp.application_id, rp.slot_id
        from ranked_proposals rp
        join assessment_capacity ac on ac.slot_id = rp.slot_id
        where ac.remaining > 0
          and rp.within_slot_rank <= ac.remaining
      )
      update tmp_slot_candidates t
         set assigned_assessment_slot_id = w.slot_id
        from winners w
       where t.application_id = w.application_id
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
          order by ac.slot_start_utc asc, ac.slot_id asc, gs.seat_no asc
        ) as seat_rank
      from assessment_capacity ac
      join lateral generate_series(1, ac.remaining) as gs(seat_no) on true
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

    -- ===== INTERVIEW MATCHING: preference rounds 1..3 =====
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
          asp.preferred_interview_slot_id as slot_id,
          row_number() over (
            partition by asp.preferred_interview_slot_id
            order by t.created_at asc, t.application_id asc
          ) as within_slot_rank
        from tmp_slot_candidates t
        join application_slot_preferences asp
          on asp.application_id = t.application_id
         and asp.slot_type = 'interview'
         and asp.preference_rank = v_round
         and asp.preferred_interview_slot_id is not null
        where t.assigned_interview_slot_id is null
      ),
      winners as (
        select rp.application_id, rp.slot_id
        from ranked_proposals rp
        join interview_capacity ic on ic.slot_id = rp.slot_id
        where ic.remaining > 0
          and rp.within_slot_rank <= ic.remaining
      )
      update tmp_slot_candidates t
         set assigned_interview_slot_id = w.slot_id
        from winners w
       where t.application_id = w.application_id
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
          order by ic.slot_start_utc asc, ic.slot_id asc, gs.seat_no asc
        ) as seat_rank
      from interview_capacity ic
      join lateral generate_series(1, ic.remaining) as gs(seat_no) on true
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
           assessment_slot_assigned_at = now(),
           interview_slot_assigned_at = now(),
           status = 'SLOT_ASSIGNED',
           updated_at = now()
      from finalized f
     where a.id = f.application_id;

    get diagnostics v_finalized_count = row_count;
    v_assigned_count := v_assigned_count + v_finalized_count;

    -- Increment used counts only for finalized applications.
    update assessment_slots s
       set assigned_candidates = coalesce(s.assigned_candidates, 0) + c.candidate_count
      from (
        select assigned_assessment_slot_id as slot_id, count(*) as candidate_count
        from tmp_slot_candidates
        where assigned_assessment_slot_id is not null
          and assigned_interview_slot_id is not null
        group by assigned_assessment_slot_id
      ) c
     where s.id = c.slot_id;

    update interview_slots s
       set assigned_candidates = coalesce(s.assigned_candidates, 0) + c.candidate_count
      from (
        select assigned_interview_slot_id as slot_id, count(*) as candidate_count
        from tmp_slot_candidates
        where assigned_assessment_slot_id is not null
          and assigned_interview_slot_id is not null
        group by assigned_interview_slot_id
      ) c
     where s.id = c.slot_id;

    -- Queue assignment emails for finalized applications.
    for v_app in
      select
        application_id,
        organization_id,
        candidate_email,
        candidate_name,
        assigned_assessment_slot_id,
        assigned_interview_slot_id
      from tmp_slot_candidates
      where assigned_assessment_slot_id is not null
        and assigned_interview_slot_id is not null
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

  return jsonb_build_object(
    'processed', v_processed,
    'assigned', v_assigned_count,
    'unassigned', v_unassigned_count
  );
end;
$$;

-- 4) Generate assessment + interview login credentials and send immediately.
-- Creates assessment_attempts/interview_sessions with session_token and enqueues both emails.
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

    -- Generate unique session token.
    v_session_token := public.generate_auth_token();

    -- Create assessment attempt with token (not yet started), then enqueue credentials.
    begin
      insert into assessment_attempts (
        application_id,
        session_token,
        session_valid_from,
        session_valid_until,
        created_at
      )
      values (
        v_app.application_id,
        v_session_token,
        now(),
        v_assessment_slot.slot_start_utc,
        now()
      )
      returning id into v_assessment_attempt_id;

      -- Enqueue credentials notification with token.
      perform public.enqueue_assessment_credentials_notification(
        v_app.application_id,
        v_app.organization_id,
        v_app.candidate_email,
        v_app.candidate_name,
        v_session_token
      );

      -- Create interview session token immediately and enqueue interview credentials.
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
          created_at
        )
        values (
          v_app.application_id,
          v_assessment_attempt_id,
          v_interview_session_token,
          now(),
          v_interview_slot.slot_start_utc,
          now()
        );

        perform public.enqueue_interview_credentials_notification(
          v_app.application_id,
          v_app.organization_id,
          v_app.candidate_email,
          v_app.candidate_name,
          v_interview_session_token
        );

        v_interview_generated_count := v_interview_generated_count + 1;
      end if;

      v_generated_count := v_generated_count + 1;
    exception
      when unique_violation then
        -- Token collision (extremely rare), retry with new token.
        null;
    end;
  end loop;

  return jsonb_build_object(
    'assessmentCredentialsGenerated', v_generated_count,
    'interviewCredentialsGenerated', v_interview_generated_count
  );
end;
$$;

-- 4b) Mark expired unsubmitted assessments as NO_SHOW.
create or replace function public.job_mark_assessment_no_show()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer := 0;
  v_applications integer := 0;
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

  return jsonb_build_object(
    'attemptsMarkedNoShow', v_attempts,
    'applicationsMarkedNoShow', v_applications
  );
end;
$$;

-- 5) Enqueue 24h reminders for already-assigned candidates.
create or replace function public.job_enqueue_slot_reminders_24h()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
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
  where a.status = 'SLOT_ASSIGNED'
    and a.assigned_assessment_slot_id is not null
    and s.slot_start_utc > now() + interval '23 hours 50 minutes'
    and s.slot_start_utc <= now() + interval '24 hours'
  on conflict (idempotency_key) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- 5) Expand slot capacity by threshold with hard ceiling.
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

  return jsonb_build_object(
    'assessmentSlotsExpanded', v_assessment_updated,
    'interviewSlotsExpanded', v_interview_updated,
    'threshold', v_threshold,
    'increment', v_increment,
    'hardCeiling', v_hard_ceiling,
    'maxSlotsPerRun', v_max_slots_per_run
  );
end;
$$;

-- 6) Dispatch pending notifications via webhook.
-- Configure once in SQL editor:
-- alter database postgres set app.settings.notification_webhook_url = 'https://<project-ref>.functions.supabase.co/send-notification';
-- alter database postgres set app.settings.notification_webhook_token = '<edge-function-service-token>';
--
-- Optional capacity autoscaling settings:
-- alter database postgres set app.settings.slot_expand_threshold = '0.90';
-- alter database postgres set app.settings.slot_expand_increment = '1';
-- alter database postgres set app.settings.slot_expand_hard_ceiling = '25';
-- alter database postgres set app.settings.slot_expand_max_slots_per_run = '100';
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
begin
  -- Primary source: runtime settings table (works on managed Supabase roles).
  select ars.value
    into v_webhook_url
    from public.app_runtime_settings ars
   where ars.key = 'notification_webhook_url';

  select ars.value
    into v_webhook_token
    from public.app_runtime_settings ars
   where ars.key = 'notification_webhook_token';

  -- Fallback source: legacy custom DB settings if configured.
  v_webhook_url := nullif(coalesce(v_webhook_url, current_setting('app.settings.notification_webhook_url', true)), '');
  v_webhook_token := nullif(coalesce(v_webhook_token, current_setting('app.settings.notification_webhook_token', true)), '');

  if v_webhook_url is null then
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

  return jsonb_build_object(
    'sent', v_sent,
    'retried', v_retried,
    'failed', v_failed
  );
end;
$$;

-- 7) Trigger Pack: integrity + automatic notifications + updated_at maintenance.

-- Generic updated_at trigger for tables that expose updated_at.
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

drop trigger if exists trg_set_updated_at_jobs on public.jobs;
create trigger trg_set_updated_at_jobs
before update on public.jobs
for each row
execute function public.trg_set_updated_at();

drop trigger if exists trg_set_updated_at_organizations on public.organizations;
create trigger trg_set_updated_at_organizations
before update on public.organizations
for each row
execute function public.trg_set_updated_at();

drop trigger if exists trg_set_updated_at_users on public.users;
create trigger trg_set_updated_at_users
before update on public.users
for each row
execute function public.trg_set_updated_at();

drop trigger if exists trg_set_updated_at_hr_decisions on public.hr_decisions;
create trigger trg_set_updated_at_hr_decisions
before update on public.hr_decisions
for each row
execute function public.trg_set_updated_at();

-- Assignment validation trigger: keeps assessment/interview assignment consistent.
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
  -- If status is SLOT_ASSIGNED, both slot ids must be present.
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

-- Auto enqueue SLOT_ASSIGNED notifications when application transitions to SLOT_ASSIGNED.
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
       or old.status is distinct from new.status
       or old.assigned_assessment_slot_id is distinct from new.assigned_assessment_slot_id
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

-- Auto-generate interview session token and enqueue credentials after assessment submission.
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
  -- Only trigger when assessment is newly submitted.
  if new.submitted_at is not null
     and (tg_op = 'INSERT' or old.submitted_at is null)
  then
    -- Get application details for sending credentials email.
    select a.id, a.interview_id, a.candidate_email, a.candidate_name, a.assigned_interview_slot_id
      into v_application
      from applications a
      where a.id = new.application_id;

    if v_application is null or v_application.assigned_interview_slot_id is null then
      return new;
    end if;

    -- If interview session is already pre-generated, do not enqueue again.
    if exists (
      select 1
      from interview_sessions isess
      where isess.application_id = v_application.id
    ) then
      return new;
    end if;

    -- Get interview slot details for validity window.
    select slot_start_utc, slot_end_utc, interview_id
      into v_interview_slot
      from interview_slots
      where id = v_application.assigned_interview_slot_id;

    if v_interview_slot is null then
      return new;
    end if;

    -- Get organization for notification.
    select organization_id into v_org_id
      from interviews
      where id = v_interview_slot.interview_id;

    if v_org_id is null then
      return new;
    end if;

    -- Generate session token for interview.
    v_session_token := public.generate_auth_token();

    -- Create interview_sessions record with token (not yet started).
    begin
      insert into interview_sessions (
        application_id,
        assessment_attempt_id,
        session_token,
        session_valid_from,
        session_valid_until,
        created_at
      )
      values (
        v_application.id,
        new.id,
        v_session_token,
        now(),
        v_interview_slot.slot_start_utc,
        now()
      )
      on conflict do nothing;

      -- Enqueue interview credentials notification.
      perform public.enqueue_interview_credentials_notification(
        v_application.id,
        v_org_id,
        v_application.candidate_email,
        v_application.candidate_name,
        v_session_token
      );
    exception
      when others then
        -- Log but don't fail on notification issues.
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

-- Scheduler registration (idempotent).
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

  if not exists (select 1 from cron.job where jobname = 'vip_expand_slot_capacity_threshold') then
    perform cron.schedule(
      'vip_expand_slot_capacity_threshold',
      '* * * * *',
      'select public.job_expand_slot_capacity_on_threshold(0.90, 1, 25, 100);'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_enqueue_slot_reminders_24h') then
    perform cron.schedule(
      'vip_enqueue_slot_reminders_24h',
      '*/10 * * * *',
      'select public.job_enqueue_slot_reminders_24h();'
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'vip_dispatch_notifications') then
    perform cron.schedule(
      'vip_dispatch_notifications',
      '*/2 * * * *',
      'select public.job_dispatch_pending_notifications(50, 5);'
    );
  end if;
end;
$$;

-- Helpful manual checks:
-- select * from cron.job order by jobid;
-- select public.job_expire_application_links();
-- select public.job_assign_interview_slots_after_deadline(100);
-- select public.job_generate_assessment_credentials();
-- select public.job_expand_slot_capacity_on_threshold(0.90, 1, 25, 100);
-- select public.job_dispatch_pending_notifications(20, 5);


