import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRINGS = [
  "corpusTitle", "speakerName", "speakerDialect", "speakerGender", "speakerAge",
  "recordingDate", "recordingPlace", "genre", "license", "notes",
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ audioId: string }> }
) {
  const { audioId } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  const data: Record<string, string> = {};
  for (const k of STRINGS) {
    if (typeof body[k] === "string") data[k] = body[k] as string;
  }
  const audio = await db.audioMetadata.update({ where: { id: audioId }, data });
  return NextResponse.json(audio);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ audioId: string }> }
) {
  const { audioId } = await params;
  const audio = await db.audioMetadata.findUnique({
    where: { id: audioId },
    select: STRINGS.reduce((o, k) => ({ ...o, [k]: true }), {}),
  });
  if (!audio) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(audio);
}
