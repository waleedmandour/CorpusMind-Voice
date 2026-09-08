"use client";

// Settings and Diagnostics — hardware info, Whisper model manager (download /
// delete into the app's private data folder), local LLM providers (Ollama /
// LM Studio, parent-app detection), CorpusMind integration.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Cpu, MemoryStick, Gpu, Languages, ExternalLink, Rocket, CheckCircle2, XCircle,
  TriangleAlert, Loader2, Blocks, Bot, HardDrive, Download, Trash2, FolderOpen,
  RefreshCcw, Boxes, MonitorPlay, MessageSquareQuote, Save, Undo2,
} from "lucide-react";
import type { HardwareInfo, LlmState } from "@/lib/types";
import type { Dict, Lang } from "@/lib/i18n";

const MODEL_LABEL_KEYS = {
  tiny: "sizeTiny", base: "sizeBase", small: "sizeSmall", medium: "sizeMedium", "large-v3": "sizeLargeV3",
} as const;

function fmtBytes(b: number): string {
  if (!b) return "0 MB";
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.round(b / 1024 ** 2)} MB`;
}

export function Settings({ lang, d }: { lang: Lang; d: Dict }) {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [llm, setLlm] = useState<LlmState | null>(null);
  const [launching, setLaunching] = useState(false);
  const [startingOllama, setStartingOllama] = useState(false);
  const [dlBusy, setDlBusy] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // filler lexicon editor state (comma-separated text inputs)
  const [fillersEn, setFillersEn] = useState("");
  const [fillersAr, setFillersAr] = useState("");
  const [fillersSaving, setFillersSaving] = useState(false);
  const ar = lang === "ar";
  const t = d.settings;

  const loadFillers = useCallback(async () => {
    try {
      const r = await fetch("/api/fillers");
      if (r.ok) {
        const data = (await r.json()) as { en: string[]; ar: string[] };
        setFillersEn(data.en.join(", "));
        setFillersAr(data.ar.join(", "));
      }
    } catch { /* offline */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const [rHw, rLlm] = await Promise.all([fetch("/api/hardware"), fetch("/api/llm")]);
      if (rHw.ok) setHw((await rHw.json()) as HardwareInfo);
      if (rLlm.ok) setLlm((await rLlm.json()) as LlmState);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    void load();
    void loadFillers();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load, loadFillers]);

  // poll while a model download is active
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch("/api/models");
        if (r.ok) {
          const data = (await r.json()) as {
            models: { id: string; downloaded: boolean; bytes: number }[];
            download: NonNullable<HardwareInfo["models"]>["download"];
          };
          setHw((prev) =>
            prev
              ? {
                  ...prev,
                  modelsReady: data.models.some((m) => m.downloaded),
                  models: prev.models
                    ? { ...prev.models, items: data.models, download: data.download }
                    : prev.models,
                }
              : prev
          );
          if (!data.download || data.download.done) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setDlBusy(null);
            if (data.download?.done && !data.download.error) toast({ title: t.dlDone });
            if (data.download?.error) toast({ title: t.dlFail, description: data.download.error, variant: "destructive" });
          }
        }
      } catch { /* retry next tick */ }
    }, 900);
  }, [t.dlDone, t.dlFail]);

  const modelAction = async (action: "download" | "delete", id: string) => {
    if (action === "delete" && !window.confirm(`${t.delete} ${id}?`)) return;
    setDlBusy(id);
    try {
      const r = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      if (!r.ok) throw new Error();
      if (action === "download") {
        toast({ title: `${d.common.download} · ${id}` });
        startPolling();
      } else {
        toast({ title: t.deleteDone });
        setDlBusy(null);
      }
      void load();
    } catch {
      toast({ title: t.dlFail, variant: "destructive" });
      setDlBusy(null);
    }
  };

  const startOllama = async () => {
    setStartingOllama(true);
    try {
      const r = await fetch("/api/llm", { method: "POST" });
      const data = (await r.json()) as { started: boolean; ollama: LlmState["ollama"]; lmstudio: LlmState["lmstudio"] };
      setLlm({ ollama: data.ollama, lmstudio: data.lmstudio });
      toast({ title: data.started ? t.autostarted : t.autostartFail, variant: data.started ? "default" : "destructive" });
    } finally {
      setStartingOllama(false);
    }
  };

  const launch = async () => {
    setLaunching(true);
    try {
      const r = await fetch("/api/corpusmind", { method: "POST" });
      const data = await r.json();
      if (data.launched) toast({ title: t.cmDetected });
      else toast({ title: t.cmMissing, description: "https://waleedmandour.org/projects/CorpusMind/" });
    } finally {
      setLaunching(false);
    }
  };

  const parseFillerList = (s: string): string[] =>
    [...new Set(s.split(/[,،]/).map((w) => w.trim()).filter(Boolean))];

  const saveFillers = async (en = fillersEn, arr = fillersAr) => {
    setFillersSaving(true);
    try {
      const r = await fetch("/api/fillers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ en: parseFillerList(en), ar: parseFillerList(arr) }),
      });
      if (!r.ok) throw new Error();
      toast({ title: t.fillersSaved });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setFillersSaving(false);
    }
  };

  const resetFillers = async () => {
    try {
      const r = await fetch("/api/fillers");
      if (r.ok) {
        const data = (await r.json()) as { defaults: { en: string[]; ar: string[] } };
        setFillersEn(data.defaults.en.join(", "));
        setFillersAr(data.defaults.ar.join(", "));
        await saveFillers(data.defaults.en.join(", "), data.defaults.ar.join(", "));
      }
    } catch { /* offline */ }
  };

  if (!hw)
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
      </div>
    );

  const models = hw.models?.items ?? [];
  const dl = hw.models?.download ?? null;
  const dlActive = dl && !dl.done && !dl.error;

  return (
    <div className="grid gap-4">
      {/* ---------------- filler lexicon ---------------- */}
      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className={`flex items-center gap-2 text-base ${ar ? "font-arabic" : ""}`}>
            <MessageSquareQuote className="h-4 w-4 text-cyan-400" />
            {t.fillersTitle}
          </CardTitle>
          <CardDescription className={ar ? "font-arabic" : ""}>{t.fillersDesc}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={`mb-1.5 block text-sm font-medium ${ar ? "font-arabic" : ""}`}>{t.fillersEn}</label>
              <Textarea dir="ltr" rows={3} value={fillersEn} onChange={(e) => setFillersEn(e.target.value)} />
            </div>
            <div>
              <label className={`mb-1.5 block text-sm font-medium ${ar ? "font-arabic" : ""}`}>{t.fillersAr}</label>
              <Textarea dir="rtl" rows={3} className="font-arabic" value={fillersAr} onChange={(e) => setFillersAr(e.target.value)} />
            </div>
          </div>
          <p className={`text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.fillersHint}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void saveFillers()} disabled={fillersSaving} className="gap-1.5">
              {fillersSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span className={ar ? "font-arabic" : ""}>{d.common.save}</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => void resetFillers()} disabled={fillersSaving} className="gap-1.5">
              <Undo2 className="h-3.5 w-3.5" />
              <span className={ar ? "font-arabic" : ""}>{t.fillersReset}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- models manager ---------------- */}
      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className={`flex items-center gap-2 text-base ${ar ? "font-arabic" : ""}`}>
            <Boxes className="h-4 w-4 text-cyan-400" />
            {t.modelsTitle}
          </CardTitle>
          <CardDescription className={ar ? "font-arabic" : ""}>{t.modelsDesc}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" dir="ltr">
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span className={`font-arabic ${ar ? "" : "hidden"}`}>{t.modelsDir}:</span>
            <code className="truncate rounded bg-muted px-1.5 py-0.5">{hw.models?.dir ?? "—"}</code>
            <span className="ms-auto tabular-nums">{t.storageUsed}: {fmtBytes(hw.models?.totalBytes ?? 0)}</span>
          </p>

          <ul className="grid gap-2">
            {models.map((m) => {
              const isDl = dlActive && dl.id === m.id;
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-3">
                  <HardDrive className={`h-4 w-4 shrink-0 ${m.downloaded ? "text-emerald-500" : "text-muted-foreground"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" dir="ltr">{m.id}</p>
                    <p className={`truncate text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>
                      {d.settings[MODEL_LABEL_KEYS[m.id as keyof typeof MODEL_LABEL_KEYS] ?? "sizeLargeV3"]}
                    </p>
                    {isDl && (
                      <div className="mt-1.5 grid gap-1">
                        <Progress value={dl.pct} className="h-1.5" />
                        <p className="text-[11px] tabular-nums text-muted-foreground" dir="ltr">
                          {fmtBytes(dl.received)} / ~{fmtBytes(dl.total)} · {dl.pct}% · {dl.file}
                        </p>
                      </div>
                    )}
                  </div>
                  {m.downloaded ? (
                    <Badge variant="outline" className="shrink-0 border-emerald-500/40 text-emerald-500">
                      {t.downloaded}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 text-muted-foreground">{t.notDownloaded}</Badge>
                  )}
                  {m.downloaded ? (
                    <Button size="sm" variant="outline" disabled={!!dlActive} onClick={() => void modelAction("delete", m.id)} className="shrink-0 gap-1.5 px-2">
                      {dlBusy === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      <span className={ar ? "font-arabic" : ""}>{t.delete}</span>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!!dlActive} onClick={() => void modelAction("download", m.id)} className="shrink-0 gap-1.5 px-2">
                      {dlBusy === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      <span className={ar ? "font-arabic" : ""}>{t.download}</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className={`text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.dlNote}</p>
        </CardContent>
      </Card>

      {/* ---------------- local LLM (Ollama / LM Studio) ---------------- */}
      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className={`flex items-center gap-2 text-base ${ar ? "font-arabic" : ""}`}>
            <Bot className="h-4 w-4 text-cyan-400" />
            {t.llmTitle}
          </CardTitle>
          <CardDescription className={ar ? "font-arabic" : ""}>{t.llmDesc}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {llm && (["ollama", "lmstudio"] as const).map((key) => {
            const p = llm[key];
            const label = key === "ollama" ? t.ollama : t.lmstudio;
            return (
              <div key={key} className="rounded-lg border border-border/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {p.detected ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <TriangleAlert className="h-4 w-4 text-amber-500" />}
                  <span className="text-sm font-semibold" dir="ltr">{label}</span>
                  <Badge variant="outline" className={p.detected ? "border-emerald-500/40 text-emerald-500" : "border-amber-500/40 text-amber-500"} dir="ltr">
                    {p.detected ? t.online : t.offline} · {p.url}
                  </Badge>
                </div>
                <div className="mt-2">
                  <p className={`text-xs font-medium text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.modelsLoaded}:</p>
                  {p.models.length === 0 ? (
                    <p className={`mt-1 text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.noModels}</p>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {p.models.slice(0, 24).map((m) => (
                        <Badge key={m.name} variant="secondary" className="max-w-full" dir="ltr">
                          <span className="truncate">{m.name}</span>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()} className="gap-1.5">
              <RefreshCcw className="h-3.5 w-3.5" />
              <span className={ar ? "font-arabic" : ""}>{t.refresh}</span>
            </Button>
            <Button size="sm" variant="outline" disabled={startingOllama || !!llm?.ollama.detected} onClick={() => void startOllama()} className="gap-1.5">
              {startingOllama ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MonitorPlay className="h-3.5 w-3.5" />}
              <span className={ar ? "font-arabic" : ""}>{startingOllama ? t.starting : t.autoStart}</span>
            </Button>
          </div>
          <p className={`text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t.assistantUses}</p>
        </CardContent>
      </Card>

      {/* ---------------- hardware ---------------- */}
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className={ar ? "font-arabic" : ""}>{t.hwTitle}</CardTitle>
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
                <Badge variant="outline" className="mt-1" dir="ltr">
                  {models.filter((m) => m.downloaded).map((m) => m.id).join(", ") || "—"}
                </Badge>
                <p className={`mt-1 text-xs ${models.some((m) => m.downloaded) ? "text-emerald-500" : "text-amber-500"} ${ar ? "font-arabic" : ""}`}>
                  {models.some((m) => m.downloaded) ? t.downloaded : t.dlNote}
                </p>
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

      {/* ---------------- CorpusMind integration ---------------- */}
      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className={`flex items-center gap-2 text-base ${ar ? "font-arabic" : ""}`}>
            <Rocket className="h-4 w-4 text-amber-500" />
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
              <a className="text-cyan-400 underline" href="https://waleedmandour.org/projects/CorpusMind/" target="_blank" rel="noreferrer">
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
    </div>
  );
}
