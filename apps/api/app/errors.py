"""统一错误类型与响应封装。

全部业务错误走 AppError，避免把上游异常或堆栈暴露给客户端。
"""

from __future__ import annotations

from typing import Any

_ERROR_STATUS = {
    "INVALID_REQUEST": 400,
    "AUTH_REQUIRED": 401,
    "SESSION_EXPIRED": 401,
    "CSRF_FAILED": 403,
    "EMAIL_UNVERIFIED": 403,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "REVISION_REQUIRED": 428,
    "REVISION_CONFLICT": 409,
    "IDEMPOTENCY_CONFLICT": 409,
    "RESOURCE_IN_USE": 409,
    "FILE_TOO_LARGE": 413,
    "VALIDATION_ERROR": 422,
    "SOURCE_USE_RESTRICTED": 422,
    "CRS_REQUIRED": 422,
    "CRS_UNSUPPORTED": 422,
    "UNSUPPORTED_CAPABILITY": 422,
    "OPTIMIZATION_LIMIT": 422,
    "RATE_LIMITED": 429,
    "PROVIDER_QUOTA_EXCEEDED": 429,
    "PROVIDER_ERROR": 502,
    "PROVIDER_UNAVAILABLE": 503,
    "PROVIDER_NOT_CONFIGURED": 503,
    "PROVIDER_TIMEOUT": 504,
    "INTERNAL_ERROR": 500,
}


class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int | None = None,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status or _ERROR_STATUS.get(code, 400)
        self.details = details or {}
        self.headers = headers or {}

    def envelope(self, request_id: str) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "request_id": request_id,
                "details": self.details,
            }
        }
