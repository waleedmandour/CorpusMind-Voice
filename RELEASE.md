# CorpusMind Voice v1.2.0

**Offline audio → linguistically annotated corpus.** A companion tool for [CorpusMind](https://waleedmandour.org/projects/CorpusMind/).

- App (PWA, works on iOS / Android - record & analyse on your phone): **https://corpus-mind-voice.vercel.app**
- Project page: **https://waleedmandour.org/projects/CorpusMindVoice/**
- DOI: [10.5281/zenodo.22649310](https://doi.org/10.5281/zenodo.22649310)

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
| Windows x64 | `CorpusMind.Voice_1.2.0_x64-setup.exe` (NSIS) |
| Windows x64 | `CorpusMind.Voice_1.2.0_x64_en-US.msi` |
| macOS Apple Silicon | `CorpusMind.Voice_1.2.0_aarch64.dmg` |
| macOS Intel | `CorpusMind.Voice_1.2.0_x64.dmg` |
| Linux x64 | `CorpusMind.Voice_1.2.0_amd64.deb` |

*Documentation:* the redesigned two-page **User Guide (English)** ships with the
release as `CorpusMind-Voice-User-Guide-EN.pdf` (source: `docs/user-guide-en.html`
and `docs/user-guide-en.md`), and the clean app icon ships alongside the
installers. The `.msi` is built on the `windows-2022` runner (the windows-2025
image dropped .NET Framework 3.5, which WiX 3 `candle.exe` needs); it remains a
best-effort job so NSIS always ships.

MIT License · © 2026 Dr. Waleed Mandour (Sultan Qaboos University) & Prof. Wesam Ibrahim (Princess Nourah Bint Abdulrahman University)

## Cite

> Mandour, W., & Ibrahim, W. (2026). *CorpusMind Voice: A local-first audio-to-corpus pipeline for corpus linguistics* (Version 1.2.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.22649310
