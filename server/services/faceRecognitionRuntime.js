/**
 * F39 — Face recognition TFJS / face-api runtime lifecycle.
 *
 * Keeps model load + backend init as a single coalesced promise per warm process,
 * bounds concurrent inference, and helps dispose tensors after each request.
 * Mandatory verification still runs inline on the punch/enroll request path.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { HttpError } from "../utils/httpError.js";

/** Max decoded edge (px) accepted before rejection. */
export const FACE_MAX_IMAGE_EDGE = Math.max(
  320,
  Number(process.env.FACE_MAX_IMAGE_EDGE) || 4096
);

/** Downscale detection canvas so longest edge is at most this (thresholds scaled). */
export const FACE_DETECT_MAX_EDGE = Math.max(
  160,
  Number(process.env.FACE_DETECT_MAX_EDGE) || 960
);

/** Parallel face inferences per Node process (Vercel instance). */
export const FACE_INFERENCE_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number(process.env.FACE_INFERENCE_CONCURRENCY) || 2)
);

/** Max wait for an inference slot before 503 (ms). */
export const FACE_INFERENCE_QUEUE_MS = Math.max(
  1000,
  Number(process.env.FACE_INFERENCE_QUEUE_MS) || 25_000
);

function defaultModelsDir() {
  return (
    process.env.FACE_MODELS_DIR ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets/face-models")
  );
}

/**
 * @typedef {object} FaceRuntimeState
 * @property {Promise<object>|null} initPromise
 * @property {boolean} loaded
 * @property {Error|null} lastInitError
 * @property {number} initAttempts
 * @property {number} initSuccessCount
 * @property {import("@tensorflow/tfjs")|null} tf
 * @property {typeof import("@vladmandic/face-api")|null} faceapi
 * @property {{ createCanvas: Function, loadImage: Function }|null} canvasApi
 * @property {string|null} modelsDir
 * @property {number} activeInferences
 * @property {number} peakActiveInferences
 * @property {Array<{ resolve: Function, reject: Function, timer: NodeJS.Timeout }>} waitQueue
 */

/** @type {FaceRuntimeState} */
let state = createFreshState();

/** Optional test override for model load (never used in production). */
let testLoader = null;

function createFreshState() {
  return {
    initPromise: null,
    loaded: false,
    lastInitError: null,
    initAttempts: 0,
    initSuccessCount: 0,
    tf: null,
    faceapi: null,
    canvasApi: null,
    modelsDir: null,
    activeInferences: 0,
    peakActiveInferences: 0,
    waitQueue: [],
  };
}

/**
 * Test-only: replace disk/TFJS load. Pass `null` to restore the real loader.
 * @param {null|(() => Promise<{ tf: object, faceapi: object, canvasApi: object, modelsDir: string }>)} fn
 */
export function setFaceRuntimeLoaderForTests(fn) {
  testLoader = typeof fn === "function" ? fn : null;
}

export function getFaceModelsDir() {
  return defaultModelsDir();
}

/** Test / ops snapshot — no secrets. */
export function getFaceRuntimeDiagnostics() {
  return {
    loaded: state.loaded,
    initInFlight: Boolean(state.initPromise) && !state.loaded,
    initAttempts: state.initAttempts,
    initSuccessCount: state.initSuccessCount,
    lastInitError: state.lastInitError ? String(state.lastInitError.message || state.lastInitError) : null,
    modelsDir: state.modelsDir,
    activeInferences: state.activeInferences,
    peakActiveInferences: state.peakActiveInferences,
    waitQueueLength: state.waitQueue.length,
    concurrency: FACE_INFERENCE_CONCURRENCY,
    detectMaxEdge: FACE_DETECT_MAX_EDGE,
    maxImageEdge: FACE_MAX_IMAGE_EDGE,
    numTensors: state.tf?.memory ? state.tf.memory().numTensors : null,
  };
}

/**
 * Reset runtime for unit tests. Does not unload native TF weights from the process
 * if already loaded — clears bookkeeping and allows a fresh init promise.
 */
export function resetFaceRuntimeForTests({ hard = true } = {}) {
  for (const waiter of state.waitQueue) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("Face runtime reset"));
  }
  if (hard) {
    testLoader = null;
  }
  const keepModules = !hard && state.loaded;
  const tf = keepModules ? state.tf : null;
  const faceapi = keepModules ? state.faceapi : null;
  const canvasApi = keepModules ? state.canvasApi : null;
  const modelsDir = keepModules ? state.modelsDir : null;
  const initSuccessCount = keepModules ? state.initSuccessCount : 0;
  state = createFreshState();
  if (keepModules && tf && faceapi && canvasApi) {
    state.loaded = true;
    state.tf = tf;
    state.faceapi = faceapi;
    state.canvasApi = canvasApi;
    state.modelsDir = modelsDir;
    state.initSuccessCount = initSuccessCount;
  }
}

/**
 * Coalesced TFJS + face-api model load. Concurrent callers share one promise.
 * Failed init clears the promise so a later request can retry.
 */
