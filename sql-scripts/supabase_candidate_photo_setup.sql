-- ============================================================================
-- Candidate Photo Setup
-- ============================================================================
-- Purpose:
-- 1) Add candidate photo path column to applications
-- 2) Provision private storage bucket for candidate photos
--
-- Run this in Supabase SQL Editor as a privileged role.

alter table public.applications
  add column if not exists candidate_photo_path text;

create index if not exists idx_applications_candidate_photo_path
  on public.applications(candidate_photo_path)
  where candidate_photo_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'candidate-photos',
  'candidate-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
