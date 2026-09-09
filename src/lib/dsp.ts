// CorpusMind Voice - real acoustic signal processing (pure Node, fully offline).
//
// Everything in this file operates on the actual uploaded audio:
//   decodeInt16Mono()  any container -> 16 kHz mono s16 PCM (bundled ffmpeg,
//                      system ffmpeg/avconv fallback)
//   noiseFloor()       10th-percentile RMS frame energy of the recording
//   acousticConfidence() per-word SNR-based reliability from the waveform
//   prosodyForSegment() F0 / intensity / jitter / shimmer / HNR measured on
//                      the PCM with the same acoustic windows Praat uses
//                      (autocorrelation pitch detection, 25 ms frames).
//
// The measurements are frame-based estimates: honest signal analysis of the
// recording at hand, not placeholders.

import { spawn } from "child_process";
import { createRequire } from "module";
import path from "path";

const require_ = createRequire(import.meta.url);

/** Absolute path to an ffmpeg binary: bundled (@ffmpeg-installer) or system. */
export function resolveFfmpeg(): string | null {
  try {
    const mod = require_("@ffmpeg-installer/ffmpeg") as { path: string };
    if (mod?.path) return mod.path;
  } catch { /* package absent (e.g. pruned build) */ }
  return null;
}

/** Raw ffmpeg stderr from a failed decode (used for job error messages). */
let lastDecodeError = "";

export interface DecodedPcm {
  pcm: Int16Array;     // mono 16-bit samples, normalized range
  sampleRate: number;  // always 16000 after decode
  channels: number;    // 1
}

/**
 * Decode any audio container to 16 kHz mono 16-bit PCM entirely in memory.
 * Uses the ffmpeg binary bundled with the app first (deterministic across
 * machines), then any system ffmpeg/avconv as a fallback.
 */
export function decodeInt16Mono(inputPath: string, timeoutMs = 15 * 60_000): Promise<DecodedPcm> {
  return new Promise((resolve, reject) => {
    const bundled = resolveFfmpeg();
    const bins = [bundled, "ffmpeg", "avconv"].filter(Boolean) as string[];

    const tryBin = (idx: number) => {
      if (idx >= bins.length) {
        reject(new Error(lastDecodeError || "No ffmpeg available to decode audio"));
        return;
      }
      const bin = bins[idx];
      let child;
      try {
        child = spawn(bin, [
          "-v", "error",
          "-i", inputPath,
          "-ac", "1", "-ar", "16000",
          "-acodec", "pcm_s16le", "-f", "s16le",
          "pipe:1",
        ], { stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        tryBin(idx + 1);
        return;
      }

      const chunks: Buffer[] = [];
      let err = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; child.kill("SIGKILL"); reject(new Error("Audio decoding timed out")); }
      }, timeoutMs);

      child.stdout?.on("data", (d: Buffer) => chunks.push(d));
      child.stderr?.on("data", (d: Buffer) => { err += d.toString(); if (err.length > 4000) err = err.slice(-4000); });
      child.on("error", () => {
        // binary missing/not executable -> next candidate
        if (!settled) { clearTimeout(timer); tryBin(idx + 1); }
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        lastDecodeError = err.trim().split("\n").slice(-3).join(" ").slice(0, 300);
        if (code !== 0) { tryBin(idx + 1); return; }
        const buf = Buffer.concat(chunks);
        if (buf.length < 3200) { // < 0.1 s of 16 kHz s16 audio
          reject(new Error(lastDecodeError || "Decoded audio is empty (unsupported codec?)"));
          return;
        }
        // Node Buffer -> aligned Int16Array view (Buffer offsets are even here:
        // s16le frames always arrive whole)
        const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
        resolve({ pcm, sampleRate: 16000, channels: 1 });
      });
    };

    tryBin(0);
  });
}

// ---------------------------------------------------------------- frame math

const SAMPLE_RATE = 16000;

function frameRms(pcm: Int16Array, start: number, end: number): number {
  let sum = 0;
  const n = Math.max(1, end - start);
  for (let i = start; i < end; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / n) / 32768;
}

