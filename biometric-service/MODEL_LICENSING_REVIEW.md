# HRMS Biometric Service — Model Licensing & Technical Verification Report

**Target Service:** `biometric-service/` (Python 3.11, FastAPI, CPU-only ONNX Runtime / PyTorch)  
**Review Scope:** Documentation-only licensing, provenance, compatibility, and limitation verification for candidate model families (YuNet, SFace, MiniFASNet V2/V1SE).  
**Review Date:** 2026-11-25  

---

## Strict Policy: Pre-Deployment Model Clearance Rule

> [!CAUTION]
> **Mandatory Policy Rule:** No model weights or checkpoints may be downloaded into the production project repository, stored in deployment images, or configured for production runtime execution until the required clearance checklist has been completed and formally reviewed by legal, security, and compliance stakeholders.

---

## Executive Summary

| Candidate | Pipeline Role | Repository / Code License | Distributed Model Artifact License | Training Dataset Benchmark / Provenance | Commercial Deployment Clearance Status | Technical Integration Status in `biometric-service/` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **YuNet** (`face_detection_yunet_2023mar.onnx`) | Face Detection + 5-Point Landmarks | MIT (`opencv_zoo`) | MIT (`opencv_zoo/models/face_detection_yunet`) | WIDER FACE benchmark evaluation / training pipeline | **Unresolved Legal/IP Question** (Requires IP review of upstream dataset interaction) | **Integrated** (`YuNetDetectorAdapter` via OpenCV `FaceDetectorYN` / ONNX) |
| **SFace** (`face_recognition_sface_2021dec.onnx`) | Face Recognition (128-D Embedding) | Apache-2.0 (`opencv_zoo`) | Apache-2.0 (`opencv_zoo/models/face_recognition_sface`) | Upstream literature cites MS1M / CASIA-WebFace; exact checkpoint dataset unverified in primary sources | **Unresolved Legal/IP Question** (Requires primary-source checkpoint provenance verification) | **Placeholder** (`extract_face_embedding` fails closed with HTTP 503) |
| **MiniFASNet V2 & V1SE** (`Silent-Face-Anti-Spoofing`) | Presentation Attack Detection (PAD) | Apache-2.0 (`minivision-ai/Silent-Face-Anti-Spoofing`) | Distributed within Apache-2.0 repo tree (no separate weight grant) | Undocumented in repository (academic PAD literature uses OULU-NPU / CASIA-FASD / CelebA-Spoof) | **Unresolved Legal/IP Question** (Checkpoints lack training dataset & consent documentation) | **Integrated** (`MiniFASNetOnnxAdapter` via ONNX Runtime; export required) |

---

## Core Licensing Distinctions & Principles

When evaluating deep-learning models for commercial software deployment, four distinct legal and operational layers must be evaluated separately:

1. **Repository & Code License:** The copyright license governing the implementation source code (e.g., Python scripts, model definition classes, data loaders).
2. **Distributed Model Artifact License:** The copyright or distribution license under which the binary weights or graph files (`.onnx`, `.pth`, `.tflite`) are hosted and released by the maintainers.
3. **Training Dataset Provenance & License:** The copyright, terms of use, privacy rights, and consent terms of the raw images and annotations used during training optimization.
4. **Commercial Deployment Clearance:** The enterprise business decision—evaluated by qualified IP counsel—determining whether deploying model weights derived from specific datasets creates legal exposure under copyright, breach of contract, or biometric data protection laws (e.g., GDPR Article 9, India DPDP Act, Illinois BIPA).

> [!IMPORTANT]
> **Do Not Conflate Layers:** A permissive model artifact license (such as MIT or Apache-2.0) does **not** automatically become invalid simply because an upstream research dataset had restrictive academic terms. Conversely, a permissive code license does **not** automatically grant commercial rights over proprietary or restricted training data. The interaction between training data terms and downstream functional weights is an **unresolved legal and intellectual property question** that depends on jurisdiction, fair use / text-and-data-mining doctrines, and contractual privity.

