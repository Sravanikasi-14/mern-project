"""Model lifecycle manager for biometric inference and PAD models.

Tracks individual model readiness, prevents duplicate concurrent initialization,
handles missing or corrupt model files safely, and fails closed when models are absent.
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from app.core.config import Settings, get_settings
from app.core.logging import configure_logging

logger = configure_logging()


class ModelUnavailableError(Exception):
    """Raised when a required inference model is not configured, missing, or corrupt."""

    def __init__(self, message: str, *, code: str = "MODEL_UNAVAILABLE", model_name: str | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.model_name = model_name


@dataclass
class ModelStatus:
    """State of a single managed model artifact."""

    name: str
    configured: bool = False
    loaded: bool = False
    ready: bool = False
    path: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ModelManager:
    """Thread/async-safe model lifecycle manager."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._app_initialized: bool = False
        self._initializing: bool = False
        self._active_settings: Settings | None = None
        self._models: dict[str, ModelStatus] = {
            "face_detection": ModelStatus(name="face_detection"),
            "face_recognition": ModelStatus(name="face_recognition"),
            "face_liveness": ModelStatus(name="face_liveness"),
        }
        self._sessions: dict[str, Any] = {}

    @property
    def app_initialized(self) -> bool:
        return self._app_initialized

    def get_model_status(self, name: str) -> ModelStatus:
        return self._models[name]

    def get_all_statuses(self) -> dict[str, dict[str, Any]]:
        return {name: status.to_dict() for name, status in self._models.items()}

    def get_session(self, name: str) -> Any:
        """Return loaded session/handle for a model slot, or None if unavailable."""
        return self._sessions.get(name)

    def get_pad_sessions(self) -> dict[str, Any]:
        """Return loaded PAD variant sessions (e.g. {'v2': ..., 'v1se': ...})."""
        sess = self._sessions.get("face_liveness")
        if isinstance(sess, dict):
            return dict(sess)
        return {}

    def are_biometric_models_loaded(self) -> bool:
        return (
            self._models["face_detection"].ready
            and self._models["face_recognition"].ready
        )

    def is_detection_model_loaded(self) -> bool:
        return self._models["face_detection"].ready

    def is_recognition_model_loaded(self) -> bool:
        return self._models["face_recognition"].ready

    def is_pad_model_loaded(self) -> bool:
        return self._models["face_liveness"].ready

    async def initialize(self, settings: Settings | None = None, *, force: bool = False) -> None:
        """Initialize configured models once; concurrent callers wait on the same lock."""
        if self._app_initialized and not force:
            return

        async with self._lock:
            if self._app_initialized and not force:
                return

            self._initializing = True
            cfg = settings or get_settings()
            self._active_settings = cfg
            try:
                self._load_single_model("face_detection", cfg.face_detection_model_path)
                self._load_single_model("face_recognition", cfg.face_recognition_model_path)
                self._load_single_model("face_liveness", cfg.pad_v2_model_path or cfg.pad_model_path)
                self._app_initialized = True
            finally:
                self._initializing = False

    def _load_single_model(self, name: str, raw_path: str, cfg: Settings | None = None) -> None:
        """Attempt to validate and load a configured model path without inventing weights."""
        settings = cfg or self._active_settings or get_settings()

        if name == "face_liveness":
            self._load_pad_models(settings)
            return

        trimmed = (raw_path or "").strip()
        if not trimmed:
            self._models[name] = ModelStatus(
                name=name,
                configured=False,
                loaded=False,
                ready=False,
                path=None,
                error="Model path is not configured.",
            )
            self._sessions.pop(name, None)
            return

        model_path = Path(trimmed)
        if not model_path.exists() or not model_path.is_file():
            logger.warning("Model '%s' missing at configured path.", name)
            self._models[name] = ModelStatus(
                name=name,
                configured=True,
                loaded=False,
                ready=False,
                path=str(model_path),
                error="Configured model file does not exist.",
            )
            self._sessions.pop(name, None)
            return

        try:
            file_size = model_path.stat().st_size
            if file_size <= 0:
                raise ValueError("Model file is empty (0 bytes).")

            if name == "face_detection":
                session = self._validate_and_open_detection_artifact(model_path, settings)
            else:
                session = self._validate_and_open_artifact(model_path, settings)

            self._sessions[name] = session
            self._models[name] = ModelStatus(
                name=name,
                configured=True,
                loaded=True,
                ready=True,
                path=str(model_path),
                error=None,
            )
            logger.info("Model '%s' loaded successfully.", name)
        except Exception as exc:
            logger.error("Failed to load model '%s': %s", name, type(exc).__name__)
            self._sessions.pop(name, None)
            self._models[name] = ModelStatus(
                name=name,
                configured=True,
                loaded=False,
                ready=False,
                path=str(model_path),
                error=f"Corrupt or unloadable model artifact: {exc}",
            )

    def _load_pad_models(self, settings: Settings) -> None:
        """Load MiniFASNet V2 and/or V1SE ONNX PAD models, failing closed on any misconfiguration."""
        v2_raw = (settings.pad_v2_model_path or settings.pad_model_path or "").strip()
        v1se_raw = (settings.pad_v1se_model_path or "").strip()

        if not v2_raw and not v1se_raw:
            self._models["face_liveness"] = ModelStatus(
                name="face_liveness",
                configured=False,
                loaded=False,
                ready=False,
                path=None,
                error="Model path is not configured.",
            )
            self._sessions.pop("face_liveness", None)
            return

        configured_paths = [p for p in (v2_raw, v1se_raw) if p]
        joined_paths = "; ".join(configured_paths)

        if settings.pad_require_dual_model and (not v2_raw or not v1se_raw):
            self._models["face_liveness"] = ModelStatus(
                name="face_liveness",
                configured=True,
                loaded=False,
                ready=False,
                path=joined_paths,
                error="Both PAD_V2_MODEL_PATH and PAD_V1SE_MODEL_PATH are required when PAD_REQUIRE_DUAL_MODEL=true.",
            )
            self._sessions.pop("face_liveness", None)
            return

        pad_sessions: dict[str, Any] = {}
        variant_specs = [("v2", v2_raw), ("v1se", v1se_raw)]

        for variant, raw_path in variant_specs:
            if not raw_path:
                continue
            model_path = Path(raw_path)
            if not model_path.exists() or not model_path.is_file():
                logger.warning("PAD model '%s' missing at configured path.", variant)
                self._models["face_liveness"] = ModelStatus(
                    name="face_liveness",
                    configured=True,
                    loaded=False,
                    ready=False,
                    path=joined_paths,
                    error=f"Configured PAD '{variant}' model file does not exist.",
                )
                self._sessions.pop("face_liveness", None)
                return

            try:
                if model_path.stat().st_size <= 0:
                    raise ValueError(f"PAD '{variant}' model file is empty (0 bytes).")
                pad_sessions[variant] = self._validate_and_open_pad_onnx_artifact(model_path, settings)
            except Exception as exc:
                logger.error("Failed to load PAD '%s' model: %s", variant, type(exc).__name__)
                self._models["face_liveness"] = ModelStatus(
                    name="face_liveness",
                    configured=True,
                    loaded=False,
                    ready=False,
                    path=joined_paths,
                    error=f"Corrupt or unloadable PAD '{variant}' artifact: {exc}",
                )
                self._sessions.pop("face_liveness", None)
                return

        self._sessions["face_liveness"] = pad_sessions
        self._models["face_liveness"] = ModelStatus(
            name="face_liveness",
            configured=True,
            loaded=True,
            ready=True,
            path=joined_paths,
            error=None,
        )
        logger.info("PAD models loaded successfully (%s).", ",".join(pad_sessions.keys()))

    @staticmethod
    def _create_onnx_session(model_path: Path, settings: Settings) -> Any:
        import onnxruntime as ort

        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = settings.onnx_intra_op_threads
        sess_opts.inter_op_num_threads = settings.onnx_inter_op_threads
        return ort.InferenceSession(
            str(model_path),
            sess_options=sess_opts,
            providers=["CPUExecutionProvider"],
        )

    @classmethod
    def _validate_and_open_detection_artifact(cls, model_path: Path, settings: Settings) -> Any:
        """Validate YuNet ONNX detection artifact using ONNX Runtime and OpenCV FaceDetectorYN."""
        suffix = model_path.suffix.lower()
        if suffix != ".onnx":
            raise ValueError(f"Face detection requires an .onnx YuNet model, got '{suffix}'.")
        # Validate ONNX graph integrity first, then construct OpenCV FaceDetectorYN.
        cls._create_onnx_session(model_path, settings)
        import cv2

        return cv2.FaceDetectorYN.create(
            str(model_path),
            "",
            (320, 320),
            settings.yunet_score_threshold,
            settings.yunet_nms_threshold,
            settings.yunet_top_k,
        )

    @classmethod
    def _validate_and_open_pad_onnx_artifact(cls, model_path: Path, settings: Settings) -> Any:
        """Validate MiniFASNet ONNX artifact. Rejects raw PyTorch .pth state_dict files explicitly."""
        suffix = model_path.suffix.lower()
        if suffix in {".pt", ".pth"}:
            raise ValueError(
                "MiniFASNet .pth/.pt checkpoints are PyTorch state_dict files (not TorchScript archives) "
                "and cannot be loaded with torch.jit.load. Export to .onnx using scripts/export_minifasnet_onnx.py."
            )
        if suffix != ".onnx":
            raise ValueError(f"Unsupported PAD model artifact extension '{suffix}'. Expected '.onnx'.")
        return cls._create_onnx_session(model_path, settings)

    @classmethod
    def _validate_and_open_artifact(cls, model_path: Path, settings: Settings | None = None) -> Any:
        """Validate generic model artifact integrity based on extension."""
        cfg = settings or get_settings()
        suffix = model_path.suffix.lower()
        if suffix == ".onnx":
            return cls._create_onnx_session(model_path, cfg)
        if suffix in {".pt", ".pth"}:
            import torch

            return torch.jit.load(str(model_path), map_location="cpu")
        raise ValueError(f"Unsupported model artifact extension '{suffix}'.")

    def ensure_detection_ready(self) -> None:
        """Raise ModelUnavailableError (503) if face detection model is not ready."""
        st = self._models["face_detection"]
        if not st.ready:
            raise ModelUnavailableError(
                f"Face detection model is not ready: {st.error or 'not loaded.'}",
                code="FACE_DETECTION_UNAVAILABLE",
                model_name="face_detection",
            )

    def ensure_biometric_ready(self) -> None:
        """Raise ModelUnavailableError (503) if detection or recognition models are not ready."""
        for key in ("face_detection", "face_recognition"):
            st = self._models[key]
            if not st.ready:
                raise ModelUnavailableError(
                    f"Biometric model '{key}' is not ready: {st.error or 'not loaded.'}",
                    code="MODEL_UNAVAILABLE",
                    model_name=key,
                )

    def ensure_pad_ready(self) -> None:
        """Raise ModelUnavailableError (503) if PAD model is not ready."""
        st = self._models["face_liveness"]
        if not st.ready:
            raise ModelUnavailableError(
                f"PAD model 'face_liveness' is not ready: {st.error or 'not loaded.'}",
                code="PAD_MODEL_UNAVAILABLE",
                model_name="face_liveness",
            )

    def reset_for_tests(self) -> None:
        """Reset manager state between unit tests."""
        self._app_initialized = False
        self._initializing = False
        self._active_settings = None
        self._sessions.clear()
        self._models = {
            "face_detection": ModelStatus(name="face_detection"),
            "face_recognition": ModelStatus(name="face_recognition"),
            "face_liveness": ModelStatus(name="face_liveness"),
        }


model_manager = ModelManager()
