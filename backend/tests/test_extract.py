"""文件提取与多文件合并回归：6 份 PDF、扫描件 OCR 缺失、文件数上限。"""
from __future__ import annotations

import io
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.main import app
from app.responses import ApiError


def text_pdf(label: str, pages: int = 2) -> bytes:
    import pymupdf

    doc = pymupdf.open()
    for page_index in range(pages):
        page = doc.new_page()
        page.insert_text((72, 72), f"{label} page {page_index + 1}\nRent contract test text.", fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


def scanned_pdf(label: str) -> bytes:
    import pymupdf

    image = Image.new("RGB", (600, 800), "white")
    ImageDraw.Draw(image).text((40, 60), label, fill="black")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    doc = pymupdf.open()
    page = doc.new_page(width=420, height=560)
    page.insert_image(page.rect, stream=buffer.getvalue())
    data = doc.tobytes()
    doc.close()
    return data


class ExtractMultiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_six_text_pdfs_are_merged(self):
        files = [("files", (f"contract-{i}.pdf", text_pdf(f"part-{i}"), "application/pdf")) for i in range(1, 7)]
        response = self.client.post("/api/extract/multi", files=files)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertEqual(data["sourceName"], "6 份材料")
        self.assertEqual(data["pageCount"], 12)
        self.assertIn("第 1 份：contract-1.pdf", data["text"])
        self.assertIn("第 6 份：contract-6.pdf", data["text"])
        self.assertFalse(data["ocrUsed"])

    def test_scanned_pdf_without_ocr_reports_file_and_page(self):
        def missing_engine():
            raise ApiError(
                "service_not_configured",
                "本机 OCR 组件未安装，无法识别扫描版 PDF 或图片。请改用文本版文件，或直接粘贴合同文本。",
                "file",
            )

        files = [("files", ("scan-1.pdf", scanned_pdf("scan one"), "application/pdf"))]
        with patch("app.services.extract._ocr_engine", missing_engine):
            response = self.client.post("/api/extract/multi", files=files)
        self.assertEqual(response.status_code, 503, response.text)
        error = response.json()["error"]
        self.assertEqual(error["code"], "service_not_configured")
        self.assertIn("scan-1.pdf", error["message"])
        self.assertIn("第 1 页", error["message"])
        self.assertIn("OCR", error["message"])

    @unittest.skipUnless(importlib.util.find_spec("rapidocr_onnxruntime"), "本环境未安装 RapidOCR")
    def test_six_scanned_pdfs_use_local_ocr(self):
        files = [("files", (f"scan-{i}.pdf", scanned_pdf(f"scan page {i}"), "application/pdf")) for i in range(1, 7)]
        response = self.client.post("/api/extract/multi", files=files)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertEqual(data["pageCount"], 6)
        self.assertTrue(data["ocrUsed"])
        self.assertTrue(data["text"].strip())
        self.assertTrue(any("本地 OCR" in warning for warning in data["warnings"]))

    def test_unsupported_file_names_the_file(self):
        files = [("files", ("old-contract.doc", b"legacy", "application/msword"))]
        response = self.client.post("/api/extract/multi", files=files)
        self.assertEqual(response.status_code, 415)
        self.assertIn("old-contract.doc", response.json()["error"]["message"])

    def test_too_many_files_rejected(self):
        files = [("files", (f"c-{i}.txt", b"text", "text/plain")) for i in range(13)]
        response = self.client.post("/api/extract/multi", files=files)
        self.assertEqual(response.status_code, 413)
        self.assertIn("最多上传 12 份", response.json()["error"]["message"])

    def test_merge_over_text_limit_rejected(self):
        huge = "租" * 40000
        files = [
            ("files", ("a.txt", huge.encode("utf-8"), "text/plain")),
            ("files", ("b.txt", huge.encode("utf-8"), "text/plain")),
        ]
        response = self.client.post("/api/extract/multi", files=files)
        self.assertEqual(response.status_code, 413)
        self.assertIn("合并后的合同", response.json()["error"]["message"])


if __name__ == "__main__":
    unittest.main()