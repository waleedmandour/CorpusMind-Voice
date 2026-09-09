"use client";

// About & citation dialog - shows the Zenodo DOI, APA 7 reference and BibTeX
// for CorpusMind Voice, with one-click copy, plus the parent-app citation.

import { useState } from "react";
import { BadgeCheck, Copy, ExternalLink, Quote, Scale, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Dict, Lang } from "@/lib/i18n";

export const DOI = "10.5281/zenodo.22649310";
const DOI_URL = `https://doi.org/${DOI}`;

function CopyRow({
  label,
  text,
  copyLabel,
  copiedLabel,
}: {
  label: string;
  text: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API unavailable (non-secure context) - fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="rounded-lg border border-border/70 bg-secondary/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
          {label}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => void copy()}
        >
          {copied ? (
            <BadgeCheck className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
      {/* citations stay LTR Latin text even inside the Arabic RTL UI */}
      <p
        dir="ltr"
        className="break-words text-left font-mono text-[11px] leading-relaxed text-foreground/90"
      >
        {text}
      </p>
    </div>
  );
}

export function AboutDialog({ lang, d }: { lang: Lang; d: Dict }) {
  const ar = lang === "ar";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Quote className="h-3.5 w-3.5" />
          <span className={ar ? "font-arabic" : ""}>{d.about.button}</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        dir={ar ? "rtl" : "ltr"}
        className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle className={`text-left ${ar ? "font-arabic" : ""}`}>
            {d.about.title}
          </DialogTitle>
          <DialogDescription className={`text-left ${ar ? "font-arabic" : ""}`}>
            {d.appName} · {d.about.version}
          </DialogDescription>
        </DialogHeader>

        {/* Zenodo DOI */}
        <a
          href={DOI_URL}
          target="_blank"
          rel="noreferrer"
          dir="ltr"
          className="flex items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20"
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          <span>{d.about.doiLabel}: {DOI}</span>
        </a>

        {/* Developers - same team as the parent CorpusMind app */}
        <div className="rounded-lg border border-border/70 bg-secondary/30 p-3 text-sm">
          <p
            className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${ar ? "font-arabic" : ""}`}
          >
            <Users className="h-3.5 w-3.5" />
            {d.about.developedBy}
          </p>
          <p dir="auto" className="font-semibold">
            {d.about.dev1}
            <span className={`font-normal text-muted-foreground ${ar ? "font-arabic" : ""}`}>
              {" "}· {d.about.aff1}
            </span>
          </p>
          <p dir="auto" className="font-semibold">
            {d.about.dev2}
            <span className={`font-normal text-muted-foreground ${ar ? "font-arabic" : ""}`}>
              {" "}· {d.about.aff2}
            </span>
          </p>
          <p className={`mt-2 text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>
            {d.about.notFunded}
          </p>
        </div>

        {/* Citation blocks */}
        <CopyRow
          label={d.about.apaLabel}
          text={d.about.apa}
          copyLabel={d.common.copy}
          copiedLabel={d.common.copied}
        />
        <CopyRow
          label={d.about.bibtexLabel}
          text={d.about.bibtex}
          copyLabel={d.common.copy}
          copiedLabel={d.common.copied}
        />

        {/* Parent-app citation */}
        <p className={`text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>
          {d.about.parentLabel}
        </p>
        <CopyRow
          label="APA: CorpusMind 1.1.0"
          text={d.about.parentApa}
          copyLabel={d.common.copy}
          copiedLabel={d.common.copied}
        />

        <p
          className={`flex items-center justify-center gap-1.5 text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}
        >
          <Scale className="h-3 w-3 shrink-0" />
          MIT © 2026 {d.about.dev1} · {d.about.dev2}
        </p>
      </DialogContent>
    </Dialog>
  );
}
