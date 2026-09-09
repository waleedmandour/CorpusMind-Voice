// CorpusMind Voice - on-demand Whisper model manager (ONNX / Transformers.js).
//
// The app's own inference engine runs Whisper through ONNX Runtime inside the
// Node server (see src/lib/asr.ts), so the manager ships the exact files that
// engine loads: config/tokenizer JSON + the q8/q4 encoder & decoder graphs.
// Models are downloaded from Hugging Face into a private, writable folder and
// REUSED offline:
//   desktop  → CM_MODELS_DIR (set by the Tauri shell to <appData>/models)
//   dev/web  → ~/.corpusmind-voice/models
// Partial downloads are resumed with HTTP Range; files land as <name>.part and
// are renamed atomically on completion, so a model never looks "ready" until it
// fully persists to disk (the v1.0.0 bug).
import { createWriteStream, renameSync } from "fs";
import { existsSync, mkdirSync, statSync, rmSync, readdirSync } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import os from "os";
import path from "path";

export interface WhisperModelSpec {
  id: string;              // tiny | base | small | medium | large-v3-turbo
  repo: string;            // Hugging Face repo
  approxBytes: number;     // total download size (all files)
  labelKey: string;        // i18n key suffix in settings
  files: string[];         // exact file list for this repo
}

export interface ModelState {
  id: string;
  downloaded: boolean;
  bytes: number;           // bytes on disk (0 when absent)
}

export interface DownloadProgress {
  id: string;
  file: string;
  received: number;
  total: number;           // total bytes for the WHOLE model (all files)
  pct: number;
  startedAt: number;
  error: string | null;
  done: boolean;
}

export const MODELS_DIR =
  process.env.CM_MODELS_DIR || path.join(os.homedir(), ".corpusmind-voice", "models");

// Shared JSON side of every Whisper ONNX repo (all exist in the repos below;
// verified against the Hugging Face file trees).
const CORE_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
  "merges.txt",
  "normalizer.json",
];

export const CATALOG: WhisperModelSpec[] = [
  {
    id: "tiny", repo: "Xenova/whisper-tiny", approxBytes: 75_000_000, labelKey: "sizeTiny",
    files: [...CORE_FILES, "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"],
  },
  {
    id: "base", repo: "Xenova/whisper-base", approxBytes: 150_000_000, labelKey: "sizeBase",
    files: [...CORE_FILES, "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"],
  },
  {
    id: "small", repo: "Xenova/whisper-small", approxBytes: 330_000_000, labelKey: "sizeSmall",
    files: [...CORE_FILES, "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"],
  },
  {
    id: "medium", repo: "Xenova/whisper-medium", approxBytes: 950_000_000, labelKey: "sizeMedium",
    files: [...CORE_FILES, "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"],
  },
  {
    id: "large-v3-turbo", repo: "onnx-community/whisper-large-v3-turbo", approxBytes: 900_000_000, labelKey: "sizeLargeV3",
    files: [...CORE_FILES, "onnx/encoder_model_q4.onnx", "onnx/decoder_model_merged_q4.onnx"],
  },
];

function modelDir(id: string): string {
  return path.join(MODELS_DIR, id);
}

export function isDownloaded(id: string): boolean {
  const spec = CATALOG.find((m) => m.id === id);
  if (!spec) return false;
  // the encoder graph is the last file fetched; everything else is smaller
  return spec.files.every((f) => existsSync(path.join(modelDir(id), f)));
}

/**
 * Remove model folders left by the retired Python/CTranslate2 engine
 * (Systran/faster-whisper-* layout: model.bin without an onnx/ folder).
 * They can never be loaded by the current engine and only waste disk.
 */
function pruneLegacyDirs(): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(MODELS_DIR);
  } catch { return; }
  for (const name of entries) {
    const dir = path.join(MODELS_DIR, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      if (CATALOG.some((m) => m.id === name)) continue; // current catalog id
      if (existsSync(path.join(dir, "model.bin")) && !existsSync(path.join(dir, "onnx"))) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch { /* best effort */ }
  }
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const f of readdirSync(dir)) {
      const st = statSync(path.join(dir, f));
      total += st.isFile() ? st.size : 0;
    }
  } catch { /* missing dir */ }
  return total;
}

