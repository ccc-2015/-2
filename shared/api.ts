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
  /** 运行时实际加载的资料版本与内容摘要；旧响应可能没有。 */
  knowledgeSnapshot?: string | null;
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
  pilot?: boolean;
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
  /** 多文件合并时的来源文件名。 */
  sourceName?: string;
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
export type FindingEvidenceStatus = "cited" | "conditional" | "insufficient";
export type DocType = "regulation" | "policy" | "guide";
export type AppliesTo = "all" | "enterprise" | "intermediary" | "lessor" | "unknown";

export interface Excerpt {
  text: string;
  start: number;
  end: number;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/** 前端压缩的会话记忆：服务端只用于本轮提示词，不落库。 */
export interface ContractMemory {
  summary: string;
  facts: string[];
  decisions: string[];
  openQuestions: string[];
}

export interface AnalyzeContractInput {
  apiVersion?: ApiVersion;
  cityCode?: string;
  eventDate?: string | null;
  text: string;
  textScope: "full" | "excerpt";
  question: string;
  conversation: ConversationTurn[];
  memory?: ContractMemory | null;
  intent: ContractIntent;
  targetExcerpt?: Excerpt | null;
}

export interface EvidenceSnippet {
  sourceId: string;
  text: string;
}

export interface Finding {
  priority: FindingPriority;
  issue: string;
  impact: string;
  excerpt: Excerpt | null;
  suggestedQuestion: string;
  uncertainties: string[];
  sourceRefs: string[];
  /** 对应检索议题，不是法律分类认证。 */
  topicId?: string | null;
  topicLabel?: string | null;
  evidenceStatus?: FindingEvidenceStatus;
  evidenceSnippets?: EvidenceSnippet[];
}

export interface Revision {
  kind: "modify" | "add";
  /** 对应条款位置，例如「第五条」；新增条款填「新增条款」。 */
  clauseLabel: string;
  /** 这一条要解决的问题，例如「提前退租押金」。 */
  title: string;
  text: string;
  targetExcerpt: Excerpt | null;
  /** 为什么这样改，便于用户判断是否勾选。 */
  reason: string;
  /** 需要与对方确认或补填的事项（金额、期限等）。 */
  uncertainties: string[];
}

export interface SourceRef {
  id: string;
  title: string;
  publisher: string;
  url: string | null;
  cityCode: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  textAvailableFrom?: string | null;
  version: string;
  checkedAt: string;
  excerpt: string;
  docType?: DocType | null;
  appliesTo?: AppliesTo | null;
}

export interface ContractResult {
  answer: string;
  coverage: Coverage;
  /** 预置示例结果：未调用模型，界面需明确标注。 */
  preset?: boolean;
  findings: Finding[];
  revision: Revision | null;
  /** 完整修订清单；旧数据可能只有 revision，前端需回退兼容。 */
  revisions: Revision[];
  followUpQuestions: string[];
  /** 本次回答实际引用的资料。 */
  references: SourceRef[];
  /** 本次检索召回的全部资料（含未引用），用于展示知识库覆盖。 */
  retrieved?: SourceRef[];
}

// ---- dispute ----
export type EvidenceStatus = "present" | "missing" | "to_confirm";

export interface SelectedEvidence {
  evidenceId: string;
  occurredAt: string | null;
  description: string;
  status: EvidenceStatus;
  /** 以下为可选结构化信息，用于让话术直接引用已存材料。 */
  materialName?: string;
  materialType?: string;
  amountCents?: number | null;
  contractClause?: string;
  content?: string;
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

export type Eligibility = "general_only" | "local_verified";

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
  references: SourceRef[];
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

export const FINDING_EVIDENCE_LABELS: Record<FindingEvidenceStatus, string> = {
  cited: "有相关资料",
  conditional: "需确认适用条件",
  insufficient: "依据不足",
};

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  regulation: "法规",
  policy: "政策",
  guide: "办事资料",
};

export const APPLIES_TO_LABELS: Record<AppliesTo, string> = {
  all: "一般适用",
  enterprise: "住房租赁企业",
  intermediary: "中介机构",
  lessor: "出租人",
  unknown: "适用主体待确认",
};

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  present: "已有",
  missing: "缺失",
  to_confirm: "待确认",
};