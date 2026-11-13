# F39 — Face verification processing on the API request path

## Audit summary

| Finding | Detail |
|---------|--------|
| Critical path | Punch/enroll **awaits** `analyzeFaceImage` / `verifyEmployeeFace` **before** attendance write (correct fail-closed order). |
| Before F39 | Every inference re-imported TFJS, re-ran `setBackend`/`ready`, and raced `loadFromDisk` via a post-await `_loaded` flag. |
| Memory | No tensor/`dispose` after detection; full-resolution canvases for large uploads. |
| Concurrency | Unbounded parallel TFJS CPU inferences on one Vercel instance (1024 MB / 60 s). |
| Security (keep) | Server-side 1:1 match; encrypted embeddings; client `faceVerified` ignored; heuristic liveness never unlocks mandatory face. |

## Model lifecycle (after F39)

```
ensureFaceRuntime()          ← single coalesced promise per warm process
  └─ import tfjs + cpu backend once
  └─ setBackend("cpu") + ready() once
  └─ load SSD / landmarks / recognition from FACE_MODELS_DIR once
  └─ on failure: clear promise → next request may retry

analyzeFaceImage()
  └─ parseFaceImageInput (size / MIME gates)
  └─ withFaceInferenceSlot (bounded concurrency)
       └─ runFaceApiPipeline
            └─ downscale canvas (FACE_DETECT_MAX_EDGE)
            └─ detect + landmarks + descriptor
            └─ finally: disposeFaceDetections(...)
```

Injected `setFaceEngine` (tests) still bypasses TFJS; production path uses the runtime above.

**Mandatory verification is not deferred** to a background job — attendance cannot succeed before verification completes.

## Resource limits & configuration

| Env / constant | Default | Role |
|----------------|---------|------|
| `FACE_MODELS_DIR` | `server/assets/face-models` | Weight directory |
| `FACE_DETECT_MAX_EDGE` | `960` | Max detection canvas edge (downscale) |
| `FACE_MAX_IMAGE_EDGE` | `4096` | Reject absurd dimensions |
| `FACE_INFERENCE_CONCURRENCY` | `2` | Max parallel inferences / process |
| `FACE_INFERENCE_QUEUE_MS` | `25000` | Wait for slot; then **503** `FACE_INFERENCE_BUSY` |
| Base64 chars | `8_000_000` | `parseFaceImageInput` |
| Decoded bytes | `6_000_000` | `parseFaceImageInput` |

Quality / Euclidean match thresholds (`0.35` quality, `80px` face min scaled, `DEFAULT_MATCH_THRESHOLD=0.55`) are unchanged in intent; min box scales with downscale factor so semantics stay aligned.

## Files

| File | Change |
|------|--------|
| `server/services/faceRecognitionRuntime.js` | **New** — init coalesce, slots, dispose, canvas scale |
| `server/services/faceRecognitionService.js` | Uses runtime; tighter parse; dispose on exit |
| `server/tests/f39_face_runtime.test.js` | Lifecycle / limits / isolation / fail-closed |
| `docs/F39_FACE_VERIFICATION_RUNTIME.md` | This doc |

## Structural vs measured

| Improvement | Type |
|-------------|------|
| One weight load per warm process; concurrent init coalesced | **Structural** |
| Inference concurrency cap + queue timeout | **Structural** |
| Tensor dispose + detect downscale | **Structural** (expected lower peak RSS / CPU per request) |
| Payload / dimension rejection | **Structural** |

No production latency benchmarks are claimed in CI. Expected on warm instances: lower cold duplicate loads, fewer OOM spikes under concurrent punches, slightly faster large-image requests due to downscale.

## Remaining Vercel limitations

- Face still runs **in-process** on `api/index.js` (`memory: 1024`, `maxDuration: 60`).
- Cold start still pays first `ensureFaceRuntime()` (TFJS + ~12 MB weights + `@napi-rs/canvas`).
- Hobby/serverless scale-to-zero means many “first punches” are cold.
- Models must be present in the deploy artifact (`npm run face:models`); empty dir keeps mandatory face unavailable (fail-closed).
- A dedicated always-on worker would further help, but punch must **await** its result — out of scope for F39 (no new infra).
- MiniFASNet PAD remains unimplemented; heuristic liveness still does **not** unlock mandatory face.

## Tests

- `server/tests/f39_face_runtime.test.js`
- Re-run: `attendance_verification.test.js` and related multi-tenant / attendance suites
