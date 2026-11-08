from ..config import get_settings
from .store import KnowledgeStore

settings = get_settings()

if settings.knowledge_backend.strip().lower() == "postgres":
    from .postgres import PostgresKnowledgeStore

    knowledge_store = PostgresKnowledgeStore(settings.database_url)
else:
    knowledge_store = KnowledgeStore()

__all__ = ["knowledge_store"]
