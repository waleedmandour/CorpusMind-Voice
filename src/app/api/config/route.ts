import { NextRequest, NextResponse } from "next/server";
import pkg from "../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runtime facts the client shell needs before it decides how to boot.
// The PWA registrar uses `desktop` to stay away from the service worker:
// inside the Tauri shell a cached app shell survives upgrades and serves a
// STALE build (the v1.2.x stale-UI reports), while phones and browsers keep
// the offline PWA behaviour.
export async function GET(req: NextRequest) {
  // Requests relayed by the phone companion proxy carry x-cm-companion; the
  // desktop webview hits 127.0.0.1 directly with no such header.
  const viaCompanion = req.headers.get("x-cm-companion") === "1";
  const desktop = process.env.CM_DESKTOP === "1" && !viaCompanion;
  return NextResponse.json({
    desktop,
    version: pkg.version,
    companion: { active: !!process.env.CM_TOKEN },
  });
}
