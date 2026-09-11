// Single source of truth for the app's writable data tree.
//
// Root cause of the v1.2.x upload/recording failures: audio, worker output
// and config were written under process.cwd(), which inside the packaged
// desktop app is the INSTALL directory (resources/standalone). Under an
// MSI per-machine install (Program Files) that directory is read-only, so
// every upload and recording failed with EPERM before the pipeline even
// started. The Tauri shell now points the sidecar at CM_DATA_DIR (the OS
// per-user app data folder, already home to custom.db and the model
// downloads); bare `next dev` / `npm start` keep the historical <cwd>/data
// location so the web build and e2e scripts behave exactly as before.
import { existsSync, mkdirSync } from "fs";
import path from "path";

export const DATA_ROOT: string = process.env.CM_DATA_DIR
  ? path.resolve(process.env.CM_DATA_DIR)
  : path.join(process.cwd(), "data");

export const AUDIO_DIR = path.join(DATA_ROOT, "audio");
export const OUTPUT_DIR = path.join(DATA_ROOT, "output");
export const CONFIG_DIR = path.join(DATA_ROOT, "config");
export const COMPANION_DIR = path.join(DATA_ROOT, "companion");
// The Tauri shell reads this file at boot to decide whether the phone
// companion proxy should be spawned (paths.ts and main.rs agree on it).
export const COMPANION_JSON = path.join(DATA_ROOT, "companion.json");
export const COMPANION_CERT = path.join(COMPANION_DIR, "cert.pem");
export const COMPANION_KEY = path.join(COMPANION_DIR, "key.pem");

/** mkdir -p that never throws (callers handle their own failures). */
export function ensureDirSync(dir: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** Best-effort mkdir for the audio store; returns false when unwritable. */
export function ensureAudioDir(): boolean {
  return ensureDirSync(AUDIO_DIR);
}
