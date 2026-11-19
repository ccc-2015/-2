import type { ApiError } from "../../../lib/api";
import type {
  ContractIntent,
  ContractResult,
  Excerpt,
  ExtractPage,
  Finding,
  ResponseMeta,
} from "@/shared/api";

export interface DocumentMeta {
  warnings: string[];
  pageCount: number | null;
  method: "text" | "ocr";
  ocrUsed: boolean;
  pages: ExtractPage[];
}

export const PASTE_META: DocumentMeta = {
  warnings: [],
  pageCount: null,
  method: "text",
  ocrUsed: false,
  pages: [],
};

export interface ContractVersion {
  id: string;
  text: string;
  sourceName: string;
  meta: DocumentMeta;
  createdAt: string;
  /** 对用户展示的版本号，例如 v1、v2。 */
  label: string;
}

export interface ContractDoc {
  text: string;
  sourceName: string;
  meta: DocumentMeta;
  /** 当前文本对应的版本；每次请求都会确保文本有独立版本。 */
  versionId: string;
}

/** 新上传/粘贴的合同文本，版本号由会话建立时生成。 */
export type ContractDraft = Omit<ContractDoc, "versionId">;

export interface Exchange {
  id: string;
  question: string;
  intent: ContractIntent;
  auto?: boolean; // 上传/粘贴后自动发起的首轮审查，界面只显示合同卡片
  docText?: string; // 本次请求使用的合同文本快照，定位与导出都以它为准
  docVersionId?: string; // 绑定本次审查使用的合同版本
  /** 展示给用户的问题与真正发给模型的问题可以不同（如携带风险清单）。 */
  prompt?: string;
  /** 修订请求对应的原审查消息，用于复查时核对原问题。 */
  sourceExchangeId?: string;
  result: ContractResult | null;
  meta: ResponseMeta | null; // 二期知识库版本与警告从这里取
  error: ApiError | null;
  loading: boolean;
  /** 流式阶段：reading/retrieving/generating，用于展示真实进度。 */
  stage?: "reading" | "retrieving" | "generating" | null;
  /** 已流式返回的回答正文，结束后由 result.answer 覆盖。 */
  partialAnswer?: string;
  /** 已流式推送的风险卡，结束后由 result.findings 覆盖。 */
  streamFindings?: Finding[];
}

/** 修订副本状态按消息 id 保存在页面级，关闭抽屉不丢。 */
export interface RevisionDraft {
  exchangeId: string;
  /** 协商稿所基于的合同版本。 */
  versionId: string;
  versionLabel: string;
  /** 触发修订的那次审查消息，用于核对原问题是否仍存在。 */
  sourceExchangeId: string;
  originalText: string;
  /** 本次修订的起点：可能已包含前面应用的修改。 */
  baseText: string;
  copy: string;
  applied: string[];
  /** 采纳时实际写入副本的文本，用于可靠撤销。 */
  appliedTexts: Record<string, string>;
  selected: string[];
  notice: string;
  archiveNotice: string;
  archivedId: string | null;
  signedNotice: string;
  signedRecordId: string | null;
  result: ContractResult | null;
  error: ApiError | null;
  loading: boolean;
  /** 流式阶段：reading/retrieving/generating，用于展示真实进度。 */
  stage?: "reading" | "retrieving" | "generating" | null;
  /** 已流式返回的回答正文，结束后由 result.answer 覆盖。 */
  partialAnswer?: string;
}

export interface RevisionSuggestion {
  id: string;
  kind: "modify" | "add";
  clauseLabel: string;
  title: string;
  text: string;
  targetExcerpt: Excerpt | null;
  reason: string;
  uncertainties: string[];
}

