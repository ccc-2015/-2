import type { DisputeResult, ResponseMeta } from "@/shared/api";

const DRAFT_KEY = "zzyj.dispute.draft.v1";
const CONSENT_KEY = "zzyj.dispute.draft.consent.v1";

export type DraftConsent = "unset" | "on" | "off";

export interface DisputeDraft {
  version: 1;
  savedAt: string;
  issue: string;
  eventDate: string;
  counterparty: string;
  goal: string;
  amountYuan: string;
  facts: string;
  priorAction: string;
  selectedIds: string[];
  sentContents: Record<string, string>;
  selectedChannelId: string | null;
  scriptDraft: string;
  status: string;
  archivedScripts: Record<string, string>;
  tab: "script" | "analysis" | "progress";
  step: 0 | 1 | 2;
  maxStep: 0 | 1 | 2;
  result: DisputeResult | null;
  resultMeta: ResponseMeta | null;
}

export function getDraftConsent(): DraftConsent {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    return raw === "on" || raw === "off" ? raw : "unset";
  } catch {
    return "unset";
  }
}

export function setDraftConsent(value: Exclude<DraftConsent, "unset">): boolean {
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(): DisputeDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DisputeDraft;
    if (!parsed || parsed.version !== 1) return null;
    return {
      ...parsed,
      selectedIds: Array.isArray(parsed.selectedIds) ? parsed.selectedIds : [],
      sentContents: parsed.sentContents && typeof parsed.sentContents === "object" ? parsed.sentContents : {},
      archivedScripts:
        parsed.archivedScripts && typeof parsed.archivedScripts === "object" ? parsed.archivedScripts : {},
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: DisputeDraft): boolean {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(): boolean {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
}

export function formatDraftTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}