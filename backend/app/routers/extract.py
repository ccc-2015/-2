from fastapi import APIRouter, File, UploadFile
from fastapi.concurrency import run_in_threadpool

from ..config import LIMITS
from ..responses import ApiError, success
from ..schemas import ExtractResult
from ..services.extract import extract_bytes
from ..validation import utf16_length

router = APIRouter(tags=["extract"])

MAX_FILES = 12
SEPARATOR = chr(10) * 2


def _merge(results: list[tuple[str, ExtractResult]]) -> ExtractResult:
    """把多份材料按上传顺序拼成一份合同文本，页码连续编号。"""
    texts: list[str] = []
    pages: list[dict] = []
    warnings: list[str] = []
    ocr_used = False
    offset = 0
    for index, (name, result) in enumerate(results, start=1):
        if len(results) > 1:
            texts.append(f"——第 {index} 份：{name}——")
        texts.append(result.text)
        for page in result.pages or []:
            pages.append({**page, "page": offset + int(page.get("page") or 1)})
        offset += max(len(result.pages or []), result.pageCount or 0)
        warnings.extend(f"{name}：{warning}" for warning in result.warnings)
        ocr_used = ocr_used or result.ocrUsed
    merged = SEPARATOR.join(texts)
    if utf16_length(merged) > LIMITS["maxTextLength"]:
        raise ApiError(
            "payload_too_large",
            f"合并后的合同超过 {LIMITS['maxTextLength']} 字符限制，请分次审查或精简材料。",
            "files",
        )
    return ExtractResult(
        text=merged,
        sourceName=results[0][1].sourceName if len(results) == 1 else f"{len(results)} 份材料",
        fileType=results[0][1].fileType,
        pageCount=offset or None,
        pages=pages,
        method="ocr" if ocr_used else "text",
        ocrUsed=ocr_used,
        warnings=warnings,
        needsReview=True,
    )


@router.post("/extract")
async def extract(file: UploadFile = File(...)):
    # 只读取上限+1 字节即可判定超限，避免把超大文件整体载入内存。
    data = await file.read(LIMITS["maxFileBytes"] + 1)
    if len(data) > LIMITS["maxFileBytes"]:
        mb = LIMITS["maxFileBytes"] // (1024 * 1024)
        raise ApiError("payload_too_large", f"文件超过 {mb}MB 大小限制，请缩小材料或选择片段，不会被截断。", "file")
    result = await run_in_threadpool(extract_bytes, file.filename or "", file.content_type, data)
    return success(result, coverage="limited", warnings=result.warnings)


@router.post("/extract/multi")
async def extract_multi(files: list[UploadFile] = File(...)):
    """多份图片/PDF 合同：按上传顺序提取并合并为一份文本。"""
    if not files:
        raise ApiError("invalid_input", "请至少选择一个文件。", "files")
    if len(files) > MAX_FILES:
        raise ApiError("payload_too_large", f"一次最多上传 {MAX_FILES} 份材料。", "files")

    results: list[tuple[str, ExtractResult]] = []
    for upload in files:
        data = await upload.read(LIMITS["maxFileBytes"] + 1)
        if len(data) > LIMITS["maxFileBytes"]:
            mb = LIMITS["maxFileBytes"] // (1024 * 1024)
            raise ApiError("payload_too_large", f"文件超过 {mb}MB 大小限制，请缩小后再上传。", "files")
        result = await run_in_threadpool(extract_bytes, upload.filename or "", upload.content_type, data)
        results.append((result.sourceName, result))

    merged = _merge(results)
    return success(merged, coverage="limited", warnings=merged.warnings)
