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

export interface ContractDoc {
  text: string;
  sourceName: string;
  meta: DocumentMeta;
}

export interface Exchange {
  id: string;
  question: string;
  intent: ContractIntent;
  auto?: boolean; // 上传/粘贴后自动发起的首轮审查，界面只显示合同卡片
  docText?: string; // 本次请求使用的合同文本快照，供修订副本使用
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
  originalText: string;
  /** 本次修订的起点：可能已包含前面应用的修改。 */
  baseText: string;
  copy: string;
  applied: string[];
  selected: string[];
  notice: string;
  archiveNotice: string;
  archivedId: string | null;
  result: ContractResult | null;
  error: ApiError | null;
  loading: boolean;
  /** 流式阶段：reading/retrieving/generating，用于展示真实进度。 */
  stage?: "reading" | "retrieving" | "generating" | null;
  /** 已流式返回的回答正文，结束后由 result.answer 覆盖。 */
  partialAnswer?: string;
}

