// 租住有据 API 契约（前后端共享）。严格对应《开发基线.md》§5。
// 日期 YYYY-MM-DD|null；金额整数分或 null（null 不等于零）；文本长度按 UTF-16 code unit。

export type ApiVersion = "1" | "2";
export type Coverage = "supported" | "limited" | "unsupported";
export type ProcessingMode = "ai" | "knowledge_ai";

export interface ResponseMeta {
  apiVersion: ApiVersion;
  requestId: string;
  generatedAt: string;
  processingMode: ProcessingMode;
  coverage: Coverage;
  knowledgeVersion: string | null;
  warnings: string[];
}

export interface Success<T> {
  ok: true;
  data: T;
  meta: ResponseMeta;
}

export interface Failure {
  ok: false;
  requestId: string;
  error: { code: string; message: string; retryable: boolean };
}

export type Envelope<T> = Success<T> | Failure;

// ---- config ----
export interface CityOption {
  code: string;
  name: string;
}

export interface InputLimits {
  maxFileBytes: number;
  maxPdfPages: number;
  maxTextLength: number;
  maxQuestionLength: number;
  maxConversationTurns: number;
  maxEvidenceSelected: number;
  maxFactsLength: number;
  supportedFileTypes: string[];
}

export interface AppConfig {
  apiVersion: ApiVersion;
  productName: string;
  cities: CityOption[];
  features: {
    contractReview: boolean;
    evidenceCanvas: boolean;
    dispute: boolean;
    knowledgeBase: boolean;
  };
  limits: InputLimits;
  aiAvailable: boolean;
  privacyNotice: string;
}

// ---- extract（文件提取/OCR）----
export type ExtractMethod = "text" | "ocr";

export interface ExtractPage {
  page: number;
  text: string;
  method: ExtractMethod;
}

export interface ExtractResult {
  text: string;
  sourceName: string;
  fileType: string;
  pageCount: number | null;
  pages: ExtractPage[];
  method: ExtractMethod;
  ocrUsed: boolean;
  warnings: string[];
  needsReview: boolean;
}

// ---- contract ----
export type ContractIntent = "ask" | "review" | "suggest_revision" | "draft_revision";
export type FindingPriority = "confirm_first" | "needs_attention" | "insufficient_info";

export interface Excerpt {
  text: string;
  start: number;
  end: number;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AnalyzeContractInput {
  apiVersion?: ApiVersion;
  cityCode?: string;
  eventDate?: string | null;
  text: string;
  textScope: "full" | "excerpt";
  question: string;
  conversation: ConversationTurn[];
  intent: ContractIntent;
  targetExcerpt?: Excerpt | null;
}

export interface Finding {
  priority: FindingPriority;
  issue: string;
  impact: string;
  excerpt: Excerpt | null;
  suggestedQuestion: string;
  uncertainties: string[];
  sourceRefs: string[];
}

export interface Revision {
  text: string;
  targetExcerpt: Excerpt | null;
}

export interface SourceRef {
  id: string;
  title: string;
  publisher: string;
  url: string | null;
  cityCode: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  version: string;
  checkedAt: string;
  excerpt: string;
}

export interface ContractResult {
  answer: string;
  coverage: Coverage;
  findings: Finding[];
  revision: Revision | null;
  followUpQuestions: string[];
  references: SourceRef[];
}

// ---- dispute ----
export type EvidenceStatus = "present" | "missing" | "to_confirm";

export interface SelectedEvidence {
  evidenceId: string;
  occurredAt: string | null;
  description: string;
  status: EvidenceStatus;
}

export interface DiagnoseDisputeInput {
  apiVersion?: ApiVersion;
  cityCode?: string;
  eventDate?: string | null;
  issue: string;
  counterparty: string;
  goal: string;
  facts: string;
  amountCents: number | null;
  selectedEvidence: SelectedEvidence[];
  priorAction: string;
  selectedChannelId: string | null;
}

export type Eligibility = "general_only";

export interface Recommendation {
  channelId: string | null;
  title: string;
  eligibility: Eligibility;
  reason: string;
  preparations: string[];
  sourceRefs: string[];
}

export interface DisputeScript {
  text: string;
  placeholders: string[];
}

export interface DisputeResult {
  factsSummary: string[];
  missingFacts: string[];
  recommendations: Recommendation[];
  script: DisputeScript | null;
}

// ---- 错误码（基线 §6）----
export type ErrorCode =
  | "invalid_input"
  | "payload_too_large"
  | "unsupported_file"
  | "rate_limited"
  | "service_not_configured"
  | "service_unavailable"
  | "upstream_timeout"
  | "upstream_invalid"
  | "method_not_allowed"
  | "unknown_action"
  | "internal_error";

export const PRIORITY_LABELS: Record<FindingPriority, string> = {
  confirm_first: "建议优先确认",
  needs_attention: "需要关注",
  insufficient_info: "信息不足",
};

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  present: "已有",
  missing: "缺失",
  to_confirm: "待确认",
};