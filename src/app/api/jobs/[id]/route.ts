import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await db.job.findUnique({
    where: { id },
    include: { audio: { select: { fileName: true, language: true, durationSec: true, model: true, device: true } } },
  });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const elapsedSec =
    job.status === "running"
      ? (Date.now() - new Date(job.createdAt).getTime()) / 1000
      : job.elapsedSec;
  return NextResponse.json({ ...job, elapsedSec: +elapsedSec.toFixed(1) });
}
