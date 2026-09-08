# CorpusMind Voice v1.1.0

**Offline audio → linguistically annotated corpus.** A companion tool for [CorpusMind](https://waleedmandour.org/projects/CorpusMind/).

- App (PWA, works on iOS / Android — record & analyse on your phone): **https://corpus-mind-voice.vercel.app**
- Project page: **https://waleedmandour.org/projects/CorpusMindVoice/**
- DOI: [10.5281/zenodo.22649310](https://doi.org/10.5281/zenodo.22649310)

## Highlights in v1.1.0

- **New Linguistic Analysis tab** — academic corpus analysis computed locally:
  frequency + DP dispersion, KWIC concordance, keyword analysis (log-likelihood
  G² + LogRatio effect size), n-grams & collocations (MI / t-score / logDice),
  lexical diversity (TTR / MATTR / MTLD), readability (Flesch / Flesch–Kincaid /
  LIX), disfluency rates and Praat prosody aggregates. Every table saves to
  CSV; the full report saves as JSON.
- **Exports moved into the tabs** — the dedicated Export tab is gone; save
  JSON / CSV / TEI/XML / SQLite directly from the Transcript Editor, Metadata
  and Linguistic Analysis tabs.
- **Settings and Diagnostics** (renamed from Diagnostics) now hosts:
  - **Models manager** — download / delete any Whisper size (tiny → large-v3)
    into the app's private data folder; files persist across restarts and are
    reused offline (fixes the v1.0.0 desktop persistence bug). Resumable
    downloads with live progress.
  - **Local LLM detection** — Ollama (11434) and LM Studio (1234) are probed
    exactly like the parent CorpusMind (127.0.0.1 + localhost + OLLAMA_HOST),
    with `ollama serve` auto-start on desktop and per-provider model pickers.
    The Research Assistant and per-transcript AI tools (summarise, clean
    preview, topic tags) run through whichever provider is online.
- **Light / Dark / System theme** with a header toggle (defaults to your OS).
- **Welcome window** — three pages on first launch (what it does · 100 %
  offline privacy · quick start), bilingual EN/AR.
- **Recording works again** — macOS ships the microphone usage description,
  Windows WebView2 auto-grants capture, mobile browsers get a codec fallback
  chain (webm/opus → mp4/aac → ogg).
- **More input formats** — M4A, OGG/OPUS, AAC, AMR, 3GP, WMA, AIFF in addition
  to MP3 / MP4 / WAV / FLAC / WEBM.
- **Per-job Whisper model picker** in the Studio.
- **Smaller installers** — the bundled server is pruned (build cache, source
  maps and non-runtime Prisma engines removed).
- **Clean icon** — the thick white border is gone from every icon (app, PWA,
  installer, release).

## Installers

| Platform | File |
| --- | --- |
| Windows x64 | `CorpusMind Voice_1.1.0_x64-setup.exe` (NSIS) · `.msi` (best effort) |
| macOS Apple Silicon | `CorpusMind Voice_1.1.0_aarch64.dmg` |
| macOS Intel | `CorpusMind Voice_1.1.0_x64.dmg` |
| Linux x64 | `corpus-mind-voice_1.1.0_amd64.deb` · `.AppImage` |

MIT License · © 2026 Dr. Waleed Mandour (Sultan Qaboos University) & Prof. Wesam Ibrahim (Princess Nourah Bint Abdulrahman University)

## Cite

> Mandour, W., & Ibrahim, W. (2026). *CorpusMind Voice: A local-first audio-to-corpus pipeline for corpus linguistics* (Version 1.1.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.22649310
