import assert from "node:assert/strict";
import fs from "node:fs";
import { after, afterEach, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import {
  FACE_MAX_BASE64_CHARS,
  FACE_MAX_DECODED_BYTES,
  analyzeFaceImage,
  enrollEmployeeFace,
  hashSeedToEmbedding,
  parseFaceImageInput,
  resetFaceEngine,
  setFaceEngine,
  verifyEmployeeFace,
} from "../services/faceRecognitionService.js";
import {
  FACE_INFERENCE_CONCURRENCY,
  FACE_MAX_IMAGE_EDGE,
  buildDetectionCanvas,
  disposeFaceDetections,
  ensureFaceRuntime,
  getFaceRuntimeDiagnostics,
  resetFaceRuntimeForTests,
  setFaceRuntimeLoaderForTests,
  withFaceInferenceSlot,
} from "../services/faceRecognitionRuntime.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { HttpError } from "../utils/httpError.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f39-face-runtime-test-secret-32chars!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f39_face";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.FACE_BIOMETRIC_KEY = "f39-face-biometric-key-32chars!!!!";
process.env.FACE_LIVENESS_PROVIDER = "test-harness";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

function tinyPngDataUrl() {
  // 1x1 PNG
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return `data:image/png;base64,${b64}`;
}

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let mongo;
let app;
let companyA;
let companyB;
let modelsA;
let modelsB;
let hrCookieA;
let empCookieA;
let empCookieB;
let empA;
let empB;

before(async () => {
  fs.mkdirSync("D:/tmp/hrms-mongo/f39-face-runtime", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/f39-face-runtime" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  await Company.deleteMany({});
  const suffix = `${Date.now()}`;
  companyA = await Company.create({
    companyName: "F39 Acme",
    slug: `f39-acme-${suffix}`,
    databaseName: `company_f39_acme_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });
  companyB = await Company.create({
    companyName: "F39 Globex",
    slug: `f39-globex-${suffix}`,
    databaseName: `company_f39_globex_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });

  modelsA = await getCompanyModels(companyA, { provision: true });
  modelsB = await getCompanyModels(companyB, { provision: true });

  await modelsA.CompanyHrPolicy.create({
    effectiveFromDate: new Date("2026-01-01"),
    attendanceRules: { officeStartTime: "09:30", officeEndTime: "18:30", gracePeriodMinutes: 15 },
    attendanceVerification: {
      verificationRequired: true,
      face: { enabled: true, mandatory: true, matchThreshold: 0.55, requireLiveness: true },
      gps: { enabled: false },
      wifi: { enabled: false },
    },
    locationRules: { requireLocationForPunch: true, geofenceEnabled: false },
  });

  empA = await modelsA.Employee.create({
    employeeCode: "F39-001",
    fullName: "Face Fay",
    email: "fay@f39.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Eng", department: "Engineering", employmentType: "Full-time" },
    schemaVersion: 1,
  });
  empB = await modelsB.Employee.create({
    employeeCode: "F39-B01",
    fullName: "Other Otis",
    email: "otis@f39.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Eng", department: "Engineering", employmentType: "Full-time" },
    schemaVersion: 1,
  });

  await modelsA.User.create({
    email: "hr@f39-acme.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
    schemaVersion: 1,
  });
  await modelsA.User.create({
    email: "fay@f39.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.EMPLOYEE,
    employeeId: empA._id,
    isActive: true,
    schemaVersion: 1,
  });
  await modelsB.User.create({
    email: "otis@f39.test",
    passwordHash: await hashPassword("Password123!"),
    role: USER_ROLES.EMPLOYEE,
    employeeId: empB._id,
    isActive: true,
    schemaVersion: 1,
  });

  hrCookieA = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ companyCode: companyA.slug, email: "hr@f39-acme.test", password: "Password123!" })
  );
  empCookieA = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ companyCode: companyA.slug, email: "fay@f39.test", password: "Password123!" })
  );
  empCookieB = cookieFrom(
    await request(app)
      .post("/api/auth/login")
      .send({ companyCode: companyB.slug, email: "otis@f39.test", password: "Password123!" })
  );
});

after(async () => {
  resetFaceEngine();
  resetFaceRuntimeForTests({ hard: true });
  await disconnectAll();
  if (mongo) await mongo.stop();
});

afterEach(() => {
  resetFaceEngine();
  resetFaceRuntimeForTests({ hard: true });
});

