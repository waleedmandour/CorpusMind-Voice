import { NextRequest, NextResponse } from "next/server";
import { llmChat, type ChatMessage } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Local LLM proxy — fully offline. Never calls cloud APIs.
// POST { messages: [{role, content}], provider?: "ollama"|"lmstudio", model? }
// Routes to Ollama (/api/chat) or LM Studio (/v1/chat/completions) automatically.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      messages?: { role: string; content: string }[];
      provider?: "ollama" | "lmstudio";
      model?: string;
    };
    const messages = (body.messages ?? []).filter(
      (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
    );
    if (messages.length === 0)
      return NextResponse.json({ error: "messages required" }, { status: 400 });

    const chat: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are the CorpusMind Voice research assistant. You help linguists with transcription, forced alignment, prosody, disfluency annotation and corpus analysis of their local corpora. Be concise, academically precise and practical.",
      },
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];

    const res = await llmChat(chat, { provider: body.provider, model: body.model });
    if ("error" in res)
      return NextResponse.json({ offline: true, error: res.error }, { status: 503 });

    return NextResponse.json({
      content: res.content,
      provider: res.provider,
      model: res.model,
      offline: false,
    });
  } catch {
    return NextResponse.json({ offline: true, error: "LLM call failed" }, { status: 503 });
  }
}
