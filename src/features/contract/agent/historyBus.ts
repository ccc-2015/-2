// 合同历史在页面间共享：左栏展示列表，合同页负责保存与打开。
import { useSyncExternalStore } from "react";
import {
  clearSessions,
  deleteSession,
  getConsent,
  listSessions,
  setConsent as persistConsent,
  type HistoryConsent,
} from "./history";
import type { SessionSummary } from "./session";

type Request = { kind: "open"; id: string } | { kind: "new" };

let items: SessionSummary[] = [];
let consent: HistoryConsent = getConsent();
let request: Request | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const historyBus = {
  async refresh(): Promise<void> {
    try {
      items = await listSessions();
    } catch {
      items = [];
    }
    emit();
  },
  setConsent(value: "on" | "off"): void {
    consent = value;
    persistConsent(value);
    emit();
  },
  request(action: Request): void {
    request = action;
    emit();
  },
  take(): Request | null {
    const current = request;
    request = null;
    emit();
    return current;
  },
  async remove(id: string): Promise<void> {
    await deleteSession(id);
    await historyBus.refresh();
  },
  async clear(): Promise<void> {
    await clearSessions();
    await historyBus.refresh();
  },
};

export function useHistoryItems(): SessionSummary[] {
  return useSyncExternalStore(subscribe, () => items, () => items);
}

export function useHistoryConsent(): HistoryConsent {
  return useSyncExternalStore(subscribe, () => consent, () => consent);
}

export function useHistoryRequest(): Request | null {
  return useSyncExternalStore(subscribe, () => request, () => request);
}
