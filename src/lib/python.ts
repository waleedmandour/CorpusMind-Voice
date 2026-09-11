// Locate a usable Python 3 interpreter across platforms.
//
// Windows ships `python.exe` (and the `py` launcher), rarely `python3`;
// Linux and macOS are the opposite. v1.2.x hardcoded "python3", so on
// Windows the optional Python accelerator probe always failed and the
// SQLite corpus export answered 503 on a machine that had Python
// installed. Every spawn site now resolves through findPython(), which
// tries the candidates in order and verifies the interpreter actually
// runs (the Microsoft Store `python` stub exits non-zero, so it is
// rejected here instead of breaking a real job later).
import { spawn } from "child_process";

export function pythonCandidates(): string[] {
  return process.platform === "win32"
    ? ["python", "py", "python3"]
    : ["python3", "python"];
}

function canRun(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, ["-c", "import sys; print(sys.version_info[0])"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      const timer = setTimeout(() => {
        p.kill("SIGKILL");
        resolve(false);
      }, 2500);
      p.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      p.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      p.on("close", (code) => {
        clearTimeout(timer);
        // require Python 3; the store stub and py2 rejects fail here
        resolve(code === 0 && out.trim().startsWith("3"));
      });
    } catch {
      resolve(false);
    }
  });
}

let cached: { value: string | null; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** First working Python 3 candidate, or null. Cached for 5 minutes. */
export async function findPython(): Promise<string | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  for (const cmd of pythonCandidates()) {
    if (await canRun(cmd)) {
      cached = { value: cmd, at: Date.now() };
      return cmd;
    }
  }
  cached = { value: null, at: Date.now() };
  return null;
}
