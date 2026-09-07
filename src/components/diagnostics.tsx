"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Cpu, MemoryStick, Gpu, HardDrive, Languages, ExternalLink, Rocket,
  CheckCircle2, XCircle, TriangleAlert, Loader2, Blocks, Bot,
} from "lucide-react";
import type { HardwareInfo } from "@/lib/types";
import type { Dict, Lang } from "@/lib/i18n";

export function Diagnostics({
  lang, d,
}: {
  lang: Lang;
  d: Dict;
}) {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [launching, setLaunching] = useState(false);
  const [dlSim, setDlSim] = useState<number | null>(null); // model download progress (real runs)
  const ar = lang === "ar";
  const t = d.diag;

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hardware");
      if (r.ok) setHw((await r.json()) as HardwareInfo);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const launch = async () => {
    setLaunching(true);
    try {
      const r = await fetch("/api/corpusmind", { method: "POST" });
      const data = await r.json();
      if (data.launched) toast({ title: t.cmDetected });
      else
        toast({
          title: t.cmMissing,
          description: "https://waleedmandour.org/projects/CorpusMind/",
        });
    } finally {
      setLaunching(false);
    }
  };

  // Simulated first-run model download (real worker downloads via huggingface hub)
  const startModelDownload = () => {
    setDlSim(0);
    const iv = setInterval(() => {
      setDlSim((p) => {
        if (p === null) return null;
        if (p >= 100) {
          clearInterval(iv);
          return 100;
        }
        return p + 2;
      });
    }, 120);
  };

  if (!hw)
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
      </div>
    );

  return (
    <div className="grid gap-4">
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className={ar ? "font-arabic" : ""}>{t.title}</CardTitle>
          <CardDescription className={ar ? "font-arabic" : ""}>{t.desc}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
              <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" />
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${ar ? "font-arabic" : ""}`}>{t.cpu}</p>
                <p className="truncate text-xs text-muted-foreground" dir="ltr">{hw.cpuModel}</p>
                <p className="text-xs text-muted-foreground">{hw.cores} {t.cores}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
              <MemoryStick className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" />
              <div>
                <p className={`text-sm font-semibold ${ar ? "font-arabic" : ""}`}>{t.ram}</p>
                <p className="text-xs text-muted-foreground" dir="ltr">{hw.ramGb} GB</p>
                <p className="text-xs text-muted-foreground" dir="ltr">{t.os}: {hw.platform} {hw.osVersion}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
              <Gpu className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" />
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${ar ? "font-arabic" : ""}`}>{t.gpu}</p>
                {hw.gpuName ? (
                  <>
                    <p className="truncate text-xs text-emerald-500" dir="ltr">{hw.gpuName} · {hw.gpuVramGb} GB</p>
                    <p className={`mt-1 text-xs ${ar ? "font-arabic" : ""}`}>{t.gpuOk}</p>
                  </>
                ) : (
                  <p className={`mt-1 text-xs text-amber-500 ${ar ? "font-arabic" : ""}`}>{t.gpuNone}</p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
              <Languages className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" />
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${ar ? "font-arabic" : ""}`}>{t.whisperModel}</p>
                <Badge variant="outline" className="mt-1" dir="ltr">large-v3 · INT8</Badge>
                {dlSim === null ? (
                  hw.modelsReady ? (
                    <p className={`mt-1 text-xs text-emerald-500 ${ar ? "font-arabic" : ""}`}>{t.modelsPresent}</p>
                  ) : (
                    <div className="mt-1">
                      <p className={`text-xs text-amber-500 ${ar ? "font-arabic" : ""}`}>{t.modelsMissing}</p>
                      <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={startModelDownload}>
                        {ar ? "تنزيل" : "Download"}
                      </Button>
                    </div>
                  )
                ) : (
                  <div className="mt-2">
                    <Progress value={dlSim} className="h-2" />
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground" dir="ltr">
                      large-v3 · {dlSim}% (~1.5 GB)
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <Alert className={hw.pythonWorker ? "border-emerald-500/30" : "border-amber-500/30"}>
            <Blocks className="h-4 w-4" />
            <AlertTitle className={`flex items-center gap-2 ${ar ? "font-arabic" : ""}`}>
              {t.python}
              {hw.pythonWorker ? (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">{t.pyOk}</Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500/40 text-amber-500">{t.pyMissing}</Badge>
              )}
            </AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground" dir="ltr">
              python/processor.py · faster-whisper · MFA · parselmouth
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className={`flex items-center gap-2 text-base ${ar ? "font-arabic" : ""}`}>
            <Rocket className="h-4 w-4 text-gold-500 text-amber-500" />
            {t.corpusmind}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="flex items-center gap-2 text-sm">
            {hw.corpusmind.detected ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className={ar ? "font-arabic" : ""}>{t.cmDetected}</span>
                <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs" dir="ltr">{hw.corpusmind.path}</code>
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-muted-foreground" />
                <span className={ar ? "font-arabic" : ""}>{t.cmMissing}</span>
              </>
            )}
          </p>
          {!hw.corpusmind.detected && (
            <p className={`text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>
              {t.cmHint}{" "}
              <a
                className="text-cyan-400 underline"
                href="https://waleedmandour.org/projects/CorpusMind/"
                target="_blank"
                rel="noreferrer"
              >
                {t.cmHintLink}
              </a>
              .
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={() => void launch()} disabled={launching} className="w-fit gap-2">
              {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              <span className={ar ? "font-arabic" : ""}>{t.cmLaunch}</span>
            </Button>
            <a
              href="https://waleedmandour.org/projects/CorpusMind/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className={ar ? "font-arabic" : ""}>{d.projectSite}</span>
            </a>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className={`flex items-center gap-2 text-base ${ar ? "font-arabic" : ""}`}>
            <Bot className="h-4 w-4 text-cyan-400" />
            Ollama
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="flex items-center gap-2 text-sm">
            {hw.ollama.detected ? (
              <>
                <HardDrive className="h-4 w-4 text-emerald-500" />
                <span dir="ltr" className="text-emerald-500">online · {hw.ollama.url}</span>
              </>
            ) : (
              <>
                <TriangleAlert className="h-4 w-4 text-amber-500" />
                <span dir="ltr" className="text-amber-500">offline · {hw.ollama.url}</span>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
