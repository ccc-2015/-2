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
    host: str = "127.0.0.1"
    port: int = 8000

    @property
    def model_configured(self) -> bool:
        return bool(self.model_api_key.strip() and self.model_name.strip())

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
    {"code": "ZZ", "name": "郑州"},
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