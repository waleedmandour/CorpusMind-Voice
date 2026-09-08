import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createReadStream, existsSync, statSync } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stream the original audio file for click-to-play (editor, KWIC, corpus view).
// Supports HTTP Range requests so <audio> can seek to a token timestamp.
const MIME: Record<string, string> = {
  mp3: "audio/mpeg", mp4: "audio/mp4", m4a: "audio/mp4", m4b: "audio/mp4",
  aac: "audio/aac", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg",
  oga: "audio/ogg", opus: "audio/ogg", webm: "audio/webm", wma: "audio/x-ms-wma",
  amr: "audio/amr", "3gp": "audio/3gpp", mpg: "audio/mpeg", mpeg: "audio/mpeg",
  aif: "audio/aiff", aiff: "audio/aiff",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ audioId: string }> }
) {
  const { audioId } = await params;
  const audio = await db.audioMetadata.findUnique({
    where: { id: audioId },
    select: { filePath: true, format: true },
  });
  if (!audio || !existsSync(audio.filePath))
    return NextResponse.json({ error: "Audio file not found" }, { status: 404 });

  const stat = statSync(audio.filePath);
  const size = stat.size;
  const mime = MIME[audio.format.toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");

  // Range request → 206 partial content (seek support)
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      end = Math.min(end, size - 1);
      const stream = createReadStream(audio.filePath, { start, end });
      return new NextResponse(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  // Full file
  const stream = createReadStream(audio.filePath);
  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}

