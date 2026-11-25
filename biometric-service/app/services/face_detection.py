"""Face detection service boundary using the YuNet adapter."""

from __future__ import annotations

import asyncio

from app.core.config import Settings, get_settings
from app.services.face_detector_yunet import DetectedFace, YuNetDetectorAdapter, validate_single_face
from app.services.image_preprocessing import decode_bgr_image
from app.services.model_manager import ModelManager, ModelUnavailableError


async def detect_single_face(
    image_bytes: bytes,
    manager: ModelManager,
    settings: Settings | None = None,
) -> DetectedFace:
    """Decode image, run YuNet face detection, and enforce single-face + size constraints."""
    if not image_bytes:
        raise ValueError("Empty image payload.")

    manager.ensure_detection_ready()
    session = manager.get_session("face_detection")
    if session is None:
        raise ModelUnavailableError(
            "Face detection model session is not initialized.",
            code="FACE_DETECTION_UNAVAILABLE",
            model_name="face_detection",
        )

    cfg = settings or get_settings()

    def _run() -> DetectedFace:
        bgr = decode_bgr_image(image_bytes, cfg)
        adapter = session if hasattr(session, "detect") and not hasattr(session, "setInputSize") else YuNetDetectorAdapter(session)
        result = adapter.detect(bgr)
        return validate_single_face(result, min_face_size_px=cfg.min_face_size_px)

    return await asyncio.to_thread(_run)
