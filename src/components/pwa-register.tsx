"use client";

import { useEffect } from "react";

// Registers the offline service worker for browser/phone use of the app.
// Inside the desktop (Tauri) shell the service worker is actively REMOVED:
// its app-shell cache outlives upgrades, so after installing a new version
// the webview kept serving the previous build from Cache Storage (the
// "stale UI after upgrade" reports). /api/config tells us which mode we
// are in; phones entering through the companion proxy are unaffected.
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;

    const run = async () => {
      let desktop = false;
      try {
        const r = await fetch("/api/config", { cache: "no-store" });
        if (r.ok) desktop = !!(await r.json()).desktop;
      } catch {
        /* config unreachable - default to the browser behaviour */
      }
      if (cancelled) return;

      if (desktop) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) await reg.unregister().catch(() => undefined);
          if (typeof caches !== "undefined" && caches.keys) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k).catch(() => undefined)));
          }
        } catch {
          /* best-effort cleanup only */
        }
        return;
      }

      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline mode unavailable - app still works */
      });
    };

    if (document.readyState === "complete") void run();
    else {
      const onLoad = () => void run();
      window.addEventListener("load", onLoad);
      return () => window.removeEventListener("load", onLoad);
    }
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
