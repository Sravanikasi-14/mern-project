# Face verification — Phase 0 (licensing & design)

**Status:** Phase 0 complete (documentation only). **No new models downloaded or integrated.**  
**Mandatory face:** remains **disabled** in production until Phase 2+ (MiniFASNet PAD implemented and ready).

Related: [ATTENDANCE_VERIFICATION.md](./ATTENDANCE_VERIFICATION.md), [F39_FACE_VERIFICATION_RUNTIME.md](./F39_FACE_VERIFICATION_RUNTIME.md) (request-path model lifecycle), approved hybrid architecture (challenge-bound capture + MiniFASNet PAD + server 1:1 match).

---

## 1. MiniFASNet (Silent-Face-Anti-Spoofing) — licence & provenance

| Item | Finding |
| --- | --- |
| Project | [minivision-ai/Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) |
| Copyright | Copyright 2020 Minivision (see LICENSE appendix) |
| **Code licence** | **Apache License 2.0** ([LICENSE](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/master/LICENSE)) |
| Commercial use | Apache-2.0 grants royalty-free copyright and patent licences suitable for commercial HRMS use, subject to attribution / NOTICE obligations |
| Open PAD weights (repo) | `resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth` (~1.8 MB), `resources/anti_spoof_models/4_0_0_80x80_MiniFASNetV1SE.pth` (~1.8 MB) |
| Weight provenance | Shipped **in the same Apache-2.0 repository** as the training/test code; no separate NC licence file found on the weight paths |
| Detector dependency | README references RetinaFace (InsightFace tree) for **detection during their demo pipeline** — Phase 2 should pair MiniFASNet with a commercially clear detector (e.g. existing face-api detector or OpenCV YuNet), not InsightFace **buffalo** recognition packs |
| Private model | README lists a higher-precision **private** model — **out of scope** (not open, not free) |
| Phase 2 intent | Use open MiniFASNetV1SE / MiniFASNetV2 weights only; retain Apache NOTICE; do not use Minivision commercial SDK |

**Phase 0 conclusion:** MiniFASNet **code + open pretrained PAD weights** are acceptable candidates under Apache-2.0 for zero-fee commercial self-hosting. Counsel may still review training-data provenance as policy. **Not downloaded in Phase 0/1.**

---

## 2. Existing face-api recognition weights — licence & commercial status

| Item | Finding |
| --- | --- |
| Runtime | `@vladmandic/face-api` (MIT) — https://github.com/vladmandic/face-api/blob/master/LICENSE |
| Upstream lineage | face-api.js (MIT) — https://github.com/justadudewhohacks/face-api.js |
| Models used by HRMS | SSD MobileNet v1 (detect), 68-landmark, face recognition (128-D FaceNet-style descriptor) |
| Download script | `server/scripts/downloadFaceModels.js` ← `raw.githubusercontent.com/vladmandic/face-api/master/model` |
| Weight sizes (approx.) | SSD ~5.4 MB + landmarks ~0.35 MB + recognition ~6.1 MB ≈ **12 MB** |
| Commercial clearance | **MIT covers the library.** FaceNet-style **checkpoints** are commonly trained on datasets (e.g. VGGFace2 / CASIA-WebFace) whose **image rights are separate** from MIT. MIT on the npm package does **not** by itself prove unconditional commercial clearance of all training-data rights. |

**Phase 0 conclusion:**

- **Retain existing recognition for Phase 1–2 development** (encryption, enrollment, 1:1 match, tests) while mandatory face stays locked.
- **Before claiming production-grade commercial recognition**, either:
  - obtain counsel sign-off on current face-api recognition weights, **or**
  - **migrate** to OpenCV Zoo **YuNet + SFace** (directory Apache-2.0; see https://github.com/opencv/opencv_zoo `models/face_recognition_sface`).
- **Do not** adopt InsightFace buffalo_* weights without a paid commercial licence (conflicts with zero-fee + commercial OSS rules).

---

## 3. Retain vs migrate recognition (decision for later phases)

| Option | When |
| --- | --- |
| **Retain face-api recognition** | Interim: optional face + Phase 2 PAD on top; counsel OK with weight provenance |
| **Migrate to YuNet + SFace** | Prefer if counsel rejects FaceNet-style weight provenance; clearer Apache-2.0 packaging |

Phase 0/1: **no migration**. Embeddings remain AES-256-GCM; model id stays `face-api-ssd-mobilenetv1-facenet` until a deliberate migration (would require re-enrollment).

---

## 4. Intended server-side PAD architecture (Phase 2+)

```
Client (Android / desktop)
  → capture face image(s) (+ later: challenge binding)
  → POST punch / enroll with faceImageBase64

Server (authoritative)
  1. Auth + tenant policy
  2. Fail-closed: recognition engine ready
  3. Fail-closed: FACE_LIVENESS_PROVIDER ∈ registry AND provider.isReady()
  4. Run PAD (MiniFASNet) on face crop — reject print/replay
  5. Run recognition embed + Euclidean match vs encrypted enrollment
  6. Persist audit (no raw image / plaintext embedding in APIs)
```

**Client flags (`livenessPassed`, `faceVerified`) are never trusted.**

### Vercel deployment constraints

| Constraint | Impact |
| --- | --- |
| Serverless package size / native deps | `@napi-rs/canvas` + TFJS + weights already heavy; adding ONNX/PyTorch MiniFASNet increases risk |
| Cold start | FaceNet-style CPU + PAD on cold invoke may exceed UX budgets |
| Models not in git | Only `.gitkeep` today — production must bake models into the deploy artifact or external volume |
| Recommendation | Keep auth/punch on Vercel; if inference is unreliable, run face match+PAD on a **small always-on worker** (infra cost, **$0 API fees**) |

Phase 1 does **not** change hosting. Mandatory face remains unavailable.

---

## 5. Phase 1 control (summary)

`FACE_LIVENESS_PROVIDER` is interpreted only via `server/services/faceLivenessProvider.js`:

| Provider id | PAD? | Implemented? | Unlocks mandatory face? |
| --- | --- | --- | --- |
| `heuristic` (default) | No | Yes (quality heuristic only) | **No** |
| `minifasnet` | Intended yes | **No** (Phase 2) | **No** (`isReady` fails) |
| `test-harness` | Test only | Yes when `NODE_ENV=test` | **Test only** |
| `vendor:*`, `challenge-response`, any other string | — | — | **No** (unknown) |

---

## 6. Remaining before Phase 2

1. Integrate MiniFASNet inference (ONNX Runtime or equivalent) + model install path.  
2. Wire `minifasnet.isReady()` to real weight presence + successful init.  
3. Run PAD inside enroll/verify analyze path (not env-only).  
4. Bind face evidence to verification challenges (replay).  
5. Decide retain vs YuNet+SFace after counsel.  
6. Prove Vercel or dedicated worker deployment with models present.  
7. **Do not** enable mandatory face in production until the above pass.
