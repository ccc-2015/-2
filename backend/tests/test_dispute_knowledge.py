"""争议渠道来源与资格骨架：general_only / local_verified 的映射与降级。"""
from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.knowledge import knowledge_store
from app.knowledge.store import KnowledgeStore
from app.knowledge.validate import validate_pack
from app.schemas import DiagnoseDisputeInput
from app.services import dispute as dispute_service
from app.services.dispute import diagnose_dispute

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "knowledge"

GENERAL_RESULT = {
    "factsSummary": ["房东拒绝退还押金"],
    "missingFacts": [],
    "sourceRefs": [],
    "recommendations": [
        {
            "channelId": "consult_authority",
            "title": "咨询当地政务服务热线",
            "reason": "可先了解当地咨询渠道",
            "preparations": ["整理押金支付凭证"],
            "sourceRefs": [],
        }
    ],
    "script": None,
}

LOCAL_RESULT = {
    "factsSummary": ["房东拒绝退还押金"],
    "missingFacts": [],
    "sourceRefs": ["S1"],
    "recommendations": [
        {
            "channelId": "zz_12345",
            "title": "模型自拟标题（服务端应覆盖）",
            "reason": "可按当地公开渠道咨询",
            "preparations": ["整理押金支付凭证"],
            "sourceRefs": ["S1"],
        }
    ],
    "script": None,
}


class DisputeKnowledgeTests(unittest.TestCase):
    def setUp(self):
        self.original_packs = knowledge_store.packs
        self.original_entries = knowledge_store.entries
        fixture = KnowledgeStore(FIXTURE_DIR)
        knowledge_store.packs = fixture.packs
        knowledge_store.entries = fixture.entries

    def tearDown(self):
        knowledge_store.packs = self.original_packs
        knowledge_store.entries = self.original_entries

    def test_fixture_pack_validates(self):
        pack, errors = validate_pack(FIXTURE_DIR / "zz.json")
        self.assertIsNotNone(pack)
        self.assertEqual(errors, [])

    def test_local_verified_channel_from_source(self):
        inp = DiagnoseDisputeInput(issue="房东不退押金", cityCode="ZZ", eventDate="2026-11-08")
        with patch.object(dispute_service, "chat_json", new=AsyncMock(return_value=LOCAL_RESULT)):
            analysis = asyncio.run(diagnose_dispute(inp))
        self.assertEqual(analysis.processing_mode, "knowledge_ai")
        self.assertEqual(analysis.coverage, "limited")
        self.assertEqual(analysis.knowledge_version, "zz-test-1")
        self.assertEqual(len(analysis.result.references), 1)
        self.assertEqual(analysis.result.references[0].id, "zz-test-12345")
        recommendation = analysis.result.recommendations[0]
        self.assertEqual(recommendation.channelId, "zz_12345")
        self.assertEqual(recommendation.title, "郑州市 12345 政务服务便民热线（测试夹具）")
        self.assertEqual(recommendation.eligibility, "local_verified")
        self.assertEqual(recommendation.sourceRefs, ["zz-test-12345"])
        self.assertTrue(any("审核渠道资料" in warning for warning in analysis.warnings))


class DisputeNoKnowledgeTests(unittest.TestCase):
    def test_general_channel_without_knowledge(self):
        inp = DiagnoseDisputeInput(issue="房东不退押金", cityCode="ZZ", eventDate="2026-11-08")
        with patch.object(dispute_service, "chat_json", new=AsyncMock(return_value=GENERAL_RESULT)):
            analysis = asyncio.run(diagnose_dispute(inp))
        self.assertEqual(analysis.processing_mode, "ai")
        self.assertEqual(analysis.coverage, "unsupported")
        self.assertEqual(analysis.result.references, [])
        recommendation = analysis.result.recommendations[0]
        self.assertEqual(recommendation.channelId, "consult_authority")
        self.assertEqual(recommendation.eligibility, "general_only")
        self.assertEqual(recommendation.sourceRefs, [])
        self.assertTrue(any("暂无审核渠道资料" in warning for warning in analysis.warnings))

    def test_unknown_local_channel_is_dropped(self):
        inp = DiagnoseDisputeInput(issue="房东不退押金", cityCode="ZZ", eventDate="2026-11-08")
        with patch.object(dispute_service, "chat_json", new=AsyncMock(return_value=LOCAL_RESULT)):
            analysis = asyncio.run(diagnose_dispute(inp))
        self.assertEqual(analysis.processing_mode, "ai")
        self.assertEqual(analysis.result.recommendations, [])
        self.assertEqual(analysis.result.references, [])


if __name__ == "__main__":
    unittest.main()
