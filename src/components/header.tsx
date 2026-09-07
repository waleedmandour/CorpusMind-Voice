"use client";

import Image from "next/image";
import { Globe, WifiOff, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AboutDialog } from "@/components/about-dialog";
import type { Dict, Lang } from "@/lib/i18n";

interface HeaderProps {
  lang: Lang;
  onToggleLang: () => void;
  d: Dict;
  installReady: boolean;
  onInstall: () => void;
}

export function Header({ lang, onToggleLang, d, installReady, onInstall }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 backdrop-blur-md bg-background/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Image
          src="/icons/icon-64.png"
          alt="CorpusMind Voice logo — neural brain with audio waveform"
          width={40}
          height={40}
          className="rounded-xl glow-cyan"
          priority
        />
        <div className="min-w-0">
          <h1 className={`truncate text-base font-bold leading-tight ${lang === "ar" ? "font-arabic" : ""}`}>
            {d.appName}
          </h1>
          <p className={`hidden truncate text-xs text-muted-foreground sm:block ${lang === "ar" ? "font-arabic" : ""}`}>
            {d.tagline}
          </p>
        </div>

        <div className="ms-auto flex items-center gap-2">
          <AboutDialog lang={lang} d={d} />
          <Badge
            variant="outline"
            className="hidden border-emerald-500/40 bg-emerald-500/10 text-emerald-500 md:inline-flex"
          >
            <WifiOff className="me-1 h-3 w-3" />
            {d.offlineBadge}
          </Badge>
          <a
            href="https://waleedmandour.org/projects/CorpusMind/"
            target="_blank"
            rel="noreferrer"
            title={d.projectSite}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          {installReady && (
            <Button size="sm" variant="outline" onClick={onInstall} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{d.common.install}</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={onToggleLang}
            className={`gap-1.5 font-semibold ${lang === "en" ? "font-arabic" : ""}`}
          >
            <Globe className="h-3.5 w-3.5" />
            {d.langToggle}
          </Button>
        </div>
      </div>
    </header>
  );
}
