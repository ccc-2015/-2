"""精排序（rerank）客户端：对接 OpenAI 兼容的 /rerank 接口。

只做一次请求，不重试；失败时返回 None，由调用方回退到向量+关键词顺序。
不打印密钥、正文或上游原始错误。
"""
from __future__ import annotations

import logging

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

_MAX_DOC_CHARS = 600


def _payload(model: str, query: str, documents: list[str]) -> dict:
    return {"model": model, "query": query, "documents": documents, "top_n": len(documents)}


def _parse(body: dict, count: int) -> list[float] | None:
    items = body.get("results") or body.get("data")
    if not isinstance(items, list) or not items:
        return None
    scores = [0.0] * count
    for item in items:
        if not isinstance(item, dict):
            continue
        index = item.get("index")
        score = item.get("relevance_score", item.get("score"))
        if isinstance(index, int) and 0 <= index < count and isinstance(score, (int, float)):
            scores[index] = float(score)
    return scores


def rerank(query: str, documents: list[str]) -> list[float] | None:
    """返回与 documents 等长的相关性分数；未配置或失败返回 None。"""
    settings = get_settings()
    if not settings.rerank_configured or not documents:
        return None
    key = settings.rerank_key
    if not key:
        logger.warning("rerank skipped: missing api key")
        return None

    documents = [text[:_MAX_DOC_CHARS] for text in documents]
    try:
        # trust_env=False：与模型客户端一致，避免本机 IPv6 形式 NO_PROXY 导致构造失败。
        with httpx.Client(timeout=settings.rerank_timeout_seconds, trust_env=False) as client:
            response = client.post(
                settings.rerank_endpoint,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
                json=_payload(settings.rerank_model_name, query, documents),
            )
    except httpx.TimeoutException:
        logger.warning("rerank timeout")
        return None
    except httpx.HTTPError:
        logger.warning("rerank unavailable")
        return None

    if response.status_code >= 400:
        logger.warning("rerank http %s", response.status_code)
        return None
    try:
        return _parse(response.json(), len(documents))
    except (ValueError, TypeError):
        logger.warning("rerank invalid response")
        return None
