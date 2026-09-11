#!/usr/bin/env node
// Boots the assembled standalone from an ISOLATED directory (the packaged-app
// layout: no repo node_modules and no .next sibling on the module resolution
// path) and exercises the exact requests that broke in the shipped v1.3.0
// build:
//
//   GET  /api/config  -> JSON carrying the app version
//   POST /api/upload  -> JSON { audioId, jobId }
//
// The upload hit is the regression test for the "hashed external" defect: the
// route's module graph imports the externalized ASR stack, so the request
// only succeeds when every Turbopack alias resolves inside the standalone.
// When it does not, Next answers a plain-text 500 "Internal Server Error",
// which the browser surfaces as "Unexpected token 'I', 'Internal s' ... is
// not valid JSON". A plain-text 500 anywhere in this smoke fails the build
// chain (bun run build runs this after check_bundle_externals.mjs).
//
// Usage: node scripts/smoke_standalone.mjs [--standalone .next/standalone]
import { spawn, execSync } from "child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import path from "path";
import http from "http";

const root = process.cwd();
const argIdx = process.argv.indexOf("--standalone");
const standalone = path.isAbsolute(argIdx > -1 ? process.argv[argIdx + 1] : "")
  ? process.argv[argIdx + 1]
  : path.join(root, argIdx > -1 ? process.argv[argIdx + 1] : ".next/standalone");
const PORTS = [34671, 34672, 34673, 34674, 34675];

const problems = [];
const note = (m) => console.log(`  ok    ${m}`);
const fail = (m) => problems.push(m);
const die = (m) => {
  console.error(`\nstandalone smoke FAILED: ${m}`);
  process.exit(1);
};
let stderrTail = "";

if (!existsSync(path.join(standalone, "server.js"))) {
  die(`standalone bundle not found at ${standalone} - run \`bun run build\` first`);
}

const pkgVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;

function pickPort(preferred) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(null));
    probe.once("listening", () => probe.close(() => resolve(preferred)));
    probe.listen(preferred, "127.0.0.1");
  });
}

function get(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: p, timeout: 15000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", body }));
    });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
  });
}

function post(port, p, body, contentType, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: p,
        method: "POST",
        headers: {
          "content-type": contentType,
          "content-length": body.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", body: data }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

function multipart(fields) {
  const boundary = "----cmvsmoke" + Math.random().toString(16).slice(2);
  const parts = [];
  for (const f of fields) {
    const head =
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"` +
      (f.filename ? `; filename="${f.filename}"` : "") +
      (f.type ? `\r\nContent-Type: ${f.type}` : "") +
      `\r\n\r\n`;
    parts.push(Buffer.from(head));
    parts.push(f.value);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function oneSecondWav() {
  const rate = 16000;
  const samples = rate;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
  }
  return buf;
}

async function waitForServer(port, child, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const r = await get(port, "/api/config");
      if (r.status === 200) return r;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not accept requests on :${port} within ${timeoutMs / 1000}s`);
}

const work = mkdtempSync(path.join(tmpdir(), "cmv-smoke-"));
const installRoot = path.join(work, "install"); // no node_modules anywhere above this
const appDir = path.join(installRoot, "standalone");
const dataDir = path.join(work, "data");

let child = null;
let port = null;
try {
  console.log(`smoke-booting isolated copy of ${standalone}`);
  cpSync(standalone, appDir, { recursive: true, verbatimSymlinks: false });
  mkdirSync(dataDir, { recursive: true });
  // Provision the runtime schema into the temp database. db/seed.db is
  // gitignored, so a fresh CI checkout (web job) carries NO seed file and an
  // empty database would 500 every schema-touching route. prisma db push is
  // deterministic everywhere the build itself just ran; a committed-state
  // seed copy is only the fallback.
  let provisioned = null;
  try {
    execSync("npx prisma db push --skip-generate", {
      cwd: root,
      env: { ...process.env, DATABASE_URL: `file:${path.join(dataDir, "custom.db")}` },
      stdio: "pipe",
    });
    provisioned = "prisma db push";
  } catch {
    const seed = ["db/seed.db", "db/custom.db"]
      .map((c) => path.join(root, c))
      .find(existsSync);
    if (seed) {
      copyFileSync(seed, path.join(dataDir, "custom.db"));
      provisioned = `copied ${path.relative(root, seed)}`;
    }
  }
  if (provisioned) note(`provisioned custom.db via ${provisioned}`);
  else fail("could not provision the smoke database (prisma db push failed, no seed file present)");

  for (const p of PORTS) {
    if (await pickPort(p)) {
      port = p;
      break;
    }
  }
  if (!port) die(`no free port among ${PORTS.join(", ")}`);

  child = spawn(process.execPath, ["server.js"], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: `file:${path.join(dataDir, "custom.db")}`,
      CM_DATA_DIR: dataDir,
      CM_MODELS_DIR: path.join(dataDir, "models"),
      CM_DESKTOP: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrTailLocal = "";
  child.stderr.on("data", (c) => {
    stderrTailLocal = (stderrTailLocal + c.toString()).slice(-4000);
  });
  child.stdout.on("data", () => {});
  stderrTail = stderrTailLocal;

  // 1. config handshake - must be JSON with the right version
  const cfg = await waitForServer(port, child);
  let cfgJson = null;
  try {
    cfgJson = JSON.parse(cfg.body);
  } catch {
    throw new Error(`/api/config returned non-JSON (${cfg.type}): ${cfg.body.slice(0, 120)}`);
  }
  if (cfgJson?.version !== pkgVersion) fail(`/api/config version ${cfgJson?.version} != package.json ${pkgVersion}`);
  else note(`/api/config -> JSON, version ${cfgJson.version}, desktop=${cfgJson.desktop}`);

  // 2. upload - the module graph of the ASR stack must LOAD (hashed externals!)
  const { body: mpBody, contentType } = multipart([
    { name: "file", filename: "smoke-1s.wav", type: "audio/wav", value: oneSecondWav() },
    { name: "language", value: Buffer.from("en") },
    { name: "device", value: Buffer.from("cpu") },
    { name: "model", value: Buffer.from("tiny") },
  ]);
  const up = await post(port, "/api/upload", mpBody, contentType);
  let upJson = null;
  try {
    upJson = JSON.parse(up.body);
  } catch {
    fail(`/api/upload returned non-JSON (${up.type}): ${up.body.slice(0, 120)}`);
  }
  if (upJson?.audioId && upJson?.jobId) {
    note(`/api/upload -> JSON audioId=${upJson.audioId} jobId=${upJson.jobId}`);
  } else if (upJson?.error) {
    fail(`/api/upload answered an error: ${upJson.error}`);
  }

  // 3. job list readable
  const jobs = await get(port, "/api/jobs");
  try {
    JSON.parse(jobs.body);
    note(`/api/jobs -> JSON (${jobs.status})`);
  } catch {
    fail(`/api/jobs returned non-JSON (status=${jobs.status} type=${jobs.type}): ${jobs.body.slice(0, 120)}`);
  }
} catch (e) {
  fail(`smoke crashed: ${e?.stack || e}`);
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1500));
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // temp cleanup is best effort
  }
}

if (problems.length) {
  console.error(`\nstandalone smoke FAILED: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  FAIL  ${p}`);
  console.error("\nserver stderr tail:");
  console.error(stderrTail ? stderrTail.split("\n").map((l) => `  ${l}`).join("\n") : "  (empty)");
  process.exit(1);
}
console.log("\nstandalone smoke PASSED (isolated boot, config, upload, jobs)");
