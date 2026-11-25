"""Protected internal biometric inference routes (Node.js backend only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.security import verify_internal_auth
from app.schemas.biometric import (
    BiometricEnrollRequest,
    BiometricLivenessRequest,
    BiometricVerifyRequest,
    LivenessCheckResponse,
    decode_and_validate_image,
)
from app.services.face_detection import detect_single_face
from app.services.face_liveness import evaluate_presentation_attack
from app.services.face_recognition import extract_face_embedding
from app.services.model_manager import model_manager

router = APIRouter(
    prefix="/api/v1/biometric",
    tags=["biometric"],
    dependencies=[Depends(verify_internal_auth)],
)


@router.get("/health")
async def biometric_health() -> JSONResponse:
    """Internal biometric subsystem health and independent model readiness status."""
    settings = get_settings()
    detection_loaded = model_manager.is_detection_model_loaded()
    recognition_loaded = model_manager.is_recognition_model_loaded()
    biometric_loaded = model_manager.are_biometric_models_loaded()
    pad_loaded = model_manager.is_pad_model_loaded()
    ready = model_manager.app_initialized and biometric_loaded and pad_loaded

    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "ready" if ready else "unavailable",
            "service": settings.app_name,
            "detection_model_loaded": detection_loaded,
            "recognition_model_loaded": recognition_loaded,
            "biometric_models_loaded": biometric_loaded,
            "pad_model_loaded": pad_loaded,
            "models": model_manager.get_all_statuses(),
        },
    )


@router.post("/liveness", response_model=LivenessCheckResponse)
async def check_liveness(payload: BiometricLivenessRequest) -> LivenessCheckResponse:
    """Run YuNet single-face detection and MiniFASNet PAD liveness evaluation.

    Fails closed (503) if detection or PAD models are unavailable.
    """
    image_bytes, _, _ = decode_and_validate_image(payload.image_base64)
    model_manager.ensure_detection_ready()
    model_manager.ensure_pad_ready()

    face = await detect_single_face(image_bytes, model_manager)
    pad_result = await evaluate_presentation_attack(image_bytes, model_manager, face.bbox)

    return LivenessCheckResponse(
        face_detected=True,
        face_count=1,
        liveness_passed=pad_result.liveness_passed,
        liveness_score=round(pad_result.liveness_score, 4),
        calibrated=pad_result.calibrated,
        message=(
            "Liveness check passed (uncalibrated threshold)."
            if pad_result.liveness_passed
            else "Liveness check failed (possible presentation attack)."
        ),
    )


@router.post("/enroll")
async def enroll_biometric(payload: BiometricEnrollRequest) -> dict:
    """Fail-closed face enrollment endpoint (recognition model not yet integrated in Phase 2)."""
    settings = get_settings()
    image_bytes, _, _ = decode_and_validate_image(payload.image_base64)
    model_manager.ensure_biometric_ready()
    if payload.require_liveness or settings.pad_mandatory:
        model_manager.ensure_pad_ready()

    face = await detect_single_face(image_bytes, model_manager)
    if payload.require_liveness or settings.pad_mandatory:
        await evaluate_presentation_attack(image_bytes, model_manager, face.bbox)

    return await extract_face_embedding(image_bytes, model_manager)


@router.post("/verify")
async def verify_biometric(payload: BiometricVerifyRequest) -> dict:
    """Fail-closed face verification endpoint (recognition model not yet integrated in Phase 2)."""
    settings = get_settings()
    image_bytes, _, _ = decode_and_validate_image(payload.image_base64)
    model_manager.ensure_biometric_ready()
    if payload.require_liveness or settings.pad_mandatory:
        model_manager.ensure_pad_ready()

    face = await detect_single_face(image_bytes, model_manager)
    if payload.require_liveness or settings.pad_mandatory:
        await evaluate_presentation_attack(image_bytes, model_manager, face.bbox)

    return await extract_face_embedding(image_bytes, model_manager)
