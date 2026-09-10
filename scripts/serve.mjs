// Cross-platform production launcher for the standalone server.
// Replaces the POSIX-only `NODE_ENV=production bun .next/standalone/server.js
// 2>&1 | tee server.log` chain, which never worked in cmd.exe or PowerShell.
//
// Usage:  npm run start   (or: node scripts/serve.mjs)
// Stdout stays with the terminal; pass --log server.log to also tee to a file.
import { spawn } from "child_process";
import { existsSync, mkdirSync, openSync } from "fs";
import path from "path";

const root = process.cwd();
const serverJs = path.join(root, ".next", "standalone", "server.js");
if (!existsSync(serverJs)) {
  console.error("standalone server missing - run `bun run build` (or `next build`) first");
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "production",
  PORT: process.env.PORT || "3000",
  HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
  DATABASE_URL:
    process.env.DATABASE_URL || `file:${path.join(root, "db", "custom.db")}`,
  CM_MODELS_DIR: process.env.CM_MODELS_DIR || path.join(root, "data", "models"),
};

// A stale exported DATABASE_URL (or a skipped db:push) produces cryptic
// "Unable to open the database file" errors deep inside Prisma. Surface it.
try {
  const dbFile = env.DATABASE_URL.replace(/^file:/, "").split("?")[0];
  if (dbFile && !path.isAbsolute(dbFile)) {
    // prisma resolves relative paths against the schema dir (../db/... style)
  } else if (!existsSync(dbFile)) {
    console.warn(
      `serve: WARNING - DATABASE_URL points to ${dbFile} which does not exist yet. Run 'bun run db:push' first.`
    );
  }
} catch { /* advisory only */ }

// The standalone server is produced by the same Node major version that runs
// the build; prefer the local node, fall back to whatever is on PATH.
const nodeExe = process.execPath;
const logIdx = process.argv.indexOf("--log");
const logFile = logIdx > -1 ? path.resolve(root, process.argv[logIdx + 1]) : null;
if (logFile) mkdirSync(path.dirname(logFile), { recursive: true });

const child = spawn(nodeExe, [serverJs], {
  cwd: path.join(root, ".next", "standalone"),
  env,
  stdio: logFile
    ? ["ignore", openSync(logFile, "a"), openSync(logFile, "a")]
    : "inherit",
});
if (logFile) console.error(`logging to ${logFile}`);

const shutdown = () => {
  try { child.kill(); } catch { /* already gone */ }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", (code) => (process.exitCode = code ?? 0));
