"""Health and readiness probe endpoints."""

from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.schemas.biometric import HealthResponse, ReadinessChecks, ReadinessResponse
from app.services.model_manager import model_manager

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
async def health() -> HealthResponse:
    """Indicate whether the FastAPI application process is alive."""
    settings = get_settings()
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        version=settings.app_version,
    )


@router.get("/ready", response_model=ReadinessResponse)
async def readiness() -> JSONResponse:
    """Report granular readiness: app init, config validity, biometric models, and PAD model.

    Distinguishes liveness readiness (app init + config + detection + PAD)
    from recognition readiness (app init + config + detection + recognition).
    Returns 200 when liveness is ready; otherwise returns 503.
    """
    settings = get_settings()
    config_valid, config_errors = settings.validate_required_config()
    detection_loaded = model_manager.is_detection_model_loaded()
    recognition_loaded = model_manager.is_recognition_model_loaded()
    biometric_loaded = model_manager.are_biometric_models_loaded()
    pad_loaded = model_manager.is_pad_model_loaded()
    app_init = model_manager.app_initialized

    liveness_ready = app_init and config_valid and detection_loaded and pad_loaded
    recognition_ready = app_init and config_valid and detection_loaded and recognition_loaded

    overall_ready = liveness_ready

    payload = ReadinessResponse(
        ready=overall_ready,
        checks=ReadinessChecks(
            app_initialized=app_init,
            config_valid=config_valid,
            detection_model_loaded=detection_loaded,
            recognition_model_loaded=recognition_loaded,
            biometric_models_loaded=biometric_loaded,
            pad_model_loaded=pad_loaded,
            liveness_ready=liveness_ready,
            recognition_ready=recognition_ready,
        ),
        models=model_manager.get_all_statuses(),
        config_errors=config_errors,
    )

    http_status = status.HTTP_200_OK if overall_ready else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=http_status, content=payload.model_dump())
