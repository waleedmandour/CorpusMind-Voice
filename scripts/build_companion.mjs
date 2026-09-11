// Bundle the phone companion proxy into a single dependency-free file and
// drop it into the Next.js standalone tree, which the Tauri config already
// ships as a resource (standalone/companion.cjs). Runs inside the standard
// build chain: next build -> build_companion -> copy-standalone -> check.
import { existsSync } from "fs";
import { build } from "esbuild";

const outfile = ".next/standalone/companion.cjs";
if (!existsSync(".next/standalone")) {
  console.error("build_companion: .next/standalone missing - run `next build` first");
  process.exit(1);
}

await build({
  entryPoints: ["scripts/companion.mjs"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile,
  minify: true,
  sourcemap: false,
  logLevel: "info",
});
console.log(`build_companion: wrote ${outfile}`);
