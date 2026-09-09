// CorpusMind Voice - local LLM provider detection (Ollama / LM Studio).
// Mirrors the parent CorpusMind desktop approach:
//   1. probe http://127.0.0.1:<port> (IPv4 explicit - most reliable)
//   2. probe http://localhost:<port> (fallback)
//   3. honour OLLAMA_HOST / OLLAMA_URL / LMSTUDIO_URL env overrides
//   4. on desktop, optionally auto-start `ollama serve` (find_ollama style)
import { spawn } from "child_process";
import { existsSync } from "fs";
import os from "os";
import path from "path";

export interface LlmModel {
  name: string;
  sizeBytes?: number;
}

export interface LlmProviderState {
  detected: boolean;
  url: string;
  models: LlmModel[];
}

const FETCH_TIMEOUT_MS = 1500;

async function fetchJson(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!r.ok) return null;
    return (await r.json()) as unknown;
  } catch {
    return null;
  }
}

function envUrls(envUrl: string | undefined, port: number): string[] {
  const urls: string[] = [];
  if (envUrl) {
    urls.push(envUrl.replace(/\/$/, ""));
    // bare host:port form (like OLLAMA_HOST=myhost:11434)
    if (!/^https?:\/\//.test(envUrl)) urls.push(`http://${envUrl}`);
  }
  urls.push(`http://127.0.0.1:${port}`, `http://localhost:${port}`);
  return [...new Set(urls)];
}

// ---------------------------------------------------------------- Ollama
export async function probeOllama(): Promise<LlmProviderState> {
  const urls = envUrls(process.env.OLLAMA_URL ?? process.env.OLLAMA_HOST, 11434);
  for (const url of urls) {
    const tags = (await fetchJson(`${url}/api/tags`)) as
      | { models?: { name?: string; size?: number }[] }
      | null;
    if (tags) {
      return {
        detected: true,
        url,
        models: (tags.models ?? [])
          .filter((m) => m.name)
          .map((m) => ({ name: m.name as string, sizeBytes: m.size })),
      };
    }
  }
  return { detected: false, url: urls[0], models: [] };
}

// ---------------------------------------------------------------- LM Studio
export async function probeLmStudio(): Promise<LlmProviderState> {
  const urls = envUrls(process.env.LMSTUDIO_URL, 1234);
  for (const url of urls) {
    const res = (await fetchJson(`${url}/v1/models`)) as
      | { data?: { id?: string }[] }
      | null;
    if (res) {
      return {
        detected: true,
        url,
        models: (res.data ?? [])
          .filter((m) => m.id)
          .map((m) => ({ name: m.id as string })),
      };
    }
  }
  return { detected: false, url: urls[0], models: [] };
}

export async function detectLlms(): Promise<{ ollama: LlmProviderState; lmstudio: LlmProviderState }> {
  const [ollama, lmstudio] = await Promise.all([probeOllama(), probeLmStudio()]);
  return { ollama, lmstudio };
}

// ------------------------------------------------- desktop auto-start (Ollama)
function findOllamaBinary(): string | null {
  const exe = process.platform === "win32" ? "ollama.exe" : "ollama";
  // 1. PATH-style locations
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const p = path.join(dir, exe);
    if (existsSync(p)) return p;
  }
  // 2. well-known install locations (same list as the parent CorpusMind shell)
  const home = os.homedir();
  const candidates: string[] =
    process.platform === "win32"
      ? [
          path.join(home, "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
          path.join(home, "AppData", "Local", "Ollama", "ollama.exe"),
          "C:\\Program Files\\Ollama\\ollama.exe",
          "C:\\Program Files (x86)\\Ollama\\ollama.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/usr/local/bin/ollama",
            "/opt/homebrew/bin/ollama",
            "/Applications/Ollama.app/Contents/Resources/ollama",
          ]
        : ["/usr/local/bin/ollama", "/usr/bin/ollama", "/opt/homebrew/bin/ollama", "/snap/bin/ollama"];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

let starting = false;

/** Start `ollama serve` if the daemon is not reachable yet (desktop/dev only). */
export async function startOllamaServe(): Promise<boolean> {
  const state = await probeOllama();
  if (state.detected) return true;
  if (starting) return false;
  const bin = findOllamaBinary();
  if (!bin) return false;
  starting = true;
  try {
    const log = os.tmpdir();
    const child = spawn(bin, ["serve"], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, OLLAMA_ORIGINS: "*" },
    });
    child.on("error", () => undefined);
    child.unref();
    // poll up to ~8s for the daemon to accept connections
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if ((await probeOllama()).detected) return true;
    }
    void log;
    return false;
  } finally {
    starting = false;
  }
}

// ---------------------------------------------------------------- chat calls
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One completion against whichever provider is healthy (or the requested one). */
export async function llmChat(
  messages: ChatMessage[],
  opts?: { provider?: "ollama" | "lmstudio"; model?: string }
): Promise<{ content: string; provider: string; model: string } | { error: string }> {
  const { ollama, lmstudio } = await detectLlms();
  const want = opts?.provider;
  const use =
    want === "lmstudio" ? (lmstudio.detected ? "lmstudio" : null)
    : want === "ollama" ? (ollama.detected ? "ollama" : null)
    : ollama.detected ? "ollama"
    : lmstudio.detected ? "lmstudio"
    : null;

  if (use === "ollama") {
    const model = opts?.model || ollama.models[0]?.name || "llama3.2";
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 120_000);
      const r = await fetch(`${ollama.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: false, messages }),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) return { error: `Ollama responded ${r.status}` };
      const data = (await r.json()) as { message?: { content?: string } };
      return { content: data.message?.content ?? "", provider: "ollama", model };
    } catch {
      return { error: "Ollama unreachable" };
    }
  }

  if (use === "lmstudio") {
    const model = opts?.model || lmstudio.models[0]?.name || "local-model";
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 120_000);
      const r = await fetch(`${lmstudio.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: false, messages }),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) return { error: `LM Studio responded ${r.status}` };
      const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      return { content: data.choices?.[0]?.message?.content ?? "", provider: "lmstudio", model };
    } catch {
      return { error: "LM Studio unreachable" };
    }
  }

  return { error: "no local LLM reachable (Ollama 11434 / LM Studio 1234)" };
}
