"""Internal service-to-service authentication and request security."""

from __future__ import annotations

import hmac
from fastapi import Header, HTTPException, status

from app.core.config import get_settings

INTERNAL_AUTH_HEADER = "X-Biometric-Service-Secret"


def constant_time_secret_matches(provided: str, expected: str) -> bool:
    """Compare two secrets in constant time using HMAC digest comparison."""
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))


async def verify_internal_auth(
    x_biometric_service_secret: str | None = Header(default=None, alias=INTERNAL_AUTH_HEADER),
) -> None:
    """Authenticate internal requests from the Node.js HRMS backend.

    Fails closed when BIOMETRIC_INTERNAL_SECRET is unconfigured or invalid.
    """
    settings = get_settings()
    if not settings.is_internal_secret_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "SERVICE_AUTH_NOT_CONFIGURED",
                "message": "Internal service authentication is not configured.",
            },
        )

    if not x_biometric_service_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "INTERNAL_AUTH_MISSING",
                "message": "Missing internal service authentication header.",
            },
        )

    expected = settings.biometric_internal_secret.strip()
    if not constant_time_secret_matches(x_biometric_service_secret.strip(), expected):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "INTERNAL_AUTH_INVALID",
                "message": "Invalid internal service credentials.",
            },
        )
