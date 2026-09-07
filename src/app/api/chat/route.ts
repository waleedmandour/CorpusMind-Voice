import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local Ollama proxy — fully offline. Never calls cloud APIs.
// POST { messages: [{ role, content }] } → Ollama /api/chat (non-streaming).
export async function POST(req: NextRequest) {
  const url = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
  try {
    const body = (await req.json()) as {
      messages?: { role: string; content: string }[];
      model?: string;
    };
    const messages = body.messages ?? [];
    if (messages.length === 0)
      return NextResponse.json({ error: "messages required" }, { status: 400 });

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60_000);
    const r = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: body.model ?? "llama3.1",
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are the CorpusMind Voice research assistant. You help linguists with transcription, forced alignment, prosody and disfluency annotation of their local corpora. Be concise and practical.",
          },
          ...messages,
        ],
      }),
      signal: ctl.signal,
    });
    clearTimeout(timer);

    if (!r.ok)
      return NextResponse.json(
        { offline: true, error: `Ollama responded ${r.status}` },
        { status: 502 }
      );
    const data = (await r.json()) as { message?: { content?: string } };
    return NextResponse.json({
      content: data.message?.content ?? "",
      offline: false,
    });
  } catch {
    return NextResponse.json({ offline: true, error: "Ollama unreachable" }, { status: 503 });
  }
}
