"""按议题检索的确定性测试：不调用模型，不依赖 PostgreSQL。"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.knowledge import knowledge_store
from app.knowledge.issues import EVIDENCE_CHAR_BUDGET, MAX_GROUPS, build_issue_plan, merge_group_results
from app.responses import ApiError
from app.main import app
from app.schemas import AnalyzeContractInput
from app.services import contract as contract_service
from app.services.contract import (
    _build_user_prompt,
    build_retrieval_context,
    materialize,
    max_tokens_for,
)
import app.routers.contract as contract_router

CONTRACT = """第一条 甲方将位于郑州市的房屋出租给乙方，月租金2600元，押金4000元。
第二条 租金按月支付，逾期每日加收5%滞纳金。
第三条 房屋维修由甲方负责，自然损耗由甲方承担。
第四条 甲方有权随时入户检查，无需提前通知。
第五条 乙方不得转租。
第六条 租期内甲方可单方调整租金。
第七条 中介服务费由乙方承担，合同签订后不予退还。
第八条 提前退租的，押金不退。
第九条 退房时乙方须恢复原状并支付保洁费300元、家电折旧费500元从押金中扣除。
"""


def _input(**kwargs) -> AnalyzeContractInput:
    base = dict(text=CONTRACT, intent="review", cityCode="ZZ", eventDate="2026-11-08")
    base.update(kwargs)
    return AnalyzeContractInput(**base)


def _output(**kwargs) -> dict:
    return {"answer": "一般建议。", "sourceRefs": [], "findings": [], "revisions": [], "followUpQuestions": [], **kwargs}


class IssuePlanTests(unittest.TestCase):
    def test_common_topics_are_grouped(self):
        groups = build_issue_plan(CONTRACT, "", "", "review")
        ids = {group.id for group in groups}
        expected = {"deposit", "rent_fees", "repair", "entry_use", "termination", "broker_filing", "handover", "sublease"}
        self.assertTrue(expected.issubset(ids), ids)
        self.assertLessEqual(len(groups), MAX_GROUPS)
        # 兜底组位于末尾，且保留未分类条款的原文范围。
        if groups[-1].id == "general":
            self.assertIn("第九条", groups[-1].query)

    def test_tail_clause_reaches_deposit_query(self):
        groups = build_issue_plan(CONTRACT, "", "", "review")
        deposit = next(group for group in groups if group.id == "deposit")
        # 押金风险集中在合同最后一条，不能被合同头部的通用条款稀释。
        self.assertIn("家电折旧费", deposit.query)
        self.assertIn("押金", deposit.query)

    def test_ask_focuses_target(self):
        target = "第八条 提前退租的，押金不退。"
        groups = build_issue_plan(CONTRACT, "押金还能退吗", target, "ask")
        ids = {group.id for group in groups}
        self.assertIn("deposit", ids)
        self.assertNotIn("repair", ids)


class RetrievalTests(unittest.TestCase):
    def test_multi_issue_sources_cover_every_group(self):
        context = build_retrieval_context(_input())
        self.assertLessEqual(len(context.groups), MAX_GROUPS)
        self.assertLessEqual(len(context.sources), 12)
        self.assertEqual(context.gaps, [])
        for group in context.groups:
            mapped = [entry for entry in context.sources if group.label in context.source_groups.get(entry.id, [])]
            self.assertTrue(mapped, group.id)
        # 郑州场景应至少保留一条地方资料；不足时也不能用全国条文冒充地方依据。
        self.assertTrue(any(entry.scope != "national" for entry in context.sources))
        self.assertLessEqual(sum(len(entry.text) for entry in context.sources), EVIDENCE_CHAR_BUDGET)

    def test_other_city_stays_national(self):
        context = build_retrieval_context(_input(cityCode="SH"))
        self.assertTrue(context.sources)
        self.assertTrue(all(entry.scope == "national" for entry in context.sources))

    def test_ask_without_direct_remedy_returns_empty(self):
        question = "每日5%滞纳金是否过高并可以请求调减？"
        context = build_retrieval_context(_input(text=question, intent="ask", question=question))
        self.assertEqual(context.sources, [])
        self.assertTrue(context.gaps)

    def test_zero_relevance_returns_empty(self):
        entries = knowledge_store.retrieve("ZZ", "2026-11-08", "量子物理 星际旅行 航天器", top_k=5)
        self.assertEqual(entries, [])

    def test_date_assumption_is_recorded(self):
        context = build_retrieval_context(_input(eventDate=None))
        analysis = materialize(
            _input(eventDate=None),
            context.sources,
            _output(),
            context,
        )
        self.assertIsNotNone(context.date_assumed)
        self.assertTrue(any("未提供事件日期" in warning for warning in analysis.warnings))
        self.assertTrue(any("模式：" in warning for warning in analysis.warnings))
        self.assertTrue(analysis.knowledge_snapshot)
        self.assertIn("ZZ:zz-2026.11.12.1", analysis.knowledge_snapshot)

    def test_explicit_date_has_no_assumption_warning(self):
        context = build_retrieval_context(_input())
        self.assertIsNone(context.date_assumed)
        analysis = materialize(_input(), context.sources, _output(), context)
        self.assertFalse(any("未提供事件日期" in warning for warning in analysis.warnings))

    def test_no_applicable_sources_reports_gap_and_warning(self):
        inp = _input(eventDate="2000-01-01")
        context = build_retrieval_context(inp)
        self.assertEqual(context.sources, [])
        self.assertTrue(context.gaps)
        analysis = materialize(inp, context.sources, _output(), context)
        joined = " ".join(analysis.warnings)
        self.assertIn("没有匹配到", joined)
        self.assertIn("未保留可用依据", joined)

    def test_prompt_lists_issue_evidence_mapping(self):
        context = build_retrieval_context(_input())
        prompt = _build_user_prompt(_input(), context.sources, context)
        self.assertIn("【本次检索议题", prompt)
        self.assertIn("T1 ", prompt)
        self.assertIn("S1", prompt)

    def test_merge_dedupes_and_respects_budget(self):
        context = build_retrieval_context(_input())
        duplicated = [[entry, *rest] for entry, rest in zip(context.sources, [[]] * len(context.sources))]
        selection = merge_group_results(context.groups, duplicated)
        self.assertEqual(len({entry.id for entry in selection.entries}), len(selection.entries))

    def test_stream_and_nonstream_budget_share_intent(self):
        self.assertEqual(max_tokens_for("review"), 4000)
        self.assertEqual(max_tokens_for("ask"), 1600)


class HandlerIntegrationTests(unittest.TestCase):
    """走真实 FastAPI handler，只替换模型调用，验证协议与阶段事件。"""

    payload = {
        "answer": "审查正文。",
        "sourceRefs": ["S1"],
        "findings": [
            {
                "priority": "needs_attention",
                "issue": "押金扣减",
                "impact": "退租时押金可能被多扣。",
                "excerpt": None,
                "suggestedQuestion": "押金扣除依据",
                "uncertainties": [],
                "sourceRefs": ["S1"],
            }
        ],
        "revisions": [],
        "followUpQuestions": [],
    }

    def _content(self) -> str:
        return "\n".join(["审查正文。", "===DATA===", json.dumps(self.payload, ensure_ascii=False)])

    def _request(self) -> dict:
        return {
            "cityCode": "ZZ",
            "eventDate": "2026-11-08",
            "text": CONTRACT,
            "textScope": "full",
            "question": "",
            "conversation": [],
            "intent": "review",
        }

    def test_stream_reports_issues_and_snapshot(self):
        async def fake_stream(*_args, **_kwargs):
            yield self._content()

        with patch.object(contract_router, "chat_stream", new=fake_stream):
            response = TestClient(app).post("/api/contract/analyze/stream", json=self._request())
        self.assertEqual(response.status_code, 200)
        body = response.text
        self.assertIn('"stage": "retrieving"', body)
        self.assertIn('"issues":', body)
        self.assertIn('"retrievalMode":', body)
        self.assertIn('"type": "result"', body)
        self.assertIn("knowledgeSnapshot", body)

    def test_analyze_meta_contains_actual_snapshot(self):
        with patch.object(contract_service, "chat", new=AsyncMock(return_value=self._content())):
            response = TestClient(app).post("/api/contract/analyze", json=self._request())
        self.assertEqual(response.status_code, 200)
        meta = response.json()["meta"]
        self.assertIn("ZZ:zz-2026.11.12.1", meta["knowledgeSnapshot"])
        self.assertEqual(len(response.json()["data"]["references"]), 1)

    def test_stream_without_structure_is_incomplete(self):
        async def fake_stream(*_args, **_kwargs):
            yield "只有正文，没有结构化结果。"

        with patch.object(contract_router, "chat_stream", new=fake_stream):
            response = TestClient(app).post("/api/contract/analyze/stream", json=self._request())
        self.assertEqual(response.status_code, 200)
        body = response.text
        self.assertIn('"type": "delta"', body)
        self.assertIn('"type": "error"', body)
        self.assertIn("结构化结果未完成", body)
        self.assertNotIn('"type": "result"', body)

    def test_missing_topic_evidence_is_not_invented(self):
        context = build_retrieval_context(_input())
        raw = {
            **_output(),
            "answer": "审查正文。",
            "findings": [
                {
                    "priority": "needs_attention",
                    "issue": "甲方有权随时入户检查，无需提前通知。",
                    "impact": "承租人居住安宁可能受影响。",
                    "excerpt": None,
                    "suggestedQuestion": "",
                    "uncertainties": [],
                    "sourceRefs": [],
                }
            ],
        }
        analysis = materialize(_input(), context.sources, raw, context)
        finding = analysis.result.findings[0]
        self.assertEqual(finding.topicId, "entry_use")
        self.assertEqual(finding.evidenceStatus, "insufficient")
        self.assertEqual(finding.sourceRefs, [])
        self.assertEqual(finding.evidenceSnippets, [])
        self.assertEqual(analysis.result.references, [])

    def test_invalid_and_discarded_finding_refs_are_not_counted(self):
        context = build_retrieval_context(_input())
        for issue, refs in [("押金扣减", ["DOES-NOT-EXIST"]), ("   ", ["S1"])]:
            with self.subTest(issue=issue):
                item = {**self.payload["findings"][0], "issue": issue, "sourceRefs": refs}
                analysis = materialize(_input(), context.sources, _output(findings=[item]), context)
                self.assertEqual(analysis.result.references, [])
                for finding in analysis.result.findings:
                    self.assertEqual(finding.sourceRefs, [])
                    self.assertEqual(finding.evidenceStatus, "insufficient")

    def test_unknown_enterprise_subject_is_conditional_without_substitution(self):
        source = next(entry for entry in knowledge_store.entries if entry.appliesTo == "enterprise")
        item = self.payload["findings"][0]
        analysis = materialize(_input(text="租金与押金约定。"), [source], _output(findings=[item]))
        self.assertEqual(analysis.result.findings[0].evidenceStatus, "conditional")
        self.assertEqual(analysis.result.findings[0].sourceRefs, [source.id])
        self.assertEqual(analysis.result.findings[0].evidenceSnippets[0].text, source.text.strip())

    def test_handlers_reject_invalid_shapes_and_accept_empty_findings(self):
        invalid = [{}, _output(findings="not-an-array"), _output(findings=[{}]),
                   _output(sourceRefs="S1"), _output(revisions=[{}])]
        for field in _output():
            invalid.append({key: value for key, value in _output().items() if key != field})
        for raw in [*invalid, _output()]:
            valid = raw == _output()
            content = "正文草稿。\n===DATA===\n" + json.dumps(raw, ensure_ascii=False)

            async def fake_stream(*_args, **_kwargs):
                yield content

            with self.subTest(raw=raw), patch.object(contract_router, "chat_stream", new=fake_stream):
                response = TestClient(app).post("/api/contract/analyze/stream", json=self._request())
                self.assertEqual('"type": "result"' in response.text, valid)
                self.assertEqual('"type": "error"' in response.text, not valid)
                if not valid:
                    self.assertIn("upstream_invalid", response.text)
            with patch.object(contract_service, "chat", new=AsyncMock(return_value=content)):
                response = TestClient(app).post("/api/contract/analyze", json=self._request())
                self.assertEqual(response.status_code, 200 if valid else 502)

    def test_private_lessor_and_irrelevant_text_at_service_boundary(self):
        inp = _input(text="甲方为个人房东，直租自有住房给乙方，月租2000元，押金4000元。乙方询问押金上限和资金监管。")
        context = build_retrieval_context(inp)
        self.assertEqual(context.subject, "private")
        self.assertTrue(context.sources)
        self.assertFalse(any(entry.appliesTo == "enterprise" for entry in context.sources))
        irrelevant = build_retrieval_context(_input(text="量子物理 星际旅行 航天器", question="请审查这份合同。"))
        self.assertEqual(irrelevant.sources, [])
        self.assertTrue(irrelevant.gaps)

    def test_remaining_context_budget_trims_whole_sources_and_reports_gaps(self):
        context = build_retrieval_context(_input())
        before = len(context.sources)
        empty_prompt = contract_service.model_messages(_input(), [], context)
        limit = sum(len(message["content"].encode("utf-8")) for message in empty_prompt) + max_tokens_for("review") + 1024
        with patch.object(contract_service, "get_settings") as settings:
            settings.return_value.model_context_tokens = limit
            contract_service._fit_context_budget(_input(), context)
        size = sum(len(message["content"].encode("utf-8")) for message in contract_service.model_messages(_input(), context.sources, context))
        self.assertLessEqual(size + max_tokens_for("review") + 512, limit)
        self.assertLess(len(context.sources), before)
        self.assertEqual(set(context.source_groups), {entry.id for entry in context.sources})
        covered = {label for labels in context.source_groups.values() for label in labels}
        self.assertEqual(context.gaps, [group.label for group in context.groups if group.label not in covered])

    def test_context_budget_rejects_oversized_input_before_model_call(self):
        with patch.object(contract_service, "get_settings") as settings:
            settings.return_value.model_context_tokens = 100
            with self.assertRaises(ApiError) as raised:
                build_retrieval_context(_input())
        self.assertEqual(raised.exception.code, "invalid_input")


if __name__ == "__main__":
    unittest.main()