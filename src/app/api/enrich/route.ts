import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { llmChat } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-transcript AI tools, all served by the local LLM (Ollama / LM Studio):
//   task = "summary" → academic bullet summary
//   task = "clean"   → transcript preview without fillers/false starts
//   task = "tags"    → suggested topic/genre tags
const PROMPTS: Record<string, (text: string) => string> = {
  summary: (text) =>
    `Summarise the following research transcript in 4-6 concise bullet points. Note the main topics, any speaker shifts, and salient disfluency patterns (fillers, repeats, pauses) if relevant. Reply in the same language as the transcript.\n\nTRANSCRIPT:\n${text}`,
  clean: (text) =>
    `Rewrite the transcript below removing fillers (um, uh, erm, يعني, آه, إيه…), repeated words and false starts. Keep the original wording otherwise identical and keep sentence order. Output ONLY the cleaned transcript, no commentary. Reply in the same language as the transcript.\n\nTRANSCRIPT:\n${text}`,
  tags: (text) =>
    `Suggest 6-8 short academic topic/genre tags (both broad register labels and specific topics) for the transcript below. Output a single comma-separated line, in the same language as the transcript.\n\nTRANSCRIPT:\n${text}`,
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      audioId?: string;
      task?: keyof typeof PROMPTS;
      provider?: "ollama" | "lmstudio";
      model?: string;
    };
    const audioId = body.audioId ?? "";
    const task = body.task && PROMPTS[body.task] ? body.task : "summary";
    if (!audioId) return NextResponse.json({ error: "audioId required" }, { status: 400 });

    const audio = await db.audioMetadata.findUnique({
      where: { id: audioId },
      include: { utterances: { orderBy: { index: "asc" }, include: { tokens: { orderBy: { index: "asc" } } } } },
    });
    if (!audio) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Cap the prompt so small local models stay responsive
    const text = audio.utterances.map((u) => u.text).join("\n").slice(0, 12_000);
    if (!text.trim())
      return NextResponse.json({ error: "transcript is empty" }, { status: 400 });

    const res = await llmChat(
      [
        {
          role: "system",
          content:
            "You are a corpus-linguistics research assistant running fully offline inside CorpusMind Voice. Follow the user's task exactly.",
        },
        { role: "user", content: PROMPTS[task](text) },
      ],
      { provider: body.provider, model: body.model }
    );
    if ("error" in res) return NextResponse.json({ offline: true, error: res.error }, { status: 503 });
    return NextResponse.json({ content: res.content, task, provider: res.provider, model: res.model, offline: false });
  } catch {
    return NextResponse.json({ offline: true, error: "enrich failed" }, { status: 503 });
  }
}
