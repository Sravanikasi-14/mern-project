import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import {
  ensureFaceRuntime,
  getFaceModelsDir,
  getFaceRuntimeDiagnostics,
  resetFaceRuntimeForTests,
  setFaceRuntimeLoaderForTests,
  withFaceInferenceSlot,
  FACE_MAX_IMAGE_EDGE,
  FACE_DETECT_MAX_EDGE,
  FACE_INFERENCE_CONCURRENCY,
} from "../services/faceRecognitionRuntime.js";
import {
  analyzeFaceImage,
  isFaceEngineReady,
  parseFaceImageInput,
  compareEmbeddings,
  DEFAULT_MATCH_THRESHOLD,
  FACE_MODEL_ID,
  FACE_MAX_BASE64_CHARS,
  FACE_MAX_DECODED_BYTES,
} from "../services/faceRecognitionService.js";
import {
  validateFaceBiometricKeyConfig,
  getBiometricEncryptionKeyBytes,
} from "../utils/biometricKey.js";
import {
  encryptEmbedding,
  decryptEmbedding,
} from "../models/EmployeeFaceEnrollment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(__dirname, "../assets/face-models");

describe("Phase 1 Face Recognition: Model Assets & Readiness", () => {
  it("verifies all required model files are present on disk with valid size", () => {
    assert.ok(fs.existsSync(modelsDir), `Models directory must exist: ${modelsDir}`);
    const requiredFiles = [
      "ssd_mobilenetv1_model-weights_manifest.json",
      "ssd_mobilenetv1_model.bin",
      "face_landmark_68_model-weights_manifest.json",
      "face_landmark_68_model.bin",
      "face_recognition_model-weights_manifest.json",
      "face_recognition_model.bin",
    ];

    let totalSize = 0;
    for (const name of requiredFiles) {
      const filePath = path.join(modelsDir, name);
      assert.ok(fs.existsSync(filePath), `Missing model file: ${name}`);
      const stats = fs.statSync(filePath);
      assert.ok(stats.size > 0, `Model file is empty: ${name}`);
      totalSize += stats.size;
    }
    // Total size should be ~12MB (within 11MB - 14MB)
    assert.ok(totalSize > 11 * 1024 * 1024, `Models total size ${totalSize} is lower than expected`);
    assert.ok(totalSize < 15 * 1024 * 1024, `Models total size ${totalSize} is higher than expected`);
  });

  it("reports readiness accurately via isFaceEngineReady()", () => {
    const probe = isFaceEngineReady();
    assert.equal(probe.ok, true, `Expected engine to be ready: ${probe.message}`);
    assert.equal(probe.source, "disk");
    assert.ok(probe.modelsDir);
  });
});

describe("Phase 1 Face Recognition: Runtime Initialization & Coalescing", () => {
  before(() => {
    resetFaceRuntimeForTests({ hard: true });
  });

  after(() => {
    resetFaceRuntimeForTests({ hard: true });
  });

  it("initializes models on disk once and coalesces concurrent initialization calls", async () => {
    const [rt1, rt2, rt3] = await Promise.all([
      ensureFaceRuntime(),
      ensureFaceRuntime(),
      ensureFaceRuntime(),
    ]);

    assert.equal(rt1.loaded, true);
    assert.equal(rt2.loaded, true);
    assert.equal(rt3.loaded, true);
    assert.equal(rt1, rt2);
    assert.equal(rt2, rt3);

    const diag = getFaceRuntimeDiagnostics();
    assert.equal(diag.loaded, true);
    assert.equal(diag.initAttempts, 1);
    assert.equal(diag.initSuccessCount, 1);
    assert.equal(diag.concurrency, FACE_INFERENCE_CONCURRENCY);
    assert.ok(diag.numTensors > 0, "Model weights must reside in TFJS memory");
  });

  it("handles missing models directory cleanly and recovers upon retry", async () => {
    resetFaceRuntimeForTests({ hard: true });

    // Mock a loader failure
    setFaceRuntimeLoaderForTests(async () => {
      throw new Error("Simulated missing model weights");
    });

    await assert.rejects(
      () => ensureFaceRuntime(),
      /Simulated missing model weights/
    );

    const failDiag = getFaceRuntimeDiagnostics();
    assert.equal(failDiag.loaded, false);
    assert.equal(failDiag.initAttempts, 1);
    assert.equal(failDiag.initSuccessCount, 0);

    // Restore disk loader
    setFaceRuntimeLoaderForTests(null);
    const recovered = await ensureFaceRuntime();
    assert.equal(recovered.loaded, true);

    const recoveredDiag = getFaceRuntimeDiagnostics();
    assert.equal(recoveredDiag.loaded, true);
    assert.equal(recoveredDiag.initAttempts, 2);
    assert.equal(recoveredDiag.initSuccessCount, 1);
  });
});

