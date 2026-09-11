// CorpusMind Voice - server-side pipeline orchestrator (real processing only).
//
// A sequential worker processes jobs through the six linguistic stages,
// persisting progress in the Job table. Two engines can produce a corpus:
//
//   1. Python worker (optional accelerator): if the host has python3 with
//      faster-whisper/parselmouth installed, it is spawned first and its
//      output ingested unchanged.
//   2. Built-in Node engine (always available, fully offline): ffmpeg decodes
//      the recording to 16 kHz mono PCM, Whisper runs locally through ONNX
//      Runtime (Transformers.js) with cross-attention word timestamps, and
//      prosody/disfluency are measured directly on the waveform (src/lib/dsp).
//
// There is no demo/simulation fallback: if a stage genuinely fails, the job
// fails with an actionable message (e.g. "download the model in Settings").

import { db } from "@/lib/db";
import { STAGE_KEYS, type StageKey, type JobResult, type ProsodySet, type DisfluencySet } from "@/lib/types";
import { isDownloaded, resolveModelDir, MODELS_DIR } from "@/lib/models";
import { transcribePcm, type AsrWord } from "@/lib/asr";
import { decodeInt16Mono, noiseFloor, acousticConfidence, prosodyForSegment } from "@/lib/dsp";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { OUTPUT_DIR, ensureDirSync } from "@/lib/paths";
import { findPython } from "@/lib/python";

interface QueueItem {
  jobId: string;
  audioId: string;
}

// ---- global singleton queue (survives HMR) ----
interface QueueState {
  items: QueueItem[];
  running: boolean;
}
const g = globalThis as unknown as { __cmQueue?: QueueState };
const queue: QueueState = (g.__cmQueue ??= { items: [], running: false });

export function enqueue(jobId: string, audioId: string) {
  queue.items.push({ jobId, audioId });
  void drain();
}

async function drain() {
  if (queue.running) return;
  queue.running = true;
  try {
    while (queue.items.length > 0) {
      const item = queue.items.shift()!;
      await runJob(item.jobId, item.audioId).catch(async (e) => {
        await db.job.update({
          where: { id: item.jobId },
          data: { status: "error", error: String(e?.message ?? e) },
        });
      });
    }
  } finally {
    queue.running = false;
  }
}

// ---------- helpers ----------

async function setStage(
  jobId: string,
  stage: number,
  progress: number,
  message?: string
) {
  await db.job.update({
    where: { id: jobId },
    data: {
      stage,
      stageKey: STAGE_KEYS[Math.min(stage, 5)] as StageKey,
      progress: Math.max(0, Math.min(99, Math.round(progress))),
      status: "running",
      ...(message !== undefined ? { message } : {}),
    },
  });
}

// ---------- Python worker bridge (optional accelerator) ----------

function runPythonWorker(
  audioPath: string,
  outDir: string,
  lang: string,
  device: string,
  model: string,
  onProgress: (stage: number, progress: number, msg: string) => void,
  fillers: string[] = []
): Promise<JobResult | null> {
  return new Promise((resolve) => {
    void (async () => {
  const py = await findPython();
  if (!py) return resolve(null); // no Python 3 on this host - built-in engine takes over
  const localModelDir = resolveModelDir(model); // persisted download (app data)
    const p = spawn(py, [
      path.join(process.cwd(), "python", "processor.py"),
      "--input", audioPath,
      "--outdir", outDir,
      "--lang", lang,
      "--device", device,
      "--model", localModelDir ?? model,
      "--models-dir", MODELS_DIR,
      "--events",
    ], {
      env: {
        ...process.env,
        // user-defined filler lexicon for the disfluency stage (JSON array)
        ...(fillers.length ? { CMV_FILLERS: JSON.stringify(fillers) } : {}),
      },
    });
    let buf = "";
    let result: JobResult | null = null;
    let ok = false;
    const timer = setTimeout(() => p.kill("SIGKILL"), 1000 * 60 * 30);
    p.stdout?.on("data", (d) => {
      buf += d.toString();
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("{")) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.event === "progress")
            onProgress(ev.stage ?? 0, ev.progress ?? 0, ev.message ?? "");
          if (ev.event === "done") {
            ok = true;
            result = ev.result as JobResult;
          }
        } catch { /* ignore malformed lines */ }
      }
    });
    p.on("error", () => { clearTimeout(timer); resolve(null); });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve(ok && code === 0 ? result : null);
    });
    })().catch(() => resolve(null));
  });
}

