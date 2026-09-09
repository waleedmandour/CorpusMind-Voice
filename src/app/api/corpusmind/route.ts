import { NextResponse } from "next/server";
import { spawn } from "child_process";
import os from "os";
import path from "path";
import { existsSync } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function detectCorpusMind(): string | null {
  const home = os.homedir();
  const candidates = [
    path.join(home, "CorpusMind"),
    path.join(home, ".local", "share", "CorpusMind"),
    "/opt/corpusmind",
    "/Applications/CorpusMind.app",
    path.join(home, "AppData", "Local", "CorpusMind"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export async function GET() {
  const p = detectCorpusMind();
  return NextResponse.json({ detected: !!p, path: p });
}

// Attempt a local launch of the CorpusMind desktop app (Tauri deep-link style).
// On the web build without an installation this returns guidance instead.
export async function POST() {
  const p = detectCorpusMind();
  if (!p)
    return NextResponse.json({
      launched: false,
      message:
        "CorpusMind was not found. Install it from https://waleedmandour.org/projects/CorpusMind/ then restart CorpusMind Voice.",
    });

  const attempt = (cmd: string, args: string[]) =>
    new Promise<boolean>((resolve) => {
      try {
        const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
        child.on("error", () => resolve(false));
        child.unref();
        resolve(true);
      } catch {
        resolve(false);
      }
    });

  const plat = os.platform();
  let ok = false;
  if (plat === "darwin") ok = await attempt("open", [p]);
  else if (plat === "win32") ok = await attempt("cmd", ["/c", "start", "", p]);
  else ok = await attempt("xdg-open", [p]);

  return NextResponse.json({ launched: ok, path: p });
}
