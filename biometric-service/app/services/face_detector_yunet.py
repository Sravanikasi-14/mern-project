"""Model-independent face detection interface and OpenCV YuNet adapter."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np


class FaceValidationError(ValueError):
    """Raised when face detection succeeds technically but violates single-face/quality rules."""

    def __init__(self, message: str, *, code: str = "FACE_VALIDATION_FAILED"):
        super().__init__(message)
        self.message = message
        self.code = code


class DetectionInferenceError(RuntimeError):
    """Raised when the underlying face detector fails at runtime."""

    def __init__(self, message: str, *, code: str = "FACE_DETECTION_FAILED"):
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass(frozen=True)
class DetectedFace:
    """Normalized single-face detection output."""

    bbox: tuple[float, float, float, float]  # (x, y, w, h)
    confidence: float
    landmarks_5pt: list[tuple[float, float]]


@dataclass(frozen=True)
class FaceDetectionResult:
    """Normalized detector output for an image."""

    faces: list[DetectedFace]
    image_width: int
    image_height: int


class FaceDetector(Protocol):
    """Model-independent face detector interface."""

    def detect(self, bgr_image: np.ndarray) -> FaceDetectionResult:
        """Detect faces and 5-point landmarks in a BGR image."""


class YuNetDetectorAdapter:
    """Adapter around OpenCV cv2.FaceDetectorYN for YuNet ONNX inference."""

    def __init__(self, detector_handle: Any) -> None:
        if detector_handle is None:
            raise ValueError("YuNet detector handle must not be None.")
        self._detector = detector_handle
        # cv2.FaceDetectorYN stores mutable input size state on the handle.
        self._lock = threading.Lock()

    def detect(self, bgr_image: np.ndarray) -> FaceDetectionResult:
        if bgr_image is None or bgr_image.ndim != 3:
            raise DetectionInferenceError("Invalid BGR image passed to YuNet detector.")

        height, width = bgr_image.shape[:2]
        try:
            with self._lock:
                self._detector.setInputSize((width, height))
                _, raw_faces = self._detector.detect(bgr_image)
        except Exception as exc:
            raise DetectionInferenceError(f"YuNet inference failed: {type(exc).__name__}") from exc

        faces: list[DetectedFace] = []
        if raw_faces is not None and len(raw_faces) > 0:
            arr = np.asarray(raw_faces, dtype=np.float32)
            if arr.ndim == 1:
                arr = np.expand_dims(arr, axis=0)
            for row in arr:
                if row.shape[0] < 15:
                    raise DetectionInferenceError("Unexpected YuNet output row shape.")
                bbox = (float(row[0]), float(row[1]), float(row[2]), float(row[3]))
                landmarks = [
                    (float(row[4]), float(row[5])),
                    (float(row[6]), float(row[7])),
                    (float(row[8]), float(row[9])),
                    (float(row[10]), float(row[11])),
                    (float(row[12]), float(row[13])),
                ]
                confidence = float(row[14])
                faces.append(DetectedFace(bbox=bbox, confidence=confidence, landmarks_5pt=landmarks))

        return FaceDetectionResult(faces=faces, image_width=width, image_height=height)


def validate_single_face(result: FaceDetectionResult, *, min_face_size_px: int) -> DetectedFace:
    """Enforce strict single-face presence and minimum face bounding-box size."""
    count = len(result.faces)
    if count == 0:
        raise FaceValidationError("No face detected in image.", code="NO_FACE_DETECTED")
    if count > 1:
        raise FaceValidationError(
            f"Multiple faces detected ({count}); exactly one face is required.",
            code="MULTIPLE_FACES_DETECTED",
        )

    face = result.faces[0]
    _, _, w, h = face.bbox
    if min(w, h) < float(min_face_size_px):
        raise FaceValidationError(
            f"Detected face is too small ({int(min(w, h))}px < {min_face_size_px}px minimum).",
            code="FACE_TOO_SMALL",
        )
    return face
