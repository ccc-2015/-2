// 合同会话的本机历史（IndexedDB）。只保存在当前浏览器，不上传服务器，
// 不是云备份；用户可随时关闭保存、单条删除或全部清空。
import type { ContractSession, SessionSummary } from "./session";
import { normalizeLoaded, summarize, toStoredSession } from "./session";

const DB_NAME = "zzyj-contract-history";
const DB_VERSION = 1;
const FULL_STORE = "sessions";
const META_STORE = "summaries";
const CONSENT_KEY = "zzyj.contract.history.consent.v1";
const MAX_SESSIONS = 20;

export type HistoryConsent = "unset" | "on" | "off";

export function getConsent(): HistoryConsent {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    return raw === "on" || raw === "off" ? raw : "unset";
  } catch {
    return "unset";
  }
}

export function setConsent(value: Exclude<HistoryConsent, "unset">): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // 存储被禁用时仅影响下次默认值，本次会话仍按用户选择执行。
  }
}

export function historySupported(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!historySupported()) return Promise.reject(new Error("当前浏览器不支持本机历史存储。"));
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(FULL_STORE)) {
          db.createObjectStore(FULL_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          const meta = db.createObjectStore(META_STORE, { keyPath: "id" });
          meta.createIndex("updatedAt", "updatedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("无法打开本机历史存储。"));
      request.onblocked = () => reject(new Error("本机历史存储被其他标签页占用。"));
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本机历史操作失败。"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("本机历史写入失败。"));
    tx.onabort = () => reject(tx.error ?? new Error("本机历史写入被中止。"));
  });
}

export async function listSessions(): Promise<SessionSummary[]> {
  const db = await openDb();
  const tx = db.transaction(META_STORE, "readonly");
  const rows = await requestDone(tx.objectStore(META_STORE).getAll() as IDBRequest<SessionSummary[]>);
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadSession(id: string): Promise<ContractSession | null> {
  const db = await openDb();
  const tx = db.transaction(FULL_STORE, "readonly");
  const row = await requestDone(tx.objectStore(FULL_STORE).get(id) as IDBRequest<ContractSession | undefined>);
  return row ? normalizeLoaded(row) : null;
}

export async function saveSession(session: ContractSession): Promise<void> {
  const db = await openDb();
  const stored = toStoredSession(session);
  const tx = db.transaction([FULL_STORE, META_STORE], "readwrite");
  tx.objectStore(FULL_STORE).put(stored);
  tx.objectStore(META_STORE).put(summarize(stored));
  await txDone(tx);
  await trimOldest(db);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([FULL_STORE, META_STORE], "readwrite");
  tx.objectStore(FULL_STORE).delete(id);
  tx.objectStore(META_STORE).delete(id);
  await txDone(tx);
}

export async function clearSessions(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([FULL_STORE, META_STORE], "readwrite");
  tx.objectStore(FULL_STORE).clear();
  tx.objectStore(META_STORE).clear();
  await txDone(tx);
}

async function trimOldest(db: IDBDatabase): Promise<void> {
  const summaries = await listSessions();
  const extra = summaries.slice(MAX_SESSIONS);
  if (extra.length === 0) return;
  const tx = db.transaction([FULL_STORE, META_STORE], "readwrite");
  for (const item of extra) {
    tx.objectStore(FULL_STORE).delete(item.id);
    tx.objectStore(META_STORE).delete(item.id);
  }
  await txDone(tx);
}

export function formatSessionTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (sameDay) return `今天 ${hh}:${mm}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
}
