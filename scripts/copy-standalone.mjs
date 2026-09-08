// Cross-platform helper: assemble the Next.js standalone distribution.
// Replaces the previous `cp -r` chain which broke the Windows build.
//
// v1.1 slimming pass (desktop installers ~30-40% smaller):
//   1. python/ worker is copied into the standalone root so the desktop
//      sidecar can find it (resources/standalone is the server cwd)
//   2. .next/cache (build cache) is dropped — never needed at runtime
//   3. source maps are stripped
//   4. Prisma's non-query engines (schema/migration binaries, ~50 MB) are
//      pruned — only the query engine is used by the running app
import { cpSync, existsSync, rmSync, readdirSync, statSync, readFileSync } from "fs";
import path from "path";

const root = process.cwd();
const dotNext = path.join(root, ".next");
const standalone = path.join(dotNext, "standalone");

if (!existsSync(standalone)) {
  console.error("standalone output missing — run `next build` first");
  process.exit(1);
}

cpSync(path.join(dotNext, "static"), path.join(standalone, ".next", "static"), {
  recursive: true,
});
cpSync(path.join(root, "public"), path.join(standalone, "public"), {
  recursive: true,
});
// python worker (processor.py + export_sqlite.py + requirements.txt)
if (existsSync(path.join(root, "python"))) {
  cpSync(path.join(root, "python"), path.join(standalone, "python"), {
    recursive: true,
  });
}

// ---------------- slimming ----------------
function rmRf(p) {
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

// 2. Next.js build cache (can be hundreds of MB)
rmRf(path.join(standalone, ".next", "cache"));

// 3. strip source maps + Prisma dev engines
function walk(dir, fn) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, fn);
    else fn(p);
  }
}

