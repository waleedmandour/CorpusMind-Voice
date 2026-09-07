# CorpusMind Voice v1.0.0

**Local-first audio → linguistically annotated corpus. A companion tool for [CorpusMind](https://waleedmandour.org/projects/CorpusMind/).**

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22649310.svg)](https://doi.org/10.5281/zenodo.22649310)

## Highlights

- **Six-stage offline pipeline** — ingest/preprocess → faster-whisper `large-v3` (INT8) ASR with word timestamps & confidence → Montreal Forced Aligner word/phoneme boundaries → Parselmouth (Praat) prosody (F0, intensity, jitter, shimmer, HNR) → disfluency detection (pauses, fillers, repeats, false starts, interruptions, lengthenings) → structured output.
- **Exports** — pandas-ready JSON, token CSV, TEI/XML with embedded `<teiHeader>`, and a standalone three-table SQLite corpus database that opens directly in CorpusMind.
- **Confidence-coded transcript editor** with single-utterance re-alignment.
- **Corpus metadata form** embedded into the TEI header of every export.
- **Bilingual UI** — full English + Arabic (RTL, Cairo typeface).
- **PWA + desktop apps** — installable in the browser, and native Windows (NSIS/MSI), macOS (dmg, arm64 + x86_64) and Linux (deb/AppImage) bundles with the Next.js server embedded as a Node sidecar. Fully offline either way.
- **Local research assistant** — optional Ollama chat; never a cloud API.
- **CorpusMind launcher** — detects a local CorpusMind installation and hands the corpus over.

## Downloads

| Platform | File |
|----------|------|
| Windows x64 | `CorpusMind Voice_1.0.0_x64-setup.exe` (NSIS) · `CorpusMind Voice_1.0.0_x64_en-US.msi` |
| macOS Apple Silicon | `CorpusMind Voice_1.0.0_aarch64.dmg` |
| macOS Intel | `CorpusMind Voice_1.0.0_x64.dmg` |
| Linux x64 | `CorpusMind Voice_1.0.0_amd64.AppImage` · `corpusmind-voice_1.0.0_amd64.deb` |
| Web (PWA, no install) | deploy the `web-standalone` artifact or run locally |

## Citation

**APA 7th edition**

> Mandour, W., & Ibrahim, W. (2026). *CorpusMind Voice: A local-first audio-to-corpus pipeline for corpus linguistics* (Version 1.0.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.22649310

**Developers:** Dr. Waleed Mandour (Sultan Qaboos University) · Prof. Wesam Ibrahim (Princess Nourah Bint Abdulrahman University)

## Privacy

Zero network calls to third parties. ASR, alignment, prosody and export are local processes; no audio, transcript or metadata ever leaves the machine.