---

## Current `biometric-service/` Implementation Baseline

The current implementation status in `biometric-service/` is:

- **Face Detection (YuNet):** Fully implemented adapter (`app/services/face_detector_yunet.py`) wrapping `cv2.FaceDetectorYN` with thread-safe input sizing and strict single-face validation. Configurable via `FACE_DETECTION_MODEL_PATH`.
- **Presentation Attack Detection (MiniFASNet V2 & V1SE):** Fully implemented adapter (`app/services/pad_minifasnet.py`) supporting multi-scale crops (`2.7x` and `4.0x`) and CPU ONNX Runtime sessions with independent variant score tracking. Offline export utility provided at `scripts/export_minifasnet_onnx.py`. Configurable via `PAD_V2_MODEL_PATH` and `PAD_V1SE_MODEL_PATH`.
- **Face Recognition (Deferred):** Intentionally preserved as a Phase 1/Phase 2 fail-closed placeholder (`app/services/face_recognition.py`), raising `ModelUnavailableError` (HTTP 503).
- **Service Capability Readiness:** `/ready` returns HTTP 200 when liveness capability (detection + PAD) is loaded; `/enroll` and `/verify` remain strictly fail-closed (HTTP 503) pending face recognition selection.
- **Model Weights Baseline:** **Zero model weights are configured or bundled.** All weights directories (`weights/`) contain only `.gitkeep`. Tests execute exclusively against synthetic arrays and mock session objects.

---

## Runtime Concurrency & Threading Engineering Requirements

In FastAPI applications running on ASGI servers (such as Uvicorn), route handlers defined with `async def` execute on the main event loop thread:

- **Production Engineering Requirement:** CPU-bound inference operations (such as ONNX Runtime forward passes, OpenCV image decodes, and PyTorch executions) are synchronous and blocking. Executing them directly inside asynchronous route handlers blocks the event loop, degrading API responsiveness and causing health probes (`/health`, `/ready`) to stall.
- **Dispatch Strategy:** In production, synchronous model inference and CPU-intensive preprocessing must be dispatched using `asyncio.to_thread(...)` or a dedicated bounded `concurrent.futures.ThreadPoolExecutor`.
- **Threadpool Tuning:** CPU execution providers (`onnxruntime.InferenceSession`) should be configured with bounded `intra_op_num_threads` (e.g., 2–4) and `inter_op_num_threads` (e.g., 1) to prevent CPU thread oversubscription and thrashing under concurrent attendance punch requests.
- **Status & Production Readiness:** Full threadpool integration, concurrency limits, and load validation remain required engineering tasks for production deployment; this capability must not be assumed to be complete without empirical load testing.

---

## 1. YuNet — OpenCV Zoo (`face_detection_yunet_2023mar.onnx`)

### 1.1 Upstream Origin & Artifact Information
- **Repository:** `https://github.com/opencv/opencv_zoo`
- **Model Directory:** `https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet`
- **Model File Name:** `face_detection_yunet_2023mar.onnx` (~232 KB, ~75K parameters)
- **Upstream Development:** Originates from `ShiqiYu/libfacedetection.train` and was integrated into OpenCV Zoo.

### 1.2 Code vs. Model Artifact Licensing
- **Code License:** MIT License in `opencv/opencv_zoo/models/face_detection_yunet/`.
- **Model Artifact License:** The `.onnx` weight file is distributed in the same directory under the terms of the MIT license.

### 1.3 Training Dataset Provenance & Dataset License
- **Training Benchmark Provenance:** OpenCV Zoo documentation and upstream papers record evaluation and training on the **WIDER FACE** benchmark dataset.
- **Dataset License Status:** WIDER FACE was published for non-commercial academic research. The WIDER FACE terms do **not** provide an explicit commercial grant.
- **OpenCV Zoo Position:** OpenCV Zoo publishes the model directory under MIT, but does **not** assert or warrant a dataset-level commercial grant from the original WIDER FACE image rights holders.

