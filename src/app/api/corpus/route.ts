import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalize, dispersionDPCore } from "@/lib/analysis";
import { STOPS } from "@/lib/stopwords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Corpus-wide aggregates across every stored session: session inventory,
// total counts and a corpus-wide frequency list with DP dispersion measured
// across sessions (a word that appears in one session only scores DP near 1).
export async function GET() {
  const audios = await db.audioMetadata.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      utterances: {
        orderBy: { index: "asc" },
        include: { tokens: { orderBy: { index: "asc" }, select: { text: true } } },
      },
    },
  });

  const sessions = audios.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    language: a.language,
    durationSec: a.durationSec,
    corpusTitle: a.corpusTitle,
    speakerName: a.speakerName,
    createdAt: a.createdAt,
    utterances: a.utterances.length,
    tokens: a.utterances.reduce((acc, u) => acc + u.tokens.length, 0),
  }));

  // corpus-wide frequency + per-session dispersion
  const parts = audios.filter((a) => a.utterances.length > 0);
  const nParts = Math.max(1, parts.length);
  const freq = new Map<string, number>();
  const perWordParts = new Map<string, number[]>();
  let total = 0;

  for (let p = 0; p < parts.length; p++) {
    const a = parts[p];
    const local = new Map<string, number>();
    for (const u of a.utterances)
      for (const t of u.tokens) {
        const w = normalize(t.text);
        if (!w) continue;
        freq.set(w, (freq.get(w) ?? 0) + 1);
        local.set(w, (local.get(w) ?? 0) + 1);
        total++;
      }
    for (const [w, c] of local) {
      const arr = perWordParts.get(w) ?? new Array(nParts).fill(0);
      arr[p] = c;
      perWordParts.set(w, arr);
    }
  }

  const items = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2000)
    .map(([word, count]) => ({
      word,
      count,
      perK: +((count / Math.max(total, 1)) * 1000).toFixed(2),
      dp: +dispersionDPCore(perWordParts.get(word) ?? [], count).toFixed(3),
      stop: STOPS.en.has(word) || STOPS.ar.has(word),
    }));

  return NextResponse.json({
    sessions,
    totals: {
      sessions: audios.length,
      tokens: total,
      types: freq.size,
      durationSec: +audios.reduce((acc, a) => acc + a.durationSec, 0).toFixed(1),
    },
    frequency: { items },
  });
}
