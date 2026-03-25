-- ============================================================================
-- One Application Per Interview Per Email (Case-Insensitive)
-- ============================================================================
-- Purpose:
-- 1) Block duplicate applications for the same interview and email
-- 2) Close race-condition gaps that API-only checks cannot prevent
--
-- Run in Supabase SQL Editor as a privileged role.

-- Optional pre-check: find duplicates that would block unique index creation.
-- Keep earliest row per (interview_id, lower(candidate_email)); review before deletion.
with ranked as (
  select
    id,
    interview_id,
    lower(candidate_email) as candidate_email_ci,
    row_number() over (
      partition by interview_id, lower(candidate_email)
      order by created_at asc nulls last, id asc
    ) as rn
  from public.applications
)
select *
from ranked
where rn > 1
order by interview_id, candidate_email_ci, rn;

-- Create uniqueness guarantee (case-insensitive).
-- If duplicates exist, this will fail until duplicates are resolved.
create unique index if not exists ux_applications_interview_email_ci
  on public.applications (interview_id, lower(candidate_email));
