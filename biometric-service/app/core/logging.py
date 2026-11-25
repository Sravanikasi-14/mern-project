"""Privacy-preserving logging configuration.

Ensures raw biometric images, embeddings, secrets, and personal identifiers
are never emitted to application logs.
"""

from __future__ import annotations

import logging
import re
from typing import Any

SENSITIVE_KEYS = frozenset(
    {
        "image",
        "image_base64",
        "faceimage",
        "faceimagebase64",
        "embedding",
        "enrolled_embedding",
        "probe_embedding",
        "secret",
        "biometric_internal_secret",
        "x-biometric-service-secret",
        "authorization",
        "token",
        "password",
    }
)

_DATA_URL_RE = re.compile(r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+")


def sanitize_log_value(value: Any) -> Any:
    """Redact sensitive strings or nested mappings before logging."""
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for k, v in value.items():
            if str(k).strip().lower() in SENSITIVE_KEYS:
                sanitized[k] = "[REDACTED]"
            else:
                sanitized[k] = sanitize_log_value(v)
        return sanitized
    if isinstance(value, (list, tuple)):
        return [sanitize_log_value(item) for item in value]
    if isinstance(value, str):
        if "data:image/" in value:
            return _DATA_URL_RE.sub("data:image/[REDACTED]", value)
        if len(value) > 512:
            return f"{value[:64]}...[TRUNCATED len={len(value)}]"
    return value


class BiometricRedactingFilter(logging.Filter):
    """Logging filter that redacts embedded data-URLs or oversized base64 blobs."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str) and "data:image/" in record.msg:
            record.msg = _DATA_URL_RE.sub("data:image/[REDACTED]", record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = sanitize_log_value(record.args)
            elif isinstance(record.args, tuple):
                record.args = tuple(sanitize_log_value(arg) for arg in record.args)
        return True


def configure_logging(level: str = "INFO") -> logging.Logger:
    """Configure root/service logger with redacting filter."""
    numeric_level = getattr(logging, str(level or "INFO").upper(), logging.INFO)
    logger = logging.getLogger("biometric_service")
    logger.setLevel(numeric_level)
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            fmt="%(asctime)s %(levelname)s [%(name)s] %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%SZ",
        )
        handler.setFormatter(formatter)
        handler.addFilter(BiometricRedactingFilter())
        logger.addHandler(handler)
    logger.propagate = False
    return logger
