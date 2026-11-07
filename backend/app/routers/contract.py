from fastapi import APIRouter

from ..responses import success
from ..schemas import AnalyzeContractInput
from ..services.contract import analyze_contract
from ..validation import validate_analyze_limits

router = APIRouter(prefix="/contract", tags=["contract"])


@router.post("/analyze")
async def analyze(inp: AnalyzeContractInput):
    validate_analyze_limits(inp)
    result = await analyze_contract(inp)
    return success(
        result,
        coverage=result.coverage,
        warnings=["AI 辅助意见，一期无自有审核知识库，不作确定性法律结论；引文已由服务端核验。"],
    )