# Deploy HRMS API on Vercel (stop Render)

The frontend stays on the existing Vercel project. The API is a **second** Vercel project with root directory `server/`.

Target API URL used in root `vercel.json`:

`https://mern-project-backend-woad.vercel.app`

(Project: `mern-project-backend`. Older docs referenced `mern-hrms-api.vercel.app`, which is retired.)

If Vercel assigns a different production alias, update the rewrite in root [`vercel.json`](../vercel.json) and redeploy the frontend.

## A. Create the API project

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import `Sravanikasi-14/mern-project`
3. **Root Directory** → `server` (Edit → select `server`)
4. Framework Preset: Other
5. Project name: prefer `mern-project-backend` (matches current production alias / rewrite)
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

`https://mern-project-backend-woad.vercel.app/api/health`

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

## F. Scheduled announcements (Vercel Cron)

Canonical registry: [`CRON_JOBS_REGISTRY.md`](./CRON_JOBS_REGISTRY.md).

Announcement due-publish endpoint (same Bearer secret pattern as the workforce HTTP cron):

`GET|POST /api/announcements/publish-due`

Requires `Authorization: Bearer <CRON_SECRET>` (or `ANNOUNCEMENT_CRON_SECRET`).

Configured in [`server/vercel.json`](../server/vercel.json):

```json
"crons": [
  {
    "path": "/api/announcements/publish-due",
    "schedule": "0 3 * * *"
  }
]
```

| Item | Value |
|------|--------|
| Platform | **Vercel Cron** |
| Schedule | `0 3 * * *` → **03:00 UTC** / **08:30 AM IST** daily |
| Auth | Vercel injects `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set on the API project |

Opening Messages / HR announcement APIs can still publish due announcements for that company when someone uses those routes; that does not replace the daily idle cron while the app is quiet. A repeated call publishes each due announcement once (claim/idempotency in the service).

**Scheduling policy:** business workflows run **once per day**. Do not add sub-daily Vercel Cron expressions on the current plan.

### Vercel Cron plan notes

- Prefer **one daily** Vercel Cron job for announcements (current setup).
- More frequent expressions may be unavailable or undesirable on the current plan — use an approved external caller (e.g. cron-job.org) only when product policy allows, and document it in the registry.
- Function `maxDuration` is 60s in `server/vercel.json`.

## G. Workforce Task Scheduling Engine (external cron)

The workforce **HTTP endpoint remains available** on the API. Its **trigger is not Vercel Cron**.

| Item | Value |
|------|--------|
| Endpoint | `GET` or `POST` `/api/workforce-scheduler/run` |
| Platform | **cron-job.org** (external daily schedule) |
| Schedule | **02:00 UTC** / **07:30 AM IST** daily |
| Auth | `Authorization: Bearer <CRON_SECRET>` (same secret Vercel uses for announcement cron) |
| Vercel Cron | **Removed** in commit `d06fd4e` — do not re-add `/api/workforce-scheduler/run` to `server/vercel.json` without approval |
| Default behavior | Scheduler **disabled** unless `WORKFORCE_SCHEDULER_ENABLED=true`. When enabled, default / current production mode is **dry-run** (no ownership changes). |
| `AUTO_CONTINUE` | Keep **`WORKFORCE_SCHEDULER_AUTO_CONTINUE` disabled** (`false` / unset) in production |

See [`CRON_JOBS_REGISTRY.md`](./CRON_JOBS_REGISTRY.md) and [`F41_WORKFORCE_SCHEDULER.md`](./F41_WORKFORCE_SCHEDULER.md).

### Feature flags (API project env)

| Variable | Default | Purpose |
|----------|---------|---------|
| `WORKFORCE_SCHEDULER_ENABLED` | unset/false | Master switch. `true` to allow cron/HR runs. |
| `WORKFORCE_SCHEDULER_MODE` | `dry-run` | `dry-run` = proposals only; `apply` = commit AUTO assignments via `assignUnassignedTaskService`. |
| `WORKFORCE_SCHEDULER_MAX_ACTIVE_TASKS` | `5` | Soft capacity per employee for automatic scheduling. |
| `WORKFORCE_SCHEDULER_AUTO_PRIORITIES` | `LOW,MEDIUM` | Priorities eligible for AUTO assign; others need manager approval. |
| `WORKFORCE_SCHEDULER_LOCK_MS` | `90000` | Per-company run lock TTL. |
| `WORKFORCE_SCHEDULER_AUTO_CONTINUE` | false | Must stay off in production until explicitly approved. |
| `CRON_SECRET` | required for cron HTTP | Shared with announcement cron auth. |

### Safe enable / disable

1. **Disabled:** omit `WORKFORCE_SCHEDULER_ENABLED` or set `false`. Cron returns `{ skipped: true, reason: "scheduler_disabled" }`. Manual assignment is unchanged.
2. **Dry-run (review decisions):** `WORKFORCE_SCHEDULER_ENABLED=true` and `WORKFORCE_SCHEDULER_MODE=dry-run` (or omit mode).
3. **Apply:** set `WORKFORCE_SCHEDULER_MODE=apply` only after dry-run review. HIGH/CRITICAL still require HR approval of proposals.
4. **Rollback:** set `ENABLED=false` or `MODE=dry-run`. Already-assigned tasks stay assigned; no ownership rewind.

### Deployment steps

1. Open the Vercel project whose **Root Directory** is `server` (production API).
2. Settings → Environment Variables → Production: set `CRON_SECRET` (≥16 chars). Optionally set `ANNOUNCEMENT_CRON_SECRET` to the same value for announcement routes.
3. Add scheduler flags as needed (`ENABLED` / `MODE=dry-run` as approved). Keep `AUTO_CONTINUE` off.
4. Confirm `server/vercel.json` lists **only** the announcements cron (workforce must not be re-added casually). Redeploy the API so announcement Vercel Cron + `maxDuration` apply.
5. Vercel Cron for announcements runs **only on Production**, not Preview.
6. Configure **cron-job.org** to call the workforce endpoint daily at 07:30 AM IST with Bearer auth (ops dashboard — not in git).
7. Smoke-test manually:

```bash
curl -X GET "https://<api-host>/api/workforce-scheduler/run" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expect `401` / `CRON_UNAUTHORIZED` without the secret, skipped payload when disabled, or a **sanitized** public summary when enabled.

HR can also trigger a **tenant dry-run** (authenticated, `people.edit`):

`POST /api/workforce-scheduler/company/run?dryRun=true`

Manual assign of `UNASSIGNED` tasks: `POST /api/tasks/:id/assign` (desktop + mobile Work Management).

## Local development

Unchanged:

```bash
npm run server   # Express on PORT from server/.env
npm run client   # Vite
```
