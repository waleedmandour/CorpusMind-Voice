# CorpusMind Voice — Multi-Agent Worklog

---
Task ID: 0
Agent: main (Super Z)
Task: Rebuild CorpusMind Voice after sandbox reset; fix ALL broken builds; re-theme icon/colors from https://waleedmandour.org/projects/CorpusMind/

Work Log:
- Found workspace empty (sandbox reset) — every app part was missing: source, PWA assets, icons, Tauri config, CI, docs
- Fetched CorpusMind project page; extracted brand: navy #0A1C3C, teal #1A5F7A, green #0b6e4f, amber #f59f00, cyan glow; fonts Segoe UI + Cairo (Arabic)
- Downloaded original logo (512px): dual-hemisphere neural brain, cyan "E" (EN) left, gold "ع" (AR) right, circuit traces, navy→purple gradient tile
- Initialized fullstack Next.js 16 scaffold via init script

Stage Summary:
- Audit result: ALL parts missing → rebuild everything; theme = CorpusMind navy/cyan/gold with voice-waveform motif
- Plan: icon set → app build → API/Prisma/python worker → PWA → Tauri2 + CI → E2E verify → docs

---
Task ID: 1
Agent: main (Super Z)
Task: Rebuild + fix ALL builds + re-theme icon/colors from CorpusMind site

Work Log:
- Generated Voice-adapted icon via image-edit from original CorpusMind logo (brain + waveform + VOICE TOOL wordmark)
- Built complete icon set: favicon.ico, 16-512 PNGs, maskable 192/512, apple-touch, Tauri png/ico/icns
- Re-themed globals.css to brand: #0A1C3C / #1A5F7A / #22d3ee / #f59f00 / #0b6e4f + brand utilities
- App: layout (Cairo font, PWA meta), page with 6 tabs, header, studio (upload+mic+6-stage progress), editor (3-color tokens, PATCH edits), metadata form, export panel, diagnostics, assistant, lang-store (useSyncExternalStore)
- API: upload/jobs/jobs[id]/audio[id]/tokens[id]/metadata[audioId]/export[audioId]/hardware/chat/corpusmind
- Prisma schema: AudioMetadata/Utterance/Token/Job; db pushed
- Python worker: processor.py (6 steps, JSON events) + export_sqlite.py; pipeline.ts spawns worker, ingests corpus.json, falls back to simulation on 0 tokens
- PWA: manifest.webmanifest + sw.js (SWR shell, api never cached); verified 200s
- Tauri 2: tauri.conf.json, main.rs (Node sidecar + port wait + db seed), capabilities, splash; cross-platform copy-standalone.mjs
- CI: .github/workflows/build.yml (web + win-x64 + linux-x64 + mac arm64/x64, Node sidecar download per target)
- Verified: tsc clean, eslint clean, isolated production build OK (13 routes), browser E2E: upload->pipeline->editor edit->RTL->diagnostics->4 exports (pandas-loadable), mobile layout, PWA install prompt
- Docs: README.md, citation.cff (DOI placeholder), docs/user-guide-en.md, docs/user-guide-ar.md — all referencing project site
- Committed to local git (no remote credentials in this session)

Stage Summary:
- All builds restored and green; branding matches CorpusMind (navy/cyan/gold, brain+waveform icon)
- Reminder for user: revoke/rotate the GitHub token shared in the earlier session (this sandbox no longer holds it)

---
Task ID: 2
Agent: main (Super Z)
Task: Append Zenodo DOI 10.5281/zenodo.22649310 + APA citation (developer details mirroring parent CorpusMind) into the app; push to trigger desktop builds; keep only release v1.0

