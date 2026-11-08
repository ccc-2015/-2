"""向量模型：远程 OpenAI 兼容 /embeddings 优先，未配置时回退本地 fastembed。

向量模型与文字模型、精排模型完全独立，不继承它们的 URL/Key。
"""
from __future__ import annotations

import logging
import os
from threading import Lock

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

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
    if not settings.embedding_local_configured or settings.embedding_api_configured:
        return None
    if _model is None:
        with _lock:
            if _model is None:
                _prepare_env()
                from fastembed import TextEmbedding

                _model = TextEmbedding(model_name=settings.local_embedding_model)
    return _model


def _check_dim(vectors: list[list[float]]) -> list[list[float]]:
    expected = get_settings().embedding_dim
    for vector in vectors:
        if len(vector) != expected:
            raise RuntimeError(f"embedding 维度不匹配：模型返回 {len(vector)}，配置为 {expected}")
    return vectors


def _embed_remote(texts: list[str]) -> list[list[float]]:
    settings = get_settings()
    headers = {"Content-Type": "application/json"}
    if settings.embedding_api_key:
        headers["Authorization"] = f"Bearer {settings.embedding_api_key}"
    with httpx.Client(timeout=settings.embedding_timeout_seconds, trust_env=False) as client:
        response = client.post(
            settings.embedding_endpoint,
            headers=headers,
            json={"model": settings.embedding_model_name, "input": texts},
        )
    if response.status_code >= 400:
        raise RuntimeError(f"向量服务返回 {response.status_code}")
    body = response.json()
    items = body.get("data")
    if not isinstance(items, list) or len(items) != len(texts):
        raise RuntimeError("向量服务返回结构无效")
    ordered = sorted(items, key=lambda item: item.get("index", 0))
    return [[float(value) for value in item["embedding"]] for item in ordered]


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    settings = get_settings()
    if settings.embedding_api_configured:
        batch = max(1, settings.embedding_batch_size)
        vectors: list[list[float]] = []
        for start in range(0, len(texts), batch):
            vectors.extend(_embed_remote(texts[start : start + batch]))
        return _check_dim(vectors)
    model = get_embedding_model()
    if model is None:
        return []
    vectors = [[float(value) for value in vector] for vector in model.embed(texts)]
    return _check_dim(vectors)


def embed_query(text: str) -> list[float]:
    vectors = embed_texts([text])
    return vectors[0] if vectors else []