interface WorkerUtterance {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  disfluencies?: unknown;
  prosody?: unknown;
  tokens: { text: string; startMs?: number; endMs?: number; start?: number; end?: number; confidence?: number }[];
}

// Ingest the Python worker's corpus.json into the app database.
// Returns the persisted token count (0 → nothing usable was produced).
async function ingestWorkerOutput(audioId: string, outDir: string): Promise<number> {
  const jsonPath = path.join(outDir, "corpus.json");
  if (!existsSync(jsonPath)) return 0;
  let payload: { utterances?: WorkerUtterance[] };
  try {
    payload = JSON.parse(await readFile(jsonPath, "utf8"));
  } catch {
    return 0;
  }
  const utters = payload.utterances ?? [];
  let tokenCount = 0;
  for (const u of utters) {
    const created = await db.utterance.create({
      data: {
        audioId,
        index: u.index,
        startMs: u.startMs,
        endMs: u.endMs,
        text: u.text,
        speaker: u.speaker ?? "SPK1",
        disfluencies: (u.disfluencies ?? null) as object,
        prosody: (u.prosody ?? null) as object,
      },
    });
    for (let i = 0; i < (u.tokens ?? []).length; i++) {
      const w = u.tokens[i];
      const startMs = (w.startMs ?? (w.start ?? 0) * 1000) as number;
      const endMs = (w.endMs ?? (w.end ?? 0) * 1000) as number;
      if (!w.text || endMs <= 0) continue;
      await db.token.create({
        data: {
          utteranceId: created.id,
          index: i,
          text: w.text,
          startMs,
          endMs,
          confidence: Number(
            (typeof w.confidence === "number" && Number.isFinite(w.confidence) ? w.confidence : 0.9).toFixed(3)
          ),
        },
      });
      tokenCount++;
    }
  }
  return tokenCount;
}

// ---------- built-in Node engine ----------

const FILLERS: Record<string, Set<string>> = {
  en: new Set(["um", "uh", "erm", "hmm"]),
  ar: new Set(["يعني", "آه", "إيه", "أه", "طب", "اه"]),
};

// Load the user-customizable filler lexicon (Settings tab) for a language.
// Falls back to the built-in defaults when nothing is stored yet.
const DEFAULT_FILLER_LISTS: Record<string, string[]> = {
  en: ["um", "uh", "erm", "like", "you know"],
  ar: ["يعني", "آه", "إيه", "أه", "طب"],
};

async function loadFillers(lang: string): Promise<string[]> {
  const base = lang === "en" ? "en" : "ar";
  try {
    const row = await db.appSetting.findUnique({ where: { key: "fillers" } });
    if (row) {
      const parsed = JSON.parse(row.value) as Record<string, unknown>;
      const list = parsed[base];
      if (Array.isArray(list) && list.length) {
        return list.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      }
    }
  } catch { /* fall through to defaults */ }
  return DEFAULT_FILLER_LISTS[base];
}

