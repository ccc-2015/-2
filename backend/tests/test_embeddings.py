"""向量模型配置：远程 API 与本地兜底的边界、维度校验。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.knowledge import embeddings


def settings(**overrides):
    base = dict(
        embedding_model_name="",
        embedding_api_base_url="",
        embedding_api_key="",
        embedding_dim=512,
        embedding_timeout_ms=15000,
        embedding_batch_size=16,
        model_embedding_name="",
        hf_endpoint="",
        embedding_api_configured=False,
        embedding_local_configured=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class EmbeddingConfigTests(unittest.TestCase):
    def test_remote_requires_all_three(self):
        from app.config import Settings

        only_name = Settings(embedding_model_name="m", embedding_api_base_url="https://x/v1")
        self.assertFalse(only_name.embedding_api_configured)
        full = Settings(
            embedding_model_name="m",
            embedding_api_base_url="https://x/v1",
            embedding_api_key="k",
        )
        self.assertTrue(full.embedding_api_configured)
        self.assertEqual(full.embedding_configured_name, "m")

    def test_local_used_when_remote_missing(self):
        from app.config import Settings

        local = Settings(model_embedding_name="BAAI/bge-small-zh-v1.5")
        self.assertTrue(local.embedding_local_configured)
        self.assertFalse(local.embedding_api_configured)
        self.assertEqual(local.embedding_configured_name, "BAAI/bge-small-zh-v1.5")

    def test_remote_takes_precedence_over_local(self):
        from app.config import Settings

        both = Settings(
            embedding_model_name="remote-embed",
            embedding_api_base_url="https://x/v1",
            embedding_api_key="k",
            model_embedding_name="BAAI/bge-small-zh-v1.5",
        )
        self.assertEqual(both.embedding_configured_name, "remote-embed")


class EmbeddingRuntimeTests(unittest.TestCase):
    def test_remote_called_when_configured(self):
        cfg = settings(
            embedding_model_name="remote-embed",
            embedding_api_base_url="https://x/v1",
            embedding_api_key="k",
            embedding_api_configured=True,
        )
        fake = [[0.0] * 512]
        with patch.object(embeddings, "get_settings", return_value=cfg), patch.object(
            embeddings, "_embed_remote", return_value=fake
        ) as remote:
            result = embeddings.embed_texts(["押金"])
        self.assertEqual(len(result[0]), 512)
        remote.assert_called_once()

    def test_dim_mismatch_raises(self):
        cfg = settings(embedding_model_name="m", embedding_api_configured=True, embedding_dim=512)
        with patch.object(embeddings, "get_settings", return_value=cfg), patch.object(
            embeddings, "_embed_remote", return_value=[[0.0] * 768]
        ):
            with self.assertRaises(RuntimeError):
                embeddings.embed_texts(["押金"])

    def test_no_model_returns_empty(self):
        cfg = settings()
        with patch.object(embeddings, "get_settings", return_value=cfg), patch.object(
            embeddings, "get_embedding_model", return_value=None
        ):
            self.assertEqual(embeddings.embed_texts(["押金"]), [])
            self.assertEqual(embeddings.embed_query("押金"), [])


if __name__ == "__main__":
    unittest.main()
