"""单一生成式模型 API 客户端（OpenAI 兼容）。密钥仅服务端持有。

固定可信目的地来自服务端配置，不接受用户 URL；不打印密钥、正文或上游原始错误；
失败不自动重发付费请求。
"""
from __future__ import annotations

import json
import re

import httpx

from .config import get_settings
from .responses import ApiError

_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


async def chat(messages: list[dict], temperature: float = 0.2, max_tokens: int = 4096) -> str:
    settings = get_settings()
    if not settings.model_configured:
        raise ApiError("service_not_configured", "模型服务尚未配置，无法完成分析。")

    try:
        # trust_env=False：出站不继承本机代理环境变量。httpx 0.28 解析 IPv6 形式的
        # NO_PROXY（如 [::1]）会在构造客户端时抛 InvalidURL，导致接口 500。
        async with httpx.AsyncClient(timeout=settings.timeout_seconds, trust_env=False) as client:
            response = await client.post(
                f"{settings.base_url}/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {settings.model_api_key}",
                },
                json={
                    "model": settings.model_name,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": False,
                },
            )
    except httpx.TimeoutException:
        raise ApiError("upstream_timeout", "模型服务响应超时，请保留输入稍后手动重试。")
    except httpx.HTTPError:
        raise ApiError("service_unavailable", "模型服务暂时不可用，请稍后手动重试。")

    if response.status_code == 429:
        raise ApiError("rate_limited", "模型服务限流，请稍后手动重试。")
    if response.status_code in (401, 403):
        raise ApiError("service_not_configured", "模型服务凭据无效，请检查服务端配置。")
    if response.status_code >= 400:
        raise ApiError("service_unavailable", "模型服务暂时不可用，请稍后手动重试。")

    try:
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise ApiError("upstream_invalid", "模型服务返回了无效结构。")
    if not isinstance(content, str) or not content.strip():
        raise ApiError("upstream_invalid", "模型服务返回了无效结构。")
    return content


def parse_json(content: str) -> dict:
    text = content.strip()
    fence = _FENCE.search(text)
    if fence:
        text = fence.group(1).strip()
    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last <= first:
        raise ApiError("upstream_invalid", "模型服务未返回结构化结果。")
    try:
        result = json.loads(text[first : last + 1])
    except ValueError:
        raise ApiError("upstream_invalid", "模型服务返回了无法解析的结构化结果。")
    if not isinstance(result, dict):
        raise ApiError("upstream_invalid", "模型服务返回了无效结构。")
    return result


async def chat_json(messages: list[dict], temperature: float = 0.2, max_tokens: int = 4096) -> dict:
    return parse_json(await chat(messages, temperature, max_tokens))