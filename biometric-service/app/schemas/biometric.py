"""Strict input and output schemas for biometric endpoints."""

from __future__ import annotations

import base64
import binascii
import io
import re
from typing import Any

from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import get_settings

_DATA_URL_PREFIX_RE = re.compile(r"^data:image/(jpeg|jpg|png|webp);base64,(.+)$", re.IGNORECASE | re.DOTALL)
_ANY_DATA_URL_RE = re.compile(r"^data:", re.IGNORECASE)


def decode_and_validate_image(image_base64: str) -> tuple[bytes, int, int]:
    """Decode and validate a base64 or image data-URL payload.

    Returns (raw_bytes, width, height). Raises ValueError on invalid input.
    """
    settings = get_settings()
    if not isinstance(image_base64, str) or not image_base64.strip():
        raise ValueError("image_base64 must be a non-empty string.")

    raw_b64 = image_base64.strip()
    match = _DATA_URL_PREFIX_RE.match(raw_b64)
    if match:
        raw_b64 = match.group(2).strip()
    elif _ANY_DATA_URL_RE.match(raw_b64):
        raise ValueError("Unsupported image data-URL type. Allowed: JPEG, PNG, WebP.")

    if len(raw_b64) > settings.max_image_base64_chars:
        raise ValueError("Image payload exceeds maximum allowed base64 length.")

    try:
        image_bytes = base64.b64decode(raw_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 image encoding.") from exc

    if not image_bytes or len(image_bytes) > settings.max_image_bytes:
        raise ValueError("Decoded image payload is empty or exceeds maximum byte limit.")

    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            img.verify()
        with Image.open(io.BytesIO(image_bytes)) as img:
            width, height = img.size
            fmt = (img.format or "").upper()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError("Payload is not a valid JPEG, PNG, or WebP image.") from exc

    if fmt not in {"JPEG", "JPG", "PNG", "WEBP"}:
        raise ValueError("Unsupported image format. Allowed: JPEG, PNG, WebP.")

    if width <= 0 or height <= 0:
        raise ValueError("Invalid image dimensions.")
    if width > settings.max_image_edge_px or height > settings.max_image_edge_px:
        raise ValueError(
            f"Image dimensions exceed maximum allowed edge ({settings.max_image_edge_px}px)."
        )

    return image_bytes, width, height


class BiometricEnrollRequest(BaseModel):
    """Request schema for biometric enrollment inference."""

    model_config = ConfigDict(extra="forbid")

    image_base64: str = Field(..., min_length=8, description="Base64 or data-URL JPEG/PNG/WebP image.")
    require_liveness: bool = Field(default=True)

    @field_validator("image_base64")
    @classmethod
    def validate_image(cls, v: str) -> str:
        decode_and_validate_image(v)
        return v


class BiometricVerifyRequest(BaseModel):
    """Request schema for biometric verification inference."""

    model_config = ConfigDict(extra="forbid")

    image_base64: str = Field(..., min_length=8, description="Base64 or data-URL JPEG/PNG/WebP probe image.")
    enrolled_embedding: list[float] | None = Field(
        default=None,
        min_length=64,
        max_length=2048,
        description="Decrypted reference embedding vector supplied by Node.js backend.",
    )
    match_threshold: float = Field(default=0.55, ge=0.1, le=2.0)
    require_liveness: bool = Field(default=True)

    @field_validator("image_base64")
    @classmethod
    def validate_image(cls, v: str) -> str:
        decode_and_validate_image(v)
        return v


class BiometricLivenessRequest(BaseModel):
    """Request schema for standalone face detection + PAD liveness check."""

    model_config = ConfigDict(extra="forbid")

    image_base64: str = Field(..., min_length=8, description="Base64 or data-URL JPEG/PNG/WebP image.")

    @field_validator("image_base64")
    @classmethod
    def validate_image(cls, v: str) -> str:
        decode_and_validate_image(v)
        return v


class LivenessCheckResponse(BaseModel):
    """Sanitized response for face detection + PAD liveness check."""

    face_detected: bool
    face_count: int
    liveness_passed: bool
    liveness_score: float
    calibrated: bool
    message: str


class HealthResponse(BaseModel):
    """Liveness probe response."""

    status: str
    service: str
    version: str


class ReadinessChecks(BaseModel):
    """Detailed readiness breakdown."""

    app_initialized: bool
    config_valid: bool
    detection_model_loaded: bool = False
    recognition_model_loaded: bool = False
    biometric_models_loaded: bool
    pad_model_loaded: bool
    liveness_ready: bool = False
    recognition_ready: bool = False


class ReadinessResponse(BaseModel):
    """Readiness probe response."""

    ready: bool
    checks: ReadinessChecks
    models: dict[str, dict[str, Any]]
    config_errors: list[str] = Field(default_factory=list)
