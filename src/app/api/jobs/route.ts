import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = await db.job.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    include: { audio: { select: { fileName: true, language: true } } },
  });
  return NextResponse.json({ jobs });
}