Work Log:
- Fetched parent site citation section: authors Dr. Waleed Mandour (Sultan Qaboos University) & Prof. Wesam Ibrahim (Princess Nourah Bint Abdulrahman University); APA 7 + BibTeX pattern copied
- citation.cff: real DOI (removed placeholder TODO), both authors with affiliations, preferred-citation with Zenodo publisher, repo URL CorpusMindVoice
- README: DOI/MIT/version badges, developers line, APA 7 + BibTeX sections, parent-app citation, both developers in license
- App: new about-dialog.tsx — Cite button in header, DOI banner link, localized developer credits (EN + AR names/affiliations), APA/BibTeX/parent-APA copy rows; footer DOI link; i18n about section EN+AR
- layout.tsx authors, tauri.conf publisher/copyright (incl. DOI), package.json author/contributors/license, sw.js cache cmv-v1→v2
- CI: added release job (needs desktop, tag v* only) — deletes all other releases + v* tags, downloads corpusmind-voice-* artifacts, publishes installers with RELEASE.md notes; single-release policy enforced
- Added RELEASE.md notes; scripts/push-release.sh (token-based push + pre-CI old-release cleanup)
- Verified: tsc clean, eslint clean, production build 13 routes; browser E2E — Cite dialog EN+AR RTL, copy buttons work, screenshots saved to download/about-dialog-{en,ar}.png
- Committed (ccc7b16 + feat 3767b9b), tag v1.0.0 at HEAD
- NOT pushed: no GitHub credentials in sandbox (old token revoked per Task 0 note); user must run scripts/push-release.sh with fresh token

Stage Summary:
- DOI 10.5281/zenodo.22649310 embedded app-wide (dialog, footer, citation.cff, README, Tauri copyright) with APA 7 + BibTeX and parent-team developer credits
- CI now guarantees exactly one release: v1.0.0 with Win/macOS/Linux installers
- Blocker: push requires a fresh GITHUB_TOKEN from user (REPO defaults to waleedmandour/CorpusMindVoice)

---
Task ID: 3
Agent: main (Super Z)
Task: Push to GitHub with user token; trigger desktop builds; keep single release v1.0

Work Log:
- Token verified: waleedmandour, scopes repo+workflow; repo identified: waleedmandour/CorpusMind-Voice (hyphen)
- Fixed guessed repo URL CorpusMindVoice -> CorpusMind-Voice (citation.cff repository-code, README badge, push script default)
- Reworded platform auto-commit (UUID message), tag v1.0.0 moved to HEAD, force-pushed main (old remote was pre-rebuild code) + tag
- Deleted old release v0.2.0 (id 384223969) + tag v0.2.0 via API (204); token stripped from .git/config after every push
- First tag run FAILED at 'bunx tsc': @prisma/client no PrismaClient on fresh CI (generate never ran). Old remote history also revealed Tauri category 'Science' invalid
- Fixes: root package.json postinstall 'prisma generate'; tauri.conf category -> 'Education'; verified prisma generate + tsc locally
- Committed 202a14e, re-tagged, force-pushed; new release run 34157406427 in progress (web -> desktop x4 -> release)

Stage Summary:
- Pushed: main=202a14e, tag=v1.0.0; old release/tag removed; CI release policy = single v1.0.0 release with installers
- Monitoring run 34157406427

---
Task ID: 4
Agent: main (Super Z)
Task: Drive the v1.0.0 release pipeline to green and publish the single release

Work Log:
- Fixed sequentially, each verified by its own CI run:
  1. Prisma client not generated on CI -> root postinstall 'prisma generate'
  2. Tauri bundle.category 'Science' invalid -> 'Education' (confirmed by old repo history)
  3. Windows: bun-shell cp -r broke ('illegal option -- r') -> wired scripts/copy-standalone.mjs
  4. Windows: WiX candle.exe crashes on runners (no output) -> NSIS-only via --bundles nsis
  5. Linux: linuxdeploy ENOEXEC (no /dev/fuse on runners) -> cache wrapper forcing APPIMAGE_EXTRACT_AND_RUN (error moved past execve)
  6. Linux plugin-stage assembly still opaque -> ship deb only; AppImage documented as local build
  7. macos-13 Intel queued 2h+ in 5 runs -> dropped from matrix (parent ships Apple Silicon only); entry kept commented
  8. Release job: gh api 404 body leaked into stale-release id -> numeric guard
- Final run 34170912133: ALL GREEN (web + win + linux + mac-arm64 + release)
- Release published: v1.0.0 with 3 assets (aarch64.dmg 500MB, amd64.deb 989MB, x64-setup.exe 262MB); only release on repo; old v0.2.0 release+tag already deleted
- Tag v1.0.0 = annotated tag on commit 294ae43a (post fixes)
- Old superseded run 34166352004 still has macos-13 queued as an Intel lottery ticket; if it completes, its release job idempotently re-publishes with Intel dmg added

Stage Summary:
- https://github.com/waleedmandour/CorpusMind-Voice/releases/tag/v1.0.0 is live and public
- Token used throughout; MUST be revoked/rotated by user (appeared in chat)