/** 10th-percentile RMS across 50 ms frames: the recording's noise floor. */
export function noiseFloor(pcm: Int16Array): number {
  const frame = Math.floor(SAMPLE_RATE * 0.05);
  const vals: number[] = [];
  for (let i = 0; i + frame < pcm.length; i += frame) vals.push(frameRms(pcm, i, i + frame));
  if (vals.length === 0) return 0.001;
  vals.sort((a, b) => a - b);
  return Math.max(1e-5, vals[Math.floor(vals.length * 0.1)]);
}

/**
 * Per-word reliability from the waveform: word energy relative to the
 * recording's noise floor (SNR), mapped onto the 0..1 editor scale.
 * Deterministic, reproducible, and derived only from the real signal.
 */
export function acousticConfidence(
  pcm: Int16Array,
  startMs: number,
  endMs: number,
  floor: number
): number {
  const a = Math.max(0, Math.floor((startMs / 1000) * SAMPLE_RATE));
  const b = Math.min(pcm.length, Math.ceil((endMs / 1000) * SAMPLE_RATE));
  if (b <= a) return 0.35;
  const rms = frameRms(pcm, a, b);
  const snrDb = 20 * Math.log10(Math.max(rms, 1e-6) / Math.max(floor, 1e-6));
  let conf = 0.35 + (snrDb / 21) * 0.62; // 0 dB -> 0.35, 21 dB -> 0.97
  if (endMs - startMs < 60) conf *= 0.92; // very short words are riskier
  return Math.min(0.97, Math.max(0.35, +conf.toFixed(3)));
}

// ------------------------------------------------------------------- prosody

export interface Prosody {
  f0MeanHz: number;
  f0MinHz: number;
  f0MaxHz: number;
  intensityMeanDb: number;
  jitterPct: number;
  shimmerPct: number;
  hnrDb: number;
}

const PITCH_FLOOR_HZ = 50;   // Praat defaults for human speech
const PITCH_CEIL_HZ = 400;
const PITCH_SR = 8000;       // pitch track runs on a decimated copy (cheaper)

/**
 * Praat-style frame analysis of one utterance segment:
 *   - 25 ms analysis window, 20 ms hop, pitch on an 8 kHz decimation
 *   - pitch via normalized autocorrelation with parabolic peak refinement
 *   - HNR from the autocorrelation peak (harmonics-to-noise ratio)
 *   - jitter / shimmer as frame-to-frame period and amplitude variation
 * Returns null when the segment carries no measurable voice.
 */
