"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Upload, Mic, Square, FileAudio, AudioLines, AlignHorizontalJustifyCenter,
  Activity, ScanText, Database, CheckCircle2, XCircle, Loader2, Clock, TriangleAlert,
} from "lucide-react";
import { STAGE_KEYS, WHISPER_SIZES, type JobView, type WhisperSize } from "@/lib/types";
import type { Dict, Lang } from "@/lib/i18n";

const STAGE_ICONS = [FileAudio, AudioLines, AlignHorizontalJustifyCenter, Activity, ScanText, Database];

// Full-coverage accept list (extensions + MIME types) so mobile OS pickers
// surface M4A voice memos, OGG/OPUS recordings, etc.
const AUDIO_ACCEPT = [
  "audio/*", "video/mp4", "video/webm",
  ".mp3", ".mp4", ".m4a", ".m4b", ".aac", ".wav", ".flac", ".ogg", ".oga",
  ".opus", ".webm", ".wma", ".amr", ".3gp", ".aif", ".aiff",
].join(",");

// MediaRecorder mime fallback chain — Chrome/Firefox (webm/opus), Safari iOS &
// macOS WKWebView (mp4/aac), older Android + Firefox (ogg/opus).
const REC_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "",
];

function pickRecMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of REC_MIMES) {
    if (!m || MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

function mimeToExt(mime: string): string {
  if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

interface JobsResponse {
  jobs: (JobView & { audio: { fileName: string; language: string } | null })[];
}

interface StudioProps {
  lang: Lang;
  d: Dict;
  job: JobView | null;
  onUploaded: (audioId: string, jobId: string) => void;
  onOpenJob: (audioId: string, jobId: string) => void;
}

export function Studio({ lang, d, job, onUploaded, onOpenJob }: StudioProps) {
  const [lang_, setLang_] = useState("en");
  const [device, setDevice] = useState("auto");
  const [model, setModel] = useState<WhisperSize>("large-v3");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [recent, setRecent] = useState<JobsResponse["jobs"]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ar = lang === "ar";

  const t = (k: keyof typeof d.studio) => d.studio[k];

  // which Whisper models are already on disk (from the Settings manager)
  const [downloaded, setDownloaded] = useState<string[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/models");
        if (!r.ok) return;
        const data = (await r.json()) as { models?: { id: string; downloaded: boolean }[] };
        setDownloaded((data.models ?? []).filter((m) => m.downloaded).map((m) => m.id));
      } catch { /* offline */ }
    })();
  }, []);
  const selectedReady = downloaded.includes(model);

  const refreshRecent = useCallback(async () => {
    try {
      const r = await fetch("/api/jobs");
      if (r.ok) setRecent(((await r.json()) as JobsResponse).jobs);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    void refreshRecent();
    const iv = setInterval(refreshRecent, 5000);
    return () => clearInterval(iv);
  }, [refreshRecent, job?.status]);

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("language", lang_);
        fd.append("device", device);
        fd.append("model", model);
        const r = await fetch("/api/upload", { method: "POST", body: fd });
        const data = (await r.json()) as { audioId?: string; jobId?: string; error?: string };
        if (!r.ok || !data.jobId) throw new Error(data.error ?? "Upload failed");
        onUploaded(data.audioId!, data.jobId);
        void refreshRecent();
      } catch (e) {
        toast({ title: e instanceof Error ? e.message : "Upload failed", variant: "destructive" });
      } finally {
        setUploading(false);
      }
    },
    [lang_, device, model, onUploaded, refreshRecent]
  );

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void upload(f);
  };

  const startRec = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast({ title: t("recUnsupported"), variant: "destructive" });
      return;
    }
    if (window.isSecureContext === false) {
      toast({ title: t("recInsecure"), variant: "destructive" });
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      toast({ title: t("recUnsupported"), variant: "destructive" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      chunks.current = [];
      const mimeType = pickRecMime();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mr.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const type = mr.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        if (blob.size === 0) {
          toast({ title: t("recUnsupported"), variant: "destructive" });
          return;
        }
        const ext = mimeToExt(type);
        void upload(new File([blob], `mic-recording-${Date.now()}.${ext}`, { type }));
      };
      recorder.current = mr;
      mr.start(1000); // gather chunks every second — resilient on mobile backgrounding
      setRecording(true);
      setRecSecs(0);
      timer.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotFoundError" || name === "OverconstrainedError")
        toast({ title: t("recNoDevices"), variant: "destructive" });
      else if (name === "NotAllowedError" || name === "SecurityError")
        toast({ title: t("recDenied"), variant: "destructive" });
      else toast({ title: t("micDenied"), variant: "destructive" });
    }
  };

  const stopRec = () => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
    if (timer.current) clearInterval(timer.current);
  };

  const stageNow = job?.stage ?? -1;

  return (
    <div className="grid gap-6">
      {/* ---------- input ---------- */}
      <Card className="brand-gradient-soft border-border/70">
        <CardHeader>
          <CardTitle className={ar ? "font-arabic" : ""}>{t("title")}</CardTitle>
          <CardDescription className={ar ? "font-arabic" : ""}>{t("desc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={`mb-1.5 block text-sm font-medium ${ar ? "font-arabic" : ""}`}>{t("language")}</label>
              <Select value={lang_} onValueChange={setLang_} dir={ar ? "rtl" : "ltr"}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t("langEn")}</SelectItem>
                  <SelectItem value="arz">{t("langArEgy")}</SelectItem>
                  <SelectItem value="arb">{t("langArMsa")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className={`mb-1.5 block text-sm font-medium ${ar ? "font-arabic" : ""}`}>{t("device")}</label>
              <Select value={device} onValueChange={setDevice} dir={ar ? "rtl" : "ltr"}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("deviceAuto")}</SelectItem>
                  <SelectItem value="cpu">{t("deviceCpu")}</SelectItem>
                  <SelectItem value="cuda">{t("deviceGpu")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className={`mb-1.5 block text-sm font-medium ${ar ? "font-arabic" : ""}`}>{t("model")}</label>
              <Select value={model} onValueChange={(v) => setModel(v as WhisperSize)} dir="ltr">
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WHISPER_SIZES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                      {downloaded.includes(s) ? " ✓" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!selectedReady ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-500">
                  <TriangleAlert className="h-3 w-3 shrink-0" />
                  <span className={ar ? "font-arabic" : ""}>{t("modelMissing")}</span>
                </p>
              ) : (
                <p className={`mt-1 text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t("modelHint")}</p>
              )}
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label={t("dropzone")}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-all
              ${dragOver ? "border-cyan-400 bg-cyan-400/10 glow-cyan" : "border-border hover:border-cyan-500/50 hover:bg-accent/40"}`}
          >
            {uploading ? (
              <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
            ) : (
              <Upload className="h-8 w-8 text-cyan-400" />
            )}
            <p className={`text-sm font-medium ${ar ? "font-arabic" : ""}`}>{t("dropzone")}</p>
            <p className={`text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t("dropzoneHint")}</p>
            <input
              ref={inputRef} type="file" className="hidden" accept={AUDIO_ACCEPT}
              onChange={(e) => onFiles(e.target.files)}
            />
          </div>

          <div className="flex items-center justify-center">
            {recording ? (
              <Button variant="destructive" onClick={stopRec} className="rec-pulse gap-2">
                <Square className="h-4 w-4" />
                <span className={ar ? "font-arabic" : ""}>{t("stopRecord")}</span>
                <span className="tabular-nums">· {String(Math.floor(recSecs / 60)).padStart(2, "0")}:{String(recSecs % 60).padStart(2, "0")}</span>
              </Button>
            ) : (
              <Button variant="outline" onClick={startRec} className="gap-2">
                <Mic className="h-4 w-4 text-cyan-400" />
                <span className={ar ? "font-arabic" : ""}>{t("record")}</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---------- six-stage pipeline ---------- */}
      {job && (
        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className={`text-base ${ar ? "font-arabic" : ""}`}>
                {job.status === "done" ? t("done") : job.status === "error" ? t("error") : job.status === "queued" ? t("queue") : t("running")}
              </CardTitle>
              <Badge variant={job.engine === "python" ? "default" : "secondary"} className={ar ? "font-arabic" : ""}>
                {job.engine === "python" ? t("enginePython") : t("engineSim")}
              </Badge>
              <Badge variant="outline" className="gap-1 tabular-nums">
                <Clock className="h-3 w-3" />{t("elapsed")}: {Math.floor(job.elapsedSec)}s
              </Badge>
              {job.audio?.fileName && (
                <span className="ms-auto max-w-[16rem] truncate text-xs text-muted-foreground">{job.audio.fileName}</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Progress value={job.progress} className="h-2.5" />
            <p className={`text-xs text-muted-foreground ${ar ? "font-arabic" : ""}`}>
              {t("stage")} {Math.min(job.stage + 1, 6)} {t("of")} 6 — {job.message ?? ""}
            </p>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {STAGE_KEYS.map((key, i) => {
                const Icon = STAGE_ICONS[i];
                const state =
                  job.status === "done" || (job.status === "running" && i < job.stage)
                    ? "done"
                    : i === job.stage && job.status === "running"
                      ? "active"
                      : "wait";
                return (
                  <li
                    key={key}
                    className={`flex items-center gap-3 rounded-lg border p-3 transition-all
                      ${state === "done" ? "border-emerald-500/30 bg-emerald-500/5" : state === "active" ? "border-cyan-400/50 bg-cyan-400/5 glow-cyan" : "border-border/60 opacity-60"}`}
                  >
                    {state === "done" ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                    ) : state === "active" ? (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-cyan-400" />
                    ) : job.status === "error" && i === job.stage ? (
                      <XCircle className="h-5 w-5 shrink-0 text-destructive" />
                    ) : (
                      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className={`truncate text-xs font-semibold ${ar ? "font-arabic" : ""}`}>{d.stages[key]}</p>
                      <p className="truncate text-[11px] text-muted-foreground" dir="ltr">{d.stagesDesc[key]}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {job.error && <p className="text-xs text-destructive">{job.error}</p>}
          </CardContent>
        </Card>
      )}

      {/* ---------- recent jobs ---------- */}
      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className={`text-base ${ar ? "font-arabic" : ""}`}>{t("recent")}</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className={`text-sm text-muted-foreground ${ar ? "font-arabic" : ""}`}>{t("noJobs")}</p>
          ) : (
            <ScrollArea className="max-h-56 cm-scroll">
              <ul className="grid gap-1.5 pe-3">
                {recent.map((j) => (
                  <li key={j.id}>
                    <button
                      onClick={() => j.audioId && onOpenJob(j.audioId, j.id)}
                      className="flex w-full items-center gap-3 rounded-lg border border-border/50 px-3 py-2 text-start transition-colors hover:bg-accent/50"
                    >
                      {j.status === "done" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      ) : j.status === "error" ? (
                        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                      ) : (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-400" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">{j.audio?.fileName ?? j.id}</span>
                      <Badge variant="outline" className="shrink-0">{j.audio?.language ?? "—"}</Badge>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {Math.round(j.progress)}%
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
