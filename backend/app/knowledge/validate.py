"""知识库资料包校验：上传前先跑一遍，避免启动时才发现结构错误。"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from pydantic import ValidationError

from ..config import is_city_code
from .models import KnowledgePack
from .store import DATA_DIR

_ALLOWED_SCENARIOS = {"contract_review", "dispute"}


def _check_date(value: str | None, field: str, errors: list[str]) -> None:
    if not value:
        return
    try:
        date.fromisoformat(value)
    except ValueError:
        errors.append(f"{field} 不是有效日期：{value}")


def validate_pack(path: Path) -> tuple[KnowledgePack | None, list[str]]:
    errors: list[str] = []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return None, [f"JSON 读取失败：{exc}"]
    try:
        pack = KnowledgePack(**raw)
    except ValidationError as exc:
        return None, [f"结构校验失败：{exc}"]

    if not is_city_code(pack.cityCode):
        errors.append(f"未知城市：{pack.cityCode}")
    if not pack.version.strip():
        errors.append("version 不能为空")
    _check_date(pack.checkedAt, "checkedAt", errors)
    for scenario, coverage in pack.topicCoverage.items():
        if scenario not in _ALLOWED_SCENARIOS:
            errors.append(f"topicCoverage 含未知场景：{scenario}")
        if coverage not in ("supported", "limited", "unsupported"):
            errors.append(f"topicCoverage[{scenario}] 覆盖状态无效：{coverage}")

    seen: set[str] = set()
    channel_ids: set[str] = set()
    for index, entry in enumerate(pack.entries):
        prefix = f"entries[{index}]"
        if entry.id in seen:
            errors.append(f"{prefix} id 重复：{entry.id}")
        seen.add(entry.id)
        if entry.cityCode not in (pack.cityCode, "CN"):
            errors.append(f"{prefix} cityCode 与资料包不一致：{entry.cityCode}")
        if not entry.text.strip():
            errors.append(f"{prefix} text 不能为空")
        if not entry.keywords:
            errors.append(f"{prefix} 至少需要一个 keywords")
        if not entry.topics:
            errors.append(f"{prefix} 至少需要一个 topics")
        if entry.reviewStatus == "approved" and not entry.url:
            errors.append(f"{prefix} approved 资料必须提供官方 url")
        if entry.url and not entry.url.startswith(("https://", "http://")):
            errors.append(f"{prefix} url 必须是 http(s) 地址")
        _check_date(entry.effectiveFrom, f"{prefix}.effectiveFrom", errors)
        _check_date(entry.effectiveTo, f"{prefix}.effectiveTo", errors)
        if entry.effectiveFrom and entry.effectiveTo and entry.effectiveFrom > entry.effectiveTo:
            errors.append(f"{prefix} effectiveFrom 晚于 effectiveTo")
        if entry.channel:
            channel = entry.channel
            if not channel.id.strip():
                errors.append(f"{prefix}.channel.id 不能为空")
            if channel.id in channel_ids:
                errors.append(f"{prefix}.channel.id 重复：{channel.id}")
            channel_ids.add(channel.id)
            if not channel.title.strip():
                errors.append(f"{prefix}.channel.title 不能为空")
            if not {"channel", "dispute"}.intersection(entry.topics):
                errors.append(f"{prefix} 渠道条目 topics 必须包含 channel 或 dispute")
            if channel.eligibility == "local_verified":
                if entry.reviewStatus != "approved":
                    errors.append(f"{prefix} local_verified 渠道必须为 approved")
                if not entry.url:
                    errors.append(f"{prefix} local_verified 渠道必须提供官方 url")
    return pack, errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="校验知识库资料包（JSON）")
    parser.add_argument("path", nargs="?", default=str(DATA_DIR), help="资料包文件或目录，默认 app/knowledge/data")
    args = parser.parse_args(argv)

    path = Path(args.path)
    files = sorted(path.glob("*.json")) if path.is_dir() else [path]
    if not files:
        print(f"没有找到资料文件：{path}")
        return 1

    all_ids: dict[str, str] = {}
    failed = False
    for file in files:
        pack, errors = validate_pack(file)
        if pack:
            print(
                f"{file.name}: {pack.cityCode} {pack.version} "
                f"coverage={pack.coverage} entries={len(pack.entries)}"
            )
            for entry in pack.entries:
                if entry.id in all_ids:
                    errors.append(f"条目 id 跨文件重复：{entry.id}（{all_ids[entry.id]} / {file.name}）")
                all_ids[entry.id] = file.name
        if errors:
            failed = True
            print(f"  FAIL {file.name}")
            for error in errors:
                print(f"    - {error}")
        else:
            print(f"  OK {file.name}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
