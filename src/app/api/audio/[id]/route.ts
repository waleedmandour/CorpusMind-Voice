import { NextResponse } from "next/server";
import { rmSync, existsSync } from "fs";
import path from "path";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Full corpus view for the editor: utterances + tokens for one audio record.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const audio = await db.audioMetadata.findUnique({
    where: { id },
    include: {
      utterances: {
        orderBy: { index: "asc" },
        include: { tokens: { orderBy: { index: "asc" } } },
      },
    },
  });
  if (!audio) return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  return NextResponse.json(audio);
}

// Delete a recording and everything derived from it: tokens, utterances,
// jobs and the stored audio file itself (called from the Studio).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const audio = await db.audioMetadata.findUnique({ where: { id } });
    if (!audio) return NextResponse.json({ error: "Audio not found" }, { status: 404 });

    // remember job ids for output cleanup before they are deleted
    const jobs = await db.job.findMany({ where: { audioId: id }, select: { id: true } });

    // cascade: tokens -> utterances (Prisma cascade), jobs (SetNull) handled by schema;
    // delete utterances explicitly to be safe across older databases
    await db.token.deleteMany({ where: { utterance: { audioId: id } } });
    await db.utterance.deleteMany({ where: { audioId: id } });
    await db.job.deleteMany({ where: { audioId: id } });
    await db.audioMetadata.delete({ where: { id } });

    // remove the audio file (guarded: only inside the app's data/audio dir)
    if (audio.filePath && existsSync(audio.filePath)) {
      const audioDir = path.join(process.cwd(), "data", "audio");
      if (audio.filePath.startsWith(audioDir)) {
        rmSync(audio.filePath, { force: true });
      }
    }
    // remove this audio's worker output folders
    const outRoot = path.join(process.cwd(), "data", "output");
    for (const j of jobs) {
      rmSync(path.join(outRoot, j.id), { recursive: true, force: true });
    }
    return NextResponse.json({ deleted: true, id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 500 }
    );
  }
}
