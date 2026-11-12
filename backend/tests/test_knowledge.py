"""二期知识库第一步：数据、检索、prompt 注入与来源映射。"""
from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

import json

from app.knowledge import knowledge_store
from app.knowledge.citations import collect_cited_ids
from app.knowledge.store import DATA_DIR
from app.knowledge.validate import validate_pack
from app.main import app
from app.schemas import AnalyzeContractInput
from app.services import contract as contract_service
from app.services.contract import _build_user_prompt, analyze_contract

PACK = json.loads((DATA_DIR / "zz.json").read_text(encoding="utf-8"))
CN_PACK = json.loads((DATA_DIR / "cn.json").read_text(encoding="utf-8"))


def _model_text(payload: dict) -> str:
    """模拟模型的「正文 + ===DATA=== + JSON」输出。"""
    body = payload.get("answer") or "模型回答正文。"
    return chr(10).join([body, "===DATA===", json.dumps(payload, ensure_ascii=False)])


class KnowledgeStoreTests(unittest.TestCase):
    def test_seed_available_and_version(self):
        self.assertTrue(knowledge_store.available)
        self.assertEqual(knowledge_store.version_for("ZZ"), PACK["version"])
        self.assertEqual(knowledge_store.coverage_for("ZZ"), PACK["coverage"])
        self.assertEqual(
            knowledge_store.coverage_for("ZZ", "contract_review"), PACK["topicCoverage"]["contract_review"]
        )
        self.assertEqual(knowledge_store.coverage_for("ZZ", "dispute"), PACK["topicCoverage"]["dispute"])

    def test_seed_pack_validates(self):
        pack, errors = validate_pack(DATA_DIR / "zz.json")
        self.assertIsNotNone(pack)
        self.assertEqual(errors, [])
        self.assertGreaterEqual(len(pack.entries), 30)
        self.assertTrue(any(entry.cityCode == "ZZ" for entry in pack.entries))
        self.assertTrue(any(entry.channel for entry in pack.entries))

    def test_city_and_date_filter(self):
        entries = knowledge_store.list_sources("ZZ", "2026-11-08", "contract_review")
        self.assertTrue(entries)
        # 资料包内同时收录郑州地方资料与全国性资料。
        self.assertTrue(all(entry.cityCode in ("ZZ", "CN") for entry in entries))
        # 2000 年时只有无生效日期的渠道资料可用；不得召回任何当时尚未施行的条文。
        retrieved = knowledge_store.retrieve("ZZ", "2000-01-01", "维修 损耗 押金")
        self.assertFalse(
            [entry.id for entry in retrieved if entry.effectiveFrom and entry.effectiveFrom > "2000-01-01"],
            [entry.id for entry in retrieved],
        )

    def test_other_city_uses_national_sources_only(self):
        entries = knowledge_store.list_sources("SH", "2026-11-08", "contract_review")
        self.assertTrue(entries)
        self.assertTrue(all(entry.scope == "national" for entry in entries))
        self.assertTrue(any(entry.id == "cn-civil-703" for entry in entries))
        self.assertEqual(knowledge_store.coverage_for("SH", "contract_review"), "limited")
        self.assertEqual(knowledge_store.version_for("SH"), CN_PACK["version"])

    def test_non_pilot_cities_never_receive_local_sources(self):
        for city in ("CN", "SH", "BJ", "SZ"):
            for scenario in ("contract_review", "dispute"):
                with self.subTest(city=city, scenario=scenario):
                    entries = knowledge_store.list_sources(city, "2026-11-08", scenario)
                    self.assertTrue(entries)
                    self.assertTrue(all(entry.scope == "national" for entry in entries))
                    self.assertFalse(any(entry.channel and entry.channel.eligibility == "local_verified" for entry in entries))
                    retrieved = knowledge_store.retrieve(city, "2026-11-08", "郑州 12345 押金 维修", scenario=scenario)
                    self.assertTrue(retrieved)
                    self.assertTrue(all(entry.scope == "national" for entry in retrieved))
                    # 全国包按自身声明返回 supported；无城市包的真实城市回退为 limited。
                    expected = CN_PACK["topicCoverage"][scenario] if city == "CN" else "limited"
                    self.assertEqual(knowledge_store.coverage_for(city, scenario), expected)

    def test_dispute_scenario_has_channel_sources(self):
        entries = knowledge_store.list_sources("ZZ", "2026-11-08", "dispute")
        self.assertTrue(entries)
        self.assertTrue(any(entry.channel for entry in entries))
        self.assertTrue(any(entry.scope == "national" for entry in entries))

    def test_city_packs_are_isolated(self):
        owned = {"ZZ": ("zz-", "hn-"), "WH": ("wh-",), "HZ": ("hz-", "zj-")}
        for city, prefixes in owned.items():
            ids = {entry.id for entry in knowledge_store.list_sources(city, "2026-11-08", "contract_review")}
            self.assertTrue(any(entry_id.startswith(prefixes) for entry_id in ids), city)
            foreign = [i for i in ids if not i.startswith(prefixes) and not i.startswith("cn-")]
            self.assertEqual(foreign, [], f"{city} 混入了其他城市的条目")
        # 用郑州关键词检索武汉，不得带出郑州或杭州条目。
        wh = {entry.id for entry in knowledge_store.retrieve("WH", "2026-11-08", "郑州 隔断 押金")}
        self.assertFalse(any(i.startswith(("zz-", "hz-", "zj-")) for i in wh), wh)

    def test_individual_counterparty_excludes_12315(self):
        from app.services.dispute import _applicable_channel_sources, _filter_by_counterparty

        entries = _applicable_channel_sources("ZZ", "2026-11-08")
        self.assertTrue(any(entry.channel and entry.channel.id == "cn_12315" for entry in entries))
        individual = _filter_by_counterparty(entries, "个人房东")
        self.assertFalse(any(entry.channel and entry.channel.id == "cn_12315" for entry in individual))
        company = _filter_by_counterparty(entries, "住房租赁企业")
        self.assertTrue(any(entry.channel and entry.channel.id == "cn_12315" for entry in company))

    def test_retrieve_repair_wear(self):
        entries = knowledge_store.retrieve("ZZ", "2026-11-08", "房屋维修责任 自然损耗 押金 退租", top_k=4)
        ids = [entry.id for entry in entries]
        self.assertLessEqual(len(entries), 4)
        # 至少命中一条民法典租赁条款或维修主题条目。
        self.assertTrue(
            any(entry_id.startswith("cn-civil-7") for entry_id in ids)
            or any("repair" in entry.topics for entry in entries),
            ids,
        )

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
        self.assertEqual(body["meta"]["knowledgeVersion"], PACK["version"])
        self.assertEqual(body["data"][0]["publisher"], "全国人民代表大会")

    def test_sources_endpoint_for_other_city_uses_national_law(self):
        client = TestClient(app)
        response = client.get(
            "/api/sources",
            params={"cityCode": "SH", "eventDate": "2026-11-08", "scenario": "contract_review"},
        )
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertTrue(body["data"])
        self.assertTrue(all(item["cityCode"] == "CN" for item in body["data"]))
        self.assertEqual(body["meta"]["coverage"], "limited")
        self.assertEqual(body["meta"]["processingMode"], "knowledge_ai")
        self.assertEqual(body["meta"]["knowledgeVersion"], CN_PACK["version"])

    def test_config_knowledge_flag(self):
        client = TestClient(app)
        response = client.get("/api/config")
        self.assertTrue(response.json()["data"]["features"]["knowledgeBase"])

    def test_channel_entries_require_local_verified_source(self):
        channels = [entry for entry in PACK["entries"] if entry.get("channel")]
        self.assertTrue(channels)
        for entry in channels:
            if entry["channel"]["eligibility"] == "local_verified":
                self.assertEqual(entry["reviewStatus"], "approved")
                self.assertTrue(entry["url"].startswith("https://"))
                self.assertTrue({"channel", "dispute"} & set(entry["topics"]))

    def test_local_regulation_is_retrievable_for_contract(self):
        entries = knowledge_store.retrieve("ZZ", "2026-11-08", "押金 退还 扣减", top_k=4, scenario="contract_review")
        ids = {entry.id for entry in entries}
        self.assertTrue(
            any(entry_id.startswith("zz-") or entry_id.startswith("cn-housing-lease-reg") for entry_id in ids),
            ids,
        )

    def test_pack_has_zhengzhou_sources(self):
        city_entries = [entry for entry in PACK["entries"] if entry["cityCode"] == "ZZ"]
        self.assertGreaterEqual(len(city_entries), 20)


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
        ids = collect_cited_ids(raw, self.source_map)
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
        with patch.object(contract_service, "chat", new=AsyncMock(return_value=_model_text(fake))):
            analysis = asyncio.run(analyze_contract(inp))
        self.assertEqual(analysis.processing_mode, "knowledge_ai")
        self.assertEqual(analysis.result.coverage, PACK["topicCoverage"]["contract_review"])
        self.assertEqual(len(analysis.result.references), 1)
        # 引用必须来自资料包中的真实条目，且与 finding 的 sourceRefs 一致。
        pack_ids = {entry["id"] for entry in PACK["entries"]} | {entry["id"] for entry in CN_PACK["entries"]}
        self.assertIn(analysis.result.references[0].id, pack_ids)
        self.assertEqual(analysis.result.findings[0].sourceRefs, [analysis.result.references[0].id])
        self.assertEqual(analysis.knowledge_version, PACK["version"])

    def test_other_city_analysis_uses_national_sources(self):
        fake = {
            "answer": "一般建议。",
            "sourceRefs": ["S1"],
            "findings": [],
            "revision": None,
            "followUpQuestions": [],
        }
        inp = AnalyzeContractInput(text="维修责任", intent="review", cityCode="BJ", eventDate="2026-11-08")
        with patch.object(contract_service, "chat", new=AsyncMock(return_value=_model_text(fake))):
            analysis = asyncio.run(analyze_contract(inp))
        self.assertEqual(analysis.processing_mode, "knowledge_ai")
        self.assertEqual(analysis.result.coverage, "limited")
        self.assertTrue(analysis.result.references)
        self.assertTrue(all(ref.cityCode == "CN" for ref in analysis.result.references))

    def test_no_sources_before_effective_date(self):
        fake = {
            "answer": "一般建议。",
            "sourceRefs": ["S1"],
            "findings": [],
            "revision": None,
            "followUpQuestions": [],
        }
        inp = AnalyzeContractInput(text="维修责任", intent="review", cityCode="ZZ", eventDate="2000-01-01")
        with patch.object(contract_service, "chat", new=AsyncMock(return_value=_model_text(fake))):
            analysis = asyncio.run(analyze_contract(inp))
        self.assertEqual(analysis.processing_mode, "ai")
        self.assertEqual(analysis.result.references, [])
        self.assertTrue(any("没有匹配到" in warning for warning in analysis.warnings))

    def test_revision_text_strips_draft_note(self):
        fake = {
            "answer": "修订建议如下。",
            "sourceRefs": [],
            "findings": [],
            "revision": {
                "text": "协商草稿（请自行核对后使用）：第八条 租赁期内租金保持不变。",
                "targetExcerpt": {"text": "第八条 甲方可单方调整租金。", "start": 0, "end": 13},
            },
            "followUpQuestions": [],
        }
        text = "第八条 甲方可单方调整租金。"
        inp = AnalyzeContractInput(text=text, intent="draft_revision", cityCode="ZZ", eventDate="2026-11-08")
        with patch.object(contract_service, "chat", new=AsyncMock(return_value=_model_text(fake))):
            analysis = asyncio.run(analyze_contract(inp))
        self.assertIsNotNone(analysis.result.revision)
        self.assertEqual(analysis.result.revision.text, "第八条 租赁期内租金保持不变。")


if __name__ == "__main__":
    unittest.main()
