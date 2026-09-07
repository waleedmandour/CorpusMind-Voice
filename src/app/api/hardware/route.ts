import { NextResponse } from "next/server";
import os from "os";
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import type { HardwareInfo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function probe(cmd: string, args: string[], timeoutMs = 2500): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args);
      let out = "";
      p.stdout?.on("data", (d) => (out += d.toString()));
      p.stderr?.on("data", () => {});
      p.on("error", () => resolve(null));
      p.on("close", (code) => resolve(code === 0 ? out.trim() : null));
      setTimeout(() => {
        p.kill("SIGKILL");
        resolve(out.trim() || null);
      }, timeoutMs);
    } catch {
      resolve(null);
    }
  });
}

async function gpuInfo(): Promise<{ name: string | null; vram: number | null }> {
  const out = await probe(
    "nvidia-smi",
    ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
    3000
  );
  if (!out) return { name: null, vram: null };
  const [name, mib] = out.split(",").map((s) => s.trim());
  return { name: name || null, vram: mib ? Math.round(+mib / 1024) : null };
}

async function ollamaInfo(url: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 900);
    const r = await fetch(`${url}/api/tags`, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

function corpusmindDetect(): { detected: boolean; path: string | null } {
  const home = os.homedir();
  const candidates = [
    path.join(home, "CorpusMind"),
    path.join(home, ".local", "share", "CorpusMind"),
    "/opt/corpusmind",
    "/Applications/CorpusMind.app",
    path.join(home, "AppData", "Local", "CorpusMind"),
  ];
  for (const c of candidates) if (existsSync(c)) return { detected: true, path: c };
  return { detected: false, path: null };
}

export async function GET() {
  const cpus = os.cpus();
  const [{ name, vram }, ollamaUp] = await Promise.all([
    gpuInfo(),
    ollamaInfo(process.env.OLLAMA_URL ?? "http://127.0.0.1:11434"),
  ]);

  const pythonWorker = existsSync(path.join(process.cwd(), "python", "processor.py"));
  const modelCache = path.join(os.homedir(), ".cache", "huggingface");
  const modelsReady = existsSync(modelCache);

  const info: HardwareInfo = {
    platform: os.platform(),
    osVersion: os.release(),
    cpuModel: cpus[0]?.model?.trim() ?? "Unknown CPU",
    cores: cpus.length,
    ramGb: +(os.totalmem() / 1024 ** 3).toFixed(1),
    gpuName: name,
    gpuVramGb: vram,
    cuda: !!name,
    recommendation: name ? "cuda-int8" : "cpu-int8",
    pythonWorker,
    modelsDir: modelsReady ? modelCache : null,
    modelsReady,
    corpusmind: corpusmindDetect(),
    ollama: {
      detected: ollamaUp,
      url: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
    },
  };

  return NextResponse.json(info);
}
