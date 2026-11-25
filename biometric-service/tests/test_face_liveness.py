"""Unit and API integration tests for MiniFASNet PAD adapter and /api/v1/biometric/liveness."""

from __future__ import annotations

import asyncio
import base64
import io
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings, clear_settings_cache
from app.core.security import INTERNAL_AUTH_HEADER
from app.main import create_app
from app.services.model_manager import ModelManager, ModelStatus, ModelUnavailableError, model_manager
from app.services.pad_minifasnet import MiniFASNetOnnxAdapter, PADInferenceError

VALID_SECRET = "test-internal-secret-32-characters!!"


class _MockInputMeta:
    def __init__(self, name: str = "input") -> None:
        self.name = name


class _MockOnnxSession:
    def __init__(self, logits: list[list[float]] | None = None, *, raise_exc: bool = False) -> None:
        self._logits = logits
        self._raise_exc = raise_exc

    def get_inputs(self):
        return [_MockInputMeta()]

    def run(self, _output_names, feed_dict):
        tensor = feed_dict["input"]
        assert tensor.shape == (1, 3, 80, 80)
        assert tensor.dtype == np.float32
        if self._raise_exc:
            raise RuntimeError("mock ONNX Runtime error")
        return [np.array(self._logits, dtype=np.float32)]


class _MockYuNetHandle:
    def setInputSize(self, _size: tuple[int, int]) -> None:
        pass

    def detect(self, _image: np.ndarray):
        return 1, np.array([[40, 40, 100, 120, 70, 80, 110, 80, 90, 100, 75, 125, 105, 125, 0.99]], dtype=np.float32)


def _make_png_data_url(width: int = 240, height: int = 240) -> str:
    img = Image.new("RGB", (width, height), color=(120, 140, 160))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def test_model_manager_rejects_raw_pth_for_pad_without_torch_jit_assumption(tmp_path: Path) -> None:
    pth_file = tmp_path / "2.7_80x80_MiniFASNetV2.pth"
    pth_file.write_bytes(b"fake-state-dict-bytes")

    mgr = ModelManager()
    cfg = Settings(
        biometric_internal_secret=VALID_SECRET,
        pad_v2_model_path=str(pth_file),
    )
    asyncio.run(mgr.initialize(cfg))
    st = mgr.get_model_status("face_liveness")
    assert st.configured is True
    assert st.ready is False
    assert "state_dict" in (st.error or "")
    assert ".onnx" in (st.error or "")


def test_model_manager_fails_closed_when_dual_pad_required_and_v1se_missing(tmp_path: Path) -> None:
    v2_file = tmp_path / "v2.onnx"
    v2_file.write_bytes(b"dummy")

    mgr = ModelManager()
    cfg = Settings(
        biometric_internal_secret=VALID_SECRET,
        pad_v2_model_path=str(v2_file),
        pad_v1se_model_path="",
        pad_require_dual_model=True,
    )
    asyncio.run(mgr.initialize(cfg))
    st = mgr.get_model_status("face_liveness")
    assert st.ready is False
    assert "PAD_REQUIRE_DUAL_MODEL" in (st.error or "")


def test_minifasnet_adapter_live_and_spoof_with_separate_variant_scores() -> None:
    cfg = Settings(biometric_internal_secret=VALID_SECRET, pad_threshold=0.5, pad_live_class_index=1)
    bgr = np.zeros((240, 240, 3), dtype=np.uint8)
    bbox = (40.0, 40.0, 100.0, 120.0)

    # High live logits at index 1
    live_adapter = MiniFASNetOnnxAdapter(
        {
            "v2": _MockOnnxSession([[-2.0, 4.0, -2.0]]),
            "v1se": _MockOnnxSession([[-1.5, 3.5, -1.5]]),
        },
        cfg,
    )
    res_live = live_adapter.evaluate(bgr, bbox)
    assert res_live.liveness_passed is True
    assert res_live.calibrated is False
    assert res_live.liveness_score > 0.9
    assert "v2" in res_live.variant_scores and "v1se" in res_live.variant_scores

    # High spoof logits at index 2
    spoof_adapter = MiniFASNetOnnxAdapter(
        {
            "v2": _MockOnnxSession([[-2.0, -2.0, 4.0]]),
            "v1se": _MockOnnxSession([[-2.0, -2.0, 4.0]]),
        },
        cfg,
    )
    res_spoof = spoof_adapter.evaluate(bgr, bbox)
    assert res_spoof.liveness_passed is False
    assert res_spoof.calibrated is False
    assert res_spoof.liveness_score < 0.1


