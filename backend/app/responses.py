"""统一响应 envelope 与错误处理（对应《开发基线.md》§5/§6）。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

STATUS_BY_CODE: dict[str, int] = {
    "invalid_input": 400,
    "payload_too_large": 413,
    "unsupported_file": 415,
    "rate_limited": 429,
    "service_not_configured": 503,
    "service_unavailable": 503,
    "upstream_timeout": 504,
    "upstream_invalid": 502,
    "method_not_allowed": 405,
    "unknown_action": 404,
    "internal_error": 500,
}

RETRYABLE: dict[str, bool] = {
    "rate_limited": True,
    "service_unavailable": True,
    "upstream_timeout": True,
}

_HEADERS = {"Cache-Control": "no-store"}


class ApiError(Exception):
    def __init__(self, code: str, message: str, field: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.field = field


def new_request_id() -> str:
    return str(uuid.uuid4())


def _meta(
    coverage: str = "limited",
    warnings: list[str] | None = None,
    processing_mode: str = "ai",
    knowledge_version: str | None = None,
) -> dict:
    return {
        "apiVersion": "1",
        "requestId": new_request_id(),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "processingMode": processing_mode,
        "coverage": coverage,
        "knowledgeVersion": knowledge_version,
        "warnings": warnings or [],
    }


def success(
    data,
    coverage: str = "limited",
    warnings: list[str] | None = None,
    processing_mode: str = "ai",
    knowledge_version: str | None = None,
) -> JSONResponse:
    payload = data.model_dump() if hasattr(data, "model_dump") else data
    return JSONResponse(
        {
            "ok": True,
            "data": payload,
            "meta": _meta(coverage, warnings, processing_mode, knowledge_version),
        },
        headers=_HEADERS,
    )


def failure(code: str, message: str, request_id: str | None = None) -> JSONResponse:
    return JSONResponse(
        {
            "ok": False,
            "requestId": request_id or new_request_id(),
            "error": {"code": code, "message": message, "retryable": RETRYABLE.get(code, False)},
        },
        status_code=STATUS_BY_CODE.get(code, 500),
        headers=_HEADERS,
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        message = f"{exc.message}（字段：{exc.field}）" if exc.field else exc.message
        return failure(exc.code, message)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        field = ".".join(str(p) for p in errors[0].get("loc", []) if p != "body") if errors else "body"
        msg = errors[0].get("msg", "输入无效") if errors else "输入无效"
        return failure("invalid_input", f"{msg}（字段：{field or 'body'}）")

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        mapping = {
            400: ("invalid_input", "请求无效或请求体不是有效 JSON。"),
            404: ("unknown_action", "未知的请求路径。"),
            405: ("method_not_allowed", "请求方法不被允许。"),
        }
        code, message = mapping.get(exc.status_code, ("internal_error", "服务暂时无法完成请求，请稍后手动重试。"))
        return failure(code, message)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        # 生产只暴露稳定错误信息与请求标识，不泄露原始异常。
        return failure("internal_error", "服务暂时无法完成请求，请稍后手动重试。")