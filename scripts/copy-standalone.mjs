// Cross-platform helper: assemble the Next.js standalone distribution.
// Replaces the previous `cp -r` chain which broke the Windows build.
import { cpSync, existsSync } from "fs";
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

console.log("standalone assembled: .next/standalone");
