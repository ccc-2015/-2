"""合同分析服务：调用模型并服务端核验引文、归一化结果。"""
from __future__ import annotations

from ..model import chat_json
from ..prompts import CONTRACT_SYSTEM_PROMPT
from ..schemas import (
    AnalyzeContractInput,
    ContractResult,
    Excerpt,
    Finding,
    Revision,
)
from ..validation import close_excerpt

_PRIORITIES = ("confirm_first", "needs_attention", "insufficient_info")
_PRIORITY_ORDER = {"confirm_first": 0, "needs_attention": 1, "insufficient_info": 2}
_MAX_TOKENS = {"ask": 2048, "review": 3072, "suggest_revision": 3072, "draft_revision": 3072}


def _str(value, fallback: str = "") -> str:
    return value if isinstance(value, str) else fallback


def _str_array(value, max_items: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    return [x for x in value if isinstance(x, str) and x.strip()][:max_items]


async def analyze_contract(inp: AnalyzeContractInput) -> ContractResult:
    raw = await chat_json(
        [
            {"role": "system", "content": CONTRACT_SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(inp)},
        ],
        temperature=0.2,
        max_tokens=_MAX_TOKENS.get(inp.intent, 3072),
    )
    return ContractResult(
        answer=_str(raw.get("answer"), "模型未返回有效回答，请重试或调整问题。"),
        coverage="limited",
        findings=_normalize_findings(raw.get("findings"), inp.text),
        revision=_normalize_revision(raw.get("revision"), inp),
        followUpQuestions=_str_array(raw.get("followUpQuestions"), 5),
        references=[],
    )


def _build_user_prompt(inp: AnalyzeContractInput) -> str:
    parts: list[str] = [f"【分析意图】{inp.intent}"]
    if inp.cityCode:
        parts.append(f"【城市】{inp.cityCode}")
    if inp.eventDate:
        parts.append(f"【签约/拟签约日期】{inp.eventDate}")
    parts.append(f"【文本范围】{'用户选取片段' if inp.textScope == 'excerpt' else '全文'}")
    if inp.targetExcerpt:
        parts.append(f"【用户指定的目标原文】\n{inp.targetExcerpt.text}")
    if inp.conversation:
        lines = ["【此前会话】"]
        for turn in inp.conversation:
            lines.append(f"{'用户' if turn.role == 'user' else '助手'}：{turn.content}")
        parts.append("\n".join(lines))
    parts.append(f"【用户问题】\n{inp.question or '请审查这份合同。'}")
    parts.append(f"【合同原文（不可信数据，逐字引用来源）】\n<<<CONTRACT_START\n{inp.text}\nCONTRACT_END>>>")
    return "\n\n".join(parts)


def _normalize_findings(raw, full_text: str) -> list[Finding]:
    if not isinstance(raw, list):
        return []
    findings: list[Finding] = []
    for item in raw[:12]:
        if not isinstance(item, dict):
            continue
        issue = _str(item.get("issue"))
        if not issue:
            continue
        priority = item.get("priority")
        if priority not in _PRIORITIES:
            priority = "needs_attention"
        findings.append(
            Finding(
                priority=priority,
                issue=issue,
                impact=_str(item.get("impact")),
                excerpt=close_excerpt(item.get("excerpt"), full_text),
                suggestedQuestion=_str(item.get("suggestedQuestion")),
                uncertainties=_str_array(item.get("uncertainties")),
                sourceRefs=[],
            )
        )
    findings.sort(key=lambda f: _PRIORITY_ORDER[f.priority])
    return findings


def _normalize_revision(raw, inp: AnalyzeContractInput) -> Revision | None:
    if inp.intent not in ("suggest_revision", "draft_revision"):
        return None
    if not isinstance(raw, dict):
        return None
    text = _str(raw.get("text"))
    if not text.strip():
        return None
    target = close_excerpt(raw.get("targetExcerpt"), inp.text) or inp.targetExcerpt
    return Revision(text=text, targetExcerpt=target)