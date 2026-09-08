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
import { cpSync, existsSync, rmSync, readdirSync, statSync } from "fs";
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
