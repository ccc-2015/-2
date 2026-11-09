"""合同分析 SSE：阶段提示 + 正文增量 + 最终结构化结果。"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..model import chat_stream, parse_json
from ..responses import ApiError, new_request_id, success
from ..schemas import AnalyzeContractInput
from ..services.contract import (
    DATA_MARKER,
    analyze_contract,
    materialize,
    model_messages,
    prepare_sources,
)
from ..validation import validate_analyze_limits

router = APIRouter(prefix="/contract", tags=["contract"])
logger = logging.getLogger(__name__)


def _event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _error_event(exc: ApiError) -> str:
    return _event({"type": "error", "code": exc.code, "message": exc.message})


@router.post("/analyze")
async def analyze(inp: AnalyzeContractInput):
    validate_analyze_limits(inp)
    analysis = await analyze_contract(inp)
    return success(
        analysis.result,
        coverage=analysis.result.coverage,
        warnings=analysis.warnings,
        processing_mode=analysis.processing_mode,
        knowledge_version=analysis.knowledge_version,
    )


@router.post("/analyze/stream")
async def analyze_stream(inp: AnalyzeContractInput):
    """Server-Sent Events：先推真实阶段，再流式推回答，最后推结构化卡片。

    只推服务端确定的阶段（读取/检索/核对/生成），不转发模型内部推理。
    """
    validate_analyze_limits(inp)

    async def events():
        request_id = new_request_id()
        yield _event({"type": "stage", "stage": "reading", "requestId": request_id})
        try:
            # 检索是同步调用，放到线程里避免阻塞事件循环。
            sources = await asyncio.to_thread(prepare_sources, inp)
            yield _event(
                {
                    "type": "stage",
                    "stage": "retrieving",
                    "sources": len(sources),
                    "knowledgeVersion": None,
                }
            )

            answer_parts: list[str] = []
            buffer = ""
            seen_marker = False
            data_text = ""
            async for delta in chat_stream(
                model_messages(inp, sources),
                temperature=0.2,
                max_tokens=2400,
            ):
                buffer += delta
                if not seen_marker:
                    index = buffer.find(DATA_MARKER)
                    if index == -1:
                        # 保留可能是半个分隔符的尾部字符。
                        keep = len(DATA_MARKER) - 1
                        if len(buffer) > keep:
                            chunk, buffer = buffer[: len(buffer) - keep], buffer[len(buffer) - keep :]
                            if chunk:
                                answer_parts.append(chunk)
                                yield _event({"type": "delta", "text": chunk})
                        continue
                    head, data_text = buffer[:index], buffer[index + len(DATA_MARKER) :]
                    seen_marker = True
                    if head:
                        answer_parts.append(head)
                        yield _event({"type": "delta", "text": head})
                else:
                    data_text += delta

            if not data_text.strip() and not "".join(answer_parts).strip():
                raise ApiError("upstream_invalid", "模型服务未返回有效结果，请稍后手动重试。")
            streamed = "".join(answer_parts).strip()
            raw = parse_json(data_text) if data_text.strip() else {
                "findings": [],
                "revision": None,
                "followUpQuestions": [],
            }
            # 正文以流式内容为准；模型若仍把正文写进 answer，则保留更完整的那一份。
            model_answer = raw.get("answer") if isinstance(raw.get("answer"), str) else ""
            if streamed and len(streamed) >= len(model_answer.strip()):
                raw["answer"] = streamed
            elif streamed and not model_answer.strip():
                raw["answer"] = streamed
            analysis = materialize(inp, sources, raw)
            payload = {
                "type": "result",
                "data": analysis.result.model_dump(),
                "meta": {
                    "apiVersion": "1",
                    "requestId": request_id,
                    "generatedAt": None,
                    "processingMode": analysis.processing_mode,
                    "coverage": analysis.result.coverage,
                    "knowledgeVersion": analysis.knowledge_version,
                    "warnings": analysis.warnings,
                },
            }
            yield _event(payload)
        except ApiError as exc:
            yield _error_event(exc)
        except Exception as exc:  # 流已开始，只能通过事件报告错误
            logger.warning("contract stream failed: %s", type(exc).__name__)
            yield _event({"type": "error", "code": "internal_error", "message": "分析未完成，请稍后手动重试。"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
