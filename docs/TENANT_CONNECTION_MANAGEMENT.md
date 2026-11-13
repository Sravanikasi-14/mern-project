# Tenant MongoDB Connection Management (F35)

## Scope

Per-tenant database connections for the DB-per-company architecture.  
**Central** platform DB (`CENTRAL_DB_NAME` / default `platform`) still uses the default `mongoose.connect` singleton and is separate from the tenant cache.

## Lifecycle

```
HTTP request
  → tenantConnectionScopeMiddleware (AsyncLocalStorage scope)
  → authenticate / handlers → getCompanyModels / getTenantConnection
       → reuse or create connection for databaseName
       → retain once per tenant DB for this request scope (refCount++)
  → res finish/close → release scope retains (refCount--)

Cron / provisionAll / jobs
  → runWithTenantConnectionScope per company (or equivalent)
       → same retain while work runs → release in finally

Shutdown / tests / one-shot scripts
  → disconnectAll() closes all tenant + central connections
```

Connections are **not** closed after every HTTP request. Warm Vercel/Node processes reuse cached tenant connections across invocations on the **same** instance. Eviction only closes connections with **refCount === 0**.

## Active-use definition (eviction safety)

| Signal | Meaning |
|--------|---------|
| `refCount > 0` | Connection is **in active use** (request scope, job scope, or manual retain). **Never evicted.** |
| `refCount === 0` and idle ≥ `TENANT_CONN_IDLE_EVICT_MS` | Preferred eviction victim |
| `refCount === 0` under cache pressure | May be LRU-evicted even if recently touched (safe because active work holds refCount) |

`lastUsedAt` is updated on get/retain/release. It is **not** a substitute for active-use tracking. Ordinary API requests are protected by **request-scoped retain**, not by the 60s idle window alone.

### Exact eviction conditions

When opening tenant DB `X` and the cache already holds `TENANT_CONN_CACHE_MAX` **other** tenants:

1. Skip any entry with `refCount > 0`.
2. Skip entries still mid-first-connect (`connectPromise` without ready connection).
3. Prefer the oldest `lastUsedAt` among unpinned entries with `now - lastUsedAt >= idleEvictMs`.
4. Else take the oldest unpinned entry (LRU).
5. If none (all retained) → **503** `Tenant database connection capacity reached on this instance`.
6. Close victim asynchronously after removing it from the cache (new gets for that DB open a fresh connection).

## Per-instance vs deployment-wide limits

| Limit | What it bounds |
|-------|----------------|
| `TENANT_CONN_CACHE_MAX` | Max **tenant DB connections cached in this Node/Vercel isolate** |
| `TENANT_MONGO_MAX_POOL_SIZE` | Max **sockets inside each** of those tenant connections |
| Atlas / cluster connection cap | **Sum across all instances** × (cached tenants × pool size) + central |

An in-memory cache is **not** shared across Vercel instances.

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `TENANT_CONN_CACHE_MAX` | `50` | Max cached tenant connections per process |
| `TENANT_CONN_IDLE_EVICT_MS` | `60000` | Prefer victims idle at least this long; `0` = any unpinned eligible |
| `TENANT_MONGO_MAX_POOL_SIZE` | `5` | Driver `maxPoolSize` per tenant connection |
| `TENANT_MONGO_MIN_POOL_SIZE` | `0` | Driver `minPoolSize` (capped by max) |
| `TENANT_MONGO_MAX_IDLE_MS` | `30000` | Driver closes idle pooled sockets after this many ms |
| `TENANT_MONGO_SERVER_SELECTION_MS` | `8000` | Server selection timeout |

## Central integration (no per-controller retain)

- **HTTP:** `tenantConnectionScopeMiddleware` in `createApp()` (before routes).
- **Workforce cron:** `runWithTenantConnectionScope` per company in `runSchedulerForAllCompanies`.
- **Announcement publish-due:** scope per company in `publishDueForAllCompanies`.
- **Bulk provision:** scope per company in `provisionAllTenantDatabases`.

Manual `retainTenantConnection` / `releaseTenantConnection` remain for tests and rare escapes.

Work **outside** a scope (ad-hoc scripts) does not auto-retain; short scripts should call `disconnectAll()` when finished. Long multi-tenant scripts should use `runWithTenantConnectionScope`.

## Failure and recovery

- Failed `createConnection` removes the cache entry and surfaces HTTP 503.
- Closed/dead cached connections are replaced on the next `getTenantConnection`.
- Concurrent first-connects for the same tenant share one promise.

## Isolation rules

- One mongoose connection object ↔ one `databaseName`.
- Different tenants never share the same connection object.
- No global connection that switches `dbName` across tenants.

## `disconnectAll()`

Used by tests and one-shot scripts after work completes. **Not** called from request handlers or the Vercel function lifecycle. Do not run it in a long-lived API process while serving traffic.

## Tests

`server/tests/f35_tenant_connections.test.js` covers reuse, concurrency, cache max, retain/scope protection, idle eviction, reconnect, isolation, provisioning, job path, and cleanup.
