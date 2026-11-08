"""本地中文 embedding（fastembed），用于 PostgreSQL/pgvector 语义检索。"""
from __future__ import annotations

import os
from threading import Lock

from ..config import get_settings

_model = None
_lock = Lock()
_PROXY_KEYS = (
    "NO_PROXY",
    "no_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
)


def _prepare_env() -> None:
    # 本机 NO_PROXY 含 IPv6 形式 [::1]，httpx 0.28 在下载/加载模型时会抛 InvalidURL。
    for key in _PROXY_KEYS:
        os.environ.pop(key, None)
    settings = get_settings()
    if settings.hf_endpoint:
        os.environ.setdefault("HF_ENDPOINT", settings.hf_endpoint)
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def get_embedding_model():
    global _model
    settings = get_settings()
    if not settings.embedding_configured:
        return None
    if _model is None:
        with _lock:
            if _model is None:
                _prepare_env()
                from fastembed import TextEmbedding

                _model = TextEmbedding(model_name=settings.model_embedding_name)
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    model = get_embedding_model()
    if model is None:
        return []
    vectors = [[float(value) for value in vector] for vector in model.embed(texts)]
    expected = get_settings().embedding_dim
    for vector in vectors:
        if len(vector) != expected:
            raise RuntimeError(f"embedding 维度不匹配：模型返回 {len(vector)}，配置为 {expected}")
    return vectors


def embed_query(text: str) -> list[float]:
    vectors = embed_texts([text])
    return vectors[0] if vectors else []
