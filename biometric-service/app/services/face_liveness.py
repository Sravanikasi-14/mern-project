"""Presentation Attack Detection (PAD) service boundary using MiniFASNet ONNX models."""

from __future__ import annotations

import asyncio

from app.core.config import Settings, get_settings
from app.services.image_preprocessing import decode_bgr_image
from app.services.model_manager import ModelManager, ModelUnavailableError
from app.services.pad_minifasnet import MiniFASNetOnnxAdapter, PADResult


async def evaluate_presentation_attack(
    image_bytes: bytes,
    manager: ModelManager,
    bbox_xywh: tuple[float, float, float, float],
    settings: Settings | None = None,
) -> PADResult:
    """Evaluate genuine PAD liveness on a detected face box. Fails closed if PAD is unavailable."""
    if not image_bytes:
        raise ValueError("Empty image payload.")

    manager.ensure_pad_ready()
    sessions = manager.get_pad_sessions()
    if not sessions:
        raise ModelUnavailableError(
            "PAD model sessions are not initialized.",
            code="PAD_MODEL_UNAVAILABLE",
            model_name="face_liveness",
        )

    cfg = settings or get_settings()

    def _run() -> PADResult:
        bgr = decode_bgr_image(image_bytes, cfg)
        adapter = MiniFASNetOnnxAdapter(sessions, cfg)
        return adapter.evaluate(bgr, bbox_xywh)

    return await asyncio.to_thread(_run)
