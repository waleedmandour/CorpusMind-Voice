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
}

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
