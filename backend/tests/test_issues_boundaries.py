"""独立议题边界测试：不初始化知识库、不读 .env、不联网。"""
from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path

# 在隔离命名空间中载入真实模块，避免 knowledge.__init__ 初始化配置/存储。
_APP = Path(__file__).resolve().parents[1] / "app"
for name, path in (("_issues_boundary_app", _APP), ("_issues_boundary_app.knowledge", _APP / "knowledge")):
    package = types.ModuleType(name)
    package.__path__ = [str(path)]
    sys.modules[name] = package
issues = importlib.import_module("_issues_boundary_app.knowledge.issues")
KnowledgeEntry = importlib.import_module("_issues_boundary_app.knowledge.models").KnowledgeEntry

TOPICS = {"deposit", "rent_fees", "repair", "termination", "entry_use", "sublease", "identity", "broker_filing", "handover"}
ALL_TOPICS = "押金\n租金\n维修\n解除\n入户\n转租\n出租人\n中介\n交接"

SUBJECT_CASES = [
    ("甲方为个人房东，直租自有住房给乙方", "private"),
    ("出租人为住房租赁企业", "enterprise"),
    ("出租人为房地产经纪机构。", "intermediary"),
    ("出租方：自然人。", "private"),
    ("出租人（甲方）：个人房东。", "private"),
    ("甲方（出租人）系住房租赁企业；", "enterprise"),
    ("出租方(甲方)属于房屋租赁企业;", "enterprise"),
    ("第一条 出租方身份为个人。", "private"),
    ("第12条 出租人类型：住房租赁经纪机构。", "intermediary"),
    ("\t出租方 性质 ： 中介机构 \t", "intermediary"),
    ("出租人为个人房东。住房租赁企业应当办理备案。", "private"),
    ("甲方为个人房东，直租自有住房给乙方。乙方为住房租赁企业。", "private"),
    ("出租人不是住房租赁企业。", "unknown"),
    ("出租人并非住房租赁企业。", "unknown"),
    ("出租人：非住房租赁企业。", "unknown"),
    ("出租人并不属于住房租赁企业。", "unknown"),
    ("出租人不是住房租赁企业。出租人为个人房东。", "private"),
    ("出租人为个人房东，并非住房租赁企业。", "private"),
    ("出租人为个人房东；出租人为住房租赁企业。", "unknown"),
    ("出租人为住房租赁企业。出租人不是住房租赁企业。", "unknown"),
    ("出租人为住房租赁企业，并非住房租赁企业。", "unknown"),
    ("出租人为个人房东，出租人为中介机构。", "unknown"),
    ("出租人为个人房东。甲方为住房租赁企业。", "unknown"),
    ("出租人为自然人。出租人不是个人。", "unknown"),
    ("出租人为住房租赁企业。出租人为非住房租赁企业。", "unknown"),
    ("出租人为住房租赁企业，但不是企业。", "unknown"),
    ("出租人为非住房租赁企业。", "unknown"),
    ("出租人不是非住房租赁企业。", "unknown"),
    ("出租人为企业。", "unknown"),
    ("", "unknown"),
    ("企业提供维修服务。", "unknown"),
    ("住房租赁企业应当遵守本规定。", "unknown"),
    ("出租人应委托住房租赁企业提供服务。", "unknown"),
    ("出租人不得向住房租赁企业收取佣金。", "unknown"),
    ("承租人为住房租赁企业。", "unknown"),
    ("乙方为住房租赁企业。", "unknown"),
    ("甲方为住房租赁企业。", "unknown"),
    ("甲方（承租人）为住房租赁企业。", "unknown"),
    ("原出租人为住房租赁企业。", "unknown"),
    ("若出租人为住房租赁企业，应办理备案。", "unknown"),
    ("如果乙方违约，出租人为住房租赁企业。", "unknown"),
    ("出租人为住房租赁企业的，应办理备案。", "unknown"),
    ("出租人为住房租赁企业时，应办理备案。", "unknown"),
    ("出租人为住房租赁企业员工。", "unknown"),
    ("出租人为住房租赁企业负责人。", "unknown"),
    ("出租人为个人房东代理人。", "unknown"),
    ("出租人为个人房东的亲属。", "unknown"),
    ("出租人为个人独资企业。", "unknown"),
    ("出租人为住房租赁企业服务。", "unknown"),
    ("出租人为某某科技有限公司。", "unknown"),
    ("出租人为住房租赁企业？", "unknown"),
    ("出租人为住房租赁企业?", "unknown"),
    ("出租人为住房租赁企业吗。", "unknown"),
    ("出租人为住房租赁企业或个人。", "unknown"),
    ("出租人为住房租赁企业/个人。", "unknown"),
    ("出租人为住房租赁企业、个人。", "unknown"),
    ("出租人为住房租赁企业，或为个人。", "unknown"),
    ("出租人为住房租赁企业，此身份待确认。", "unknown"),
    ("出租人为住房租赁企业，该表述不属实。", "unknown"),
    ("示例：出租人为住房租赁企业。", "unknown"),
    ("“出租人为住房租赁企业”。", "unknown"),
    ("出租人为\n住房租赁企业。", "unknown"),
    ("出租人为住房 租赁企业。", "unknown"),
    ("自然人房东将自己所有的一套住房直接出租，未委托任何机构。", "private"),
    ("甲方为住房租赁企业，从事转租经营。", "enterprise"),
    ("自然人房东代理人将自有住房出租。", "unknown"),
    ("甲方为住房租赁企业，从事其他业务。", "unknown"),
    ("乙方为住房租赁企业，从事转租经营。", "unknown"),
]


