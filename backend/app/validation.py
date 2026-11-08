"""输入限制与引文闭合校验（对应基线 §5/§6/§7）。"""
from __future__ import annotations

import re
from datetime import date

from .config import LIMITS, is_city_code
from .responses import ApiError
from .schemas import AnalyzeContractInput, DiagnoseDisputeInput, Excerpt

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def utf16_length(text: str) -> int:
    """按 JavaScript UTF-16 code unit 计量，与前端保持一致。"""
    return len(text.encode("utf-16-le")) // 2


def utf16_slice(text: str, start: int, end: int) -> str:
    """等价于 JavaScript text.slice(start, end)（UTF-16 code unit 下标）。"""
    return text.encode("utf-16-le")[start * 2 : end * 2].decode("utf-16-le")


def validate_date(value: str | None, field: str) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise ApiError("invalid_input", "日期格式应为 YYYY-MM-DD 或留空。", field)
    try:
        y, m, d = (int(p) for p in value.split("-"))
        date(y, m, d)
    except ValueError:
        raise ApiError("invalid_input", "日期不存在，请检查。", field)
    return value


def _validate_common(inp, text_field_limits: bool = True) -> None:
    if inp.apiVersion not in (None, "", "1"):
        raise ApiError("invalid_input", "当前仅支持一期接口。", "apiVersion")
    if not is_city_code(inp.cityCode):
        raise ApiError("invalid_input", "城市选项无效。", "cityCode")
    validate_date(inp.eventDate, "eventDate")


def validate_analyze_limits(inp: AnalyzeContractInput) -> None:
    _validate_common(inp)
    if not inp.text.strip():
        raise ApiError("invalid_input", "请先确认合同文本，再发起分析。", "text")
    if utf16_length(inp.text) > LIMITS["maxTextLength"]:
        raise ApiError("payload_too_large", f"文本超过 {LIMITS['maxTextLength']} 字符限制，请缩小材料或选择片段，不会被截断。", "text")
    if utf16_length(inp.question) > LIMITS["maxQuestionLength"]:
        raise ApiError("payload_too_large", f"问题超过 {LIMITS['maxQuestionLength']} 字符限制。", "question")
    if len(inp.conversation) > LIMITS["maxConversationTurns"]:
        raise ApiError("payload_too_large", f"会话超过 {LIMITS['maxConversationTurns']} 轮限制。", "conversation")
    for i, turn in enumerate(inp.conversation):
        if utf16_length(turn.content) > LIMITS["maxQuestionLength"] * 4:
            raise ApiError("payload_too_large", "会话内容过长。", f"conversation[{i}]")
    if inp.memory is not None:
        items = [inp.memory.summary, *inp.memory.facts, *inp.memory.decisions, *inp.memory.openQuestions]
        if sum(utf16_length(item) for item in items) > 4000:
            raise ApiError("payload_too_large", "会话记忆过长。", "memory")


def validate_dispute_limits(inp: DiagnoseDisputeInput) -> None:
    _validate_common(inp)
    if not inp.issue.strip():
        raise ApiError("invalid_input", "请描述争议事项。", "issue")
    if utf16_length(inp.issue) > LIMITS["maxQuestionLength"]:
        raise ApiError("payload_too_large", "争议描述过长。", "issue")
    if utf16_length(inp.facts) > LIMITS["maxFactsLength"]:
        raise ApiError("payload_too_large", f"事实补充超过 {LIMITS['maxFactsLength']} 字符限制。", "facts")
    if len(inp.selectedEvidence) > LIMITS["maxEvidenceSelected"]:
        raise ApiError("payload_too_large", f"最多选择 {LIMITS['maxEvidenceSelected']} 条证据。", "selectedEvidence")
    for i, ev in enumerate(inp.selectedEvidence):
        validate_date(ev.occurredAt, f"selectedEvidence[{i}].occurredAt")
        if utf16_length(ev.content) > 1200:
            raise ApiError("payload_too_large", "证据材料全文过长，请缩短后再带入争议。", f"selectedEvidence[{i}].content")
    total_content = sum(utf16_length(ev.content) for ev in inp.selectedEvidence)
    if total_content > 8000:
        raise ApiError("payload_too_large", "所选证据材料过多，请减少选择后再生成。", "selectedEvidence")


def close_excerpt(raw, full_text: str) -> Excerpt | None:
    """仅当 excerpt.text 与原文逐字一致时才作为合同直接引文。

    模型给出正确文本但错误下标时按精确子串重新定位；
    找不到（虚构/改写）则丢弃为 None，不作为已验证引文展示。
    """
    if raw is None:
        return None
    if isinstance(raw, Excerpt):
        data = {"text": raw.text, "start": raw.start, "end": raw.end}
    elif isinstance(raw, dict):
        data = raw
    else:
        return None
    text = data.get("text")
    if not isinstance(text, str) or not text:
        return None
    total = utf16_length(full_text)
    start, end = data.get("start"), data.get("end")
    if (
        isinstance(start, int) and isinstance(end, int)
        and 0 <= start < end <= total
        and utf16_slice(full_text, start, end) == text
    ):
        return Excerpt(text=text, start=start, end=end)
    idx = full_text.find(text)
    if idx == -1:
        return None
    start16 = utf16_length(full_text[:idx])
    return Excerpt(text=text, start=start16, end=start16 + utf16_length(text))