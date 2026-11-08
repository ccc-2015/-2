"""精排序（rerank）接入：解析、失败回退与排序。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.knowledge import rerank as rerank_module
from app.knowledge.models import KnowledgeEntry
from app.knowledge.postgres import PostgresKnowledgeStore


def entry(entry_id: str, text: str = "原文") -> KnowledgeEntry:
    return KnowledgeEntry(
        id=entry_id,
        title=f"标题 {entry_id}",
        publisher="发布机关",
        version="2026-01-01",
        checkedAt="2026-11-08",
        reviewStatus="approved",
        topics=["deposit"],
        keywords=["押金"],
        text=text,
    )


class FakeSelf:
    _rerank_text = staticmethod(PostgresKnowledgeStore._rerank_text)


class RerankParseTests(unittest.TestCase):
    def test_parse_openai_style_results(self):
        body = {"results": [{"index": 0, "relevance_score": 0.2}, {"index": 1, "relevance_score": 0.9}]}
        self.assertEqual(rerank_module._parse(body, 2), [0.2, 0.9])

    def test_parse_cohere_style_data(self):
        body = {"data": [{"index": 0, "relevance_score": 0.4}]}
        self.assertEqual(rerank_module._parse(body, 2), [0.4, 0.0])

    def test_parse_invalid_returns_none(self):
        self.assertIsNone(rerank_module._parse({}, 2))
        self.assertIsNone(rerank_module._parse({"results": "x"}, 2))

    def test_not_configured_returns_none(self):
        settings = SimpleNamespace(rerank_configured=False)
        with patch.object(rerank_module, "get_settings", return_value=settings):
            self.assertIsNone(rerank_module.rerank("押金", ["a"]))


class RerankOrderTests(unittest.TestCase):
    def test_scores_decide_order(self):
        candidates = [(0.9, entry("a")), (0.8, entry("b")), (0.7, entry("c"))]
        settings = SimpleNamespace(rerank_configured=True, rerank_min_score=0.0)
        with patch("app.knowledge.postgres.get_settings", return_value=settings), patch(
            "app.knowledge.postgres.rerank_api", return_value=[0.1, 0.95, 0.5]
        ):
            ranked = PostgresKnowledgeStore._rerank(FakeSelf(), "押金不退", candidates, 2)
        self.assertEqual([item[1].id for item in ranked], ["b", "c"])

    def test_min_score_filters_candidates(self):
        candidates = [(0.9, entry("a")), (0.8, entry("b"))]
        settings = SimpleNamespace(rerank_configured=True, rerank_min_score=0.5)
        with patch("app.knowledge.postgres.get_settings", return_value=settings), patch(
            "app.knowledge.postgres.rerank_api", return_value=[0.1, 0.8]
        ):
            ranked = PostgresKnowledgeStore._rerank(FakeSelf(), "押金", candidates, 4)
        self.assertEqual([item[1].id for item in ranked], ["b"])

    def test_failure_returns_none_for_fallback(self):
        candidates = [(0.9, entry("a"))]
        settings = SimpleNamespace(rerank_configured=True, rerank_min_score=0.0)
        with patch("app.knowledge.postgres.get_settings", return_value=settings), patch(
            "app.knowledge.postgres.rerank_api", return_value=None
        ):
            self.assertIsNone(PostgresKnowledgeStore._rerank(FakeSelf(), "押金", candidates, 4))

    def test_disabled_returns_none_without_calling_api(self):
        candidates = [(0.9, entry("a"))]
        settings = SimpleNamespace(rerank_configured=False, rerank_min_score=0.0)
        with patch("app.knowledge.postgres.get_settings", return_value=settings), patch(
            "app.knowledge.postgres.rerank_api"
        ) as api:
            self.assertIsNone(PostgresKnowledgeStore._rerank(FakeSelf(), "押金", candidates, 4))
        api.assert_not_called()


if __name__ == "__main__":
    unittest.main()
