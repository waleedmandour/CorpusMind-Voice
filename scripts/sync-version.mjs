// Single source of truth for version strings.
//
// The version used to be hand-bumped across six files and has already drifted
// once (user guides said 1.2.0 while the app shipped 1.2.1). This script:
//
//   node scripts/sync-version.mjs            write package.json's version into
//                                            every dependent file
//   node scripts/sync-version.mjs --check    verify all files agree; exit 1
//                                            and list any drift (CI gate)
//   node scripts/sync-version.mjs --date 2026-09-10
//                                            also update citation.cff's
//                                            date-released (use at release time)
//
// package.json is the source of truth; everything else is derived.
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const dateIdx = process.argv.indexOf("--date");
const releaseDate = dateIdx > -1 ? process.argv[dateIdx + 1] : null;

const pkgPath = path.join(root, "package.json");
const version = JSON.parse(readFileSync(pkgPath, "utf8")).version;
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`package.json version "${version}" is not a plain semver - fix it first`);
  process.exit(1);
}

const edits = [
  {
    file: "src-tauri/tauri.conf.json",
    label: "Tauri config",
    apply: (src) => src.replace(/("version":\s*")\d+\.\d+\.\d+(-[\w.]+)?(")/, `$1${version}$3`),
    verify: (src) => new RegExp(`"version":\\s*"${version.replace(/\./g, "\\.")}"`).test(src),
  },
  {
    file: "src-tauri/Cargo.toml",
    label: "Cargo package version",
    apply: (src) => src.replace(/(^version\s*=\s*")\d+\.\d+\.\d+(-[\w.]+)?(")/m, `$1${version}$3`),
    verify: (src) => new RegExp(`^version\\s*=\\s*"${version.replace(/\./g, "\\.")}"`, "m").test(src),
  },
  {
    // only if the lockfile is committed; regenerate with cargo otherwise
    file: "src-tauri/Cargo.lock",
    label: "Cargo lock entry",
    optional: true,
    apply: (src) =>
      src.replace(
        /(\[\[package\]\]\r?\nname = "corpusmind-voice"\r?\nversion = ")\d+\.\d+\.\d+(-[\w.]+)?(")/,
        `$1${version}$3`
      ),
    verify: (src) =>
      new RegExp(
        `\\[\\[package\\]\\]\\r?\\nname = "corpusmind-voice"\\r?\\nversion = "${version.replace(/\./g, "\\.")}"`
      ).test(src),
  },
  {
    file: "citation.cff",
    label: "CITATION.cff metadata",
    apply: (src) => {
      let out = src.replace(/(^  version:\s*")\d+\.\d+\.\d+(")/m, `$1${version}$2`);
      out = out.replace(
        /(Zenodo \(Software, Version )\d+\.\d+\.\d+(\))/,
        `$1${version}$2`
      );
      if (releaseDate) {
        out = out.replace(/(^date-released:\s*")\d{4}-\d{2}-\d{2}(")/m, `$1${releaseDate}$2`);
      }
      return out;
    },
    verify: (src) =>
      new RegExp(`^  version:\\s*"${version.replace(/\./g, "\\.")}"`, "m").test(src) &&
      new RegExp(`Zenodo \\(Software, Version ${version.replace(/\./g, "\\.")}\\)`).test(src),
  },
  {
    file: "docs/user-guide-en.md",
    label: "User guide (EN) header",
    apply: (src) => src.replace(/^(\*\*Version )\d+\.\d+\.\d+( · .*)$/m, `$1${version}$2`),
    verify: (src) =>
      new RegExp(`^\\*\\*Version ${version.replace(/\./g, "\\.")} · `, "m").test(src),
  },
  {
    file: "docs/user-guide-ar.md",
    label: "User guide (AR) header",
    apply: (src) => src.replace(/^(\*\*الإصدار )\d+\.\d+\.\d+( · .*)$/m, `$1${version}$2`),
    verify: (src) =>
      new RegExp(`^\\*\\*الإصدار ${version.replace(/\./g, "\\.")} · `, "m").test(src),
  },
  {
    file: "docs/user-guide-en.html",
    label: "User guide (EN) PDF source",
    apply: (src) => src.replace(/(Version )\d+\.\d+\.\d+( · Page )/g, `$1${version}$2`)
      .replace(/(<span class="chip">Version )\d+\.\d+\.\d+(<\/span>)/g, `$1${version}$2`),
    verify: (src) =>
      !/Version \d+\.\d+\.\d+/.test(src.replace(new RegExp(`Version ${version.replace(/\./g, "\\.")}`, "g"), "")),
  },
  {
    file: "README.md",
    label: "README version badge, APA and BibTeX citations",
    // Strictly scoped to CorpusMind Voice strings: the badge (and its
    // release link), the Voice APA citation line and the Voice BibTeX
    // entry. The parent CorpusMind citation (its own version, DOI
    // 10.5281/zenodo.21226650) must NEVER be touched by this rule.
    apply: (src) => {
      let out = src.replace(
        /(img\.shields\.io\/badge\/version-)\d+\.\d+\.\d+(-[\w.]+)?(-amber\.svg\)\]\(https:\/\/github\.com\/waleedmandour\/CorpusMind-Voice\/releases\/tag\/v)\d+\.\d+\.\d+(-[\w.]+)?(\))/,
        `$1${version}$3${version}$5`
      );
      out = out
        .split("\n")
        .map((line) =>
          line.includes("CorpusMind Voice") || line.includes("CorpusMindVoice")
            ? line.replace(/(\(Version )\d+\.\d+\.\d+(-[\w.]+)?(\) \[Computer software\])/, `$1${version}$3`)
            : line
        )
        .join("\n");
      out = out.replace(
        /(@software\{Mandour_CorpusMindVoice_2026,[\s\S]*?version\s*=\s*\{)\d+\.\d+\.\d+(-[\w.]+)?(\})/,
        `$1${version}$3`
      );
      return out;
    },
    verify: (src) =>
      src.includes(`badge/version-${version}`) &&
      src.includes(`releases/tag/v${version})`) &&
      new RegExp(
        `CorpusMind Voice:.*\\(Version ${version.replace(/\./g, "\\.")}\\) \\[Computer software\\]`
      ).test(src) &&
      new RegExp(
        `@software\\{Mandour_CorpusMindVoice_2026,[\\s\\S]*?version\\s*=\\s*\\{${version.replace(/\./g, "\\.")}\\}`
      ).test(src),
  },
  {
    file: "RELEASE.md",
    label: "Release notes header, installer table and citation line",
    apply: (src) =>
      src
        .replace(/^# CorpusMind Voice v\S+/, `# CorpusMind Voice v${version}`)
        .replace(/CorpusMind\.Voice_\d+\.\d+\.\d+_/g, `CorpusMind.Voice_${version}_`)
        .replace(/\(Version \d+\.\d+\.\d+\) \[Computer software\]/, `(Version ${version}) [Computer software]`),
    verify: (src) =>
      src.startsWith(`# CorpusMind Voice v${version}`) &&
      new RegExp(`CorpusMind\\.Voice_${version.replace(/\./g, "\\.")}_`).test(src),
  },
  {
    // The in-app About/Citation card carries its own APA line and BibTeX entry
    // in BOTH language dictionaries. These drifted to 1.2.0 during the first
    // v1.3.0 build (field report: "version points to 1.2.0 while named as
    // v1.3.0") because the strings were hand-maintained. Managed here since.
    file: "src/lib/i18n.ts",
    label: "In-app About citations (APA + BibTeX, EN and AR dicts)",
    apply: (src) =>
      src
        .split("\n")
        .map((line) =>
          line.includes("CorpusMind Voice") || line.includes("CorpusMindVoice")
            ? line
                .replace(/(\(Version )\d+\.\d+\.\d+(-[\w.]+)?(\) \[Computer software\])/g, `$1${version}$3`)
                .replace(/(version\s*=\s*\{)\d+\.\d+\.\d+(-[\w.]+)?(\})/g, `$1${version}$3`)
            : line
        )
        .join("\n"),
    verify: (src) => {
      const vv = version.replace(/\./g, "\\.");
      // Scope to CorpusMind Voice lines ONLY: the i18n About dict also cites
      // the PARENT CorpusMind (its own version, DOI 10.5281/zenodo.21226650),
      // which this rule must never touch (same scoping as the README rule).
      const voiceOnly = src
        .split("\n")
        .filter((l) => l.includes("CorpusMind Voice") || l.includes("CorpusMindVoice"))
        .join("\n");
      const apa = (voiceOnly.match(new RegExp(`\\(Version ${vv}\\) \\[Computer software\\]`, "g")) || []).length;
      const bib = (voiceOnly.match(new RegExp(`version\\s*=\\s*\\{${vv}\\}`, "g")) || []).length;
      const stripped =
        voiceOnly.replace(new RegExp(`\\(Version ${vv}\\) \\[Computer software\\]`, "g"), "")
          .replace(new RegExp(`version\\s*=\\s*\\{${vv}\\}`, "g"), "");
      const stale =
        /\(Version \d+\.\d+\.\d+\) \[Computer software\]/.test(stripped) ||
        /version\s*=\s*\{\d+\.\d+\.\d+\}/.test(stripped);
      return apa >= 2 && bib >= 2 && !stale;
    },
  },
];

