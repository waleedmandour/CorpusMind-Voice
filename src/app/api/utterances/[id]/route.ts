import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Utterance-level annotation corrections. The ASR pipeline labels every
// utterance "SPK1"; multi-speaker recordings need the linguist to relabel
// speakers manually before any speaker-based analysis or ELAN/EAF export.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as { speaker?: string };

  if (typeof body.speaker !== "string" || !body.speaker.trim())
    return NextResponse.json({ error: "speaker is required" }, { status: 400 });
  if (body.speaker.trim().length > 40)
    return NextResponse.json({ error: "speaker label too long (max 40 chars)" }, { status: 400 });

  const utt = await db.utterance.update({
    where: { id },
    data: { speaker: body.speaker.trim() },
  });

  return NextResponse.json(utt);
}
