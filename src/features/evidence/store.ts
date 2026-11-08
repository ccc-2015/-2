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

export interface EvidenceAttachment {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
  bytes: number;
}

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
  attachments?: EvidenceAttachment[]; // 本机压缩存储的图片材料
  content?: string; // 材料全文（如已确认合同原文、修订副本、话术）
  originalText?: string; // 仅修订副本：对应原文，供事后对比
}

export interface UtilityAccount {
  id: string;
  kind: UtilityKind;
  stage?: EvidenceStage; // 归属阶段，缺省按「居住中」
  periodStart?: string | null; // 计费周期开始 YYYY-MM-DD，用于时间轴定位
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
    materialName: r.materialName,
    materialType: r.materialType,
    amountCents: r.amountCents,
    contractClause: r.contractClause,
    content: r.content?.slice(0, 1200) ?? "",
  }));
}

// ---- 时间轴（阶段泳道）辅助 ----

export type LaneItem =
  | { kind: "record"; date: string | null; recordedAt: string; record: EvidenceRecord }
  | { kind: "utility"; date: string | null; recordedAt: string; account: UtilityAccount };

export function utilityStage(u: UtilityAccount): EvidenceStage {
  return u.stage ?? "living";
}

export function laneItemsFor(
  stage: EvidenceStage,
  recordList: EvidenceRecord[],
  utilityList: UtilityAccount[],
): LaneItem[] {
  const items: LaneItem[] = [
    ...recordList
      .filter((r) => r.stage === stage)
      .map((r) => ({ kind: "record" as const, date: r.occurredAt, recordedAt: r.recordedAt, record: r })),
    ...utilityList
      .filter((u) => utilityStage(u) === stage)
      .map((u) => ({ kind: "utility" as const, date: u.periodStart ?? null, recordedAt: u.recordedAt, account: u })),
  ];
  return items.sort((a, b) => {
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.recordedAt < b.recordedAt ? -1 : 1;
  });
}

export interface OverviewStats {
  span: { from: string; to: string } | null;
  totalRecords: number;
  present: number;
  missing: number;
  toConfirm: number;
  utilityCount: number;
  balanceCents: number | null;
  balanceIncomplete: number;
}

export function overviewStats(recordList: EvidenceRecord[], utilityList: UtilityAccount[]): OverviewStats {
  const dates = recordList.map((r) => r.occurredAt).filter((d): d is string => !!d).sort();
  let present = 0;
  let missing = 0;
  let toConfirm = 0;
  for (const r of recordList) {
    if (r.materialStatus === "present") present++;
    else if (r.materialStatus === "missing") missing++;
    else toConfirm++;
  }
  let balanceCents: number | null = null;
  let balanceIncomplete = 0;
  for (const u of utilityList) {
    if (u.billCents != null && u.paidCents != null) {
      balanceCents = (balanceCents ?? 0) + (u.billCents - u.paidCents);
    } else {
      balanceIncomplete++;
    }
  }
  return {
    span: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    totalRecords: recordList.length,
    present,
    missing,
    toConfirm,
    utilityCount: utilityList.length,
    balanceCents,
    balanceIncomplete,
  };
}

export function readingUsage(start: string | null, end: string | null): number | null {
  if (start == null || end == null) return null;
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return e - s;
}

export function utilityBalance(u: UtilityAccount): number | null {
  if (u.billCents == null || u.paidCents == null) return null;
  return u.billCents - u.paidCents;
}

/** 规则化缺口提示：只依据用户已录入数据，不调模型、不下结论。 */
export function gapHints(
  stage: EvidenceStage,
  recordList: EvidenceRecord[],
  utilityList: UtilityAccount[],
): string[] {
  const inStage = recordList.filter((r) => r.stage === stage);
  const utilInStage = utilityList.filter((u) => utilityStage(u) === stage);
  const hints: string[] = [];

  if (stage === "signing" && inStage.length === 0) {
    hints.push("建议补充：签署版本、押金与费用约定、双方确认事项。");
  }
  if (stage === "move_in") {
    if (inStage.length === 0) hints.push("建议补充入住交接、设施瑕疵与照片/视频清单。");
    else if (!inStage.some((r) => r.materialName)) hints.push("入住记录未关联材料名称（如交接照片）。");
  }
  if (stage === "living") {
    if (inStage.length === 0 && utilInStage.length === 0) {
      hints.push("建议补充租金/费用账单、缴费凭证与水电气表读数。");
    }
    if (utilInStage.length > 0 && !inStage.some((r) => r.materialName)) {
      hints.push("已有费用账目，但缺少缴费凭证类材料记录。");
    }
  }
  if (stage === "move_out") {
    if (inStage.length === 0) hints.push("建议补充退租通知、交接、表读数与押金结算明细。");
    if (inStage.some((r) => r.amountCents != null) && !inStage.some((r) => r.materialName)) {
      hints.push("退租段有金额记录，但缺少对应的结算明细/凭证材料。");
    }
  }
  if (stage === "dispute" && inStage.length === 0) {
    hints.push("如已进入争议处理，建议记录联系对象、时间、渠道与处理状态。");
  }

  const missing = inStage.filter((r) => r.materialStatus === "missing").length;
  if (missing > 0) hints.push(`本阶段有 ${missing} 项材料标记为「缺失」。`);
  return hints.slice(0, 3);
}
// ---- 附件（图片）----

export const MAX_ATTACHMENTS = 4;
export const MAX_STORE_CHARS = 4_000_000;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片无法解码"));
    img.src = src;
  });
}

/** 压缩为最长边 1280 的 JPEG；压缩无收益时保留原图。仅在浏览器执行。 */
export async function compressImage(file: File): Promise<EvidenceAttachment> {
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
  const width = Math.max(1, Math.round((img.width || 1) * scale));
  const height = Math.max(1, Math.round((img.height || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  let dataUrl = original;
  let type = file.type;
  if (ctx) {
    ctx.drawImage(img, 0, 0, width, height);
    const jpeg = canvas.toDataURL("image/jpeg", 0.78);
    if (jpeg.length < original.length) {
      dataUrl = jpeg;
      type = "image/jpeg";
    }
  }
  return {
    id: newId(),
    name: file.name,
    type,
    dataUrl,
    bytes: Math.round((dataUrl.length * 3) / 4),
  };
}

/** 估算整库字符量（localStorage 按字符计），用于保存前拦截超限。 */
export function storeSizeChars(recordList: EvidenceRecord[], utilityList: UtilityAccount[]): number {
  return JSON.stringify({ r: recordList, u: utilityList }).length;
}

/** 带容量检查地写入一条证据；返回 false 表示超出本机存储上限，未写入。 */
export function saveRecordChecked(record: EvidenceRecord, existing = false): boolean {
  const list = records.getAll();
  const next = existing ? list.map((r) => (r.id === record.id ? record : r)) : [...list, record];
  if (storeSizeChars(next, utilities.getAll()) > MAX_STORE_CHARS) return false;
  if (existing) records.update(record.id, record);
  else records.add(record);
  return true;
}
