"""Unit tests for YuNet face detection adapter and single-face validation."""

from __future__ import annotations

import asyncio

import cv2
import numpy as np
import pytest

from app.core.config import Settings
from app.services.face_detection import detect_single_face
from app.services.face_detector_yunet import (
    DetectionInferenceError,
    FaceValidationError,
    YuNetDetectorAdapter,
    validate_single_face,
)
from app.services.model_manager import ModelManager, ModelStatus, ModelUnavailableError


class _MockYuNetHandle:
    def __init__(self, rows: np.ndarray | None = None, *, raise_exc: bool = False) -> None:
        self._rows = rows
        self._raise_exc = raise_exc
        self.last_input_size: tuple[int, int] | None = None

    def setInputSize(self, size: tuple[int, int]) -> None:
        self.last_input_size = size

    def detect(self, _image: np.ndarray):
        if self._raise_exc:
            raise RuntimeError("mock OpenCV YuNet failure")
        return 1, self._rows


def _make_png_bytes(width: int = 240, height: int = 240) -> bytes:
    img = np.zeros((height, width, 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok is True
    return buf.tobytes()


def _sample_yunet_row(x: float = 50, y: float = 50, w: float = 100, h: float = 120, score: float = 0.98) -> list[float]:
    return [x, y, w, h, 80, 90, 120, 90, 100, 110, 85, 135, 115, 135, score]


def test_yunet_adapter_parses_single_face_and_landmarks() -> None:
    rows = np.array([_sample_yunet_row()], dtype=np.float32)
    handle = _MockYuNetHandle(rows)
    adapter = YuNetDetectorAdapter(handle)

    bgr = np.zeros((240, 240, 3), dtype=np.uint8)
    result = adapter.detect(bgr)
    assert handle.last_input_size == (240, 240)
    assert len(result.faces) == 1
    face = validate_single_face(result, min_face_size_px=60)
    assert face.bbox == (50.0, 50.0, 100.0, 120.0)
    assert len(face.landmarks_5pt) == 5
    assert face.confidence == pytest.approx(0.98)


def test_validate_single_face_rejects_zero_multiple_and_small_faces() -> None:
    bgr = np.zeros((240, 240, 3), dtype=np.uint8)

    # 0 faces
    empty = YuNetDetectorAdapter(_MockYuNetHandle(None)).detect(bgr)
    with pytest.raises(FaceValidationError) as exc0:
        validate_single_face(empty, min_face_size_px=60)
    assert exc0.value.code == "NO_FACE_DETECTED"

    # 2 faces
    two_rows = np.array([_sample_yunet_row(), _sample_yunet_row(x=160)], dtype=np.float32)
    two = YuNetDetectorAdapter(_MockYuNetHandle(two_rows)).detect(bgr)
    with pytest.raises(FaceValidationError) as exc2:
        validate_single_face(two, min_face_size_px=60)
    assert exc2.value.code == "MULTIPLE_FACES_DETECTED"

    # Too small face
    small_row = np.array([_sample_yunet_row(w=30, h=30)], dtype=np.float32)
    small = YuNetDetectorAdapter(_MockYuNetHandle(small_row)).detect(bgr)
    with pytest.raises(FaceValidationError) as exc_small:
        validate_single_face(small, min_face_size_px=60)
    assert exc_small.value.code == "FACE_TOO_SMALL"


def test_yunet_adapter_raises_on_runtime_failure() -> None:
    adapter = YuNetDetectorAdapter(_MockYuNetHandle(raise_exc=True))
    bgr = np.zeros((240, 240, 3), dtype=np.uint8)
    with pytest.raises(DetectionInferenceError):
        adapter.detect(bgr)


def test_detect_single_face_fails_closed_when_model_unavailable() -> None:
    mgr = ModelManager()
    with pytest.raises(ModelUnavailableError) as exc:
        asyncio.run(detect_single_face(_make_png_bytes(), mgr))
    assert exc.value.code == "FACE_DETECTION_UNAVAILABLE"


def test_detect_single_face_succeeds_with_mocked_session() -> None:
    mgr = ModelManager()
    mgr._models["face_detection"] = ModelStatus(
        name="face_detection", configured=True, loaded=True, ready=True, path="mock_yunet.onnx"
    )
    mgr._sessions["face_detection"] = _MockYuNetHandle(np.array([_sample_yunet_row()], dtype=np.float32))
    cfg = Settings(biometric_internal_secret="x" * 32, min_face_size_px=60)

    face = asyncio.run(detect_single_face(_make_png_bytes(), mgr, cfg))
    assert face.bbox == (50.0, 50.0, 100.0, 120.0)
