process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "tenant-jwt-secret-for-platform-preview-import!!";
process.env.PLATFORM_JWT_SECRET = "platform-jwt-secret-preview-import-32ch!";
process.env.CENTRAL_DB_NAME = "platform_feature_preview_import";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectCentralDB, disconnectAll } from "../config/db.js";
import { previewGlobalModuleChange } from "../services/platformFeatureService.js";

describe("platform feature preview import (disable impact)", () => {
  let mongo;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("previewGlobalModuleChange resolves getPlatformModule without ReferenceError", async () => {
    const result = await previewGlobalModuleChange({
      moduleKey: "liveTracking",
      enabled: false,
    });
    assert.equal(typeof result.totalCompanies, "number");
    assert.equal(typeof result.affectedCompanies, "number");
  });

  it("rejects unknown module keys", async () => {
    await assert.rejects(
      () => previewGlobalModuleChange({ moduleKey: "notARealModule", enabled: false }),
      (err) => err?.code === "UNKNOWN_FEATURE_KEY" || err?.status === 400
    );
  });
});
