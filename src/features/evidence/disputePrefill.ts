// 证据 → 争议的一次性预填：选中证据并带入争议事项，避免用户到争议页重填。
import { useSyncExternalStore } from "react";

export interface DisputePrefill {
  issue: string;
  facts: string;
  evidenceIds: string[];
  key: string;
}

let pending: DisputePrefill | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export const disputePrefill = {
  set(next: Omit<DisputePrefill, "key">): void {
    pending = { ...next, key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    emit();
  },
  take(): DisputePrefill | null {
    const current = pending;
    pending = null;
    emit();
    return current;
  },
};

export function useDisputePrefill(): DisputePrefill | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
    () => pending,
  );
}