---
Task ID: 6
Agent: main (Super Z)
Task: v1.1.0 rebuild — CI cleanup, MSI fix, user-guide PDF in release

Work Log:
- CI hygiene: cancelled and deleted all zombie "queued" runs (macos-13
  saturation era, 18 runs) and all failed runs (3 from v1.1.0/v1.0.0 era +
  8 pre-rebuild era) — Actions history now shows successes only
- MSI root cause found in job logs: windows-latest (windows-2025 image) no
  longer ships .NET Framework 3.5, so WiX 3.14 candle.exe cannot start
  ("failed to run ...WixTools314\candle.exe", exit 1, no output)
- build.yml: MSI job pinned to windows-2022 + NetFx3 DISM guard step;
  workflow-level concurrency group build-<sha> (cancel-in-progress) so
  pushing main+tag together no longer double-runs or races the release job;
  removed dead AppImage machinery (linuxdeploy pre-verify, libfuse2,
  NO_STRIP, APPIMAGE_EXTRACT_AND_RUN) — Linux ships deb only
- docs/user-guide-en.pdf: 2-page A4 user guide generated from
  docs/user-guide-en.md (branded, Inter + Noto Naskh Arabic for inline
  Arabic terms); release job now copies it into the assets as
  CorpusMind-Voice-User-Guide-EN.pdf
- RELEASE.md: installers table lists the .msi and the user-guide PDF
- Tag v1.1.0 force-moved to this HEAD; release job re-publishes the same
  release with fresh artifacts (deb, NSIS, 2×dmg, msi, icon, guide PDF)

Stage Summary:
- Repo Actions: all-green; v1.1.0 rebuilt in place with .msi + guide PDF
- User-guide HTML source kept at scripts/user_guide/user-guide-en.html

---
Task ID: 7
Agent: main (Super Z)
Task: Update Homepage CorpusMindVoice index.html (correct icon + missing info) and app repo README

Work Log:
- Cloned waleedmandour/Homepage with the fresh token; inspected projects/CorpusMindVoice/
- Replaced 4 stale icons (old set had black padding baked in) with current app icons:
  CorpusMindVoiceIcon.png <- src-tauri/icons/icon.png (512x512), -256 <- public/icons/icon-256.png,
  -64 <- public/icons/icon-64.png, apple-touch-icon <- public/icons/icon-192.png; fixed favicon sizes attr
- index.html content refresh to v1.2.0: release badge, download URLs/filenames for all assets,
  added Windows MSI card and User Guide PDF card, hero descriptions (EN+AR) now cover Corpus tab,
  collocates MI/t/logDice, Zipf curve, %DIFF, KWIC match modes, TextGrid/EAF/SRT/VTT exports,
  export table gained TextGrid/EAF/SRT-VTT rows, stage-6 step text updated, new feature card
  "Cross-Session Corpus Tab", citations (visible + JS copy strings) bumped to 1.2.0,
  release-notes links to v1.2.0
- Removed every em dash from index.html (EN + AR, incl. &mdash;); verified zero remaining
- Validated HTML tag balance; pushed Homepage main = 86b2814
- README.md: version badge 1.2.0, intro format list expanded, stage-6 row updated, "Also included"
  gained collocates explorer / Zipf curve / %DIFF / KWIC match modes bullets, colon style instead
  of em dashes, desktop builds now NSIS+MSI / dmg Silicon+Intel / deb + guide PDF note, APA and
  BibTeX bumped to 1.2.0, privacy line now covers LM Studio auto-detection
- Refreshed design/CorpusMindVoiceIcon-256.png and design/CorpusMindVoiceIcon.png with current
  icons (README was displaying the retired icon); pushed main = 90e463e

Stage Summary:
- Homepage 86b2814 and CorpusMind-Voice 90e463e live on GitHub
- Both files em-dash-free; all version references, download links, citations and icons match v1.2.0
- Token ghp_Em3Gw... used for auth; user MUST rotate/revoke after this session

---
Task ID: 8
Agent: main (Super Z)
Task: Redesign the user guide PDF (professional + appealing) and refresh the release asset

