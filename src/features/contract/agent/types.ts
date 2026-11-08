import type { ApiError } from "../../../lib/api";
import type {
  ContractIntent,
  ContractResult,
  Excerpt,
  ExtractPage,
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
}

/** 修订副本状态按消息 id 保存在页面级，关闭抽屉不丢。 */
export interface RevisionDraft {
  exchangeId: string;
  originalText: string;
  copy: string;
  applied: string[];
  selected: string[];
  notice: string;
  archiveNotice: string;
  archivedId: string | null;
  result: ContractResult | null;
  error: ApiError | null;
  loading: boolean;
}

export interface RevisionSuggestion {
  id: string;
  text: string;
  targetExcerpt: Excerpt | null;
}

export function defaultQuestion(intent: ContractIntent): string {
  if (intent === "review") return "请审查这份合同。";
  if (intent === "suggest_revision") return "请给出修改建议。";
  if (intent === "draft_revision") return "请起草修订条款。";
  return "";
}
