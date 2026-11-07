import type { ApiError } from "../../../lib/api";
import type {
  ContractIntent,
  ContractResult,
  ConversationTurn,
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
  result: ContractResult | null;
  meta: ResponseMeta | null; // 二期知识库版本与警告从这里取
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

/** 后端最多接收 20 轮对话，这里只带最近的部分。 */
export function buildConversation(list: Exchange[], maxTurns = 20): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const exchange of list) {
    if (exchange.result) {
      turns.push({ role: "user", content: exchange.question });
      turns.push({ role: "assistant", content: exchange.result.answer });
    }
  }
  return turns.slice(-maxTurns);
}