def test_minifasnet_adapter_fails_closed_on_runtime_error_and_nan() -> None:
    cfg = Settings(biometric_internal_secret=VALID_SECRET)
    bgr = np.zeros((240, 240, 3), dtype=np.uint8)
    bbox = (40.0, 40.0, 100.0, 120.0)

    err_adapter = MiniFASNetOnnxAdapter({"v2": _MockOnnxSession(raise_exc=True)}, cfg)
    with pytest.raises(PADInferenceError):
        err_adapter.evaluate(bgr, bbox)

    nan_adapter = MiniFASNetOnnxAdapter({"v2": _MockOnnxSession([[0.0, float("nan"), 0.0]])}, cfg)
    with pytest.raises(PADInferenceError):
        nan_adapter.evaluate(bgr, bbox)


def test_liveness_endpoint_fails_closed_when_models_unavailable(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", VALID_SECRET)
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        resp = client.post(
            "/api/v1/biometric/liveness",
            headers={INTERNAL_AUTH_HEADER: VALID_SECRET},
            json={"image_base64": _make_png_data_url()},
        )
        assert resp.status_code == 503
        assert resp.json()["code"] == "FACE_DETECTION_UNAVAILABLE"


def test_liveness_endpoint_succeeds_with_mock_detection_and_pad_and_enroll_stays_503(monkeypatch) -> None:
    monkeypatch.setenv("BIOMETRIC_INTERNAL_SECRET", VALID_SECRET)
    clear_settings_cache()
    model_manager.reset_for_tests()

    with TestClient(create_app()) as client:
        model_manager._models["face_detection"] = ModelStatus(
            name="face_detection", configured=True, loaded=True, ready=True, path="mock_yunet.onnx"
        )
        model_manager._sessions["face_detection"] = _MockYuNetHandle()

        model_manager._models["face_liveness"] = ModelStatus(
            name="face_liveness", configured=True, loaded=True, ready=True, path="mock_pad.onnx"
        )
        model_manager._sessions["face_liveness"] = {
            "v2": _MockOnnxSession([[-2.0, 4.0, -2.0]]),
            "v1se": _MockOnnxSession([[-2.0, 3.0, -2.0]]),
        }

        # /ready must still be 503 because face_recognition is not loaded
        ready_resp = client.get("/ready")
        assert ready_resp.status_code == 503
        ready_body = ready_resp.json()
        assert ready_body["checks"]["detection_model_loaded"] is True
        assert ready_body["checks"]["pad_model_loaded"] is True
        assert ready_body["checks"]["recognition_model_loaded"] is False
        assert ready_body["ready"] is False

        # /liveness succeeds without leaking internal model details
        live_resp = client.post(
            "/api/v1/biometric/liveness",
            headers={INTERNAL_AUTH_HEADER: VALID_SECRET},
            json={"image_base64": _make_png_data_url()},
        )
        assert live_resp.status_code == 200
        body = live_resp.json()
        assert body["face_detected"] is True
        assert body["face_count"] == 1
        assert body["liveness_passed"] is True
        assert body["calibrated"] is False
        assert "variant_scores" not in body
        assert "mock_pad.onnx" not in str(body)

        # /enroll must still fail closed (503) because face_recognition is not implemented
        enroll_resp = client.post(
            "/api/v1/biometric/enroll",
            headers={INTERNAL_AUTH_HEADER: VALID_SECRET},
            json={"image_base64": _make_png_data_url(), "require_liveness": True},
        )
        assert enroll_resp.status_code == 503
        assert enroll_resp.json()["code"] == "MODEL_UNAVAILABLE"

    model_manager.reset_for_tests()
