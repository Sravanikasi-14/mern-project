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

This is not configured on the current production deployment. Do not treat scheduled publication as automatic until the steps below are done and a production invocation returns success.

The production frontend calls:

`https://mern-project-backend-woad.vercel.app/api`

After the announcement API is deployed, the scheduler URL is:

`GET https://mern-project-backend-woad.vercel.app/api/announcements/publish-due`

`POST` to the same path is also accepted. Vercel Cron sends `GET`.

`https://mern-hrms-api.vercel.app` currently has no deployment. Do not send the cron there. The root rewrite to that host is not the URL the frontend uses.

An unauthenticated call does not publish anything. It returns 401 when `CRON_SECRET` or `ANNOUNCEMENT_CRON_SECRET` is set, and 503 when neither is set. The live API does not have this route yet.

No cron entry is in `server/vercel.json`. The project plan could not be read from this machine. On the Hobby plan, Vercel allows a cron only once per day, and a more frequent expression fails the deployment. A daily job is not precise enough for a chosen publication time, so a cron expression was not added.

To enable it:

1. Open the Vercel project that serves `mern-project-backend-woad.vercel.app`. Its root directory is `server`.
2. Settings → Environment Variables → Production. Add `CRON_SECRET`: at least 16 letters or numbers, with no spaces or line breaks. Do not add it to the frontend project, and do not commit the value.
3. On Pro or Enterprise, add this to `server/vercel.json`, then redeploy the API:

```json
"crons": [
  { "path": "/api/announcements/publish-due", "schedule": "*/15 * * * *" }
]
```

4. On Hobby, upgrade before adding that expression. An external scheduler can call the GET URL with `Authorization: Bearer <CRON_SECRET>` instead.
5. Redeploy the API after saving the variable. Cron runs only on the production deployment, and only with the secret captured by that deployment.
6. Opening Messages still publishes due announcements for that company when someone loads them. That does not replace a scheduler while the app is idle.

A repeated call publishes each due announcement once and does not create a second notification.

## Local development

Unchanged:

```bash
npm run server   # Express on PORT from server/.env
npm run client   # Vite
```
