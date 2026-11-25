# HRMS Biometric Service — Model Licensing & Technical Verification Report

**Target Service:** `biometric-service/` (Python 3.11, FastAPI, CPU-only ONNX Runtime / PyTorch)  
**Review Scope:** Read-only licensing, provenance, compatibility, and limitation verification for the three candidate model families. No weights were downloaded, no packages were installed, and no HRMS client/server files were modified.  
**Review Date:** 2026-11-25

---

## Executive Summary

| Candidate | Stage | Code License | Distributed Weight License | Training Dataset Provenance | Commercial Deployment Status | Technical Compatibility (`biometric-service/`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **YuNet** (`face_detection_yunet_2023mar.onnx`) | Face Detection + 5-Point Landmarks | MIT (`opencv_zoo`) | MIT (`opencv_zoo` model directory) | **WIDER FACE** (research benchmark; non-commercial / academic norms) | **Unclear / Legal Review Required** (MIT artifact vs. WIDER FACE upstream data) | **Direct ONNX Compatibility** (`onnxruntime` / `cv2.FaceDetectorYN`) |
| **SFace** (`face_recognition_sface_2021dec.onnx`) | Face Recognition (128-D Embedding) | Apache-2.0 (`opencv_zoo`) | Apache-2.0 (`opencv_zoo` model directory) | **MS1M / CASIA-WebFace** (upstream SFace research corpora; MS-Celeb-1M retracted) | **Unclear / Legal Review Required** (Apache-2.0 artifact vs. MS1M/WebFace provenance) | **Direct ONNX Compatibility** (`onnxruntime` / `cv2.FaceRecognizerSF`) |
| **MiniFASNet V2 & V1SE** (`Silent-Face-Anti-Spoofing`) | Presentation Attack Detection (PAD) | Apache-2.0 | Apache-2.0 repo tree (no separate weight provenance file) | **Undocumented in repository** (architecture evaluated on OULU-NPU / CASIA-FASD-class datasets) | **Unclear / Legal Review Required** (Apache-2.0 code vs. undocumented `.pth` training data) | **Conversion Required** (`.pth` `state_dict` incompatible with `torch.jit.load`; export to `.onnx`) |

> [!CAUTION]
> **Key Compliance Principle:** A permissive repository license (`MIT` or `Apache-2.0`) on code and hosted binary files does **not** automatically grant commercial rights over underlying third-party training datasets (such as WIDER FACE, MS1M, CASIA-WebFace, OULU-NPU, or CASIA-FASD). None of the three candidates can be declared unconditionally commercially approved solely on the basis of their GitHub repository licenses.

---

## Current `biometric-service/` Compatibility Baseline

Verified from the existing `biometric-service/` codebase:
- **Runtime Dependencies** (`biometric-service/requirements.txt`): `python 3.11`, `fastapi==0.115.6`, `onnxruntime==1.20.1`, `opencv-python-headless==4.10.0.84`, `torch==2.5.1` (CPU), `numpy==2.1.3`, `pillow==11.0.0`.
- **Configuration** (`biometric-service/app/core/config.py`): Model paths are configured via `FACE_DETECTION_MODEL_PATH`, `FACE_RECOGNITION_MODEL_PATH`, and `PAD_MODEL_PATH` under `WEIGHTS_DIR` (`./weights`). Currently all three default to `""` (unconfigured).
- **Model Loader Contract** (`biometric-service/app/services/model_manager.py`, `_validate_and_open_artifact`):
  - `.onnx` files are loaded via `onnxruntime.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])`.
  - `.pt` / `.pth` files are loaded **only** via `torch.jit.load(str(model_path), map_location="cpu")` (TorchScript archives). Raw PyTorch `state_dict` `.pth` checkpoints are **not** supported by `ModelManager` as written.
- **Inference Service Boundaries** (`app/services/face_detection.py`, `app/services/face_recognition.py`, `app/services/face_liveness.py`):
  - All three service functions are currently Phase 1 fail-closed stubs (`async def`) raising `ModelUnavailableError` (`503`).
  - Because `onnxruntime` and PyTorch CPU inference are synchronous and CPU-bound, production inference must be dispatched via `asyncio.to_thread(...)` or a bounded threadpool so FastAPI's event loop is not blocked.

---

## 1. YuNet — OpenCV Zoo (`face_detection_yunet_2023mar.onnx`)

### 1.1 Exact Upstream Repository and Model File
- **Upstream Repository:** `https://github.com/opencv/opencv_zoo`
- **Model Directory:** `https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet`
- **Exact Model File:** `face_detection_yunet_2023mar.onnx` (approx. 232 KB, ~75K parameters)
- **Upstream Training Origin:** `ShiqiYu/libfacedetection.train` / OpenCV Zoo YuNet pipeline.

### 1.2 Code License and Model-Weight License
- **Code License (Verified):** **MIT License** in `opencv/opencv_zoo/models/face_detection_yunet`.
- **Model-Weight License (Verified):** The `face_detection_yunet_2023mar.onnx` artifact is distributed inside the MIT-licensed `face_detection_yunet` directory of `opencv/opencv_zoo` without a separate restrictive commercial weight EULA.

### 1.3 Training Dataset Provenance and Dataset License
- **Training Dataset Provenance (Verified):** Trained and benchmarked on **WIDER FACE** (`libfacedetection.train` / OpenCV Zoo documentation).
- **Dataset License (Verified Fact + Compliance Risk):** WIDER FACE is a public academic face-detection dataset distributed for **research purposes** (images sourced from public web search/WIDER). It does not provide an explicit commercial redistribution or model-derivation grant.

### 1.4 Commercial Deployment Assessment
- **Status:** **Unclear — Requires Legal Sign-Off (Not Unconditionally Permitted).**
- **Reasoning:** While the OpenCV Zoo code and `.onnx` file are distributed under **MIT** (which permits commercial use, modification, and distribution), the weights are functionally derived from WIDER FACE. Whether deploying the `.onnx` weights for server-side commercial HRMS inference (without redistributing WIDER FACE images) is acceptable under your company's IP/compliance posture is a legal determination, not something guaranteed by the MIT `LICENSE` file alone.

### 1.5 Written Clarification from Upstream Maintainers
- **Verified Public Record:** Community and corporate compliance inquiries in `opencv/opencv_zoo` (e.g., Issues `#318` and `#320`) have specifically asked maintainers to clarify commercial usage of OpenCV Zoo models trained on academic datasets such as WIDER FACE.
- **Gap:** No blanket commercial indemnity or dataset-level copyright waiver from WIDER FACE authors is published in `opencv/opencv_zoo` for `face_detection_yunet_2023mar.onnx`.

### 1.6 Format, Compatibility with `biometric-service/`, and Conversion Requirements
- **Format:** Standard **ONNX** (`face_detection_yunet_2023mar.onnx`).
- **Compatibility:** **Directly compatible** with `biometric-service/` out of the box:
  - `model_manager.py` opens `.onnx` directly using `onnxruntime.InferenceSession(..., providers=["CPUExecutionProvider"])`.
  - Also natively supported by `opencv-python-headless==4.10.0.84` via `cv2.FaceDetectorYN.create(...)`.
- **Conversion Requirements:** **None.** No format conversion needed.
- **Alignment Output:** Outputs bounding boxes, detection confidence, and **5 facial landmarks** (right eye, left eye, nose tip, right mouth corner, left mouth corner), which directly feed 5-point similarity-transform alignment (`112x112`) for SFace.

### 1.7 Security, Accuracy, and Anti-Spoofing Limitations
- **Detection Limitations:** Degrades on extreme yaw/roll/pitch (`> 45°`), heavy occlusion (masks/scarves/hands), severe motion blur, very low-light webcam frames, or tiny faces (`< 20x20` px).
- **Security / Anti-Spoofing Limitations:** YuNet is strictly a **2D face detector**; it provides **zero** liveness or anti-spoofing capability and will happily detect printed photos, phone screens, and deepfake replays. It must be paired with a downstream PAD gate (`MiniFASNet` or equivalent) and server-side challenge/replay protection.

---

## 2. SFace — OpenCV Zoo (`face_recognition_sface_2021dec.onnx`)

### 2.1 Exact Upstream Repository and Model File
- **Upstream Repository:** `https://github.com/opencv/opencv_zoo`
- **Model Directory:** `https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface`
- **Exact Model File:** `face_recognition_sface_2021dec.onnx` (approx. 38 MB)

### 2.2 Code License and Model-Weight License
- **Code License (Verified):** **Apache License 2.0** in `opencv/opencv_zoo/models/face_recognition_sface`.
- **Model-Weight License (Verified):** The `face_recognition_sface_2021dec.onnx` file is distributed inside the Apache-2.0-licensed `face_recognition_sface` directory in `opencv/opencv_zoo`.

### 2.3 Training Dataset Provenance and Dataset License
- **Training Dataset Provenance (Verified):** Upstream SFace models were trained on large-scale public academic face-recognition corpora — specifically **MS1M** (MS-Celeb-1M / MS1MV2 variants) and/or **CASIA-WebFace**.
- **Dataset License & Legal History (Verified):**
  - **MS-Celeb-1M (MS1M):** Originally released by Microsoft for academic/non-commercial research and **officially retired/retracted by Microsoft** due to privacy and consent concerns. Derivative cleaned splits (`MS1M-ArcFace`, `MS1MV2`) remain strictly non-commercial research benchmarks.
  - **CASIA-WebFace:** Released for non-commercial academic research only.

### 2.4 Commercial Deployment Assessment
- **Status:** **Unclear / High Compliance Sensitivity — Requires Legal Sign-Off.**
- **Reasoning:** Even though `opencv/opencv_zoo` ships `face_recognition_sface_2021dec.onnx` under **Apache-2.0** (which on paper allows commercial use), the weights were trained on web-scraped celebrity/public face datasets (`MS1M` / `CASIA-WebFace`) without data-subject consent. Commercial use of models trained on retracted or non-commercial biometric datasets carries both dataset-license risk and regulatory/privacy scrutiny (e.g., GDPR, India DPDP Act, BIPA) depending on jurisdiction and enterprise customer legal standards.

### 2.5 Written Clarification from Upstream Maintainers
- **Verified Public Record:** Discussions in `opencv/opencv_zoo` (including Issues `#318` / `#320`) document user requests for commercial clarity around SFace and its upstream datasets.
- **Gap:** OpenCV Zoo maintainers apply Apache-2.0 to the contributed repository directory, but **have not provided** a clean-room dataset provenance warranty or legal indemnification covering the upstream MS1M/WebFace training imagery.

### 2.6 Format, Compatibility with `biometric-service/`, and Conversion Requirements
- **Format:** Standard **ONNX** (`face_recognition_sface_2021dec.onnx`).
- **Compatibility:** **Directly compatible** with `biometric-service/`:
  - Loaded directly by `model_manager.py` via `onnxruntime.InferenceSession(..., providers=["CPUExecutionProvider"])`.
  - Also supported natively via `cv2.FaceRecognizerSF.create(...)` in `opencv-python-headless==4.10.0.84`.
- **Conversion Requirements:** **None.**
- **Preprocessing Requirement:** Requires `112x112` aligned face crop produced from 5-point landmarks (e.g., from YuNet) before embedding extraction (outputs 128-D embedding for cosine similarity matching).
- **Performance Note (Unmeasured):** At ~38 MB ONNX, SFace is noticeably heavier than a ~4 MB MobileFaceNet checkpoint; actual CPU latency on target container hardware is **unmeasured** and must be benchmarked against the `< 300 ms` stage budget.

### 2.7 Security, Accuracy, and Anti-Spoofing Limitations
- **Accuracy Limitations:** Sensitive to alignment errors, extreme pose, occlusions (masks/sunglasses), low resolution, and severe lighting/ISP differences between laptop webcams and Android cameras. Cosine threshold calibration must be validated on representative employee captures to balance FAR and FRR.
- **Security / Anti-Spoofing Limitations:** SFace is a **passive identity matcher only**. It cannot distinguish a live employee from a high-resolution photo or video replay; a replay of an authorized employee's face will match with high cosine similarity unless blocked by PAD + challenge replay protection.

---

## 3. MiniFASNet V2 and V1SE — MiniVision (`Silent-Face-Anti-Spoofing`)

### 3.1 Exact Upstream Repository and Model Files
- **Upstream Repository:** `https://github.com/minivision-ai/Silent-Face-Anti-Spoofing`
- **Model Directory:** `resources/anti_spoof_models/`
- **Exact Model Files:**
  - `2.7_80x80_MiniFASNetV2.pth` (MiniFASNetV2, ~0.435M params, ~1.8 MB, `2.7x` context scale, `80x80` input)
  - `4_0_0_80x80_MiniFASNetV1SE.pth` (MiniFASNetV1SE, ~0.41–0.44M params, ~1.8 MB, `1.0x`/`4.0x` scale, `80x80` input)

### 3.2 Code License and Model-Weight License
- **Code License (Verified):** **Apache License 2.0** (`LICENSE` at repository root).
- **Model-Weight License (Verified Fact + Gap):** The `.pth` files sit inside the Apache-2.0 repository under `resources/anti_spoof_models/`, with **no separate model-weight license file or dataset attribution card** explaining the provenance or licensing of the weights independently of the code.

### 3.3 Training Dataset Provenance and Dataset License
- **Training Dataset Provenance (Gap — Undocumented):** The `Silent-Face-Anti-Spoofing` repository provides model definitions (`MiniFASNet.py`), training/Fourier-auxiliary scripts, and pre-trained `.pth` checkpoints, **but does not document** which exact datasets were used to train `2.7_80x80_MiniFASNetV2.pth` and `4_0_0_80x80_MiniFASNetV1SE.pth`, nor whether subject consent was obtained.
- **Public Anti-Spoofing Dataset Context:** In academic/practitioner workflows around MiniFASNet, models are commonly trained or benchmarked on **OULU-NPU**, **CASIA-FASD**, **CASIA-SURF**, or **CelebA-Spoof**. All of those public academic PAD benchmarks restrict use to **non-commercial research only**. Whether MiniVision used internal proprietary data, public academic datasets, or a mix for the published `.pth` files is **unknown**.

### 3.4 Commercial Deployment Assessment
- **Status:** **Unclear — High Provenance Gap (Requires Legal Acceptance or Retraining).**
- **Reasoning:** Apache-2.0 explicitly permits commercial use of the **codebase** (`MiniFASNet` architecture and training pipeline). However, because the training dataset provenance of the pre-trained `.pth` weights is **undocumented**, a compliance/legal team cannot verify that the `.pth` weights are free from non-commercial dataset restrictions or biometric consent issues. For strict zero-risk commercial provenance, the safest path is training `MiniFASNet` from scratch using the Apache-2.0 code on a commercially licensed or internally consented dataset.

### 3.5 Written Clarification from Upstream Maintainers
- **Verified Public Record:** None found in the repository documentation (`README.md` / `LICENSE`) clarifying the exact training dataset provenance or commercial warranty for the bundled `.pth` checkpoints.

### 3.6 Format, Compatibility with `biometric-service/`, and Conversion Requirements
- **Format:** PyTorch `state_dict` checkpoint files (`.pth`).
- **Compatibility:** **NOT directly compatible with `biometric-service/` as-is:**
  - `biometric-service/app/services/model_manager.py` (lines 162–165) loads `.pt`/`.pth` files exclusively via `torch.jit.load(str(model_path), map_location="cpu")`.
  - Standard `state_dict` `.pth` files from `Silent-Face-Anti-Spoofing` are **not TorchScript archives** and will fail `torch.jit.load(...)`.
- **Conversion Requirements:**
  1. **Recommended:** Export both `MiniFASNetV2` and `MiniFASNetV1SE` to **ONNX** (`80x80` RGB/BGR input matching the repo's preprocessing) so all three pipeline stages run uniformly on `onnxruntime` `CPUExecutionProvider`.
  2. **Multi-model PAD wiring:** `ModelManager` currently tracks a single `PAD_MODEL_PATH` (`face_liveness`). To run the standard dual-scale ensemble (`V2` at `2.7x` crop + `V1SE` at tighter/wider crop), either support two PAD ONNX paths/configs or package a fused/combined PAD session.
  3. **Preprocessing:** Requires `CropImage` logic matching `Silent-Face-Anti-Spoofing` (scaling the detector bounding box by `2.7` / `4.0` while preserving aspect ratio and padding/clamping to `80x80`) and 3-class softmax output (`[spoof_or_bg, live, spoof]` — exact class index mapping from `test.py` must be preserved during export).

### 3.7 Security, Accuracy, and Anti-Spoofing Limitations
- **Passive Single-Frame Limitation:** MiniFASNet evaluates spatial texture and implicit frequency-domain cues from a **single RGB frame**. It does **not** perform active challenge-response liveness (blink, head-pose, expression) or 3D depth/IR sensing.
- **Bypass / Attack Risks:**
  - Vulnerable to **high-DPI OLED / Retina screen replay** held at optimal distance and lighting where moiré/pixel-grid artifacts are minimal.
  - Vulnerable to **high-quality 3D silicone/resin masks** or well-lit ultra-high-res matte prints.
  - **Domain shift:** Webcam compression, low-light denoising, beauty filters, or ISP differences between Android front cameras and laptop webcams can cause elevated false rejections (BPCER) or false acceptances (APCER).
- **Certification:** Holds **no** independent **ISO/IEC 30107-3 (PAD Level 1 or Level 2)** certification. Any repository accuracy claims apply only to academic test splits, not real-world HRMS environments.

---

## Facts vs. Assumptions vs. Unresolved Questions

### Verified Facts
- `biometric-service/requirements.txt` includes `onnxruntime==1.20.1`, `opencv-python-headless==4.10.0.84`, and CPU `torch==2.5.1`.
- `biometric-service/app/services/model_manager.py` loads `.onnx` via `onnxruntime.InferenceSession` and `.pt`/`.pth` only via `torch.jit.load`.
- `opencv/opencv_zoo` licenses `face_detection_yunet` under **MIT** and `face_recognition_sface` under **Apache-2.0**.
- `minivision-ai/Silent-Face-Anti-Spoofing` licenses its repository under **Apache-2.0**, and its pre-trained weights are raw PyTorch `.pth` files (`2.7_80x80_MiniFASNetV2.pth`, `4_0_0_80x80_MiniFASNetV1SE.pth`).
- YuNet was trained/evaluated on WIDER FACE; SFace upstream research relies on MS1M / CASIA-WebFace; MiniFASNet's bundled `.pth` training dataset is undocumented in the repo.

### Engineering Assumptions / Inferences
- Exporting MiniFASNetV2 and MiniFASNetV1SE to ONNX is straightforward because both architectures use standard CNN + SE blocks (`torch.onnx.export`).
- Running YuNet + MiniFASNet (2x) + SFace on CPU via ONNX Runtime can likely fit within a `< 1 s` total request budget on modern multi-vCPU containers, **but actual CPU latency on target hardware is unmeasured**.

### Unresolved Questions (Action Items Before Commercial GA)
1. **Legal Clearance on OpenCV Zoo Weights:** Does legal counsel approve commercial server-side inference using `face_detection_yunet_2023mar.onnx` (MIT) and `face_recognition_sface_2021dec.onnx` (Apache-2.0) despite upstream academic training data (WIDER FACE, MS1M/CASIA-WebFace)?
2. **Legal Clearance or Retraining for MiniFASNet Weights:** Will legal/compliance accept the undocumented dataset provenance of MiniVision's `.pth` files under Apache-2.0, or must MiniFASNet be retrained from scratch on a commercially cleared/consented PAD dataset?
3. **Target CPU Benchmarking:** What is the p95 latency and RAM footprint of `YuNet + MiniFASNetV2/V1SE (ONNX) + SFace` on the actual production CPU container under concurrent punch-in load?
4. **Biometric Privacy Governance:** Are employee consent, retention limits, template revocation, and regional biometric laws (e.g., GDPR Art. 9, India DPDP Act, BIPA) signed off alongside technical deployment?
