import { newId } from "../../evidence/store";
import type { ContractDoc, Exchange, RevisionDraft } from "./types";

/** 合同页的唯一状态所有者：文档、对话、修订副本都挂在这里，历史保存直接序列化它。 */
export interface ContractSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  doc: ContractDoc | null;
  exchanges: Exchange[];
  revisionDrafts: Record<string, RevisionDraft>;
  signingDate: string;
  textRecordId: string | null;
  saveNotice: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: number;
  docName: string | null;
  chars: number;
}

export function emptySession(): ContractSession {
  const now = new Date().toISOString();
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    doc: null,
    exchanges: [],
    revisionDrafts: {},
    signingDate: "",
    textRecordId: null,
    saveNotice: "",
  };
}

export function sessionHasContent(session: ContractSession): boolean {
  return !!session.doc || session.exchanges.some((exchange) => exchange.result);
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function sessionTitle(session: ContractSession): string {
  if (session.doc) {
    if (session.doc.sourceName && session.doc.sourceName !== "粘贴文本") return clip(session.doc.sourceName, 40);
    return clip(session.doc.text, 24) || "粘贴的合同";
  }
  const first = session.exchanges.find((exchange) => exchange.result);
  return first ? clip(first.question, 40) : "新对话";
}

export function summarize(session: ContractSession): SessionSummary {
  return {
    id: session.id,
    title: sessionTitle(session),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    turns: session.exchanges.filter((exchange) => exchange.result).length,
    docName: session.doc?.sourceName ?? null,
    chars: session.doc?.text.length ?? 0,
  };
}

/** 落盘前清掉请求中间态，避免刷新后恢复出转圈或错误气泡。 */
export function toStoredSession(session: ContractSession): ContractSession {
  const docText = session.doc?.text ?? "";
  const exchanges = session.exchanges
    .filter((exchange) => exchange.result)
    .map((exchange) => ({
      ...exchange,
      loading: false,
      error: null,
      docText: exchange.docText === docText ? undefined : exchange.docText,
    }));
  const keep = new Set(exchanges.map((exchange) => exchange.id));
  const revisionDrafts: Record<string, RevisionDraft> = {};
  for (const [id, draft] of Object.entries(session.revisionDrafts)) {
    if (keep.has(id)) revisionDrafts[id] = { ...draft, loading: false, error: null };
  }
  return { ...session, exchanges, revisionDrafts, saveNotice: "" };
}

export function normalizeLoaded(session: ContractSession): ContractSession {
  return {
    ...session,
    exchanges: (session.exchanges ?? []).map((exchange) => ({
      ...exchange,
      loading: false,
      error: null,
    })),
    revisionDrafts: session.revisionDrafts ?? {},
    saveNotice: "",
  };
}
