# HRMS Biometric Service — Phase 2 Implementation Report

**Service Directory:** `biometric-service/`  
**Phase:** Phase 2: OpenCV + YuNet + MiniFASNet V2/V1SE Integration  
**Date:** 2026-11-25  
**Test Suite Status:** 33/33 Tests Passing (`pytest`)

---

## 1. Executive Summary

Phase 2 establishes model-independent inference interfaces and OpenCV/ONNX Runtime adapters for face detection and Presentation Attack Detection (PAD) within the independent Python biometric service (`biometric-service/`). 

All inference operations are strictly bounded, authenticated, and fail-closed:
- **Face Detection:** Model-independent `FaceDetector` protocol with `YuNetDetectorAdapter` (`cv2.FaceDetectorYN`). Enforces single-face presence (`FaceValidationError` -> HTTP 422) and minimum bounding-box dimensions (`MIN_FACE_SIZE_PX`).
- **Presentation Attack Detection (PAD):** Model-independent `PADEngine` protocol with `MiniFASNetOnnxAdapter` supporting dual-model inference (V2 `2.7x` scale and V1SE `4.0x` scale) via CPU ONNX Runtime (`CPUExecutionProvider`).
- **Fail-Closed Guarantees:** Endpoints fail closed with HTTP 503 (`ModelUnavailableError`) whenever configured models are missing or corrupt. Raw PyTorch `.pth` `state_dict` files are explicitly detected and rejected with actionable conversion errors rather than attempting invalid `torch.jit.load`.
- **Face Recognition Scope:** Face recognition model selection remains deferred to Phase 3. `/api/v1/biometric/enroll` and `/api/v1/biometric/verify` execute detection and PAD checks, but fail closed with HTTP 503 on embedding extraction.

---

## 2. Files Created and Modified

