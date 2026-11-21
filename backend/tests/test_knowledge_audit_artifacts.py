"""构建产物检查回归：临时目录运行真实 Node 脚本，不改工作区数据。"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
NODE = shutil.which("node")


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@unittest.skipUnless(NODE, "Node is required for artifact checker")
class ArtifactAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        scripts = root / "-2/scripts"
        self.data = root / "-2/backend/app/knowledge/data"
        self.site = root / "site/functions/knowledge"
        for path in (scripts, self.data, self.site):
            path.mkdir(parents=True)
        for name in ("check-node.mjs", "check-knowledge-artifacts.mjs", "sync-site-knowledge.mjs"):
            shutil.copy2(ROOT / "scripts" / name, scripts / name)
        self.script = scripts / "check-knowledge-artifacts.mjs"
        self.sync = scripts / "sync-site-knowledge.mjs"
        self.packs = []
        for code in ("CN", "WH"):
            entry = dict(id=code.lower(), title="标题", summary="", text="正文", keywords=["押金"],
                         topics=["deposit"], docType="regulation", appliesTo="all")
            pack = dict(cityCode=code, version="v1", entries=[entry])
            self.packs.append(pack)
            self.write(self.data / f"{code}.json", pack)
        self.bundle = dict(packs=self.packs, contentDigest=digest(self.packs),
                           packDigests={pack["cityCode"]: digest(pack) for pack in self.packs})
        self.vectors = dict(model="offline", dim=2, versions={"CN": "v1", "WH": "v1"},
                            inputDigest=digest([dict(id=code, input="标题\n正文\n押金\ndeposit") for code in ("cn", "wh")]),
                            vectors={"cn": [1, 0], "wh": [0, 1]})
        self.save()

    def write(self, path, value):
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf8")

    def save(self):
        self.write(self.site / "packs.json", self.bundle)
        self.write(self.site / "vectors.json", self.vectors)

    def run_check(self):
        self.save()
        return subprocess.run([NODE, str(self.script)], capture_output=True, text=True, encoding="utf8", timeout=15)

    def assert_fails(self, message):
        result = self.run_check()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(message, result.stderr)

    def test_complete_artifacts_pass(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_missing_digest_is_error_not_warning(self):
        del self.vectors["inputDigest"]
        self.assert_fails("缺少 inputDigest")

    def test_every_vector_length_and_value_checked(self):
        for vector in ([1], [1, None], [1, "2"], [0, 0]):
            with self.subTest(vector=vector):
                self.vectors["vectors"]["wh"] = vector
                self.assert_fails("wh 的向量长度、数值或范数无效")

    def test_missing_city_version_fails(self):
        del self.vectors["versions"]["WH"]
        self.assert_fails("缺少 WH 的版本映射")

    def test_extra_city_version_fails(self):
        self.vectors["versions"]["XX"] = "v1"
        self.assert_fails("不存在的城市版本")

    def test_missing_pack_digest_fails(self):
        del self.bundle["packDigests"]["CN"]
        self.assert_fails("CN 的资料摘要")

    def test_sync_metadata_changes_pack_digest_not_vector_input(self):
        before_vectors = (self.site / "vectors.json").read_bytes()
        before_pack_digest = self.bundle["packDigests"]["CN"]
        self.packs[0]["entries"][0]["appliesTo"] = "enterprise"
        self.write(self.data / "CN.json", self.packs[0])
        result = subprocess.run([NODE, str(self.sync)], capture_output=True, text=True, encoding="utf8", timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("向量输入与版本一致", result.stdout)
        self.assertEqual(before_vectors, (self.site / "vectors.json").read_bytes())
        generated = json.loads((self.site / "packs.json").read_text(encoding="utf8"))
        self.assertNotEqual(before_pack_digest, generated["packDigests"]["CN"])
        self.bundle = generated
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_sync_does_not_claim_stale_vectors_are_current(self):
        self.packs[0]["entries"][0]["text"] = "新文"
        self.write(self.data / "CN.json", self.packs[0])
        result = subprocess.run([NODE, str(self.sync)], capture_output=True, text=True, encoding="utf8", timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("向量输入摘要不一致", result.stdout)
        self.bundle = json.loads((self.site / "packs.json").read_text(encoding="utf8"))
        self.assert_fails("向量输入摘要已变化")


if __name__ == "__main__":
    unittest.main()
