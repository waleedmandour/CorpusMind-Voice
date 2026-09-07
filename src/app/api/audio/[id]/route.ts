import { NextResponse } from "next/server";
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
