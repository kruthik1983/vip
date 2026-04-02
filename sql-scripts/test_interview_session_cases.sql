-- ============================================================================
-- TEST PACK: Candidate Interview API Flow
-- Purpose:
-- 1) Seed one clean ACTIVE interview session (assessment-style)
-- 2) Run manual API test cases for interview + nextQuestion + submit paths
-- 3) Verify interview_responses, interview_sessions, applications, recordings
--
-- Run in Supabase SQL Editor first, then execute API calls from terminal.
-- ============================================================================

create temporary table if not exists tmp_test_interview_cases (
  case_code text primary key,
  interview_id bigint not null,
  application_id bigint not null,
  assessment_attempt_id bigint not null,
  interview_session_id bigint not null,
  session_token text not null,
  candidate_email text not null,
  notes text,
  created_at timestamptz not null default now()
) on commit drop;

truncate table tmp_test_interview_cases;

do $$
declare
  v_interview_id bigint := 2;
  v_assessment_slot_id bigint;
  v_interview_slot_id bigint;
  v_suffix text;

  v_app_id bigint;
  v_attempt_id bigint;
  v_session_id bigint;
  v_token text;
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

  -- Cleanup old QA rows to prevent duplicate applicants in dashboards.
  delete from applications a
   where a.interview_id = v_interview_id
     and a.candidate_email like 'qa-interview-flow-%@example.com';

  v_token := encode(gen_random_bytes(24), 'hex');

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
    'QA Interview Flow Candidate',
    format('qa-interview-flow-%s@example.com', v_suffix),
    '+910000000000',
    'SLOT_ASSIGNED',
    v_assessment_slot_id,
    v_interview_slot_id,
    now(),
    now(),
    now(),
    now()
  )
  returning id into v_app_id;

  insert into assessment_attempts (
    application_id,
    status,
    started_at,
    submitted_at,
    total_questions,
    correct_answers,
    score,
    duration_seconds,
    session_token,
    session_valid_from,
    session_valid_until,
    created_at
  )
  values (
    v_app_id,
    'COMPLETED',
    now() - interval '35 minutes',
    now() - interval '15 minutes',
    20,
    14,
    70,
    1200,
    encode(gen_random_bytes(24), 'hex'),
    now() - interval '40 minutes',
    now() - interval '10 minutes',
    now()
  )
  returning id into v_attempt_id;

  insert into interview_sessions (
    application_id,
    assessment_attempt_id,
    started_at,
    ended_at,
    status,
    total_questions_asked,
    score,
    duration_seconds,
    session_token,
    session_valid_from,
    session_valid_until,
    created_at
  )
  values (
    v_app_id,
    v_attempt_id,
    null,
    null,
    'SLOT_ASSIGNED'::application_status,
    0,
    null,
    null,
    v_token,
    now() - interval '5 minutes',
    now() + interval '45 minutes',
    now()
  )
  returning id into v_session_id;

  insert into tmp_test_interview_cases (
    case_code,
    interview_id,
    application_id,
    assessment_attempt_id,
    interview_session_id,
    session_token,
    candidate_email,
    notes
  )
  values (
    'TC01_ACTIVE',
    v_interview_id,
    v_app_id,
    v_attempt_id,
    v_session_id,
    v_token,
    format('qa-interview-flow-%s@example.com', v_suffix),
    'Expected success on GET/nextQuestion/submit'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- OUTPUT TOKENS (copy for manual API calls)
-- ---------------------------------------------------------------------------
select
  case_code,
  session_token,
  notes,
  interview_session_id,
  application_id,
  assessment_attempt_id,
  candidate_email,
  created_at,
  format('http://localhost:3000/candidate/interview?token=%s', session_token) as interview_url,
  format('http://localhost:3000/api/candidate/interview?token=%s', session_token) as interview_api_url,
  format('http://localhost:3000/api/candidate/interview/nextQuestion [POST body token=%s]', session_token) as next_question_hint
from tmp_test_interview_cases
order by case_code;

-- ---------------------------------------------------------------------------
-- TOKEN DIAGNOSTIC: paste a token below to verify it exists exactly as stored.
-- If no row returns, the copied token is incorrect or from another environment.
-- ---------------------------------------------------------------------------
-- select
--   s.id,
--   s.session_token,
--   s.session_valid_from,
--   s.session_valid_until,
--   s.started_at,
--   s.ended_at,
--   s.status
-- from interview_sessions s
-- where s.session_token = '<PASTE_TOKEN_EXACTLY_HERE>';

-- ============================================================================
-- MANUAL API TEST CASES
-- ============================================================================
-- Base URL: http://localhost:3000
--
-- TC01_ACTIVE -> Expected Success (assessment-style single flow)
-- 1) GET interview metadata
--    GET /api/candidate/interview?token=<TC01_ACTIVE_TOKEN>
--
-- 2) Fetch next question
--    POST /api/candidate/interview/nextQuestion
--    Body: {"token":"<TC01_ACTIVE_TOKEN>","lastAnswer":"I built scalable APIs using Node.js and Postgres."}
--
-- 3) Submit interview (voice transcript style)
--    POST /api/candidate/interview
--    Body:
--    {
--      "token":"<TC01_ACTIVE_TOKEN>",
--      "responses":[
--        {
--          "questionText":"Tell me about your backend optimization work.",
--          "candidateAnswer":"I reduced p95 latency by 40 percent by adding query-level indexing.",
--          "voiceRecordingPath":"org-1/interview-2/app-xyz/session-xyz/answer-1.webm",
--          "answerDurationSeconds":58
--        }
--      ]
--    }
--
-- Optional invalid token check
--    GET /api/candidate/interview?token=fake-token
--    Expected 404 Invalid interview token
-- ============================================================================