### 1.4 Commercial Deployment Clearance Status
- **Status:** **Unresolved Legal/IP Question (Review Required).**
- **Assessment:** While the OpenCV Zoo code and `.onnx` file are distributed under MIT, whether deploying the `.onnx` weights for server-side commercial HRMS inference creates dataset-derivative exposure is an open legal determination requiring corporate IP review.

### 1.5 Written Clarification from Upstream Maintainers
- **Public Discussions:** Community and corporate compliance inquiries in `opencv/opencv_zoo` (e.g., Issues `#318` and `#320`) have requested maintainers clarify commercial usage of OpenCV Zoo models trained on academic datasets such as WIDER FACE.
- **Status:** Maintainers clarify repository file grants (MIT/Apache-2.0), but OpenCV Zoo publishes no blanket commercial indemnity or dataset-level copyright waiver from original benchmark authors.

### 1.6 Technical Compatibility, Outputs & Downstream Alignment Role
- **Format:** Native ONNX (compatible with `onnxruntime==1.20.1` and `opencv-python-headless==4.10.0.84` via `cv2.FaceDetectorYN`).
- **Conversion Requirements:** None.
- **Outputs:** Bounding box `(x, y, w, h)`, detection confidence score, and **5 facial landmarks** (right eye, left eye, nose tip, right mouth corner, left mouth corner).
- **Role in Pipeline:** The 5 facial landmarks are required to calculate a partial affine similarity transform (`cv2.estimateAffinePartial2D`) to warp faces into canonical 112x112 coordinates for downstream recognition models (such as SFace or MobileFaceNet).

### 1.7 Limitations & Security Considerations
- **Detection Edge Cases:** Performance degrades on extreme pose angles (yaw/pitch/roll `> 45°`), heavy facial occlusion (masks, scarves, hands), severe motion blur, low-light sensor noise, and small faces where `min(w, h) < 60px`.
- **Anti-Spoofing Limitation:** YuNet is strictly a **2D bounding-box and landmark detector**. It possesses **zero presentation attack detection (PAD) capabilities**. While it can detect printed photos, phone screens, and video replays as faces, it cannot establish liveness or verify that the detected face is genuine. Detection must always be gated by dedicated PAD verification.

---

## 2. SFace — OpenCV Zoo (`face_recognition_sface_2021dec.onnx`)

### 2.1 Upstream Origin & Artifact Information
- **Repository:** `https://github.com/opencv/opencv_zoo`
- **Model Directory:** `https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface`
- **Model File Name:** `face_recognition_sface_2021dec.onnx` (~38 MB)
- **Paper Reference:** *"Accurate and Lightweight Face Recognition with Sigmoid-Constrained Hypersphere Loss"* (Zhong et al., 2021).

### 2.2 Code vs. Model Artifact Licensing
- **Code License:** Apache License 2.0 in `opencv/opencv_zoo/models/face_recognition_sface/`.
- **Model Artifact License:** Distributed under Apache License 2.0 within OpenCV Zoo.

### 2.3 Training Dataset Provenance & Verification Gap
- **Literature Context:** Upstream academic papers evaluating SFace architectures describe training on large academic face benchmarks such as **MS1M** (MS-Celeb-1M / MS1MV2) and **CASIA-WebFace**.
- **Important Distinction:** MS-Celeb-1M was retired by Microsoft due to ethical and privacy concerns; academic splits (e.g., MS1M-ArcFace) carry non-commercial research terms.
- **Unverified Checkpoint Provenance:** OpenCV Zoo documentation explicitly grants Apache-2.0 for the model wrapper and hosted `.onnx` file, but **does not document the exact primary-source training corpus used to optimize `face_recognition_sface_2021dec.onnx`**. Whether this specific checkpoint was trained on an academic MS1M split, WebFace, or a vendor-internal dataset is unconfirmed in primary documentation.

