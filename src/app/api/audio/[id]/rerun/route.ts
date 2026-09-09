import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODELS = new Set(["tiny", "base", "small", "medium", "large-v3-turbo"]);

// Re-run the transcription + analysis pipeline for an existing recording,
// e.g. after the user picks a different Whisper model, device or language.
// Wipes the previous utterances/tokens, then enqueues a fresh job.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const audio = await db.audioMetadata.findUnique({ where: { id } });
    if (!audio) return NextResponse.json({ error: "Audio not found" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as {
      model?: string; device?: string; language?: string;
    };
    const model = body.model && MODELS.has(body.model) ? body.model : audio.model;
    const device = body.device === "cuda" || body.device === "cpu" || body.device === "auto"
      ? body.device
      : audio.device;
    const language = ["en", "arz", "arb"].includes(body.language ?? "")
      ? (body.language as string)
      : audio.language;

    // one active pipeline per recording
    const active = await db.job.findFirst({
      where: { audioId: id, status: { in: ["queued", "running"] } },
    });
    if (active) {
      return NextResponse.json(
        { error: "This recording is already queued or running" },
        { status: 409 }
      );
    }

    // clear previous results; keep job history for the log
    await db.token.deleteMany({ where: { utterance: { audioId: id } } });
    await db.utterance.deleteMany({ where: { audioId: id } });

    await db.audioMetadata.update({ where: { id }, data: { model, device, language } });

    const job = await db.job.create({
      data: { audioId: id, device, status: "queued" },
    });

    enqueue(job.id, id);
    return NextResponse.json({ audioId: id, jobId: job.id, model, device, language });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Re-run failed" },
      { status: 500 }
    );
  }
}
