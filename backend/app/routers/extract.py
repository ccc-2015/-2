from fastapi import APIRouter, File, UploadFile
from fastapi.concurrency import run_in_threadpool

from ..config import LIMITS
from ..responses import ApiError, success
from ..services.extract import extract_bytes

router = APIRouter(tags=["extract"])


@router.post("/extract")
async def extract(file: UploadFile = File(...)):
    # 只读取上限+1 字节即可判定超限，避免把超大文件整体载入内存。
    data = await file.read(LIMITS["maxFileBytes"] + 1)
    if len(data) > LIMITS["maxFileBytes"]:
        mb = LIMITS["maxFileBytes"] // (1024 * 1024)
        raise ApiError("payload_too_large", f"文件超过 {mb}MB 大小限制，请缩小材料或选择片段，不会被截断。", "file")
    result = await run_in_threadpool(extract_bytes, file.filename or "", file.content_type, data)
    return success(result, coverage="limited", warnings=result.warnings)