export function listModels(): ModelState[] {
  pruneLegacyDirs();
  return CATALOG.map((m) => {
    const dir = modelDir(m.id);
    const downloaded = isDownloaded(m.id);
    return { id: m.id, downloaded, bytes: downloaded ? dirSize(dir) : 0 };
  });
}

export function totalBytes(): number {
  return listModels().reduce((a, m) => a + m.bytes, 0);
}

export function resolveModelDir(id: string): string | null {
  return isDownloaded(id) ? modelDir(id) : null;
}

// ---------------------------------------------------------- download engine
const g = globalThis as unknown as { __cmvDl?: DownloadProgress | null };

export function activeDownload(): DownloadProgress | null {
  return g.__cmvDl ?? null;
}

function setProgress(p: Partial<DownloadProgress> & { id: string }) {
  const cur = g.__cmvDl;
  if (cur) Object.assign(cur, p);
}

export function removeModel(id: string): boolean {
  const dir = modelDir(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Stream one HF file to disk with Range resume. Returns bytes written. */
async function fetchFile(repo: string, id: string, file: string, alreadyDone: number, totalAll: number): Promise<number> {
  const dir = modelDir(id);
  const finalPath = path.join(dir, file);
  const partPath = finalPath + ".part";
  const resumeFrom = existsSync(partPath) ? statSync(partPath).size : 0;

  const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
  const headers: Record<string, string> = {};
  if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;
  if (process.env.HF_TOKEN) headers.Authorization = `Bearer ${process.env.HF_TOKEN}`;

  const r = await fetch(url, { headers, redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} for ${repo}/${file}`);
  const statusRange = r.status === 206;

  const base = statusRange ? resumeFrom : 0;
  if (!statusRange && resumeFrom > 0) {
    // server ignored Range → start over
    rmSync(partPath, { force: true });
  }
  mkdirSync(path.dirname(finalPath), { recursive: true }); // onnx/ subfolder
  const nodeStream = Readable.fromWeb(r.body as never);
  const ws = createWriteStream(partPath, { flags: statusRange ? "a" : "w" });
  let received = base;

  nodeStream.on("data", (chunk: Buffer) => {
    received += chunk.length;
    setProgress({
      id,
      file,
      received: alreadyDone + received,
      total: totalAll,
      pct: Math.min(99, Math.round(((alreadyDone + received) / Math.max(totalAll, 1)) * 100)),
      error: null,
      done: false,
    });
  });

  await pipeline(nodeStream, ws);
  // atomic promote: only a complete file becomes model.bin etc.
  const st = statSync(partPath);
  if (st.size <= 0) throw new Error("empty body");
  if (existsSync(finalPath)) rmSync(finalPath, { force: true });
  renameSync(partPath, finalPath);
  return st.size;
}

/** Download a full model (all files, sequential, resumable). */
export async function downloadModel(id: string): Promise<void> {
  const spec = CATALOG.find((m) => m.id === id);
  if (!spec) throw new Error(`unknown model ${id}`);
  if (activeDownload() && !activeDownload()!.done && !activeDownload()!.error)
    throw new Error("another download is running");

  mkdirSync(MODELS_DIR, { recursive: true });
  mkdirSync(modelDir(id), { recursive: true });

  const fresh: DownloadProgress = {
    id, file: "", received: 0, total: spec.approxBytes,
    pct: 0, startedAt: Date.now(), error: null, done: false,
  };
  g.__cmvDl = fresh;

  let doneBytes = 0;
  try {
    for (const file of spec.files) {
      if (existsSync(path.join(modelDir(id), file))) {
        doneBytes += statSync(path.join(modelDir(id), file)).size;
        continue; // already persisted from a previous run
      }
      setProgress({ id, file, done: false, error: null });
      const wrote = await fetchFile(spec.repo, id, file, doneBytes, spec.approxBytes);
      doneBytes += wrote;
    }
    if (!isDownloaded(id)) throw new Error("ONNX graphs missing after download");
    setProgress({ id, done: true, pct: 100, received: doneBytes, total: doneBytes });
  } catch (e) {
    setProgress({ id, error: e instanceof Error ? e.message : String(e), done: true });
    throw e;
  }
}
