import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runtime dependency probe for the packaged desktop app.
//
// transformers.js requires sharp and onnxruntime-node EAGERLY at module
// load, so a runner-specific native gap anywhere in that chain kills the
// whole /api/upload module graph before the handler runs - the client sees
// an opaque plain-text 500 ("Internal Server Error") with nothing in the
// server log. This endpoint loads the ASR module chain exactly the way the
// upload route does and reports each stage's result as JSON, so the build
// smoke (scripts/smoke_standalone.mjs) can pinpoint the real failing module
// per platform instead of guessing.
//
// IMPORTANT: never probe the native packages by importing them directly -
// Next preloads the upload route's graph at boot, and a second import under
// a different module identity re-executes the onnxruntime binding, which
// dies with "cannot register backend \"cpu\"". Only chains that share the
// boot-time module identity are safe to (re)load here.

const probes: Array<[string, () => Promise<unknown>]> = [
  [
    "db",
    async () => {
      await db.$queryRawUnsafe("SELECT 1");
      return "ok";
    },
  ],
  ["ffmpeg-installer", () => import("@ffmpeg-installer/ffmpeg")],
  ["asr-chain (transformers, sharp, onnxruntime-node)", () => import("@/lib/asr")],
  ["pipeline", () => import("@/lib/pipeline")],
];

export async function GET() {
  const results: Record<string, string> = {};
  for (const [name, probe] of probes) {
    try {
      await probe();
      results[name] = "ok";
    } catch (e) {
      results[name] =
        e instanceof Error
          ? `${e.name}: ${e.message}`.slice(0, 400)
          : String(e).slice(0, 400);
    }
  }
  const failed = Object.entries(results).filter(([, v]) => v !== "ok");
  return NextResponse.json(
    { ok: failed.length === 0, results },
    { status: failed.length === 0 ? 200 : 500 }
  );
}
