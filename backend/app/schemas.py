"""Pydantic 模型：与前端 shared/api.ts 契约一致。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Coverage = Literal["supported", "limited", "unsupported"]
FindingPriority = Literal["confirm_first", "needs_attention", "insufficient_info"]
ContractIntent = Literal["ask", "review", "suggest_revision", "draft_revision"]
EvidenceStatus = Literal["present", "missing", "to_confirm"]
FindingEvidenceStatus = Literal["cited", "conditional", "insufficient"]


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Excerpt(_Base):
    text: str
    start: int
    end: int


class ConversationTurn(_Base):
    role: Literal["user", "assistant"]
    content: str


class ContractMemory(_Base):
    """前端压缩的会话记忆，仅用于本轮提示词，服务端不落库。"""

    summary: str = ""
    facts: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    openQuestions: list[str] = Field(default_factory=list)


class AnalyzeContractInput(_Base):
    apiVersion: str | None = None
    cityCode: str | None = None
    eventDate: str | None = None
    text: str
    textScope: Literal["full", "excerpt"] = "full"
    question: str = ""
    conversation: list[ConversationTurn] = Field(default_factory=list)
    memory: ContractMemory | None = None
    intent: ContractIntent
    targetExcerpt: Excerpt | None = None


class EvidenceSnippet(_Base):
    sourceId: str
    text: str


class Finding(_Base):
    priority: FindingPriority = "needs_attention"
    issue: str
    impact: str = ""
    excerpt: Excerpt | None = None
    suggestedQuestion: str = ""
    uncertainties: list[str] = Field(default_factory=list)
    sourceRefs: list[str] = Field(default_factory=list)
    topicId: str | None = None
    topicLabel: str | None = None
    evidenceStatus: FindingEvidenceStatus = "insufficient"
    evidenceSnippets: list[EvidenceSnippet] = Field(default_factory=list)


class Revision(_Base):
    kind: Literal["modify", "add"] = "modify"
    clauseLabel: str = ""
    title: str = ""
    text: str
    targetExcerpt: Excerpt | None = None
    reason: str = ""
    uncertainties: list[str] = Field(default_factory=list)


class ModelContractFinding(_Base):
    model_config = ConfigDict(extra="ignore", strict=True)

    priority: FindingPriority
    issue: str
    impact: str
    excerpt: Excerpt | None
    suggestedQuestion: str
    uncertainties: list[str]
    sourceRefs: list[str]
    topicId: str | None = None
    evidenceStatus: FindingEvidenceStatus | None = None


class ModelContractRevision(_Base):
    model_config = ConfigDict(extra="ignore", strict=True)

    kind: Literal["modify", "add"]
    clauseLabel: str
    title: str
    text: str
    targetExcerpt: Excerpt | None
    reason: str
    uncertainties: list[str]


class ModelContractOutput(_Base):
    model_config = ConfigDict(extra="ignore", strict=True)

    answer: str
    sourceRefs: list[str]
    findings: list[ModelContractFinding]
    revisions: list[ModelContractRevision]
    followUpQuestions: list[str]


class SourceRef(_Base):
    id: str
    title: str
    publisher: str
    url: str | None = None
    cityCode: str | None = None
    effectiveFrom: str | None = None
    effectiveTo: str | None = None
    textAvailableFrom: str | None = None
    version: str
    checkedAt: str
    excerpt: str
    docType: Literal["regulation", "policy", "guide"] | None = None
    appliesTo: Literal["all", "enterprise", "intermediary", "lessor", "unknown"] | None = None


class ContractResult(_Base):
    answer: str
    coverage: Coverage = "limited"
    findings: list[Finding] = Field(default_factory=list)
    revision: Revision | None = None
    revisions: list[Revision] = Field(default_factory=list)
    followUpQuestions: list[str] = Field(default_factory=list)
    references: list[SourceRef] = Field(default_factory=list)
    retrieved: list[SourceRef] = Field(default_factory=list)


class SelectedEvidence(_Base):
    evidenceId: str
    occurredAt: str | None = None
    description: str = ""
    status: EvidenceStatus = "to_confirm"
    materialName: str = ""
    materialType: str = ""
    amountCents: int | None = None
    contractClause: str = ""
    content: str = ""


class DiagnoseDisputeInput(_Base):
    apiVersion: str | None = None
    cityCode: str | None = None
    eventDate: str | None = None
    issue: str
    counterparty: str = ""
    goal: str = ""
    facts: str = ""
    amountCents: int | None = Field(default=None, ge=0)
    selectedEvidence: list[SelectedEvidence] = Field(default_factory=list)
    priorAction: str = ""
    selectedChannelId: str | None = None


class Recommendation(_Base):
    channelId: str | None = None
    title: str
    eligibility: Literal["general_only", "local_verified"] = "general_only"
    reason: str = ""
    preparations: list[str] = Field(default_factory=list)
    sourceRefs: list[str] = Field(default_factory=list)


class DisputeScript(_Base):
    text: str
    placeholders: list[str] = Field(default_factory=list)


class DisputeResult(_Base):
    factsSummary: list[str] = Field(default_factory=list)
    missingFacts: list[str] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)
    script: DisputeScript | None = None
    references: list[SourceRef] = Field(default_factory=list)


class CityOption(_Base):
    code: str
    name: str
    pilot: bool = False


class AppConfig(_Base):
    apiVersion: str = "1"
    productName: str = "租住有据"
    cities: list[CityOption]
    features: dict
    limits: dict
    aiAvailable: bool
    privacyNotice: str


class ExtractResult(_Base):
    text: str
    sourceName: str
    fileType: str
    pageCount: int | None = None
    pages: list[dict] = Field(default_factory=list)
    method: Literal["text", "ocr"] = "text"
    ocrUsed: bool = False
    warnings: list[str] = Field(default_factory=list)
    needsReview: bool = True