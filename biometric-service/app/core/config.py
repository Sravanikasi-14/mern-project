"""Application configuration and validation."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

MIN_INTERNAL_SECRET_LENGTH = 32


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables (never hardcoded secrets)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = Field(default="hrms-biometric-service")
    app_version: str = Field(default="0.1.0")
    app_env: str = Field(default="development")
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000, ge=1, le=65535)
    log_level: str = Field(default="INFO")

    # Dedicated internal service-to-service secret. Must never be hardcoded.
    biometric_internal_secret: str = Field(default="")

    # Request and image payload bounds
    max_request_bytes: int = Field(default=10_485_760, ge=1024, le=52_428_800)
    max_image_base64_chars: int = Field(default=8_000_000, ge=1024, le=40_000_000)
    max_image_bytes: int = Field(default=6_000_000, ge=1024, le=30_000_000)
    max_image_edge_px: int = Field(default=4096, ge=256, le=8192)

    # Model paths (env-configurable; leave unset when weights are not provisioned)
    weights_dir: Path = Field(default=Path("./weights"))
    face_detection_model_path: str = Field(default="")
    face_recognition_model_path: str = Field(default="")
    pad_model_path: str = Field(default="")
    pad_v2_model_path: str = Field(default="")
    pad_v1se_model_path: str = Field(default="")

    # Detection (YuNet) & preprocessing thresholds
    yunet_score_threshold: float = Field(default=0.7, ge=0.1, le=1.0)
    yunet_nms_threshold: float = Field(default=0.3, ge=0.05, le=1.0)
    yunet_top_k: int = Field(default=5, ge=1, le=100)
    min_face_size_px: int = Field(default=60, ge=20, le=1000)
    min_blur_laplacian_var: float = Field(default=0.0, ge=0.0, le=10000.0)

    # Presentation Attack Detection (MiniFASNet V2 / V1SE) settings
    # Note: Thresholds and weights are uncalibrated defaults until validated on real data.
    pad_mandatory: bool = Field(default=True)
    pad_require_dual_model: bool = Field(default=False)
    pad_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    pad_v2_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    pad_v1se_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    pad_v2_weight: float = Field(default=0.5, ge=0.0, le=10.0)
    pad_v1se_weight: float = Field(default=0.5, ge=0.0, le=10.0)
    pad_v2_scale: float = Field(default=2.7, ge=1.0, le=8.0)
    pad_v1se_scale: float = Field(default=4.0, ge=1.0, le=8.0)
    pad_input_size: int = Field(default=80, ge=32, le=256)
    pad_live_class_index: int = Field(default=1, ge=0, le=10)
    pad_normalize_01: bool = Field(default=False)
    pad_color_order: str = Field(default="BGR")

    # CPU ONNX Runtime threading limits
    onnx_intra_op_threads: int = Field(default=2, ge=1, le=32)
    onnx_inter_op_threads: int = Field(default=1, ge=1, le=16)

    def is_internal_secret_configured(self) -> bool:
        """Return True only if BIOMETRIC_INTERNAL_SECRET meets minimum length."""
        secret = (self.biometric_internal_secret or "").strip()
        return len(secret) >= MIN_INTERNAL_SECRET_LENGTH

    def validate_required_config(self) -> tuple[bool, list[str]]:
        """Validate required service configuration without exposing secret values."""
        errors: list[str] = []
        if not self.is_internal_secret_configured():
            errors.append(
                f"BIOMETRIC_INTERNAL_SECRET must be configured with at least {MIN_INTERNAL_SECRET_LENGTH} characters."
            )
        if self.max_request_bytes < self.max_image_base64_chars:
            errors.append("MAX_REQUEST_BYTES must be >= MAX_IMAGE_BASE64_CHARS.")
        return (len(errors) == 0, errors)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings instance."""
    return Settings()


def clear_settings_cache() -> None:
    """Clear settings cache (useful in tests when env vars change)."""
    get_settings.cache_clear()


def runtime_env_summary() -> dict[str, str]:
    """Non-sensitive configuration summary for diagnostics."""
    settings = get_settings()
    return {
        "app_name": settings.app_name,
        "app_env": settings.app_env,
        "weights_dir": str(settings.weights_dir),
        "internal_secret_configured": str(settings.is_internal_secret_configured()).lower(),
        "pid": str(os.getpid()),
    }