Work Log:
- Loaded pdf skill; routed to Creative Flow (guide/handbook); read fonts/creative-flow/overflow/palette/typography/pagination
- Rebuilt docs/user-guide-en.html from scratch as a branded 2-page A4 (794x1123) layout:
  navy gradient header band with app icon tile + version chips, numbered section chips (01-09),
  two-column install cards, model-size chips, styled six-stage pipeline table, confidence-dot legend,
  2-column linguistic-analysis module grid, styled troubleshooting table, navy footer band with
  authors, links, DOI and license line; single navy-teal color family (palette iron law), Inter +
  Noto Naskh Arabic, em-dash-free text throughout
- Iterated with a headless DOM measurement script (scripts/measure_guide.js): explicit two fixed
  pages (break-after/before page), footer pinned via margin-top:auto, content trimmed and spacing
  tightened until page 1 fits with ~23px slack (Chromium monolithic-flex push happened at any
  overflow, even 2px)
- Rendered via html2pdf-next.js --nopaged (Paged.js not installed); poster_validate check-html PASS;
  pdf_qa PASS after setting Title/Author/Subject/Creator metadata (pdf.py meta.set)
- Verified: 2 pages, zero U+FFFD, zero em dashes, no overflow, fill adequate, fonts embedded (Inter
  as Type3 outlines; Liberation Sans only for >= and -> glyphs)
- Pushed docs commit c44e2d5; deleted old release asset and uploaded the new PDF to the v1.2.0
  release as CorpusMind-Voice-User-Guide-EN.pdf (201 uploaded, 504 KB)

Stage Summary:
- Release asset replaced in place; public URL unchanged and verified (HTTP 200)
- New guide source lives at docs/user-guide-en.html; workflow build.yml already copies
  docs/user-guide-en.pdf into future releases
- Token still in use; MUST be rotated/revoked by user after session

---
Task ID: 9
Agent: main (Super Z)
Task: Rebuild v1.2.0 properly - release binaries were dead at runtime (user report:
"the v1.2.0 build doesn't include any of what we discuss in the review and roadmap")

Work Log:
- Ground truth check: downloaded the published v1.2.0 amd64.deb, extracted it, ran
  its Next.js standalone server. UI shell loaded (200) but EVERY API route returned
  500: "Failed to load external module @prisma/client-2c3a283f134fdcb6". Turbopack
  externalized @prisma/client under a hashed package name that Next.js never
  materialized into the standalone node_modules, so the app booted into a dead
  shell: no pipeline, no analysis, no corpus, no exports - exactly what the user
  saw as "old codes / nothing new".
- Second latent bug behind the first: the generated .prisma/client embedded only
  the BUILD machine's query engine (CI runner generated libquery_engine-debian-
  openssl-1.1.x), which cannot load on end-user Windows/macOS/Linux machines even
  after fixing (a).
- Wrote scripts/check_bundle_externals.js: scans all compiled chunks for
  e.x("name",()=>require("name")) external requires and probes each from the
  standalone root; 18 references found, exactly one unresolvable (the prisma hash).
- Fix (a) in scripts/copy-standalone.mjs: after assembly, scan every chunk for
  @prisma/client-<hash> and materialize that package as a copy of @prisma/client
  (whose default.js re-exports node_modules/.prisma/client, already in the bundle).
  Self-healing: picks up any future hash automatically.
- Fix (b) at the source: prisma/schema.prisma generator now declares
  binaryTargets = ["native", "debian-openssl-3.0.x", "windows", "darwin",
  "darwin-arm64"] so all four shipping platforms get a query engine inside
  .prisma/client and the runtime picks the right one per OS.
- Rebuilt from clean (.next removed): bun run build; hardening log confirmed
  "materialized node_modules/@prisma/client-2c3a283f134fdcb6"; externals audit
  now fully green; standalone 159.9 MB (4 engine binaries included).
- Full E2E against the rebuilt standalone (scripts/e2e_cmv.py): 40/40 PASS -
  pipeline en+arz, analysis report (overview, frequency, keywords G2/LogRatio/
  %DIFF, collocations MI/t-score/logDice, ngrams, lexical, Zipf), cross-session
  corpus with DP dispersion, KWIC substring/whole-word/regex/bad-regex-flag/
  Arabic-normalized, filler lexicon GET/PUT persistence, speaker relabel,
  token-edit-to-utterance-text resync, media Range streaming (206), all 8 export
  formats (json/csv/tei/sqlite/srt/vtt/textgrid/eaf) content-verified.
