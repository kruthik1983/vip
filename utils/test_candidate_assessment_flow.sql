-- ============================================================================
-- TEST PACK: Candidate Assessment API Flow
-- Purpose:
-- 1) Seed one test application + assessment_attempt with active session token
-- 2) Provide quick verification queries for GET -> PATCH -> POST lifecycle
-- 3) Validate generated unique 20-question set and saved responses
--
-- Run this in Supabase SQL Editor first.
-- Then call API endpoints from terminal using the emitted token.
-- ============================================================================

-- ---------- CONFIG ----------
-- Change this interview id if needed.
-- It must exist and have at least one assessment slot + one interview slot.

create temporary table if not exists tmp_test_assessment_flow (
  interview_id bigint not null,
  application_id bigint not null,
  assessment_attempt_id bigint not null,
  session_token text not null,
  candidate_email text not null,
  created_at timestamptz not null default now()
) on commit drop;

truncate table tmp_test_assessment_flow;

do $$
declare
  v_interview_id bigint := 2;
  v_assessment_slot_id bigint;
  v_interview_slot_id bigint;
  v_application_id bigint;
  v_attempt_id bigint;
  v_session_token text;
  v_suffix text;
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
    raise exception 'No assessment slots found for interview %', v_interview_id;
  end if;

  if v_interview_slot_id is null then
    raise exception 'No interview slots found for interview %', v_interview_id;
  end if;

  v_suffix := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  v_session_token := encode(gen_random_bytes(24), 'hex');

  insert into applications (
    interview_id,
    candidate_name,
    candidate_email,
    candidate_phone,
    status,
    assigned_assessment_slot_id,
    assigned_interview_slot_id,
    assessment_slot_assigned_at,
    interview_slot_assigned_at,
    created_at,
    updated_at
  )
  values (
    v_interview_id,
    'Assessment QA Candidate',
    format('qa-assessment-%s@example.com', v_suffix),
    '+910000000000',
    'SLOT_ASSIGNED',
    v_assessment_slot_id,
    v_interview_slot_id,
    now(),
    now(),
    now(),
    now()
  )
  returning id into v_application_id;

  insert into assessment_attempts (
    application_id,
    status,
    session_token,
    session_valid_from,
    session_valid_until,
    created_at
  )
  values (
    v_application_id,
    'SLOT_ASSIGNED',
    v_session_token,
    now() - interval '1 minute',
    now() + interval '45 minutes',
    now()
  )
  returning id into v_attempt_id;

  insert into tmp_test_assessment_flow (
    interview_id,
    application_id,
    assessment_attempt_id,
    session_token,
    candidate_email
  )
  values (
    v_interview_id,
    v_application_id,
    v_attempt_id,
    v_session_token,
    format('qa-assessment-%s@example.com', v_suffix)
  );
end;
$$;

-- ---------- OUTPUT YOU NEED FOR API CALLS ----------
select
  interview_id,
  application_id,
  assessment_attempt_id,
  session_token,
  candidate_email,
  created_at
from tmp_test_assessment_flow;

-- ---------- PRE-CHECK (before GET call) ----------
select
  t.assessment_attempt_id,
  aa.started_at,
  aa.submitted_at,
  aa.session_valid_from,
  aa.session_valid_until,
  count(ar.id) as existing_response_rows
from tmp_test_assessment_flow t
join assessment_attempts aa on aa.id = t.assessment_attempt_id
left join assessment_responses ar on ar.assessment_attempt_id = aa.id
group by t.assessment_attempt_id, aa.started_at, aa.submitted_at, aa.session_valid_from, aa.session_valid_until;

-- ============================================================================
-- MANUAL API CALLS (run from terminal after copying session_token)
-- ============================================================================
-- 1) GET (should initialize started_at, generate + store 20 unique questions)
--    GET http://localhost:3000/api/candidate/assessment?token=<SESSION_TOKEN>
--
-- 2) PATCH autosave sample (save two answers)
--    PATCH http://localhost:3000/api/candidate/assessment
--    Body:
--    {
--      "token": "<SESSION_TOKEN>",
--      "responses": [
--        { "questionId": <Q1_ID>, "selectedOptionLabel": "A" },
--        { "questionId": <Q2_ID>, "selectedOptionLabel": "C" }
--      ]
--    }
--
-- 3) POST final submit
--    POST http://localhost:3000/api/candidate/assessment
--    Body:
--    {
--      "token": "<SESSION_TOKEN>",
--      "responses": [
--        ... all or partial answers ...
--      ]
--    }
-- ============================================================================

-- ---------- CHECK #1 (after GET call) ----------
-- Expect:
-- - started_at is not null
-- - response_rows = 20
-- - linked question rows = 20
select
  t.assessment_attempt_id,
  aa.started_at,
  aa.submitted_at,
  count(ar.id) as response_rows,
  count(distinct aq.id) as generated_question_rows
from tmp_test_assessment_flow t
join assessment_attempts aa on aa.id = t.assessment_attempt_id
left join assessment_responses ar on ar.assessment_attempt_id = aa.id
left join assessment_questions aq on aq.id = ar.question_id
group by t.assessment_attempt_id, aa.started_at, aa.submitted_at;

-- Inspect generated question list for this candidate attempt.
select
  ar.assessment_attempt_id,
  aq.id as question_id,
  aq.question_order,
  aq.question_text,
  ar.selected_option_label,
  ar.is_correct
from tmp_test_assessment_flow t
join assessment_responses ar on ar.assessment_attempt_id = t.assessment_attempt_id
join assessment_questions aq on aq.id = ar.question_id
order by aq.question_order;

-- ---------- CHECK #2 (after PATCH call) ----------
-- Expect selected_option_label populated for answered rows.
select
  ar.assessment_attempt_id,
  count(*) as total_rows,
  count(*) filter (where ar.selected_option_label is not null) as answered_rows
from tmp_test_assessment_flow t
join assessment_responses ar on ar.assessment_attempt_id = t.assessment_attempt_id
group by ar.assessment_attempt_id;

-- ---------- CHECK #3 (after POST call) ----------
-- Expect:
-- - submitted_at is not null
-- - score fields populated
-- - session_valid_until ~= submitted_at (session locked)
-- - application status moved forward
select
  t.assessment_attempt_id,
  aa.started_at,
  aa.submitted_at,
  aa.total_questions,
  aa.correct_answers,
  aa.score,
  aa.duration_seconds,
  aa.session_valid_until
from tmp_test_assessment_flow t
join assessment_attempts aa on aa.id = t.assessment_attempt_id;

select
  t.application_id,
  a.status,
  a.updated_at
from tmp_test_assessment_flow t
join applications a on a.id = t.application_id;

-- Optional cleanup (manual):
-- delete from applications a
-- where a.id in (select application_id from tmp_test_assessment_flow);

