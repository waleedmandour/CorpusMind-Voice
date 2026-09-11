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
import {
  bundleTarget,
  materializeHashedExternals,
  scanChunkAliases,
  serverExternals,
  PRISMA_TARGET,
  ENGINE_MATCHERS,
} from "./lib_hashed_externals.mjs";

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
// python worker (processor.py + export_sqlite.py + requirements.txt) —
// optional accelerator, kept for hosts that have faster-whisper installed
if (existsSync(path.join(root, "python"))) {
  cpSync(path.join(root, "python"), path.join(standalone, "python"), {
    recursive: true,
  });
}

// ---------------- native inference stack (force copy) ----------------
// The tracer misses onnxruntime-node's .node binaries (loaded through nested
// require chains) and @ffmpeg-installer's platform package (dynamic require).
// Force-copy the whole packages so the standalone server always finds them.
const nativePkgs = [
  "@huggingface/transformers",
  "onnxruntime-node",
  "onnxruntime-common",
];
for (const name of nativePkgs) {
  const srcDir = path.join(root, "node_modules", name);
  const dstDir = path.join(standalone, "node_modules", name);
  if (!existsSync(srcDir)) {
    console.warn(`copy-standalone: ${name} missing from node_modules (unexpected)`);
    continue;
  }
  // the tracer can leave an INCOMPLETE copy on disk (e.g. onnxruntime_binding.node
  // without its shared library); verify the TARGET platform's native files, not
  // just the directory. Platform-agnostic: works on win/mac/linux runners and
  // for cross-compiled targets (TAURI_ENV_*).
  const tgt = bundleTarget();
  const complete = (pkg) => {
    if (pkg !== "onnxruntime-node") return true;
    const bin = path.join(dstDir, "bin", "napi-v6", tgt.platform, tgt.arch);
    if (!existsSync(bin)) return false;
    const files = readdirSync(bin);
    const hasBinding = files.some((f) => f === "onnxruntime_binding.node");
    const hasLib = files.some(
      (f) => f === "onnxruntime.dll" || f.startsWith("libonnxruntime")
    );
    return hasBinding && hasLib;
  };
  if (existsSync(dstDir) && complete(name)) continue;
  rmRf(dstDir);
  cpSync(srcDir, dstDir, { recursive: true });
  console.log(`copy-standalone: force-copied ${name}`);
}
for (const scope of ["@ffmpeg-installer"]) {
  const srcDir = path.join(root, "node_modules", scope);
  const dstDir = path.join(standalone, "node_modules", scope);
  if (existsSync(srcDir) && !existsSync(dstDir)) {
    cpSync(srcDir, dstDir, { recursive: true });
    console.log(`copy-standalone: force-copied ${scope}`);
  }
}

