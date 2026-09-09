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
  _eafId?: string; // ELAN annotation id assigned during EAF serialization
}

// ---------------------------------------------------------------- subtitles
function srtStamp(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000), x = t % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(x).padStart(3, "0")}`;
}

function vttStamp(ms: number): string {
  return srtStamp(ms).replace(",", ".");
}

const ONE_LINE = /[\r\n]+/g;

function buildSrt(utterances: UtterFull[]): string {
  const blocks = utterances
    .filter((u) => u.text.trim().length > 0)
    .map((u, i) => `${i + 1}\n${srtStamp(u.startMs)} --> ${srtStamp(u.endMs)}\n${u.text.replace(ONE_LINE, " ").trim()}`);
  return blocks.join("\n\n") + "\n";
}

function buildVtt(utterances: UtterFull[]): string {
  const blocks = utterances
    .filter((u) => u.text.trim().length > 0)
    .map((u, i) => `${i + 1}\n${vttStamp(u.startMs)} --> ${vttStamp(u.endMs)}\n${u.text.replace(ONE_LINE, " ").trim()}`);
  return "WEBVTT\n\n" + blocks.join("\n\n") + "\n";
}

// ---------------------------------------------------------------- Praat TextGrid
function tgEsc(s: string): string {
  return s.replace(/"/g, '""').replace(ONE_LINE, " ").trim();
}

/** Build one interval tier body, filling gaps before/between/after marks. */
function tgIntervals(spans: { startMs: number; endMs: number; text: string }[], durSec: number): string {
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
  const out: string[] = [];
  let cursor = 0;
  let n = 0;
  const push = (from: number, to: number, text: string) => {
    if (to - from <= 0.000001 && !text) return;
    n++;
    out.push(`        intervals [${n}]:\n            xmin = ${from.toFixed(6)}\n            xmax = ${to.toFixed(6)}\n            text = "${tgEsc(text)}"`);
  };
  for (const sp of sorted) {
    const a = Math.max(0, Math.min(durSec, sp.startMs / 1000));
    const b = Math.max(0, Math.min(durSec, sp.endMs / 1000));
    if (a > cursor) push(cursor, a, "");
    push(a, Math.max(a, b), sp.text);
    cursor = Math.max(cursor, b);
  }
  if (cursor < durSec) push(cursor, durSec, "");
  return `        intervals: size = ${n}\n${out.join("\n")}`;
}

function buildTextGrid(audio: { durationSec: number }, utterances: UtterFull[]): string {
  const dur = Math.max(0.001, audio.durationSec || 0);
  const uttSpans = utterances.map((u) => ({ startMs: u.startMs, endMs: u.endMs, text: u.text }));
  const tokSpans = utterances.flatMap((u) => u.tokens.map((t) => ({ startMs: t.startMs, endMs: t.endMs, text: t.text })));
  return `File type = "ooTextFile"
Object class = "TextGrid"

xmin = 0
xmax = ${dur.toFixed(6)}
tiers? <exists>
size = 2
item []:
    item [1]:
        class = "IntervalTier"
        name = "utterances"
        xmin = 0
        xmax = ${dur.toFixed(6)}
${tgIntervals(uttSpans, dur)}
    item [2]:
        class = "IntervalTier"
        name = "tokens"
        xmin = 0
        xmax = ${dur.toFixed(6)}