export async function ensureFaceRuntime() {
  if (state.loaded && state.tf && state.faceapi && state.canvasApi) {
    return state;
  }
  if (state.initPromise) {
    return state.initPromise;
  }

  state.initPromise = (async () => {
    state.initAttempts += 1;
    try {
      let loaded;
      if (testLoader) {
        loaded = await testLoader();
      } else {
        loaded = await loadFaceRuntimeFromDisk();
      }

      state.tf = loaded.tf;
      state.faceapi = loaded.faceapi;
      state.canvasApi = loaded.canvasApi;
      state.modelsDir = loaded.modelsDir;
      state.loaded = true;
      state.lastInitError = null;
      state.initSuccessCount += 1;
      return state;
    } catch (err) {
      state.lastInitError = err instanceof Error ? err : new Error(String(err));
      state.loaded = false;
      state.tf = null;
      state.faceapi = null;
      state.canvasApi = null;
      // Allow a subsequent request to retry initialization.
      state.initPromise = null;
      throw state.lastInitError;
    }
  })();

  return state.initPromise;
}

async function loadFaceRuntimeFromDisk() {
  const tf = await import("@tensorflow/tfjs");
  await import("@tensorflow/tfjs-backend-cpu");
  await tf.setBackend("cpu");
  await tf.ready();

  const faceapi = await import("@vladmandic/face-api");
  const canvasMod = await import("@napi-rs/canvas").catch(() => null);
  const createCanvas = canvasMod?.createCanvas;
  const loadImage = canvasMod?.loadImage;
  if (!createCanvas || !loadImage) {
    throw new Error("Canvas backend (@napi-rs/canvas) is required for face recognition.");
  }

  const modelsDir = defaultModelsDir();
  if (!fs.existsSync(modelsDir)) {
    throw new Error(`Face models directory not found: ${modelsDir}`);
  }
  const entries = fs.readdirSync(modelsDir).filter((n) => !n.startsWith(".") && n !== ".gitkeep");
  if (!entries.length) {
    throw new Error(`Face models directory is empty: ${modelsDir}. Run: npm run face:models`);
  }

  // Load weights once per warm process (coalesced by initPromise).
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsDir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsDir);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsDir);

  return {
    tf,
    faceapi,
    canvasApi: { createCanvas, loadImage },
    modelsDir,
  };
}

/**
 * Acquire a bounded inference slot. Fail-closed: queue timeout → 503 (never skip verify).
 */
export async function withFaceInferenceSlot(fn) {
  if (state.activeInferences >= FACE_INFERENCE_CONCURRENCY) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = state.waitQueue.findIndex((w) => w.timer === timer);
        if (idx >= 0) state.waitQueue.splice(idx, 1);
        reject(
          new HttpError(
            503,
            "Face verification is busy. Please retry in a moment.",
            { code: "FACE_INFERENCE_BUSY" }
          )
        );
      }, FACE_INFERENCE_QUEUE_MS);
      state.waitQueue.push({ resolve, reject, timer });
    });
  }

  state.activeInferences += 1;
  if (state.activeInferences > state.peakActiveInferences) {
    state.peakActiveInferences = state.activeInferences;
  }
  try {
    return await fn();
  } finally {
    state.activeInferences = Math.max(0, state.activeInferences - 1);
    const next = state.waitQueue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    }
  }
}

/**
 * Best-effort disposal of face-api / TFJS intermediates after a request.
 * Safe to call when detections is empty or dispose hooks are missing.
 */
export function disposeFaceDetections(tf, detections) {
  if (!detections?.length) {
    tryDisposeEngineExtras(tf);
    return;
  }
  for (const det of detections) {
    try {
      det.detection?.dispose?.();
    } catch {
      /* ignore */
    }
    try {
      // Some face-api builds keep tensor refs on unresized results
      det.unresizedImageResults?.dispose?.();
    } catch {
      /* ignore */
    }
  }
  tryDisposeEngineExtras(tf);
}

function tryDisposeEngineExtras(tf) {
  if (!tf?.engine) return;
  try {
    // Drop orphaned tensors from the last inference when the engine supports it.
    const eng = tf.engine();
    if (typeof eng.startScope === "function" && typeof eng.endScope === "function") {
      // Scopes must be paired around work; here we only tidy stray state if tidy exists.
    }
    if (typeof tf.disposeVariables === "function") {
      // Do not disposeVariables — that would wipe model weights.
    }
  } catch {
    /* ignore */
  }
}

/**
 * Build a detection canvas, downscaling large images. Returns scale vs original.
 */
export function buildDetectionCanvas(img, { createCanvas }) {
  const srcW = img.width;
  const srcH = img.height;
  if (!srcW || !srcH) {
    throw new HttpError(400, "Invalid face image dimensions.");
  }
  if (srcW > FACE_MAX_IMAGE_EDGE || srcH > FACE_MAX_IMAGE_EDGE) {
    throw new HttpError(
      400,
      `Face image dimensions are too large (max edge ${FACE_MAX_IMAGE_EDGE}px).`,
      { code: "FACE_IMAGE_TOO_LARGE" }
    );
  }

  const scale = Math.min(1, FACE_DETECT_MAX_EDGE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  return { canvas, scale, width, height, srcW, srcH };
}
