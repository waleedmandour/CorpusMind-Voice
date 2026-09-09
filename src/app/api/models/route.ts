import { NextRequest, NextResponse } from "next/server";
import {
  CATALOG, MODELS_DIR, activeDownload, downloadModel, listModels, removeModel, totalBytes,
} from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const dl = activeDownload();
  return NextResponse.json({
    modelsDir: MODELS_DIR,
    totalBytes: totalBytes(),
    models: listModels().map((m) => ({ ...m, labelKey: CATALOG.find((c) => c.id === m.id)?.labelKey ?? "" })),
    download: dl,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string };
  const id = body.id ?? "";
  if (!CATALOG.some((c) => c.id === id))
    return NextResponse.json({ error: `unknown model id: ${id}` }, { status: 400 });

  if (body.action === "download") {
    // fire-and-forget: progress is polled from GET /api/models
    void downloadModel(id).catch(() => undefined);
    const dl = activeDownload();
    return NextResponse.json({ started: true, download: dl });
  }

  if (body.action === "delete") {
    const ok = removeModel(id);
    return NextResponse.json({ deleted: ok, models: listModels() });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
