// Shared types between client and server

export const STAGE_KEYS = [
  "ingest",
  "asr",
  "align",
  "prosody",
  "disfluency",
  "structure",
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export interface JobView {
  id: string;
  status: "queued" | "running" | "done" | "error";
  stage: number;
  stageKey: StageKey;
  progress: number;
  message: string | null;
  engine: "python" | "simulation";
  device: string;
  error: string | null;
  elapsedSec: number;
  audioId: string | null;
  audio?: { fileName: string; language: string; durationSec?: number } | null;
  fileName?: string;
  result: JobResult | null;
}

export interface JobResult {
  utterances: number;
  tokens: number;
  disfluencies: number;
  durationSec: number;
  rtf: number; // real-time factor
}

export interface TokenView {
  id: string;
  index: number;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  edited: boolean;
  realigned: boolean;
}

export interface UtteranceView {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker: string;
  tokens: TokenView[];
  disfluencies: DisfluencySet | null;
  prosody: ProsodySet | null;
}

export interface DisfluencySet {
  pauses: number[];
  fillers: string[];
  repeats: string[];
  falseStarts: string[];
  interruptions: string[];
  lengthenings: string[];
}

export interface ProsodySet {
  f0MeanHz: number;
  f0MinHz: number;
  f0MaxHz: number;
  intensityMeanDb: number;
  jitterPct: number;
  shimmerPct: number;
  hnrDb: number;
}

export interface HardwareInfo {
  platform: string;
  osVersion: string;
  cpuModel: string;
  cores: number;
  ramGb: number;
  gpuName: string | null;
  gpuVramGb: number | null;
  cuda: boolean;
  recommendation: "cuda-int8" | "cpu-int8";
  pythonWorker: boolean;
  modelsDir: string | null;
  modelsReady: boolean;
  corpusmind: { detected: boolean; path: string | null };
  ollama: { detected: boolean; url: string };
  // v1.1 — model manager + LM Studio
  models?: {
    dir: string;
    items: { id: string; downloaded: boolean; bytes: number; labelKey?: string }[];
    totalBytes: number;
    download: {
      id: string; file: string; received: number; total: number; pct: number;
      startedAt: number; error: string | null; done: boolean;
    } | null;
  };
  largeV3Path?: string | null;
  lmstudio?: { detected: boolean; url: string };
}

export interface LlmState {
  ollama: { detected: boolean; url: string; port: number; models: { name: string; sizeBytes?: number }[] };
  lmstudio: { detected: boolean; url: string; port: number; models: { name: string }[] };
}

// ---------- Linguistic Analysis report ----------
export interface AnalysisToken {
  text: string;   // normalized
  raw: string;    // original surface form
  utt: number;    // utterance index
  ms: number;     // token start (for audio playback / KWIC positioning)
  startMs: number;
  endMs: number;
  conf: number;
}

export interface AnalysisReport {
  meta: { fileName: string; language: string; durationSec: number };
  tokens: AnalysisToken[];
  overview: {
    tokens: number; types: number; utterances: number; wpm: number;
    meanSentenceLen: number; meanWordLen: number; hapaxCount: number; hapaxPct: number;
  };
  frequency: {
    items: { word: string; count: number; perK: number; dp: number; stop: boolean }[];
  };
  keywords: {
    source: "siblings" | "builtin";
    items: { word: string; count: number; refPerK: number; g2: number; logRatio: number; diffPct: number | null }[];
  } | null;
  ngrams: {
    bigrams: { gram: string; count: number }[];
    trigrams: { gram: string; count: number }[];
    fourgrams: { gram: string; count: number }[];
  };
  collocations: { gram: string; count: number; mi: number; tscore: number; logdice: number }[];
  lexical: {
    ttr: number; mattr: number; mtld: number; lexicalDensity: number;
    contentWords: number; functionWords: number;
  };
  readability: {
    flesch: number | null; fkGrade: number | null;
    lix: number; longWordPct: number; meanSentenceLen: number;
  };
  disfluency: {
    total: number; perK: number;
    byType: {
      fillers: number; fillersPerK: number;
      repeats: number; repeatsPerK: number;
      falseStarts: number; falseStartsPerK: number;
      interruptions: number; interruptionsPerK: number;
      lengthenings: number; lengtheningsPerK: number;
    };
    pauses: number; pausesPerK: number; pauseMeanMs: number;
  };
  prosody: {
    utterancesMeasured: number;
    f0MeanHz: number; f0MinHz: number | null; f0MaxHz: number | null;
    intensityDb: number; jitterPct: number; shimmerPct: number; hnrDb: number;
  } | null;
  confidence: { high: number; mid: number; low: number; mean: number };
}

export const WHISPER_SIZES = ["tiny", "base", "small", "medium", "large-v3"] as const;
export type WhisperSize = (typeof WHISPER_SIZES)[number];

export type ConfBand = "high" | "mid" | "low";

export function confBand(c: number): ConfBand {
  if (c >= 0.85) return "high";
  if (c >= 0.6) return "mid";
  return "low";
}

export const FILLERS: Record<string, string[]> = {
  en: ["um", "uh", "erm", "like", "you know"],
  ar: ["يعني", "آه", "إيه", "أه", "طب"],
};
