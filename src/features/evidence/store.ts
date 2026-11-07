// 证据画布的设备本地存储（localStorage）。仅存用户录入的结构化记录与账目，
// 不持久化合同全文、原始附件、对话或模型结果。跨会话保留，清理浏览器数据会丢失。
import { useSyncExternalStore } from "react";
import type { EvidenceStatus, SelectedEvidence } from "@/shared/api";

const RECORDS_KEY = "zzyj.evidence.records.v1";
const UTILITIES_KEY = "zzyj.evidence.utilities.v1";
const SELECTED_KEY = "zzyj.evidence.selected.v1";

export type EvidenceStage = "signing" | "move_in" | "living" | "move_out" | "dispute";

export const STAGES: { id: EvidenceStage; label: string; hint: string }[] = [
  { id: "signing", label: "签约", hint: "签署版本、费用与押金约定、双方确认事项" },
  { id: "move_in", label: "入住", hint: "设施状态、瑕疵描述、入住交接、照片/视频清单" },
  { id: "living", label: "居住中", hint: "报修、沟通、账单、缴费凭证、水电表读数" },
  { id: "move_out", label: "退租", hint: "退租通知、交接、钥匙归还、表读数、押金结算" },
  { id: "dispute", label: "争议处理", hint: "联系对象、时间、渠道、提交内容与处理状态" },
];

export const STAGE_LABELS: Record<EvidenceStage, string> = {
  signing: "签约",
  move_in: "入住",
  living: "居住中",
  move_out: "退租",
  dispute: "争议处理",
};

export type UtilityKind = "water" | "electricity" | "gas" | "other";

export const UTILITY_KIND_LABELS: Record<UtilityKind, string> = {
  water: "水费",
  electricity: "电费",
  gas: "燃气费",
  other: "其他",
};

export interface EvidenceRecord {
  id: string;
  stage: EvidenceStage;
  occurredAt: string | null; // 事件发生时间 YYYY-MM-DD（用户录入）
  recordedAt: string; // 系统录入时间 ISO
  description: string;
  contractClause: string; // 可关联合同条款（用户陈述）
  materialName: string;
  materialType: string;
  materialStatus: EvidenceStatus;
  amountCents: number | null; // 金额整数分，null 不等于零
  reading: string | null; // 表读数等，保留用户原始格式
}

export interface UtilityAccount {
  id: string;
  kind: UtilityKind;
  contractPrice: string; // 合同单价/分摊方式（自由文本）
  cycle: string; // 计费周期
  startReading: string | null;
  endReading: string | null;
  billCents: number | null; // 对方账单
  paidCents: number | null; // 已付款金额
  note: string;
  recordedAt: string;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readArray<T extends { id: string }>(key: string): T[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is T => !!x && typeof x === "object" && typeof (x as T).id === "string");
  } catch {
    return [];
  }
}

function writeArray(key: string, value: unknown): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储已满或被禁用：保留内存态，界面仍可用，不静默崩溃。
  }
}

interface Collection<T extends { id: string }> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T[];
  getAll: () => T[];
  add: (item: T) => void;
  update: (id: string, patch: Partial<T>) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function createCollection<T extends { id: string }>(key: string): Collection<T> {
  let cache = readArray<T>(key);
  const listeners = new Set<() => void>();

  function emit() {
    listeners.forEach((l) => l());
  }
  function persist(next: T[]) {
    cache = next;
    writeArray(key, next);
    emit();
  }
  if (hasStorage()) {
    window.addEventListener("storage", (e) => {
      if (e.key === key) {
        cache = readArray<T>(key);
        emit();
      }
    });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => cache,
    getAll: () => cache,
    add(item) {
      persist([...cache, item]);
    },
    update(id, patch) {
      persist(cache.map((x) => (x.id === id ? { ...x, ...patch, id } : x)));
    },
    remove(id) {
      persist(cache.filter((x) => x.id !== id));
    },
    clear() {
      persist([]);
    },
  };
}

export const records = createCollection<EvidenceRecord>(RECORDS_KEY);
export const utilities = createCollection<UtilityAccount>(UTILITIES_KEY);

// 争议证据选择：跨视图（证据画布 → 争议处理）共享，刷新后保留。
let selectedCache: string[] = readArray<{ id: string }>(SELECTED_KEY).map((x) => x.id);
const selectedListeners = new Set<() => void>();
function emitSelected() {
  selectedListeners.forEach((l) => l());
}
function persistSelected(next: string[]) {
  selectedCache = next;
  writeArray(SELECTED_KEY, next.map((id) => ({ id })));
  emitSelected();
}
export const selection = {
  subscribe(listener: () => void) {
    selectedListeners.add(listener);
    return () => selectedListeners.delete(listener);
  },
  getSnapshot: () => selectedCache,
  toggle(id: string) {
    persistSelected(selectedCache.includes(id) ? selectedCache.filter((x) => x !== id) : [...selectedCache, id]);
  },
  set(ids: string[]) {
    persistSelected(ids);
  },
  clear() {
    persistSelected([]);
  },
};

export function useEvidenceRecords(): EvidenceRecord[] {
  return useSyncExternalStore(records.subscribe, records.getSnapshot, records.getSnapshot);
}
export function useUtilities(): UtilityAccount[] {
  return useSyncExternalStore(utilities.subscribe, utilities.getSnapshot, utilities.getSnapshot);
}
export function useSelectedIds(): string[] {
  return useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot);
}

export function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 金额：元 ↔ 整数分。空/非法 → null（未知不当作零）。
export function yuanToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function formatCents(cents: number | null): string {
  if (cents == null) return "未填";
  return `¥${(cents / 100).toFixed(2)}`;
}

export function sortRecords(list: EvidenceRecord[]): EvidenceRecord[] {
  return [...list].sort((a, b) => {
    const ao = a.occurredAt ?? "";
    const bo = b.occurredAt ?? "";
    if (ao && !bo) return -1; // 有事件时间的在前，无事件时间的在后
    if (!ao && bo) return 1;
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.recordedAt < b.recordedAt ? -1 : 1;
  });
}

export function toSelectedEvidence(list: EvidenceRecord[], ids: string[]): SelectedEvidence[] {
  const set = new Set(ids);
  return sortRecords(list.filter((r) => set.has(r.id))).map((r) => ({
    evidenceId: r.id,
    occurredAt: r.occurredAt,
    description: r.description,
    status: r.materialStatus,
  }));
}