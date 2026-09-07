import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/pipeline";
import { writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["mp3", "mp4", "wav", "m4a", "webm", "ogg", "flac"]);
const MAX_BYTES = 500 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED.has(ext))
      return NextResponse.json(
        { error: `Unsupported format .${ext}. Allowed: MP3, MP4, WAV, M4A, WEBM, OGG, FLAC` },
        { status: 415 }
      );
    if (file.size > MAX_BYTES)
      return NextResponse.json({ error: "File exceeds 500 MB limit" }, { status: 413 });

    const language = (form.get("language") as string) || "en";
    const device = (form.get("device") as string) || "cpu";
    if (!["en", "arz", "arb"].includes(language))
      return NextResponse.json({ error: "Invalid language" }, { status: 400 });

    const dir = path.join(process.cwd(), "data", "audio");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const stamped = `${Date.now()}-${file.name.replace(/[^\w.\-() ]+/g, "_")}`;
    const filePath = path.join(dir, stamped);
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buf);

    const audio = await db.audioMetadata.create({
      data: {
        fileName: file.name,
        filePath,
        format: ext,
        fileSizeBytes: buf.length,
        language,
        device: device === "auto" ? "cpu" : device, // auto resolves to cpu here; python worker upgrades to cuda
        model: "large-v3",
      },
    });

    const job = await db.job.create({
      data: { audioId: audio.id, device, status: "queued" },
    });

    enqueue(job.id, audio.id);

    return NextResponse.json({ audioId: audio.id, jobId: job.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 }
    );
  }
}
