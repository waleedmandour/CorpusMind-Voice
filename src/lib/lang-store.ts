"use client";

// Tiny external store for the UI language preference (react-hooks compliant:
// consumed via useSyncExternalStore instead of setState-in-effect).
import { useSyncExternalStore } from "react";
import type { Lang } from "@/lib/i18n";

const KEY = "cmv-lang";
let current: Lang | null = null; // resolved lazily on first client read
const listeners = new Set<() => void>();

function readClient(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    return window.localStorage.getItem(KEY) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (current ??= readClient()),
    () => "en" as Lang
  );

  const setLang = (l: Lang) => {
    current = l;
    try {
      window.localStorage.setItem(KEY, l);
    } catch { /* private mode */ }
    listeners.forEach((cb) => cb());
  };

  return [lang, setLang];
}
