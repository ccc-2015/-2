"""本机文件提取与 OCR（对应基线 §2/§3.1/§6）。

优先本机处理：TXT/MD/DOCX 提取文字；PDF 先读文本层，扫描页与图片用本地
RapidOCR 识别，不接入第二家 AI/OCR 服务。所有结果须经用户校对确认后才分析。
服务端强制大小/页数/文本长度限制，不静默截断；损坏/加密/空白/超限给明确状态。
"""
from __future__ import annotations

import io
import os
from functools import lru_cache

from ..config import LIMITS
from ..responses import ApiError
from ..schemas import ExtractResult
from ..validation import utf16_length

_IMAGE_EXTS = {"png", "jpg", "jpeg", "webp"}
_TEXT_EXTS = {"txt", "md", "markdown"}


def _detect_kind(filename: str, content_type: str | None) -> str:
    ext = os.path.splitext(filename or "")[1].lower().lstrip(".")
    ct = (content_type or "").lower()
    if ext == "doc":
        raise ApiError("unsupported_file", "仅支持 DOCX，不支持旧版 DOC。请另存为 DOCX，或直接粘贴合同文本。", "file")
    if ext == "txt":
        return "txt"
    if ext in {"md", "markdown"}:
        return "md"
    if ext == "docx":
        return "docx"
    if ext == "pdf":
        return "pdf"
    if ext in _IMAGE_EXTS:
        return "image"
    # 无扩展名时按 Content-Type 兜底
    if "pdf" in ct:
        return "pdf"
    if "wordprocessingml" in ct:
        return "docx"
    if ct.startswith("image/") and any(t in ct for t in ("png", "jpeg", "jpg", "webp")):
        return "image"
    if "markdown" in ct:
        return "md"
    if ct.startswith("text/plain"):
        return "txt"
    supported = "TXT、MD、DOCX、PDF、PNG/JPG/JPEG/WEBP"
    raise ApiError("unsupported_file", f"不支持的文件格式（{ext or '未知'}）。支持：{supported}；也可直接粘贴文本。", "file")


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    try:
        return data.decode("latin-1")
    except UnicodeDecodeError:
        raise ApiError("unsupported_file", "无法识别文本编码，请另存为 UTF-8 或直接粘贴文本。", "file")


@lru_cache
def _ocr_engine():
    # 延迟加载：模型随包本机运行，启动服务不依赖 OCR 就绪。
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


def _ocr_image(img) -> tuple[str, float | None]:
    """对 PIL 图像做本地 OCR，返回识别文本与平均置信度（无可识别内容时为空）。"""
    import numpy as np

    engine = _ocr_engine()
    arr = np.ascontiguousarray(np.array(img.convert("RGB"))[:, :, ::-1])
    try:
        result, _ = engine(arr)
    except Exception:
        raise ApiError("unsupported_file", "本地 OCR 识别失败，请更换更清晰的图片或直接粘贴文本。", "file")
    if not result:
        return "", None
    texts = [str(item[1]) for item in result if len(item) >= 2]
    scores = [float(item[2]) for item in result if len(item) >= 3]
    avg = sum(scores) / len(scores) if scores else None
    return "\n".join(texts), avg


def _extract_txt(data: bytes, kind: str) -> ExtractResult:
    text = _decode_text(data).replace("\r\n", "\n").replace("\r", "\n")
    return ExtractResult(text=text, sourceName="", fileType=kind, method="text", ocrUsed=False)


def _extract_docx(data: bytes) -> ExtractResult:
    from docx import Document
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    try:
        document = Document(io.BytesIO(data))
    except Exception:
        raise ApiError("unsupported_file", "DOCX 文件损坏或无法打开，请检查文件，或直接粘贴合同文本。", "file")

    lines: list[str] = []
    has_table = False
    try:
        for child in document.element.body.iterchildren():
            if child.tag == qn("w:p"):
                lines.append(Paragraph(child, document).text)
            elif child.tag == qn("w:tbl"):
                has_table = True
                table = Table(child, document)
                for row in table.rows:
                    cells = [c.text.strip() for c in row.cells]
                    lines.append(" | ".join(cells))
    except Exception:
        raise ApiError("unsupported_file", "DOCX 内容解析失败，文件可能损坏，请直接粘贴合同文本。", "file")

    warnings = ["DOCX 复杂表格或版式可能影响阅读顺序，请检查段落与表格内容。"] if has_table else []
    return ExtractResult(text="\n".join(lines), sourceName="", fileType="docx", method="text", ocrUsed=False, warnings=warnings)