let stripped = 0;
try {
  walk(standalone, (p) => {
    const base = path.basename(p);
    if (
      base.endsWith(".map") ||
      base.startsWith("libschema-engine") ||
      base.startsWith("schema-engine") ||
      base.includes("migration-engine")
    ) {
      rmRf(p);
      stripped++;
    }
  });
  // node_modules/@prisma/engines: keep only query engines + package.json
  const enginesDir = path.join(standalone, "node_modules", "@prisma", "engines");
  if (existsSync(enginesDir)) {
    for (const entry of readdirSync(enginesDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const keep =
        entry.name.startsWith("libquery_engine") ||
        entry.name === "package.json" ||
        entry.name === "index.js" ||
        entry.name === "hash.txt" ||
        entry.name.endsWith(".d.ts");
      if (!keep) {
        rmRf(path.join(enginesDir, entry.name));
        stripped++;
      }
    }
  }
  // @prisma/client/runtime: the app is SQLite-only — drop the WASM engines
  // embedded for postgres / mysql / cockroachdb / sqlserver (~50 MB)
  const runtimeDir = path.join(standalone, "node_modules", "@prisma", "client", "runtime");
  if (existsSync(runtimeDir)) {
    for (const entry of readdirSync(runtimeDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const isWasmEmbed = entry.name.includes(".wasm-base64.");
      const keepSqlite = entry.name.includes("sqlite");
      if (isWasmEmbed && !keepSqlite) {
        rmRf(path.join(runtimeDir, entry.name));
        stripped++;
      }
    }
  }
  // typescript is a build-time dependency only — never used by server.js
  rmRf(path.join(standalone, "node_modules", "typescript"));
  rmRf(path.join(standalone, "node_modules", "@prisma", "engines", "dist")); // if any
} catch (e) {
  console.warn("slimming pass warning:", e?.message ?? e);
}

// 5. repo/dev files traced into the build are never used at runtime.
//    skills/ additionally breaks WiX MSI bundling: light.exe cannot map its
//    non-cp1252 filenames (e.g. design templates with CJK names) into the
//    MSI database (LGHT0311, codepage 1252). Pruning also shrinks every
//    installer substantially (the traced repo tree was tens of MB).
const tracedJunk = [
  "skills", "docs", "design", "examples", "tests", "src", "src-tauri",
  "scripts", "mini-services", "public-splash", ".zscripts",
  "README.md", "RELEASE.md", "worklog.md", "citation.cff",
  "components.json", "bun.lock", "Caddyfile", "eslint.config.mjs",
  "next.config.ts", "postcss.config.mjs", "tailwind.config.ts",
  "tsconfig.json",
];
for (const junk of tracedJunk) rmRf(path.join(standalone, junk));

// CI residue from the Node sidecar download (repo-root artifacts that the
// tracer swept in): node.zip / node.tar.* and the extracted node-vX.Y.Z-* dir
try {
  for (const entry of readdirSync(standalone, { withFileTypes: true })) {
    if (entry.isFile() && /^node\.(zip|tar\.(gz|xz))$/.test(entry.name)) {
      rmRf(path.join(standalone, entry.name));
    } else if (
      entry.isDirectory() && /^node-v\d+\.\d+\.\d+-/.test(entry.name)
    ) {
      rmRf(path.join(standalone, entry.name));
    }
  }
} catch (e) {
  console.warn("node sidecar residue prune warning:", e?.message ?? e);
}

// ---------------------------------------------------------------------------
// 6. Prisma cross-platform hardening
//
// Two failure modes observed with Turbopack builds, both fatal at runtime
// (every API route 500s, so the desktop app boots to an empty shell):
//
//  a) Turbopack sometimes externalizes "@prisma/client" under a hashed name
//     ("@prisma/client-<hash>") and Next.js fails to materialize that package
//     in the standalone node_modules. The require then throws
//     "Failed to load external module" on first API hit.
//     Fix: scan the compiled chunks for every hashed name and materialize the
//     package as a copy of @prisma/client (whose default.js simply re-exports
//     node_modules/.prisma/client, which is already in the bundle).
//
//  b) The generated .prisma/client used to embed only the "native" query
//     engine of the BUILD machine (e.g. debian-openssl-1.1.x from the CI
//     runner), which cannot load on end-user machines (Windows/macOS/any
//     other Linux). Fixed at the source: prisma/schema.prisma now generates
//     engines for every shipping target (binaryTargets). The slimming pass
//     above keeps all libquery_engine-* / query_engine-* files, so the
//     runtime picks the right engine for the current OS automatically.
// ---------------------------------------------------------------------------
try {
  const serverDir = path.join(standalone, ".next", "server");
  const hashRe = /@prisma\/client-([a-f0-9]{8,})/g;
  const hashes = new Set();
  const scanForHashes = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { scanForHashes(p); continue; }
      if (!entry.name.endsWith(".js")) continue;
      const src = statSync(p).size < 30 * 1024 * 1024 ? readFileSync(p, "utf8") : "";
      for (const m of src.matchAll(hashRe)) hashes.add(m[1]);
    }
  };
  scanForHashes(serverDir);

  const prismaClientSrc = existsSync(path.join(standalone, "node_modules", "@prisma", "client"))
    ? path.join(standalone, "node_modules", "@prisma", "client")
    : path.join(root, "node_modules", "@prisma", "client");
  for (const hash of hashes) {
    const dest = path.join(standalone, "node_modules", "@prisma", `client-${hash}`);
    if (existsSync(dest) && existsSync(path.join(dest, "default.js"))) continue;
    if (!existsSync(prismaClientSrc)) {
      console.warn("prisma hardening: @prisma/client source missing, cannot materialize client-" + hash);
      continue;
    }
    cpSync(prismaClientSrc, dest, { recursive: true });
    console.log(`prisma hardening: materialized node_modules/@prisma/client-${hash}`);
  }
  if (hashes.size === 0) {
    console.log("prisma hardening: no hashed client references in chunks (prisma bundled inline)");
  }
} catch (e) {
  console.warn("prisma hardening warning:", e?.message ?? e);
}

function dirSize(p) {
  let total = 0;
  try {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, e.name);
      total += e.isDirectory() ? dirSize(fp) : statSync(fp).size;
    }
  } catch { /* ignore */ }
  return total;
}

console.log(
  `standalone assembled: ${standalone} (${(dirSize(standalone) / 1024 / 1024).toFixed(1)} MB, ${stripped} files pruned)`
);