const norm = (w: string) => w.toLowerCase().replace(/[.,!?;:،؛?؟…"'()]+$/u, "").replace(/^["'()]+/u, "");

/** Group ASR words into utterances on pauses and sentence enders. */
function groupUtterances(words: AsrWord[]): AsrWord[][] {
  const groups: AsrWord[][] = [];
  let cur: AsrWord[] = [];
  for (const w of words) {
    if (cur.length > 0) {
      const gap = w.startMs - cur[cur.length - 1].endMs;
      const ended = /([.!?…؟])$/.test(cur[cur.length - 1].text);
      const dur = w.startMs - cur[0].startMs;
      if (gap > 700 || (ended && gap > 250) || dur > 30_000) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

/** Pause / filler / repeat / false-start / lengthening scan (spec heuristics). */
function disfluencyFor(words: AsrWord[], langKey: "en" | "ar", customFillers?: string[]): DisfluencySet {
  const fillers = new Set(customFillers && customFillers.length ? customFillers : [...FILLERS[langKey]]);
  const pauses: number[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].startMs - words[i - 1].endMs;
    if (gap > 200) pauses.push(Math.round(gap));
  }
  const toks = words.map((w) => norm(w.text));
  const fill = words.filter((_, i) => toks[i] && fillers.has(toks[i])).map((w) => w.text);
  const repeats = words.filter((_, i) => i > 0 && toks[i] && toks[i] === toks[i - 1]).map((w) => w.text);
  const counts = new Map<string, number>();
  for (const t of toks) if (t.length <= 2) counts.set(t, (counts.get(t) ?? 0) + 1);
  const falseStarts = words.filter((_, i) => toks[i] && (counts.get(toks[i]) ?? 0) >= 3).map((w) => w.text);
  const lengthenings = words
    .filter((w) => /(.)\1{2,}$/.test(w.text) || w.text.endsWith("∼"))
    .map((w) => w.text);
  return { pauses, fillers: fill, repeats, falseStarts, interruptions: [], lengthenings };
}

async function runNodeEngine(
  jobId: string,
  audioId: string,
  audio: { filePath: string; language: string; model: string; device: string }
): Promise<JobResult> {
  const langKey: "en" | "ar" = audio.language === "en" ? "en" : "ar";
  const customFillers = await loadFillers(langKey);

  // stage 0 - ingest: real decode to 16 kHz mono PCM
  await setStage(jobId, 0, 5, "Decoding container to 16 kHz mono PCM");
  const { pcm, sampleRate } = await decodeInt16Mono(audio.filePath);
  const durationSec = pcm.length / sampleRate;
  await db.audioMetadata.update({ where: { id: audioId }, data: { durationSec: +durationSec.toFixed(1) } });
  await setStage(jobId, 0, 99, `Decoded ${Math.round(durationSec)}s of audio at 16 kHz mono`);

  // stage 1 - ASR: local Whisper (ONNX Runtime) with word timestamps
  if (!isDownloaded(audio.model)) {
    throw new Error(
      `Whisper model "${audio.model}" is not downloaded. Open Settings & Diagnostics and download it, then re-run this recording.`
    );
  }
  await setStage(jobId, 1, 2, `Loading Whisper ${audio.model} locally (ONNX, offline)`);
  const words = await transcribePcm(pcm, sampleRate, {
    model: audio.model,
    language: audio.language,
    onProgress: (pct, msg) => { void setStage(jobId, 1, Math.max(3, pct), msg); },
  });
  if (words.length === 0) {
    throw new Error("Whisper produced no words. The recording may be silent or the wrong language was selected. Re-run with a different language or model.");
  }

  // stage 2 - alignment: Whisper cross-attention (DTW) word boundaries
  await setStage(jobId, 2, 60, "Word alignment from Whisper cross-attention timestamps");
  await setStage(jobId, 2, 99, `Aligned ${words.length} words to the waveform`);

  // group words into utterances once; all later stages reuse the grouping
  const groups = groupUtterances(words);
  const floor = noiseFloor(pcm);

  // stage 3 - prosody: F0 / intensity / jitter / shimmer / HNR from the PCM
  const prosodies: (ProsodySet | null)[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g0 = groups[i];
    const startMs = Math.max(0, g0[0].startMs - 120);
    const endMs = g0[g0.length - 1].endMs + 120;
    const p = prosodyForSegment(pcm, startMs, endMs, floor);
    prosodies.push(p);
    if (i % 3 === 0 || i === groups.length - 1) {
      await setStage(jobId, 3, ((i + 1) / groups.length) * 100, `Prosody analysis ${i + 1}/${groups.length} (F0, intensity, jitter, shimmer, HNR)`);
    }
  }

  // stage 4 - disfluency: pauses, fillers, repeats, false starts, lengthenings
  const disfluencies: DisfluencySet[] = groups.map((g1) => disfluencyFor(g1, langKey, customFillers));
  await setStage(jobId, 4, 99, `Disfluency scan complete (${groups.length} utterances)`);

  // stage 5 - structure: persist the annotated corpus
  await setStage(jobId, 5, 5, "Writing utterances, tokens and acoustic layers");
  let tokenCount = 0;
  let disfluencyTotal = 0;
  for (let i = 0; i < groups.length; i++) {
    const g2 = groups[i];
    const startMs = Math.max(0, g2[0].startMs - 120);
    const endMs = g2[g2.length - 1].endMs + 120;
    const created = await db.utterance.create({
      data: {
        audioId,
        index: i,
        startMs,
        endMs,
        text: g2.map((w) => w.text).join(" "),
        speaker: "SPK1",
        disfluencies: disfluencies[i] as object,
        prosody: (prosodies[i] ?? null) as object,
      },
    });
    for (let j = 0; j < g2.length; j++) {
      const w = g2[j];
      await db.token.create({
        data: {
          utteranceId: created.id,
          index: j,
          text: w.text,
          startMs: w.startMs,
          endMs: w.endMs,
          confidence: acousticConfidence(pcm, w.startMs, w.endMs, floor),
        },
      });
      tokenCount++;
    }
    disfluencyTotal += Object.values(disfluencies[i]).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
    if (i % 5 === 0 || i === groups.length - 1) {
      await setStage(jobId, 5, 5 + ((i + 1) / groups.length) * 93, `Persisting corpus ${i + 1}/${groups.length}`);
    }
  }

  return {
    utterances: groups.length,
    tokens: tokenCount,
    disfluencies: disfluencyTotal,
    durationSec: +durationSec.toFixed(1),
    rtf: 0, // set by the caller from the measured wall-clock time
  };
}

// ---------- main job runner ----------

async function runJob(jobId: string, audioId: string) {
  const t0 = Date.now();
  await db.job.update({
    where: { id: jobId },
    data: { status: "running", stage: 0, stageKey: "ingest", progress: 1 },
  });
  const audio = await db.audioMetadata.findUnique({ where: { id: audioId } });
  if (!audio) throw new Error("Audio record not found");

  const outDir = path.join(OUTPUT_DIR, jobId);
  if (!ensureDirSync(outDir)) throw new Error(`Worker output folder is not writable: ${outDir}`);

  const device = audio.device || "cpu";
  const lang = audio.language || "en";
  const model = audio.model || "large-v3-turbo";

  // ---- attempt the optional Python worker first (real faster-whisper host) ----
  const customFillers = await loadFillers(lang);
  const wantsReal = process.env.CM_DISABLE_PYTHON !== "1";
  if (wantsReal) {
    const pyResult = await runPythonWorker(
      audio.filePath, outDir, lang, device, model,
      (stage, progress, message) => { void setStage(jobId, stage, progress, message); },
      customFillers
    ).catch(() => null);

    if (pyResult) {
      await setStage(jobId, 5, 99, "Merging worker output into corpus store");
      const tokens = await ingestWorkerOutput(audioId, outDir).catch(() => 0);
      if (tokens > 0) {
        await db.audioMetadata.update({
          where: { id: audioId },
          data: { durationSec: pyResult.durationSec },
        });
        await db.job.update({
          where: { id: jobId },
          data: {
            status: "done", stage: 5, stageKey: "structure", progress: 100,
            engine: "python", message: "Processed by the local Python worker (faster-whisper)",
            result: JSON.parse(JSON.stringify({ ...pyResult, tokens })) as object,
            elapsedSec: (Date.now() - t0) / 1000,
          },
        });
        return;
      }
      // Worker produced no usable ASR tokens (deps missing) → built-in engine
      await db.utterance.deleteMany({ where: { audioId } });
    }
  }

  // ---- built-in Node engine (Whisper ONNX + real DSP) ----
  await db.job.update({ where: { id: jobId }, data: { engine: "onnx" } });

  const result = await runNodeEngine(jobId, audioId, {
    filePath: audio.filePath,
    language: lang,
    model,
    device,
  });
  // real-time factor from the actual wall-clock time of the whole job
  result.rtf = +(((Date.now() - t0) / 1000) / Math.max(result.durationSec, 0.1)).toFixed(2);

  await db.job.update({
    where: { id: jobId },
    data: {
      status: "done", stage: 5, stageKey: "structure", progress: 100,
      message: `Transcribed and annotated locally with Whisper ${model} (offline)`,
      result: JSON.parse(JSON.stringify(result)) as object,
      elapsedSec: (Date.now() - t0) / 1000,
    },
  });
}
