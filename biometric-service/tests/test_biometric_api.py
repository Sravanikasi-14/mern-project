"""Tests for biometric API validation and fail-closed 503 behavior."""

from __future__ import annotations

import base64
import io

from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import clear_settings_cache
from app.core.security import INTERNAL_AUTH_HEADER
from app.main import create_app
from app.services.model_manager import model_manager

VALID_SECRET = "test-internal-secret-32-characters!!"


def _make_valid_png_data_url() -> str:
    img = Image.new("RGB", (64, 64), color=(120, 140, 160))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def test_biometric_enroll_returns_503_when_models_absent(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", VALID_SECRET)
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        resp = client.post(
            "/api/v1/biometric/enroll",
            headers={INTERNAL_AUTH_HEADER: VALID_SECRET},
            json={"image_base64": _make_valid_png_data_url(), "require_liveness": True},
        )
        assert resp.status_code == 503
        body = resp.json()
        assert body["code"] == "MODEL_UNAVAILABLE"


def test_biometric_verify_returns_503_when_models_absent(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", VALID_SECRET)
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        resp = client.post(
            "/api/v1/biometric/verify",
            headers={INTERNAL_AUTH_HEADER: VALID_SECRET},
            json={
                "image_base64": _make_valid_png_data_url(),
                "enrolled_embedding": [0.01] * 128,
                "match_threshold": 0.55,
                "require_liveness": True,
            },
        )
        assert resp.status_code == 503
        body = resp.json()
        assert body["code"] == "MODEL_UNAVAILABLE"


def test_biometric_rejects_invalid_image_payloads(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", VALID_SECRET)
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        # 1. Not valid base64
        r1 = client.post(
            "/api/v1/biometric/enroll",
            headers={INTERNAL_AUTH_HEADER: VALID_SECRET},
            json={"image_base64": "@@@not-base64@@@"},
        )
        assert r1.status_code == 422
        assert r1.json()["code"] == "VALIDATION_ERROR"

        # 2. Unsupported MIME data-URL
        r2 = client.post(
            "/api/v1/biometric/enroll",
            headers={INTERNAL_AUTH_HEADER: VALID_SECRET},
            json={"image_base64": "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs="},
        )
        assert r2.status_code == 422
        assert r2.json()["code"] == "VALIDATION_ERROR"

        # 3. Valid base64 but not an image
        not_an_image = base64.b64encode(b"hello world not an image").decode("ascii")
        r3 = client.post(
            "/api/v1/biometric/verify",
            headers={INTERNAL_AUTH_HEADER: VALID_SECRET},
            json={"image_base64": not_an_image},
        )
        assert r3.status_code == 422
        assert r3.json()["code"] == "VALIDATION_ERROR"
