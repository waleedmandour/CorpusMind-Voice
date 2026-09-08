// CorpusMind Voice — server-side pipeline orchestrator.
// Mirrors the asyncio task queue of the Python design: a sequential worker
// processes jobs stage by stage, emitting progress persisted in the Job table.
// If the real Python worker (faster-whisper + MFA + Parselmouth) is available
// it is spawned; otherwise a fully local simulation engine drives the same
// six-stage contract so the app remains usable offline in demo mode.

import { db } from "@/lib/db";
import { STAGE_KEYS, type StageKey, type JobResult } from "@/lib/types";
import { resolveModelDir, MODELS_DIR } from "@/lib/models";
import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "audio");
const UPLOAD_DB_DIR = path.join(process.cwd(), "data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fileDurationSec(filePath: string, bytes: number): Promise<number> {
  // Try ffprobe for an exact duration; fall back to a bitrate estimate.
  const dur = await new Promise<number | null>((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "quiet", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ]);
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.on("error", () => resolve(null));
    p.on("close", () => {
      const v = parseFloat(out.trim());
      resolve(Number.isFinite(v) && v > 0 ? v : null);
    });
    setTimeout(() => resolve(null), 4000);
  });
  if (dur) return dur;
  // rough heuristic: compressed ~ 24 kB/s, wav 32 kB/s
  const kbps = filePath.endsWith(".wav") ? 32 : 24;
  return Math.max(20, Math.min(3600, bytes / (kbps * 1000)));
}

// ---------- Python worker bridge ----------

function runPythonWorker(
  audioPath: string,
  outDir: string,
  lang: string,
  device: string,
  model: string,
  onProgress: (stage: number, progress: number, msg: string) => void
): Promise<JobResult | null> {
  return new Promise((resolve) => {
    const localModelDir = resolveModelDir(model); // persisted download (app data)
    const p = spawn("python3", [
      path.join(process.cwd(), "python", "processor.py"),
      "--input", audioPath,
      "--outdir", outDir,
      "--lang", lang,
      "--device", device,
      "--model", localModelDir ?? model,
      "--models-dir", MODELS_DIR,
      "--events",
    ]);
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
  });
}

// ---------- simulation engine (demo corpus, fully offline) ----------

const EN_SENTS = [
  "So I was thinking about the way we frame the research question isn't it kind of circular?",
  "Um the thing is corpus methods let you see patterns you would never notice by hand.",
  "Yeah yeah I agree but the annotation scheme needs to be consistent across raters.",
  "We recorded like forty hours of interviews last semester which is honestly a lot.",
  "The the alignment quality matters because downstream prosody depends on it.",
  "Okay so what if we run two passes first whisper then forced alignment on top.",
  "I mean that's basically the pipeline we are building right now.",
  "Uh let me check the confidence scores before we ship the export.",
];

