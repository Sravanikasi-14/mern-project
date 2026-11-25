# HRMS Biometric Service (Phase 2: OpenCV + YuNet + MiniFASNet PAD)

Independent Python 3.11 + FastAPI biometric inference service for the HRMS MERN platform.

## Architecture Boundary

- **Node.js Backend (`server/`)** owns authentication, employee identity, tenant isolation, consent, single-use challenges, encrypted embedding storage, and attendance workflows.
- **Python Biometric Service (`biometric-service/`)** is an internal-only inference service called exclusively by the Node.js backend using `X-Biometric-Service-Secret`.

## Phase 2 Scope

- **OpenCV Preprocessing (`app/services/image_preprocessing.py`)**: BGR decoding, dimension/blur checks, 5-point similarity alignment (`112x112`), and aspect-preserving MiniFASNet `CropImage` patches (`80x80`).
- **Face Detection (`app/services/face_detector_yunet.py`)**: Model-independent `FaceDetector` interface with `YuNetDetectorAdapter` (`cv2.FaceDetectorYN`), enforcing single-face and minimum face-size rules.
- **Presentation Attack Detection (`app/services/pad_minifasnet.py`)**: Model-independent `PADEngine` interface with `MiniFASNetOnnxAdapter` supporting V2 (`2.7x`) and V1SE (`4.0x`) via CPU ONNX Runtime.
- **Protected Liveness Endpoint (`POST /api/v1/biometric/liveness`)**: Executes YuNet + MiniFASNet PAD and fails closed (`503`) whenever mandatory models are missing or corrupt.
- **Face Recognition Deferred**: `/enroll` and `/verify` continue to fail closed (`503`) until a face recognition model is selected and integrated.
- **No model weights are bundled or downloaded automatically.**

## MiniFASNet ONNX Conversion

MiniFASNet `.pth` checkpoints from `Silent-Face-Anti-Spoofing` are raw PyTorch `state_dict` files (not TorchScript archives) and **cannot** be loaded via `torch.jit.load`. Convert local checkpoints to `.onnx` before configuring `PAD_V2_MODEL_PATH` / `PAD_V1SE_MODEL_PATH`:

```bash
python scripts/export_minifasnet_onnx.py \
  --arch v2 \
  --checkpoint weights/2.7_80x80_MiniFASNetV2.pth \
  --output weights/minifasnet_v2.onnx \
  --model-def-dir /path/to/Silent-Face-Anti-Spoofing
```

## Running Locally

```bash
cd biometric-service
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export BIOMETRIC_INTERNAL_SECRET="replace-with-32-plus-char-random-secret"
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Running Tests

```bash
pytest -v
```
