# Deploy HRMS API on Vercel (stop Render)

The frontend stays on the existing Vercel project. The API is a **second** Vercel project with root directory `server/`.

Target API URL used in root `vercel.json`:

`https://mern-hrms-api.vercel.app`

If Vercel assigns a different URL, update the rewrite in root [`vercel.json`](../vercel.json) and redeploy the frontend.

## A. Create the API project

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import `Sravanikasi-14/mern-project`
3. **Root Directory** → `server` (Edit → select `server`)
4. Framework Preset: Other
5. Project name: prefer `mern-hrms-api` (matches the rewrite)
6. Add Environment Variables (Production + Preview):

| Name | Example / notes |
|------|-----------------|
| `MONGO_URI` | Your Atlas connection string |
| `CENTRAL_DB_NAME` | `platform` |
| `JWT_SECRET` | Same secret as before (32+ chars) |
| `JWT_EXPIRES_IN` | `8h` |
| `JWT_ISSUER` | `hrms-platform` |
| `JWT_AUDIENCE` | `hrms-company-users` |
| `AUTH_COOKIE_NAME` | `hrms_auth` |
| `BCRYPT_ROUNDS` | `12` |
| `ONBOARDING_TOKEN_EXPIRES_IN` | `7d` |
| `CLIENT_URL` | `https://mern-project-nu-nine.vercel.app` |
| `NODE_ENV` | `production` |
| `EMAIL_FROM` | `Your Name <you@gmail.com>` |
| `SMTP_USER` | `you@gmail.com` |
| `SMTP_APP_PASSWORD` | Gmail App Password |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` |

**Messages attachments** use tenant MongoDB **GridFS** (`chat_attachments` bucket) on the same Atlas `MONGO_URI` — no Cloudflare R2 required for chat. Offer documents use a separate GridFS bucket (`offer_docs`).

7. Deploy

## B. Health check

Open:

`https://mern-hrms-api.vercel.app/api/health`

Expect JSON with `"service":"hrms-api"` and `"runtime":"vercel"`.

If the project URL differs, fix root `vercel.json` rewrite, commit, push, and redeploy the **frontend** project.

## C. Point frontend + redeploy

Root `vercel.json` already rewrites `/api/*` to the Vercel API (not Render).  
Redeploy the existing frontend Vercel project after that commit is on `main`.

## D. Suspend Render

Only after health + login work on production:

1. Render dashboard → service `mern-project-rvdl`
2. **Suspend** (or delete)

## E. Verify email

1. Sign in on the frontend
2. **Settings** → save Gmail + app password (or rely on SMTP env vars)
3. Send a test offer letter

## F. Scheduled announcements

Announcement due-publish endpoint (same auth pattern as workforce cron):

`GET|POST /api/announcements/publish-due`

Requires `Authorization: Bearer <CRON_SECRET>` (or `ANNOUNCEMENT_CRON_SECRET`).

Opening Messages can still publish due announcements for that company when someone loads them; that does not replace a scheduler while the app is idle. A repeated call publishes each due announcement once.

On Vercel Hobby, only **one** cron expression is allowed per project and it may run at most **once per day**. Prefer the workforce scheduler daily cron below for Hobby, and call announcements `publish-due` from an external scheduler if you need sub-daily announcement checks on Hobby.

## G. Workforce Task Scheduling Engine (cron)

Configured in [`server/vercel.json`](../server/vercel.json):

```json
"crons": [
  {
    "path": "/api/workforce-scheduler/run",
    "schedule": "0 2 * * *"
  }
]
```

| Item | Value |
|------|--------|
| Endpoint | `GET` or `POST` `/api/workforce-scheduler/run` |
| Schedule | `0 2 * * *` (02:00 UTC daily) |
| Auth | `Authorization: Bearer <CRON_SECRET>` (Vercel injects this automatically when `CRON_SECRET` is set) |
| Default behavior | Scheduler **disabled** unless `WORKFORCE_SCHEDULER_ENABLED=true`. When enabled, default mode is **dry-run** (no ownership changes). |

### Feature flags (API project env)

| Variable | Default | Purpose |
|----------|---------|---------|
| `WORKFORCE_SCHEDULER_ENABLED` | unset/false | Master switch. `true` to allow cron/HR runs. |
| `WORKFORCE_SCHEDULER_MODE` | `dry-run` | `dry-run` = proposals only; `apply` = commit AUTO assignments via `assignUnassignedTaskService`. |
| `WORKFORCE_SCHEDULER_MAX_ACTIVE_TASKS` | `5` | Soft capacity per employee for automatic scheduling. |
| `WORKFORCE_SCHEDULER_AUTO_PRIORITIES` | `LOW,MEDIUM` | Priorities eligible for AUTO assign; others need manager approval. |
| `WORKFORCE_SCHEDULER_LOCK_MS` | `240000` | Per-company run lock TTL. |
| `CRON_SECRET` | required for cron | Shared with announcement cron auth. |

### Safe enable / disable

1. **Disabled (recommended until reviewed):** omit `WORKFORCE_SCHEDULER_ENABLED` or set `false`. Cron returns `{ skipped: true, reason: "scheduler_disabled" }`. Manual assignment is unchanged.
2. **Dry-run (review decisions):** `WORKFORCE_SCHEDULER_ENABLED=true` and `WORKFORCE_SCHEDULER_MODE=dry-run` (or omit mode).
3. **Apply:** set `WORKFORCE_SCHEDULER_MODE=apply` only after dry-run review. HIGH/CRITICAL still require HR approval of proposals.
4. **Rollback:** set `ENABLED=false` or `MODE=dry-run`. Already-assigned tasks stay assigned; no ownership rewind.

### Deployment steps

1. Open the Vercel project whose **Root Directory** is `server` (production API).
2. Settings → Environment Variables → Production: set `CRON_SECRET` (≥16 chars). Optionally set `ANNOUNCEMENT_CRON_SECRET` to the same value for announcement routes.
3. Add scheduler flags as needed (`ENABLED` left false until approved).
4. Confirm `server/vercel.json` includes the workforce cron entry (already present). Redeploy the API.
5. Cron runs **only on Production**, not Preview.
6. Smoke-test manually:

```bash
curl -X GET "https://<api-host>/api/workforce-scheduler/run" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expect `401` without the secret, `success` + `skipped` when disabled, or a company results payload when enabled.

### Vercel Hobby limitations

- At most **one** cron job; schedule at most **once per day**.
- More frequent expressions fail deployment on Hobby — upgrade to Pro/Enterprise or use an external caller with Bearer auth.
- Function `maxDuration` is 60s in `server/vercel.json`; large tenants may need batching/limits (`limit` on the queue).

HR can also trigger a **tenant dry-run** (authenticated, `people.edit`):

`POST /api/workforce-scheduler/company/run?dryRun=true`

Manual assign of `UNASSIGNED` tasks: `POST /api/tasks/:id/assign` (desktop + mobile Work Management).

## Local development

Unchanged:

```bash
npm run server   # Express on PORT from server/.env
npm run client   # Vite
```
