import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { HttpError } from "../utils/httpError.js";
import {
  FACE_ENROLLMENT_STATUSES,
  encryptEmbedding,
  decryptEmbedding,
} from "../models/EmployeeFaceEnrollment.js";

export const FACE_MODEL_ID = "face-api-ssd-mobilenetv1-facenet";
export const FACE_MODEL_VERSION = "1";
export const DEFAULT_MATCH_THRESHOLD = 0.55; // euclidean distance; lower = stricter
export const LIVENESS_MIN_SCORE = 0.55;

/**
 * IMPORTANT: Heuristic liveness (landmark variance + detection score) is NOT
 * production-grade anti-spoofing. A validated commercial or challenge-response
 * liveness solution is required before treating face verification as
 * spoof-resistant in production.
 */

/** Optional injectable engine for tests / production model backends */
let faceEngine = null;

export function setFaceEngine(engine) {
  faceEngine = engine;
}

export function resetFaceEngine() {
  faceEngine = null;
}

export function getFaceModelsDir() {
  return (
    process.env.FACE_MODELS_DIR ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets/face-models")
  );
}

/** Synchronous readiness probe used by policy validation. */
export function isFaceEngineReady() {
  if (faceEngine?.analyze) {
    return { ok: true, source: "injected" };
  }
  const modelsDir = getFaceModelsDir();
  if (!fs.existsSync(modelsDir)) {
    return {
      ok: false,
      message: `Face models directory not found (${modelsDir}). Run: npm run face:models`,
    };
  }
  let entries = [];
  try {
    entries = fs.readdirSync(modelsDir);
  } catch {
    entries = [];
  }
  // Ignore placeholder / docs-only files
  const modelFiles = entries.filter((name) => !name.startsWith(".") && name !== ".gitkeep");
  if (!modelFiles.length) {
    return { ok: false, message: `Face models directory is empty (${modelsDir}). Run: npm run face:models` };
  }
  return { ok: true, source: "disk", modelsDir };
}

/**
 * Heuristic landmark/confidence checks are NOT production anti-spoofing.
 * Mandatory face requires an explicitly configured validated provider.
 *
 * Set FACE_LIVENESS_PROVIDER to a non-heuristic value once a validated
 * commercial or challenge-response liveness integration is wired
 * (e.g. vendor:<name> or challenge-response).
 */
export function isValidatedLivenessConfigured() {
  if (process.env.NODE_ENV === "test") {
    return { ok: true, source: "test", provider: "test" };
  }
  const provider = String(process.env.FACE_LIVENESS_PROVIDER || "")
    .trim()
    .toLowerCase();
  if (!provider || provider === "heuristic" || provider === "none" || provider === "off") {
    return {
      ok: false,
      provider: provider || "heuristic",
      message:
        "Mandatory face verification requires a validated liveness provider. " +
        "Heuristic checks are not production anti-spoofing. Set FACE_LIVENESS_PROVIDER " +
        "after integrating a validated solution (or keep face optional).",
    };
  }
  return { ok: true, provider, source: "env" };
}

function cosineDistance(a, b) {
  if (!a?.length || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!denom) return Number.POSITIVE_INFINITY;
  return 1 - dot / denom;
}

function euclideanDistance(a, b) {
  if (!a?.length || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Parse data-URL or base64 image buffer. Rejects oversized payloads.
 */
export function parseFaceImageInput(imageBase64) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new HttpError(400, "Face image is required.");
  }
  let raw = imageBase64.trim();
  const match = raw.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
  if (match) raw = match[2];
  if (raw.length > 8_000_000) {
    throw new HttpError(400, "Face image is too large.");
  }
  let buffer;
  try {
    buffer = Buffer.from(raw, "base64");
  } catch {
    throw new HttpError(400, "Invalid face image encoding.");
  }
  if (!buffer.length || buffer.length > 6_000_000) {
    throw new HttpError(400, "Invalid face image payload.");
  }
  return buffer;
}

