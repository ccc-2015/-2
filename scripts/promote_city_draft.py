"""把人工确认过的 draft 提升为正式城市包（reviewStatus=approved）。

用法（在仓库根目录）：
    backend/.venv/Scripts/python.exe scripts/promote_city_draft.py wh
    backend/.venv/Scripts/python.exe scripts/promote_city_draft.py hz

draft 位于 sources/drafts/<city>.json，产物写入 backend/app/knowledge/data/<city>.json，
随后需运行 validate 与 ingest。
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "backend" / "app" / "knowledge" / "sources"
DATA = ROOT / "backend" / "app" / "knowledge" / "data"


def main(argv: list[str]) -> int:
    city = (argv[1] if len(argv) > 1 else "").lower()
    draft_path = SOURCES / "drafts" / f"{city}.json"
    if not draft_path.exists():
        print(f"没有 draft：{draft_path}")
        return 1
    pack = json.loads(draft_path.read_text(encoding="utf-8"))
    entries = []
    for entry in pack["entries"]:
        entry["reviewStatus"] = "approved"
        entries.append(entry)
    if not entries:
        print("draft 为空，拒绝生成正式包。")
        return 1
    pack["entries"] = entries
    pack["version"] = f"{city}-{date.today().isoformat().replace('-', '.')}.1"
    pack["coverage"] = "supported"
    pack["topicCoverage"] = {"contract_review": "supported", "dispute": "limited"}
    out = DATA / f"{city}.json"
    out.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{out}：{pack['cityCode']} {pack['version']} {len(entries)} 条")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
