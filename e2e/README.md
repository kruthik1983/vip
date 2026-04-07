# Playwright E2E Tests

## Install browsers

```bash
npx playwright install
```

## Run all E2E tests

```bash
npm run test:e2e
```

## Required / optional environment variables

- `APP_BASE_URL` (optional, default `http://localhost:3000`)
- `ORG_ADMIN_EMAIL` (required for dashboard regression)
- `ORG_ADMIN_PASSWORD` (required for dashboard regression)
- `APPLY_LINK_ID` (required for apply-parallel spec)
- `ASSESSMENT_TOKEN` (required for 200-burst spec)
- `INTERVIEW_TOKEN` (required for 200-burst spec)
- `DASHBOARD_INTERVIEW_ID` (optional, enables candidate-status assertion)

## Example

```bash
APP_BASE_URL=https://vip-lake.vercel.app \
ORG_ADMIN_EMAIL=orgadmin@company.com \
ORG_ADMIN_PASSWORD=secret \
APPLY_LINK_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
ASSESSMENT_TOKEN=... \
INTERVIEW_TOKEN=... \
npm run test:e2e
```
