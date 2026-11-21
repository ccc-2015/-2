"""一期知识检索审计：纯本地/mock，不读取 .env、不连接数据库或模型。"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
CFG = SimpleNamespace(knowledge_backend="json", embedding_configured=True,
                      embedding_configured_name="test-model", rerank_configured=False,
                      rerank_candidates=10)
# app.knowledge.__init__ 平时会 get_settings()；测试必须在首次导入前隔离。
with patch("app.config.get_settings", return_value=CFG):
    from app.knowledge.models import KnowledgeEntry, KnowledgePack
    from app.knowledge.store import KnowledgeStore
    from app.knowledge import postgres


def entry(source_id="general", **changes):
    data = dict(id=source_id, title="租赁条款", publisher="测试", version="v1",
                checkedAt="2026-01-01", reviewStatus="approved", text="押金退还",
                keywords=["押金"], topics=["deposit"], scope="national")
    data.update(changes)
    return KnowledgeEntry(**data)


def pack(code="CN", entries=None):
    return KnowledgePack(cityCode=code, cityName=code, version="v1", checkedAt="2026-01-01",
                         entries=entries if entries is not None else [entry()])


def row(source):
    data = dict(zip([key.strip() for key in postgres._ENTRY_COLUMNS.strip().split(",")], [
        source.id, "CN", source.title, source.publisher, source.url, source.scope, source.cityCode,
        None, None, None, source.version, __import__("datetime").date(2026, 1, 1), source.reviewStatus,
        source.topics, source.keywords, source.text, source.summary, source.limitations,
        source.docType, source.appliesTo, None,
    ]))
    return data


def pg():
    store = postgres.PostgresKnowledgeStore.__new__(postgres.PostgresKnowledgeStore)
    store.embedding_dim = 2
    store.embedding_model = "test-model"
    store.embedding_min_score = .05
    return store


class JsonAuditTests(unittest.TestCase):
    def test_private_is_filtered_before_topk_and_local_slot(self):
        store = KnowledgeStore()
        for city in ("WH", "ZZ", None):
            result = store.retrieve_groups(city, "2026-11-21", ["押金 租金 资金监管专用账户 转租"],
                                           top_k=1, scenario="contract_review", subject="private")
            self.assertEqual(result.mode, "keyword")
            self.assertTrue(result[0])
            self.assertTrue(all(item.appliesTo != "enterprise" for item in result[0]))
        all_results = store.retrieve("WH", "2026-11-21", "押金 租金 资金监管专用账户 转租", top_k=200)
        unknown = store.retrieve("WH", "2026-11-21", "押金 租金 资金监管专用账户 转租", top_k=200, subject="unknown")
        self.assertEqual(all_results, unknown)
        self.assertIn("wh-rent-reg-22", {item.id for item in unknown})
        self.assertEqual(store.retrieve("WH", None, "押金", top_k=0), [])

    def test_snapshot_tracks_national_and_local_content_without_version_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cn = pack().model_dump()
            wh = pack("WH", [entry("local", scope="city", cityCode="WH")]).model_dump()
            for code, data in (("cn", cn), ("wh", wh)):
                (root / f"{code}.json").write_text(json.dumps(data), encoding="utf8")
            first = KnowledgeStore(root).snapshot_for("WH")
            self.assertIn("CN:v1", first)
            self.assertIn("WH:v1", first)
            cn["entries"][0]["appliesTo"] = "enterprise"
            (root / "cn.json").write_text(json.dumps(cn), encoding="utf8")
            second = KnowledgeStore(root).snapshot_for("WH")
            self.assertNotEqual(first, second)
            wh["entries"][0]["text"] += "变更"
            (root / "wh.json").write_text(json.dumps(wh), encoding="utf8")
            self.assertNotEqual(second, KnowledgeStore(root).snapshot_for("WH"))
            self.assertNotIn("WH:", KnowledgeStore(root).snapshot_for("XX"))

    def test_audited_subjects_do_not_restrict_general_lessor_laws(self):
        entries = {item.id: item for item in KnowledgeStore().entries}
        for source_id in ("cn-housing-lease-reg-19", "wh-rent-reg-22", "zz-rent-reg-24"):
            self.assertEqual(entries[source_id].appliesTo, "enterprise")
        for source_id in ("zz-rent-reg-12", "wh-rent-reg-9", "wh-rent-reg-14",
                          "hz-rent-security-18", "zj-rent-security-19", "cn-housing-lease-reg-20"):
            self.assertEqual(entries[source_id].appliesTo, "all")

    def test_enrichment_uses_obligation_subject_not_doc_type_or_mentions(self):
        spec = importlib.util.spec_from_file_location("audit_enrich", BACKEND.parent / "scripts/enrich_knowledge_metadata.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.applies_to({"title": "某条例", "text": "第十九条 住房租赁企业应当开设账户。"}), "enterprise")
        self.assertEqual(module.applies_to({"title": "某条例", "text": "出租人应当维护安全，与危险化学品企业保持距离。"}), "all")
        self.assertEqual(module.applies_to({"title": "某条例", "text": "住房租赁企业应当登记。个人转租达到数量也应登记。"}), "all")


class PostgresAuditTests(unittest.TestCase):
    def setUp(self):
        self.settings = patch.object(postgres, "get_settings", return_value=CFG)
        self.settings.start()
        self.addCleanup(self.settings.stop)
        self.store = pg()
        self.source = entry()
        self.rows = [row(self.source)]

    def test_sql_filters_current_input_model_and_private_before_limit(self):
        self.store._fetchall = MagicMock(return_value=[])
        self.store._vector_rows("WH", None, "contract_review", [1., 0.], 1, "private")
        sql, params = self.store._fetchall.call_args.args
        self.assertIn("embedding_model = %s", sql)
        self.assertIn("embedding_input_digest = encode(sha256(convert_to", sql)
        self.assertIn("array_to_string(keywords", sql)
        self.assertLess(sql.index("applies_to <> 'enterprise'"), sql.index("LIMIT"))
        self.assertIn("test-model", params)
        where, _ = self.store._filters("WH", None, None, "unknown")
        self.assertNotIn("applies_to", where)

    def test_bad_query_vectors_never_execute_sql(self):
        self.store._fetchall = MagicMock()
        for vector in ([1.], [float("nan"), 0.], [float("inf"), 0.], [0., 0.], [True, 0.]):
            self.assertEqual(self.store._vector_rows(None, None, None, vector, 1), [])
        self.store._fetchall.assert_not_called()

    def test_group_vector_sql_failure_falls_back_and_does_not_rerank(self):
        with patch.object(self.store, "_applicable_rows", return_value=self.rows) as rows, \
             patch.object(postgres, "embed_texts", return_value=[[1., 0.], [1., 0.]]) as embed, \
             patch.object(self.store, "_vector_rows", side_effect=RuntimeError("SQL failure")), \
             patch.object(self.store, "_rerank") as rerank:
            result = self.store.retrieve_groups("WH", None, ["押金", "押金"], subject="private")
        self.assertEqual(result.mode, "keyword")
        self.assertEqual(result, [[self.source], [self.source]])
        rows.assert_called_once_with("WH", None, None, "private")
        embed.assert_called_once()
        rerank.assert_not_called()

    def test_modes_are_request_local_and_require_vector_candidates(self):
        with patch.object(self.store, "_applicable_rows", return_value=self.rows), \
             patch.object(postgres, "embed_texts", return_value=[[1., 0.]]), \
             patch.object(self.store, "_vector_rows", side_effect=[[(self.rows[0], .9)], [], RuntimeError("SQL")]):
            hybrid = self.store.retrieve_groups(None, None, ["押金"])
            empty_vectors = self.store.retrieve_groups(None, None, ["押金"])
            failed = self.store.retrieve_groups(None, None, ["押金"])
        self.assertEqual([hybrid.mode, empty_vectors.mode, failed.mode], ["hybrid", "keyword", "keyword"])
        self.assertEqual(hybrid.mode, "hybrid")
        self.assertIsInstance(hybrid, list)

    def test_embedding_exception_and_single_sql_exception_fall_back(self):
        with patch.object(self.store, "_applicable_rows", return_value=self.rows), \
             patch.object(postgres, "embed_texts", side_effect=RuntimeError("embedding")):
            self.assertEqual(self.store.retrieve_groups("WH", None, ["押金"]).mode, "keyword")
        with patch.object(self.store, "_applicable_rows", return_value=self.rows), \
             patch.object(postgres, "embed_query", return_value=[1., 0.]), \
             patch.object(self.store, "_vector_rows", side_effect=RuntimeError("SQL")), \
             patch.object(self.store, "_rerank", side_effect=RuntimeError("rerank")):
            result = self.store.retrieve(None, None, "押金", subject="private")
        self.assertEqual(result.mode, "keyword")
        self.assertEqual(result, [self.source])

    def test_snapshot_hashes_loaded_rows_instead_of_placeholder_or_local_files(self):
        records = [dict(city_code=code, version="v1", pack_data={"city_code": code, "version": "v1"},
                        entries=[{"id": code, "text": "旧文", "applies_to": "all"}]) for code in ("CN", "WH")]
        self.store._fetchall = MagicMock(return_value=records)
        first = self.store.snapshot_for("WH")
        self.assertIn("CN:v1", first)
        self.assertIn("WH:v1", first)
        self.assertNotIn("postgres", first)
        records[0]["entries"][0]["text"] = "新文"
        self.assertNotEqual(first, self.store.snapshot_for("WH"))
        sql = self.store._fetchall.call_args.args[0]
        self.assertIn("applicable.scope = 'national'", sql)
        self.assertIn("to_jsonb(e)", sql)

    def test_metadata_digest_is_not_embedding_input_digest(self):
        updated = self.source.model_copy(update={"appliesTo": "enterprise", "limitations": "条件", "version": "v2"})
        self.assertEqual(self.store._input_digest(self.source), self.store._input_digest(updated))
        for field in ("title", "summary", "text", "keywords", "topics"):
            value = ["变更"] if field in ("keywords", "topics") else "变更"
            self.assertNotEqual(self.store._input_digest(self.source), self.store._input_digest(self.source.model_copy(update={field: value})))

    def ingest_cursor(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        self.store.pool = MagicMock()
        self.store.pool.connection.return_value.__enter__.return_value = connection
        return cursor

    def test_ingest_upsert_preserves_same_input_and_invalidates_changed_input(self):
        cursor = self.ingest_cursor()
        with patch.object(postgres, "embed_texts") as embed:
            self.store.ingest_packs([pack(entries=[self.source])], embed=False)
        embed.assert_not_called()
        calls = [call.args for call in cursor.execute.call_args_list]
        sql, params = next(call for call in calls if "INSERT INTO knowledge_entries" in call[0])
        self.assertIn("ON CONFLICT (id) DO UPDATE", sql)
        self.assertEqual(sql.count("%s"), len(params))
        for column in ("embedding", "embedding_model", "embedding_input_digest", "embedding_updated_at"):
            self.assertIn(f"WHEN knowledge_entries.embedding_input_digest = EXCLUDED.embedding_input_digest THEN knowledge_entries.{column} ELSE NULL END", sql)
        self.assertIsNone(params[21])
        self.assertIsNone(params[22])
        self.assertEqual(params[23], self.store._input_digest(self.source))
        self.assertNotIn("DELETE FROM knowledge_entries WHERE id", " ".join(call[0] for call in calls))
        self.assertIn("AND NOT (id = ANY(%s))", calls[-1][0])
        # 将三个实际请求参数与 SQL CASE 的保留条件对照，模拟持久向量的生命周期。
        old_digest = params[23]
        old_vector = [1., 0.]
        for changed, preserved in (({"appliesTo": "enterprise"}, True), ({"text": "正文变更"}, False)):
            cursor.reset_mock()
            source = self.source.model_copy(update=changed)
            self.store.ingest_packs([pack("WH", [source])], embed=False)
            insert = next(call.args for call in cursor.execute.call_args_list if "INSERT INTO knowledge_entries" in call.args[0])
            incoming = insert[1]
            kept = old_vector if old_digest == incoming[23] else None
            self.assertEqual(kept is not None, preserved)
            self.assertEqual(incoming[1], "WH")

    def test_ingest_metadata_only_with_embed_enabled_reuses_valid_vector(self):
        self.ingest_cursor()
        self.store._fetchall = MagicMock(return_value=[{"id": self.source.id, "embedding_input_digest": self.store._input_digest(self.source)}])
        with patch.object(postgres, "embed_texts") as embed:
            self.store.ingest_packs([pack(entries=[self.source.model_copy(update={"appliesTo": "enterprise"})])])
        embed.assert_not_called()

    def test_ingest_validates_generated_vectors_before_any_write(self):
        cursor = self.ingest_cursor()
        self.store._fetchall = MagicMock(return_value=[])
        for vectors in ([], [[1.]], [[float("nan"), 0.]], [[0., 0.]]):
            with patch.object(postgres, "embed_texts", return_value=vectors):
                with self.assertRaises(ValueError):
                    self.store.ingest_packs([pack()])
        cursor.execute.assert_not_called()

    def test_schema_adds_nullable_fingerprint_without_destroying_vectors(self):
        cursor = self.ingest_cursor()
        cursor.fetchone.return_value = ("vector(1024)",)
        self.store.ensure_schema()
        sql = "\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn("ADD COLUMN IF NOT EXISTS embedding_input_digest TEXT", sql)
        self.assertNotIn("DROP COLUMN", sql)
        self.assertNotIn("UPDATE knowledge_entries SET embedding_model", sql)
        self.assertNotIn("USING hnsw", sql)


if __name__ == "__main__":
    unittest.main()
