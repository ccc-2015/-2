"""服务端配置：模型凭据仅此处持有；输入限制由服务端强制执行。"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    model_api_key: str = ""
    model_name: str = ""
    model_api_base_url: str = "https://api.openai.com/v1"
    model_timeout_ms: int = 60000
    # 推理强度：minimal 关闭冗余推理、显著提速（实测 63s→16s）；留空则不发送该参数。
    model_reasoning_effort: str = "minimal"

    # 二期知识库：PostgreSQL + pgvector；未配置 DATABASE_URL 时回退文件型 JSON 知识库。
    knowledge_backend: str = "json"
    database_url: str = ""

    # 向量模型（与文字模型完全独立，不共用 URL/Key）。
    # EMBEDDING_* 三项齐全时走远程 /embeddings；否则回退本地 fastembed（MODEL_EMBEDDING_NAME）。
    embedding_model_name: str = ""
    embedding_api_base_url: str = ""
    embedding_api_key: str = ""
    embedding_dim: int = 512
    embedding_min_score: float = 0.2
    embedding_timeout_ms: int = 15000
    embedding_batch_size: int = 16
    model_embedding_name: str = ""
    hf_endpoint: str = ""

    # 精排序（rerank）：三项独立配置，任一缺失即视为未启用，不回退文字模型。
    rerank_model_name: str = ""
    rerank_api_base_url: str = ""
    rerank_api_key: str = ""
    rerank_timeout_ms: int = 8000
    rerank_candidates: int = 12
    rerank_min_score: float = 0.0

    host: str = "127.0.0.1"
    port: int = 8000

    @property
    def model_configured(self) -> bool:
        return bool(self.model_api_key.strip() and self.model_name.strip())

    @property
    def embedding_api_configured(self) -> bool:
        """远程向量模型：模型名 + 地址 + Key 三者齐全才启用。"""
        return bool(
            self.embedding_model_name.strip()
            and self.embedding_api_base_url.strip()
            and self.embedding_api_key.strip()
        )

    @property
    def embedding_local_configured(self) -> bool:
        return bool(self.model_embedding_name.strip())

    @property
    def embedding_configured(self) -> bool:
        return self.embedding_api_configured or self.embedding_local_configured

    @property
    def local_embedding_model(self) -> str:
        return (self.model_embedding_name or "BAAI/bge-small-zh-v1.5").strip()

    @property
    def embedding_endpoint(self) -> str:
        """允许填 base（.../v1）或完整接口地址（.../v1/embeddings）。"""
        base = (self.embedding_api_base_url or "").rstrip("/")
        if base.endswith("/embeddings"):
            return base
        return f"{base}/embeddings" if base else ""

    @property
    def rerank_endpoint(self) -> str:
        """允许填 base（.../v1）或完整接口地址（.../v1/rerank）。"""
        base = (self.rerank_api_base_url or "").rstrip("/")
        if base.endswith("/rerank"):
            return base
        return f"{base}/rerank" if base else ""

    @property
    def embedding_timeout_seconds(self) -> float:
        value = self.embedding_timeout_ms if self.embedding_timeout_ms > 0 else 15000
        return min(value, 60000) / 1000

    @property
    def embedding_configured_name(self) -> str:
        """写入库里的模型标识，用于判断是否需要重建向量。"""
        return self.embedding_model_name.strip() or self.local_embedding_model

    @property
    def base_url(self) -> str:
        return (self.model_api_base_url or "https://api.openai.com/v1").rstrip("/")

    @property
    def timeout_seconds(self) -> float:
        if self.model_timeout_ms > 0:
            return min(self.model_timeout_ms, 180000) / 1000
        return 60.0

    @property
    def reasoning_effort(self) -> str | None:
        value = (self.model_reasoning_effort or "").strip()
        return value or None

    @property
    def rerank_configured(self) -> bool:
        """精排三项独立配置，缺一即关闭；不继承文字模型的地址与密钥。"""
        return bool(
            self.rerank_model_name.strip()
            and self.rerank_api_base_url.strip()
            and self.rerank_api_key.strip()
        )

    @property
    def rerank_base_url(self) -> str:
        return (self.rerank_api_base_url or "").rstrip("/")

    @property
    def rerank_base_url(self) -> str:
        return (self.rerank_api_base_url or "").rstrip("/")

    @property
    def rerank_key(self) -> str:
        return self.rerank_api_key.strip()

    @property
    def rerank_timeout_seconds(self) -> float:
        value = self.rerank_timeout_ms if self.rerank_timeout_ms > 0 else 8000
        return min(value, 30000) / 1000


@lru_cache
def get_settings() -> Settings:
    return Settings()


# 与前端 shared/api.ts InputLimits 保持一致，由服务端强制执行。
LIMITS: dict = {
    "maxFileBytes": 10 * 1024 * 1024,
    "maxPdfPages": 50,
    "maxTextLength": 50000,
    "maxQuestionLength": 2000,
    "maxConversationTurns": 20,
    "maxEvidenceSelected": 20,
    "maxFactsLength": 4000,
    "supportedFileTypes": ["txt", "md", "markdown", "docx", "pdf", "png", "jpg", "jpeg", "webp"],
}

CITIES: list[dict] = [
    {"code": "ZZ", "name": "郑州"},
    {"code": "CN", "name": "不限 / 全国一般建议"},
    {"code": "BJ", "name": "北京"},
    {"code": "SH", "name": "上海"},
    {"code": "GZ", "name": "广州"},
    {"code": "SZ", "name": "深圳"},
    {"code": "HZ", "name": "杭州"},
    {"code": "CD", "name": "成都"},
    {"code": "WH", "name": "武汉"},
    {"code": "NJ", "name": "南京"},
    {"code": "CQ", "name": "重庆"},
    {"code": "XA", "name": "西安"},
    {"code": "SU", "name": "苏州"},
    {"code": "TJ", "name": "天津"},
    {"code": "CS", "name": "长沙"},
    {"code": "QD", "name": "青岛"},
    {"code": "DL", "name": "大连"},
    {"code": "XM", "name": "厦门"},
    {"code": "HF", "name": "合肥"},
    {"code": "JN", "name": "济南"},
]

_CITY_CODES = {c["code"] for c in CITIES}

PRIVACY_NOTICE = (
    "证据画布仅保存在本机浏览器，清理浏览器数据或更换设备可能丢失，可随时查看与清空；这不是云备份，也不是已验证证据。"
    "合同全文、对话与模型结果默认不自动持久化。导入文件提交到本机后端服务临时解析，点击分析即表示你将所确认的文本提交给模型服务；未经核实不承诺零留存。"
)


def is_city_code(code: str | None) -> bool:
    return not code or code in _CITY_CODES