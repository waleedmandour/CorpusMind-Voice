import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeAnalysis, type SiblingCounts } from "@/lib/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — full Linguistic Analysis report for one session. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ audioId: string }> }
) {
  const { audioId } = await params;
  const audio = await db.audioMetadata.findUnique({
    where: { id: audioId },
    include: {
      utterances: {
        orderBy: { index: "asc" },
        include: { tokens: { orderBy: { index: "asc" } } },
      },
    },
  });
  if (!audio) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Reference corpus = every other session that already has tokens.
  const others = await db.audioMetadata.findMany({
    where: { id: { not: audioId } },
    select: { utterances: { include: { tokens: { select: { text: true } } } } },
  });
  const sibFreq = new Map<string, number>();
  let sibTokens = 0;
  for (const o of others)
    for (const u of o.utterances)
      for (const t of u.tokens) {
        sibTokens++;
        const w = t.text.toLowerCase();
        sibFreq.set(w, (sibFreq.get(w) ?? 0) + 1);
      }
  const siblings: SiblingCounts = { tokens: sibTokens, freq: sibFreq };

  const report = computeAnalysis(
    { fileName: audio.fileName, language: audio.language, durationSec: audio.durationSec },
    audio.utterances.map((u) => ({
      index: u.index,
      startMs: u.startMs,
      endMs: u.endMs,
      text: u.text,
      speaker: u.speaker,
      disfluencies: u.disfluencies,
      prosody: u.prosody,
      tokens: u.tokens.map((t) => ({ text: t.text, confidence: t.confidence, startMs: t.startMs, endMs: t.endMs })),
    })),
    siblings
  );

  return NextResponse.json(report);
}
