# CorpusMind Voice 🎙️

**Local-first audio → linguistically annotated corpus. A companion tool for [CorpusMind](https://waleedmandour.org/projects/CorpusMind/).**

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22649310.svg)](https://doi.org/10.5281/zenodo.22649310)
[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.2.0-amber.svg)](https://github.com/waleedmandour/CorpusMind-Voice/releases/tag/v1.2.0)

**Developers:** Dr. Waleed Mandour (Sultan Qaboos University) · Prof. Wesam Ibrahim (Princess Nourah Bint Abdulrahman University)

CorpusMind Voice turns MP3/MP4/M4A/OGG/WAV files - or live microphone input - into a structured, query-ready corpus with word-level timestamps, prosodic features and disfluency annotation. **Everything runs on your machine. No audio, transcript, or metadata ever leaves your device. No cloud APIs are called.**

> The companion corpus analysis environment lives at the [CorpusMind project site](https://waleedmandour.org/projects/CorpusMind/). CorpusMind Voice is designed to hand its outputs straight into CorpusMind with one click.

![CorpusMind Voice app icon](design/CorpusMindVoiceIcon-256.png)

## ✨ What it does

The six-stage pipeline is **real in every install**: the app embeds its own Whisper inference engine (ONNX Runtime) and its own acoustic analysis, so transcription never depends on an internet connection, a cloud API, or a separately installed Python stack.

| Stage | Feature | Implementation |
|-------|---------|----------------|
| 1 · Ingest | Decode any container to 16 kHz mono PCM | bundled ffmpeg (`@ffmpeg-installer`), system ffmpeg fallback |
| 2 · ASR | Word-level timestamps + confidence | local Whisper via ONNX Runtime (Transformers.js): `tiny` to `large-v3-turbo`, INT8/Q4 |
| 3 · Alignment | Word boundaries from cross-attention | Whisper DTW alignment heads (same mechanism as OpenAI word timestamps) |
| 4 · Prosody | F0 (50–400 Hz), intensity, jitter, shimmer, HNR | Praat-style autocorrelation DSP, computed on the waveform in-app |
| 5 · Disfluency | Pauses > 200 ms, fillers (`um`/`uh`, `يعني`/`آه`/`إيه`), repeats, false starts, interruptions, lengthenings | rule-based scanner over real tokens and timestamps |
| 6 · Structure | SQLite (3 tables) + JSON + CSV + TEI/XML + TextGrid + EAF + SRT/VTT | stdlib writers |

A host with `python3` + `faster-whisper` + `parselmouth` installed can act as an optional accelerator (the app probes for it and shows it under Settings & Diagnostics), but it is never required.

**Also included**

- ⚙️ **Settings & Diagnostics first** - the tab strip opens with engine/model management so every job starts configured; **Corpus Overview** sits immediately before Linguistic Analysis
- 🔁 **Re-run with a different engine setup** - switch Whisper model, dialect or device for any recording and the pipeline reruns from scratch
- 🗑 **Delete recordings** - removes the audio file together with its transcript, analysis and metadata
- 🗂 **Corpus Overview tab** - cross-session inventory, corpus frequency with DP dispersion across sessions, and cross-session KWIC concordance
- 🔊 **Click-to-play** - hear any utterance or KWIC hit straight from the recording (HTTP Range streaming)
- 📊 **Node-word collocates explorer** - windowed collocates (span 1–5, left/right/both, minimum co-occurrence) with MI, t-score and logDice, sortable and exportable
- 📈 **Zipf rank-frequency curve** - log-log plot over the top 200 types
- 🎯 **Keyword effect sizes** - log-likelihood G², LogRatio and %DIFF (Hardie 2014) in the Keywords table
- 🔎 **KWIC match modes** - normalized (strips Arabic diacritics, unifies alef variants), whole-word and regular-expression matching, with a live hit count
- 🎛 **Editable filler lexicon** - adapt hesitation-marker detection to your dialect per language
- 🗣 **Speaker relabeling** - fix SPK1/SPK2 labels per utterance for multi-speaker recordings
- ✏️ **Confidence-coded editor** - every token is green (≥ 0.85) / amber (0.6–0.85) / red (< 0.6); correcting a token updates the utterance text so exports always match the corrected tokens
- 🗂 **Corpus metadata form** - embedded into the TEI `<teiHeader>` of every export
- 🌍 **Bilingual UI** - full English + Arabic (RTL, Cairo typeface) interface
- 📴 **PWA** - installable, offline shell via service worker
- 🧠 **Ollama / LM Studio chat panel** - query a *local* LLM about your corpus (never a cloud API)
- 🔗 **CorpusMind launcher** - detects and opens a local CorpusMind installation
- ⏬ **First-run model download** with an in-app progress bar; models persist and are reused fully offline

## 🚀 Quick start (web)

```bash
bun install
bun run db:push
bun run dev          # http://localhost:3000
```

Then open **Settings & Diagnostics**, download a Whisper model (start with `tiny`, use `large-v3-turbo` for best accuracy) and upload or record audio in the **Studio**.

Optional Python accelerator (skipped entirely if not installed):

```bash
pip install -r python/requirements.txt
```

## 🖥 Desktop builds (Tauri 2)

Native bundles for **Windows (NSIS + MSI)**, **macOS (dmg, Apple Silicon and Intel)** and **Linux (deb)** are produced by GitHub Actions on every push / `v*` tag: `.github/workflows/build.yml`. Each release also ships the two-page **User Guide PDF** (`CorpusMind-Voice-User-Guide-EN.pdf`) and the clean app icon. The desktop shell embeds the Next.js standalone server as a **Node sidecar** and seeds a private SQLite database in the user data dir - same app, fully offline, Whisper engine and ffmpeg included in the installer.

### Local desktop build (step by step)

1. **Install Rust** (https://rustup.rs). On Windows this means the *MSVC* toolchain: install Visual Studio Build Tools with the "Desktop development with C++" workload first, then `rustup` with the default `x86_64-pc-windows-msvc` host. Linux additionally needs `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev`.
2. **Install Bun** (https://bun.sh) or use Node 22 + npm with `npm install`.
3. **Provide the Node sidecar binary.** Tauri bundles a real `node` executable as an *external binary* and expects it at `src-tauri/binaries/node-<target-triple>` - a missing or misnamed file fails the build with `resource path 'binaries/node-<target>' doesn't exist`. Download Node (the version CI uses is `v22.14.0`, see `NODE_DIST` in `build.yml`) and copy the binary under the exact name for your target:

   | Target | Expected file |
   |--------|---------------|
   | Windows x64 | `src-tauri/binaries/node-x86_64-pc-windows-msvc.exe` |
   | Linux x64 | `src-tauri/binaries/node-x86_64-unknown-linux-gnu` |
   | macOS Apple Silicon | `src-tauri/binaries/node-aarch64-apple-darwin` |
   | macOS Intel | `src-tauri/binaries/node-x86_64-apple-darwin` |

   Example (Windows PowerShell):

   ```powershell
   Invoke-WebRequest https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip -OutFile node.zip
   Expand-Archive node.zip -DestinationPath .
   Copy-Item node-v22.14.0-win-x64\node.exe src-tauri\binaries\node-x86_64-pc-windows-msvc.exe
   src-tauri\binaries\node-x86_64-pc-windows-msvc.exe --version   # must print v22.14.0
   ```

4. **Build**:

   ```bash
   bun run build                 # Next.js standalone + native pruning + bundle check
   bunx tauri build              # desktop bundle (add --bundles nsis on Windows to skip MSI)
   ```

### Windows code signing (optional)

Release installers are currently unsigned; SmartScreen therefore shows the standard "Windows protected your PC" warning (documented in the user guide). To ship a verified-publisher build, add repository secrets `WINDOW_PFX_BASE64` (base64 of the PFX certificate) and `WINDOW_PFX_PASSWORD`, and CI signs every NSIS/MSI artifact with SHA-256 plus an RFC 3161 timestamp via `scripts/sign-windows.ps1`. Without the secrets the signing step is a no-op, so fork builds stay unsigned. Locally, set the same variables and run `pwsh scripts/sign-windows.ps1` after `bunx tauri build`. The timestamp server is contacted by the build machine only - the app itself makes no network calls.

## 📦 Export formats

| Format | Contents |
|--------|----------|
| `*.corpusmind.json` | full records - loads directly with `pandas.json_normalize(..., record_path="tokens")` |
| `*.tokens.csv` | flat token table: index, text, start/end ms, confidence, edited flags |
| `*.tei.xml` | TEI P5 - `<teiHeader>` with your corpus metadata + time-aligned `<w>` elements |
| `*.sqlite` | standalone three-table database (`audio_metadata`, `utterances`, `tokens`) |
| `*.TextGrid` | Praat TextGrid - interval tiers per utterance for phonetic workbenches |
| `*.eaf` | ELAN EAF - annotation tiers for multimodal discourse analysis |
| `*.srt` / `*.vtt` | subtitle formats - readable transcripts for media players |

## 🔒 Privacy model

- Zero network calls to third parties; ASR, alignment, prosody and export are local processes. After a model is downloaded, inference is fully offline (`allowRemoteModels` is disabled in the engine).
- The service worker caches only the app shell; `/api/*` responses are never cached.
- The optional assistant talks to `http://127.0.0.1:11434` (Ollama) or `http://127.0.0.1:1234` (LM Studio) only, and tells you when neither is reachable.

## 📚 Documentation

- [User Guide (English)](docs/user-guide-en.md) - two pages
- [دليل المستخدم (العربية)](docs/user-guide-ar.md) - صفحتان
- Project page: <https://waleedmandour.org/projects/CorpusMindVoice/>
- Web app / PWA (mobile recording & analysis): <https://corpus-mind-voice.vercel.app/>
- Parent project site: <https://waleedmandour.org/projects/CorpusMind/>

## 📚 Citing

If you use CorpusMind Voice in research, teaching, or published work, please cite it using the references below (also available in-app via the **Cite** button, and in [citation.cff](citation.cff)).

### APA 7th edition

> Mandour, W., & Ibrahim, W. (2026). *CorpusMind Voice: A local-first audio-to-corpus pipeline for corpus linguistics* (Version 1.2.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.22649310

### BibTeX

```bibtex
@software{Mandour_CorpusMindVoice_2026,
  author  = {Mandour, Waleed and Ibrahim, Wesam},
  title   = {{CorpusMind Voice: A local-first audio-to-corpus pipeline for corpus linguistics}},
  version = {1.2.0},
  year    = {2026},
  publisher = {Zenodo},
  doi     = {10.5281/zenodo.22649310},
  url     = {https://doi.org/10.5281/zenodo.22649310}
}
```

If you also use the parent environment, cite **CorpusMind** as well:

> Mandour, W., & Ibrahim, W. (2026). *CorpusMind: A local-first, AI-native research environment for corpus linguistics and multimodal discourse analysis* (Version 1.1.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.21226650

## ⚖️ License

MIT © 2026 Dr. Waleed Mandour (Sultan Qaboos University) & Prof. Wesam Ibrahim (Princess Nourah Bint Abdulrahman University). Whisper, ffmpeg and Praat keep their respective licenses.
