process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.FACE_BIOMETRIC_KEY = "test-face-biometric-key-32chars!!";
process.env.HRMS_NATIVE_CLIENT_SECRET = "test-native-client-secret-key";
process.env.ALLOW_LEGACY_NATIVE_HMAC_PROOF = "true";

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { DEFAULT_HR_POLICY } from "../models/CompanyHrPolicy.js";
import { hashPassword } from "../utils/password.js";
import { evaluateWifiEvidence } from "../services/wifiVerificationService.js";
import {
  sanitizeAttendanceVerification,
  resolveAttendanceVerificationConfig,
} from "../services/attendanceVerificationService.js";
import {
  setFaceEngine,
  resetFaceEngine,
  hashSeedToEmbedding,
  enrollEmployeeFace,
  verifyEmployeeFace,
  compareEmbeddings,
} from "../services/faceRecognitionService.js";
import { encryptEmbedding, decryptEmbedding } from "../models/EmployeeFaceEnrollment.js";
import {
  buildNativeClientProof,
  CLIENT_PLATFORM_HEADERS,
} from "../utils/clientPlatform.js";
import { HttpError } from "../utils/httpError.js";

function nativeAndroidHeaders() {
  const timestamp = Date.now();
  const proof = buildNativeClientProof("android", timestamp);
  return {
    [CLIENT_PLATFORM_HEADERS.PLATFORM]: "android",
    [CLIENT_PLATFORM_HEADERS.TIMESTAMP]: String(timestamp),
    [CLIENT_PLATFORM_HEADERS.PROOF]: proof,
  };
}

const OFFICE = { latitude: 17.448293, longitude: 78.374628 };

function farFromOffice() {
  return { latitude: 17.55, longitude: 78.45, accuracy: 20, capturedAt: new Date().toISOString() };
}

function nearOffice() {
  return {
    latitude: OFFICE.latitude + 0.0003,
    longitude: OFFICE.longitude + 0.0003,
    accuracy: 15,
    capturedAt: new Date().toISOString(),
  };
}

describe("attendance verification unit helpers", () => {
  it("rejects verificationRequired with no methods enabled", () => {
    assert.throws(
      () =>
        sanitizeAttendanceVerification({
          attendanceVerification: {
            verificationRequired: true,
            gps: { enabled: false },
            wifi: { enabled: false },
            face: { enabled: false },
          },
        }),
      /at least one/i
    );
  });

  it("defaults keep methods disabled for backward compatibility", () => {
    const cfg = resolveAttendanceVerificationConfig({});
    assert.equal(cfg.gps.enabled, false);
    assert.equal(cfg.wifi.enabled, false);
    assert.equal(cfg.face.enabled, false);
    assert.equal(cfg.verificationRequired, false);
  });

  it("Wi-Fi authorized / unauthorized / unavailable / missing evidence / stale / missing capturedAt", () => {
    const policy = {
      attendanceVerification: {
        wifiNetworks: [{ ssid: "Office-WiFi", bssid: "aa:bb:cc:dd:ee:ff", active: true }],
      },
    };
    assert.equal(
      evaluateWifiEvidence({
        policy,
        clientPlatform: "web",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "aa:bb:cc:dd:ee:ff",
          capturedAt: new Date().toISOString(),
          challengeId: "x",
          challengeNonce: "y",
        },
        mandatory: true,
        requireChallengeFields: true,
      }).ok,
      true
    );
    assert.equal(
      evaluateWifiEvidence({
        policy,
        clientPlatform: "android",
        wifiEvidence: {
          ssid: "Guest",
          bssid: "11:22:33:44:55:66",
          capturedAt: new Date().toISOString(),
          challengeId: "x",
          challengeNonce: "y",
        },
        mandatory: true,
        requireChallengeFields: true,
      }).reason,
      "WIFI_UNAUTHORIZED"
    );
    assert.equal(
      evaluateWifiEvidence({
        policy,
        clientPlatform: "android",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "11:22:33:44:55:66",
          capturedAt: new Date().toISOString(),
          challengeId: "x",
          challengeNonce: "y",
        },
        mandatory: true,
        requireChallengeFields: true,
      }).reason,
      "WIFI_UNAUTHORIZED"
    );
    assert.equal(
      evaluateWifiEvidence({
        policy,
        clientPlatform: "android",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "",
          capturedAt: new Date().toISOString(),
          challengeId: "x",
          challengeNonce: "y",
        },
        mandatory: true,
        requireChallengeFields: true,
      }).reason,
      "WIFI_BSSID_REQUIRED"
    );
    assert.equal(
      evaluateWifiEvidence({
        policy,
        clientPlatform: "android",
        wifiEvidence: {
          ssid: "",
          bssid: "",
          capturedAt: new Date().toISOString(),
          challengeId: "x",
          challengeNonce: "y",
          clientReason: "WIFI_DISABLED",
        },
        mandatory: true,
        requireChallengeFields: true,
      }).reason,
      "WIFI_DISABLED"
    );
    assert.equal(
      evaluateWifiEvidence({
        policy,
        clientPlatform: "android",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "aa:bb:cc:dd:ee:ff",
          wifiEnabled: false,
          capturedAt: new Date().toISOString(),
          challengeId: "x",
          challengeNonce: "y",
          clientReason: "WIFI_DISABLED",
        },
        mandatory: true,
        requireChallengeFields: true,
      }).reason,
      "WIFI_DISABLED",
      "cached SSID while radio off must not authorize"
    );
    assert.equal(
      evaluateWifiEvidence({
        policy,
        clientPlatform: "web",
        wifiEvidence: null,
        mandatory: true,
      }).reason,
      "WIFI_EVIDENCE_MISSING"
    );
    assert.equal(
      evaluateWifiEvidence({
        policy,
        clientPlatform: "android",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "aa:bb:cc:dd:ee:ff",
          challengeId: "x",
          challengeNonce: "y",
        },
        mandatory: true,
        requireChallengeFields: true,
      }).reason,
      "WIFI_CAPTURED_AT_REQUIRED"
    );
    assert.equal(
      evaluateWifiEvidence({
        policy,
        clientPlatform: "android",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "aa:bb:cc:dd:ee:ff",
          capturedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          challengeId: "x",
          challengeNonce: "y",
        },
        mandatory: true,
        requireChallengeFields: true,
      }).reason,
      "WIFI_EVIDENCE_STALE"
    );
    assert.equal(
      evaluateWifiEvidence({
        policy: {
          attendanceVerification: {
            wifiNetworks: [{ ssid: "Samsung-5G", bssid: "", active: true }],
          },
        },
        clientPlatform: "android",
        wifiEvidence: {
          ssid: "Samsung-5G",
          bssid: "aa:bb:cc:dd:ee:ff",
          capturedAt: new Date().toISOString(),
          challengeId: "x",
          challengeNonce: "y",
        },
        mandatory: true,
        requireChallengeFields: true,
      }).reason,
      "WIFI_POLICY_REQUIRES_BSSID"
    );
  });

  it("encrypts embeddings and compares match/mismatch", () => {
    const emb = hashSeedToEmbedding("alice");
    const sealed = encryptEmbedding(emb);
    const back = decryptEmbedding(sealed);
    assert.equal(back.length, emb.length);
    assert.equal(compareEmbeddings(emb, emb, 0.55).matched, true);
    assert.equal(compareEmbeddings(emb, hashSeedToEmbedding("bob"), 0.55).matched, false);
  });
});