describe("F39 face runtime lifecycle", () => {
  it("initializes models once per warm process and coalesces concurrent init", async () => {
    let loaderCalls = 0;
    setFaceRuntimeLoaderForTests(async () => {
      loaderCalls += 1;
      await new Promise((r) => setTimeout(r, 40));
      return {
        tf: { memory: () => ({ numTensors: 0 }) },
        faceapi: { nets: {} },
        canvasApi: { createCanvas: () => ({}), loadImage: async () => ({ width: 1, height: 1 }) },
        modelsDir: "/tmp/fake-models",
      };
    });

    const [a, b, c] = await Promise.all([
      ensureFaceRuntime(),
      ensureFaceRuntime(),
      ensureFaceRuntime(),
    ]);
    assert.equal(loaderCalls, 1);
    assert.equal(a.initSuccessCount, 1);
    assert.equal(b.initSuccessCount, 1);
    assert.equal(c.loaded, true);

    await ensureFaceRuntime();
    assert.equal(loaderCalls, 1, "warm process must not reload weights");
    assert.equal(getFaceRuntimeDiagnostics().initSuccessCount, 1);
  });

  it("recovers after initialization failure", async () => {
    let attempt = 0;
    setFaceRuntimeLoaderForTests(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("simulated model load failure");
      return {
        tf: { memory: () => ({ numTensors: 0 }) },
        faceapi: { nets: {} },
        canvasApi: { createCanvas: () => ({}), loadImage: async () => ({ width: 1, height: 1 }) },
        modelsDir: "/tmp/fake-models",
      };
    });

    await assert.rejects(() => ensureFaceRuntime(), /simulated model load failure/);
    assert.equal(getFaceRuntimeDiagnostics().loaded, false);
    assert.equal(getFaceRuntimeDiagnostics().initInFlight, false);

    const recovered = await ensureFaceRuntime();
    assert.equal(recovered.loaded, true);
    assert.equal(attempt, 2);
    assert.equal(getFaceRuntimeDiagnostics().initSuccessCount, 1);
  });

  it("bounds concurrent inference slots without corrupting shared state", async () => {
    const order = [];
    const started = [];
    const tasks = Array.from({ length: FACE_INFERENCE_CONCURRENCY + 2 }, (_, i) =>
      withFaceInferenceSlot(async () => {
        started.push(i);
        assert.ok(
          getFaceRuntimeDiagnostics().activeInferences <= FACE_INFERENCE_CONCURRENCY
        );
        order.push(`start-${i}`);
        await new Promise((r) => setTimeout(r, 30));
        order.push(`end-${i}`);
        return i;
      })
    );
    const results = await Promise.all(tasks);
    assert.deepEqual(results.sort((a, b) => a - b), [0, 1, 2, 3].slice(0, tasks.length));
    assert.equal(getFaceRuntimeDiagnostics().activeInferences, 0);
    assert.ok(getFaceRuntimeDiagnostics().peakActiveInferences <= FACE_INFERENCE_CONCURRENCY);
    assert.ok(started.length === tasks.length);
  });

  it("disposes detection tensors after success and failure paths", () => {
    let disposed = 0;
    const tf = { memory: () => ({ numTensors: 1 }), engine: () => ({}) };
    const detections = [
      {
        detection: {
          dispose() {
            disposed += 1;
          },
        },
      },
      {
        detection: {
          dispose() {
            disposed += 1;
          },
        },
      },
    ];
    disposeFaceDetections(tf, detections);
    assert.equal(disposed, 2);
    disposeFaceDetections(tf, []);
    assert.equal(disposed, 2);
  });
});

describe("F39 image payload limits", () => {
  it("rejects oversized and invalid image payloads", () => {
    assert.throws(() => parseFaceImageInput(""), /required/i);
    assert.throws(() => parseFaceImageInput(null), /required/i);
    assert.throws(
      () => parseFaceImageInput(`data:image/gif;base64,${Buffer.from("x").toString("base64")}`),
      /Unsupported|JPEG|PNG|WebP/i
    );
    assert.throws(
      () => parseFaceImageInput("a".repeat(FACE_MAX_BASE64_CHARS + 1)),
      /too large/i
    );
    // Decoded length gate: valid base64 that expands past FACE_MAX_DECODED_BYTES is hard
    // without huge strings; empty decoded buffer is rejected.
    assert.throws(() => parseFaceImageInput("@@@"), /Invalid face image/);

    const ok = parseFaceImageInput(tinyPngDataUrl());
    assert.ok(Buffer.isBuffer(ok));
    assert.ok(ok.length > 0);
    assert.ok(ok.length <= FACE_MAX_DECODED_BYTES);
  });

  it("rejects absurd image dimensions before detection", () => {
    assert.throws(
      () =>
        buildDetectionCanvas(
          { width: FACE_MAX_IMAGE_EDGE + 1, height: 100 },
          { createCanvas: () => ({ getContext: () => ({ drawImage() {} }) }) }
        ),
      (err) => err instanceof HttpError && err.status === 400
    );

    const drawn = [];
    const { scale, width, height } = buildDetectionCanvas(
      { width: 2000, height: 1500 },
      {
        createCanvas: (w, h) => ({
          width: w,
          height: h,
          getContext: () => ({
            drawImage(...args) {
              drawn.push(args);
            },
          }),
        }),
      }
    );
    assert.ok(scale < 1);
    assert.ok(Math.max(width, height) <= 960);
    assert.equal(drawn.length, 1);
  });
});