### 2.4 Commercial Deployment Clearance Status
- **Status:** **Unresolved Legal/IP Question (Primary-Source Confirmation Required).**
- **Assessment:** The artifact is offered under Apache-2.0. However, because biometric face-recognition weights in commercial HRMS platforms face strict data protection regulations (GDPR Art. 9, DPDP Act, BIPA), primary-source confirmation of the checkpoint's underlying training dataset and consent status must be established before production deployment.

### 2.5 Written Clarification from Upstream Maintainers
- **Public Discussions:** OpenCV Zoo discussions (including Issues `#318` and `#320`) reflect community requests for dataset-level warranties. Maintainers confirm repository licensing terms but do not provide third-party data clearance warranties.

### 2.6 Technical Compatibility, Input/Output Specs & Latency
- **Format:** Native ONNX (~38 MB).
- **Input Requirements:** Requires pre-aligned **112x112** 3-channel BGR face crops generated via 5-point similarity transformation from facial landmarks.
- **Output:** Normalized **128-dimensional embedding vector** compared using cosine similarity.
- **Conversion Requirements:** None.
- **CPU Performance Considerations:** At ~38 MB, SFace has a significantly larger parameter footprint than lightweight mobile architectures (~4 MB MobileFaceNet). Target CPU container latency has **not been empirically benchmarked** on production hardware and must be evaluated against single-stage latency targets.
- **Implementation Status in Project:** **Deferred.** `extract_face_embedding` remains a fail-closed stub.

### 2.7 Accuracy, Threshold Calibration & Security Limitations
- **Alignment Sensitivity:** Recognition accuracy degrades sharply if landmark localization is imprecise or if bounding-box crops are fed without 5-point similarity alignment.
- **Environmental Drift:** Facial occlusions (glasses, facial hair, masks), lighting variance, and sensor differences between mobile front cameras and laptop webcams affect cosine similarity scores.
- **FAR/FRR Threshold Calibration:** The operational cosine threshold must be empirically calibrated using representative capture samples to balance False Acceptance Rate (security) against False Rejection Rate (user convenience).
- **Anti-Spoofing Limitation:** SFace is a **passive feature extractor only**. It cannot distinguish between a real face and a high-resolution spoof presentation; a photo replay of an authorized employee will match with high similarity unless blocked by PAD.

---

## 3. MiniFASNet V2 and V1SE — MiniVision (`Silent-Face-Anti-Spoofing`)

### 3.1 Upstream Origin & Artifact Information
- **Repository:** `https://github.com/minivision-ai/Silent-Face-Anti-Spoofing`
- **Checkpoints:**
  - `resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth` (~1.8 MB, ~0.435M params, `2.7x` context scale)
  - `resources/anti_spoof_models/4_0_0_80x80_MiniFASNetV1SE.pth` (~1.8 MB, ~0.41–0.44M params, `4.0x` context scale)

### 3.2 Code vs. Model Artifact Licensing
- **Code License:** Apache License 2.0 at the repository root.
- **Model Artifact License:** The `.pth` weight files are hosted in the Apache-2.0 repository tree without a separate restrictive license file.

### 3.3 Training Dataset Provenance & Verification Gap
- **Undocumented Training Provenance:** The `Silent-Face-Anti-Spoofing` repository documents model architectures and Fourier-frequency auxiliary supervision loss, but **provides no dataset cards, subject consent documentation, or primary-source disclosure** of the exact images used to train the included `.pth` weights.
- **Benchmark Context:** In academic literature, MiniFASNet models are evaluated on datasets such as OULU-NPU, CASIA-FASD, and CelebA-Spoof, which are strictly non-commercial research benchmarks. Whether MiniVision trained these checkpoints on public research benchmarks, internal proprietary data, or a combination is unverified.

### 3.4 Commercial Deployment Clearance Status
- **Status:** **Unresolved Legal/IP Question (Undocumented Provenance).**
- **Assessment:** Commercial use of the code is permitted under Apache-2.0. However, deploying the pre-trained weights requires either accepting the risk of undocumented dataset provenance or re-training the Apache-2.0 MiniFASNet architecture on a commercially licensed or consented anti-spoofing dataset.