describe("face liveness provider registry (Phase 1)", () => {
  async function loadRegistry() {
    return import("../services/faceLivenessProvider.js");
  }

  function withEnv(provider, fn) {
    const prev = process.env.FACE_LIVENESS_PROVIDER;
    const prevNode = process.env.NODE_ENV;
    return (async () => {
      try {
        if (provider === undefined) delete process.env.FACE_LIVENESS_PROVIDER;
        else process.env.FACE_LIVENESS_PROVIDER = provider;
        await fn();
      } finally {
        process.env.NODE_ENV = prevNode;
        if (prev === undefined) delete process.env.FACE_LIVENESS_PROVIDER;
        else process.env.FACE_LIVENESS_PROVIDER = prev;
      }
    })();
  }

  function assertMandatoryFaceSanitizeBlocked() {
    // Keep NODE_ENV=test so recognition-model disk probe is skipped; liveness registry still fails.
    setFaceEngine({
      analyze: async () => ({
        ok: true,
        faceCount: 1,
        embedding: hashSeedToEmbedding("alice"),
        livenessScore: 0.9,
      }),
    });
    assert.throws(
      () =>
        sanitizeAttendanceVerification({
          attendanceVerification: {
            verificationRequired: true,
            gps: { enabled: false },
            wifi: { enabled: false },
            face: { enabled: true, mandatory: true, matchThreshold: 0.55, requireLiveness: true },
          },
        }),
      /mandatory face|liveness|Unknown FACE_LIVENESS_PROVIDER|PAD|MiniFASNet|not implemented|Phase 2/i
    );
  }

  it("arbitrary provider strings cannot unlock mandatory verification", async () => {
    const { isValidatedLivenessConfigured } = await loadRegistry();
    await withEnv("vendor:paid-api", () => {
      process.env.NODE_ENV = "production";
      const status = isValidatedLivenessConfigured();
      assert.equal(status.ok, false);
      assert.equal(status.reason, "UNKNOWN_PROVIDER");
    });
    await withEnv("challenge-response", () => {
      process.env.NODE_ENV = "production";
      assert.equal(isValidatedLivenessConfigured().ok, false);
      assert.equal(isValidatedLivenessConfigured().reason, "UNKNOWN_PROVIDER");
    });
    await withEnv("vendor:paid-api", () => {
      process.env.NODE_ENV = "test";
      assertMandatoryFaceSanitizeBlocked();
    });
  });

  it("heuristic-only verification cannot unlock mandatory verification", async () => {
    const { isValidatedLivenessConfigured } = await loadRegistry();
    await withEnv("heuristic", () => {
      process.env.NODE_ENV = "production";
      const status = isValidatedLivenessConfigured();
      assert.equal(status.ok, false);
      assert.equal(status.reason, "NOT_VALIDATED_PAD");
    });
    await withEnv(undefined, () => {
      process.env.NODE_ENV = "production";
      const status = isValidatedLivenessConfigured();
      assert.equal(status.ok, false);
      assert.equal(status.provider, "heuristic");
    });
    await withEnv("heuristic", () => {
      process.env.NODE_ENV = "test";
      assertMandatoryFaceSanitizeBlocked();
    });
  });

  it("uninitialized / not-implemented MiniFASNet cannot unlock mandatory verification", async () => {
    const { isValidatedLivenessConfigured, getLivenessProvider } = await loadRegistry();
    await withEnv("minifasnet", () => {
      process.env.NODE_ENV = "production";
      const entry = getLivenessProvider("minifasnet");
      assert.equal(entry.implemented, false);
      assert.equal(entry.isReady().ok, false);
      const status = isValidatedLivenessConfigured();
      assert.equal(status.ok, false);
      assert.ok(["NOT_IMPLEMENTED", "NOT_READY"].includes(status.reason));
    });
    await withEnv("minifasnet", () => {
      process.env.NODE_ENV = "test";
      assertMandatoryFaceSanitizeBlocked();
    });
  });

  it("missing PAD models cannot unlock mandatory verification (minifasnet not ready)", async () => {
    const { isValidatedLivenessConfigured } = await loadRegistry();
    // Phase 1: minifasnet is registered as PAD but has no models/integration — isReady fails.
    await withEnv("minifasnet", () => {
      process.env.NODE_ENV = "development";
      const status = isValidatedLivenessConfigured();
      assert.equal(status.ok, false);
      assert.match(status.message || "", /not implemented|Phase 2|models|unavailable/i);
    });
  });

  it("test-harness cannot unlock outside NODE_ENV=test", async () => {
    const { isValidatedLivenessConfigured } = await loadRegistry();
    await withEnv("test-harness", () => {
      process.env.NODE_ENV = "production";
      const status = isValidatedLivenessConfigured();
      assert.equal(status.ok, false);
      assert.equal(status.reason, "NOT_READY");
    });
  });

  it("existing recognition encryption flows remain intact", () => {
    const emb = hashSeedToEmbedding("phase1-alice");
    const sealed = encryptEmbedding(emb);
    assert.ok(sealed.embeddingCiphertext);
    assert.ok(sealed.embeddingIv);
    assert.ok(sealed.embeddingAuthTag);
    const back = decryptEmbedding(sealed);
    assert.equal(compareEmbeddings(emb, back, 0.01).matched, true);
  });
});