/**
 * Analyze a face image. Uses injected engine when available; otherwise attempts
 * @vladmandic/face-api + @tensorflow/tfjs lazy load. If models are unavailable,
 * returns a structured failure (never a fake success).
 */
export async function analyzeFaceImage(imageBase64, { requireLiveness = true } = {}) {
  const buffer = parseFaceImageInput(imageBase64);

  if (faceEngine?.analyze) {
    return faceEngine.analyze(buffer, { requireLiveness });
  }

  // Attempt real face-api pipeline
  try {
    const result = await runFaceApiPipeline(buffer, { requireLiveness });
    return result;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return {
      ok: false,
      reason: "FACE_ENGINE_UNAVAILABLE",
      message:
        err?.message ||
        "Face recognition models are not available on this server. Configure FACE_MODELS_DIR or FACE_ENGINE.",
      faceCount: 0,
      embedding: null,
      livenessScore: null,
      qualityScore: null,
    };
  }
}

async function runFaceApiPipeline(buffer, { requireLiveness }) {
  // Dynamic import keeps cold-start lighter when face verification is disabled
  const tf = await import("@tensorflow/tfjs");
  await import("@tensorflow/tfjs-backend-cpu");
  await tf.setBackend("cpu");
  await tf.ready();

  const faceapi = await import("@vladmandic/face-api");
  const path = await import("path");
  const fs = await import("fs");
  const { fileURLToPath } = await import("url");
  const { createCanvas, loadImage } = await import("@napi-rs/canvas").catch(() => ({ createCanvas: null, loadImage: null }));

  if (!createCanvas || !loadImage) {
    throw new Error("Canvas backend (@napi-rs/canvas) is required for face recognition.");
  }

  const modelsDir = getFaceModelsDir();

  if (!fs.existsSync(modelsDir)) {
    throw new Error(`Face models directory not found: ${modelsDir}`);
  }

  if (!runFaceApiPipeline._loaded) {
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsDir);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsDir);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsDir);
    runFaceApiPipeline._loaded = true;
  }

  const img = await loadImage(buffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const detections = await faceapi
    .detectAllFaces(canvas)
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (!detections.length) {
    return {
      ok: false,
      reason: "NO_FACE_DETECTED",
      message: "No face detected. Center your face in the frame with good lighting.",
      faceCount: 0,
      embedding: null,
      livenessScore: null,
      qualityScore: null,
    };
  }

  if (detections.length > 1) {
    return {
      ok: false,
      reason: "MULTIPLE_FACES",
      message: "Multiple faces detected. Only the enrolled employee should be visible.",
      faceCount: detections.length,
      embedding: null,
      livenessScore: null,
      qualityScore: null,
    };
  }

  const det = detections[0];
  const box = det.detection.box;
  const score = det.detection.score;
  const areaRatio = (box.width * box.height) / Math.max(1, img.width * img.height);
  const qualityScore = Math.min(1, score * 0.7 + Math.min(areaRatio * 4, 0.3));

  if (qualityScore < 0.35 || box.width < 80 || box.height < 80) {
    return {
      ok: false,
      reason: "LOW_IMAGE_QUALITY",
      message: "Face image quality is too low. Move closer and ensure your face is well lit.",
      faceCount: 1,
      embedding: null,
      livenessScore: null,
      qualityScore,
    };
  }

  // Lightweight liveness heuristics (not a commercial anti-spoof stack).
  // Uses landmark variance + detection confidence; document limitation in README.
  const landmarks = det.landmarks?.positions || [];
  let landmarkVar = 0;
  if (landmarks.length) {
    const xs = landmarks.map((p) => p.x);
    const ys = landmarks.map((p) => p.y);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    landmarkVar =
      xs.reduce((a, x) => a + (x - mx) ** 2, 0) / xs.length +
      ys.reduce((a, y) => a + (y - my) ** 2, 0) / ys.length;
  }
  const livenessScore = Math.min(1, score * 0.6 + Math.min(landmarkVar / 5000, 0.4));

  if (requireLiveness && livenessScore < LIVENESS_MIN_SCORE) {
    return {
      ok: false,
      reason: "LIVENESS_FAILED",
      message:
        "Liveness check failed. Do not use a photo of a photo — look directly at the camera in live conditions.",
      faceCount: 1,
      embedding: null,
      livenessScore,
      qualityScore,
    };
  }

  const embedding = Array.from(det.descriptor);
  return {
    ok: true,
    reason: "FACE_CAPTURED",
    message: "Face captured successfully.",
    faceCount: 1,
    embedding,
    livenessScore,
    qualityScore,
    modelId: FACE_MODEL_ID,
    modelVersion: FACE_MODEL_VERSION,
  };
}

