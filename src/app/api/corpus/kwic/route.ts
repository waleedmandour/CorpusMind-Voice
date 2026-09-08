import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalize } from "@/lib/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WIN_MAX = 15;
const LIMIT_DEFAULT = 200;
const LIMIT_MAX = 1000;

// Cross-session KWIC concordance over every stored session.
// Modes: substring over normalized forms (default), whole word, or raw regex.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const win = Math.max(0, Math.min(WIN_MAX, parseInt(sp.get("win") ?? "5", 10) || 5));
  const whole = sp.get("whole") === "1";
  const regex = sp.get("regex") === "1";
  const norm = sp.get("norm") !== "0";
  const caseSensitive = sp.get("case") === "1";
  const limit = Math.min(LIMIT_MAX, Math.max(1, parseInt(sp.get("limit") ?? String(LIMIT_DEFAULT), 10) || LIMIT_DEFAULT));

  if (!q) return NextResponse.json({ rows: [], total: 0, capped: false, badRegex: false });

  let re: RegExp | null = null;
  if (regex) {
    try {
      re = new RegExp(q, caseSensitive ? "" : "i");
    } catch {
      return NextResponse.json({ rows: [], total: 0, capped: false, badRegex: true });
    }
  }
  const qNorm = normalize(q);

  const audios = await db.audioMetadata.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      utterances: {
        orderBy: { index: "asc" },
        include: { tokens: { orderBy: { index: "asc" } } },
      },
    },
  });

  type Row = {
    audioId: string; fileName: string; language: string;
    utt: number; startMs: number; endMs: number;
    left: string[]; node: string; right: string[];
  };
  const rows: Row[] = [];
  let total = 0;

  for (const a of audios) {
    for (const u of a.utterances) {
      const toks = u.tokens;
      for (let i = 0; i < toks.length; i++) {
        const tok = toks[i];
        let hit = false;
        if (regex && re) {
          hit = re.test(tok.text);
        } else if (norm) {
          const hay = normalize(tok.text);
          hit = whole ? hay === qNorm : qNorm.length > 0 && hay.includes(qNorm);
        } else {
          const hay = caseSensitive ? tok.text : tok.text.toLowerCase();
          const qq = caseSensitive ? q : q.toLowerCase();
          const qN = normalize(qq);
          hit = whole ? (qN && normalize(tok.text) === qN) || (qq.length > 0 && hay === qq) : hay.includes(qq);
        }
        if (!hit) continue;
        total++;
        if (rows.length < limit) {
          rows.push({
            audioId: a.id,
            fileName: a.fileName,
            language: a.language,
            utt: u.index,
            startMs: Math.round(tok.startMs),
            endMs: Math.round(tok.endMs),
            left: toks.slice(Math.max(0, i - win), i).map((x) => x.text),
            node: tok.text,
            right: toks.slice(i + 1, i + 1 + win).map((x) => x.text),
          });
        }
      }
    }
  }

  return NextResponse.json({ rows, total, capped: total > rows.length, badRegex: false });
}
