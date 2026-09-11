// Shared helpers for the Turbopack "hashed external" problem.
//
// Turbopack (Next.js 16) keeps the packages listed in next.config.ts
// serverExternalPackages (plus @prisma/client, which Next externalizes
// automatically) OUT of the bundle and imports them at runtime under a
// hashed alias, e.g. "@huggingface/transformers-31f28a0eb9b916d1". At build
// time Next materializes each alias as a RELATIVE SYMLINK inside
// <distDir>/node_modules. Symlinks work on the dev machine but cannot be
// carried by the NSIS and MSI installers, so the packaged desktop app loses
// every alias. Every API route that imports an externalized package then
// dies at module load ("Failed to load external module ... ERR_MODULE_NOT_FOUND")
// and Next answers with a plain-text 500 "Internal Server Error", which the
// browser surfaces as "Unexpected token 'I', 'Internal s' ... is not valid
// JSON". v1.2.2 and the first v1.3.0 build shipped exactly this defect; the
// dev-machine e2e never noticed because the standalone is nested inside
// <repo>/.next there, so bare resolution walks up into the repo's
// .next/node_modules and finds the symlinks.
//
// scanChunkAliases() finds every alias actually referenced by the compiled
// chunks. materializeHashedExternals() replaces the symlink trick with real
// copies inside the standalone node_modules - the same approach that hardened
// @prisma/client since v1.2.0, generalized to every externalized package.
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

/** @prisma/client is always externalized by Next; the rest come from next.config.ts. */
export function serverExternals(root) {
  const externals = new Set(["@prisma/client"]);
  const fallback = ["@huggingface/transformers", "onnxruntime-node", "@ffmpeg-installer/ffmpeg"];
  try {
    const cfg = readFileSync(path.join(root, "next.config.ts"), "utf8");
    const m = cfg.match(/serverExternalPackages:\s*\[([^\]]*)\]/s);
    if (m) {
      for (const mm of m[1].matchAll(/["']([^"']+)["']/g)) externals.add(mm[1]);
    } else {
      fallback.forEach((p) => externals.add(p));
    }
  } catch {
    fallback.forEach((p) => externals.add(p));
  }
  return [...externals];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Scan every compiled chunk under serverDir for "<pkg>-<hash>" alias
 * references. Returns a Map: alias string -> source package name.
 */
export function scanChunkAliases(serverDir, externals) {
  const aliases = new Map();
  if (!existsSync(serverDir)) return aliases;
  const matchers = externals.map((pkg) => ({
    pkg,
    re: new RegExp(`${escapeRe(pkg)}-([a-f0-9]{8,})`, "g"),
  }));
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;
      let src = "";
      try {
        if (statSync(p).size < 64 * 1024 * 1024) src = readFileSync(p, "utf8");
      } catch {
        continue;
      }
      if (!src) continue;
      for (const { pkg, re } of matchers) {
        re.lastIndex = 0;
        for (const m of src.matchAll(re)) aliases.set(`${pkg}-${m[1]}`, pkg);
      }
    }
  };
  walk(serverDir);
  return aliases;
}

/**
 * Copy the real package into standalone/node_modules/<alias> when the alias
 * is not yet materialized there. Returns the number of copies made.
 */
export function materializeHashedExternals(standaloneNodeModules, aliases, log, warn) {
  let made = 0;
  for (const [alias, pkg] of aliases) {
    const dest = path.join(standaloneNodeModules, ...alias.split("/"));
    if (existsSync(path.join(dest, "package.json"))) continue;
    if (!existsSync(standaloneNodeModules)) {
      warn(`hashed-external hardening: ${standaloneNodeModules} missing, cannot materialize ${alias}`);
      continue;
    }
    const srcPkg = path.join(standaloneNodeModules, ...pkg.split("/"));
    if (!existsSync(srcPkg)) {
      warn(`hashed-external hardening: ${pkg} missing from standalone node_modules, cannot materialize ${alias}`);
      continue;
    }
    cpDeep(srcPkg, dest);
    log(`hashed-external hardening: materialized node_modules/${alias} (real copy of ${pkg})`);
    made++;
  }
  return made;
}

function cpDeep(src, dest) {
  // Plain recursive copy: the installed app must carry real files, never the
  // symlink trick Next uses inside <distDir>/node_modules (NSIS and MSI drop
  // symlinks, which is the exact defect this hardening exists for).
  cpSync(src, dest, { recursive: true, verbatimSymlinks: false });
}
