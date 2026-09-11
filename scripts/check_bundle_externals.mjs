// Verifies the assembled Next.js standalone bundle contains every external
// native dependency the server needs at runtime, in the variant that matches
// the CURRENT build platform. Run after `bun run build`:
//
//   node scripts/check_bundle_externals.mjs [--standalone .next/standalone]
//
// Exit code 0 = bundle is loadable; 1 = anything missing or mismatched.
// Background: a CI-green build once shipped a shell whose every API route
// returned 500 because a native external never made it into node_modules
// (worklog v1.2.0, Task 8). This script is the guard against a repeat.
import { existsSync, readdirSync } from "fs";
import path from "path";
import { scanChunkAliases, serverExternals } from "./lib_hashed_externals.mjs";

const root = process.cwd();
const standaloneArg = process.argv.indexOf("--standalone");
const standalone = path.isAbsolute(standaloneArg > -1 ? process.argv[standaloneArg + 1] : "")
  ? process.argv[standaloneArg + 1]
  : path.join(root, standaloneArg > -1 ? process.argv[standaloneArg + 1] : ".next/standalone");

const problems = [];
const notes = [];
const ok = (msg) => notes.push(`  ok    ${msg}`);
const bad = (msg) => problems.push(`  FAIL  ${msg}`);
const must = (cond, msg) => (cond ? ok(msg) : bad(msg));

/** true when the directory tree contains at least one .js/.cjs/.mjs file */
function dirHasCode(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (dirHasCode(fp)) return true;
    } else if (/\.(c|m)?js$/.test(e.name)) {
      return true;
    }
  }
  return false;
}

if (!existsSync(standalone)) {
  console.error(`standalone bundle not found at ${standalone} - run \`bun run build\` first`);
  process.exit(1);
}

const nm = path.join(standalone, "node_modules");
const platform = process.platform;
const arch = process.arch;

console.log(`checking bundle: ${standalone}`);
console.log(`build platform: ${platform}-${arch}\n`);

// 1. Prisma client + query engine ------------------------------------------------
const prismaClient = path.join(nm, "@prisma", "client");
must(existsSync(path.join(prismaClient, "package.json")), "@prisma/client present");

const hashedClients = existsSync(nm)
  ? readdirSync(nm, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^client-[a-f0-9]{8,}$/.test(e.name) && e.name.startsWith("client-"))
      .map((e) => `@prisma/${e.name}`)
  : [];
for (const h of ["@prisma/client", ...hashedClients]) {
  const hasDefault = existsSync(path.join(nm, ...h.split("/"), "default.js"));
  must(hasDefault, `${h} materialized with default.js (hashed external fix)`);
}

const prismaDirs = [
  path.join(nm, ".prisma", "client"),
  path.join(nm, "@prisma", "engines"),
];
const PRISMA_TARGET = {
  linux: { x64: "debian-openssl-3.0.x", arm64: "debian-openssl-3.0.x" },
  darwin: { x64: "darwin", arm64: "darwin-arm64" },
  win32: { x64: "windows", arm64: "windows" },
}[platform]?.[arch];
const ENGINE_MATCHERS = {
  "debian-openssl-3.0.x": (n) => n.includes("debian-openssl-3.0"),
  darwin: (n) => n.includes("darwin") && !n.includes("darwin-arm64"),
  "darwin-arm64": (n) => n.includes("darwin-arm64"),
  windows: (n) => n.includes("windows"),
};

let engines = [];
for (const dir of prismaDirs) {
  if (!existsSync(dir)) continue;
  engines.push(
    ...readdirSync(dir).filter((f) => /^(lib)?query_engine-/.test(f) && !f.includes("bg"))
  );
}
engines = [...new Set(engines)];
if (PRISMA_TARGET && ENGINE_MATCHERS[PRISMA_TARGET]) {
  const matching = engines.filter(ENGINE_MATCHERS[PRISMA_TARGET]);
  const foreign = engines.filter((e) => !ENGINE_MATCHERS[PRISMA_TARGET](e));
  must(matching.length === 1, `exactly one ${PRISMA_TARGET} query engine present (${engines.join(", ") || "none"})`);
  must(foreign.length === 0, `no foreign engines bundled (found: ${foreign.join(", ") || "none"})`);
} else {
  notes.push(`  note  unknown target ${platform}-${arch}: skipping engine match checks`);
}
must(
  existsSync(path.join(nm, ".prisma", "client", "query_engine_bg.wasm")) ||
    true,
  "wasm fallback presence is optional"
);

