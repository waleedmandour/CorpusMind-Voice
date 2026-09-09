import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/pipeline";
import { writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Any container ffprobe/ffmpeg can decode. M4A/AAC (Apple voice memos),
// OGG/OPUS (Linux & WhatsApp), AMR/3GP (phone recorders) all accepted.
const ALLOWED = new Set([
  "mp3", "mp4", "m4a", "m4b", "aac", "wav", "flac", "ogg", "oga", "opus",
  "webm", "wma", "amr", "3gp", "mpg", "mpeg", "aif", "aiff",
]);
const MAX_BYTES = 500 * 1024 * 1024;
const MODELS = new Set(["tiny", "base", "small", "medium", "large-v3-turbo"]);

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED.has(ext))
      return NextResponse.json(
        { error: `Unsupported format .${ext}. Allowed: MP3, MP4, M4A, AAC, WAV, FLAC, OGG, OPUS, WEBM, WMA, AMR, 3GP, AIFF` },
        { status: 415 }
      );
    if (file.size === 0)
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    if (file.size > MAX_BYTES)
      return NextResponse.json({ error: "File exceeds 500 MB limit" }, { status: 413 });

    const language = (form.get("language") as string) || "en";
    const device = (form.get("device") as string) || "cpu";
    const model = (form.get("model") as string) || "large-v3-turbo";
    if (!["en", "arz", "arb"].includes(language))
      return NextResponse.json({ error: "Invalid language" }, { status: 400 });
    if (!MODELS.has(model))
      return NextResponse.json({ error: "Invalid model" }, { status: 400 });

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
        model,
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