// ---------------- slimming ----------------
function rmRf(p) {
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

// onnxruntime-node ships every platform AND architecture (~210 MB total).
// Whether the copy arrived via the tracer or the force-copy above, keep only
// the bundle TARGET's platform + arch (desktop bundles are built per target;
// cross-compiled targets come from TAURI_ENV_*).
try {
  const tgt = bundleTarget();
  const ortBin = path.join(standalone, "node_modules", "onnxruntime-node", "bin", "napi-v6");
  if (existsSync(ortBin)) {
    for (const p of readdirSync(ortBin)) {
      const platDir = path.join(ortBin, p);
      if (!readdirSync(platDir).length && !statSync(platDir).isDirectory()) continue;
      if (p !== tgt.platform) {
        rmRf(platDir);
        console.log(`copy-standalone: pruned onnxruntime platform ${p} (target: ${tgt.platform})`);
        continue;
      }
      for (const a of readdirSync(platDir)) {
        if (a !== tgt.arch) {
          rmRf(path.join(platDir, a));
          console.log(`copy-standalone: pruned onnxruntime arch ${p}/${a} (target: ${tgt.arch})`);
        }
      }
    }
  }
} catch (e) {
  console.warn("onnxruntime prune warning:", e?.message ?? e);
}

// @ffmpeg-installer ships a binary for every platform/arch (~66 MB).
// Keep the resolver package plus only the bundle TARGET's binary.
try {
  const tgt = bundleTarget();
  const ffDir = path.join(standalone, "node_modules", "@ffmpeg-installer");
  const want = `${tgt.platform}-${tgt.arch}`;
  if (existsSync(ffDir)) {
    for (const entry of readdirSync(ffDir, { withFileTypes: true })) {
      if (entry.name === "ffmpeg" || entry.name === want) continue;
      if (entry.isDirectory() && /^[a-z0-9]+-[a-z0-9_]+$/.test(entry.name)) {
        rmRf(path.join(ffDir, entry.name));
        console.log(`copy-standalone: pruned ffmpeg platform ${entry.name} (target: ${want})`);
      }
    }
  }
} catch (e) {
  console.warn("ffmpeg prune warning:", e?.message ?? e);
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
// 6. Turbopack hashed-external materialization (ALL externalized packages)
//
// Failure mode observed with Turbopack builds, fatal at runtime: Turbopack
// imports the packages in next.config.ts serverExternalPackages (plus
// @prisma/client, externalized automatically) under a hashed alias
// ("@huggingface/transformers-31f28a0eb9b916d1") and materializes each alias
// as a RELATIVE SYMLINK inside <distDir>/node_modules. Symlinks work on the
// dev machine but cannot be carried by the NSIS and MSI installers, so the
// packaged desktop app loses every alias: the first API hit that imports an
// externalized package throws "Failed to load external module ...
// ERR_MODULE_NOT_FOUND" and Next answers a plain-text 500 "Internal Server
// Error". v1.2.2 and the first v1.3.0 build shipped exactly this defect
// (field report: "Unexpected token 'I', 'Internal s' ... is not valid JSON").
// The dev-machine e2e never noticed because the standalone runs nested inside
// <repo>/.next, so bare resolution walks up into the repo's
// .next/node_modules and finds the symlinks.
//
// Fix: scan the compiled chunks for every "<pkg>-<hash>" alias of every
// externalized package and materialize the package as a REAL COPY in the
// standalone node_modules (the approach that hardened @prisma/client since
// v1.2.0, now generalized). The symlink forest is deleted from the standalone
// so the installers never carry a half-broken variant of it.
//
// Prisma engine cross-platform loading (the other half of the old prisma
// hardening) stays solved at the source: prisma/schema.prisma generates
// engines for every shipping target (binaryTargets) and the slimming pass
// below keeps every libquery_engine-* the current OS can pick from.
// ---------------------------------------------------------------------------
try {
  const serverDir = path.join(standalone, ".next", "server");
  const externals = serverExternals(root);
  const aliases = scanChunkAliases(serverDir, externals);
  // NSIS and MSI cannot carry symlinks: whatever Next materialized as links
  // would vanish (or break) inside the installers. Real copies only.
  rmRf(path.join(standalone, ".next", "node_modules"));
  const made = materializeHashedExternals(
    path.join(standalone, "node_modules"),
    aliases,
    (msg) => console.log(msg),
    (msg) => console.warn(msg)
  );
  if (aliases.size === 0) {
    console.log("hashed-external hardening: no hashed alias references in chunks (externals bundled inline)");
  } else if (made === 0) {
    console.log(`hashed-external hardening: ${aliases.size} alias(es) already materialized`);
  }
} catch (e) {
  console.warn("hashed-external hardening warning:", e?.message ?? e);
}

// ---------------------------------------------------------------------------
// 7. Per-target query-engine pruning.
//
// prisma/schema.prisma declares every shipping binaryTargets so any platform
// can load its engine. Linux keeps BOTH debian flavors: the generated
// client's baked default engine is environment-dependent (generation under
// Bun reports debian-openssl-1.1.x on the CI runners), and end-user Linux
// spans both openssl generations. Windows keeps the windows engine; macOS
// keeps the darwin flavor matching the bundle target (TAURI_ENV_* aware, so
// the Intel dmg cross-compiled on an arm64 runner prunes for x64). Desktop
// bundles are built natively per target runner, so the build platform IS
// the target for windows/linux; the wasm fallback stays (small, keeps
// exotic setups loadable).
// ---------------------------------------------------------------------------
try {
  const tgt = bundleTarget();
  const prismaTarget = (PRISMA_TARGET[tgt.platform] ?? {})[tgt.arch];
  const matches = prismaTarget ? ENGINE_MATCHERS[prismaTarget] : null;
  if (matches) {
    walk(path.join(standalone, "node_modules"), (p) => {
      const base = path.basename(p);
      const isNativeEngine = /^(lib)?query_engine-/.test(base) && !base.includes("bg");
      if (!isNativeEngine) return;
      if (matches(base)) return;
      rmRf(p);
      stripped++;
      console.log(`copy-standalone: pruned non-target engine ${base} (target: ${prismaTarget})`);
    });
  } else {
    console.warn(`copy-standalone: unknown bundle target ${tgt.platform}-${tgt.arch}, keeping all Prisma engines`);
  }
} catch (e) {
  console.warn("prisma engine prune warning:", e?.message ?? e);
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
