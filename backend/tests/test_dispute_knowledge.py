"""争议渠道来源骨架：检索、sourceRefs 映射与 references。"""
from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.knowledge import knowledge_store
from app.knowledge.store import KnowledgeStore
from app.schemas import DiagnoseDisputeInput
from app.services import dispute as dispute_service
from app.services.dispute import diagnose_dispute

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "knowledge"

FAKE_RESULT = {
    "factsSummary": ["房东拒绝退还押金"],
    "missingFacts": [],
    "sourceRefs": ["S1"],
    "recommendations": [
        {
            "channelId": "consult_authority",
            "title": "咨询当地政务服务热线",
            "reason": "可先了解当地咨询渠道",
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

    def test_dispute_maps_channel_sources(self):
        inp = DiagnoseDisputeInput(issue="房东不退押金", cityCode="ZZ", eventDate="2026-11-08")
        with patch.object(dispute_service, "chat_json", new=AsyncMock(return_value=FAKE_RESULT)):
            analysis = asyncio.run(diagnose_dispute(inp))
        self.assertEqual(analysis.processing_mode, "knowledge_ai")
        self.assertEqual(analysis.coverage, "limited")
        self.assertEqual(analysis.knowledge_version, "zz-test-1")
        self.assertEqual(len(analysis.result.references), 1)
        self.assertEqual(analysis.result.references[0].id, "zz-test-12345")
        self.assertEqual(analysis.result.recommendations[0].sourceRefs, ["zz-test-12345"])
        self.assertTrue(any("审核渠道资料" in warning for warning in analysis.warnings))


class DisputeNoKnowledgeTests(unittest.TestCase):
    def test_dispute_without_channel_sources(self):
        inp = DiagnoseDisputeInput(issue="房东不退押金", cityCode="ZZ", eventDate="2026-11-08")
        with patch.object(dispute_service, "chat_json", new=AsyncMock(return_value=FAKE_RESULT)):
            analysis = asyncio.run(diagnose_dispute(inp))
        self.assertEqual(analysis.processing_mode, "ai")
        self.assertEqual(analysis.coverage, "unsupported")
        self.assertEqual(analysis.result.references, [])
        self.assertEqual(analysis.result.recommendations[0].sourceRefs, [])
        self.assertTrue(any("暂无审核渠道资料" in warning for warning in analysis.warnings))


if __name__ == "__main__":
    unittest.main()
