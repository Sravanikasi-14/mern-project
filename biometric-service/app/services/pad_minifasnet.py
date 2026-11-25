"""Model-independent Presentation Attack Detection (PAD) interface and MiniFASNet ONNX adapter."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np

from app.core.config import Settings, get_settings
from app.services.image_preprocessing import crop_for_minifasnet, prepare_minifasnet_tensor


class PADInferenceError(RuntimeError):
    """Raised when PAD ONNX inference fails or yields invalid outputs (fail-closed)."""

    def __init__(self, message: str, *, code: str = "PAD_INFERENCE_FAILED"):
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass(frozen=True)
class PADResult:
    """Structured PAD evaluation result.

    Note: `calibrated` is False until thresholds and class mappings are validated
    against real exported MiniFASNet ONNX weights and representative captures.
    """

    liveness_passed: bool
    liveness_score: float
    threshold: float
    variant_scores: dict[str, float]
    calibrated: bool = False


class PADEngine(Protocol):
    """Model-independent PAD engine interface."""

    def evaluate(self, bgr_image: np.ndarray, bbox_xywh: tuple[float, float, float, float]) -> PADResult:
        """Evaluate whether a detected face region appears bona fide or a spoof presentation."""


def _softmax(logits: np.ndarray) -> np.ndarray:
    """Numerically stable 1D softmax."""
    shifted = logits - np.max(logits)
    exp = np.exp(shifted)
    denom = np.sum(exp)
    if not np.isfinite(denom) or denom <= 0.0:
        raise PADInferenceError("PAD logits produced non-finite softmax denominator.")
    return exp / denom


class MiniFASNetOnnxAdapter:
    """ONNX Runtime adapter for MiniFASNet V2 and V1SE PAD models."""

    def __init__(self, sessions: dict[str, Any], settings: Settings | None = None) -> None:
        if not sessions:
            raise ValueError("At least one PAD ONNX session is required.")
        self._sessions = sessions
        self._settings = settings or get_settings()

    def evaluate(self, bgr_image: np.ndarray, bbox_xywh: tuple[float, float, float, float]) -> PADResult:
        cfg = self._settings
        scale_map = {"v2": cfg.pad_v2_scale, "v1se": cfg.pad_v1se_scale}
        weight_map = {"v2": cfg.pad_v2_weight, "v1se": cfg.pad_v1se_weight}

        variant_scores: dict[str, float] = {}
        weighted_sum = 0.0
        total_weight = 0.0

        for variant, session in self._sessions.items():
            if session is None:
                continue
            scale = scale_map.get(variant, cfg.pad_v2_scale)
            crop = crop_for_minifasnet(
                bgr_image,
                bbox_xywh,
                scale=scale,
                out_size=cfg.pad_input_size,
            )
            tensor = prepare_minifasnet_tensor(
                crop,
                color_order=cfg.pad_color_order,
                normalize_01=cfg.pad_normalize_01,
            )

            try:
                input_name = session.get_inputs()[0].name
                outputs = session.run(None, {input_name: tensor})
            except Exception as exc:
                raise PADInferenceError(
                    f"MiniFASNet '{variant}' ONNX inference failed: {type(exc).__name__}"
                ) from exc

            if not outputs:
                raise PADInferenceError(f"MiniFASNet '{variant}' returned empty output.")

            logits = np.asarray(outputs[0], dtype=np.float32)
            if logits.ndim != 2 or logits.shape[0] != 1 or logits.shape[1] <= cfg.pad_live_class_index:
                raise PADInferenceError(
                    f"MiniFASNet '{variant}' returned unexpected output shape {logits.shape}."
                )
            if not np.all(np.isfinite(logits)):
                raise PADInferenceError(f"MiniFASNet '{variant}' returned non-finite logits.")

            probs = _softmax(logits[0])
            live_prob = float(probs[cfg.pad_live_class_index])
            variant_scores[variant] = live_prob

            w = float(weight_map.get(variant, 1.0))
            weighted_sum += w * live_prob
            total_weight += w

        if not variant_scores:
            raise PADInferenceError("No valid PAD variant sessions executed.")

        if total_weight > 0.0:
            combined_score = weighted_sum / total_weight
        else:
            combined_score = sum(variant_scores.values()) / len(variant_scores)

        passed = combined_score >= cfg.pad_threshold
        return PADResult(
            liveness_passed=passed,
            liveness_score=combined_score,
            threshold=cfg.pad_threshold,
            variant_scores=variant_scores,
            calibrated=False,
        )
