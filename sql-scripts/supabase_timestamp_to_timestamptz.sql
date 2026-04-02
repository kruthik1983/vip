-- ============================================================================
-- VIP MIGRATION: Convert all public table columns from timestamp to timestamptz
-- Assumption: existing timestamp values are stored in UTC.
-- Conversion method: column_value AT TIME ZONE 'UTC'
--
-- Safe to re-run: it only targets columns currently typed as
-- "timestamp without time zone".
-- ============================================================================

begin;

-- Prevent timezone drift while migration is running.
set local timezone to 'UTC';

-- Drop dependent views (recreated below).
drop view if exists candidate_performance_summary;
drop view if exists interview_status_dashboard;

do $$
declare
  r record;
begin
  for r in
    select
      c.table_schema,
      c.table_name,
      c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and c.data_type = 'timestamp without time zone'
    order by c.table_name, c.ordinal_position
  loop
    execute format(
      'alter table %I.%I alter column %I type timestamptz using %I at time zone ''UTC''',
      r.table_schema,
      r.table_name,
      r.column_name,
      r.column_name
    );
  end loop;
end;
$$;

-- Recreate dashboard views.
create view candidate_performance_summary as
select
  a.id as application_id,
  a.candidate_name,
  a.candidate_email,
  i.id as interview_id,
  j.position_title,
  a.created_at as applied_at,
  (select score from assessment_attempts where application_id = a.id limit 1) as assessment_score,
  (select score from interview_sessions where application_id = a.id limit 1) as interview_score,
  (select hire_recommendation from ai_reports where application_id = a.id and report_type = 'INTERVIEW' limit 1) as hire_recommendation,
  (select decision from hr_decisions where application_id = a.id limit 1) as final_decision,
  a.status
from applications a
left join interviews i on a.interview_id = i.id
left join jobs j on i.job_id = j.id
order by a.created_at desc;

create view interview_status_dashboard as
select
  i.id as interview_id,
  i.title,
  j.position_title,
  count(distinct a.id) as total_applications,
  count(distinct case when a.status in ('COMPLETED', 'ACCEPTED', 'REJECTED') then a.id end) as completed,
  count(distinct case when a.status = 'ACCEPTED' then a.id end) as accepted,
  count(distinct case when a.status = 'REJECTED' then a.id end) as rejected,
  i.assessment_start_utc,
  i.status
from interviews i
left join jobs j on i.job_id = j.id
left join applications a on i.id = a.interview_id
group by i.id, i.title, j.position_title, i.assessment_start_utc, i.status;

commit;

-- Verification query (optional): should return 0 rows
-- select table_name, column_name
-- from information_schema.columns
-- where table_schema = 'public'
--   and data_type = 'timestamp without time zone';
