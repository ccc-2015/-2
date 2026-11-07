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
  reviewed: boolean; // OCR 识别须由用户显式核对后才能发送
}

export interface Exchange {
  id: string;
  question: string;
  intent: ContractIntent;
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

export const QUICK_ACTIONS: { id: ContractIntent; label: string }[] = [
  { id: "review", label: "整体审查" },
  { id: "suggest_revision", label: "修改建议" },
  { id: "draft_revision", label: "起草修订" },
];

export const INTENT_LABELS: Record<ContractIntent, string> = {
  ask: "追问",
  review: "整体审查",
  suggest_revision: "修改建议",
  draft_revision: "起草修订",
};

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
