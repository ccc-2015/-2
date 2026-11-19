import { newId } from "../../evidence/store";
import type { ContractDoc, ContractVersion, Exchange, RevisionDraft } from "./types";

/** 合同页的唯一状态所有者：文档版本、对话、修订副本都挂在这里，历史保存直接序列化它。 */
export interface ContractSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  doc: ContractDoc | null;
  /** 不可变的合同文本版本；编辑或重新审查会产生新版本。 */
  versions: ContractVersion[];
  exchanges: Exchange[];
  revisionDrafts: Record<string, RevisionDraft>;
  signingDate: string;
  /** 旧字段：旧会话中的单一合同原文证据。 */
  textRecordId: string | null;
  /** 每个合同版本对应的证据原文记录，避免新版本覆盖旧版本。 */
  versionRecordIds: Record<string, string>;
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
    versions: [],
    exchanges: [],
    revisionDrafts: {},
    signingDate: "",
    textRecordId: null,
    versionRecordIds: {},
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
  const exchanges = session.exchanges
    .filter((exchange) => exchange.result)
    .map((exchange) => ({
      ...exchange,
      loading: false,
      error: null,
    }));
  const keep = new Set(exchanges.map((exchange) => exchange.id));
  const revisionDrafts: Record<string, RevisionDraft> = {};
  for (const [id, draft] of Object.entries(session.revisionDrafts)) {
    if (keep.has(id)) revisionDrafts[id] = { ...draft, loading: false, error: null };
  }
  return { ...session, exchanges, revisionDrafts, saveNotice: "" };
}

export function normalizeLoaded(session: ContractSession): ContractSession {
  const createdAt = session.createdAt || new Date().toISOString();
  let versions = Array.isArray(session.versions) ? session.versions.filter(Boolean) : [];
  let doc = session.doc ?? null;

  versions = versions.map((version, index) => ({
    ...version,
    label: version.label || `v${index + 1}`,
    meta:
      version.meta ??
      doc?.meta ?? { warnings: [], pageCount: null, method: "text", ocrUsed: false, pages: [] },
  }));

  if (doc) {
    let versionId = doc.versionId;
    if (!versionId || !versions.some((version) => version.id === versionId)) {
      const sameText = versions.find((version) => version.text === doc?.text);
      if (sameText) {
        versionId = sameText.id;
      } else {
        versionId = versionId || newId();
        versions = [
          ...versions,
          {
            id: versionId,
            text: doc.text,
            sourceName: doc.sourceName,
            meta: doc.meta,
            createdAt,
            label: `v${versions.length + 1}`,
          },
        ];
      }
    }
    doc = { ...doc, versionId };
  }

  const baseVersionId = doc?.versionId ?? versions[0]?.id;
  const versionRecordIds = { ...(session.versionRecordIds ?? {}) };
  if (session.textRecordId && baseVersionId && !versionRecordIds[baseVersionId]) {
    versionRecordIds[baseVersionId] = session.textRecordId;
  }

  return {
    ...session,
    doc,
    versions,
    exchanges: (session.exchanges ?? []).map((exchange) => ({
      ...exchange,
      docVersionId: exchange.docVersionId ?? baseVersionId,
      loading: false,
      error: null,
    })),
    revisionDrafts: Object.fromEntries(
      Object.entries(session.revisionDrafts ?? {}).map(([id, draft]) => [
        id,
        {
          ...draft,
          baseText: draft.baseText ?? draft.originalText,
          versionId: draft.versionId ?? "",
          versionLabel: draft.versionLabel ?? "",
          sourceExchangeId: draft.sourceExchangeId ?? draft.exchangeId,
          appliedTexts: draft.appliedTexts ?? {},
          signedNotice: draft.signedNotice ?? "",
          signedRecordId: draft.signedRecordId ?? null,
        },
      ]),
    ),
    versionRecordIds,
    saveNotice: "",
  };
}
