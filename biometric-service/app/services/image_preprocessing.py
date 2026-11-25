"""OpenCV-based image decoding, quality checks, 5-point alignment, and MiniFASNet cropping."""

from __future__ import annotations

import cv2
import numpy as np

from app.core.config import Settings, get_settings

# Canonical 5-point landmarks for 112x112 ArcFace/SFace similarity alignment:
# [right_eye, left_eye, nose_tip, right_mouth_corner, left_mouth_corner]
_CANONICAL_5PT_112 = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


class ImagePreprocessingError(ValueError):
    """Raised when image decoding, quality checks, or geometric preprocessing fails."""

    def __init__(self, message: str, *, code: str = "IMAGE_PREPROCESSING_FAILED"):
        super().__init__(message)
        self.message = message
        self.code = code


def decode_bgr_image(image_bytes: bytes, settings: Settings | None = None) -> np.ndarray:
    """Decode raw JPEG/PNG/WebP bytes into a validated 3-channel uint8 BGR NumPy array."""
    if not image_bytes:
        raise ImagePreprocessingError("Empty image payload.", code="EMPTY_IMAGE")

    cfg = settings or get_settings()
    buf = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if bgr is None or bgr.size == 0:
        raise ImagePreprocessingError("Failed to decode image bytes with OpenCV.", code="INVALID_IMAGE_DECODE")

    if bgr.ndim != 3 or bgr.shape[2] != 3:
        raise ImagePreprocessingError("Decoded image must have 3 color channels.", code="INVALID_IMAGE_CHANNELS")

    height, width = bgr.shape[:2]
    if width <= 0 or height <= 0:
        raise ImagePreprocessingError("Decoded image has invalid dimensions.", code="INVALID_IMAGE_DIMENSIONS")
    if width > cfg.max_image_edge_px or height > cfg.max_image_edge_px:
        raise ImagePreprocessingError(
            f"Decoded image dimensions exceed max edge ({cfg.max_image_edge_px}px).",
            code="IMAGE_TOO_LARGE",
        )

    if cfg.min_blur_laplacian_var > 0.0:
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        blur_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if blur_var < cfg.min_blur_laplacian_var:
            raise ImagePreprocessingError(
                "Image is too blurry for reliable biometric analysis.",
                code="IMAGE_BLURRY",
            )

    return bgr


def align_face_5pt(
    bgr_image: np.ndarray,
    landmarks_5pt: list[tuple[float, float]] | np.ndarray,
    output_size: tuple[int, int] = (112, 112),
) -> np.ndarray:
    """Align a detected face to canonical 5-point coordinates using a similarity transform."""
    src = np.asarray(landmarks_5pt, dtype=np.float32)
    if src.shape != (5, 2):
        raise ImagePreprocessingError("Expected 5x2 facial landmarks for alignment.", code="INVALID_LANDMARKS")

    out_w, out_h = int(output_size[0]), int(output_size[1])
    if out_w <= 0 or out_h <= 0:
        raise ImagePreprocessingError("Invalid alignment output size.", code="INVALID_OUTPUT_SIZE")

    dst = _CANONICAL_5PT_112.copy()
    dst[:, 0] *= out_w / 112.0
    dst[:, 1] *= out_h / 112.0

    matrix, _ = cv2.estimateAffinePartial2D(src, dst, method=cv2.LMEDS)
    if matrix is None:
        raise ImagePreprocessingError("Could not estimate 5-point similarity transform.", code="ALIGNMENT_FAILED")

    return cv2.warpAffine(bgr_image, matrix, (out_w, out_h), borderValue=0.0)


def crop_for_minifasnet(
    bgr_image: np.ndarray,
    bbox_xywh: tuple[float, float, float, float],
    *,
    scale: float,
    out_size: int = 80,
) -> np.ndarray:
    """Crop and resize a face context patch matching Silent-Face-Anti-Spoofing CropImage geometry.

    Assumption documented per Phase 2 review:
    - Uses aspect-preserving center expansion clamped to image bounds, followed by
      bilinear resize to (out_size, out_size) (80x80 for MiniFASNet V2 and V1SE).
    """
    src_h, src_w = bgr_image.shape[:2]
    box_x, box_y, box_w, box_h = [float(v) for v in bbox_xywh]
    if box_w <= 1.0 or box_h <= 1.0:
        raise ImagePreprocessingError("Invalid face bounding box dimensions for PAD crop.", code="INVALID_BBOX")

    clamped_scale = min((src_h - 1) / box_h, min((src_w - 1) / box_w, float(scale)))
    new_width = box_w * clamped_scale
    new_height = box_h * clamped_scale

    center_x = box_x + box_w / 2.0
    center_y = box_y + box_h / 2.0

    left_top_x = max(0, int(center_x - new_width / 2.0))
    left_top_y = max(0, int(center_y - new_height / 2.0))
    right_bottom_x = min(src_w - 1, int(center_x + new_width / 2.0))
    right_bottom_y = min(src_h - 1, int(center_y + new_height / 2.0))

    if right_bottom_x <= left_top_x or right_bottom_y <= left_top_y:
        raise ImagePreprocessingError("PAD crop produced an empty region.", code="INVALID_PAD_CROP")

    patch = bgr_image[left_top_y : right_bottom_y + 1, left_top_x : right_bottom_x + 1]
    return cv2.resize(patch, (out_size, out_size), interpolation=cv2.INTER_LINEAR)


def prepare_minifasnet_tensor(
    crop_bgr: np.ndarray,
    *,
    color_order: str = "BGR",
    normalize_01: bool = False,
) -> np.ndarray:
    """Convert an 80x80 HWC crop into a (1, 3, H, W) float32 NCHW tensor for ONNX Runtime.

    Assumptions documented per Phase 2 review:
    - Silent-Face-Anti-Spoofing receives OpenCV BGR crops and its custom ToTensor()
      retains [0.0, 255.0] float32 range (normalize_01=False). Both color_order and
      normalize_01 are configurable so they can be verified against exported ONNX weights.
    """
    img = crop_bgr
    if color_order.strip().upper() == "RGB":
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    tensor = img.astype(np.float32)
    if normalize_01:
        tensor = tensor / 255.0
    # HWC -> CHW -> NCHW
    chw = np.transpose(tensor, (2, 0, 1))
    return np.expand_dims(chw, axis=0)
