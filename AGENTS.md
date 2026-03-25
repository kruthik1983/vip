# AGENTS.md — Virtual Interview Platform (VIP)

## Project Mission
Ship a complete localhost MVP in 3 days for this flow:
Admin → Org onboarding/approval → HR interview setup → Candidate application → Assessment → Interview → HR decision → email/report/export outputs.

## Stack + Versions (locked)
- Next.js 16.2.1 (App Router)
- React 19.2.4
- TypeScript strict mode
- Supabase JS v2
- Tailwind CSS v4
- ExcelJS, Nodemailer, date-fns, uuid

## Critical Framework Rule
This is NOT old Next.js behavior. Before implementing unfamiliar patterns, read relevant docs in `node_modules/next/dist/docs/` and follow deprecation guidance.

## Delivery Priorities
1. Working end-to-end flows first
2. Data correctness and state transitions
3. Basic UX clarity
4. Performance tuning and polish last

Do not block delivery for premature optimization.

## Scope Guardrails
Include core features required by product docs:
- Role-aware experiences (admin/org/hr/candidate)
- Assessment timer + scoring
- Interview session flow + responses
- HR decision (single + bulk)
- Email event logging/delivery pathway
- AI report generation (mock or real API wrapper)
- Excel export
- Proctoring flags + recording integration path

Avoid adding unrelated features not requested (extra dashboards, design systems, analytics suites, SSO, etc.).

## Repository Conventions
- Use App Router structure under `app/`
- Keep imports with alias `@/*`
- Keep shared modules in `lib/`
- Keep reusable UI in `components/`
- Keep route handlers in `app/api/**/route.ts`

## Next.js + React 19 Rules
- Prefer Server Components by default
- Add `'use client'` only when using hooks/browser APIs/events
- Keep client components focused and small
- Use Route Handlers for server-side write operations
- Keep browser-only APIs (`window`, `localStorage`, media APIs) inside client components/effects

## Supabase Rules
- Centralize client creation in `lib/supabase.ts`
- Use typed query helpers where practical
- Respect RLS assumptions and organization isolation
- Never bypass tenant filters in app queries
- Store and compare all timestamps in UTC
- Follow Supabase documentation first for Auth, Postgres, Storage, and RLS behavior before implementing custom patterns

## Supabase Storage (Video Buckets)
- Use Supabase Storage buckets for interview/assessment video files (not database blobs)
- Keep bucket strategy explicit:
	- `recordings-private` for protected originals
	- optional `recordings-public-preview` only if product explicitly requires public links
- Default to private buckets; generate signed URLs for playback/download
- Store only file metadata in Postgres (bucket, object_path, mime_type, size_bytes, duration_seconds, checksum, uploaded_by, uploaded_at)
- Object path convention must be tenant-safe and traceable:
	- `{organization_id}/{interview_id}/{application_id}/{session_id}/{timestamp}.webm`
- Enforce allowed MIME and size limits in server handlers before upload finalization
- Never expose service-role keys in client code; privileged bucket operations stay server-side
- If resumable or direct browser uploads are used, validate ownership and allowed path prefix on finalize step
- Align retention with product policy (180 days) via scheduled cleanup job and metadata status updates
- Keep bucket and table permissions consistent with RLS/tenant isolation rules

## Data + Workflow Integrity
- Enforce state transitions explicitly in code
- Do not silently mutate terminal states
- Preserve session/token validity windows
- Keep scoring deterministic and auditable
- Write notification/decision/report events to DB where defined

## Coding Standards
- Keep code minimal and composable
- No one-letter variable names
- No dead code / TODO stubs without usage
- Avoid inline comments unless logic is non-obvious
- Match existing style in nearby files

## API Conventions
- Validate request body at handler boundary
- Return explicit status codes (`200/201/400/401/403/404/409/500`)
- Return stable JSON shapes: `{ success, data?, error? }`
- Keep handlers small; move logic to `lib/` helpers/services

## Reliability Checklist (before finishing a task)
Run, in order when possible:
1. `npm run lint`
2. `npm run build` (or targeted type check if build is too costly during rapid iteration)
3. Smoke test the touched flow on localhost

If a check fails due to unrelated pre-existing issues, report clearly and continue with scoped fixes only.

## MVP UX Constraints
- Keep UI straightforward and fast to implement
- Prefer existing Tailwind utility patterns
- No heavy animation or complex visual systems
- Prioritize functional clarity over visual polish

## Security + Privacy Baseline
- Never log secrets or tokens
- Keep API keys in env vars only
- Treat candidate data and recordings as sensitive
- Avoid exposing internal IDs unnecessarily in UI

## Done Criteria for Agent Tasks
A task is done only if:
1. Code compiles for changed area
2. Flow works end-to-end for impacted feature
3. No obvious regression introduced in adjacent flow
4. File/route placement follows this guide

## If Uncertain
When requirements conflict, optimize for:
1. Product flow correctness
2. Shipping within 3-day MVP window
3. Simplicity over abstraction
