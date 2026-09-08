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