export function compareEmbeddings(probe, enrolled, threshold = DEFAULT_MATCH_THRESHOLD) {
  const distance = euclideanDistance(probe, enrolled);
  const cosine = cosineDistance(probe, enrolled);
  const matched = distance <= threshold;
  return {
    matched,
    distance,
    cosineDistance: cosine,
    threshold,
  };
}

export async function enrollEmployeeFace({
  FaceEnrollment,
  companyId,
  employeeId,
  enrolledBy,
  imageBase64,
  consentAccepted,
  consentTextVersion = "v1",
}) {
  if (!consentAccepted) {
    throw new HttpError(400, "Biometric enrollment requires explicit consent.");
  }

  const analysis = await analyzeFaceImage(imageBase64, { requireLiveness: true });
  if (!analysis.ok || !analysis.embedding?.length) {
    throw new HttpError(400, analysis.message || `Face enrollment failed (${analysis.reason}).`);
  }

  await FaceEnrollment.updateMany(
    { companyId, employeeId, status: FACE_ENROLLMENT_STATUSES.ACTIVE },
    {
      $set: {
        status: FACE_ENROLLMENT_STATUSES.SUPERSEDED,
        revokedAt: new Date(),
        revokeReason: "superseded_by_reenrollment",
      },
    }
  );

  const sealed = encryptEmbedding(analysis.embedding);
  const doc = await FaceEnrollment.create({
    companyId,
    employeeId,
    status: FACE_ENROLLMENT_STATUSES.ACTIVE,
    ...sealed,
    modelId: analysis.modelId || FACE_MODEL_ID,
    modelVersion: analysis.modelVersion || FACE_MODEL_VERSION,
    consentAcceptedAt: new Date(),
    consentTextVersion,
    enrolledAt: new Date(),
    enrolledBy: enrolledBy || null,
    qualityScore: analysis.qualityScore,
  });

  return {
    enrollmentId: String(doc._id),
    enrolledAt: doc.enrolledAt,
    modelId: doc.modelId,
    qualityScore: doc.qualityScore,
    status: doc.status,
  };
}

export async function revokeEmployeeFace({ FaceEnrollment, companyId, employeeId, revokedBy, reason = "revoked" }) {
  const result = await FaceEnrollment.updateMany(
    { companyId, employeeId, status: FACE_ENROLLMENT_STATUSES.ACTIVE },
    {
      $set: {
        status: FACE_ENROLLMENT_STATUSES.REVOKED,
        revokedAt: new Date(),
        revokedBy: revokedBy || null,
        revokeReason: String(reason || "revoked").slice(0, 200),
      },
    }
  );
  return { revoked: result.modifiedCount || 0 };
}

export async function getFaceEnrollmentStatus({ FaceEnrollment, companyId, employeeId }) {
  const q = { employeeId, status: FACE_ENROLLMENT_STATUSES.ACTIVE };
  if (companyId) q.companyId = companyId;
  const doc = await FaceEnrollment.findOne(q)
    .select("status enrolledAt modelId modelVersion qualityScore lastVerifiedAt verifySuccessCount verifyFailCount consentAcceptedAt")
    .lean();

  if (!doc) {
    return { enrolled: false, status: null };
  }

  return {
    enrolled: true,
    status: doc.status,
    enrolledAt: doc.enrolledAt,
    modelId: doc.modelId,
    modelVersion: doc.modelVersion,
    qualityScore: doc.qualityScore,
    lastVerifiedAt: doc.lastVerifiedAt,
    verifySuccessCount: doc.verifySuccessCount,
    verifyFailCount: doc.verifyFailCount,
    consentAcceptedAt: doc.consentAcceptedAt,
  };
}