describe("attendance verification integration", () => {
  let mongoServer;
  let app;
  let server;
  let models;
  let company;
  let employeeUser;
  let employee;
  let cookies = {};
  let prevFaceLivenessProvider;

  async function punchChallenge(cookie) {
    const res = await request(app)
      .post("/api/employees/me/attendance/verification-challenge")
      .set("Cookie", cookie);
    assert.equal(res.status, 200, res.body.message);
    return {
      challengeId: res.body.challengeId,
      challengeNonce: res.body.nonce,
    };
  }

  before(async () => {
    // Mandatory-face punch tests need a registered PAD unlock; production stays locked.
    prevFaceLivenessProvider = process.env.FACE_LIVENESS_PROVIDER;
    process.env.FACE_LIVENESS_PROVIDER = "test-harness";

    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    await connectCentralDB();
    app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));

    const slug = `verify-${Date.now()}`;
    company = await Company.create({
      name: "Verify Co",
      companyName: "Verify Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata", currencyCode: "INR" },
      hrAccessEnforcement: { mode: "OFF" },
    });
    models = await getCompanyModels(company, { provision: true });

    const passwordHash = await hashPassword("Password123!");
    await models.User.create({
      email: "hr.verify@example.com",
      passwordHash,
      role: "HR_ADMIN",
      isActive: true,
    });
    employeeUser = await models.User.create({
      email: "emp.verify@example.com",
      passwordHash,
      role: "EMPLOYEE",
      isActive: true,
    });
    employee = await models.Employee.create({
      companyId: company._id,
      userId: employeeUser._id,
      email: employeeUser.email,
      fullName: "Emp Verify",
      employeeCode: "EV-1",
      status: "ACTIVE",
      job: { jobTitle: "Engineer", workArrangement: { mode: "OFFICE" } },
    });

    await models.CompanyHrPolicy.deleteMany({});
    await models.CompanyHrPolicy.create({
      ...DEFAULT_HR_POLICY,
      effectiveFromDate: new Date("2020-01-01"),
      locationRules: {
        ...DEFAULT_HR_POLICY.locationRules,
        requireLocationForPunch: true,
        geofenceEnabled: true,
        geofenceRadiusMeters: 300,
        officeLatitude: OFFICE.latitude,
        officeLongitude: OFFICE.longitude,
        officeName: "HQ",
        outOfRadiusPolicy: "BLOCK",
        maxAccuracyMeters: 80,
        accuracyFailurePolicy: "BLOCK",
        gpsFailurePolicy: "BLOCK",
      },
      attendanceVerification: {
        verificationRequired: false,
        gps: { enabled: false, mandatory: true },
        wifi: { enabled: false, mandatory: true },
        face: { enabled: false, mandatory: true, matchThreshold: 0.55, requireLiveness: true },
        wifiNetworks: [{ label: "HQ", ssid: "Office-WiFi", bssid: "aa:bb:cc:dd:ee:ff", active: true }],
      },
      schemaVersion: 2,
    });

    const hrLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "hr.verify@example.com", password: "Password123!", companyCode: company.slug });
    assert.equal(hrLogin.status, 200);
    cookies.hr = hrLogin.headers["set-cookie"];

    const empLogin = await request(app)
      .post("/api/auth/login")
      .set(nativeAndroidHeaders())
      .send({ email: "emp.verify@example.com", password: "Password123!", companyCode: company.slug });
    assert.equal(empLogin.status, 200);
    cookies.emp = empLogin.headers["set-cookie"];

    // Separate web session for desktop Wi-Fi unsupported cases
    const empWebLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "emp.verify@example.com", password: "Password123!", companyCode: company.slug });
    assert.equal(empWebLogin.status, 200);
    cookies.empWeb = empWebLogin.headers["set-cookie"];
  });

  after(async () => {
    resetFaceEngine();
    if (prevFaceLivenessProvider === undefined) delete process.env.FACE_LIVENESS_PROVIDER;
    else process.env.FACE_LIVENESS_PROVIDER = prevFaceLivenessProvider;
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectAll();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(() => {
    setFaceEngine({
      analyze: async (buffer, { requireLiveness }) => {
        const text = buffer.toString("utf8");
        if (text.includes("NOFACE")) {
          return { ok: false, reason: "NO_FACE_DETECTED", message: "No face", faceCount: 0, embedding: null };
        }
        if (text.includes("MULTIFACE")) {
          return { ok: false, reason: "MULTIPLE_FACES", message: "Multiple faces", faceCount: 2, embedding: null };
        }
        if (text.includes("DEAD") && requireLiveness) {
          return {
            ok: false,
            reason: "LIVENESS_FAILED",
            message: "Liveness failed",
            faceCount: 1,
            embedding: null,
            livenessScore: 0.1,
          };
        }
        const seed = text.includes("BOB") ? "bob" : "alice";
        return {
          ok: true,
          reason: "FACE_CAPTURED",
          message: "ok",
          faceCount: 1,
          embedding: hashSeedToEmbedding(seed),
          livenessScore: 0.9,
          qualityScore: 0.85,
          modelId: "test-engine",
          modelVersion: "1",
        };
      },
    });
  });

  async function setVerification(partial) {
    await models.CompanyHrPolicy.updateMany(
      {},
      {
        $set: {
          attendanceVerification: {
            verificationRequired: true,
            gps: { enabled: false, mandatory: true },
            wifi: { enabled: false, mandatory: true },
            face: { enabled: false, mandatory: true, matchThreshold: 0.55, requireLiveness: true },
            wifiNetworks: [{ label: "HQ", ssid: "Office-WiFi", bssid: "aa:bb:cc:dd:ee:ff", active: true }],
            ...partial,
          },
        },
      }
    );
  }

  async function ensureOut() {
    await models.Attendance.deleteMany({});
  }

  it("GPS outside radius is rejected when geofence enforced", async () => {
    await ensureOut();
    await setVerification({ verificationRequired: false });
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: farFromOffice(), sessionType: "OFFICE" });
    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /geofence|radius|outside|location|permitted/i);
  });

  it("GPS accuracy failure blocks when policy is BLOCK", async () => {
    await ensureOut();
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: { ...nearOffice(), accuracy: 500 }, sessionType: "OFFICE" });
    assert.equal(res.status, 400);
  });

  it("mandatory Wi-Fi rejects missing challenge even with SSID payload", async () => {
    await ensureOut();
    await setVerification({ wifi: { enabled: true, mandatory: true } });
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.empWeb)
      .send({
        location: nearOffice(),
        sessionType: "OFFICE",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "aa:bb:cc:dd:ee:ff",
          capturedAt: new Date().toISOString(),
          platform: "android",
        },
      });
    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /expired|challenge|Wi-Fi|authorized/i);
  });

  it("authorized Wi-Fi passes with challenge on web AuthSession (platform informational)", async () => {
    await ensureOut();
    await setVerification({ wifi: { enabled: true, mandatory: true } });
    const ch = await punchChallenge(cookies.empWeb);
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.empWeb)
      .send({
        location: nearOffice(),
        sessionType: "OFFICE",
        clientPlatform: "android",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "aa:bb:cc:dd:ee:ff",
          capturedAt: new Date().toISOString(),
          platform: "android",
          ...ch,
        },
      });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.session?.verification?.methods?.some((m) => m.method === "WIFI" && m.ok), true);
  });

  it("authorized Wi-Fi passes with GPS inside radius", async () => {
    await ensureOut();
    await setVerification({ wifi: { enabled: true, mandatory: true } });
    const ch = await punchChallenge(cookies.emp);
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: nearOffice(),
        sessionType: "OFFICE",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "aa:bb:cc:dd:ee:ff",
          capturedAt: new Date().toISOString(),
          ...ch,
        },
      });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.session?.verification?.methods?.some((m) => m.method === "WIFI" && m.ok), true);
  });

  it("rejects reused Wi-Fi challenge (replay)", async () => {
    await ensureOut();
    await setVerification({ wifi: { enabled: true, mandatory: true } });
    const ch = await punchChallenge(cookies.emp);
    const payload = {
      location: nearOffice(),
      sessionType: "OFFICE",
      wifiEvidence: {
        ssid: "Office-WiFi",
        bssid: "aa:bb:cc:dd:ee:ff",
        capturedAt: new Date().toISOString(),
        ...ch,
      },
    };
    const first = await request(app).post("/api/employees/me/attendance/punch-in").set("Cookie", cookies.emp).send(payload);
    assert.equal(first.status, 200, first.body.message);
    await models.Attendance.deleteMany({});
    const second = await request(app).post("/api/employees/me/attendance/punch-in").set("Cookie", cookies.emp).send(payload);
    assert.equal(second.status, 400);
    assert.match(second.body.message || "", /expired|already used|replay|challenge/i);
  });

  it("ignores forged body clientPlatform and rejects forged challenge", async () => {
    await ensureOut();
    await setVerification({ wifi: { enabled: true, mandatory: true } });
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.empWeb)
      .send({
        location: nearOffice(),
        sessionType: "OFFICE",
        clientPlatform: "android",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "aa:bb:cc:dd:ee:ff",
          capturedAt: new Date().toISOString(),
          challengeId: "forged",
          challengeNonce: "forged",
        },
      });
    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /expired|challenge|invalid|Wi-Fi/i);
  });

  it("rejects expired Wi-Fi challenge", async () => {
    await ensureOut();
    await setVerification({ wifi: { enabled: true, mandatory: true } });
    const ch = await punchChallenge(cookies.emp);
    await models.AttendanceVerificationChallenge.updateOne(
      { _id: ch.challengeId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: nearOffice(),
        sessionType: "OFFICE",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "aa:bb:cc:dd:ee:ff",
          capturedAt: new Date().toISOString(),
          ...ch,
        },
      });
    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /expired|challenge/i);
  });

  it("unauthorized Wi-Fi rejects when mandatory", async () => {
    await ensureOut();
    await setVerification({ wifi: { enabled: true, mandatory: true } });
    const ch = await punchChallenge(cookies.emp);
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: nearOffice(),
        sessionType: "OFFICE",
        wifiEvidence: {
          ssid: "Cafe",
          bssid: "11:22:33:44:55:66",
          capturedAt: new Date().toISOString(),
          ...ch,
        },
      });
    assert.equal(res.status, 400);
  });

  it("optional Wi-Fi failure does not block punch", async () => {
    await ensureOut();
    await setVerification({
      verificationRequired: true,
      wifi: { enabled: true, mandatory: false },
      gps: { enabled: false, mandatory: true },
    });
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: nearOffice(),
        sessionType: "OFFICE",
        clientPlatform: "android",
        wifiEvidence: {
          ssid: "Cafe",
          bssid: "11:22:33:44:55:66",
          capturedAt: new Date().toISOString(),
          platform: "android",
        },
      });
    assert.equal(res.status, 200, res.body.message);
  });

  describe("mandatory Wi-Fi enforcement matrix", () => {
    const AUTH = {
      ssid: "Samsung-5G",
      bssid: "aa:bb:cc:dd:ee:ff",
    };

    async function enableMandatorySamsungWifi() {
      await setVerification({
        wifi: { enabled: true, mandatory: true },
        gps: { enabled: false, mandatory: true },
        wifiNetworks: [
          {
            label: "Office Samsung",
            ssid: AUTH.ssid,
            bssid: AUTH.bssid,
            active: true,
          },
        ],
      });
    }

    async function assertNoOpenSession() {
      const open = await models.Attendance.find({ openSessionId: { $ne: null } }).lean();
      assert.equal(open.length, 0);
    }

    it("1. authorized SSID and BSSID → accepted", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: "Samsung-5G",
            bssid: "AA-BB-CC-DD-EE-FF",
            capturedAt: new Date().toISOString(),
            ...ch,
          },
        });
      assert.equal(res.status, 200, res.body.message);
      assert.equal(res.body.session?.verification?.methods?.some((m) => m.method === "WIFI" && m.ok), true);
    });

    it("2. unauthorized SSID → rejected", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: "Other-SSID",
            bssid: AUTH.bssid,
            capturedAt: new Date().toISOString(),
            ...ch,
          },
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message || "", /not authorized/i);
      await assertNoOpenSession();
    });

    it("3. unauthorized BSSID → rejected", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: AUTH.ssid,
            bssid: "11:22:33:44:55:66",
            capturedAt: new Date().toISOString(),
            ...ch,
          },
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message || "", /not authorized/i);
      await assertNoOpenSession();
    });

    it("4. missing SSID → rejected", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: "",
            bssid: AUTH.bssid,
            capturedAt: new Date().toISOString(),
            ...ch,
          },
        });
      assert.equal(res.status, 400);
      await assertNoOpenSession();
    });

    it("5. missing BSSID when required → rejected", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: AUTH.ssid,
            bssid: "",
            capturedAt: new Date().toISOString(),
            ...ch,
          },
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message || "", /detect Wi-Fi|permissions|authorized/i);
      await assertNoOpenSession();
    });

    it("6. Wi-Fi disabled → rejected", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: "",
            bssid: "",
            capturedAt: new Date().toISOString(),
            clientReason: "WIFI_DISABLED",
            ...ch,
          },
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message || "", /Connect to an authorized company Wi-Fi network/i);
      await assertNoOpenSession();
    });

    it("6b. Wi-Fi OFF + mobile data ON → rejected (no connected network)", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          // Android: radio off, mobile data on — empty identifiers + explicit radio-off flags
          wifiEvidence: {
            ssid: "",
            bssid: "",
            wifiEnabled: false,
            clientReason: "WIFI_DISABLED",
            capturedAt: new Date().toISOString(),
            platform: "android",
            ...ch,
          },
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message || "", /Connect to an authorized company Wi-Fi network/i);
      await assertNoOpenSession();
    });

    it("6c. Wi-Fi OFF must not accept cached authorized SSID/BSSID", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: AUTH.ssid,
            bssid: AUTH.bssid,
            wifiEnabled: false,
            clientReason: "WIFI_DISABLED",
            capturedAt: new Date().toISOString(),
            platform: "android",
            ...ch,
          },
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message || "", /Connect to an authorized company Wi-Fi network/i);
      await assertNoOpenSession();
    });

    it("7. mobile data (no SSID/BSSID) → rejected", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: "",
            bssid: "02:00:00:00:00:00",
            capturedAt: new Date().toISOString(),
            clientReason: "WIFI_UNAVAILABLE",
            ...ch,
          },
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message || "", /Connect to an authorized company Wi-Fi network/i);
      await assertNoOpenSession();
    });

    it("8. missing challenge → rejected", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: AUTH.ssid,
            bssid: AUTH.bssid,
            capturedAt: new Date().toISOString(),
          },
        });
      assert.equal(res.status, 400);
      await assertNoOpenSession();
    });

    it("9. expired challenge → rejected", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      await models.AttendanceVerificationChallenge.updateOne(
        { _id: ch.challengeId },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: AUTH.ssid,
            bssid: AUTH.bssid,
            capturedAt: new Date().toISOString(),
            ...ch,
          },
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message || "", /Verification expired/i);
      await assertNoOpenSession();
    });

    it("10. reused challenge → rejected", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      const payload = {
        location: nearOffice(),
        sessionType: "OFFICE",
        wifiEvidence: {
          ssid: AUTH.ssid,
          bssid: AUTH.bssid,
          capturedAt: new Date().toISOString(),
          ...ch,
        },
      };
      const first = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send(payload);
      assert.equal(first.status, 200, first.body.message);
      await models.Attendance.deleteMany({});
      const second = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send(payload);
      assert.equal(second.status, 400);
      assert.match(second.body.message || "", /Verification expired/i);
      await assertNoOpenSession();
    });

    it("11. client-forged wifiVerified:true → rejected", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiVerified: true,
          wifiEvidence: {
            ssid: "Cafe",
            bssid: "11:22:33:44:55:66",
            capturedAt: new Date().toISOString(),
            challengeId: "000000000000000000000000",
            challengeNonce: "forged",
          },
        });
      assert.equal(res.status, 400);
      await assertNoOpenSession();
    });

    it("12. punch-out enforces mandatory Wi-Fi", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const chIn = await punchChallenge(cookies.emp);
      const punchIn = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: AUTH.ssid,
            bssid: AUTH.bssid,
            capturedAt: new Date().toISOString(),
            ...chIn,
          },
        });
      assert.equal(punchIn.status, 200, punchIn.body.message);

      const chOutBad = await punchChallenge(cookies.emp);
      const badOut = await request(app)
        .post("/api/employees/me/attendance/punch-out")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          wifiEvidence: {
            ssid: "Cafe",
            bssid: "11:22:33:44:55:66",
            capturedAt: new Date().toISOString(),
            ...chOutBad,
          },
        });
      assert.equal(badOut.status, 400);
      assert.match(badOut.body.message || "", /not authorized/i);

      const stillOpen = await models.Attendance.find({ openSessionId: { $ne: null } }).lean();
      assert.equal(stillOpen.length, 1);

      const chOutOk = await punchChallenge(cookies.emp);
      const goodOut = await request(app)
        .post("/api/employees/me/attendance/punch-out")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          wifiEvidence: {
            ssid: AUTH.ssid,
            bssid: AUTH.bssid,
            capturedAt: new Date().toISOString(),
            ...chOutOk,
          },
        });
      assert.equal(goodOut.status, 200, goodOut.body.message);
      await assertNoOpenSession();
    });

    it("13. optional Wi-Fi does not block attendance", async () => {
      await ensureOut();
      await setVerification({
        verificationRequired: true,
        wifi: { enabled: true, mandatory: false },
        gps: { enabled: false, mandatory: true },
        wifiNetworks: [
          { label: "Office Samsung", ssid: AUTH.ssid, bssid: AUTH.bssid, active: true },
        ],
      });
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: "Home-WiFi",
            bssid: "de:ad:be:ef:00:01",
            capturedAt: new Date().toISOString(),
          },
        });
      assert.equal(res.status, 200, res.body.message);
    });

    it("14. other companies' network configurations cannot be used", async () => {
      await ensureOut();
      await enableMandatorySamsungWifi();
      const ch = await punchChallenge(cookies.emp);
      // Evidence matches a hypothetical other company's AP, not this tenant's Samsung-5G entry.
      const res = await request(app)
        .post("/api/employees/me/attendance/punch-in")
        .set("Cookie", cookies.emp)
        .send({
          location: nearOffice(),
          sessionType: "OFFICE",
          wifiEvidence: {
            ssid: "OtherCo-Corp",
            bssid: "99:88:77:66:55:44",
            capturedAt: new Date().toISOString(),
            ...ch,
          },
        });
      assert.equal(res.status, 400);
      assert.match(res.body.message || "", /not authorized/i);
      await assertNoOpenSession();
    });

    it("sanitize: mandatory Wi-Fi requires BSSID and preserves networks when omitted", () => {
      assert.throws(
        () =>
          sanitizeAttendanceVerification({
            attendanceVerification: {
              wifi: { enabled: true, mandatory: true },
              wifiNetworks: [{ label: "OnlySSID", ssid: "Samsung-5G", bssid: "", active: true }],
            },
          }),
        /BSSID|router MAC/i
      );

      const preserved = sanitizeAttendanceVerification(
        {
          attendanceVerification: {
            wifi: { enabled: true, mandatory: true },
            gps: { enabled: false },
            face: { enabled: false },
          },
        },
        {
          attendanceVerification: {
            wifi: { enabled: true, mandatory: true },
            wifiNetworks: [{ label: "HQ", ssid: "Samsung-5G", bssid: "aa:bb:cc:dd:ee:ff", active: true }],
          },
        }
      );
      assert.equal(preserved.wifiNetworks.length, 1);
      assert.equal(preserved.wifiNetworks[0].bssid, "aa:bb:cc:dd:ee:ff");
    });
  });

  it("face enrollment match/mismatch/missing/liveness/multi-face", async () => {
    await models.EmployeeFaceEnrollment.deleteMany({});
    const enroll = await enrollEmployeeFace({
      FaceEnrollment: models.EmployeeFaceEnrollment,
      companyId: company._id,
      employeeId: employee._id,
      enrolledBy: employeeUser._id,
      imageBase64: Buffer.from("ALICE-FACE").toString("base64"),
      consentAccepted: true,
    });
    assert.ok(enroll.enrollmentId);

    assert.equal(
      (
        await verifyEmployeeFace({
          FaceEnrollment: models.EmployeeFaceEnrollment,
          companyId: company._id,
          employeeId: employee._id,
          imageBase64: Buffer.from("ALICE-FACE").toString("base64"),
        })
      ).ok,
      true
    );

    const mismatch = await verifyEmployeeFace({
      FaceEnrollment: models.EmployeeFaceEnrollment,
      companyId: company._id,
      employeeId: employee._id,
      imageBase64: Buffer.from("BOB-FACE").toString("base64"),
    });
    assert.equal(mismatch.reason, "FACE_MISMATCH");

    await models.EmployeeFaceEnrollment.deleteMany({});
    const missing = await verifyEmployeeFace({
      FaceEnrollment: models.EmployeeFaceEnrollment,
      companyId: company._id,
      employeeId: employee._id,
      imageBase64: Buffer.from("ALICE-FACE").toString("base64"),
    });
    assert.equal(missing.reason, "FACE_NOT_ENROLLED");

    setFaceEngine({
      analyze: async () => ({
        ok: false,
        reason: "LIVENESS_FAILED",
        message: "Liveness failed",
        faceCount: 1,
        embedding: null,
        livenessScore: 0.1,
      }),
    });
    await assert.rejects(
      () =>
        enrollEmployeeFace({
          FaceEnrollment: models.EmployeeFaceEnrollment,
          companyId: company._id,
          employeeId: employee._id,
          enrolledBy: employeeUser._id,
          imageBase64: Buffer.from("ALICE-FACE").toString("base64"),
          consentAccepted: true,
        }),
      (err) => err instanceof HttpError
    );

    setFaceEngine({
      analyze: async () => ({
        ok: false,
        reason: "MULTIPLE_FACES",
        message: "Multiple faces",
        faceCount: 2,
        embedding: null,
      }),
    });
    await assert.rejects(
      () =>
        enrollEmployeeFace({
          FaceEnrollment: models.EmployeeFaceEnrollment,
          companyId: company._id,
          employeeId: employee._id,
          enrolledBy: employeeUser._id,
          imageBase64: Buffer.from("MULTIFACE").toString("base64"),
          consentAccepted: true,
        }),
      /Multiple faces/i
    );
  });

  it("mandatory face blocks punch without image; faceVerified claim ignored", async () => {
    await ensureOut();
    await models.EmployeeFaceEnrollment.deleteMany({});
    setFaceEngine({
      analyze: async () => ({
        ok: true,
        reason: "FACE_CAPTURED",
        faceCount: 1,
        embedding: hashSeedToEmbedding("alice"),
        livenessScore: 0.9,
        qualityScore: 0.9,
      }),
    });
    const enrolled = await enrollEmployeeFace({
      FaceEnrollment: models.EmployeeFaceEnrollment,
      companyId: company._id,
      employeeId: employee._id,
      enrolledBy: employeeUser._id,
      imageBase64: Buffer.from("ALICE-FACE").toString("base64"),
      consentAccepted: true,
    });
    assert.ok(enrolled.enrollmentId);
    const active = await models.EmployeeFaceEnrollment.findOne({
      employeeId: employee._id,
      status: "ACTIVE",
    });
    assert.ok(active, "expected active enrollment");
    // Align companyId with whatever the employee document stores (or company._id)
    if (!employee.companyId) {
      employee.companyId = company._id;
      await employee.save();
    }
    await setVerification({
      face: { enabled: true, mandatory: true, matchThreshold: 0.55, requireLiveness: true },
      wifi: { enabled: false, mandatory: true },
    });

    const noImage = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({ location: nearOffice(), sessionType: "OFFICE", faceVerified: true });
    assert.equal(noImage.status, 400);

    const ok = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: nearOffice(),
        sessionType: "OFFICE",
        faceImageBase64: Buffer.from("ALICE-FACE").toString("base64"),
      });
    assert.equal(ok.status, 200, ok.body.message);
  });

  it("multiple mandatory methods require Wi-Fi and face", async () => {
    await ensureOut();
    await models.EmployeeFaceEnrollment.deleteMany({});
    setFaceEngine({
      analyze: async () => ({
        ok: true,
        reason: "FACE_CAPTURED",
        faceCount: 1,
        embedding: hashSeedToEmbedding("alice"),
        livenessScore: 0.9,
        qualityScore: 0.9,
      }),
    });
    await enrollEmployeeFace({
      FaceEnrollment: models.EmployeeFaceEnrollment,
      companyId: company._id,
      employeeId: employee._id,
      enrolledBy: employeeUser._id,
      imageBase64: Buffer.from("ALICE-FACE").toString("base64"),
      consentAccepted: true,
    });
    await setVerification({
      wifi: { enabled: true, mandatory: true },
      face: { enabled: true, mandatory: true, matchThreshold: 0.55, requireLiveness: true },
    });

    const ch = await punchChallenge(cookies.emp);
    const res = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", cookies.emp)
      .send({
        location: nearOffice(),
        sessionType: "OFFICE",
        wifiEvidence: {
          ssid: "Office-WiFi",
          bssid: "aa:bb:cc:dd:ee:ff",
          capturedAt: new Date().toISOString(),
          ...ch,
        },
        faceImageBase64: Buffer.from("ALICE-FACE").toString("base64"),
      });
    assert.equal(res.status, 200, res.body.message);
    const methods = res.body.session?.verification?.methods || [];
    assert.ok(methods.some((m) => m.method === "WIFI" && m.ok));
    assert.ok(methods.some((m) => m.method === "FACE" && m.ok));
  });

  it("Play Integrity attestation routes are removed", async () => {
    const challenge = await request(app)
      .post("/api/auth/attest-challenge")
      .set("Cookie", cookies.emp)
      .send({});
    const attest = await request(app)
      .post("/api/auth/attest-device")
      .set("Cookie", cookies.emp)
      .send({ challengeId: "x", nonce: "y", integrityToken: "z" });
    assert.equal(challenge.status, 404);
    assert.equal(attest.status, 404);
  });

  it("mandatory face is blocked without validated liveness outside test bypass", async () => {
    const { isValidatedLivenessConfigured } = await import("../services/faceRecognitionService.js");
    const prev = process.env.NODE_ENV;
    const prevProvider = process.env.FACE_LIVENESS_PROVIDER;
    setFaceEngine({
      analyze: async () => ({
        ok: true,
        reason: "FACE_CAPTURED",
        faceCount: 1,
        embedding: hashSeedToEmbedding("alice"),
        livenessScore: 0.9,
      }),
    });
    process.env.NODE_ENV = "production";
    delete process.env.FACE_LIVENESS_PROVIDER;
    const status = isValidatedLivenessConfigured();
    assert.equal(status.ok, false);
    // Sanitize model-disk probe skips when NODE_ENV=test; use test + empty provider for policy gate.
    process.env.NODE_ENV = "test";
    delete process.env.FACE_LIVENESS_PROVIDER;
    assert.throws(
      () =>
        sanitizeAttendanceVerification({
          attendanceVerification: {
            verificationRequired: true,
            gps: { enabled: false },
            wifi: { enabled: false },
            face: { enabled: true, mandatory: true, matchThreshold: 0.55, requireLiveness: true },
          },
        }),
      /liveness|mandatory face|PAD|heuristic/i
    );
    process.env.NODE_ENV = prev;
    if (prevProvider === undefined) delete process.env.FACE_LIVENESS_PROVIDER;
    else process.env.FACE_LIVENESS_PROVIDER = prevProvider;
  });

  it("biometric key helper rejects production without FACE_BIOMETRIC_KEY", async () => {
    const { validateFaceBiometricKeyConfig } = await import("../utils/biometricKey.js");
    const prev = process.env.NODE_ENV;
    const prevKey = process.env.FACE_BIOMETRIC_KEY;
    process.env.NODE_ENV = "production";
    delete process.env.FACE_BIOMETRIC_KEY;
    delete process.env.HRMS_FACE_BIOMETRIC_KEY;
    assert.throws(() => validateFaceBiometricKeyConfig({ throwOnError: true }), /FACE_BIOMETRIC_KEY/);
    process.env.NODE_ENV = prev;
    process.env.FACE_BIOMETRIC_KEY = prevKey;
  });

  it("HR policy update persists attendanceVerification", async () => {
    const active = await request(app).get("/api/policies/active").set("Cookie", cookies.hr);
    assert.equal(active.status, 200);
    const id = active.body.policy?._id;
    const put = await request(app)
      .put(`/api/policies/${id}`)
      .set("Cookie", cookies.hr)
      .send({
        attendanceVerification: {
          verificationRequired: true,
          gps: { enabled: true, mandatory: true },
          wifi: { enabled: true, mandatory: false },
          face: { enabled: false, mandatory: true, matchThreshold: 0.5, requireLiveness: true },
          wifiNetworks: [{ label: "Floor2", ssid: "Office-F2", bssid: "", active: true }],
        },
      });
    assert.ok([200, 201].includes(put.status), put.body.message);
    const again = await request(app).get("/api/policies/active").set("Cookie", cookies.hr);
    assert.equal(again.body.policy.attendanceVerification.gps.enabled, true);
    assert.equal(again.body.policy.attendanceVerification.wifi.mandatory, false);
  });

  it("employee cannot revoke another employee face via HR admin route", async () => {
    const res = await request(app)
      .delete(`/api/employees/${employee._id}/face-enrollment`)
      .set("Cookie", cookies.emp);
    assert.ok(res.status === 403 || res.status === 401);
  });

  it("status endpoint exposes verification requirements without embeddings", async () => {
    const res = await request(app).get("/api/employees/me/attendance/status").set("Cookie", cookies.emp);
    assert.equal(res.status, 200);
    assert.ok(res.body.attendance.verificationRequirements);
    assert.equal(res.body.attendance.faceEnrollment?.embeddingCiphertext, undefined);
  });

  it("tenant isolation: face verify never uses another company enrollment", async () => {
    await models.EmployeeFaceEnrollment.deleteMany({});
    const slug = `other-verify-${Date.now()}`;
    const otherCompany = await Company.create({
      name: "Other Co",
      companyName: "Other Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata" },
      hrAccessEnforcement: { mode: "OFF" },
    });
    const otherModels = await getCompanyModels(otherCompany, { provision: true });
    const otherEmp = await otherModels.Employee.create({
      companyId: otherCompany._id,
      email: "other@example.com",
      fullName: "Other",
      employeeCode: "O-1",
      status: "ACTIVE",
    });
    setFaceEngine({
      analyze: async () => ({
        ok: true,
        faceCount: 1,
        embedding: hashSeedToEmbedding("alice"),
        livenessScore: 0.9,
        qualityScore: 0.9,
      }),
    });
    await enrollEmployeeFace({
      FaceEnrollment: otherModels.EmployeeFaceEnrollment,
      companyId: otherCompany._id,
      employeeId: otherEmp._id,
      imageBase64: Buffer.from("ALICE").toString("base64"),
      consentAccepted: true,
    });

    // Same employeeId cannot exist across tenants; verify in this tenant with no local enrollment.
    const cross = await verifyEmployeeFace({
      FaceEnrollment: models.EmployeeFaceEnrollment,
      companyId: company._id,
      employeeId: employee._id,
      imageBase64: Buffer.from("ALICE").toString("base64"),
    });
    assert.equal(cross.ok, false);
    assert.equal(cross.reason, "FACE_NOT_ENROLLED");

    // Other tenant enrollment is not readable from this tenant model connection.
    const leaked = await models.EmployeeFaceEnrollment.find({}).lean();
    assert.equal(leaked.length, 0);
  });
});