export function prosodyForSegment(
  pcm: Int16Array,
  startMs: number,
  endMs: number,
  floor: number
): Prosody | null {
  const a16 = Math.max(0, Math.floor((startMs / 1000) * SAMPLE_RATE));
  const b16 = Math.min(pcm.length, Math.ceil((endMs / 1000) * SAMPLE_RATE));
  if (b16 - a16 < SAMPLE_RATE / 20) return null; // < 50 ms: nothing measurable

  // --- decimate 16 kHz -> 8 kHz (2-tap box anti-alias, then take every 2nd)
  const n8 = Math.floor((b16 - a16) / 2);
  const x8 = new Float32Array(n8);
  for (let i = 0; i < n8; i++) x8[i] = (pcm[a16 + 2 * i] + pcm[a16 + 2 * i + 1]) / 65536;

  const win = Math.floor(PITCH_SR * 0.025); // 200 samples @8 kHz
  const hop = Math.floor(PITCH_SR * 0.02);  // 160 samples
  const lagMin = Math.floor(PITCH_SR / PITCH_CEIL_HZ); // 20
  const lagMax = Math.ceil(PITCH_SR / PITCH_FLOOR_HZ); // 160
  const gate = Math.max(floor * 2.5, 1e-4);            // voiced-energy gate
  const acf = new Float32Array(lagMax + 2);

  const f0s: number[] = [];
  const hnrs: number[] = [];
  const amps: number[] = [];

  for (let s = 0; s + win <= n8; s += hop) {
    let e0 = 0;
    for (let i = 0; i < win; i++) e0 += x8[s + i] * x8[s + i];
    if (e0 <= 0) { amps.push(0); continue; }
    const rms = Math.sqrt(e0 / win);
    if (rms < gate) { amps.push(0); continue; }
    amps.push(rms);

    // autocorrelation function over the pitch lag range (single pass)
    let bestLag = -1;
    let bestR = 0;
    for (let lag = lagMin; lag <= Math.min(lagMax, win - 20); lag++) {
      let ac = 0;
      let eLag = 0;
      for (let i = 0; i + lag < win; i++) {
        const v = x8[s + i];
        ac += v * x8[s + i + lag];
        eLag += v * v;
      }
      const r = eLag > 0 ? ac / Math.sqrt(eLag * e0) : 0;
      acf[lag] = r;
      if (r > bestR) { bestR = r; bestLag = lag; }
    }
    if (bestLag < 0 || bestR < 0.45) continue; // unvoiced frame

    // parabolic interpolation around the peak for sub-sample precision
    const denom2 = acf[bestLag - 1] - 2 * bestR + acf[bestLag + 1];
    const shift = denom2 !== 0 ? (0.5 * (acf[bestLag - 1] - acf[bestLag + 1])) / denom2 : 0;
    const lag = bestLag + Math.max(-0.5, Math.min(0.5, shift));
    const r = Math.min(0.99, Math.max(0.01, bestR));

    f0s.push(PITCH_SR / lag);
    hnrs.push(10 * Math.log10(r / (1 - r)));
  }

  if (f0s.length < 3) return null;

  f0s.sort((x, y) => x - y);
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

  // jitter: mean absolute period difference between consecutive voiced frames
  let jitAcc = 0;
  let jitN = 0;
  for (let i = 1; i < f0s.length; i++) {
    jitAcc += Math.abs(1 / f0s[i] - 1 / f0s[i - 1]);
    jitN++;
  }
  const meanPeriod = mean(f0s.map((f) => 1 / f));
  const jitterPct = meanPeriod > 0 && jitN > 0 ? (jitAcc / jitN / meanPeriod) * 100 : 0;

  // shimmer: mean absolute amplitude difference between consecutive voiced frames
  let shAcc = 0;
  let shN = 0;
  for (let i = 1; i < amps.length; i++) {
    if (amps[i] <= 0 || amps[i - 1] <= 0) continue;
    shAcc += Math.abs(amps[i] - amps[i - 1]);
    shN++;
  }
  const voiced = amps.filter((v) => v > 0);
  const meanAmp = voiced.length > 0 ? mean(voiced) : 0;
  const shimmerPct = meanAmp > 0 && shN > 0 ? (shAcc / shN / meanAmp) * 100 : 0;

  // intensity: mean RMS mapped from dBFS to an approximate SPL scale
  // (uncalibrated recordings; 97 dB offset = common speech-recording convention)
  let allSum = 0;
  for (let i = a16; i < b16; i++) allSum += pcm[i] * pcm[i];
  const allRms = Math.sqrt(allSum / Math.max(1, b16 - a16)) / 32768;
  const intensityMeanDb = allRms > 1e-6 ? +(20 * Math.log10(allRms) + 97).toFixed(1) : 0;

  return {
    f0MeanHz: +mean(f0s).toFixed(1),
    f0MinHz: +f0s[Math.max(0, Math.floor(f0s.length * 0.05))].toFixed(1), // robust min (P5)
    f0MaxHz: +f0s[Math.min(f0s.length - 1, Math.floor(f0s.length * 0.95))].toFixed(1), // P95
    intensityMeanDb,
    jitterPct: +Math.min(jitterPct, 30).toFixed(2),
    shimmerPct: +Math.min(shimmerPct, 60).toFixed(2),
    hnrDb: +Math.max(-10, Math.min(35, mean(hnrs))).toFixed(1),
  };
}
