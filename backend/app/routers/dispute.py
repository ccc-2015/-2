from fastapi import APIRouter

from ..responses import success
from ..schemas import DiagnoseDisputeInput
from ..services.dispute import diagnose_dispute
from ..validation import validate_dispute_limits

router = APIRouter(prefix="/dispute", tags=["dispute"])


@router.post("/diagnose")
async def diagnose(inp: DiagnoseDisputeInput):
    validate_dispute_limits(inp)
    analysis = await diagnose_dispute(inp)
    return success(
        analysis.result,
        coverage=analysis.coverage,
        warnings=analysis.warnings,
        processing_mode=analysis.processing_mode,
        knowledge_version=analysis.knowledge_version,
    )