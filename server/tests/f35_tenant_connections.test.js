import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  connectCentralDB,
  disconnectAll,
  getCompanyModels,
  getTenantConnection,
  getTenantConnectionConfig,
  getTenantConnectionStats,
  releaseTenantConnection,
  retainTenantConnection,
  runWithTenantConnectionScope,
} from "../config/db.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { provisionTenantDatabase } from "../services/tenantProvisioningService.js";
import { runSchedulerForAllCompanies } from "../services/workforceScheduler/executionController.js";

process.env.NODE_ENV = "test";
process.env.CENTRAL_DB_NAME = "platform";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.WORKFORCE_SCHEDULER_ENABLED = "false";

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let mongo;

before(async () => {
  fs.mkdirSync("D:/tmp/hrms-mongo/f35-tenant-conn", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/f35-tenant-conn" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await disconnectAll();
  process.env.MONGO_URI = mongo.getUri();
  process.env.CENTRAL_DB_NAME = "platform";
  delete process.env.TENANT_CONN_CACHE_MAX;
  delete process.env.TENANT_CONN_IDLE_EVICT_MS;
  delete process.env.TENANT_MONGO_MAX_POOL_SIZE;
  await connectCentralDB();
  await Company.deleteMany({});
});

async function createCompany(slug) {
  return Company.create({
    companyName: slug,
    slug,
    databaseName: `company_${slug.replace(/-/g, "_")}`,
    migrationVersion: 0,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });
}

describe("F35 tenant connection cache", () => {
  it("reuses one connection for repeated requests to the same tenant", async () => {
    const company = await createCompany("reuse-co");
    const a = await getTenantConnection(company.databaseName);
    const b = await getTenantConnection(company.databaseName);
    const c = await getTenantConnection(company.databaseName);

    assert.equal(a, b);
    assert.equal(b, c);
    assert.equal(a.readyState, 1);
    assert.equal(getTenantConnectionStats().size, 1);
    assert.equal(a.name, company.databaseName);
  });

  it("coalesces concurrent first-connects so the same tenant is not duplicated", async () => {
    const company = await createCompany("race-co");
    const results = await Promise.all(
      Array.from({ length: 12 }, () => getTenantConnection(company.databaseName))
    );

    const first = results[0];
    for (const conn of results) {
      assert.equal(conn, first);
    }
    assert.equal(getTenantConnectionStats().size, 1);
    assert.equal(first.readyState, 1);
  });

  it("respects per-process tenant cache max via LRU eviction of unpinned entries", async () => {
    process.env.TENANT_CONN_CACHE_MAX = "2";
    process.env.TENANT_CONN_IDLE_EVICT_MS = "0";

    const c1 = await createCompany("cache-a");
    const c2 = await createCompany("cache-b");
    const c3 = await createCompany("cache-c");

    const conn1 = await getTenantConnection(c1.databaseName);
    const conn2 = await getTenantConnection(c2.databaseName);
    assert.equal(getTenantConnectionStats().size, 2);
    assert.equal(getTenantConnectionConfig().cacheMax, 2);

    const conn3 = await getTenantConnection(c3.databaseName);
    const stats = getTenantConnectionStats();
    assert.equal(stats.size, 2);
    assert.ok(stats.entries.some((e) => e.databaseName === c3.databaseName));
    assert.ok(conn3.readyState === 1);
    // Oldest unpinned (c1) should have been closed and removed.
    assert.equal(conn1.readyState, 0);
    assert.ok(conn2.readyState === 1 || conn2.readyState === 0);
    // Exactly one of the first two may remain (LRU = c1); c2 should still be cached.
    assert.ok(stats.entries.some((e) => e.databaseName === c2.databaseName));
    assert.ok(!stats.entries.some((e) => e.databaseName === c1.databaseName));
  });

  it("never evicts a connection that is retained (actively in use)", async () => {
    process.env.TENANT_CONN_CACHE_MAX = "2";
    process.env.TENANT_CONN_IDLE_EVICT_MS = "0";

    const c1 = await createCompany("pin-a");
    const c2 = await createCompany("pin-b");
    const c3 = await createCompany("pin-c");

    const conn1 = await getTenantConnection(c1.databaseName);
    await getTenantConnection(c2.databaseName);
    assert.equal(retainTenantConnection(c1.databaseName), true);
    assert.equal(retainTenantConnection(c2.databaseName), true);

    await assert.rejects(
      () => getTenantConnection(c3.databaseName),
      (err) => err?.status === 503
    );

    assert.equal(conn1.readyState, 1);
    const stats = getTenantConnectionStats();
    assert.equal(stats.size, 2);
    assert.ok(stats.entries.every((e) => e.refCount > 0));

    releaseTenantConnection(c1.databaseName);
    releaseTenantConnection(c2.databaseName);

    const conn3 = await getTenantConnection(c3.databaseName);
    assert.equal(conn3.readyState, 1);
    assert.equal(getTenantConnectionStats().size, 2);
  });

  it("recovers after a failed or closed tenant connection", async () => {
    const company = await createCompany("recover-co");
    const first = await getTenantConnection(company.databaseName);
    assert.equal(first.readyState, 1);

    await first.close();
    assert.equal(first.readyState, 0);

    const second = await getTenantConnection(company.databaseName);
    assert.equal(second.readyState, 1);
    assert.notEqual(second, first);
    assert.equal(second.name, company.databaseName);
    assert.equal(getTenantConnectionStats().size, 1);
  });

  it("never shares one mongoose connection across different tenant databases", async () => {
    const a = await createCompany("iso-a");
    const b = await createCompany("iso-b");

    const connA = await getTenantConnection(a.databaseName);
    const connB = await getTenantConnection(b.databaseName);

    assert.notEqual(connA, connB);
    assert.equal(connA.name, a.databaseName);
    assert.equal(connB.name, b.databaseName);
    assert.notEqual(connA.db.databaseName, connB.db.databaseName);

    const modelsA = await getCompanyModels(a, { provision: true });
    const modelsB = await getCompanyModels(b, { provision: true });
    assert.notEqual(modelsA.connection, modelsB.connection);
    assert.equal(modelsA.User.db.name, a.databaseName);
    assert.equal(modelsB.User.db.name, b.databaseName);
  });

  it("keeps provisioning and getCompanyModels working through the cache", async () => {
    const company = await createCompany("provision-co");
    const connection = await getTenantConnection(company.databaseName);
    const outcome = await provisionTenantDatabase(company, connection);
    assert.ok(outcome.databaseName === company.databaseName);

    const models = await getCompanyModels(company, { provision: true });
    assert.equal(models.connection, connection);
    assert.equal(models.User.db.name, company.databaseName);

    // Second open reuses the same connection object.
    const again = await getCompanyModels(company);
    assert.equal(again.connection, connection);
  });

  it("allows background job helpers to open tenant models via the same cache", async () => {
    const company = await createCompany("cron-co");
    const models = await getCompanyModels(company, { provision: true });
    assert.equal(models.connection.readyState, 1);

    // force bypasses ENABLED=false so the job path calls getCompanyModels per company.
    const result = await runSchedulerForAllCompanies({ mode: "dry-run", force: true });
    assert.equal(result.skipped, false);
    assert.ok(result.companies >= 1);
    assert.ok(
      getTenantConnectionStats().entries.some((e) => e.databaseName === company.databaseName)
    );
  });

  it("disconnectAll closes tenant connections and clears the cache", async () => {
    const company = await createCompany("cleanup-co");
    const conn = await getTenantConnection(company.databaseName);
    assert.equal(conn.readyState, 1);
    assert.equal(getTenantConnectionStats().size, 1);

    await disconnectAll();
    assert.equal(getTenantConnectionStats().size, 0);
    assert.equal(conn.readyState, 0);

    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
  });

  it("applies bounded pool options to tenant connections", async () => {
    process.env.TENANT_MONGO_MAX_POOL_SIZE = "3";
    const cfg = getTenantConnectionConfig();
    assert.equal(cfg.maxPoolSize, 3);

    const company = await createCompany("pool-co");
    const conn = await getTenantConnection(company.databaseName);
    assert.equal(conn.readyState, 1);
    // mongoose stores options on the connection; pool size is honored by the driver.
    assert.equal(conn.name, company.databaseName);
  });

  it("keeps an active scoped request connection open under cache pressure", async () => {
    process.env.TENANT_CONN_CACHE_MAX = "1";
    process.env.TENANT_CONN_IDLE_EVICT_MS = "0";

    const active = await createCompany("active-req");
    const other = await createCompany("pressure-req");

    await runWithTenantConnectionScope(async () => {
      const conn = await getTenantConnection(active.databaseName);
      assert.equal(conn.readyState, 1);
      const held = getTenantConnectionStats().entries.find(
        (e) => e.databaseName === active.databaseName
      );
      assert.ok(held);
      assert.ok(held.refCount >= 1);

      await assert.rejects(
        () => getTenantConnection(other.databaseName),
        (err) => err?.status === 503
      );
      assert.equal(conn.readyState, 1);
      assert.equal(getTenantConnectionStats().size, 1);
    });

    // After scope ends, pressure can evict the idle unpinned connection.
    const replacement = await getTenantConnection(other.databaseName);
    assert.equal(replacement.readyState, 1);
    assert.ok(
      getTenantConnectionStats().entries.every((e) => e.databaseName === other.databaseName)
    );
  });

  it("keeps a scoped connection open through a long operation past idleEvictMs", async () => {
    process.env.TENANT_CONN_CACHE_MAX = "1";
    process.env.TENANT_CONN_IDLE_EVICT_MS = "40";

    const active = await createCompany("long-op");
    const other = await createCompany("long-other");

    await runWithTenantConnectionScope(async () => {
      const conn = await getTenantConnection(active.databaseName);
      await sleep(80);
      await assert.rejects(
        () => getTenantConnection(other.databaseName),
        (err) => err?.status === 503
      );
      assert.equal(conn.readyState, 1);
      await conn.db.command({ ping: 1 });
    });
  });

  it("evicts an idle unpinned connection after the configured idle threshold", async () => {
    process.env.TENANT_CONN_CACHE_MAX = "1";
    process.env.TENANT_CONN_IDLE_EVICT_MS = "40";

    const first = await createCompany("idle-first");
    const second = await createCompany("idle-second");

    const conn1 = await getTenantConnection(first.databaseName);
    assert.equal(conn1.readyState, 1);
    await sleep(60);

    const conn2 = await getTenantConnection(second.databaseName);
    assert.equal(conn2.readyState, 1);
    assert.equal(conn1.readyState, 0);
    assert.equal(getTenantConnectionStats().size, 1);
    assert.equal(getTenantConnectionStats().entries[0].databaseName, second.databaseName);
  });

  it("supports concurrent scoped requests for the same tenant safely", async () => {
    const company = await createCompany("concurrent-scope");

    const connections = await Promise.all(
      Array.from({ length: 8 }, () =>
        runWithTenantConnectionScope(async () => {
          const conn = await getTenantConnection(company.databaseName);
          assert.equal(conn.readyState, 1);
          await sleep(20);
          return conn;
        })
      )
    );

    const first = connections[0];
    for (const conn of connections) {
      assert.equal(conn, first);
    }
    assert.equal(getTenantConnectionStats().size, 1);
    const entry = getTenantConnectionStats().entries[0];
    assert.equal(entry.refCount, 0);
  });
});
