"""Face embedding and matching service boundary (Phase 1 placeholder)."""

from __future__ import annotations

from typing import Any

from app.services.model_manager import ModelManager, ModelUnavailableError


async def extract_face_embedding(image_bytes: bytes, manager: ModelManager) -> dict[str, Any]:
    """Extract biometric embedding. Fails closed until recognition models are loaded."""
    if not image_bytes:
        raise ValueError("Empty image payload.")
    manager.ensure_biometric_ready()
    raise ModelUnavailableError(
        "Face recognition inference is not implemented in Phase 1.",
        code="FACE_RECOGNITION_NOT_IMPLEMENTED",
        model_name="face_recognition",
    )
