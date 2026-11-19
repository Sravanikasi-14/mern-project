# Staging central database — `platform_staging`

Isolated staging for the central HRMS Cron Dispatcher on the **same MongoDB Atlas cluster** as production, using a **separate central database name**.

| Layer | Production | Staging |
|-------|------------|---------|
| Atlas cluster | Shared | Shared (same `MONGO_URI` allowed) |
| Central DB | `platform` | **`platform_staging`** |
| Tenant DBs | e.g. `company_acme` | **Must** use prefix `company_staging_` |
| Backend project | `mern-project-backend` (Production) | Preview / staging deploy of `scheduler-dispatch-staging` |
| Dispatcher flag | `SCHEDULER_DISPATCH_ENABLED` unset/`false` | Preview only: `true` |

**Do not** change production `MONGO_URI` or production `CENTRAL_DB_NAME`.  
**Do not** copy production data automatically.  
**Do not** point staging `Company.databaseName` at production tenant databases.

---

## Why `CENTRAL_DB_NAME=platform_staging` isolates the dispatcher

`connectCentralDB()` always opens mongoose with `dbName: getCentralDbName()` (`server/config/db.js`).

Central models (including dispatcher registry/locks/history, `companies`, platform admin/plans, workforce fleet) use the **default mongoose connection** → they live in whatever `CENTRAL_DB_NAME` is.

Tenant access uses the **same URI** with `dbName: company.databaseName`. Isolation of tenant data therefore requires **staging-only** `databaseName` values, not a separate cluster.

Dispatcher collections (created on first init/dispatch):

| Collection | Purpose | Indexes |
|------------|---------|---------|
| `scheduler_dispatch_jobs` | Job registry + `nextRunAt` | `nextRunAt`; `{ enabled: 1, nextRunAt: 1 }` |
| `scheduler_dispatch_locks` | Global dispatch lock | `_id` |
| `scheduler_dispatch_history` | Run history | `startedAt`; `{ startedAt: -1 }` |

Other central collections that appear in staging after init (empty seeds, not prod copies):  
`companies`, `platform_plans`, `platform_admins`, `platform_admin_sessions`, `rate_limit_hits`, `offer_template_masters`, `workforce_scheduler_fleet`, plus ephemeral TTL indexes on sessions / rate-limit hits.

---

## Staging environment configuration checklist

### Vercel Preview (`mern-project-backend` → Environment = Preview only)

- [ ] `MONGO_URI` = Atlas URI for the shared cluster (**never paste into tickets/logs**)
- [ ] `CENTRAL_DB_NAME` = `platform_staging`
- [ ] `JWT_SECRET` = staging-only (≥32 chars)
- [ ] `CRON_SECRET` = staging-only
- [ ] `CLIENT_URL` / `FRONTEND_URL` = staging frontend or placeholder
- [ ] `SCHEDULER_DISPATCH_ENABLED` = `true` (**Preview only**)
- [ ] `WORKFORCE_SCHEDULER_MODE` = `dry-run`
- [ ] `WORKFORCE_SCHEDULER_AUTO_CONTINUE` unset/`false`
- [ ] Production env left unchanged (`CENTRAL_DB_NAME=platform`, dispatcher off)

### Local operator shell (for scripts only)

```bash
# Values are examples of NAMES only — set real secrets in your shell/secret store.
export ALLOW_STAGING_DB_SETUP=true
export STAGING_DB_CONFIRM=platform_staging
export CENTRAL_DB_NAME=platform_staging
export MONGO_URI="<staging-capable-atlas-uri>"   # do not commit
# Optional: JWT_SECRET for any auth bootstrap you run separately
```

---

## Safe initialization script

**File:** `server/scripts/preparePlatformStagingDb.js`  
**npm:** `npm run staging:platform-db -- --verify` (from `server/`)

| Mode | Command | Writes? |
|------|---------|---------|
| Verify | `node scripts/preparePlatformStagingDb.js --verify` | No |
| Init | `node scripts/preparePlatformStagingDb.js --init --i-confirm-staging` | Yes — empty staging central only |
| Demo company | `node scripts/preparePlatformStagingDb.js --provision-demo-company --i-confirm-staging` | Yes — staging-prefixed tenant |

Guards (all required):

- `ALLOW_STAGING_DB_SETUP=true`
- `CENTRAL_DB_NAME=platform_staging`
- `STAGING_DB_CONFIRM=platform_staging`
- Write modes: `--i-confirm-staging`
- Refuses if resolved central name is `platform`
- Never prints full `MONGO_URI` (credentials redacted)

**This repository does not auto-execute these scripts.**

---

## Staging test-company provisioning procedure

1. Complete **Init** above so `platform_staging` exists and dispatcher registry is seeded.
2. Provision the demo company **or** use `provision:company` with an explicit staging DB name:

```bash
# Demo helper (preferred for dispatcher smoke):
node scripts/preparePlatformStagingDb.js --provision-demo-company --i-confirm-staging

# Or existing provisioner with staging-prefixed DB (do NOT omit --db):
# npm run provision:company -- --code staging-acme --db company_staging_acme --name "Staging Acme" ...
```

3. Confirm `Company.databaseName` starts with `company_staging_`.
4. Optionally create an HR user via `provision:company` password flags or Platform Admin bootstrap **against `platform_staging` only**.
5. Re-run `--verify` and require `tenantIsolationOk: true`.

---

## Database isolation verification procedure

1. Run `--verify` with staging guards set.
2. Confirm output:
   - `connectedCentralDb` === `platform_staging`
   - `centralIsolated` === true
   - `tenantIsolationOk` === true (all tenants prefixed, or zero companies)
3. In Atlas UI (manual):
   - [ ] Database `platform_staging` exists
   - [ ] Collections `scheduler_dispatch_*` present after init
   - [ ] Production database `platform` row counts / dispatcher collections **unchanged**
   - [ ] No new writes under production tenant DB names from this setup
4. After Preview deploy: hit staging `/api/scheduler/dispatch` with staging `CRON_SECRET`; confirm history rows appear only under `platform_staging.scheduler_dispatch_history`.

---

## Manual Atlas steps (operator)

1. Open the shared Atlas cluster (no new cluster required).
2. Ensure network access allows the operator machine / Vercel.
3. You do **not** need to pre-create `platform_staging` — MongoDB creates the DB on first write/connect.
4. Optionally create a **read-only** Atlas user for verification; keep write credentials in Vercel Preview / local secret store only.
5. Do **not** restore a production dump into `platform_staging` for this phase (avoid accidental PII and cross-links).
6. Do **not** rename or drop `platform`.

---

## Remaining risks

- Same-cluster URI means a mis-set `CENTRAL_DB_NAME=platform` on Preview would hit production central data — Preview env must be double-checked.
- A staging `Company` pointing at a production `databaseName` would mutate production tenant data — enforce `company_staging_` prefix and `--verify`.
- Init seeds empty plans/registry only; it is not a full production clone.
