"""Unit tests for OpenCV image preprocessing, 5-point alignment, and MiniFASNet cropping."""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.core.config import Settings
from app.services.image_preprocessing import (
    ImagePreprocessingError,
    align_face_5pt,
    crop_for_minifasnet,
    decode_bgr_image,
    prepare_minifasnet_tensor,
)


def _encode_synthetic_png(width: int = 240, height: int = 240) -> bytes:
    img = np.zeros((height, width, 3), dtype=np.uint8)
    cv2.rectangle(img, (60, 60), (180, 180), (200, 180, 160), -1)
    ok, buf = cv2.imencode(".png", img)
    assert ok is True
    return buf.tobytes()


def test_decode_bgr_image_success() -> None:
    raw = _encode_synthetic_png(200, 160)
    bgr = decode_bgr_image(raw, Settings(biometric_internal_secret="x" * 32))
    assert bgr.shape == (160, 200, 3)
    assert bgr.dtype == np.uint8


def test_decode_bgr_image_rejects_empty_and_corrupt_bytes() -> None:
    cfg = Settings(biometric_internal_secret="x" * 32)
    with pytest.raises(ImagePreprocessingError, match="Empty"):
        decode_bgr_image(b"", cfg)

    with pytest.raises(ImagePreprocessingError, match="Failed to decode"):
        decode_bgr_image(b"not-a-valid-image-buffer", cfg)


def test_decode_bgr_image_rejects_blurry_when_threshold_set() -> None:
    # Solid uniform image has Laplacian variance = 0.0
    uniform = np.full((120, 120, 3), 128, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", uniform)
    assert ok is True
    cfg = Settings(biometric_internal_secret="x" * 32, min_blur_laplacian_var=10.0)
    with pytest.raises(ImagePreprocessingError) as exc:
        decode_bgr_image(buf.tobytes(), cfg)
    assert exc.value.code == "IMAGE_BLURRY"


def test_align_face_5pt_produces_112x112_output() -> None:
    bgr = np.zeros((240, 240, 3), dtype=np.uint8)
    landmarks = [
        (85.0, 95.0),
        (145.0, 95.0),
        (115.0, 125.0),
        (92.0, 155.0),
        (138.0, 155.0),
    ]
    aligned = align_face_5pt(bgr, landmarks, output_size=(112, 112))
    assert aligned.shape == (112, 112, 3)

    with pytest.raises(ImagePreprocessingError):
        align_face_5pt(bgr, [(10.0, 10.0)], output_size=(112, 112))


def test_crop_for_minifasnet_clamps_bounds_and_resizes_to_80x80() -> None:
    bgr = np.zeros((200, 200, 3), dtype=np.uint8)
    # Near corner so 2.7x and 4.0x expansion hits boundaries safely
    crop_v2 = crop_for_minifasnet(bgr, (10.0, 10.0, 80.0, 80.0), scale=2.7, out_size=80)
    crop_v1se = crop_for_minifasnet(bgr, (10.0, 10.0, 80.0, 80.0), scale=4.0, out_size=80)
    assert crop_v2.shape == (80, 80, 3)
    assert crop_v1se.shape == (80, 80, 3)

    with pytest.raises(ImagePreprocessingError):
        crop_for_minifasnet(bgr, (10.0, 10.0, 0.0, 50.0), scale=2.7, out_size=80)


def test_prepare_minifasnet_tensor_formats_and_channel_order() -> None:
    patch = np.zeros((80, 80, 3), dtype=np.uint8)
    patch[:, :, 0] = 50  # B
    patch[:, :, 2] = 200  # R

    t_bgr = prepare_minifasnet_tensor(patch, color_order="BGR", normalize_01=False)
    assert t_bgr.shape == (1, 3, 80, 80)
    assert t_bgr.dtype == np.float32
    assert t_bgr[0, 0, 0, 0] == pytest.approx(50.0)
    assert t_bgr[0, 2, 0, 0] == pytest.approx(200.0)

    t_rgb_norm = prepare_minifasnet_tensor(patch, color_order="RGB", normalize_01=True)
    assert t_rgb_norm[0, 0, 0, 0] == pytest.approx(200.0 / 255.0)
    assert t_rgb_norm[0, 2, 0, 0] == pytest.approx(50.0 / 255.0)