/**
 * Verify probe image against the authenticated employee's active enrollment only.
 * Never compares across employees.
 */
export async function verifyEmployeeFace({
  FaceEnrollment,
  companyId,
  employeeId,
  imageBase64,
  matchThreshold = DEFAULT_MATCH_THRESHOLD,
  requireLiveness = true,
}) {
  const base = {
    method: "FACE",
    attempted: true,
    ok: false,
    reason: "",
    message: "",
    distance: null,
    threshold: matchThreshold,
    modelId: FACE_MODEL_ID,
    livenessScore: null,
    faceCount: null,
  };

  const enrollmentQuery = {
    employeeId,
    status: FACE_ENROLLMENT_STATUSES.ACTIVE,
  };
  if (companyId) enrollmentQuery.companyId = companyId;

  const enrollment = await FaceEnrollment.findOne(enrollmentQuery);

  if (!enrollment) {
    return {
      ...base,
      reason: "FACE_NOT_ENROLLED",
      message: "No face enrollment on file. Complete biometric enrollment before verifying.",
    };
  }

  const analysis = await analyzeFaceImage(imageBase64, { requireLiveness });
  if (!analysis.ok || !analysis.embedding?.length) {
    await FaceEnrollment.updateOne({ _id: enrollment._id }, { $inc: { verifyFailCount: 1 } });
    return {
      ...base,
      reason: analysis.reason || "FACE_ANALYZE_FAILED",
      message: analysis.message || "Face verification failed.",
      livenessScore: analysis.livenessScore,
      faceCount: analysis.faceCount,
    };
  }

  let enrolledEmbedding;
  try {
    enrolledEmbedding = decryptEmbedding(enrollment);
  } catch {
    return {
      ...base,
      reason: "FACE_TEMPLATE_DECRYPT_FAILED",
      message: "Unable to load biometric template. Contact HR to re-enroll.",
    };
  }

  const cmp = compareEmbeddings(analysis.embedding, enrolledEmbedding, matchThreshold);
  if (!cmp.matched) {
    await FaceEnrollment.updateOne({ _id: enrollment._id }, { $inc: { verifyFailCount: 1 } });
    return {
      ...base,
      reason: "FACE_MISMATCH",
      message: "Face did not match the enrolled profile.",
      distance: Number(cmp.distance.toFixed(4)),
      livenessScore: analysis.livenessScore,
      faceCount: 1,
      modelId: analysis.modelId || enrollment.modelId,
    };
  }

  await FaceEnrollment.updateOne(
    { _id: enrollment._id },
    {
      $inc: { verifySuccessCount: 1 },
      $set: { lastVerifiedAt: new Date() },
    }
  );

  return {
    ...base,
    ok: true,
    reason: "FACE_MATCHED",
    message: "Face verified successfully.",
    distance: Number(cmp.distance.toFixed(4)),
    livenessScore: analysis.livenessScore,
    faceCount: 1,
    modelId: analysis.modelId || enrollment.modelId,
  };
}

/** Deterministic test helper — builds a fake embedding from a seed string */
export function hashSeedToEmbedding(seed, dim = 128) {
  const out = new Float32Array(dim);
  let prev = Buffer.from(String(seed));
  for (let i = 0; i < dim; i += 1) {
    prev = crypto.createHash("sha256").update(prev).update(String(i)).digest();
    out[i] = (prev.readUInt16BE(0) / 65535) * 2 - 1;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i += 1) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i += 1) out[i] /= norm;
  return Array.from(out);
}
