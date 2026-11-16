process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "tenant-jwt-secret-for-platform-pw-reset-tests!!";
process.env.PLATFORM_JWT_SECRET = "platform-jwt-secret-pw-reset-tests-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_admin_password_reset";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectCentralDB, disconnectAll } from "../config/db.js";
import PlatformAdmin from "../models/PlatformAdmin.js";
import {
  assertPlatformAdminPasswordResetAllowed,
  resetActivePlatformAdminPassword,
} from "../services/platformAdminPasswordResetService.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

describe("Platform Admin password reset (development only)", () => {
  let mongo;
  let previousNodeEnv;
  const email = "platform-reset@hrms.test";
  const oldPassword = "OldPlatformPass123!";
  const newPassword = "NewPlatformPass456!";

  before(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();

    await PlatformAdmin.create({
      singletonKey: "default",
      email,
      passwordHash: await hashPassword(oldPassword),
      fullName: "Platform Admin",
      isActive: true,
      mfaEnabled: false,
      mfaSecretEncrypted: "keep-me-encrypted-blob",
      mfaVerifiedAt: null,
    });
  });

  after(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("rejects password reset when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    assert.throws(
      () => assertPlatformAdminPasswordResetAllowed(),
      /NODE_ENV=development/
    );
    await assert.rejects(
      () => resetActivePlatformAdminPassword(newPassword),
      /NODE_ENV=development/
    );

    const admin = await PlatformAdmin.findOne({ email }).select(
      "+passwordHash +mfaSecretEncrypted email isActive mfaEnabled"
    );
    assert.equal(await verifyPassword(oldPassword, admin.passwordHash), true);
    assert.equal(admin.mfaSecretEncrypted, "keep-me-encrypted-blob");
    assert.equal(admin.mfaEnabled, false);
    assert.equal(admin.isActive, true);
    assert.equal(admin.email, email);
  });

  it("resets the active singleton password in development without touching MFA", async () => {
    process.env.NODE_ENV = "development";

    const result = await resetActivePlatformAdminPassword(newPassword);
    assert.equal(result.email, email);
    assert.ok(result.id);
    assert.equal(result.passwordHash, undefined);
    assert.equal(result.password, undefined);

    const admin = await PlatformAdmin.findOne({ email }).select(
      "+passwordHash +mfaSecretEncrypted +mfaRecoveryCodeHashes email fullName isActive mfaEnabled mfaVerifiedAt passwordChangedAt"
    );

    assert.equal(admin.email, email);
    assert.equal(admin.fullName, "Platform Admin");
    assert.equal(admin.isActive, true);
    assert.equal(admin.mfaEnabled, false);
    assert.equal(admin.mfaVerifiedAt, null);
    assert.equal(admin.mfaSecretEncrypted, "keep-me-encrypted-blob");
    assert.deepEqual(admin.mfaRecoveryCodeHashes, []);
    assert.ok(admin.passwordChangedAt instanceof Date);

    assert.equal(await verifyPassword(newPassword, admin.passwordHash), true);
    assert.equal(await verifyPassword(oldPassword, admin.passwordHash), false);
    assert.equal(String(admin.passwordHash).startsWith("$2"), true);
  });

  it("rejects short passwords under the existing policy", async () => {
    process.env.NODE_ENV = "development";
    await assert.rejects(
      () => resetActivePlatformAdminPassword("short"),
      /at least 12/
    );
  });
});
