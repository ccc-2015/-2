"""二期知识库第一步：数据、检索、prompt 注入与来源映射。"""
from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.knowledge import knowledge_store
from app.knowledge.store import DATA_DIR
from app.knowledge.validate import validate_pack
from app.main import app
from app.schemas import AnalyzeContractInput
from app.services import contract as contract_service
from app.services.contract import _build_user_prompt, _collect_cited_ids, analyze_contract


class KnowledgeStoreTests(unittest.TestCase):
    def test_seed_available_and_version(self):
        self.assertTrue(knowledge_store.available)
        self.assertEqual(knowledge_store.version_for("ZZ"), "zz-2026.11.08.1")
        self.assertEqual(knowledge_store.coverage_for("ZZ"), "limited")
        self.assertEqual(knowledge_store.coverage_for("ZZ", "contract_review"), "limited")
        self.assertEqual(knowledge_store.coverage_for("ZZ", "dispute"), "unsupported")

    def test_seed_pack_validates(self):
        pack, errors = validate_pack(DATA_DIR / "zz.json")
        self.assertIsNotNone(pack)
        self.assertEqual(errors, [])

    def test_city_and_date_filter(self):
        entries = knowledge_store.list_sources("ZZ", "2026-11-08", "contract_review")
        self.assertTrue(entries)
        self.assertTrue(all(entry.cityCode == "ZZ" for entry in entries))
        self.assertEqual(knowledge_store.retrieve("ZZ", "2020-01-01", "维修 损耗 押金"), [])

    def test_other_city_has_no_knowledge(self):
        self.assertEqual(knowledge_store.list_sources("BJ", "2026-11-08"), [])
        self.assertEqual(knowledge_store.coverage_for("BJ"), "unsupported")
        self.assertIsNone(knowledge_store.version_for("BJ"))

    def test_dispute_scenario_has_no_channel_sources(self):
        self.assertEqual(knowledge_store.list_sources("ZZ", "2026-11-08", "dispute"), [])
        self.assertEqual(knowledge_store.coverage_for("ZZ", "dispute"), "unsupported")

    def test_retrieve_repair_wear(self):
        entries = knowledge_store.retrieve("ZZ", "2026-11-08", "房屋维修责任 自然损耗 押金 退租", top_k=4)
        ids = {entry.id for entry in entries}
        self.assertIn("cn-civil-712", ids)
        self.assertIn("cn-civil-710", ids)
        self.assertIn("cn-civil-733", ids)
        self.assertLessEqual(len(entries), 4)

    def test_sources_endpoint(self):
        client = TestClient(app)
        response = client.get(
            "/api/sources",
            params={"cityCode": "ZZ", "eventDate": "2026-11-08", "scenario": "contract_review"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertGreater(len(body["data"]), 0)
        self.assertEqual(body["meta"]["processingMode"], "knowledge_ai")
        self.assertEqual(body["meta"]["knowledgeVersion"], "zz-2026.11.08.1")
        self.assertEqual(body["data"][0]["publisher"], "全国人民代表大会")

    def test_sources_endpoint_for_other_city(self):
        client = TestClient(app)
        response = client.get("/api/sources", params={"cityCode": "BJ", "eventDate": "2026-11-08"})
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["data"], [])
        self.assertEqual(body["meta"]["coverage"], "unsupported")
        self.assertEqual(body["meta"]["processingMode"], "ai")
        self.assertIsNone(body["meta"]["knowledgeVersion"])

    def test_config_knowledge_flag(self):
        client = TestClient(app)
        response = client.get("/api/config")
        self.assertTrue(response.json()["data"]["features"]["knowledgeBase"])


class ContractKnowledgeTests(unittest.TestCase):
    def setUp(self):
        self.sources = knowledge_store.retrieve("ZZ", "2026-11-08", "维修 损耗 押金", top_k=4)
        self.source_map = {f"S{index + 1}": entry for index, entry in enumerate(self.sources)}

    def test_prompt_contains_sources(self):
        inp = AnalyzeContractInput(text="房屋维修由谁负责？", intent="review", cityCode="ZZ", eventDate="2026-11-08")
        prompt = _build_user_prompt(inp, self.sources)
        self.assertIn("【审核资料", prompt)
        self.assertIn("[S1]", prompt)
        self.assertIn("仅可引用以下编号", prompt)

    def test_collect_cited_ids_filters_unknown(self):
        raw = {"sourceRefs": ["S1"], "findings": [{"sourceRefs": ["S2", "S99"]}]}
        ids = _collect_cited_ids(raw, self.source_map)
        self.assertEqual(ids, [self.sources[0].id, self.sources[1].id])

    def test_analyze_maps_sources_and_meta(self):
        fake = {
            "answer": "维修责任可参考条文。",
            "sourceRefs": ["S1"],
            "findings": [
                {
                    "priority": "needs_attention",
                    "issue": "维修责任",
                    "impact": "",
                    "excerpt": None,
                    "suggestedQuestion": "",
                    "uncertainties": [],
                    "sourceRefs": ["S1"],
                }
            ],
            "revision": None,
            "followUpQuestions": [],
        }
        inp = AnalyzeContractInput(text="房屋维修由谁负责？", intent="review", cityCode="ZZ", eventDate="2026-11-08")
        with patch.object(contract_service, "chat_json", new=AsyncMock(return_value=fake)):
            analysis = asyncio.run(analyze_contract(inp))
        self.assertEqual(analysis.processing_mode, "knowledge_ai")
        self.assertEqual(analysis.result.coverage, "limited")
        self.assertEqual(len(analysis.result.references), 1)
        self.assertEqual(analysis.result.references[0].id, self.sources[0].id)
        self.assertIn("zz-2026.11.08.1", analysis.knowledge_version or "")
        self.assertEqual(analysis.result.findings[0].sourceRefs, [self.sources[0].id])

    def test_other_city_analysis_has_no_sources(self):
        fake = {
            "answer": "一般建议。",
            "sourceRefs": ["S1"],
            "findings": [],
            "revision": None,
            "followUpQuestions": [],
        }
        inp = AnalyzeContractInput(text="维修责任", intent="review", cityCode="BJ", eventDate="2026-11-08")
        with patch.object(contract_service, "chat_json", new=AsyncMock(return_value=fake)):
            analysis = asyncio.run(analyze_contract(inp))
        self.assertEqual(analysis.processing_mode, "ai")
        self.assertEqual(analysis.result.coverage, "unsupported")
        self.assertEqual(analysis.result.references, [])
        self.assertTrue(any("暂无审核知识库" in warning for warning in analysis.warnings))

    def test_no_sources_before_effective_date(self):
        fake = {
            "answer": "一般建议。",
            "sourceRefs": ["S1"],
            "findings": [],
            "revision": None,
            "followUpQuestions": [],
        }
        inp = AnalyzeContractInput(text="维修责任", intent="review", cityCode="ZZ", eventDate="2020-01-01")
        with patch.object(contract_service, "chat_json", new=AsyncMock(return_value=fake)):
            analysis = asyncio.run(analyze_contract(inp))
        self.assertEqual(analysis.processing_mode, "ai")
        self.assertEqual(analysis.result.references, [])
        self.assertTrue(any("没有匹配到" in warning for warning in analysis.warnings))


if __name__ == "__main__":
    unittest.main()
