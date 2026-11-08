from fastapi import APIRouter

from ..responses import success
from ..schemas import AnalyzeContractInput
from ..services.contract import analyze_contract
from ..validation import validate_analyze_limits

router = APIRouter(prefix="/contract", tags=["contract"])


@router.post("/analyze")
async def analyze(inp: AnalyzeContractInput):
    validate_analyze_limits(inp)
    analysis = await analyze_contract(inp)
    return success(
        analysis.result,
        coverage=analysis.result.coverage,
        warnings=analysis.warnings,
        processing_mode=analysis.processing_mode,
        knowledge_version=analysis.knowledge_version,
    )
