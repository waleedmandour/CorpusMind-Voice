import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Token correction from the confidence-coded editor.
// edited tokens are flagged `realigned:false` - the desktop build re-runs
// Montreal Forced Aligner for the containing utterance only.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as { text?: string; confidence?: number };
  if (typeof body.text !== "string" || !body.text.trim())
    return NextResponse.json({ error: "text is required" }, { status: 400 });

  const token = await db.token.update({
    where: { id },
    data: {
      text: body.text.trim(),
      edited: true,
      realigned: false,
      // manual corrections are treated as verified gold
      ...(typeof body.confidence === "number" ? { confidence: body.confidence } : { confidence: 1 }),
    },
  });

  // Keep the utterance-level text in sync with its tokens so that exports
  // (TEI / CSV / JSON) always reflect manual corrections. Rebuild from the
  // full token list in utterance order.
  const utt = await db.utterance.findUnique({
    where: { id: token.utteranceId },
    include: { tokens: { orderBy: { index: "asc" } } },
  });
  if (utt) {
    const joined = utt.tokens.map((t) => t.text.trim()).filter(Boolean).join(" ");
    await db.utterance.update({ where: { id: utt.id }, data: { text: joined } });
  }

  return NextResponse.json(token);
}
