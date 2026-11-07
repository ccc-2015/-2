"""争议处理服务：一般方向候选与所选方向话术。"""
from __future__ import annotations

from ..model import chat_json
from ..prompts import DISPUTE_SYSTEM_PROMPT
from ..schemas import (
    DiagnoseDisputeInput,
    DisputeResult,
    DisputeScript,
    Recommendation,
)

GENERAL_CHANNELS = [
    {"id": "negotiate", "title": "与对方直接协商沟通"},
    {"id": "written_notice", "title": "发送书面通知 / 催告并留存记录"},
    {"id": "consult_authority", "title": "向主管部门或专业机构咨询当地渠道（待核实）"},
    {"id": "prepare_evidence", "title": "整理证据材料，准备后续处理"},
]
_CHANNEL_IDS = {c["id"] for c in GENERAL_CHANNELS}
_CHANNEL_TITLES = {c["id"]: c["title"] for c in GENERAL_CHANNELS}


def _str(value, fallback: str = "") -> str:
    return value if isinstance(value, str) else fallback


def _str_array(value, max_items: int = 12) -> list[str]:
    if not isinstance(value, list):
        return []
    return [x for x in value if isinstance(x, str) and x.strip()][:max_items]


async def diagnose_dispute(inp: DiagnoseDisputeInput) -> DisputeResult:
    raw = await chat_json(
        [
            {"role": "system", "content": DISPUTE_SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(inp)},
        ],
        temperature=0.2,
        max_tokens=2048,
    )
    return DisputeResult(
        factsSummary=_str_array(raw.get("factsSummary")),
        missingFacts=_str_array(raw.get("missingFacts")),
        recommendations=_normalize_recommendations(raw.get("recommendations")),
        script=_normalize_script(raw.get("script")) if inp.selectedChannelId else None,
    )


def _build_user_prompt(inp: DiagnoseDisputeInput) -> str:
    amount = "未知（待补，不等于零）" if inp.amountCents is None else f"{inp.amountCents} 分"
    parts = [
        f"【争议事项】{inp.issue}",
        f"【对方身份】{inp.counterparty or '未知（待补）'}",
        f"【用户目标】{inp.goal or '未知（待补）'}",
        f"【金额】{amount}",
        f"【补充事实】{inp.facts or '无'}",
        f"【已采取的行动】{inp.priorAction or '无'}",
        f"【已选方向】{inp.selectedChannelId or '尚未选定（仅返回候选，script 须为 null）'}",
    ]
    if inp.cityCode:
        parts.insert(1, f"【城市】{inp.cityCode}")
    if inp.eventDate:
        parts.insert(2, f"【事件日期】{inp.eventDate}")
    if inp.selectedEvidence:
        lines = ["【用户选择的相关证据（用户陈述，未验证真实性）】"]
        for ev in inp.selectedEvidence:
            lines.append(f"- {ev.occurredAt or '时间未知'}｜状态:{ev.status}｜{ev.description}")
        parts.append("\n".join(lines))
    else:
        parts.append("【相关证据】用户尚未选择证据。")
    return "\n\n".join(parts)


def _normalize_recommendations(raw) -> list[Recommendation]:
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    result: list[Recommendation] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        channel_id = _str(item.get("channelId"))
        if channel_id not in _CHANNEL_IDS or channel_id in seen:
            continue
        seen.add(channel_id)
        result.append(
            Recommendation(
                channelId=channel_id,
                title=_str(item.get("title"), _CHANNEL_TITLES[channel_id]),
                eligibility="general_only",
                reason=_str(item.get("reason")),
                preparations=_str_array(item.get("preparations")),
                sourceRefs=[],
            )
        )
        if len(result) >= 4:
            break
    return result


def _normalize_script(raw) -> DisputeScript | None:
    if not isinstance(raw, dict):
        return None
    text = _str(raw.get("text"))
    if not text.strip():
        return None
    return DisputeScript(text=text, placeholders=_str_array(raw.get("placeholders"), 20))