${tgIntervals(tokSpans, dur)}
`;
}

// ---------------------------------------------------------------- ELAN EAF
const EAF_MIME: Record<string, string> = {
  wav: "audio/x-wav", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4",
  ogg: "audio/ogg", opus: "audio/ogg", webm: "video/webm", flac: "audio/x-flac",
};

function buildEaf(
  audio: { fileName: string; format: string; durationSec: number },
  utterances: UtterFull[]
): string {
  // time slots hold every utterance boundary; tokens use symbolic association
  const slotIds = new Map<string, string>();
  let tsCount = 0;
  const slot = (ms: number): string => {
    const key = String(Math.max(0, Math.round(ms)));
    if (!slotIds.has(key)) {
      tsCount++;
      slotIds.set(key, `ts${tsCount}`);
    }
    return slotIds.get(key)!;
  };

  const speakers = [...new Set(utterances.map((u) => u.speaker || "SPK1"))];
  let ann = 0;
  const nextId = (p: string) => `${p}${++ann}`;

  const tiers: string[] = [];
  for (const spk of speakers) {
    const utts = utterances.filter((u) => (u.speaker || "SPK1") === spk);
    const uttAnn: string[] = [];
    for (const u of utts) {
      const aid = nextId("a");
      u._eafId = aid;
      uttAnn.push(`      <ANNOTATION>\n        <ALIGNABLE_ANNOTATION ANNOTATION_ID="${aid}" TIME_SLOT_REF1="${slot(u.startMs)}" TIME_SLOT_REF2="${slot(u.endMs)}">\n          <ANNOTATION_VALUE>${xmlEsc(u.text.replace(ONE_LINE, " ").trim())}</ANNOTATION_VALUE>\n        </ALIGNABLE_ANNOTATION>\n      </ANNOTATION>`);
    }
    tiers.push(`    <TIER LINGUISTIC_TYPE_REF="default-lt" TIER_ID="${xmlEsc(spk)}">\n${uttAnn.join("\n")}\n    </TIER>`);
    const tokAnn: string[] = [];
    for (const u of utts) {
      for (const t of u.tokens) {
        if (!t.text.trim()) continue;
        tokAnn.push(`      <ANNOTATION>\n        <REF_ANNOTATION ANNOTATION_ID="${nextId("r")}" ANNOTATION_REF="${u._eafId}">\n          <ANNOTATION_VALUE>${xmlEsc(t.text.trim())}</ANNOTATION_VALUE>\n        </REF_ANNOTATION>\n      </ANNOTATION>`);
      }
    }
    if (tokAnn.length)
      tiers.push(`    <TIER LINGUISTIC_TYPE_REF="token-lt" TIER_ID="${xmlEsc(spk)}-tokens" PARENT_REF="${xmlEsc(spk)}">\n${tokAnn.join("\n")}\n    </TIER>`);
  }

  const slots = [...slotIds.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([ms, id]) => `    <TIME_SLOT TIME_SLOT_ID="${id}" TIME_VALUE="${ms}"/>`)
    .join("\n");

  const mime = EAF_MIME[audio.format.toLowerCase()] ?? "audio/x-wav";
  const maxSlot = [...slotIds.keys()].map(Number).reduce((a, b) => Math.max(a, b), 0);
  const durMs = Math.max(Math.round(audio.durationSec * 1000), maxSlot);
  return `<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="CorpusMind Voice" DATE="${new Date().toISOString()}" VERSION="3.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.mpi.nl/tools/elan/EAFv3.0.xsd">
  <HEADER MEDIA_FILE="" TIME_UNITS="milliseconds">
    <MEDIA_DESCRIPTOR MEDIA_URL="file://${xmlEsc(audio.fileName)}" MIME_TYPE="${mime}" RELATIVE_MEDIA_URL="./${xmlEsc(audio.fileName)}"/>
    <PROPERTY NAME="lastUsedAnnotationId">${ann}</PROPERTY>
  </HEADER>
  <TIME_ORDER>
${slots}
  </TIME_ORDER>
${tiers.join("\n")}
  <LINGUISTIC_TYPE GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="default-lt" TIME_ALIGNABLE="true"/>
  <LINGUISTIC_TYPE GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="token-lt" TIME_ALIGNABLE="false" CONSTRAINTS="Symbolic_Association"/>
  <CONSTRAINT DESCRIPTION="Time subdivision of parent annotation's time interval, no time gaps allowed within annotation" STEREOTYPE="Time_Subdivision"/>
  <CONSTRAINT DESCRIPTION="Annotation associated with detailed segmentation of the referent" STEREOTYPE="Symbolic_Subdivision"/>
  <CONSTRAINT DESCRIPTION="Time durating associated annotation of the referent" STEREOTYPE="Symbolic_Association"/>
  <CONSTRAINT DESCRIPTION="Symbolic subdivision of a referent annotation" STEREOTYPE="Symbolic_Split"/>
  <HEADER_MEDIA_DURATION TIME_VALUE="${durMs}"/>
</ANNOTATION_DOCUMENT>
`;
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

  if (format === "srt") {
    return new NextResponse(buildSrt(utterances), {
      headers: {
        "Content-Type": "application/x-subrip; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.srt"`,
      },
    });
  }

  if (format === "vtt") {
    return new NextResponse(buildVtt(utterances), {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.vtt"`,
      },
    });
  }

  if (format === "textgrid") {
    return new NextResponse(buildTextGrid({ durationSec: audio.durationSec }, utterances), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.TextGrid"`,
      },
    });
  }

  if (format === "eaf") {
    return new NextResponse(
      buildEaf({ fileName: audio.fileName, format: audio.format, durationSec: audio.durationSec }, utterances),
      {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${base}.eaf"`,
        },
      }
    );
  }

  return NextResponse.json({ error: "Unknown format" }, { status: 400 });
}