### 3.5 Technical Compatibility, Preprocessing & Dual-Model Execution
- **Format:** Raw PyTorch `state_dict` `.pth` files.
- **Incompatibility with `torch.jit.load`:** Upstream checkpoints are **not** TorchScript archives. Attempting to load them via `torch.jit.load()` fails.
- **Conversion Requirement:** Must be exported to **ONNX** (`80x80` input, opset 17) using `scripts/export_minifasnet_onnx.py`.
- **Multi-Scale Crop Preprocessing:**
  - MiniFASNet V2 expects a **2.7x** scale expansion around the face center, clamped to image bounds and resized to **80x80**.
  - MiniFASNet V1SE expects a wider context expansion (**4.0x** scale), clamped to image bounds and resized to **80x80**.
- **Output Logits & Class Index Verification:**
  - Upstream models produce 3-class classification logits `[class_0, class_1, class_2]`.
  - In upstream test scripts, softmax probability at **index 1** represents the bona fide (live) class.
  - Class-index mapping must remain explicitly subject to verification against the exact upstream checkpoint and exported ONNX model before deployment.
- **Dual-Model Configuration:** Combining V2 (focusing on local frequency cues) and V1SE (evaluating broader context) improves attack discrimination; both variant scores should be observed independently before applying fusion weights.
- **Implementation Status in Project:** Fully integrated in `app/services/pad_minifasnet.py` via ONNX Runtime CPUExecutionProvider. Default threshold (0.5) is explicitly marked **uncalibrated** until validated against physical capture samples.

### 3.6 Limitations & Attack Vulnerabilities
- **Passive Single-Frame Scope:** Operates strictly on single static 2D images. Does not perform active challenge-response (e.g., eye blink, head turns, smile) or 3D depth/IR analysis.
- **Attack Vulnerabilities:** Vulnerable to high-DPI OLED/Retina screen replays held at distances where moiré patterns are imperceptible, well-lit matte photographic prints, and high-quality 3D silicone or resin masks.
- **Domain Shift:** Significant differences in camera sensors, automatic white balance, lens distortion, and compression between mobile front cameras and laptop webcams can alter frequency characteristics, leading to false rejections (BPCER) or false acceptances (APCER).
- **Certification:** Holds **no independent ISO/IEC 30107-3 (PAD Level 1 or Level 2)** certification.

---

## Facts vs. Assumptions vs. Unresolved Questions

### Confirmed Technical & Legal Facts
1. `biometric-service/` environment includes `onnxruntime==1.20.1`, `opencv-python-headless==4.10.0.84`, `numpy==2.1.3`, `pillow==11.0.0`, and `torch==2.5.1`.
2. `ModelManager` loads `.onnx` models via `onnxruntime.InferenceSession` and rejects raw PyTorch `.pth` `state_dict` checkpoints with explicit export guidance.
3. OpenCV Zoo licenses `face_detection_yunet` under **MIT** and `face_recognition_sface` under **Apache-2.0**.
4. MiniVision licenses `Silent-Face-Anti-Spoofing` code under **Apache-2.0**, but checkpoint training data provenance is omitted from repository documentation.
5. SFace requires 112x112 pre-aligned crops and generates 128-D embeddings; MiniFASNet V2/V1SE requires 80x80 multi-scale crops and generates 3-class logits.
6. Phase 2 implementation routes `/ready` to HTTP 200 upon liveness readiness (detection + PAD), while `/enroll` and `/verify` fail closed (HTTP 503) pending face recognition model selection.

### Engineering Assumptions (Subject to Empirical Validation)
1. Combining YuNet (75K params) + MiniFASNet V2/V1SE (0.86M params) + SFace (9.5M params) on CPU via ONNX Runtime can achieve acceptable responsiveness, but actual container latency under load remains unmeasured.
2. Equal-weight score fusion (0.5 V2 + 0.5 V1SE) is an initial operational baseline and must be calibrated on actual hardware before production deployment.

