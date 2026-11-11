// 租住基本信息：一次填写，证据、合同、争议共用；只存本机 localStorage。
import { useSyncExternalStore } from "react";

const KEY = "zzyj.rental.profile.v1";

export interface RentalProfile {
  addressLabel: string;
  startDate: string; // YYYY-MM-DD
  monthlyRentCents: number | null;
  depositCents: number | null;
}

export const EMPTY_PROFILE: RentalProfile = {
  addressLabel: "",
  startDate: "",
  monthlyRentCents: null,
  depositCents: null,
};

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function read(): RentalProfile {
  if (!hasStorage()) return EMPTY_PROFILE;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY_PROFILE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_PROFILE;
    return {
      addressLabel: typeof parsed.addressLabel === "string" ? parsed.addressLabel : "",
      startDate: typeof parsed.startDate === "string" ? parsed.startDate : "",
      monthlyRentCents: Number.isInteger(parsed.monthlyRentCents) ? parsed.monthlyRentCents : null,
      depositCents: Number.isInteger(parsed.depositCents) ? parsed.depositCents : null,
    };
  } catch {
    return EMPTY_PROFILE;
  }
}

let cache = read();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getRentalProfile(): RentalProfile {
  return cache;
}

export function saveRentalProfile(next: RentalProfile): void {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 存储被禁用时保留内存态，界面仍可用。
  }
  emit();
}

if (hasStorage()) {
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) {
      cache = read();
      emit();
    }
  });
}

export function useRentalProfile(): RentalProfile {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => cache,
    () => EMPTY_PROFILE,
  );
}

export function rentalProfileFilled(profile: RentalProfile): boolean {
  return !!(profile.addressLabel || profile.startDate || profile.monthlyRentCents != null || profile.depositCents != null);
}
