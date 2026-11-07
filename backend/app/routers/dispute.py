from fastapi import APIRouter

from ..responses import success
from ..schemas import DiagnoseDisputeInput
from ..services.dispute import diagnose_dispute
from ..validation import validate_dispute_limits

router = APIRouter(prefix="/dispute", tags=["dispute"])


@router.post("/diagnose")
async def diagnose(inp: DiagnoseDisputeInput):
    validate_dispute_limits(inp)
    result = await diagnose_dispute(inp)
    return success(
        result,
        coverage="limited",
        warnings=["一期仅提供一般处理方向，本地渠道与资格待核实；话术须由用户核对后自行提交。"],
    )