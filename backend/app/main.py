"""FastAPI 应用入口：清晰 REST 路由 + 统一 envelope + 异常处理。"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .responses import register_exception_handlers, success
from .routers import config, contract, dispute, extract, sources

app = FastAPI(
    title="租住有据 API",
    description="合同审查、证据整理与争议辅助。提供信息辅助，不替代专业法律意见。",
    version="1.0.0",
)

# 本地开发允许 Vite dev server 跨域；生产经同-origin 代理，不依赖 CORS。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

app.include_router(config.router, prefix="/api")
app.include_router(contract.router, prefix="/api")
app.include_router(dispute.router, prefix="/api")
app.include_router(extract.router, prefix="/api")
app.include_router(sources.router, prefix="/api")


@app.get("/api/health", tags=["health"])
async def health():
    return success({"status": "ok", "modelConfigured": get_settings().model_configured}, coverage="supported")


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)