"""知识库数据模型：审核资料条目、城市资料包与来源引用。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..schemas import SourceRef

ReviewStatus = Literal["draft", "source_verified", "approved"]
Scope = Literal["national", "city"]
Coverage = Literal["supported", "limited", "unsupported"]


class ChannelProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    title: str
    eligibility: Literal["general_only", "local_verified"] = "general_only"
    responsibilities: list[str] = Field(default_factory=list)
    conditions: list[str] = Field(default_factory=list)
    materials: list[str] = Field(default_factory=list)


class KnowledgeEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    title: str
    publisher: str
    url: str | None = None
    scope: Scope = "national"
    cityCode: str | None = None
    effectiveFrom: str | None = None
    effectiveTo: str | None = None
    version: str
    checkedAt: str
    reviewStatus: ReviewStatus = "draft"
    topics: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    text: str
    summary: str = ""
    limitations: str = ""
    channel: ChannelProfile | None = None

    def to_source_ref(self) -> SourceRef:
        return SourceRef(
            id=self.id,
            title=self.title,
            publisher=self.publisher,
            url=self.url,
            cityCode=self.cityCode,
            effectiveFrom=self.effectiveFrom,
            effectiveTo=self.effectiveTo,
            version=self.version,
            checkedAt=self.checkedAt,
            excerpt=self.text,
        )


class KnowledgePack(BaseModel):
    model_config = ConfigDict(extra="ignore")

    cityCode: str
    cityName: str
    version: str
    coverage: Coverage = "limited"
    topicCoverage: dict[str, Coverage] = Field(default_factory=dict)
    checkedAt: str
    entries: list[KnowledgeEntry] = Field(default_factory=list)