describe("F39 enrollment / verification behavior + tenant isolation", () => {
  it("keeps enroll/verify match semantics with injected engine", async () => {
    const emb = hashSeedToEmbedding("f39-alice");
    setFaceEngine({
      async analyze() {
        return {
          ok: true,
          reason: "FACE_CAPTURED",
          message: "ok",
          faceCount: 1,
          embedding: emb,
          livenessScore: 0.9,
          qualityScore: 0.9,
          modelId: "face-api-ssd-mobilenetv1-facenet",
          modelVersion: "1",
        };
      },
    });

    const enrolled = await enrollEmployeeFace({
      FaceEnrollment: modelsA.EmployeeFaceEnrollment,
      companyId: companyA._id,
      employeeId: empA._id,
      enrolledBy: empA._id,
      imageBase64: tinyPngDataUrl(),
      consentAccepted: true,
    });
    assert.ok(enrolled.enrollmentId);

    const matched = await verifyEmployeeFace({
      FaceEnrollment: modelsA.EmployeeFaceEnrollment,
      companyId: companyA._id,
      employeeId: empA._id,
      imageBase64: tinyPngDataUrl(),
    });
    assert.equal(matched.ok, true);
    assert.equal(matched.reason, "FACE_MATCHED");

    setFaceEngine({
      async analyze() {
        return {
          ok: true,
          reason: "FACE_CAPTURED",
          message: "ok",
          faceCount: 1,
          embedding: hashSeedToEmbedding("f39-impostor"),
          livenessScore: 0.9,
          qualityScore: 0.9,
        };
      },
    });
    const mismatch = await verifyEmployeeFace({
      FaceEnrollment: modelsA.EmployeeFaceEnrollment,
      companyId: companyA._id,
      employeeId: empA._id,
      imageBase64: tinyPngDataUrl(),
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.reason, "FACE_MISMATCH");
  });

  it("isolates face enrollments across tenants", async () => {
    const emb = hashSeedToEmbedding("f39-tenant-a");
    setFaceEngine({
      async analyze() {
        return {
          ok: true,
          reason: "FACE_CAPTURED",
          message: "ok",
          faceCount: 1,
          embedding: emb,
          livenessScore: 0.9,
          qualityScore: 0.9,
        };
      },
    });

    await enrollEmployeeFace({
      FaceEnrollment: modelsA.EmployeeFaceEnrollment,
      companyId: companyA._id,
      employeeId: empA._id,
      enrolledBy: empA._id,
      imageBase64: tinyPngDataUrl(),
      consentAccepted: true,
    });

    const cross = await verifyEmployeeFace({
      FaceEnrollment: modelsB.EmployeeFaceEnrollment,
      companyId: companyB._id,
      employeeId: empB._id,
      imageBase64: tinyPngDataUrl(),
    });
    assert.equal(cross.ok, false);
    assert.equal(cross.reason, "FACE_NOT_ENROLLED");

    const countB = await modelsB.EmployeeFaceEnrollment.countDocuments({});
    assert.equal(countB, 0);
  });

  it("mandatory face remains fail-closed when analyze fails", async () => {
    // Ensure policy still has mandatory face (create path may not re-sanitize on read).
    await modelsA.CompanyHrPolicy.updateMany(
      {},
      {
        $set: {
          "attendanceVerification.verificationRequired": true,
          "attendanceVerification.face.enabled": true,
          "attendanceVerification.face.mandatory": true,
          "attendanceVerification.face.requireLiveness": true,
          "attendanceVerification.gps.enabled": false,
          "attendanceVerification.wifi.enabled": false,
        },
      }
    );

    setFaceEngine({
      async analyze() {
        return {
          ok: false,
          reason: "NO_FACE_DETECTED",
          message: "No face",
          faceCount: 0,
          embedding: null,
          livenessScore: null,
          qualityScore: null,
        };
      },
    });

    const analyzed = await analyzeFaceImage(tinyPngDataUrl());
    assert.equal(analyzed.ok, false);
    assert.equal(analyzed.reason, "NO_FACE_DETECTED");

    const punch = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", empCookieA)
      .send({
        location: { latitude: 12.97, longitude: 77.59, accuracy: 10 },
        faceImageBase64: tinyPngDataUrl(),
      });
    assert.ok(
      punch.status >= 400,
      `mandatory face failure must block punch, got ${punch.status}: ${JSON.stringify(punch.body)}`
    );
    assert.match(
      String(punch.body.message || punch.body.reason || punch.body.code || ""),
      /face|liveness|No face|enroll|FACE_/i
    );
  });

  it("does not leak embeddings on enrollment status API", async () => {
    const status = await request(app)
      .get("/api/employees/me/face-enrollment")
      .set("Cookie", empCookieA);
    assert.equal(status.status, 200);
    const raw = JSON.stringify(status.body);
    assert.equal(raw.includes("embeddingCiphertext"), false);
    assert.equal(raw.includes("embeddingIv"), false);
  });
});
