import { NextRequest, NextResponse } from "next/server";
import { detectLlms, readLlmHostOverride, startOllamaServe, writeLlmHostOverride } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET - health + served models for Ollama (11434) and LM Studio (1234). */
export async function GET() {
  const { ollama, lmstudio } = await detectLlms();
  return NextResponse.json({
    ollama: { ...ollama, port: 11434 },
    lmstudio: { ...lmstudio, port: 1234 },
    ollamaHost: readLlmHostOverride(),
  });
}

/** POST - best-effort auto-start of `ollama serve` (parent-app behaviour). */
export async function POST() {
  const ok = await startOllamaServe();
  const { ollama, lmstudio } = await detectLlms();
  return NextResponse.json({ started: ok, ollama, lmstudio });
}

/**
 * PUT - save the Ollama host override (Settings > AI models). Accepts
 * "host:port", "http://host:port" or an empty string to clear. The next
 * probe/chat picks it up; falls back to 127.0.0.1 when unreachable.
 */
export async function PUT(req: NextRequest) {
  let body: { ollamaHost?: string } = {};
  try {
    body = (await req.json()) as { ollamaHost?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const host = (body.ollamaHost ?? "").trim();
  if (host && !/^https?:\/\/[\w.\-]+(:\d+)?$/i.test(host) && !/^[\w.\-]+(:\d+)?$/.test(host)) {
    return NextResponse.json(
      { error: "Expected a host, host:port or http://host:port" },
      { status: 400 }
    );
  }
  writeLlmHostOverride(host);
  const { ollama, lmstudio } = await detectLlms();
  return NextResponse.json({ ollamaHost: host, ollama, lmstudio });
}
