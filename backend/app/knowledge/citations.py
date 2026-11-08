"""审核资料来源编号映射：模型只返回 S1/S2 或来源 id，服务端负责收敛。"""
from __future__ import annotations

from .models import KnowledgeEntry


def resolve_source_id(value, source_map: dict[str, KnowledgeEntry]) -> str | None:
    if not isinstance(value, str):
        return None
    key = value.strip().upper()
    entry = source_map.get(key)
    if entry:
        return entry.id
    raw = value.strip()
    for candidate in source_map.values():
        if candidate.id == raw:
            return candidate.id
    return None


def map_source_refs(raw, source_map: dict[str, KnowledgeEntry]) -> list[str]:
    if not isinstance(raw, list):
        return []
    ids: list[str] = []
    for value in raw:
        source_id = resolve_source_id(value, source_map)
        if source_id and source_id not in ids:
            ids.append(source_id)
    return ids


def collect_cited_ids(
    raw,
    source_map: dict[str, KnowledgeEntry],
    nested_keys: tuple[str, ...] = ("findings",),
) -> list[str]:
    if not isinstance(raw, dict):
        return []
    ids: list[str] = []

    def add(values) -> None:
        for source_id in map_source_refs(values, source_map):
            if source_id not in ids:
                ids.append(source_id)

    add(raw.get("sourceRefs"))
    for key in nested_keys:
        items = raw.get(key)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                add(item.get("sourceRefs"))
    return ids
