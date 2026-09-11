import { NextResponse } from "next/server";
import { rmSync, existsSync } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { AUDIO_DIR, OUTPUT_DIR } from "@/lib/paths";

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

    // v1.3 ordering fix: remove files BEFORE the database rows. The old order
    // (rows first, files second) meant a file-system error landed in the catch
    // with every DB row already gone, so the UI showed a 500 while the corpus
    // entry had actually been deleted - and retrying then 404ed. File cleanup
    // is best-effort: an orphaned file must not block the logical deletion.
    const warnings: string[] = [];

    // remove the audio file (guarded: only inside the app's audio store)
    if (audio.filePath && existsSync(audio.filePath)) {
      const audioDir = path.resolve(AUDIO_DIR);
      if (path.resolve(audio.filePath).startsWith(audioDir)) {
        try {
          rmSync(audio.filePath, { force: true });
        } catch (e) {
          warnings.push(`audio file: ${e instanceof Error ? e.message : "delete failed"}`);
        }
      }
    }
    // remove this audio's worker output folders
    for (const j of jobs) {
      try {
        rmSync(path.join(OUTPUT_DIR, j.id), { recursive: true, force: true });
      } catch (e) {
        warnings.push(`job output ${j.id}: ${e instanceof Error ? e.message : "delete failed"}`);
      }
    }

    // cascade: tokens -> utterances (Prisma cascade), jobs (SetNull) handled by schema;
    // delete utterances explicitly to be safe across older databases
    await db.token.deleteMany({ where: { utterance: { audioId: id } } });
    await db.utterance.deleteMany({ where: { audioId: id } });
    await db.job.deleteMany({ where: { audioId: id } });
    await db.audioMetadata.delete({ where: { id } });

    return NextResponse.json({ deleted: true, id, ...(warnings.length ? { warnings } : {}) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 500 }
    );
  }
}