describe("Phase 1 Face Recognition: Payload Validation & Error Handling", () => {
  it("rejects invalid, missing, or malformed image inputs", () => {
    assert.throws(() => parseFaceImageInput(null), /Face image is required/);
    assert.throws(() => parseFaceImageInput(""), /Face image is required/);
    assert.throws(
      () => parseFaceImageInput("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
      /Unsupported face image type/
    );
  });

  it("rejects payloads exceeding size limits", () => {
    const hugeString = "a".repeat(FACE_MAX_BASE64_CHARS + 10);
    assert.throws(() => parseFaceImageInput(hugeString), /Face image is too large/);
  });

  it("returns NO_FACE_DETECTED for blank or non-face images without throwing", async () => {
    const blank1x1Png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const res = await analyzeFaceImage(blank1x1Png, { requireLiveness: false });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "NO_FACE_DETECTED");
    assert.equal(res.faceCount, 0);
    assert.equal(res.embedding, null);
  });
});

describe("Phase 1 Face Recognition: Concurrency Slots & Memory Hygiene", () => {
  it("bounds concurrent inferences using withFaceInferenceSlot", async () => {
    let running = 0;
    let maxRunning = 0;

    const task = async () => {
      return withFaceInferenceSlot(async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 40));
        running -= 1;
        return true;
      });
    };

    const results = await Promise.all([task(), task(), task(), task()]);
    assert.deepEqual(results, [true, true, true, true]);
    assert.ok(maxRunning <= FACE_INFERENCE_CONCURRENCY, `Max parallel inferences (${maxRunning}) exceeded concurrency cap (${FACE_INFERENCE_CONCURRENCY})`);
  });
});

describe("Phase 1 Face Recognition: Biometric Key Encryption & Matching", () => {
  const prevKey = process.env.FACE_BIOMETRIC_KEY;

  before(() => {
    process.env.FACE_BIOMETRIC_KEY = "phase1-test-face-biometric-key-32chars!";
  });

  after(() => {
    if (prevKey !== undefined) {
      process.env.FACE_BIOMETRIC_KEY = prevKey;
    } else {
      delete process.env.FACE_BIOMETRIC_KEY;
    }
  });

  it("verifies FACE_BIOMETRIC_KEY configuration helper", () => {
    const configCheck = validateFaceBiometricKeyConfig({ throwOnError: false });
    assert.equal(configCheck.ok, true);
    assert.equal(configCheck.source, "FACE_BIOMETRIC_KEY");
  });

  it("encrypts and decrypts 128-D embedding vectors using AES-256-GCM without data loss", () => {
    const rawVector = Array.from({ length: 128 }, (_, i) => Math.sin(i));
    const encrypted = encryptEmbedding(rawVector);

    assert.ok(encrypted.embeddingCiphertext);
    assert.ok(encrypted.embeddingIv);
    assert.ok(encrypted.embeddingAuthTag);
    assert.equal(encrypted.embeddingDim, 128);

    const decrypted = decryptEmbedding(encrypted);
    assert.equal(decrypted.length, 128);

    // Verify Float32 precision preservation
    for (let i = 0; i < 128; i++) {
      assert.ok(
        Math.abs(decrypted[i] - Math.fround(rawVector[i])) < 1e-6,
        `Index ${i} mismatch: expected ${Math.fround(rawVector[i])}, got ${decrypted[i]}`
      );
    }
  });

  it("detects tampered ciphertext during GCM auth tag verification", () => {
    const rawVector = Array.from({ length: 128 }, () => 0.5);
    const encrypted = encryptEmbedding(rawVector);

    const tampered = {
      ...encrypted,
      embeddingCiphertext: Buffer.from("tampered-data-payload").toString("base64"),
    };

    assert.throws(() => decryptEmbedding(tampered));
  });

  it("compares probe and enrolled embeddings using Euclidean distance against threshold", () => {
    const enrolled = Array.from({ length: 128 }, () => 0.1);
    const identical = Array.from({ length: 128 }, () => 0.1);
    const different = Array.from({ length: 128 }, () => 0.9);

    const matchSame = compareEmbeddings(identical, enrolled, DEFAULT_MATCH_THRESHOLD);
    assert.equal(matchSame.matched, true);
    assert.ok(matchSame.distance < 1e-4);

    const matchDiff = compareEmbeddings(different, enrolled, DEFAULT_MATCH_THRESHOLD);
    assert.equal(matchDiff.matched, false);
    assert.ok(matchDiff.distance > DEFAULT_MATCH_THRESHOLD);
  });
});