-- ---------------------------------------------------------------------------
-- VERIFICATION #1: Session windows and status matrix
-- ---------------------------------------------------------------------------
select
  t.case_code,
  s.id as interview_session_id,
  s.started_at,
  s.ended_at,
  s.status,
  s.session_valid_from,
  s.session_valid_until,
  case
    when now() between s.session_valid_from and s.session_valid_until then 'ACTIVE_WINDOW'
    else 'OUTSIDE_WINDOW'
  end as window_state
from tmp_test_interview_cases t
join interview_sessions s on s.id = t.interview_session_id
order by t.case_code;

-- ---------------------------------------------------------------------------
-- VERIFICATION #2: After TC01 GET /nextQuestion
-- Expect generated question rows in interview_responses for TC01 session.
-- ---------------------------------------------------------------------------
select
  t.case_code,
  r.interview_session_id,
  count(*) as response_rows,
  min(r.asked_at) as first_question_asked_at,
  max(r.asked_at) as last_question_asked_at
from tmp_test_interview_cases t
join interview_responses r on r.interview_session_id = t.interview_session_id
where t.case_code = 'TC01_ACTIVE'
group by t.case_code, r.interview_session_id;

select
  r.id,
  r.question_text,
  r.candidate_answer,
  r.asked_at,
  r.answered_at,
  r.question_duration_seconds
from tmp_test_interview_cases t
join interview_responses r on r.interview_session_id = t.interview_session_id
where t.case_code = 'TC01_ACTIVE'
order by r.id desc
limit 10;

-- ---------------------------------------------------------------------------
-- VERIFICATION #3: After TC01 final POST submit
-- Expect: ended_at set, status COMPLETED, total_questions_asked > 0.
-- ---------------------------------------------------------------------------
select
  t.case_code,
  s.id,
  s.started_at,
  s.ended_at,
  s.status,
  s.total_questions_asked,
  s.duration_seconds
from tmp_test_interview_cases t
join interview_sessions s on s.id = t.interview_session_id
where t.case_code = 'TC01_ACTIVE';

select
  t.case_code,
  a.id as application_id,
  a.status,
  a.updated_at
from tmp_test_interview_cases t
join applications a on a.id = t.application_id
where t.case_code = 'TC01_ACTIVE';

-- ---------------------------------------------------------------------------
-- VERIFICATION #4: Recording linkage (if upload endpoint used in UI flow)
-- ---------------------------------------------------------------------------
select
  t.case_code,
  rec.interview_session_id,
  rec.recording_type,
  rec.file_path,
  rec.duration_seconds,
  rec.created_at
from tmp_test_interview_cases t
join recordings rec on rec.interview_session_id = t.interview_session_id
where t.case_code = 'TC01_ACTIVE'
order by rec.id desc;

-- Optional cleanup (manual):
-- delete from applications a
-- where a.id in (select application_id from tmp_test_interview_cases);
