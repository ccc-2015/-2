from fastapi import APIRouter

from ..config import CITIES, LIMITS, PRIVACY_NOTICE, get_settings
from ..knowledge import knowledge_store
from ..responses import success
from ..schemas import AppConfig, CityOption

router = APIRouter(tags=["config"])


@router.get("/config")
async def get_config():
    settings = get_settings()
    config = AppConfig(
        cities=[CityOption(**c) for c in CITIES],
        features={
            "contractReview": True,
            "evidenceCanvas": True,
            "dispute": True,
            "knowledgeBase": knowledge_store.available,
        },
        limits=LIMITS,
        aiAvailable=settings.model_configured,
        privacyNotice=PRIVACY_NOTICE,
    )
    return success(config, coverage="supported")