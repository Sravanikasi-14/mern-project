"""Tests for /health, /ready, and ModelManager readiness behavior."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings, clear_settings_cache
from app.main import create_app
from app.services.model_manager import ModelManager, ModelStatus, model_manager


def test_health_endpoint_returns_ok(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", "test-internal-secret-32-characters!!")
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["service"] == "hrms-biometric-service"


def test_ready_reports_unavailable_when_models_absent(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", "test-internal-secret-32-characters!!")
    monkeypatch.delenv("FACE_DETECTION_MODEL_PATH", raising=False)
    monkeypatch.delenv("FACE_RECOGNITION_MODEL_PATH", raising=False)
    monkeypatch.delenv("PAD_MODEL_PATH", raising=False)
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        resp = client.get("/ready")
        assert resp.status_code == 503
        body = resp.json()
        assert body["ready"] is False
        assert body["checks"]["app_initialized"] is True
        assert body["checks"]["config_valid"] is True
        assert body["checks"]["liveness_ready"] is False
        assert body["checks"]["recognition_ready"] is False
        assert body["checks"]["detection_model_loaded"] is False
        assert body["checks"]["recognition_model_loaded"] is False
        assert body["checks"]["biometric_models_loaded"] is False
        assert body["checks"]["pad_model_loaded"] is False
        assert body["models"]["face_detection"]["configured"] is False
        assert body["models"]["face_recognition"]["configured"] is False
        assert body["models"]["face_liveness"]["configured"] is False


def test_ready_reports_invalid_config_when_secret_missing(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", "")
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        resp = client.get("/ready")
        assert resp.status_code == 503
        body = resp.json()
        assert body["ready"] is False
        assert body["checks"]["config_valid"] is False
        assert len(body["config_errors"]) >= 1


def test_ready_returns_200_when_mocked_models_ready(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", "test-internal-secret-32-characters!!")
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        model_manager._models["face_detection"] = ModelStatus(
            name="face_detection", configured=True, loaded=True, ready=True, path="mock"
        )
        model_manager._models["face_recognition"] = ModelStatus(
            name="face_recognition", configured=True, loaded=True, ready=True, path="mock"
        )
        model_manager._models["face_liveness"] = ModelStatus(
            name="face_liveness", configured=True, loaded=True, ready=True, path="mock"
        )

        resp = client.get("/ready")
        assert resp.status_code == 200
        body = resp.json()
        assert body["ready"] is True
        assert body["checks"]["liveness_ready"] is True
        assert body["checks"]["recognition_ready"] is True
        assert body["checks"]["biometric_models_loaded"] is True
        assert body["checks"]["pad_model_loaded"] is True

    model_manager.reset_for_tests()


def test_ready_returns_200_when_detection_and_pad_loaded_without_recognition(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", "test-internal-secret-32-characters!!")
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        model_manager._models["face_detection"] = ModelStatus(
            name="face_detection", configured=True, loaded=True, ready=True, path="mock"
        )
        model_manager._models["face_liveness"] = ModelStatus(
            name="face_liveness", configured=True, loaded=True, ready=True, path="mock"
        )
        model_manager._models["face_recognition"] = ModelStatus(
            name="face_recognition", configured=False, loaded=False, ready=False, path=None
        )

        resp = client.get("/ready")
        assert resp.status_code == 200
        body = resp.json()
        assert body["ready"] is True
        assert body["checks"]["liveness_ready"] is True
        assert body["checks"]["recognition_ready"] is False
        assert body["checks"]["detection_model_loaded"] is True
        assert body["checks"]["pad_model_loaded"] is True
        assert body["checks"]["recognition_model_loaded"] is False
        assert body["checks"]["biometric_models_loaded"] is False

    model_manager.reset_for_tests()


def test_model_manager_handles_missing_and_corrupt_files(tmp_path: Path) -> None:
    missing_path = tmp_path / "missing.onnx"
    corrupt_path = tmp_path / "corrupt.onnx"
    corrupt_path.write_bytes(b"not-a-valid-onnx-model")

    mgr = ModelManager()
    cfg = Settings(
        biometric_internal_secret="test-internal-secret-32-characters!!",
        face_detection_model_path=str(missing_path),
        face_recognition_model_path=str(corrupt_path),
        pad_model_path="",
    )

    asyncio.run(mgr.initialize(cfg))
    assert mgr.app_initialized is True
    assert mgr.get_model_status("face_detection").configured is True
    assert mgr.get_model_status("face_detection").ready is False
    assert "does not exist" in (mgr.get_model_status("face_detection").error or "")

    assert mgr.get_model_status("face_recognition").configured is True
    assert mgr.get_model_status("face_recognition").ready is False
    assert "Corrupt" in (mgr.get_model_status("face_recognition").error or "")


def test_model_manager_prevents_concurrent_duplicate_init(tmp_path: Path) -> None:
    mgr = ModelManager()
    calls = 0

    orig_load = mgr._load_single_model

    def counting_load(name: str, raw_path: str) -> None:
        nonlocal calls
        calls += 1
        orig_load(name, raw_path)

    mgr._load_single_model = counting_load  # type: ignore[method-assign]
    cfg = Settings(biometric_internal_secret="test-internal-secret-32-characters!!")

    async def run_concurrent() -> None:
        await asyncio.gather(
            mgr.initialize(cfg),
            mgr.initialize(cfg),
            mgr.initialize(cfg),
        )

    asyncio.run(run_concurrent())
    # 3 models loaded once total across all 3 concurrent initialize() calls
    assert calls == 3
