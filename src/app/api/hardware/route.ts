import { NextResponse } from "next/server";
import os from "os";
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { detectLlms } from "@/lib/llm";
import { MODELS_DIR, activeDownload, listModels, resolveModelDir, totalBytes } from "@/lib/models";
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
  const [{ name, vram }, llms] = await Promise.all([gpuInfo(), detectLlms()]);

  const pythonWorker = existsSync(path.join(process.cwd(), "python", "processor.py"));
  const models = listModels();
  const anyModel = models.some((m) => m.downloaded);
  const defaultDir = resolveModelDir("large-v3");

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
    // legacy fields kept for compatibility
    modelsDir: anyModel ? MODELS_DIR : null,
    modelsReady: anyModel,
    corpusmind: corpusmindDetect(),
    ollama: { detected: llms.ollama.detected, url: llms.ollama.url },
    // v1.1 model manager + LLM providers
    models: { dir: MODELS_DIR, items: models, totalBytes: totalBytes(), download: activeDownload() },
    largeV3Path: defaultDir,
    lmstudio: { detected: llms.lmstudio.detected, url: llms.lmstudio.url },
  };

  return NextResponse.json(info);
}
