import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { spawn } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function fmtMs(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function buildTei(audio: {
  fileName: string; language: string; durationSec: number; createdAt: Date;
} & Record<string, string | null>, utterances: UtterFull[]): string {
  const meta = (k: string, d = "unknown") => xmlEsc(audio[k] || d);
  const u = utterances
    .map(
      (ut) => `      <u xml:id="${xmlEsc(ut.id)}" start="${fmtMs(ut.startMs)}" end="${fmtMs(ut.endMs)}" who="${xmlEsc(ut.speaker)}">
        <seg>${ut.tokens
          .map(
            (t) =>
              `<w xml:id="${xmlEsc(t.id)}" start="${fmtMs(t.startMs)}" end="${fmtMs(t.endMs)}" confidence="${t.confidence.toFixed(3)}"${t.edited ? ' part="edited"' : ""}>${xmlEsc(t.text)}</w>`
          )
          .join(" ")}
        </seg>
      </u>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0" xml:lang="${xmlEsc(audio.language)}" version="3.0">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title>${meta("corpusTitle", audio.fileName)}</title>
      </titleStmt>
      <publicationStmt>
        <publisher>CorpusMind Voice (local-first, offline)</publisher>
        <availability status="${audio.license ? "free" : "unknown"}">
          <licence target="https://creativecommons.org/licenses/by/4.0/">${meta("license", "CC-BY-4.0")}</licence>
        </availability>
      </publicationStmt>
      <sourceDesc>
        <recordingStmt>
          <recording type="audio" dur="${fmtMs(audio.durationSec * 1000)}">
            <date>${meta("recordingDate", audio.createdAt.toISOString().slice(0, 10))}</date>
            <placeName>${meta("recordingPlace")}</placeName>
          </recording>
        </recordingStmt>
        <profileDesc>
          <langUsage>
            <language ident="${xmlEsc(audio.language)}">${audio.language === "en" ? "English" : "Arabic"}</language>
          </langUsage>
          <particDesc>
            <person xml:id="SPK1">
              <persName>${meta("speakerName")}</persName>
              <langKnowledge>
                <langKnown ident="${xmlEsc(audio.language)}">${meta("speakerDialect")}</langKnown>
              </langKnowledge>
            </person>
          </particDesc>
          <textClass>
            <keywords><term>${meta("genre")}</term></keywords>
          </textClass>
        </profileDesc>
      </sourceDesc>
    </fileDesc>
    <notesStmt><note>${meta("notes")}</note></notesStmt>
  </teiHeader>
  <text>
    <body>
${u}
    </body>
  </text>
</TEI>
`;
}

interface TokenFull {
  id: string; index: number; text: string; startMs: number; endMs: number;
  confidence: number; edited: boolean; realigned: boolean;
}
interface UtterFull {
  id: string; index: number; startMs: number; endMs: number; text: string;
  speaker: string; tokens: TokenFull[]; disfluencies: unknown; prosody: unknown;
}

async function buildSqlite(audioId: string): Promise<Buffer | null> {
  const tmp = mkdtempSync(path.join(tmpdir(), "cmv-"));
  const out = path.join(tmp, "corpus.sqlite");
  try {
    const code = await new Promise<number | null>((resolve) => {
      const p = spawn("python3", [
        path.join(process.cwd(), "python", "export_sqlite.py"),
        process.env.DATABASE_URL?.replace("file:", "") ?? path.join(process.cwd(), "db", "custom.db"),
        audioId,
        out,
      ]);
      p.on("error", () => resolve(null));
      p.on("close", (c) => resolve(c));
    });
    if (code !== 0) return null;
    return readFileSync(out);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ audioId: string }> }
) {
  const { audioId } = await params;
  const format = req.nextUrl.searchParams.get("format") ?? "json";

  const audio = await db.audioMetadata.findUnique({
    where: { id: audioId },
    include: {
      utterances: {
        orderBy: { index: "asc" },
        include: { tokens: { orderBy: { index: "asc" } } },
      },
    },
  });
  if (!audio) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { utterances, ...meta } = audio;
  const base = audio.fileName.replace(/\.[^.]+$/, "").replace(/[^\w.\-]+/g, "_") || "corpus";

  if (format === "json") {
    const payload = {
      generator: "CorpusMind Voice",
      projectSite: "https://waleedmandour.org/projects/CorpusMind/",
      generatedAt: new Date().toISOString(),
      metadata: { ...meta, filePath: undefined },
      utterances: utterances.map((u) => ({
        id: u.id, index: u.index, startMs: u.startMs, endMs: u.endMs,
        text: u.text, speaker: u.speaker,
        disfluencies: u.disfluencies, prosody: u.prosody,
        tokens: u.tokens.map((t) => ({
          id: t.id, index: t.index, text: t.text,
          startMs: t.startMs, endMs: t.endMs,
          confidence: t.confidence, edited: t.edited, realigned: t.realigned,
        })),
      })),
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.corpusmind.json"`,
      },
    });
  }

  if (format === "csv") {
    const rows = [["utterance_index", "token_index", "text", "start_ms", "end_ms", "confidence", "edited", "realigned"]];
    for (const u of utterances)
      for (const t of u.tokens)
        rows.push([String(u.index), String(t.index), `"${t.text.replace(/"/g, '""')}"`, String(Math.round(t.startMs)), String(Math.round(t.endMs)), t.confidence.toFixed(3), t.edited ? "1" : "0", t.realigned ? "1" : "0"]);
    return new NextResponse(rows.map((r) => r.join(",")).join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.tokens.csv"`,
      },
    });
  }

  if (format === "tei") {
    return new NextResponse(buildTei(meta as never, utterances as never), {
      headers: {
        "Content-Type": "application/tei+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.tei.xml"`,
      },
    });
  }

  if (format === "sqlite") {
    const buf = await buildSqlite(audioId);
    if (!buf)
      return NextResponse.json(
        { error: "SQLite export requires python3 (sqlite3 stdlib)" },
        { status: 503 }
      );
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="${base}.sqlite"`,
      },
    });
  }

  return NextResponse.json({ error: "Unknown format" }, { status: 400 });
}
