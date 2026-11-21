"""知识库加载、过滤与检索。

一期只做关键词匹配，不引入向量检索；资料是否可用先由审核状态、
城市、生效日期和主题过滤，再按关键词命中排序。数据文件放在
knowledge/data/<city>.json，缺少城市包时回退到全国性资料。
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
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
        "sublease",
        "rent_increase",
        "brokerage",
        "filing",
        "transfer",
        "identity",
    },
    "dispute": {"dispute", "channel", "deposit", "repair", "termination", "rent", "return", "brokerage", "filing", "safety", "transfer"},
}


def today_iso() -> str:
    """与 Edge 端一致，按 UTC 日期确定未提供事件日期时的审查日期。"""
    return datetime.now(timezone.utc).date().isoformat()


def ensure_local_slot(
    ranked: list[KnowledgeEntry],
    pool: list[KnowledgeEntry],
    top_k: int,
) -> list[KnowledgeEntry]:
    """城市已选且本地有相关资料时，把最相关的本地条文放到召回首位。

    全国条文关键词更通用，容易把城市/省级条目挤出前几名；这里不改动其余条目的
    相对顺序，只在本地条文未进前几名时补入并让出最后一席。
    """
    if top_k <= 0 or not ranked:
        return ranked[:top_k]
    # 同一城市同时有市级与省级资料时优先市级，市级条文通常更具体。
    local = next((entry for entry in pool if entry.scope == "city"), None) or next(
        (entry for entry in pool if entry.scope == "province"), None
    )
    if local is None:
        return ranked[:top_k]
    if ranked[0].id == local.id:
        return ranked[:top_k]
    rest = [entry for entry in ranked if entry.id != local.id]
    return [local, *rest[: top_k - 1]]


class RetrievalResults(list):
    """兼容 list 的单次检索结果，模式不存储在全局 store 上。"""

    def __init__(self, entries=(), *, mode: str = "keyword") -> None:
        super().__init__(entries)
        self.mode = mode


# 条文规范对象与查询语境的最低匹配；仅使用条文显式用语，不按 ID 硬编码。
SCOPE_PROFILES: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (("网络平台经营者",), ("平台", "网络", "信息发布")),
    (("从业人员名单", "从业人员不得"), ("从业人员", "人员备案")),
    (("自有资金", "管理能力", "经营规模"), ("能力", "资金", "条件", "资质", "规模")),
    (("日计算租金", "小时、日计算", "按日计算"), ("日租", "小时租", "按日", "按小时")),
    (("床位达到", "集中供他人居住"), ("床位", "集中", "群租", "10间")),
    (("危险房屋", "安全鉴定"), ("危险", "安全鉴定")),
    (("登记备案内容发生变化", "变更、延续或者注销"), ("备案", "登记", "变更", "注销")),
    (("住房租赁档案", "非法收集、使用、加工、传输"), ("档案", "个人信息", "信息")),
    (("住房租金监测机制", "定期公布"), ("监测", "公布", "租金水平", "市场租金")),
    (("依照有关法律、法规、规章的规定处罚", "行政处罚"), ("处罚", "罚款", "行政责任")),
    (("协商解决", "申请调解", "申请仲裁", "提起诉讼"), ("协商", "调解", "仲裁", "诉讼", "纠纷", "投诉")),
)
DISPUTE_SIGNALS = SCOPE_PROFILES[-1][0]


def keyword_weight(keyword: str, document_frequency: int, total: int, grounded: bool) -> float:
    """关键词按稀有度加权；仅存在于元数据、正文不支持的词减半。"""
    weight = max(2, len(keyword)) * (1 + math.log((total + 1) / (document_frequency + 1)))
    return weight * (2 if grounded else 0.5)


def context_compatible(entry: KnowledgeEntry, query: str, scenario: str | None) -> bool:
    """按条文规范对象过滤与查询语境不符的来源，避免仅靠共用关键词误召回。

    这是检索侧的语境约束，不改动条目关键词/主题等向量输入。
    """
    text = entry.text
    q = (query or "").lower()
    for signals, allowed in SCOPE_PROFILES:
        if not any(signal in text for signal in signals):
            continue
        if scenario == "dispute" and signals == DISPUTE_SIGNALS:
            continue
        if not any(term.lower() in q for term in allowed):
            return False
    if "出租人依法解除" in text or "迫使承租人解除" in text:
        tenant_context = any(term in q for term in ("承租人", "乙方", "提前退租", "押金"))
        owner_context = any(term in q for term in (
            "通知承租人", "解除通知", "出租人解除", "甲方解除", "出租人有权解除", "甲方有权解除",
        ))
        if tenant_context and not owner_context:
            return False
    return True


class KnowledgeStore:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = data_dir or DATA_DIR
        self.packs: dict[str, KnowledgePack] = {}
        self.entries: list[KnowledgeEntry] = []
        self._digests: dict[str, str] = {}
        self._keyword_stats_cache: tuple[dict[str, int], int] | None = None
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
            canonical = json.dumps(raw, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            self._digests[pack.cityCode] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
            self.entries.extend(pack.entries)
        self.entries.sort(key=lambda entry: entry.id)

    @property
    def available(self) -> bool:
        return any(entry.reviewStatus == "approved" for entry in self.entries)

    def pack_for(self, city_code: str | None) -> KnowledgePack | None:
        return self.packs.get(city_code) if city_code else None

    def _national_pack(self) -> KnowledgePack | None:
        """无该城市包时，回退到提供全国资料的那个包（版本与覆盖按其声明）。"""
        return next(
            (pack for pack in self.packs.values() if any(entry.scope == "national" for entry in pack.entries)),
            None,
        )

    def version_for(self, city_code: str | None) -> str | None:
        pack = self.pack_for(city_code) or self._national_pack()
        return pack.version if pack else None

    @property
    def retrieval_mode(self) -> str:
        return "keyword"

    def snapshot_for(self, city_code: str | None) -> str | None:
        """运行时实际加载的资料版本与内容摘要，用于追溯本次检索所用的快照。"""
        participating = [
            pack for pack in self.packs.values()
            if any(
                entry.scope == "national" or (
                    entry.scope in ("city", "province") and bool(city_code) and entry.cityCode == city_code
                )
                for entry in pack.entries
            )
        ]
        return " | ".join(
            f"{pack.cityCode}:{pack.version} · {self._digests[pack.cityCode][:12]}"
            for pack in sorted(participating, key=lambda pack: pack.cityCode)
        ) or None

    def retrieve_groups(
        self,
        city_code: str | None,
        event_date: str | None,
        queries: list[str],
        top_k: int = 5,
        scenario: str | None = None,
        subject: str | None = None,
    ) -> list[list[KnowledgeEntry]]:
        """按议题分别召回；JSON 后端逐组关键词检索，调用方负责合并与预算。"""
        return RetrievalResults(
            self.retrieve(city_code, event_date, query, top_k=top_k, scenario=scenario, subject=subject)
            for query in queries
        )

    def coverage_for(self, city_code: str | None, scenario: str | None = None) -> str:
        entries = self.list_sources(city_code, scenario=scenario)
        if not entries:
            return "unsupported"
        pack = self.pack_for(city_code)
        if pack:
            return pack.topicCoverage.get(scenario or "", pack.coverage)
        return "limited"

    def _keyword_stats(self) -> tuple[dict[str, int], int]:
        if self._keyword_stats_cache is None:
            document_frequency: dict[str, int] = {}
            for entry in self.entries:
                for keyword in {item.lower() for item in entry.keywords if item}:
                    document_frequency[keyword] = document_frequency.get(keyword, 0) + 1
            self._keyword_stats_cache = (document_frequency, len(self.entries))
        return self._keyword_stats_cache

    def _applicable(self, city_code: str | None, event_date: str | None) -> list[KnowledgeEntry]:
        effective_on = event_date or today_iso()
        result: list[KnowledgeEntry] = []
        for entry in self.entries:
            applies_regionally = entry.scope == "national" or (
                entry.scope in ("city", "province") and bool(city_code) and entry.cityCode == city_code
            )
            if not applies_regionally or entry.reviewStatus != "approved":
                continue
            if entry.effectiveFrom and effective_on < entry.effectiveFrom:
                continue
            if entry.effectiveTo and effective_on > entry.effectiveTo:
                continue
            # 现行正文可能晚于施行日；历史事件不得倒用修正后文本。
            if entry.textAvailableFrom and effective_on < entry.textAvailableFrom:
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
        subject: str | None = None,
    ) -> list[KnowledgeEntry]:
        if top_k <= 0:
            return RetrievalResults()
        q = (query or "").lower()
        entries = self._applicable(city_code, event_date)
        if subject == "private":
            entries = [entry for entry in entries if entry.appliesTo != "enterprise"]
        topics = SCENARIO_TOPICS.get(scenario or "")
        if topics:
            entries = [entry for entry in entries if topics.intersection(entry.topics)]
        entries = [entry for entry in entries if context_compatible(entry, q, scenario)]
        document_frequency, total = self._keyword_stats()
        scored: list[tuple[float, str, KnowledgeEntry]] = []
        for entry in entries:
            score = 0.0
            text = entry.text.lower()
            title = entry.title.lower()
            for keyword in entry.keywords:
                key = (keyword or "").lower()
                if key and key in q:
                    score += keyword_weight(keyword, document_frequency.get(key, 1), total, key in text or key in title)
            for topic in entry.topics:
                if topic.lower() in q:
                    score += 1
            if score > 0:
                scored.append((score, entry.id, entry))
        scored.sort(key=lambda item: (-item[0], item[1]))
        ranked = [entry for _, _, entry in scored[:top_k]]
        return RetrievalResults(ensure_local_slot(ranked, [entry for _, _, entry in scored], top_k))


knowledge_store = KnowledgeStore()