let drifted = 0;
let changed = 0;

for (const edit of edits) {
  const filePath = path.join(root, edit.file);
  if (!existsSync(filePath)) {
    if (edit.optional) continue;
    console.error(`MISSING  ${edit.file}`);
    drifted++;
    continue;
  }
  const src = readFileSync(filePath, "utf8");
  if (edit.verify(src)) {
    console.log(`ok       ${edit.file} (${edit.label})`);
    continue;
  }
  if (checkOnly) {
    console.error(`DRIFT    ${edit.file} (${edit.label}) does not carry version ${version}`);
    drifted++;
    continue;
  }
  const next = edit.apply(src);
  if (!edit.verify(next)) {
    console.error(`ERROR    ${edit.file}: automated update failed - fix manually`);
    drifted++;
    continue;
  }
  writeFileSync(filePath, next);
  console.log(`updated  ${edit.file} (${edit.label}) -> ${version}`);
  changed++;
}

if (drifted > 0) {
  console.error(
    checkOnly
      ? `\nversion check FAILED: ${drifted} file(s) disagree with package.json (${version}). Run \`npm run version:sync\` to fix.`
      : `\nversion sync finished with ${drifted} error(s).`
  );
  process.exit(1);
}
console.log(
  checkOnly
    ? `\nversion check PASSED: every version string agrees on ${version}`
    : `\nversion sync complete: ${changed} file(s) updated to ${version}`
);