- tsc clean, eslint clean.
- Roadmap features re-verified as present in code: cross-session Corpus tab,
  collocates, Zipf curve, %DIFF, KWIC match modes, TextGrid/EAF/SRT/VTT exports,
  speaker relabeling, filler lexicon - all functioning once the bundle is fixed.
- Tag v1.2.0 force-moved to this HEAD; CI rebuilds all installers and republishes
  the release with the working binaries.

Stage Summary:
- Root cause of the "empty v1.2.0" report: broken standalone bundles, not missing
  features; both failure modes fixed at build time and verified by E2E
- Installer size grows (4 query engines shipped) in exchange for cross-platform
  correctness on user machines
- Token still in use; MUST be rotated/revoked by user after session

Task ID: 8
Agent: Super Z (main)
Task: v1.2.0 rebuild - real Whisper engine, Studio re-run/delete, tab reorder, blue welcome window, professional user guide

Work Log:
- Restored src/app/api/upload/route.ts (was deleted from the working tree; Studio upload was broken)
- Root-caused the demo-text issue: pipeline.ts fell back to a canned-sentence simulation engine; desktop builds shipped no Python/faster-whisper/ffmpeg, and the model manager downloaded CTranslate2 models nothing could load
- New engine: src/lib/asr.ts (Transformers.js v4 + onnxruntime-node, fully offline via env.allowRemoteModels=false, 30s windows with 5s stride and overlap-midpoint word merging), src/lib/dsp.ts (bundled ffmpeg decode to 16k mono PCM, noise floor, SNR-based acoustic word confidence, Praat-style prosody: F0/intensity/jitter/shimmer/HNR on 8k decimation)
- pipeline.ts rewritten: simulation engine deleted; python worker kept as probed optional accelerator (hardware route now really probes faster_whisper+parselmouth); model-missing produces an actionable job error
- models.ts: ONNX catalog (Xenova/whisper-tiny..medium q8, onnx-community/whisper-large-v3-turbo q4), legacy CTranslate2 dir pruning, onnx/ subfolder downloads
- Studio: per-job Re-run dialog (model/dialect/device) + Delete with confirmation; new routes POST /api/audio/[id]/rerun and DELETE /api/audio/[id]; job rows carry model/device
- Tabs reordered: Settings & Diagnostics first, then Studio, Transcript Editor, Corpus Overview (renamed from Metadata, EN+AR), Linguistic Analysis, Assistant
- Welcome window: blue gradient design; hero phrase shortened to "SPEECH TO CORPUS. NO CLOUD." (EN) + Arabic mirror
- em dash sweep: zero occurrences in src/ (regex escapes kept functional)
- Zipf rank-frequency curve added to analysis engine + Frequency tab (recharts log-log)
- i18n: engine labels (Whisper built-in/offline), rerun/delete keys EN+AR, v1.2.0 citations, size labels with real ONNX download sizes
- copy-standalone.mjs: force-copy @huggingface/transformers, onnxruntime-node (completeness check for libonnxruntime.so.1, platform pruning), onnxruntime-common, @ffmpeg-installer
- next.config.ts: serverExternalPackages for the inference stack
- Versions 1.2.0: package.json, tauri.conf.json, citation.cff, i18n About/Cite
- E2E verified on the standalone build: jfk.wav -> exact transcript with word timestamps, prosody, engine=onnx; rerun + delete APIs verified
- User guide: docs/user-guide-en.md and -ar.md rewritten for v1.2.0; professional 2-page A4 PDF (docs/user-guide-en.html + .pdf, pdf_qa PASS)

Stage Summary:
- The app transcribes REALLY and fully offline in every install; demo text is impossible by design
- v1.2.0 ready for release rebuild; tag re-point triggers the single-release workflow

Task 8 addendum (merge resolution): the previous session had pushed nine roadmap
feature commits (Corpus tab, TextGrid/EAF/SRT/VTT exports, KWIC match modes,
collocates, %DIFF, audio playback, speaker relabeling, filler lexicon, prisma
standalone hardening) that the local tree lacked. The rebuild commit was rebased
onto origin/main and both feature sets were merged: the built-in Whisper engine
keeps the corpus tab, all export formats and the custom filler lexicon (now read
by the built-in disfluency stage too). next.config.ts pins
outputFileTracingRoot so a stray parent lockfile cannot re-root the standalone.
Final standalone verified: transcription, analysis, corpus, fillers, all eight
export formats return 200.
