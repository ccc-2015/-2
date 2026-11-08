from fastapi import APIRouter

from ..config import is_city_code
from ..knowledge import knowledge_store
from ..responses import ApiError, success
from ..validation import validate_date

router = APIRouter(tags=["sources"])


@router.get("/sources")
async def get_sources(cityCode: str = "CN", eventDate: str | None = None, scenario: str | None = None):
    if not is_city_code(cityCode):
        raise ApiError("invalid_input", "城市选项无效。", "cityCode")
    validate_date(eventDate, "eventDate")
    entries = knowledge_store.list_sources(cityCode, eventDate, scenario)
    references = [entry.to_source_ref().model_dump() for entry in entries]
    coverage = knowledge_store.coverage_for(cityCode, scenario)
    warnings: list[str] = []
    if not references:
        warnings.append("当前地区暂无可用审核资料。")
    elif coverage == "limited":
        warnings.append("当前地区知识库覆盖有限，缺少本地审核资料。")
    return success(
        references,
        coverage=coverage,
        warnings=warnings,
        processing_mode="knowledge_ai" if references else "ai",
        knowledge_version=knowledge_store.version_for(cityCode),
    )
