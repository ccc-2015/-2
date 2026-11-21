"""给审核资料补最小的 docType / appliesTo 结构化字段。

规则保守：标题/正文明确指向企业或经纪机构的才限定主体，其余标为 all。
字段不进入 embedding 输入；补缺失字段并修正已逐条审查的 all 误标，保留其他人工限定。
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "backend" / "app" / "knowledge" / "data"

GUIDE_HINTS = ("指南", "指引", "办事", "流程图", "一问一答", "手册")
POLICY_HINTS = ("通知", "意见", "方案", "公告", "工作要点")
REGULATION_HINTS = ("条例", "规定", "办法", "法典", "法", "决定", "细则", "解释")

# 只收录全文义务主体明确的条目。混合个人/企业条款（如 wh-14、zz-12/16）、
# 仅提及物业/危化企业的普通出租人法规及通用投诉渠道不在此表。
REVIEWED_SUBJECTS = {
    **{f"cn-housing-lease-reg-{n}": "enterprise" for n in (15, 16, 17, 19, 43)},
    **{f"wh-rent-reg-{n}": "enterprise" for n in (20, 21, 22, 23)},
    **{f"zz-rent-reg-{n}": "enterprise" for n in (17, 24, 25, 33)},
    **{f"cn-housing-lease-reg-{n}": "intermediary" for n in (21, 22, 23, 24, 25, 26, 27, 45)},
    **{f"wh-rent-reg-{n}": "intermediary" for n in (28, 29)},
    "hz-rent-security-23": "intermediary",
    "zz-rent-reg-26": "intermediary",
    "zz-fund-supervision-2025": "enterprise",
}


def doc_type(entry: dict) -> str:
    title = entry.get("title", "")
    if entry.get("channel"):
        return "guide"
    if any(hint in title for hint in GUIDE_HINTS):
        return "guide"
    if any(hint in title for hint in POLICY_HINTS):
        return "policy"
    if any(hint in title for hint in REGULATION_HINTS):
        return "regulation"
    return "policy"


def applies_to(entry: dict) -> str:
    reviewed = REVIEWED_SUBJECTS.get(entry.get("id", ""))
    if reviewed:
        return reviewed
    title = entry.get("title", "")
    text = entry.get("text", "").strip()
    if "经纪" in title or "中介" in title:
        return "intermediary"
    # 不再仅 policy 判企业，也不能因为正文提及企业就限制全文主体。
    body = re.sub(r"^第[一二三四五六七八九十百零〇0-9]+条\s*", "", text)
    mixed = any(hint in body for hint in (
        "经纪机构", "个人转租", "自然人", "出租人应当", "出租人或者承租人", "房屋所有权人或者使用权人",
    ))
    if not mixed and re.match(r"^(?:从事转租经营的)?住房租赁企业", body):
        return "enterprise"
    return "all"


def main() -> int:
    doc_counts = Counter()
    applies_counts = Counter()
    scoped = []
    for path in sorted(DATA_DIR.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        changed = 0
        for entry in raw.get("entries", []):
            if "docType" not in entry:
                entry["docType"] = doc_type(entry)
                changed += 1
            if "appliesTo" not in entry or (
                entry["appliesTo"] == "all" and entry.get("id") in REVIEWED_SUBJECTS
            ):
                entry["appliesTo"] = applies_to(entry)
                changed += 1
            doc_counts[entry["docType"]] += 1
            applies_counts[entry["appliesTo"]] += 1
            if entry["appliesTo"] != "all":
                scoped.append((entry["id"], entry["appliesTo"], entry["title"]))
        if changed:
            path.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"{path.name}: 补 {changed} 个字段")
    print("docType:", dict(doc_counts))
    print("appliesTo:", dict(applies_counts))
    print("限定主体条目：")
    for source_id, scope, title in scoped:
        print(f"  {source_id} {scope} {title}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())