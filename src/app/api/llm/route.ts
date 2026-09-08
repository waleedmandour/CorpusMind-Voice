import { NextResponse } from "next/server";
import { detectLlms, startOllamaServe } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — health + served models for Ollama (11434) and LM Studio (1234). */
export async function GET() {
  const { ollama, lmstudio } = await detectLlms();
  return NextResponse.json({
    ollama: { ...ollama, port: 11434 },
    lmstudio: { ...lmstudio, port: 1234 },
  });
}

/** POST — best-effort auto-start of `ollama serve` (parent-app behaviour). */
export async function POST() {
  const ok = await startOllamaServe();
  const { ollama, lmstudio } = await detectLlms();
  return NextResponse.json({ started: ok, ollama, lmstudio });
}