// 2. onnxruntime-node (Whisper inference) ----------------------------------------
const ort = path.join(nm, "onnxruntime-node");
must(existsSync(path.join(ort, "package.json")), "onnxruntime-node present");
const ortBin = path.join(ort, "bin", "napi-v6");
if (existsSync(ortBin)) {
  const plats = readdirSync(ortBin);
  must(plats.length === 1 && plats[0] === platform, `onnxruntime keeps only ${platform} (found: ${plats.join(", ")})`);
  const archs = existsSync(path.join(ortBin, platform)) ? readdirSync(path.join(ortBin, platform)) : [];
  must(archs.length === 1 && archs[0] === arch, `onnxruntime keeps only ${arch} (found: ${archs.join(", ")})`);
  const binDir = path.join(ortBin, platform, arch);
  const files = existsSync(binDir) ? readdirSync(binDir) : [];
  must(files.includes("onnxruntime_binding.node"), "onnxruntime_binding.node present");
  must(
    files.some((f) => f === "onnxruntime.dll" || f.startsWith("libonnxruntime")),
    "onnxruntime shared library present"
  );
} else {
  bad("onnxruntime-node/bin/napi-v6 missing entirely");
}

// 3. @ffmpeg-installer (container decoding) ---------------------------------------
const ff = path.join(nm, "@ffmpeg-installer");
if (existsSync(ff)) {
  const want = `${platform}-${arch}`;
  const entries = readdirSync(ff, { withFileTypes: true }).map((e) => e.name);
  must(entries.includes("ffmpeg"), "@ffmpeg-installer/ffmpeg resolver present");
  const foreign = entries.filter((e) => {
    if (e === "ffmpeg" || e === want) return false;
    // hashed alias copies (materialized external, see check 5) live in this
    // scope too and are verified there - not foreign platform binaries
    if (/^ffmpeg-[a-f0-9]{8,}$/.test(e)) return false;
    return true;
  });
  must(foreign.length === 0, `no foreign ffmpeg binaries (found: ${foreign.join(", ") || "none"})`);
  const pkgJson = path.join(ff, want, "package.json");
  must(existsSync(pkgJson), `@ffmpeg-installer/${want} present`);
  // The platform package layout differs per OS: linux ships `ffmpeg`,
  // windows ships `ffmpeg.exe`, and there is no stable "binary" metadata
  // field - so look for the executable itself.
  const platDir = path.join(ff, want);
  const binFile = existsSync(platDir)
    ? readdirSync(platDir).find((f) => /^ffmpeg(\.exe)?$/i.test(f))
    : null;
  must(!!binFile, `ffmpeg binary file present (${binFile ?? "not found"})`);
} else {
  bad("@ffmpeg-installer missing entirely");
}

// 4. transformers.js (model runtime) ----------------------------------------------
must(
  existsSync(path.join(nm, "@huggingface", "transformers", "package.json")),
  "@huggingface/transformers present"
);

// 5. Turbopack hashed externals ----------------------------------------------------
// The first v1.3.0 build shipped a fatal packaging defect this check is
// designed to catch: Turbopack imports externalized packages under hashed
// aliases ("@huggingface/transformers-<hash>") that it materializes as
// SYMLINKS in <distDir>/node_modules. The dev machine resolves them, but the
// NSIS and MSI installers cannot carry symlinks, so the installed app lost
// every alias and every API route importing the ASR stack answered a
// plain-text 500. copy-standalone.mjs now materializes each alias as a real
// copy in the standalone node_modules; assert every referenced alias is
// really there and carries loadable code.
const serverDir = path.join(standalone, ".next", "server");
const externals = serverExternals(root);
const aliases = scanChunkAliases(serverDir, externals);
if (aliases.size === 0) {
  ok("no hashed external aliases referenced in chunks (externals bundled inline)");
} else {
  for (const [alias, pkg] of aliases) {
    const aliasDir = path.join(nm, ...alias.split("/"));
    const hasPkgJson = existsSync(path.join(aliasDir, "package.json"));
    must(hasPkgJson, `hashed external materialized as a real copy: ${alias}`);
    if (hasPkgJson) {
      must(dirHasCode(aliasDir), `${alias} carries loadable code`);
    } else {
      bad(`${alias} is referenced by chunks but missing from standalone node_modules (packaged app would 500)`);
    }
  }
  ok(`${aliases.size} hashed alias(es) verified against ${externals.length} external package(s)`);
}

// report --------------------------------------------------------------------------
console.log(notes.join("\n"));
if (problems.length) {
  console.error(`\n${problems.join("\n")}`);
  console.error(`\nbundle check FAILED: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("\nbundle check PASSED");