### Unresolved Legal, IP & Governance Questions
1. **OpenCV Zoo Derivative Clearance:** Does corporate legal counsel approve deploying OpenCV Zoo MIT/Apache-2.0 `.onnx` models for server-side commercial inference where upstream research utilized WIDER FACE or MS1M/WebFace?
2. **SFace Checkpoint Primary Source:** Can primary-source documentation be established verifying the exact training images used to produce `face_recognition_sface_2021dec.onnx`?
3. **MiniFASNet Checkpoint Policy:** Will compliance accept the undocumented dataset provenance of MiniVision's `.pth` weights under Apache-2.0, or does enterprise risk policy require retraining on a consented dataset?
4. **Biometric Data Governance:** Have data protection impact assessments (DPIA), employee biometric consent mechanisms, retention schedules, and template encryption workflows been signed off under applicable regional laws (e.g., GDPR Art. 9, DPDP Act, BIPA)?

---

## Model Clearance Checklist

Before downloading or configuring any model weights in the production HRMS environment, compliance and engineering teams must complete and document the following verification checklist for each candidate:

```markdown
### Model Clearance Checklist: [Model Name & Version]

- [ ] 1. Exact Artifact Identification:
      - Source URL: __________________________________________________
      - Immutable Revision (Git Commit SHA / Release Tag): ___________
      - Artifact File Name: __________________________________________
- [ ] 2. Cryptographic Integrity:
      - SHA-256 Checksum: ____________________________________________
      - Verified against upstream publisher hash: [Yes / No]
- [ ] 3. License Verification:
      - Repository License: __________________________________________
      - Artifact-Specific License / EULA: ____________________________
      - Upstream Scope & Restrictions (e.g., non-commercial, attribution):
        ______________________________________________________________
- [ ] 4. Author / Maintainer Confirmation (if applicable):
      - Written confirmation or issue response received: [Yes / N/A]
      - Record reference: ____________________________________________
- [ ] 5. Training Dataset Provenance & Consent:
      - Primary-source training dataset identified: __________________
      - Dataset licensing terms documented: _________________________
      - Data subject consent / privacy evaluation completed: _________
- [ ] 6. Commercial-Use Clearance:
      - Legal / IP counsel review completed: [Yes / Pending]
      - Formal approval status: [Approved / Conditional / Rejected]
      - Date of Legal Sign-Off: ______________________________________
      - Approving Counsel: ___________________________________________
- [ ] 7. Technical Validation & Proposed Engineering Targets:
      - Supported by current `biometric-service/` environment: [Yes / No]
      - Single-stage CPU latency (Proposed engineering target: < 300 ms): _____ ms
      - End-to-end request CPU latency (Proposed engineering target: < 1000 ms): _____ ms
      - Verification FAR / FRR / APCER / BPCER calibrated: [Yes / Pending]
```

---

## Action Items Before Commercial GA

1. **Submit OpenCV Zoo YuNet & SFace for IP Review:** Present the OpenCV Zoo MIT/Apache-2.0 artifact grants and training dataset contexts to enterprise IP counsel for commercial deployment clearance.
2. **Resolve SFace Checkpoint Provenance:** Request or confirm primary-source documentation regarding the exact dataset used to produce `face_recognition_sface_2021dec.onnx`.
3. **Decide on MiniFASNet Weights vs. Retraining:** Determine whether to seek legal acceptance of MiniVision's Apache-2.0 `.pth` weights or to train MiniFASNet from scratch on a fully documented, consented commercial anti-spoofing dataset.
4. **Hardware CPU Benchmarking:** Measure actual p95 CPU inference latency and memory footprints under concurrent multi-user punch-in load on the target container architecture against proposed engineering targets (< 300 ms per stage, < 1,000 ms end-to-end).
5. **Biometric Privacy Compliance:** Verify company-wide policies for employee consent, biometric data retention, encryption key rotation, and audit logging as mandated by local data protection authorities.
