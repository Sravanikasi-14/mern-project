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

## Local development

Unchanged:

```bash
npm run server   # Express on PORT from server/.env
npm run client   # Vite
```
