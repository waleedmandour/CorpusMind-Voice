"use client";

// Welcome window - three-page onboarding shown on first launch.
// Pages: (1) What the app does · (2) Offline privacy · (3) Quick start.
// Dismissal is stored in localStorage so it never nags again.
import { useEffect, useState } from "react";
import { Mic, ShieldCheck, ListChecks, ArrowRight, ArrowLeft, Sparkles, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Dict, Lang } from "@/lib/i18n";

const KEY = "cmv-welcome-seen";

const PAGE_ICONS = [Sparkles, ShieldCheck, ListChecks];

export function WelcomeDialog({ lang, d, onStart }: { lang: Lang; d: Dict; onStart: () => void }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const ar = lang === "ar";
  const t = d.welcome;

  useEffect(() => {
    // deferred read of the external system (localStorage); 250 ms also lets
    // the app shell paint before the dialog opens
    const id = window.setTimeout(() => {
      try {
        if (!window.localStorage.getItem(KEY)) setOpen(true);
      } catch { /* private mode */ }
    }, 250);
    return () => window.clearTimeout(id);
  }, []);

  const close = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch { /* ignore */ }
    setOpen(false);
  };

  const pages = [
    { icon: Sparkles, title: t.p1Title, body: t.p1Body, bullets: t.p1Bullets },
    { icon: ShieldCheck, title: t.p2Title, body: t.p2Body, bullets: t.p2Bullets },
    { icon: ListChecks, title: t.p3Title, body: t.p3Body, bullets: t.p3Bullets },
  ];

  const PageIcon = PAGE_ICONS[page];
  const isLast = page === pages.length - 1;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden rounded-2xl border border-blue-400/30 bg-gradient-to-br from-blue-950 via-blue-900 to-sky-900 p-0 text-blue-50 shadow-2xl"
        dir={ar ? "rtl" : "ltr"}
      >
        <DialogTitle className="sr-only">{t.title}</DialogTitle>
        <div className="flex items-center justify-center gap-3 pt-7">
          {pages.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === page ? "w-7 bg-cyan-400" : "w-3 bg-blue-300/30"}`}
              aria-hidden
            />
          ))}
        </div>

        <div className="grid gap-4 px-7 py-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/40 bg-cyan-400/10 glow-cyan">
            <PageIcon className="h-7 w-7 text-cyan-300" />
          </div>
          <h2 className={`text-lg font-bold text-white ${ar ? "font-arabic" : ""}`}>{pages[page].title}</h2>
          <p className={`text-sm leading-relaxed text-blue-100/90 ${ar ? "font-arabic" : ""}`}>
            {pages[page].body}
          </p>
          <ul className="mx-auto grid gap-1.5 text-start">
            {pages[page].bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-blue-50">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" aria-hidden />
                <span className={ar ? "font-arabic" : ""}>{b}</span>
              </li>
            ))}
          </ul>
          {page === 2 && (
            <p className={`mx-auto flex max-w-sm items-start gap-2 rounded-lg border border-cyan-300/30 bg-cyan-400/10 p-2.5 text-start text-xs text-blue-50 ${ar ? "font-arabic" : ""}`}>
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
              {t.onPhone}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-blue-300/20 px-5 py-3.5">
          <Button variant="ghost" onClick={close} className={`${ar ? "font-arabic" : ""} text-blue-100 hover:bg-blue-400/20 hover:text-white`}>
            {t.skip}
          </Button>
          <div className="flex items-center gap-2">
            {page > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setPage((p) => p - 1)} className={`gap-1.5 text-blue-100 hover:bg-blue-400/20 hover:text-white ${ar ? "font-arabic" : ""}`}>
                {ar ? <ArrowRight className="h-3.5 w-3.5" /> : <ArrowLeft className="h-3.5 w-3.5" />}
                {t.back}
              </Button>
            )}
            {isLast ? (
              <Button
                size="sm"
                onClick={() => { close(); onStart(); }}
                className="gap-1.5 bg-cyan-500 text-blue-950 hover:bg-cyan-400"
              >
                <Mic className="h-3.5 w-3.5" />
                <span className={ar ? "font-arabic" : ""}>{t.start}</span>
              </Button>
            ) : (
              <Button size="sm" onClick={() => setPage((p) => p + 1)} className={`gap-1.5 bg-cyan-500 text-blue-950 hover:bg-cyan-400 ${ar ? "font-arabic" : ""}`}>
                {t.next}
                {ar ? <ArrowLeft className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
