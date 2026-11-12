// 地区选择：合同与争议共用一份，二期知识库直接复用。
import { useSyncExternalStore } from "react";

const KEY = "zzyj.region.v1";
export const DEFAULT_REGION = "ZZ";

function readRegion(): string {
  if (typeof window === "undefined" || !window.localStorage) return DEFAULT_REGION;
  try {
    return window.localStorage.getItem(KEY) || DEFAULT_REGION;
  } catch {
    return DEFAULT_REGION;
  }
}

let cache = readRegion();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function setRegion(code: string): void {
  cache = code || DEFAULT_REGION;
  try {
    window.localStorage.setItem(KEY, cache);
  } catch {
    // 存储不可用时保留内存态。
  }
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) {
      cache = readRegion();
      emit();
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRegionCode(): string {
  return useSyncExternalStore(subscribe, () => cache, () => DEFAULT_REGION);
}