def entry(identifier: str, text: str):
    return KnowledgeEntry(id=identifier, title="依据", publisher="测试", version="1", checkedAt="2026-11-21", text=text)


def plans(count: int):
    return [issues.IssuePlan(str(i), f"议题{i}", "") for i in range(count)]


class IssuesBoundaryTests(unittest.TestCase):
    def test_general_query_has_only_original_text_and_question(self):
        text, question = "量子物理 星际旅行 航天器", "太阳为什么发光"
        groups = issues.build_issue_plan(text, question)
        self.assertEqual([(g.id, g.query) for g in groups], [("general", text + "\n" + question)])
        self.assertEqual(issues.GENERAL_RULE.query, "")

    def test_all_nine_topics_plus_general_are_kept_and_sorted(self):
        groups = issues.build_issue_plan(ALL_TOPICS + "\n白纸黑字")
        self.assertEqual(issues.MAX_GROUPS, 10)
        self.assertEqual(len(groups), 10)
        self.assertEqual({g.id for g in groups}, TOPICS | {"general"})
        self.assertEqual(groups, sorted(groups, key=lambda g: (-g.matches, g.id)))
        self.assertEqual(next(g.query for g in groups if g.id == "general"), "白纸黑字")

    def test_nine_topics_without_general(self):
        groups = issues.build_issue_plan(ALL_TOPICS)
        self.assertEqual(len(groups), 9)
        self.assertEqual({g.id for g in groups}, TOPICS)

    def test_query_is_still_bounded(self):
        for group in issues.build_issue_plan((ALL_TOPICS + "\n白纸黑字\n") * 500):
            self.assertLessEqual(len(group.query), issues.MAX_QUERY_CHARS)

    def test_ask_focus_is_unchanged(self):
        groups = issues.build_issue_plan(ALL_TOPICS, "能退还吗", "押金", "ask")
        self.assertEqual([g.id for g in groups], ["deposit"])

    def test_first_oversized_entry_is_rejected(self):
        result = issues.merge_group_results(plans(1), [[entry("large", "法" * 6001)]])
        self.assertEqual(result.entries, [])
        self.assertEqual(result.source_groups, {})
        self.assertEqual(result.gaps, ["议题0"])
        self.assertEqual(result.candidate_count, 1)

    def test_exact_budget_is_allowed_but_next_entry_is_a_gap(self):
        result = issues.merge_group_results(plans(2), [[entry("exact", "法" * 6000)], [entry("extra", "条")]])
        self.assertEqual([e.id for e in result.entries], ["exact"])
        self.assertEqual(result.gaps, ["议题1"])

    def test_skips_oversized_candidate_and_keeps_later_fit(self):
        result = issues.merge_group_results(plans(1), [[entry("large", "法" * 6001), entry("small", "适用条件")]])
        self.assertEqual([e.id for e in result.entries], ["small"])
        self.assertEqual(result.gaps, [])

    def test_count_limit_still_collects_late_same_id_and_text_aliases(self):
        original = entry("kept", "适用 条件")
        result = issues.merge_group_results(plans(3), [
            [original],
            [entry("dropped", "另一依据"), entry("alias", "适用\n条件")],
            [entry("other", "其他依据"), original],
        ], max_evidence=1)
        self.assertEqual([e.id for e in result.entries], ["kept"])
        self.assertEqual(result.source_groups, {"kept": ["议题0", "议题1", "议题2"]})
        self.assertEqual(result.gaps, [])
        self.assertEqual(result.candidate_count, 4)

    def test_text_aliases_map_only_to_retained_id(self):
        result = issues.merge_group_results(plans(2), [[entry("a", "同 文")], [entry("b", "同\t文")]])
        self.assertEqual([e.id for e in result.entries], ["a"])
        self.assertEqual(result.source_groups, {"a": ["议题0", "议题1"]})
        self.assertEqual(result.gaps, [])

    def test_earlier_budget_rejection_can_map_to_later_retained_text(self):
        result = issues.merge_group_results(plans(2), [[entry("long", "同" + " " * 6000 + "文")], [entry("short", "同文")]])
        self.assertEqual([e.id for e in result.entries], ["short"])
        self.assertEqual(result.source_groups, {"short": ["议题0", "议题1"]})
        self.assertEqual(result.gaps, [])

    def test_count_rejection_is_a_gap(self):
        result = issues.merge_group_results(plans(2), [[entry("a", "甲")], [entry("b", "乙")]], max_evidence=1)
        self.assertEqual(result.gaps, ["议题1"])
        self.assertEqual(result.source_groups, {"a": ["议题0"]})

    def test_zero_limits_and_missing_results(self):
        for kwargs in ({"max_evidence": 0}, {"char_budget": 0}):
            with self.subTest(kwargs=kwargs):
                result = issues.merge_group_results(plans(2), [[entry("a", "甲")]], **kwargs)
                self.assertEqual(result.entries, [])
                self.assertEqual(result.gaps, ["议题0", "议题1"])
        result = issues.merge_group_results(plans(2), [])
        self.assertEqual(result.gaps, ["议题0", "议题1"])
        self.assertEqual(issues.merge_group_results([], []).gaps, [])

    def test_round_robin_preserves_representatives(self):
        result = issues.merge_group_results(plans(2), [[entry("a1", "甲"), entry("a2", "丙")], [entry("b1", "乙")]])
        self.assertEqual([e.id for e in result.entries], ["a1", "b1", "a2"])

    def test_full_evidence_keeps_leading_and_trailing_conditions(self):
        text = "仅适用于住房租赁企业。" + "应当妥善退还押金；" * 100 + "但当事人另有约定的除外。"
        source = entry("law", " \n" + text + "\n ")
        self.assertEqual(issues.evidence_snippet(source), text)

    def test_automatic_citation_helper_removed(self):
        self.assertFalse(hasattr(issues, "best_evidence_source"))

    def test_subject_keyword_punctuation_negation_and_conflict_boundaries(self):
        for text, expected in SUBJECT_CASES:
            with self.subTest(text=text):
                self.assertEqual(issues.infer_contract_subject(text), expected)


if __name__ == "__main__":
    unittest.main()
