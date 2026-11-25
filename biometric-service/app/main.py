"""FastAPI application entrypoint for HRMS Biometric Service."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.routes import biometric, health
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.services.face_detector_yunet import DetectionInferenceError, FaceValidationError
from app.services.image_preprocessing import ImagePreprocessingError
from app.services.model_manager import ModelUnavailableError, model_manager
from app.services.pad_minifasnet import PADInferenceError

logger = configure_logging()


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose Content-Length or streamed body exceeds MAX_REQUEST_BYTES."""

    def __init__(self, app, max_bytes: int) -> None:
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > self.max_bytes:
                    return JSONResponse(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        content={
                            "code": "PAYLOAD_TOO_LARGE",
                            "message": "Request body exceeds maximum allowed size.",
                        },
                    )
            except ValueError:
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={
                        "code": "INVALID_CONTENT_LENGTH",
                        "message": "Invalid Content-Length header.",
                    },
                )

        body = await request.body()
        if len(body) > self.max_bytes:
            return JSONResponse(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                content={
                    "code": "PAYLOAD_TOO_LARGE",
                    "message": "Request body exceeds maximum allowed size.",
                },
            )
        return await call_next(request)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialize settings, logging, and model manager on startup."""
    settings = get_settings()
    configure_logging(settings.log_level)
    config_ok, errors = settings.validate_required_config()
    if not config_ok:
        logger.warning("Biometric service configuration incomplete: %s", "; ".join(errors))
    await model_manager.initialize(settings)
    yield


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    settings = get_settings()
    application = FastAPI(
        title="HRMS Biometric Service",
        version=settings.app_version,
        docs_url=None if settings.app_env == "production" else "/docs",
        redoc_url=None,
        lifespan=lifespan,
    )

    application.add_middleware(RequestSizeLimitMiddleware, max_bytes=settings.max_request_bytes)

    @application.exception_handler(ModelUnavailableError)
    async def model_unavailable_handler(_request: Request, exc: ModelUnavailableError):
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "code": exc.code,
                "message": exc.message,
                "model": exc.model_name,
            },
        )

    @application.exception_handler(ImagePreprocessingError)
    async def preprocessing_error_handler(_request: Request, exc: ImagePreprocessingError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "code": exc.code,
                "message": exc.message,
            },
        )

    @application.exception_handler(FaceValidationError)
    async def face_validation_error_handler(_request: Request, exc: FaceValidationError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "code": exc.code,
                "message": exc.message,
            },
        )

    @application.exception_handler(DetectionInferenceError)
    async def detection_inference_error_handler(_request: Request, exc: DetectionInferenceError):
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "code": exc.code,
                "message": exc.message,
            },
        )

    @application.exception_handler(PADInferenceError)
    async def pad_inference_error_handler(_request: Request, exc: PADInferenceError):
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "code": exc.code,
                "message": exc.message,
            },
        )

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(_request: Request, exc: RequestValidationError):
        safe_errors = [
            {
                "loc": [str(part) for part in err.get("loc", ())],
                "msg": str(err.get("msg", "Invalid input.")),
                "type": str(err.get("type", "value_error")),
            }
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "code": "VALIDATION_ERROR",
                "message": "Invalid biometric request payload.",
                "errors": safe_errors,
            },
        )

    @application.exception_handler(Exception)
    async def unhandled_exception_handler(_request: Request, exc: Exception):
        logger.error("Unhandled exception: %s", type(exc).__name__)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "code": "INTERNAL_ERROR",
                "message": "An internal biometric service error occurred.",
            },
        )

    application.include_router(health.router)
    application.include_router(biometric.router)
    return application


app = create_app()
