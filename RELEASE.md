# CorpusMind Voice v1.3.0

**Offline audio → linguistically annotated corpus.** A companion tool for [CorpusMind](https://waleedmandour.org/projects/CorpusMind/).

- App (PWA, works on iOS / Android - record & analyse on your phone): **https://corpus-mind-voice.vercel.app**
- Project page: **https://waleedmandour.org/projects/CorpusMindVoice/**
- DOI: [10.5281/zenodo.22649310](https://doi.org/10.5281/zenodo.22649310)

## New in v1.3.0

- **Upload and recording fixed in every install mode.** The desktop app wrote
  audio files and worker output under its install directory, which is
  read-only for MSI per-machine installs (Program Files), so uploads and
  microphone recordings failed with permission errors. All app data now lives
  in the OS per-user application data folder (`CM_DATA_DIR`), wired end to
  end: uploads, recordings, worker output and app config. Recordings saved by
  earlier versions inside the install directory are migrated into the new
  location on first launch. The sidecar's stdout/stderr is captured to
  `logs/sidecar.log` in the data folder instead of being discarded, so any
  remaining problem is diagnosable from the log file.
- **Phone companion.** Settings gains a "Phone companion" card (desktop
  shell only). Enabling it generates a pairing token and a self-signed
  certificate and starts a token-gated proxy on the local network: the phone
  opens the pairing URL (QR code shown in Settings) and gets the same PWA -
  upload recordings, browse the corpus, stream audio and chat through the
  desktop's local LLM. For phone-side microphone recording use the
  `https://` pairing link (browsers only expose the microphone on secure
  pages); the phone will warn about the self-signed certificate once.
  Everything stays on the local network and behind the pairing token.
- **Ollama host override.** Settings > local LLM accepts a custom Ollama
  host (`host:port` or `http://host:port`), so the app (and the phone
  companion) can use an Ollama daemon running on another machine on the
  network; empty falls back to the local daemon.
- **Recording from the phone, Ollama on other devices:** the desktop remains
  the engine; phones and second machines are clients. A native Android/iOS
  build remains future work.

## Fixed in v1.3.0

> This tag was rebuilt on 2026-09-12. The first v1.3.0 packaging pass (built
> 2026-09-11) contained a defect that broke upload, recording and analysis in
> the installed desktop app; if you downloaded an installer before this date,
> please re-download. The web/PWA deployment was never affected.

- **Upload, recording and analysis failed inside the installed desktop app
  with "Internal Server Error".** The build chained the speech runtime
  (@huggingface/transformers) and the FFmpeg resolver as external packages,
  which the bundler wires through hashed module aliases materialized as
  symlinks. Windows installers (NSIS and MSI) cannot carry symlinks, so the
  installed app lost every alias and the first API call that touched the
  speech stack died before running any code. Every such route now ships the
  runtime as real files, the build chain boots the packaged server from an
  isolated directory and performs a real upload before the installers are
  allowed to build, and the bundle check fails the build if any referenced
  module alias is missing.
- **The About card cited the app as "Version 1.2.0".** The APA and BibTeX
  citation strings inside the app were hand-maintained and had drifted while
  every other version marker moved to 1.3.0. They now read 1.3.0 and are
  managed by the same version-sync gate as the guides, README, release notes
  and installer metadata.
- **Deleted recordings could report failure after succeeding.** The delete
  endpoint removed the database rows first and the files second, so a
  file-system error surfaced as a 500 although the corpus entry was already
  gone (and retrying returned 404). Files are now removed first, best effort,
  and any orphaned file is reported in the response without failing the
  deletion.
- **SQLite corpus export always failed on Windows.** The export hardcoded
  `python3`, which stock Windows does not have even when Python is
  installed; the interpreter is now resolved in order (`python3`, `python`,
  `py`) and verified to actually run. The same resolution fixes the Python
  accelerator probe in Settings and the pipeline's Python worker on Windows.
- **Stale UI after upgrading the desktop app.** The service worker installed
  by the PWA kept serving the previous build's cached shell inside the
  desktop webview. Desktop sessions now unregister the service worker and
  clear its caches on boot; phone and browser sessions keep full offline PWA
  behaviour.
- **Audio playback could stick in "playing".** Clicking a concordance or
  utterance clip set `currentTime` before the browser had parsed the audio
  metadata; the seek never happened, playback never started and the playing
  badge never cleared. Metadata is now awaited before seeking, stale seek
  handlers are detached, and the badge clears when playback ends.
- **CUDA option offered without a GPU.** The device selector offered CUDA on
  machines with no NVIDIA GPU; the option now appears only when the hardware
  probe detects one, and an existing "cuda" selection falls back to auto.
- **WAL journaling silently skipped.** The WAL and busy_timeout pragmas were
  issued through an API that rejects SQLite statements returning a result
  row, so the advertised WAL hardening never actually applied; they are now
  issued correctly (verified: `journal_mode = wal` after boot).

## Fixed in v1.2.2

- **Smaller installers.** Every build previously carried all five Prisma query
  engines plus onnxruntime and ffmpeg binaries for every platform (~150 MB of
  engines its OS can never load). The bundle assembler now prunes everything
  that does not match the build target; the assembled standalone dropped from
  282.9 MB to 205.9 MB on a Linux x64 build. Measured installer delta on
  Windows: the NSIS setup fell from 107 MB (v1.2.1) to 69.6 MB (v1.2.2),
  about 35% lighter. A new `bun run bundle:check` gate (`scripts/check_bundle_externals.mjs`)
  verifies after every build that exactly one target query engine, the target
  onnxruntime binding + shared library, the target ffmpeg binary and the
  transformers runtime are all present - the direct guard against the
  "CI-green but every API route 500s" failure mode from v1.2.0.
- **Optional Windows code signing.** Adding `WINDOW_PFX_BASE64` +
  `WINDOW_PFX_PASSWORD` repository secrets now signs every NSIS/MSI artifact
  with SHA-256 and an RFC 3161 timestamp (`scripts/sign-windows.ps1`); without
  the secrets builds stay unsigned exactly as before. The user guides (EN + AR)
  document the SmartScreen "Windows protected your PC" prompt and the
  More info → Run anyway path for unsigned builds.
- **Installer process cleanup hardened.** The pre-install/pre-uninstall hook
  passes the install directory to PowerShell through an environment variable
  instead of string interpolation, so spaces ("C:\Program Files\CorpusMind
  Voice"), localized Program Files names, apostrophes and non-ASCII user names
  can no longer break the path match. A second, subfolder-scoped kill covers
  future sidecar layouts.
- **SQLite concurrency hardening.** The bundled database now opens with
  `connection_limit=1`, `journal_mode=WAL` and `busy_timeout=5000`, so running
  an export while a pipeline job commits no longer fails with "database is
  locked" on Windows.
- **Cross-platform npm scripts.** `npm run dev` / `npm run start` no longer use
  POSIX-only `tee` pipes and inline env-var assignments; the new
  `scripts/serve.mjs` launcher works unchanged in cmd.exe and PowerShell and
  writes sane local defaults for `DATABASE_URL` and `CM_MODELS_DIR`.
- **Single source of truth for versions.** `scripts/sync-version.mjs` writes
  package.json's version into the Tauri config, Cargo manifest/lock, CITATION.cff,
  both user guides, the guide PDF source, the README badge and citations, and
  the release notes, and `--check` mode is a CI gate - the "guides said 1.2.0
  while the app shipped 1.2.1" drift is now impossible to merge.
- **README version sync gap closed.** The README version badge and its APA and
  BibTeX citation blocks were the one version-bearing spot the sync tool did
  not manage, and they had drifted to 1.2.0 while the app shipped 1.2.2. The
  badge, the Voice citation line and the Voice BibTeX entry are now managed by
  `scripts/sync-version.mjs` (strictly scoped so the parent CorpusMind
  citation keeps its own version) and covered by the `--check` CI gate.
- **MSI runner pin de-risked.** The release job now collects and verifies the
  required installers (NSIS setup, deb, both DMGs) BEFORE it removes the
  previous release, so a failed build can no longer leave the repo with no
  release at all, and a missing best-effort MSI raises a loud warning
  annotation plus a run-summary note instead of passing silently. A new
  weekly `runner-watch` workflow (`.github/workflows/runner-watch.yml`)
  turns red as soon as the windows-2022 label or the .NET Framework 3.5
  payload that WiX 3's `candle.exe` needs disappears from the runner image.
  WiX 4/5 was evaluated and stays on record: tauri's MSI bundler ships its
  own WiX 3.14 toolset with no supported switch to a newer WiX major, so the
  documented escape hatches when windows-2022 retires are DISM-enabled
  NetFx3 on a newer image or shipping NSIS-only.
- **Rust hygiene gate.** CI runs `cargo fmt --check` and `cargo clippy -D warnings`;
  both pass today, and the bar is enforced from now on.
- **Docs.** Troubleshooting rows for the pre-1.2.1 installer-lock symptom
  (upgrading self-heals it), for Windows microphone privacy toggles, and a
  rewritten, accurate mic-permission explanation (the in-app prompt is
  auto-granted on Windows; the OS-level toggle is what can still block it).

## Fixed in v1.2.1

- **Windows upgrades no longer fail with "Error opening file for writing".**
  The desktop shell now terminates its bundled Node sidecar the moment the app
  window closes, and binds that sidecar to a Windows Job Object so even a
  crashed shell instantly reaps it. Previously the background server kept
  running after the app was closed, holding locks on `node.exe` and the Prisma
  query engine DLL, which blocked every later install, upgrade or uninstall.
  The NSIS installer itself now also closes any running CorpusMind Voice
  instance (and any `node.exe` running from the install folder only) before it
  touches a single file, for both install and uninstall. Users upgrading from
  v1.2.0 or earlier get the cleanup for free: the new installer kills the stale
  processes left behind by the old version, then installs cleanly.

## Highlights in v1.2.0

- **Real transcription in every install.** The app now embeds its own Whisper
  inference engine: models run locally through ONNX Runtime (Transformers.js)
  inside the bundled Node server. No Python, no cloud, no external tools.
  Word-level timestamps come from Whisper's cross-attention alignment, and word
  confidence is measured acoustically from the waveform (SNR against the
  recording's noise floor). The old demo/simulation engine is gone entirely.
- **Whisper model line-up** - `tiny`, `base`, `small`, `medium` and
  `large-v3-turbo` (recommended), shipped as ONNX graphs the app downloads once
  and reuses fully offline; resumable downloads with live progress. Models left
  by the retired CTranslate2 engine are cleaned up automatically.
- **Bundled ffmpeg** - every installer decodes MP3/MP4/M4A/AAC/OGG/OPUS/WAV/
  FLAC/WEBM/WMA/AMR/3GP/AIFF out of the box.
- **Real prosody in-app** - Praat-style autocorrelation analysis of the actual
  waveform: F0 (50–400 Hz) mean/range, intensity, jitter, shimmer and HNR per
  utterance.
- **Roadmap feature set** - cross-session **Corpus Overview** tab (inventory,
  corpus frequency with DP dispersion, cross-session KWIC), **TextGrid / EAF /
  SRT / VTT exports**, **node-word collocates** (span 1-5, MI / t-score /
  logDice), keyword **%DIFF** effect size, **KWIC match modes** (normalized /
  whole-word / regex) with hit counts, **click-to-play** audio, **speaker
  relabeling** and an **editable filler lexicon**.
- **Studio workflow** - every recent job can be **re-run** with a different
  Whisper model, dialect or device (test with `tiny`, finish with
  `large-v3-turbo`), or **deleted** together with its transcript, analysis and
  metadata. The pipeline card offers Re-run as soon as a job finishes or fails.
- **Tab order** - the strip now opens with **Settings & Diagnostics** so every
  job starts configured, and keeps **Corpus Overview** immediately before
  **Linguistic Analysis** (the Metadata tab was renamed to Corpus Overview).
- **Zipf rank-frequency curve** joins the Frequency module (log-log), next to
  DP dispersion, KWIC, keyword effect sizes (G² + LogRatio), collocations
  (MI / t-score / logDice), lexical diversity and readability.
- **Welcome window** - blue onboarding design with the new tagline
  "SPEECH TO CORPUS. NO CLOUD." in all caps.
- **Cleaner engine labels** - jobs report `Whisper (built-in, offline)` or
  `Python worker (faster-whisper)` when that optional host accelerator exists
  (probed for real, not assumed).
- **Professional two-page user guide** (redesigned PDF shipped with the
  release), refreshed bilingual documentation and citation metadata (v1.2.0).

## Installers

| Platform | File |
| --- | --- |
| Windows x64 | `CorpusMind.Voice_1.3.0_x64-setup.exe` (NSIS) |
| Windows x64 | `CorpusMind.Voice_1.3.0_x64_en-US.msi` |
| macOS Apple Silicon | `CorpusMind.Voice_1.3.0_aarch64.dmg` |
| macOS Intel | `CorpusMind.Voice_1.3.0_x64.dmg` |
| Linux x64 | `CorpusMind.Voice_1.3.0_amd64.deb` |

*Documentation:* the redesigned two-page **User Guide (English)** ships with the
release as `CorpusMind-Voice-User-Guide-EN.pdf` (source: `docs/user-guide-en.html`
and `docs/user-guide-en.md`), and the clean app icon ships alongside the
installers. The `.msi` is built on the `windows-2022` runner (the windows-2025
image dropped .NET Framework 3.5, which WiX 3 `candle.exe` needs); it remains a
best-effort job so NSIS always ships, a missing MSI now raises a loud warning
in the release job, and the weekly `runner-watch` workflow tracks the
windows-2022 + .NET 3.5 preconditions.

MIT License · © 2026 Dr. Waleed Mandour (Sultan Qaboos University) & Prof. Wesam Ibrahim (Princess Nourah Bint Abdulrahman University)

## Cite

> Mandour, W., & Ibrahim, W. (2026). *CorpusMind Voice: A local-first audio-to-corpus pipeline for corpus linguistics* (Version 1.3.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.22649310
