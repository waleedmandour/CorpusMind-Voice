import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// User-editable filler (hesitation marker) lexicon, per language. The
// disfluency stage of the pipeline reads this list when tagging fillers, so
// researchers can adapt detection to their dialect (e.g. Gulf "ياما", Levantine
// "يعني", Moroccan "واش") without touching the code.
// Stored in AppSetting under key "fillers" as JSON: { en: string[], ar: string[] }

const KEY = "fillers";

export const DEFAULT_FILLERS: Record<"en" | "ar", string[]> = {
  en: ["um", "uh", "erm", "like", "you know"],
  ar: ["يعني", "آه", "إيه", "أه", "طب"],
};

function sanitize(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(
    input
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && v.length <= 40)
  )].slice(0, 200);
}

export async function GET() {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  let saved: Record<string, string[]> = {};
  if (row) {
    try { saved = JSON.parse(row.value); } catch { /* fall back to defaults */ }
  }
  return NextResponse.json({
    en: sanitize(saved.en).length ? saved.en : DEFAULT_FILLERS.en,
    ar: sanitize(saved.ar).length ? saved.ar : DEFAULT_FILLERS.ar,
    defaults: DEFAULT_FILLERS,
  });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { en?: unknown; ar?: unknown } | null;
  if (!body || (typeof body.en !== "object" && typeof body.ar !== "object"))
    return NextResponse.json({ error: "body must be { en: string[], ar: string[] }" }, { status: 400 });

  const value = JSON.stringify({
    en: sanitize(body.en ?? DEFAULT_FILLERS.en),
    ar: sanitize(body.ar ?? DEFAULT_FILLERS.ar),
  });

  await db.appSetting.upsert({
    where: { key: KEY },
    update: { value },
    create: { key: KEY, value },
  });

  return NextResponse.json({ ok: true });
}