const AR_SENTS = [
  "يعني إحنا محتاجين نحدد سؤال البحث الأول قبل ما نكمل الوسم.",
  "آه هو ده اللي كنت بقوله، الطريقة دي هتوفر علينا وقت كبير.",
  "بص بص، المشكلة مش في الأدوات المشكلة في اتساق التوسيف.",
  "سجلنا أربعين ساعة مقابلات الفصل اللي فات يعني شغل كتير أوي.",
  "إيه رأيك نجرب TWO مرات، مرة تفريغ ومرة محاذاة فوقيه؟",
  "المهم إن الثقة في الكلمات تطلع عالية قبل التصدير.",
  "طب إحنا بنعمل نفس الحاجة دلوقتي بالظبط في الـ pipeline.",
  "خليني أشوف درجات الثقة الأول قبل ما نصدّر الملفات.",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

interface SimToken {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

function buildSimUtterances(durationSec: number, lang: string) {
  const sents = lang === "en" ? EN_SENTS : AR_SENTS;
  const speakingRate = 2.6; // words/sec average incl. pauses
  const targetWords = Math.max(30, Math.floor(durationSec * speakingRate));
  const utters: {
    index: number; startMs: number; endMs: number; text: string;
    tokens: SimToken[]; dis: Record<string, unknown>; pros: Record<string, unknown>;
  }[] = [];
  let t = 600; // ms lead-in
  let wi = 0;
  // wi counts words emitted so far; keep going until we reach the target
  while (wi < targetWords) {
    const text = sents[utters.length % sents.length];
    const words = text.split(/\s+/);
    const tokens: SimToken[] = [];
    let ut = t + 120;
    for (const w of words) {
      const seed = hash(w + wi);
      const dur = 140 + (seed % 260); // 140–400 ms per word
      const r = (seed % 100) / 100;
      const conf = r < 0.72 ? 0.86 + r * 0.135 : r < 0.93 ? 0.6 + (r - 0.72) * 1.1 : 0.38 + (r - 0.93) * 1.4;
      tokens.push({
        text: w,
        startMs: ut,
        endMs: ut + dur,
        confidence: Math.max(0.31, Math.min(0.995, conf)),
      });
      ut += dur + 20 + (seed % 60);
      wi++;
    }
    const end = ut + 80;
    const seedU = hash(text + utters.length);
    utters.push({
      index: utters.length,
      startMs: t,
      endMs: end,
      text,
      tokens,
      dis: {
        pauses: [(seedU % 3) + 1],
        fillers: [words.find((w) => /^(um|uh|يعني|آه|إيه)$/i.test(w)) ?? ""].filter(Boolean),
        repeats: (seedU % 4 === 0 ? [words[2] ?? ""] : []).filter(Boolean),
        falseStarts: seedU % 5 === 0 ? [words[0] ?? ""] : [],
        interruptions: seedU % 7 === 0 ? ["overlap@+" + (300 + (seedU % 400)) + "ms"] : [],
        lengthenings: seedU % 6 === 0 ? [words[words.length - 1] + "∼"] : [],
      },
      pros: {
        f0MeanHz: lang === "en" ? 118 + (seedU % 60) : 104 + (seedU % 66),
        f0MinHz: 75 + (seedU % 25),
        f0MaxHz: 190 + (seedU % 110),
        intensityMeanDb: -(26 + (seedU % 9)),
        jitterPct: +(0.25 + (seedU % 90) / 100).toFixed(2),
        shimmerPct: +(1.9 + (seedU % 210) / 100).toFixed(2),
        hnrDb: +(13 + (seedU % 90) / 10).toFixed(1),
      },
    });
    t = end + 350 + (seedU % 900); // inter-utterance pause
  }
  return utters;
}

// ---------- main job runner ----------

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

async function runJob(jobId: string, audioId: string) {
  const job = await db.job.update({
    where: { id: jobId },
    data: { status: "running", stage: 0, stageKey: "ingest", progress: 1 },
  });
  const audio = await db.audioMetadata.findUnique({ where: { id: audioId } });
  if (!audio) throw new Error("Audio record not found");

  const t0 = Date.now();
  const outDir = path.join(UPLOAD_DB_DIR, "output", jobId);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const device = audio.device || "cpu";
  const lang = audio.language || "en";

  // ---- attempt the real Python worker first ----
  const wantsReal = process.env.CM_DISABLE_PYTHON !== "1";
  if (wantsReal) {
    const pyResult = await runPythonWorker(
      audio.filePath, outDir, lang, device, audio.model || "large-v3",
      (stage, progress, message) => { void setStage(jobId, stage, progress, message); }
    ).catch(() => null);

    if (pyResult) {
      await setStage(jobId, 5, 99, "Merging worker output into corpus store");
      const tokens = await ingestWorkerOutput(audioId, outDir).catch(() => 0);
      if (tokens > 0) {
        await db.job.update({
          where: { id: jobId },
          data: {
            status: "done", stage: 5, stageKey: "structure", progress: 100,
            engine: "python", message: "Processed by local Python worker",
            result: JSON.parse(JSON.stringify({ ...pyResult, tokens })) as object,
            elapsedSec: (Date.now() - t0) / 1000,
          },
        });
        return;
      }
      // Worker produced no usable ASR tokens (deps missing) → graceful fallback
      await db.utterance.deleteMany({ where: { audioId } });
    }
  }

  // ---- simulation engine ----
  await db.job.update({
    where: { id: jobId },
    data: { engine: "simulation" },
  });

  const durationSec = await fileDurationSec(audio.filePath, audio.fileSizeBytes);
  await db.audioMetadata.update({ where: { id: audioId }, data: { durationSec } });

  const stageRuns: [number, string, number][] = [
    // [stageIndex, message, simulated ms]
    [0, "Decoding container → 16 kHz mono PCM", 1200],
    [0, "Normalizing waveform · silence trim", 900],
    [1, device === "cuda" ? `Loading ${(audio.model || "large-v3").toUpperCase()} INT8 on CUDA` : `Loading ${(audio.model || "large-v3").toUpperCase()} INT8 on CPU`, 1400],
    [1, "Transcribing with word-level timestamps", 2400],
    [2, "Loading Arabic/English pronunciation dictionaries", 1100],
    [2, "Montreal Forced Aligner — word & phone lattices", 1800],
    [3, "Parselmouth: F0 (50–400 Hz) · intensity · jitter · shimmer · HNR", 1600],
    [4, "Scanning pauses > 200 ms · fillers · repeats · false starts", 1400],
    [5, "Writing SQLite · JSON · TEI/XML", 1000],
  ];
  const total = stageRuns.reduce((a, s) => a + s[2], 0);
  let acc = 0;
  for (const [stage, message, ms] of stageRuns) {
    await setStage(jobId, stage, (acc / total) * 100, message);
    await sleep(ms);
    acc += ms;
  }

  // persist simulated corpus
  const utters = buildSimUtterances(durationSec, lang);
  let tokenCount = 0;
  for (const u of utters) {
    const created = await db.utterance.create({
      data: {
        audioId,
        index: u.index,
        startMs: u.startMs,
        endMs: u.endMs,
        text: u.text,
        disfluencies: u.dis as object,
        prosody: u.pros as object,
      },
    });
    for (let i = 0; i < u.tokens.length; i++) {
      const tk = u.tokens[i];
      await db.token.create({
        data: {
          utteranceId: created.id,
          index: i,
          text: tk.text,
          startMs: tk.startMs,
          endMs: tk.endMs,
          confidence: +tk.confidence.toFixed(3),
          phoneme: null,
        },
      });
      tokenCount++;
    }
  }

  const disfluencyTotal = utters.reduce((a, u) => {
    const d = u.dis as Record<string, unknown[]>;
    return a + Object.values(d).reduce((b: number, v) => b + (Array.isArray(v) ? v.length : 0), 0);
  }, 0);

  const result: JobResult = {
    utterances: utters.length,
    tokens: tokenCount,
    disfluencies: disfluencyTotal,
    durationSec: +durationSec.toFixed(1),
    rtf: +(((Date.now() - t0) / 1000) / durationSec).toFixed(2),
  };

  await db.job.update({
    where: { id: jobId },
    data: {
      status: "done", stage: 5, stageKey: "structure", progress: 100,
      message: "Simulation complete — demo corpus generated locally",
      result: JSON.parse(JSON.stringify(result)) as object,
      elapsedSec: (Date.now() - t0) / 1000,
    },
  });
}