def _extract_pdf(data: bytes) -> ExtractResult:
    import pymupdf
    from PIL import Image

    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        raise ApiError("unsupported_file", "PDF 文件损坏或无法打开，请检查文件，或直接粘贴合同文本。", "file")

    try:
        if doc.needs_pass:
            raise ApiError("unsupported_file", "PDF 已加密，无法提取。请解密后重试，或直接粘贴合同文本。", "file")
        page_count = doc.page_count
        if page_count > LIMITS["maxPdfPages"]:
            raise ApiError("payload_too_large", f"PDF 共 {page_count} 页，超过 {LIMITS['maxPdfPages']} 页限制。请缩小材料或选择片段，不会被截断。", "file")

        pages: list[dict] = []
        texts: list[str] = []
        ocr_pages = 0
        blank_pages = 0
        low_conf = False
        for i in range(page_count):
            page = doc[i]
            layer = (page.get_text("text") or "").strip()
            if utf16_length(layer) >= 8:
                page_text, method = layer, "text"
            else:
                pix = page.get_pixmap(matrix=pymupdf.Matrix(2, 2))
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                page_text, score = _ocr_image(img)
                page_text = page_text.strip()
                method = "ocr"
                ocr_pages += 1
                if score is not None and score < 0.6:
                    low_conf = True
            if not page_text:
                blank_pages += 1
            pages.append({"page": i + 1, "text": page_text, "method": method})
            texts.append(page_text)
    finally:
        doc.close()

    warnings: list[str] = []
    if ocr_pages:
        warnings.append(f"{ocr_pages} 页为扫描件，已用本地 OCR 识别，请仔细校对错字、漏字与数字。")
    if low_conf:
        warnings.append("部分页面识别置信度较低，请重点核对。")
    if blank_pages:
        warnings.append(f"{blank_pages} 页未提取到文本，可能为空白页或识别失败，请检查。")
    if page_count and not any(p["text"] for p in pages):
        raise ApiError("unsupported_file", "PDF 未提取到任何文本（可能为空白或纯扫描且识别失败），请直接粘贴合同文本。", "file")

    return ExtractResult(
        text="\n\n".join(texts),
        sourceName="",
        fileType="pdf",
        pageCount=page_count,
        pages=pages,
        method="ocr" if ocr_pages else "text",
        ocrUsed=bool(ocr_pages),
        warnings=warnings,
    )


def _extract_image(data: bytes, ext: str) -> ExtractResult:
    from PIL import Image

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        raise ApiError("unsupported_file", "图片损坏或格式无法识别，请更换图片或直接粘贴文本。", "file")

    text, score = _ocr_image(img)
    text = text.strip()
    if not text:
        raise ApiError("unsupported_file", "图片中未识别到文本，请更换更清晰的图片或直接粘贴合同文本。", "file")
    warnings = ["图片已用本地 OCR 识别为草稿文本，请仔细校对错字、漏字与数字后再确认。"]
    if score is not None and score < 0.6:
        warnings.append("识别置信度较低，请重点核对。")
    return ExtractResult(text=text, sourceName="", fileType=ext or "image", method="ocr", ocrUsed=True, warnings=warnings)


def extract_bytes(filename: str, content_type: str | None, data: bytes) -> ExtractResult:
    """纯同步提取入口（在路由中经线程池调用，避免阻塞事件循环）。"""
    if len(data) > LIMITS["maxFileBytes"]:
        mb = LIMITS["maxFileBytes"] // (1024 * 1024)
        raise ApiError("payload_too_large", f"文件超过 {mb}MB 大小限制，请缩小材料或选择片段，不会被截断。", "file")
    if not data:
        raise ApiError("unsupported_file", "文件为空，请重新选择或直接粘贴合同文本。", "file")

    kind = _detect_kind(filename, content_type)
    if kind in _TEXT_EXTS:
        result = _extract_txt(data, "md" if kind == "markdown" else kind)
    elif kind == "docx":
        result = _extract_docx(data)
    elif kind == "pdf":
        result = _extract_pdf(data)
    else:
        ext = os.path.splitext(filename or "")[1].lower().lstrip(".")
        result = _extract_image(data, ext)

    if not result.text.strip():
        raise ApiError("unsupported_file", "未提取到文本（文件可能为空白），请直接粘贴合同文本。", "file")
    if utf16_length(result.text) > LIMITS["maxTextLength"]:
        raise ApiError("payload_too_large", f"提取文本超过 {LIMITS['maxTextLength']} 字符限制，请缩小材料或选择片段，不会被截断。", "file")

    result.sourceName = os.path.basename(filename or "导入文件")
    result.needsReview = True
    return result