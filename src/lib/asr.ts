// CorpusMind Voice - local Whisper inference engine (pure Node, fully offline).
//
// Runs the Whisper ONNX models through Transformers.js on ONNX Runtime (CPU)
// inside the app's own Node server. Models are fetched once by the model
// manager (Settings & Diagnostics) into the app's private model folder and are
// then REUSED offline: env.allowRemoteModels is disabled so inference can
// never phone home.
//
// Word-level timestamps come from Whisper's cross-attention DTW alignment
// (the same mechanism OpenAI's word_timestamps uses), so stage 2 of the
// pipeline (alignment) is real for every transcription.
//
// Long recordings are processed in 30 s windows with a 5 s stride; words are
// merged at the overlap midpoints, which also yields true per-window progress.

import { pipeline, env } from "@huggingface/transformers";
import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { MODELS_DIR } from "./models";

// Inference is strictly local: models come from the app's model folder only.
env.allowLocalModels = true;
env.localModelPath = MODELS_DIR;
env.allowRemoteModels = false;

export interface AsrWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscribeOptions {
  model: string;                       // catalog id, e.g. "tiny" | "large-v3-turbo"
  language: string;                    // app language id: en | arz | arb
  onProgress?: (pct: number, message: string) => void;
}

const WINDOW_S = 30;   // Whisper native window
const STRIDE_S = 5;    // overlap between windows (context on both sides)

// cached pipelines per model id (survives HMR; re-runs reuse the loaded model)
const g = globalThis as unknown as { __cmvAsr?: Map<string, AutomaticSpeechRecognitionPipeline> };

async function getPipeline(model: string): Promise<AutomaticSpeechRecognitionPipeline> {
  g.__cmvAsr ??= new Map();
  const hit = g.__cmvAsr.get(model);
  if (hit) return hit;
  const dtype = model === "large-v3-turbo" ? "q4" : "q8";
  const pipe = await pipeline("automatic-speech-recognition", model, {
    dtype,
    device: "cpu",
  });
  g.__cmvAsr.set(model, pipe);
  return pipe;
}

/** Map the app's language ids onto Whisper language codes. */
function whisperLang(appLang: string): string | null {
  if (appLang === "en") return "en";
  if (appLang === "arz" || appLang === "arb") return "ar";
  return null; // let Whisper auto-detect
}

/**
 * Transcribe 16 kHz mono PCM to words with real Whisper timestamps.
 * Progress callback reports 0..100 across the whole recording.
 */
export async function transcribePcm(
  pcm: Int16Array,
  sampleRate: number,
  opts: TranscribeOptions
): Promise<AsrWord[]> {
  const pipe = await getPipeline(opts.model);
  const lang = whisperLang(opts.language);

  const sr = sampleRate;
  const total = pcm.length;
  const win = WINDOW_S * sr;
  const stride = STRIDE_S * sr;
  const jump = win - stride;

  // windows: [a, b) with stride overlap; last window may be short
  const spans: { a: number; b: number; first: boolean; last: boolean }[] = [];
  for (let a = 0; a < total; ) {
    const b = Math.min(total, a + win);
    spans.push({ a, b, first: a === 0, last: b >= total });
    if (b >= total) break;
    a += jump;
  }
  if (spans.length === 0) return [];

  const words: AsrWord[] = [];
  for (let i = 0; i < spans.length; i++) {
    const { a, b, first, last } = spans[i];
    const slice = new Float32Array(b - a);
    for (let j = 0; j < b - a; j++) slice[j] = pcm[a + j] / 32768;

    const out = await pipe(slice, {
      return_timestamps: "word",
      ...(lang ? { language: lang } : {}),
      task: "transcribe",
      chunk_length_s: 0,
      stride_length_s: 0,
    });

    // words whose midpoint falls before the overlap midpoint belong to this
    // window; later ones are re-covered (and re-timestamped) by the next one
    const boundary = a + (last ? b : Math.floor(win - stride / 2));

    type Chunk = { text: string; timestamp: [number, number | null] };
    for (const c of (out.chunks ?? []) as Chunk[]) {
      const s = c.timestamp?.[0];
      const e = c.timestamp?.[1];
      if (s == null || e == null || e <= s) continue;
      const startMs = Math.round((a + s) * 1000);
      const endMs = Math.round((a + e) * 1000);
      const mid = (startMs + endMs) / 2;
      if (mid <= a) continue;
      if (!last && mid > boundary) continue;
      const text = c.text.trim();
      if (!text) continue;
      words.push({ text, startMs, endMs });
    }

    const pct = Math.round(((i + 1) / spans.length) * 100);
    opts.onProgress?.(
      Math.min(99, pct),
      `Whisper ${opts.model}: ${pct}% (${Math.round(((i + 1) * WINDOW_S))}s / ${Math.ceil(total / sr)}s)`
    );
  }

  // enforce monotonic timestamps (overlaps can reorder boundary words)
  words.sort((x, y) => x.startMs - y.startMs || x.endMs - y.endMs);
  let lastEnd = 0;
  for (const w of words) {
    if (w.startMs < lastEnd) w.startMs = lastEnd;
    if (w.endMs < w.startMs) w.endMs = w.startMs + 20;
    lastEnd = w.endMs;
  }
  return words;
}
