process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "new-b02-entitlement-cache-secret-32chars!";
process.env.PLATFORM_JWT_SECRET = "new-b02-platform-jwt-secret-32chars!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_new_b02_cache";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.PLATFORM_ENTITLEMENT_CACHE_TTL_MS = "60000";

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectCentralDB, disconnectAll } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import PlatformPlan from "../models/PlatformPlan.js";
import {
  assertModuleEntitled,
  getEffectiveEntitlementsForCompany,
  getOrCreatePlatformSettings,
} from "../services/platformEntitlementService.js";
import { ensureDefaultPlansSeeded } from "../services/platformPlanService.js";
import { updateGlobalFeatures } from "../services/platformFeatureService.js";
import {
  clearPlatformEntitlementCache,
  getPlatformEntitlementCacheStats,
  resetPlatformEntitlementCacheStats,
} from "../utils/platformEntitlementCache.js";
import { HttpError } from "../utils/httpError.js";

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let mongo;
let company;

before(async () => {
  fs.mkdirSync("D:/tmp/hrms-mongo/new-b02-entitlement-cache", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/new-b02-entitlement-cache" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  await ensureDefaultPlansSeeded();
  await getOrCreatePlatformSettings();
  const trial = await PlatformPlan.findOne({ code: "TRIAL" }).lean();
  company = await Company.create({
    companyName: "NEW-B02 Co",
    slug: `new-b02-${Date.now()}`,
    databaseName: `company_new_b02_${Date.now()}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
    subscription: { plan: "TRIAL", planId: trial._id, status: "ACTIVE" },
  });
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("NEW-B02 platform entitlement cache", () => {
  it("caches PlatformSettings lean reads (hit after miss)", async () => {
    clearPlatformEntitlementCache();
    resetPlatformEntitlementCacheStats();

    const first = await getOrCreatePlatformSettings({ lean: true });
    assert.ok(first);
    const mid = getPlatformEntitlementCacheStats();
    assert.equal(mid.settingsMisses, 1);
    assert.equal(mid.settingsHits, 0);

    const second = await getOrCreatePlatformSettings({ lean: true });
    assert.equal(String(second.singletonKey || "default"), "default");
    const after = getPlatformEntitlementCacheStats();
    assert.equal(after.settingsHits, 1);
    assert.equal(after.settingsMisses, 1);
  });

  it("caches plan resolution across entitlement lookups", async () => {
    clearPlatformEntitlementCache();
    resetPlatformEntitlementCacheStats();

    await getEffectiveEntitlementsForCompany(company.toObject());
    const mid = getPlatformEntitlementCacheStats();
    assert.ok(mid.planMisses >= 1);

    await getEffectiveEntitlementsForCompany(company.toObject());
    const after = getPlatformEntitlementCacheStats();
    assert.ok(after.planHits >= 1);
  });

  it("invalidates settings cache on global feature update so disables fail closed immediately", async () => {
    clearPlatformEntitlementCache();
    await updateGlobalFeatures({
      modules: { chat: true },
      confirm: true,
      admin: { _id: null, email: "pa@test" },
      req: null,
    });
    await assertModuleEntitled(company.toObject(), "chat");

    await updateGlobalFeatures({
      modules: { chat: false },
      confirm: true,
      admin: { _id: null, email: "pa@test" },
      req: null,
    });

    let denied = null;
    try {
      await assertModuleEntitled(company.toObject(), "chat");
    } catch (err) {
      denied = err;
    }
    assert.ok(denied instanceof HttpError);
    assert.equal(denied.status, 403);
    assert.equal(denied.code, "PLATFORM_MODULE_DISABLED");

    // Restore for other suites sharing the DB in this process.
    await updateGlobalFeatures({
      modules: { chat: true },
      confirm: true,
      admin: { _id: null, email: "pa@test" },
      req: null,
    });
  });

  it("writer path still returns a mutable mongoose document (not cached lean)", async () => {
    clearPlatformEntitlementCache();
    const doc = await getOrCreatePlatformSettings();
    assert.equal(typeof doc.save, "function");
    assert.ok(doc.modules);
  });
});
