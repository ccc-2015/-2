"""知识库加载、过滤与检索。

一期只做关键词匹配，不引入向量检索；资料是否可用先由审核状态、
城市、生效日期和主题过滤，再按关键词命中排序。数据文件放在
knowledge/data/<city>.json，缺少城市包时回退到全国性资料。
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from .models import KnowledgeEntry, KnowledgePack

DATA_DIR = Path(__file__).resolve().parent / "data"

SCENARIO_TOPICS = {
    "contract_review": {
        "contract",
        "rent",
        "repair",
        "wear",
        "return",
        "termination",
        "renewal",
        "priority",
        "deposit",
        "alteration",
        "restoration",
        "safety",
    },
    "dispute": {"dispute", "channel"},
}


class KnowledgeStore:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = data_dir or DATA_DIR
        self.packs: dict[str, KnowledgePack] = {}
        self.entries: list[KnowledgeEntry] = []
        self._load()

    def _load(self) -> None:
        if not self.data_dir.exists():
            return
        for path in sorted(self.data_dir.glob("*.json")):
            try:
                raw = json.loads(path.read_text("utf-8"))
                pack = KnowledgePack(**raw)
            except Exception as exc:  # 数据文件错误应在启动时暴露，而不是静默降级
                raise RuntimeError(f"知识库文件无效：{path.name}: {exc}") from exc
            if pack.cityCode in self.packs:
                raise RuntimeError(f"知识库城市重复：{pack.cityCode}")
            self.packs[pack.cityCode] = pack
            self.entries.extend(pack.entries)
        self.entries.sort(key=lambda entry: entry.id)

    @property
    def available(self) -> bool:
        return any(entry.reviewStatus == "approved" for entry in self.entries)

    def pack_for(self, city_code: str | None) -> KnowledgePack | None:
        return self.packs.get(city_code) if city_code else None

    def version_for(self, city_code: str | None) -> str | None:
        pack = self.pack_for(city_code)
        return pack.version if pack else None

    def coverage_for(self, city_code: str | None, scenario: str | None = None) -> str:
        pack = self.pack_for(city_code)
        if not pack:
            return "unsupported"
        if scenario and scenario in pack.topicCoverage:
            return pack.topicCoverage[scenario]
        return pack.coverage

    def _applicable(self, city_code: str | None, event_date: str | None) -> list[KnowledgeEntry]:
        pack = self.pack_for(city_code)
        if not pack:
            return []
        effective_on = event_date or date.today().isoformat()
        result: list[KnowledgeEntry] = []
        for entry in pack.entries:
            if entry.reviewStatus != "approved":
                continue
            if entry.effectiveFrom and effective_on < entry.effectiveFrom:
                continue
            if entry.effectiveTo and effective_on > entry.effectiveTo:
                continue
            result.append(entry)
        return result

    def list_sources(
        self,
        city_code: str | None,
        event_date: str | None = None,
        scenario: str | None = None,
    ) -> list[KnowledgeEntry]:
        entries = self._applicable(city_code, event_date)
        topics = SCENARIO_TOPICS.get(scenario or "")
        if topics:
            entries = [entry for entry in entries if topics.intersection(entry.topics)]
        return entries

    def retrieve(
        self,
        city_code: str | None,
        event_date: str | None,
        query: str,
        top_k: int = 4,
        scenario: str | None = None,
    ) -> list[KnowledgeEntry]:
        q = (query or "").lower()
        entries = self._applicable(city_code, event_date)
        topics = SCENARIO_TOPICS.get(scenario or "")
        if topics:
            entries = [entry for entry in entries if topics.intersection(entry.topics)]
        scored: list[tuple[int, str, KnowledgeEntry]] = []
        for entry in entries:
            score = 0
            for keyword in entry.keywords:
                if keyword and keyword.lower() in q:
                    score += max(2, len(keyword))
            for topic in entry.topics:
                if topic.lower() in q:
                    score += 1
            if score > 0:
                scored.append((score, entry.id, entry))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [entry for _, _, entry in scored[:top_k]]


knowledge_store = KnowledgeStore()
