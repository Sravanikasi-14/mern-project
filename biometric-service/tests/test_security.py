"""Tests for internal service authentication, request size limits, and log redaction."""

from __future__ import annotations

import logging

from fastapi.testclient import TestClient

from app.core.config import clear_settings_cache
from app.core.logging import BiometricRedactingFilter, sanitize_log_value
from app.core.security import INTERNAL_AUTH_HEADER, constant_time_secret_matches
from app.main import create_app
from app.services.model_manager import model_manager

VALID_SECRET = "test-internal-secret-32-characters!!"


def test_constant_time_secret_matches() -> None:
    assert constant_time_secret_matches(VALID_SECRET, VALID_SECRET) is True
    assert constant_time_secret_matches("wrong", VALID_SECRET) is False
    assert constant_time_secret_matches("", VALID_SECRET) is False


def test_protected_endpoint_rejects_missing_auth(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", VALID_SECRET)
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        resp = client.get("/api/v1/biometric/health")
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "INTERNAL_AUTH_MISSING"


def test_protected_endpoint_rejects_invalid_auth(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", VALID_SECRET)
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        resp = client.get(
            "/api/v1/biometric/health",
            headers={INTERNAL_AUTH_HEADER: "invalid-secret-value"},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "INTERNAL_AUTH_INVALID"


def test_protected_endpoint_fails_closed_when_server_secret_unset(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", "")
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        resp = client.get(
            "/api/v1/biometric/health",
            headers={INTERNAL_AUTH_HEADER: VALID_SECRET},
        )
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "SERVICE_AUTH_NOT_CONFIGURED"


def test_protected_endpoint_accepts_valid_auth(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", VALID_SECRET)
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        resp = client.get(
            "/api/v1/biometric/health",
            headers={INTERNAL_AUTH_HEADER: VALID_SECRET},
        )
        # Models are absent, so authenticated call reaches biometric health and reports 503 unavailable
        assert resp.status_code == 503
        assert resp.json()["status"] == "unavailable"


def test_request_size_limit_rejects_oversized_payload(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", VALID_SECRET)
    monkeypatch.setenv("MAX_REQUEST_BYTES", "1024")
    monkeypatch.setenv("MAX_IMAGE_BASE64_CHARS", "1024")
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        oversized = "A" * 2048
        resp = client.post(
            "/api/v1/biometric/enroll",
            headers={INTERNAL_AUTH_HEADER: VALID_SECRET},
            json={"image_base64": oversized},
        )
        assert resp.status_code == 413
        assert resp.json()["code"] == "PAYLOAD_TOO_LARGE"


def test_logging_redacts_images_embeddings_and_secrets() -> None:
    payload = {
        "image_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
        "embedding": [0.1, 0.2, 0.3],
        "secret": "super-secret-token",
        "safe_field": "ok",
    }
    sanitized = sanitize_log_value(payload)
    assert sanitized["image_base64"] == "[REDACTED]"
    assert sanitized["embedding"] == "[REDACTED]"
    assert sanitized["secret"] == "[REDACTED]"
    assert sanitized["safe_field"] == "ok"

    flt = BiometricRedactingFilter()
    record = logging.LogRecord(
        name="biometric_service",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="Received payload data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        args=(),
        exc_info=None,
    )
    assert flt.filter(record) is True
    assert "iVBORw0KGgo" not in record.msg
    assert "data:image/[REDACTED]" in record.msg
