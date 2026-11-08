"""PostgreSQL + pgvector 知识库存储。

JSON 资料包仍是审核/版本发布的权威源；本模块把资料同步到 PG 并建立
向量索引。检索优先用 pgvector 余弦相似度，embedding 不可用时回退关键词。
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from ..config import get_settings
from .embeddings import embed_query, embed_texts
from .rerank import rerank as rerank_api
from .models import ChannelProfile, KnowledgeEntry, KnowledgePack
from .store import SCENARIO_TOPICS

logger = logging.getLogger(__name__)

_ENTRY_COLUMNS = """
id, pack_city, title, publisher, url, scope, city_code,
effective_from, effective_to, version, checked_at, review_status,
topics, keywords, text, summary, limitations, channel
"""


class PostgresKnowledgeStore:
    def __init__(self, database_url: str) -> None:
        if not database_url.strip():
            raise RuntimeError("KNOWLEDGE_BACKEND=postgres 但未配置 DATABASE_URL")
        settings = get_settings()
        self.embedding_dim = settings.embedding_dim
        self.embedding_min_score = settings.embedding_min_score
        self.embedding_model = settings.embedding_configured_name
        self.pool = ConnectionPool(database_url, min_size=1, max_size=4, open=True, timeout=8)
        self.ensure_schema()

    def ensure_schema(self) -> None:
        dim = int(self.embedding_dim)
        with self.pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS knowledge_packs (
                        city_code TEXT PRIMARY KEY,
                        city_name TEXT NOT NULL,
                        version TEXT NOT NULL,
                        coverage TEXT NOT NULL,
                        topic_coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
                        checked_at DATE NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                cur.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS knowledge_entries (
                        id TEXT PRIMARY KEY,
                        pack_city TEXT NOT NULL REFERENCES knowledge_packs(city_code) ON DELETE CASCADE,
                        title TEXT NOT NULL,
                        publisher TEXT NOT NULL,
                        url TEXT,
                        scope TEXT NOT NULL,
                        city_code TEXT,
                        effective_from DATE,
                        effective_to DATE,
                        version TEXT NOT NULL,
                        checked_at DATE NOT NULL,
                        review_status TEXT NOT NULL,
                        topics TEXT[] NOT NULL DEFAULT '{{}}',
                        keywords TEXT[] NOT NULL DEFAULT '{{}}',
                        text TEXT NOT NULL,
                        summary TEXT NOT NULL DEFAULT '',
                        limitations TEXT NOT NULL DEFAULT '',
                        channel JSONB,
                        embedding vector({dim}),
                        embedding_model TEXT,
                        embedding_updated_at TIMESTAMPTZ,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS knowledge_entries_pack_review "
                    "ON knowledge_entries (pack_city, review_status)"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS knowledge_entries_topics "
                    "ON knowledge_entries USING GIN (topics)"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS knowledge_entries_keywords "
                    "ON knowledge_entries USING GIN (keywords)"
                )
                # pgvector 的 HNSW/IVFFlat 都限制 2000 维；超高维模型只能精确顺序扫描。
                if dim <= 2000:
                    cur.execute(
                        "CREATE INDEX IF NOT EXISTS knowledge_entries_embedding_hnsw "
                        "ON knowledge_entries USING hnsw (embedding vector_cosine_ops) "
                        "WHERE embedding IS NOT NULL"
                    )
            conn.commit()

    def _fetchall(self, sql: str, params=()) -> list[dict]:
        with self.pool.connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(sql, params)
                return cur.fetchall()

    def _fetchone(self, sql: str, params=()) -> dict | None:
        rows = self._fetchall(sql, params)
        return rows[0] if rows else None

    @property
    def available(self) -> bool:
        row = self._fetchone(
            "SELECT EXISTS(SELECT 1 FROM knowledge_entries WHERE review_status = 'approved') AS ok"
        )
        return bool(row and row["ok"])

    def pack_for(self, city_code: str | None) -> KnowledgePack | None:
        if not city_code:
            return None
        row = self._fetchone(
            """
            SELECT city_code, city_name, version, coverage, topic_coverage, checked_at
            FROM knowledge_packs WHERE city_code = %s
            """,
            (city_code,),
        )
        if not row:
            return None
        return KnowledgePack(
            cityCode=row["city_code"],
            cityName=row["city_name"],
            version=row["version"],
            coverage=row["coverage"],
            topicCoverage=row["topic_coverage"] or {},
            checkedAt=row["checked_at"].isoformat(),
            entries=[],
        )

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

    def _filters(self, city_code: str, event_date: str | None, scenario: str | None) -> tuple[str, list]:
        effective_on = event_date or date.today().isoformat()
        clauses = [
            "pack_city = %s",
            "review_status = 'approved'",
            "(effective_from IS NULL OR effective_from <= %s)",
            "(effective_to IS NULL OR effective_to >= %s)",
        ]
        params: list = [city_code, effective_on, effective_on]
        topics = SCENARIO_TOPICS.get(scenario or "")
        if topics:
            clauses.append("topics && %s::text[]")
            params.append(sorted(topics))
        return " AND ".join(clauses), params

    def _entry_from_row(self, row: dict) -> KnowledgeEntry:
        channel = row.get("channel")
        return KnowledgeEntry(
            id=row["id"],
            title=row["title"],
            publisher=row["publisher"],
            url=row["url"],
            scope=row["scope"],
            cityCode=row["city_code"],
            effectiveFrom=row["effective_from"].isoformat() if row["effective_from"] else None,
            effectiveTo=row["effective_to"].isoformat() if row["effective_to"] else None,
            version=row["version"],
            checkedAt=row["checked_at"].isoformat(),
            reviewStatus=row["review_status"],
            topics=row["topics"] or [],
            keywords=row["keywords"] or [],
            text=row["text"],
            summary=row["summary"] or "",
            limitations=row["limitations"] or "",
            channel=ChannelProfile(**channel) if channel else None,
        )

    def list_sources(
        self,
        city_code: str | None,
        event_date: str | None = None,
        scenario: str | None = None,
    ) -> list[KnowledgeEntry]:
        if not city_code:
            return []
        where, params = self._filters(city_code, event_date, scenario)
        rows = self._fetchall(
            f"SELECT {_ENTRY_COLUMNS} FROM knowledge_entries WHERE {where} ORDER BY id",
            params,
        )
        return [self._entry_from_row(row) for row in rows]

    def _applicable_rows(
        self,
        city_code: str,
        event_date: str | None,
        scenario: str | None,
    ) -> list[dict]:
        where, params = self._filters(city_code, event_date, scenario)
        return self._fetchall(
            f"SELECT {_ENTRY_COLUMNS} FROM knowledge_entries WHERE {where} ORDER BY id",
            params,
        )

    def _vector_rows(
        self,
        city_code: str,
        event_date: str | None,
        scenario: str | None,
        vector: list[float],
        top_k: int,
    ) -> list[tuple[dict, float]]:
        where, params = self._filters(city_code, event_date, scenario)
        vector_literal = "[" + ",".join(f"{value:.8f}" for value in vector) + "]"
        sql = f"""
            SELECT {_ENTRY_COLUMNS}, 1 - (embedding <=> %s::vector) AS similarity
            FROM knowledge_entries
            WHERE {where}
              AND embedding IS NOT NULL
              AND 1 - (embedding <=> %s::vector) >= %s
            ORDER BY embedding <=> %s::vector
            LIMIT %s
        """
        rows = self._fetchall(
            sql,
            [vector_literal, *params, vector_literal, self.embedding_min_score, vector_literal, top_k],
        )
        return [(row, float(row.get("similarity") or 0.0)) for row in rows]

    def _keyword_rank(self, rows: list[dict], query: str, top_k: int) -> list[KnowledgeEntry]:
        return [entry for _, entry in self._keyword_scored(rows, query)[:top_k]]

    @staticmethod
    def _keyword_score(row: dict, q: str) -> int:
        score = 0
        for keyword in row["keywords"] or []:
            if keyword and keyword.lower() in q:
                score += max(2, len(keyword))
        for topic in row["topics"] or []:
            if topic.lower() in q:
                score += 1
        return score

    def _keyword_scored(self, rows: list[dict], query: str) -> list[tuple[int, KnowledgeEntry]]:
        q = (query or "").lower()
        scored: list[tuple[int, str, KnowledgeEntry]] = []
        for row in rows:
            score = self._keyword_score(row, q)
            if score > 0:
                scored.append((score, row["id"], self._entry_from_row(row)))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [(score, entry) for score, _, entry in scored]

    def retrieve(
        self,
        city_code: str | None,
        event_date: str | None,
        query: str,
        top_k: int = 4,
        scenario: str | None = None,
    ) -> list[KnowledgeEntry]:
        if not city_code:
            return []
        candidates, _ = self._rank_candidates(city_code, event_date, query, scenario, top_k)
        if not candidates:
            return []
        ranked = self._rerank(query, candidates, top_k)
        if ranked is None:
            ranked = candidates[:top_k]
        return [entry for _, entry in ranked]

    def _rank_candidates(
        self,
        city_code: str,
        event_date: str | None,
        query: str,
        scenario: str | None,
        top_k: int,
    ) -> tuple[list[tuple[float, KnowledgeEntry]], bool]:
        """粗排：向量候选 ∪ 关键词候选，再按融合分排序。

        只取向量的前 N 条会漏掉「关键词精确命中但向量分一般」的条文
        （如单方涨租、中介收费），因此两路都取，按 id 去重后再融合。
        """
        settings = get_settings()
        window = max(top_k, settings.rerank_candidates) if settings.rerank_configured else top_k
        vector_pairs: list[tuple[dict, float]] = []
        if query.strip() and settings.embedding_configured:
            try:
                vector = embed_query(query)
                if vector:
                    vector_pairs = self._vector_rows(city_code, event_date, scenario, vector, window)
            except Exception as exc:  # 语义检索失败不应阻断关键词回退
                logger.warning("semantic retrieval fallback: %s", type(exc).__name__)

        candidates: dict[str, tuple[float, KnowledgeEntry]] = {}
        for row, similarity in vector_pairs:
            entry = self._entry_from_row(row)
            candidates[entry.id] = (similarity, entry)

        rows = self._applicable_rows(city_code, event_date, scenario)
        for _, entry in self._keyword_scored(rows, query)[:window]:
            if entry.id not in candidates:
                candidates[entry.id] = (0.0, entry)

        if not candidates:
            return [], False
        return self._fuse_entries(list(candidates.values()), query), bool(vector_pairs)

    def _fuse_entries(
        self,
        candidates: list[tuple[float, KnowledgeEntry]],
        query: str,
    ) -> list[tuple[float, KnowledgeEntry]]:
        q = (query or "").lower()
        scored: list[tuple[float, str, KnowledgeEntry]] = []
        for similarity, entry in candidates:
            keyword = self._entry_keyword_score(entry, q)
            total = similarity * 0.5 + (min(keyword, 24) / 24) * 0.5
            scored.append((total, entry.id, entry))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [(total, entry) for total, _, entry in scored]

    @staticmethod
    def _entry_keyword_score(entry: KnowledgeEntry, q: str) -> int:
        score = 0
        for keyword in entry.keywords:
            if keyword and keyword.lower() in q:
                score += max(2, len(keyword))
        for topic in entry.topics:
            if topic.lower() in q:
                score += 1
        return score

    def _rerank(
        self,
        query: str,
        candidates: list[tuple[float, KnowledgeEntry]],
        top_k: int,
    ) -> list[tuple[float, KnowledgeEntry]] | None:
        """精排序：调用 rerank 模型重排候选；未配置/失败返回 None 由调用方回退。"""
        settings = get_settings()
        if not settings.rerank_configured or not candidates:
            return None
        documents = [self._rerank_text(entry) for _, entry in candidates]
        scores = rerank_api(query, documents)
        if scores is None:
            return None
        ranked = [
            (score, entry)
            for score, (_, entry) in zip(scores, candidates)
            if score >= settings.rerank_min_score
        ]
        ranked.sort(key=lambda item: (-item[0], item[1].id))
        return ranked[:top_k] or None

    @staticmethod
    def _rerank_text(entry: KnowledgeEntry) -> str:
        return "\n".join(
            part for part in (entry.title, entry.summary, entry.text[:400]) if part
        )

    def source_by_id(self, source_id: str) -> KnowledgeEntry | None:
        row = self._fetchone(
            f"SELECT {_ENTRY_COLUMNS} FROM knowledge_entries WHERE id = %s",
            (source_id,),
        )
        return self._entry_from_row(row) if row else None

    @staticmethod
    def _embed_text(entry: KnowledgeEntry) -> str:
        return "\n".join(
            part
            for part in (
                entry.title,
                entry.summary,
                entry.text,
                " ".join(entry.keywords),
                " ".join(entry.topics),
            )
            if part
        )

    def ingest_packs(self, packs: list[KnowledgePack], embed: bool = True) -> int:
        settings = get_settings()
        entries = [entry for pack in packs for entry in pack.entries]
        vectors: list[list[float] | None] = [None] * len(entries)
        if embed and settings.embedding_configured and entries:
            vectors = embed_texts([self._embed_text(entry) for entry in entries])
        index = 0
        with self.pool.connection() as conn:
            with conn.cursor() as cur:
                for pack in packs:
                    cur.execute(
                        """
                        INSERT INTO knowledge_packs
                            (city_code, city_name, version, coverage, topic_coverage, checked_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, now())
                        ON CONFLICT (city_code) DO UPDATE SET
                            city_name = EXCLUDED.city_name,
                            version = EXCLUDED.version,
                            coverage = EXCLUDED.coverage,
                            topic_coverage = EXCLUDED.topic_coverage,
                            checked_at = EXCLUDED.checked_at,
                            updated_at = now()
                        """,
                        (
                            pack.cityCode,
                            pack.cityName,
                            pack.version,
                            pack.coverage,
                            Jsonb(pack.topicCoverage),
                            pack.checkedAt,
                        ),
                    )
                    cur.execute("DELETE FROM knowledge_entries WHERE pack_city = %s", (pack.cityCode,))
                    for entry in pack.entries:
                        vector = vectors[index] if index < len(vectors) else None
                        index += 1
                        vector_literal = "[" + ",".join(f"{value:.8f}" for value in vector) + "]" if vector else None
                        channel = Jsonb(entry.channel.model_dump()) if entry.channel else None
                        cur.execute(
                            """
                            INSERT INTO knowledge_entries
                                (id, pack_city, title, publisher, url, scope, city_code,
                                 effective_from, effective_to, version, checked_at, review_status,
                                 topics, keywords, text, summary, limitations, channel,
                                 embedding, embedding_model, embedding_updated_at, updated_at)
                            VALUES
                                (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                                 %s, %s, %s, %s, %s, %s, %s::vector, %s, %s, now())
                            """,
                            (
                                entry.id,
                                pack.cityCode,
                                entry.title,
                                entry.publisher,
                                entry.url,
                                entry.scope,
                                entry.cityCode,
                                entry.effectiveFrom,
                                entry.effectiveTo,
                                entry.version,
                                entry.checkedAt,
                                entry.reviewStatus,
                                entry.topics,
                                entry.keywords,
                                entry.text,
                                entry.summary,
                                entry.limitations,
                                channel,
                                vector_literal,
                                settings.embedding_configured_name or None,
                                datetime.now(timezone.utc) if vector else None,
                            ),
                        )
            conn.commit()
        return len(entries)