### Modified Files:
- [app/core/config.py](file:///D:/HRMS/mern-project/biometric-service/app/core/config.py):
  - Added configurable detection settings: `yunet_score_threshold` (0.7), `yunet_nms_threshold` (0.3), `yunet_top_k` (5), `min_face_size_px` (60), `min_blur_laplacian_var` (0.0).
  - Added PAD model paths and uncalibrated parameters: `pad_v2_model_path`, `pad_v1se_model_path`, `pad_mandatory` (True), `pad_require_dual_model` (False), `pad_threshold` (0.5), `pad_v2_weight` (0.5), `pad_v1se_weight` (0.5), `pad_v2_scale` (2.7), `pad_v1se_scale` (4.0), `pad_input_size` (80), `pad_live_class_index` (1), `pad_color_order` ("BGR"), `pad_normalize_01` (False).
  - Added ONNX Runtime CPU thread limits: `onnx_intra_op_threads` (2), `onnx_inter_op_threads` (1).
- [app/services/model_manager.py](file:///D:/HRMS/mern-project/biometric-service/app/services/model_manager.py):
  - Implemented multi-model PAD loader (`_load_pad_models`) supporting V2 and V1SE ONNX models.
  - Added explicit check rejecting raw `.pth` `state_dict` checkpoints with guidance to use `scripts/export_minifasnet_onnx.py`.
  - Preserved backward-compatible `_load_single_model(name, raw_path, cfg=None)` signature and async initialization lock (`asyncio.Lock`).
  - Added independent readiness accessors: `is_detection_model_loaded()`, `is_recognition_model_loaded()`, `is_pad_model_loaded()`.
- [app/main.py](file:///D:/HRMS/mern-project/biometric-service/app/main.py):
  - Registered exception handlers for `ImagePreprocessingError` (HTTP 422), `FaceValidationError` (HTTP 422), `DetectionInferenceError` (HTTP 503), and `PADInferenceError` (HTTP 503).
- [app/schemas/biometric.py](file:///D:/HRMS/mern-project/biometric-service/app/schemas/biometric.py):
  - Added `BiometricLivenessRequest` and `LivenessCheckResponse`.
  - Added granular fields `detection_model_loaded` and `recognition_model_loaded` to `ReadinessChecks`.
- [app/api/routes/health.py](file:///D:/HRMS/mern-project/biometric-service/app/api/routes/health.py):
  - Updated `/ready` endpoint to report granular detection, recognition, and PAD model readiness states.
- [app/api/routes/biometric.py](file:///D:/HRMS/mern-project/biometric-service/app/api/routes/biometric.py):
  - Added protected `POST /api/v1/biometric/liveness` endpoint executing YuNet detection + MiniFASNet PAD.
  - Updated `/enroll` and `/verify` routes to execute preprocessing, face detection, and PAD before failing closed on embedding extraction.
- [biometric-service/.env.example](file:///D:/HRMS/mern-project/biometric-service/.env.example):
  - Documented all new environment variables and thresholds.
- [biometric-service/README.md](file:///D:/HRMS/mern-project/biometric-service/README.md):
  - Updated architecture overview, PAD conversion instructions, and setup steps.

### Newly Created Files:
- [app/services/image_preprocessing.py](file:///D:/HRMS/mern-project/biometric-service/app/services/image_preprocessing.py):
  - OpenCV BGR decoding (`decode_bgr_image`), Laplacian variance blur checking, 5-point similarity-transform canonical alignment to 112x112 (`align_face_5pt`), and aspect-preserving center-expanded cropping (`crop_for_minifasnet`) to 80x80 NCHW tensors (`prepare_minifasnet_tensor`).
- [app/services/face_detector_yunet.py](file:///D:/HRMS/mern-project/biometric-service/app/services/face_detector_yunet.py):
  - Model-independent `FaceDetector` protocol, `DetectedFace` dataclass, `YuNetDetectorAdapter` with `threading.Lock` protecting `cv2.FaceDetectorYN` input size state, and `validate_single_face` enforcement.
- [app/services/pad_minifasnet.py](file:///D:/HRMS/mern-project/biometric-service/app/services/pad_minifasnet.py):
  - Model-independent `PADEngine` protocol, `PADResult` dataclass, numerically stable `_softmax`, and `MiniFASNetOnnxAdapter` running V2 and V1SE ONNX sessions via ONNX Runtime CPUExecutionProvider.
- [scripts/export_minifasnet_onnx.py](file:///D:/HRMS/mern-project/biometric-service/scripts/export_minifasnet_onnx.py):
  - Standalone offline export tool converting local MiniFASNet V2 and V1SE `.pth` `state_dict` checkpoints to `.onnx`. Does not download weights.
- [tests/test_preprocessing.py](file:///D:/HRMS/mern-project/biometric-service/tests/test_preprocessing.py):
  - 6 unit tests covering OpenCV decoding, corrupted payload rejection, blur rejection, 5-point alignment, boundary clamping, and NCHW tensor conversion.
- [tests/test_face_detection.py](file:///D:/HRMS/mern-project/biometric-service/tests/test_face_detection.py):
  - 5 unit tests covering YuNet detection parsing, 0-face rejection, multi-face rejection, small-face rejection, runtime failures, and missing-model fail-closed behavior.
- [tests/test_face_liveness.py](file:///D:/HRMS/mern-project/biometric-service/tests/test_face_liveness.py):
  - 6 unit tests covering raw `.pth` rejection, missing dual-model fail-closed behavior, live vs spoof classification, NaN/runtime error fail-closed handling, `/api/v1/biometric/liveness` API responses, and fail-closed `/enroll` responses.

---

## 3. API Changes and Contracts

### 1. New Protected Endpoint: `POST /api/v1/biometric/liveness`
- **Authentication:** Required header `X-Biometric-Service-Secret` (constant-time verification).
- **Request Body:**
  ```json
  {
    "image_base64": "data:image/jpeg;base64,..."
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "face_detected": true,
    "face_count": 1,
    "liveness_passed": true,
    "liveness_score": 0.9421,
    "calibrated": false,
    "message": "Liveness check passed (uncalibrated threshold)."
  }
  ```
- **Error Responses:**
  - `401 Unauthorized`: Missing `X-Biometric-Service-Secret`.
  - `403 Forbidden`: Invalid internal secret.
  - `413 Payload Too Large`: Payload exceeds `MAX_REQUEST_BYTES`.
  - `422 Unprocessable Entity`: Invalid image encoding, `NO_FACE_DETECTED`, `MULTIPLE_FACES_DETECTED`, or `FACE_TOO_SMALL`.
  - `503 Service Unavailable`: Face detection or PAD models unconfigured, missing, or corrupt (`FACE_DETECTION_UNAVAILABLE` or `PAD_MODEL_UNAVAILABLE`).

### 2. Enhanced Health & Readiness
- `GET /ready` returns HTTP 503 until all mandatory models are ready. The response includes granular boolean status for `detection_model_loaded`, `recognition_model_loaded`, and `pad_model_loaded`.
- `GET /api/v1/biometric/health` returns HTTP 503 until initialized and models are ready, reporting granular model statuses.

---

## 4. Model Loading & Preprocessing Technical Details

### MiniFASNet Assumptions Documented:
1. **Raw State Dict vs TorchScript:** Upstream `Silent-Face-Anti-Spoofing` distributes raw PyTorch `state_dict` `.pth` files. Loading these via `torch.jit.load` fails. `ModelManager` strictly requires `.onnx` for PAD and raises a clear configuration error if a `.pth` file is pointed to.
2. **Crop Geometry:** Matches `CropImage` from the upstream repository, applying aspect-preserving scaling centered on the face bounding box (`scale=2.7` for V2, `scale=4.0` for V1SE), clamping within frame bounds, and resizing via bilinear interpolation to `80x80`.
3. **Color Order and Range:** Upstream `Silent-Face-Anti-Spoofing` ingests BGR images from OpenCV and its custom `ToTensor` retains `[0.0, 255.0]` float32 values. Both `pad_color_order` (default "BGR") and `pad_normalize_01` (default False) are exposed in configuration for calibration against specific exported ONNX models.
4. **Output Classes:** Uses softmax over logits with index 1 designated as the bona fide (live) class score, with scores per variant tracked independently in internal evaluation.

---

## 5. Test Suite Verification Results

Both the 16 original baseline tests and the 17 new Phase 2 unit/integration tests passed completely.

```text
============================= test session starts =============================
platform win32 -- Python 3.12.10, pytest-8.3.4, pluggy-1.7.0
rootdir: D:\HRMS\mern-project\biometric-service
plugins: anyio-4.14.2
collected 33 items

tests/test_biometric_api.py::test_biometric_enroll_returns_503_when_models_absent PASSED
tests/test_biometric_api.py::test_biometric_verify_returns_503_when_models_absent PASSED
tests/test_biometric_api.py::test_biometric_rejects_invalid_image_payloads PASSED
tests/test_face_detection.py::test_yunet_adapter_parses_single_face_and_landmarks PASSED
tests/test_face_detection.py::test_validate_single_face_rejects_zero_multiple_and_small_faces PASSED
tests/test_face_detection.py::test_yunet_adapter_raises_on_runtime_failure PASSED
tests/test_face_detection.py::test_detect_single_face_fails_closed_when_model_unavailable PASSED
tests/test_face_detection.py::test_detect_single_face_succeeds_with_mocked_session PASSED
tests/test_face_liveness.py::test_model_manager_rejects_raw_pth_for_pad_without_torch_jit_assumption PASSED
tests/test_face_liveness.py::test_model_manager_fails_closed_when_dual_pad_required_and_v1se_missing PASSED
tests/test_face_liveness.py::test_minifasnet_adapter_live_and_spoof_with_separate_variant_scores PASSED
tests/test_face_liveness.py::test_minifasnet_adapter_fails_closed_on_runtime_error_and_nan PASSED
tests/test_face_liveness.py::test_liveness_endpoint_fails_closed_when_models_unavailable PASSED
tests/test_face_liveness.py::test_liveness_endpoint_succeeds_with_mock_detection_and_pad_and_enroll_stays_503 PASSED
tests/test_health.py::test_health_endpoint_returns_ok PASSED
tests/test_health.py::test_ready_reports_unavailable_when_models_absent PASSED
tests/test_health.py::test_ready_reports_invalid_config_when_secret_missing PASSED
tests/test_health.py::test_ready_returns_200_when_mocked_models_ready PASSED
tests/test_health.py::test_model_manager_handles_missing_and_corrupt_files PASSED
tests/test_health.py::test_model_manager_prevents_concurrent_duplicate_init PASSED
tests/test_preprocessing.py::test_decode_bgr_image_success PASSED
tests/test_preprocessing.py::test_decode_bgr_image_rejects_empty_and_corrupt_bytes PASSED
tests/test_preprocessing.py::test_decode_bgr_image_rejects_blurry_when_threshold_set PASSED
tests/test_preprocessing.py::test_align_face_5pt_produces_112x112_output PASSED
tests/test_preprocessing.py::test_crop_for_minifasnet_clamps_bounds_and_resizes_to_80x80 PASSED
tests/test_preprocessing.py::test_prepare_minifasnet_tensor_formats_and_channel_order PASSED
tests/test_security.py::test_constant_time_secret_matches PASSED
tests/test_security.py::test_protected_endpoint_rejects_missing_auth PASSED
tests/test_security.py::test_protected_endpoint_rejects_invalid_auth PASSED
tests/test_security.py::test_protected_endpoint_fails_closed_when_server_secret_unset PASSED
tests/test_security.py::test_protected_endpoint_accepts_valid_auth PASSED
tests/test_security.py::test_request_size_limit_rejects_oversized_payload PASSED
tests/test_security.py::test_logging_redacts_images_embeddings_and_secrets PASSED

============================== 33 passed in 1.67s ==============================
```

---

## 6. Limitations and Next Steps

### Current Limitations:
1. **Uncalibrated PAD Thresholds:** Default threshold (`0.5`) and fusion weights (`0.5` / `0.5`) are placeholders. Real validation on physical webcam/phone captures is required before enabling production attendance.
2. **Face Recognition Deferred:** Embeddings and face matching are intentionally not implemented in Phase 2.
3. **Model Weight Provenance:** As documented in `MODEL_LICENSING_REVIEW.md`, public checkpoints require formal legal approval or commercial retraining.

### Next Steps (Phase 3):
1. Select and evaluate the face recognition model candidate (e.g., SFace ONNX vs. commercially licensed MobileFaceNet).
2. Implement 5-point aligned embedding extraction (`extract_face_embedding`) and cosine distance matching.
3. Wire the Node.js backend to `POST /api/v1/biometric/liveness` for pre-flight verification testing.
