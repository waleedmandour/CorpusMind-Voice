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
